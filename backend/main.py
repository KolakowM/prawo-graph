"""
main.py — FastAPI backend
Wystawia REST API dla frontendu React:
  GET /api/graph           → pełny graf (format Cytoscape.js)
  GET /api/graph/search    → filtrowanie węzłów
  GET /api/act/{id}        → szczegóły jednego aktu
  GET /api/stats           → statystyki bazy
  POST /api/etl/run        → uruchomienie ETL w tle
"""

import asyncio
import os
import subprocess
import sys
from typing import Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
from neo4j import GraphDatabase
from dotenv import load_dotenv

load_dotenv()

# ── konfiguracja ──────────────────────────────────────────────────

NEO4J_URI  = os.getenv("NEO4J_URI",      "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER",     "neo4j")
NEO4J_PASS = os.getenv("NEO4J_PASSWORD", "sejm_password")

app = FastAPI(
    title="Sejm ELI Graph API",
    description="Wizualizacja powiązań aktów prawnych — Dziennik Ustaw RP",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── baza danych ───────────────────────────────────────────────────

def get_driver():
    return GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASS))


def neo4j_query(cypher: str, params: dict = None) -> list[dict]:
    driver = get_driver()
    try:
        with driver.session() as session:
            result = session.run(cypher, params or {})
            return [dict(record) for record in result]
    finally:
        driver.close()


# ── pomocnicze funkcje formatowania ──────────────────────────────

STATUS_COLOR = {
    "obowiązujący":  "#22c55e",   # zielony
    "UNKNOWN":       "#94a3b8",   # szary
    "EXTERNAL":      "#64748b",   # ciemny szary
    "uchylony":      "#ef4444",   # czerwony
    "nieobowiązujący":"#f97316",  # pomarańczowy
    "zmieniony":     "#3b82f6",   # niebieski
}


def status_color(status: str) -> str:
    for key, color in STATUS_COLOR.items():
        if key.lower() in (status or "").lower():
            return color
    return "#94a3b8"


def format_node(row: dict) -> dict:
    node = row["a"]
    props = dict(node)
    node_id = props.get("id", "")
    return {
        "data": {
            "id":        node_id,
            "label":     props.get("title", node_id)[:60],
            "title":     props.get("title", ""),
            "year":      props.get("year"),
            "pos":       props.get("pos"),
            "status":    props.get("status", "UNKNOWN"),
            "type":      props.get("type", ""),
            "keywords":  props.get("keywords", []),
            "announced": props.get("announced"),
            "color":     status_color(props.get("status", "")),
        }
    }


def format_edge(row: dict) -> dict:
    rel = row["r"]
    return {
        "data": {
            "id":     f"{row['from_id']}__{row['to_id']}__{rel.type}",
            "source": row["from_id"],
            "target": row["to_id"],
            "label":  rel.type,
        }
    }


# ── endpointy ────────────────────────────────────────────────────

@app.get("/api/graph")
async def get_graph(
    year: Optional[int] = Query(None, description="Filtruj po roku"),
    status: Optional[str] = Query(None, description="Filtruj po statusie"),
    keyword: Optional[str] = Query(None, description="Słowo kluczowe w tytule"),
    limit: int = Query(500, ge=1, le=2000),
):
    """Zwraca cały graf (węzły + krawędzie) w formacie Cytoscape.js."""

    # ── węzły ──
    where_clauses = []
    params: dict = {"limit": limit}

    if year:
        where_clauses.append("a.year = $year")
        params["year"] = year
    if status:
        where_clauses.append("toLower(a.status) CONTAINS toLower($status)")
        params["status"] = status
    if keyword:
        where_clauses.append("toLower(a.title) CONTAINS toLower($keyword)")
        params["keyword"] = keyword

    where_str = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    nodes_q = f"""
        MATCH (a:Act)
        {where_str}
        RETURN a
        LIMIT $limit
    """
    node_rows = neo4j_query(nodes_q, params)
    node_ids  = {dict(r["a"])["id"] for r in node_rows}

    # ── krawędzie między węzłami ze zbioru ──
    edges_q = """
        MATCH (a:Act)-[r]->(b:Act)
        WHERE a.id IN $ids AND b.id IN $ids
        RETURN a.id AS from_id, b.id AS to_id, r
        LIMIT 2000
    """
    edge_rows = neo4j_query(edges_q, {"ids": list(node_ids)})

    elements = (
        [format_node(r) for r in node_rows]
        + [format_edge(r) for r in edge_rows]
    )

    return {"elements": elements}


@app.get("/api/act/{publisher}/{year}/{pos}")
async def get_act(publisher: str, year: int, pos: int):
    """Szczegóły konkretnego aktu prawnego."""
    act_id = f"{publisher}/{year}/{pos}"
    rows = neo4j_query(
        "MATCH (a:Act {id: $id}) RETURN a", {"id": act_id}
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Akt nie znaleziony")
    return dict(rows[0]["a"])


@app.get("/api/stats")
async def get_stats():
    """Statystyki bazy danych."""
    counts = neo4j_query("""
        MATCH (a:Act)
        RETURN
          count(a) AS total_acts,
          count(CASE WHEN a.status = 'EXTERNAL' THEN 1 END) AS external,
          min(a.year) AS year_min,
          max(a.year) AS year_max
    """)

    rels = neo4j_query("""
        MATCH ()-[r]->()
        RETURN type(r) AS rel_type, count(r) AS cnt
        ORDER BY cnt DESC
    """)

    statuses = neo4j_query("""
        MATCH (a:Act)
        WHERE a.status <> 'EXTERNAL'
        RETURN a.status AS status, count(a) AS cnt
        ORDER BY cnt DESC
        LIMIT 10
    """)

    return {
        "totals":   counts[0] if counts else {},
        "relations": rels,
        "statuses":  statuses,
    }


@app.get("/api/keywords")
async def get_keywords():
    """Lista unikalnych słów kluczowych z bazy."""
    rows = neo4j_query("""
        MATCH (a:Act)
        UNWIND a.keywords AS kw
        RETURN kw, count(*) AS cnt
        ORDER BY cnt DESC
        LIMIT 50
    """)
    return rows


@app.get("/api/neighbors/{publisher}/{year}/{pos}")
async def get_neighbors(publisher: str, year: int, pos: int, depth: int = 1):
    """Pobierz sąsiadów aktu do zadanej głębokości."""
    act_id = f"{publisher}/{year}/{pos}"
    rows = neo4j_query(
        f"""
        MATCH path = (a:Act {{id: $id}})-[*1..{min(depth, 3)}]-(b:Act)
        WITH collect(DISTINCT a) + collect(DISTINCT b) AS nodes,
             relationships(path) AS rels
        UNWIND nodes AS n
        RETURN DISTINCT n AS a
        LIMIT 100
        """,
        {"id": act_id},
    )
    edge_rows = neo4j_query(
        """
        MATCH (a:Act {id: $id})-[r*1..2]-(b:Act)
        WITH a, r, b
        UNWIND r AS rel
        RETURN startNode(rel).id AS from_id, endNode(rel).id AS to_id, rel AS r
        LIMIT 200
        """,
        {"id": act_id},
    )

    elements = (
        [format_node(r) for r in rows]
        + [{"data": {
               "id":     f"{er['from_id']}__{er['to_id']}",
               "source": er["from_id"],
               "target": er["to_id"],
               "label":  er["r"].type,
           }} for er in edge_rows]
    )
    return {"elements": elements}


_etl_status = {"running": False, "last_log": "Nie uruchomiono ETL"}


def _run_etl_subprocess(years: str):
    global _etl_status
    _etl_status["running"] = True
    _etl_status["last_log"] = f"ETL uruchomiony dla lat: {years}"
    try:
        result = subprocess.run(
            [sys.executable, "etl_sejm.py", "--years", years],
            capture_output=True, text=True, timeout=1800,
        )
        _etl_status["last_log"] = result.stdout[-2000:] or result.stderr[-2000:]
    except subprocess.TimeoutExpired:
        _etl_status["last_log"] = "ETL timeout (30 min)"
    except Exception as e:
        _etl_status["last_log"] = str(e)
    finally:
        _etl_status["running"] = False


@app.post("/api/etl/run")
async def run_etl(
    background_tasks: BackgroundTasks,
    years: str = Query("2020-2026"),
):
    """Uruchom ETL w tle."""
    if _etl_status["running"]:
        return {"status": "already_running"}
    background_tasks.add_task(_run_etl_subprocess, years)
    return {"status": "started", "years": years}


@app.get("/api/etl/status")
async def etl_status():
    return _etl_status


@app.get("/health")
async def health():
    return {"status": "ok"}
