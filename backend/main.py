"""
main.py — FastAPI backend z live ETL progress przez Server-Sent Events (SSE)
"""

import asyncio
import os
import json
import time
from typing import Optional, AsyncGenerator
from collections import deque
from datetime import datetime

import httpx
from fastapi import FastAPI, HTTPException, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from neo4j import GraphDatabase
from dotenv import load_dotenv

load_dotenv()

NEO4J_URI  = os.getenv("NEO4J_URI",      "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER",     "neo4j")
NEO4J_PASS = os.getenv("NEO4J_PASSWORD", "sejm_password")
BASE_URL   = "https://api.sejm.gov.pl/eli"
PUBLISHER  = "WDU"
REQ_DELAY  = 0.4

FILTER_KEYWORDS = [
    "przedsiębiorc", "działalność gospodarcza", "swoboda działalności",
    "wolność gospodarcza", "prawo przedsiębiorców", "wilcz",
    "rejestracja działalności", "jednoosobowa działalność",
    "spółka", "koncesja", "zezwolenie gospodarcze",
]

REF_TYPE_MAP = {
    "CHANGES": "CHANGES", "AMENDS": "CHANGES",
    "REPEALS": "REPEALS", "REPEALED_BY": "REPEALED_BY",
    "EXECUTES": "EXECUTES", "IMPLEMENTS": "EXECUTES",
}

app = FastAPI(title="Sejm ELI Graph API", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ════════════════════════════════════════════════════════════════
#  Stan ETL (in-memory, globalny)
# ════════════════════════════════════════════════════════════════

class EtlState:
    def __init__(self):
        self._queues: list = []
        self.reset()

    def reset(self):
        self.running       = False
        self.started_at    = None
        self.finished_at   = None
        self.error         = None
        self.phase         = "idle"
        self.current_year  = None
        self.current_act   = ""
        self.years_total   = 0
        self.years_done    = 0
        self.acts_scanned  = 0
        self.acts_found    = 0
        self.acts_total    = 0
        self.acts_saved    = 0
        self.refs_total    = 0
        self.refs_saved    = 0
        self.api_calls     = 0
        self.api_errors    = 0
        self.rate_limited  = 0
        self.log: deque    = deque(maxlen=200)

    def add_log(self, msg: str, level: str = "info"):
        entry = {"ts": datetime.utcnow().strftime("%H:%M:%S"), "level": level, "msg": msg}
        self.log.append(entry)
        self._broadcast({"type": "log", **entry})

    def update(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)
        self._broadcast({"type": "progress", **self.snapshot()})

    def snapshot(self) -> dict:
        elapsed = 0
        if self.started_at:
            elapsed = int((self.finished_at or time.time()) - self.started_at)
        acts_pct = round(self.acts_saved / self.acts_total * 100) if self.acts_total > 0 else 0
        years_pct = round(self.years_done / self.years_total * 100) if self.years_total > 0 else 0
        return {
            "running": self.running, "phase": self.phase, "error": self.error,
            "elapsed_s": elapsed,
            "years_total": self.years_total, "years_done": self.years_done,
            "years_pct": years_pct, "current_year": self.current_year,
            "acts_scanned": self.acts_scanned, "acts_found": self.acts_found,
            "acts_total": self.acts_total, "acts_saved": self.acts_saved,
            "acts_pct": acts_pct,
            "refs_total": self.refs_total, "refs_saved": self.refs_saved,
            "api_calls": self.api_calls, "api_errors": self.api_errors,
            "rate_limited": self.rate_limited,
            "current_act": self.current_act,
            "log": list(self.log)[-30:],
        }

    def subscribe(self) -> asyncio.Queue:
        q = asyncio.Queue(maxsize=500)
        self._queues.append(q)
        return q

    def unsubscribe(self, q):
        try: self._queues.remove(q)
        except ValueError: pass

    def _broadcast(self, data: dict):
        dead = []
        for q in self._queues:
            try: q.put_nowait(data)
            except asyncio.QueueFull: dead.append(q)
        for q in dead: self.unsubscribe(q)


etl = EtlState()


# ════════════════════════════════════════════════════════════════
#  Neo4j helpers
# ════════════════════════════════════════════════════════════════

def get_driver():
    return GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASS))

def neo4j_query(cypher: str, params: dict = None) -> list:
    d = get_driver()
    try:
        with d.session() as s:
            return [dict(r) for r in s.run(cypher, params or {})]
    finally:
        d.close()

def neo4j_run(cypher: str, params: dict = None):
    d = get_driver()
    try:
        with d.session() as s:
            s.run(cypher, params or {})
    finally:
        d.close()

STATUS_COLOR = {
    "obowiązujący": "#22c55e", "uchylony": "#ef4444",
    "nieobowiązujący": "#f97316", "zmieniony": "#3b82f6",
    "EXTERNAL": "#64748b", "UNKNOWN": "#94a3b8",
}

def status_color(s):
    for k, c in STATUS_COLOR.items():
        if k.lower() in (s or "").lower():
            return c
    return "#94a3b8"

def fmt_node(row):
    p = dict(row["a"])
    return {"data": {
        "id": p.get("id",""), "label": (p.get("title","") or p.get("id",""))[:60],
        "title": p.get("title",""), "year": p.get("year"), "pos": p.get("pos"),
        "status": p.get("status","UNKNOWN"), "type": p.get("type",""),
        "keywords": p.get("keywords",[]), "announced": p.get("announced"),
        "color": status_color(p.get("status","")),
    }}

def fmt_edge(row):
    return {"data": {
        "id": f"{row['from_id']}__{row['to_id']}__{row['r'].type}",
        "source": row["from_id"], "target": row["to_id"], "label": row["r"].type,
    }}


# ════════════════════════════════════════════════════════════════
#  Graph API endpoints
# ════════════════════════════════════════════════════════════════

@app.get("/api/graph")
async def get_graph(
    year: Optional[int] = None, status: Optional[str] = None,
    keyword: Optional[str] = None, limit: int = Query(500, ge=1, le=2000),
):
    where, params = [], {"limit": limit}
    if year:    where.append("a.year=$year");    params["year"] = year
    if status:  where.append("toLower(a.status) CONTAINS toLower($status)"); params["status"] = status
    if keyword: where.append("toLower(a.title) CONTAINS toLower($keyword)"); params["keyword"] = keyword
    w = ("WHERE " + " AND ".join(where)) if where else ""
    try:
        nodes = neo4j_query(f"MATCH (a:Act) {w} RETURN a LIMIT $limit", params)
        ids   = [dict(r["a"])["id"] for r in nodes]
        edges = neo4j_query(
            "MATCH (a:Act)-[r]->(b:Act) WHERE a.id IN $ids AND b.id IN $ids "
            "RETURN a.id AS from_id, b.id AS to_id, r LIMIT 2000", {"ids": ids}
        ) if ids else []
        return {"elements": [fmt_node(r) for r in nodes] + [fmt_edge(r) for r in edges]}
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/api/act/{publisher}/{year}/{pos}")
async def get_act(publisher: str, year: int, pos: int):
    rows = neo4j_query("MATCH (a:Act {id:$id}) RETURN a", {"id": f"{publisher}/{year}/{pos}"})
    if not rows: raise HTTPException(404, "Akt nie znaleziony")
    return dict(rows[0]["a"])


@app.get("/api/stats")
async def get_stats():
    try:
        totals   = neo4j_query("MATCH (a:Act) RETURN count(a) AS total_acts, count(CASE WHEN a.status='EXTERNAL' THEN 1 END) AS external, min(a.year) AS year_min, max(a.year) AS year_max")
        rels     = neo4j_query("MATCH ()-[r]->() RETURN type(r) AS rel_type, count(r) AS cnt ORDER BY cnt DESC")
        statuses = neo4j_query("MATCH (a:Act) WHERE a.status<>'EXTERNAL' RETURN a.status AS status, count(a) AS cnt ORDER BY cnt DESC LIMIT 10")
        return {"totals": totals[0] if totals else {}, "relations": rels, "statuses": statuses}
    except Exception as e:
        return {"totals": {}, "relations": [], "statuses": [], "error": str(e)}


@app.get("/api/keywords")
async def get_keywords():
    try:
        return neo4j_query("MATCH (a:Act) UNWIND a.keywords AS kw RETURN kw, count(*) AS cnt ORDER BY cnt DESC LIMIT 50")
    except Exception:
        return []


@app.get("/api/neighbors/{publisher}/{year}/{pos}")
async def get_neighbors(publisher: str, year: int, pos: int, depth: int = 1):
    aid, d = f"{publisher}/{year}/{pos}", min(depth, 3)
    origin = neo4j_query("MATCH (a:Act {id:$id}) RETURN a", {"id": aid})
    nodes  = neo4j_query(f"MATCH (a:Act {{id:$id}})-[*1..{d}]-(b:Act) RETURN DISTINCT b AS a LIMIT 100", {"id": aid})
    edges  = neo4j_query(
        f"MATCH (a:Act {{id:$id}})-[r*1..{d}]-(b:Act) UNWIND r AS rel "
        "RETURN startNode(rel).id AS from_id, endNode(rel).id AS to_id, rel AS r LIMIT 200", {"id": aid}
    )
    elements = (
        [fmt_node(r) for r in origin + nodes] +
        [{"data": {"id": f"{e['from_id']}__{e['to_id']}", "source": e["from_id"], "target": e["to_id"], "label": e["r"].type}} for e in edges]
    )
    return {"elements": elements}


# ════════════════════════════════════════════════════════════════
#  ETL — async logic
# ════════════════════════════════════════════════════════════════

def _matches(act: dict) -> bool:
    text = ((act.get("title") or "") + " " + " ".join(act.get("keywords") or [])).lower()
    return any(k in text for k in FILTER_KEYWORDS)

async def _api_get(client: httpx.AsyncClient, url: str):
    etl.api_calls += 1
    for attempt in range(4):
        try:
            resp = await client.get(url, timeout=30)
            await asyncio.sleep(REQ_DELAY)
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code == 429:
                etl.rate_limited += 1
                wait = 4 * (2 ** attempt)
                etl.add_log(f"⚠ Rate limit (429) — czekam {wait}s", "warn")
                await asyncio.sleep(wait)
                continue
            if resp.status_code == 404:
                return None
            etl.api_errors += 1
            return None
        except Exception as ex:
            etl.api_errors += 1
            etl.add_log(f"Błąd sieci: {ex}", "error")
            await asyncio.sleep(2)
    return None

async def _run_etl_async(years: list):
    etl.reset()
    etl.running = True
    etl.started_at = time.time()
    etl.years_total = len(years)
    etl.phase = "scanning"
    etl.add_log(f"🚀 ETL start — lata: {years[0]}–{years[-1]}", "success")
    etl._broadcast({"type": "start", **etl.snapshot()})

    matched = []

    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:

            # Faza 1: skanowanie
            etl.add_log("📋 Faza 1: Skanowanie list aktów…")
            for yr in years:
                etl.update(current_year=yr)
                data = await _api_get(client, f"{BASE_URL}/acts/{PUBLISHER}/{yr}")
                items = data.get("items", []) if isinstance(data, dict) else []
                yr_matched = 0
                for act in items:
                    etl.acts_scanned += 1
                    if _matches(act):
                        act_yr  = int(act.get("year") or str(yr))
                        act_pos = int(act.get("pos") or act.get("position") or 0)
                        matched.append({"year": act_yr, "pos": act_pos, "raw": act})
                        etl.acts_found += 1
                        yr_matched += 1
                etl.years_done += 1
                etl.update(acts_total=len(matched))
                etl.add_log(f"  ✓ {yr}: {len(items)} aktów → {yr_matched} pasuje", "success" if yr_matched else "info")

            etl.add_log(f"✅ Skanowanie gotowe — {len(matched)} aktów do importu", "success")

            # Faza 2: szczegóły i referencje
            etl.phase = "fetching"
            etl.acts_total = len(matched)
            etl.add_log("📥 Faza 2: Pobieranie szczegółów i referencji…")

            all_refs  = []
            saved_ids = set()

            for i, item in enumerate(matched, 1):
                yr, pos = item["year"], item["pos"]
                act_id  = f"{PUBLISHER}/{yr}/{pos}"
                etl.update(current_act=f"{act_id}  [{i}/{len(matched)}]")

                details = await _api_get(client, f"{BASE_URL}/acts/{PUBLISHER}/{yr}/{pos}")
                p = details or item["raw"]
                neo4j_run("""
                    MERGE (a:Act {id:$id})
                    SET a.publisher=$publisher,a.year=$year,a.pos=$pos,
                        a.title=$title,a.status=$status,a.type=$type,
                        a.keywords=$keywords,a.announced=$announced
                """, {
                    "id": act_id, "publisher": PUBLISHER, "year": yr, "pos": pos,
                    "title": p.get("title",""), "status": p.get("status","UNKNOWN"),
                    "type": p.get("type",""), "keywords": p.get("keywords") or [],
                    "announced": p.get("announcementDate"),
                })
                saved_ids.add(act_id)
                etl.acts_saved += 1

                refs_data = await _api_get(client, f"{BASE_URL}/acts/{PUBLISHER}/{yr}/{pos}/references")
                refs_list = refs_data if isinstance(refs_data, list) else (refs_data or {}).get("items", [])
                for ref in refs_list:
                    rtype = REF_TYPE_MAP.get((ref.get("type") or "").upper(), "REFERENCES")
                    rpub  = ref.get("publisher") or PUBLISHER
                    ryr   = ref.get("year")
                    rpos  = ref.get("pos") or ref.get("position")
                    if ryr and rpos:
                        all_refs.append((act_id, f"{rpub}/{ryr}/{rpos}", rtype))
                        etl.refs_total += 1

                if i % 10 == 0 or i == len(matched):
                    etl.add_log(f"  [{i}/{len(matched)}] zapisano {etl.acts_saved}, ref: {etl.refs_total}")

            # Faza 3: relacje
            etl.phase = "saving"
            etl.add_log(f"🔗 Faza 3: Zapisywanie {len(all_refs)} relacji…")

            for from_id, to_id, rtype in all_refs:
                if to_id not in saved_ids:
                    parts = to_id.split("/")
                    if len(parts) == 3:
                        neo4j_run("""
                            MERGE (a:Act {id:$id})
                            SET a.publisher=$pub,a.year=$yr,a.pos=$pos,
                                a.title=$title,a.status='EXTERNAL',
                                a.type='',a.keywords=[],a.announced=null
                        """, {
                            "id": to_id, "pub": parts[0],
                            "yr": int(parts[1]), "pos": int(parts[2]),
                            "title": f"[Zewnętrzny {to_id}]",
                        })
                        saved_ids.add(to_id)
                try:
                    neo4j_run(
                        f"MATCH (a:Act {{id:$f}}) MATCH (b:Act {{id:$t}}) MERGE (a)-[:{rtype}]->(b)",
                        {"f": from_id, "t": to_id}
                    )
                except Exception:
                    pass
                etl.refs_saved += 1

        etl.phase = "done"
        etl.finished_at = time.time()
        elapsed = int(etl.finished_at - etl.started_at)
        etl.add_log(
            f"🎉 Gotowe! {etl.acts_saved} aktów, {etl.refs_saved} relacji — "
            f"{elapsed//60}min {elapsed%60}s",
            "success"
        )

    except Exception as ex:
        etl.error = str(ex)
        etl.add_log(f"💥 Błąd: {ex}", "error")
    finally:
        etl.running = False
        etl._broadcast({"type": "done", **etl.snapshot()})


# ════════════════════════════════════════════════════════════════
#  ETL endpoints
# ════════════════════════════════════════════════════════════════

@app.post("/api/etl/run")
async def run_etl(background_tasks: BackgroundTasks, years: str = Query("2020-2026")):
    if etl.running:
        return {"status": "already_running", **etl.snapshot()}
    if "-" in years:
        a, b = years.split("-")
        year_list = list(range(int(a), int(b) + 1))
    else:
        year_list = [int(y) for y in years.split(",")]
    background_tasks.add_task(_run_etl_async, year_list)
    return {"status": "started", "years": year_list}


@app.get("/api/etl/status")
async def etl_status():
    return etl.snapshot()


@app.get("/api/etl/stream")
async def etl_stream():
    """Server-Sent Events — live stream postępu ETL."""
    queue = etl.subscribe()
    await queue.put({"type": "init", **etl.snapshot()})

    async def generator() -> AsyncGenerator[str, None]:
        try:
            while True:
                try:
                    data = await asyncio.wait_for(queue.get(), timeout=25.0)
                    yield f"data: {json.dumps(data, ensure_ascii=False)}\n\n"
                    if data.get("type") == "done":
                        break
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'type':'ping'})}\n\n"
        finally:
            etl.unsubscribe(queue)

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@app.get("/health")
async def health():
    try:
        rows = neo4j_query("MATCH (a:Act) RETURN count(a) AS cnt")
        return {"status": "ok", "neo4j": "connected", "acts": rows[0]["cnt"] if rows else 0}
    except Exception as e:
        return {"status": "ok", "neo4j": "error", "detail": str(e)}
