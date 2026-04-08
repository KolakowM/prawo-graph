"""
etl_sejm.py
-----------
Skrypt ETL: Pobiera akty prawne z API Sejmu RP (ELI),
filtruje po słowach kluczowych (przedsiębiorczość, ustawa wilczka itp.)
i zapisuje węzły + relacje do bazy Neo4j.

Użycie:
    python etl_sejm.py [--years 2020-2026] [--dry-run]
"""

import asyncio
import argparse
import logging
import os
import sys
import time
from dataclasses import dataclass, field
from typing import Optional

import httpx
from neo4j import GraphDatabase, exceptions as neo4j_exc
from dotenv import load_dotenv

load_dotenv()

# ─────────────────────────── konfiguracja ───────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("etl_sejm")

BASE_URL = "https://api.sejm.gov.pl/eli"
PUBLISHER = "WDU"

# Słowa kluczowe do filtrowania — tytuły i słowa kluczowe aktów
FILTER_KEYWORDS = [
    "przedsiębiorc",        # przedsiębiorca, przedsiębiorczość…
    "działalność gospodarcza",
    "swoboda działalności",
    "wolność gospodarcza",
    "prawo przedsiębiorców",
    "wilcz",                # ustawa wilczka (hist. nazwa)
    "rejestracja działalności",
    "jednoosobowa działalność",
    "spółka",
    "koncesja",
    "zezwolenie gospodarcze",
]

# Mapowanie typów referencji z API → nazwa relacji w Neo4j
REF_TYPE_MAP = {
    "CHANGES":   "CHANGES",
    "REPEALS":   "REPEALS",
    "EXECUTES":  "EXECUTES",
    "AMENDS":    "CHANGES",
    "IMPLEMENTS":"EXECUTES",
    "REPEALED_BY": "REPEALED_BY",
}

# Opóźnienie między żądaniami HTTP (sekundy) — chroni przed HTTP 429
REQUEST_DELAY = 0.35

NEO4J_URI  = os.getenv("NEO4J_URI",      "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER",     "neo4j")
NEO4J_PASS = os.getenv("NEO4J_PASSWORD", "sejm_password")


# ─────────────────────────── modele danych ──────────────────────────

@dataclass
class LegalAct:
    id: str                          # np. "WDU/2020/0001"
    publisher: str = PUBLISHER
    year: int = 0
    pos: int = 0
    title: str = ""
    status: str = "UNKNOWN"
    type_: str = ""
    keywords: list[str] = field(default_factory=list)
    announced: Optional[str] = None


@dataclass
class Reference:
    from_id: str
    to_id: str
    rel_type: str                    # CHANGES | REPEALS | EXECUTES…


# ─────────────────────────── klient HTTP ────────────────────────────

class SejmApiClient:
    def __init__(self, base_url: str = BASE_URL, delay: float = REQUEST_DELAY):
        self._base = base_url
        self._delay = delay
        self._client: Optional[httpx.AsyncClient] = None

    async def __aenter__(self):
        self._client = httpx.AsyncClient(timeout=30, follow_redirects=True)
        return self

    async def __aexit__(self, *_):
        if self._client:
            await self._client.aclose()

    async def _get(self, url: str) -> dict | list | None:
        """GET z automatycznym retry przy 429 i opóźnieniem."""
        for attempt in range(4):
            try:
                resp = await self._client.get(url)
                if resp.status_code == 200:
                    await asyncio.sleep(self._delay)
                    return resp.json()
                if resp.status_code == 429:
                    wait = 2 ** (attempt + 2)
                    log.warning("HTTP 429 — czekam %ss (próba %d)…", wait, attempt + 1)
                    await asyncio.sleep(wait)
                    continue
                if resp.status_code == 404:
                    return None
                log.warning("HTTP %d dla %s", resp.status_code, url)
                return None
            except httpx.RequestError as e:
                log.warning("Błąd sieciowy: %s — próba %d", e, attempt + 1)
                await asyncio.sleep(2)
        return None

    async def list_acts(self, year: int) -> list[dict]:
        url = f"{self._base}/acts/{PUBLISHER}/{year}"
        data = await self._get(url)
        return data.get("items", []) if isinstance(data, dict) else []

    async def act_details(self, year: int, pos: int) -> dict | None:
        url = f"{self._base}/acts/{PUBLISHER}/{year}/{pos}"
        return await self._get(url)

    async def act_references(self, year: int, pos: int) -> list[dict]:
        url = f"{self._base}/acts/{PUBLISHER}/{year}/{pos}/references"
        data = await self._get(url)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("items", [])
        return []


# ─────────────────────────── filtrowanie ────────────────────────────

def _matches(act: dict) -> bool:
    """Zwraca True jeśli akt pasuje do zakresu tematycznego."""
    title = (act.get("title") or "").lower()
    kws   = " ".join(act.get("keywords") or []).lower()
    text  = title + " " + kws
    return any(kw in text for kw in FILTER_KEYWORDS)


def _parse_act(raw: dict) -> LegalAct:
    year = int(raw.get("year", 0) or raw.get("announcementDate", "2000")[:4])
    pos  = int(raw.get("pos",  0) or raw.get("position", 0))
    return LegalAct(
        id        = f"{PUBLISHER}/{year}/{pos}",
        publisher = PUBLISHER,
        year      = year,
        pos       = pos,
        title     = raw.get("title", ""),
        status    = raw.get("status", "UNKNOWN"),
        type_     = raw.get("type", ""),
        keywords  = raw.get("keywords") or [],
        announced = raw.get("announcementDate"),
    )


def _parse_references(from_id: str, raw_list: list[dict]) -> list[Reference]:
    refs: list[Reference] = []
    for item in raw_list:
        ref_type_raw = (item.get("type") or item.get("refType") or "").upper()
        rel_type = REF_TYPE_MAP.get(ref_type_raw, ref_type_raw or "REFERENCES")

        # Buduj ID aktów docelowych z dostępnych pól
        publisher = item.get("publisher") or PUBLISHER
        year      = item.get("year")
        pos       = item.get("pos") or item.get("position")

        if year and pos:
            to_id = f"{publisher}/{year}/{pos}"
            refs.append(Reference(from_id=from_id, to_id=to_id, rel_type=rel_type))

    return refs


# ─────────────────────────── Neo4j ──────────────────────────────────

CYPHER_CREATE_ACT = """
MERGE (a:Act {id: $id})
SET
  a.publisher = $publisher,
  a.year       = $year,
  a.pos        = $pos,
  a.title      = $title,
  a.status     = $status,
  a.type       = $type_,
  a.keywords   = $keywords,
  a.announced  = $announced
"""

CYPHER_CREATE_REL = """
MATCH (a:Act {id: $from_id})
MATCH (b:Act {id: $to_id})
MERGE (a)-[r:`{rel_type}`]->(b)
"""

CYPHER_CREATE_INDEXES = [
    "CREATE INDEX act_id IF NOT EXISTS FOR (a:Act) ON (a.id)",
    "CREATE INDEX act_year IF NOT EXISTS FOR (a:Act) ON (a.year)",
    "CREATE INDEX act_status IF NOT EXISTS FOR (a:Act) ON (a.status)",
]


class Neo4jStore:
    def __init__(self, uri: str, user: str, password: str, dry_run: bool = False):
        self.dry_run = dry_run
        if not dry_run:
            self.driver = GraphDatabase.driver(uri, auth=(user, password))
            self._ensure_indexes()

    def _ensure_indexes(self):
        with self.driver.session() as s:
            for q in CYPHER_CREATE_INDEXES:
                try:
                    s.run(q)
                except Exception as e:
                    log.warning("Index: %s", e)

    def upsert_act(self, act: LegalAct):
        if self.dry_run:
            log.info("[dry-run] Act: %s | %s", act.id, act.title[:60])
            return
        with self.driver.session() as s:
            s.run(
                CYPHER_CREATE_ACT,
                id=act.id, publisher=act.publisher, year=act.year,
                pos=act.pos, title=act.title, status=act.status,
                type_=act.type_, keywords=act.keywords, announced=act.announced,
            )

    def upsert_relation(self, ref: Reference):
        if self.dry_run:
            log.info("[dry-run] Rel: %s -[%s]-> %s", ref.from_id, ref.rel_type, ref.to_id)
            return
        # Dynamiczna nazwa relacji wymaga interpolacji (bezpieczna — typy z mapy)
        cypher = f"""
            MATCH (a:Act {{id: $from_id}})
            MATCH (b:Act {{id: $to_id}})
            MERGE (a)-[r:{ref.rel_type}]->(b)
        """
        with self.driver.session() as s:
            try:
                s.run(cypher, from_id=ref.from_id, to_id=ref.to_id)
            except neo4j_exc.Neo4jError as e:
                log.warning("Błąd relacji: %s", e)

    def close(self):
        if not self.dry_run:
            self.driver.close()


# ─────────────────────────── główna logika ──────────────────────────

async def run_etl(years: list[int], dry_run: bool = False):
    store = Neo4jStore(NEO4J_URI, NEO4J_USER, NEO4J_PASS, dry_run=dry_run)
    matched_acts: list[LegalAct] = []
    all_refs: list[Reference]    = []

    async with SejmApiClient() as api:

        # ── Etap 1: Pobierz i odfiltruj akty ──────────────────────
        log.info("=== Etap 1: Pobieranie listy aktów (%s) ===", years)
        for year in years:
            log.info("  Rok %d…", year)
            raw_list = await api.list_acts(year)
            log.info("    Pobrano %d aktów", len(raw_list))

            for raw in raw_list:
                if _matches(raw):
                    act = _parse_act(raw)
                    matched_acts.append(act)

        log.info("Pasujących aktów: %d", len(matched_acts))

        # ── Etap 2: Szczegóły aktów + referencje ─────────────────
        log.info("=== Etap 2: Szczegóły i referencje ===")
        for i, act in enumerate(matched_acts, 1):
            log.info("  [%d/%d] %s", i, len(matched_acts), act.id)

            # Nadpisz szczegółami (mogą zawierać więcej pól)
            details = await api.act_details(act.year, act.pos)
            if details:
                detailed = _parse_act(details)
                detailed.id = act.id  # zachowaj oryginalny id
                act = detailed
                matched_acts[i - 1] = act

            store.upsert_act(act)

            # Referencje
            raw_refs = await api.act_references(act.year, act.pos)
            refs = _parse_references(act.id, raw_refs)
            all_refs.extend(refs)
            log.info("    %d referencji", len(refs))

        # ── Etap 3: Zapisz referencje (węzły docelowe mogą być poza zbiorem) ──
        log.info("=== Etap 3: Zapisywanie %d relacji ===", len(all_refs))

        # Upewnij się, że węzły docelowe istnieją (stub)
        existing_ids = {a.id for a in matched_acts}
        for ref in all_refs:
            if ref.to_id not in existing_ids:
                stub_parts = ref.to_id.split("/")
                if len(stub_parts) == 3:
                    pub, yr, pos = stub_parts
                    stub = LegalAct(
                        id=ref.to_id, publisher=pub,
                        year=int(yr), pos=int(pos),
                        title=f"[Akt zewnętrzny {ref.to_id}]",
                        status="EXTERNAL",
                    )
                    store.upsert_act(stub)
                    existing_ids.add(ref.to_id)

        for ref in all_refs:
            store.upsert_relation(ref)

    store.close()
    log.info("✓ ETL zakończony. Węzły: %d, Relacje: %d", len(matched_acts), len(all_refs))


# ─────────────────────────── entry point ────────────────────────────

def parse_args():
    p = argparse.ArgumentParser(description="ETL: Sejm ELI API → Neo4j")
    p.add_argument(
        "--years", default="2020-2026",
        help='Zakres lat np. "2020-2026" lub "2022,2023"'
    )
    p.add_argument("--dry-run", action="store_true", help="Nie zapisuj do Neo4j")
    return p.parse_args()


def expand_years(spec: str) -> list[int]:
    if "-" in spec:
        a, b = spec.split("-")
        return list(range(int(a), int(b) + 1))
    return [int(y) for y in spec.split(",")]


if __name__ == "__main__":
    args = parse_args()
    years = expand_years(args.years)
    log.info("Lata: %s | dry-run: %s", years, args.dry_run)
    asyncio.run(run_etl(years, dry_run=args.dry_run))
