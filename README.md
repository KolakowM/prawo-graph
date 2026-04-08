# PRAWO.GRAPH — Grafowe Powiązania Aktów Prawnych

Aplikacja wizualizuje powiązania między polskimi aktami prawnymi (Dziennik Ustaw RP) przy użyciu bazy grafowej Neo4j, backendu FastAPI i frontendu React + Cytoscape.js.

```
┌─────────────────────────────────────────────────────────┐
│  API Sejmu ELI  ──ETL──►  Neo4j  ◄──►  FastAPI  ◄──►  React  │
│  api.sejm.gov.pl          (graf)       :8000          :3000   │
└─────────────────────────────────────────────────────────┘
```

## Wymagania

| Narzędzie | Wersja |
|-----------|--------|
| Docker    | ≥ 24   |
| Docker Compose | ≥ 2.20 |
| Python    | 3.11+  |
| Node.js   | 20+    |

## Struktura projektu

```
sejm-graph/
├── docker-compose.yml       # Neo4j + Backend + Frontend
├── README.md
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── etl_sejm.py          # Skrypt ETL: API Sejmu → Neo4j
│   └── main.py              # FastAPI: /api/graph, /api/stats…
└── frontend/
    ├── Dockerfile
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── App.css
        ├── index.css
        └── components/
            ├── Header.jsx / Header.css
            ├── LawGraph.jsx / LawGraph.css   ← główna wizualizacja
            ├── Sidebar.jsx / Sidebar.css     ← panel szczegółów
            └── StatsPanel.jsx / StatsPanel.css
```

---

## Uruchomienie (Docker Compose — najprostsze)

### 1. Sklonuj / rozpakuj projekt

```bash
cd sejm-graph
```

### 2. Uruchom wszystkie usługi

```bash
docker compose up --build -d
```

Pierwsze uruchomienie pobierze obrazy Docker (~800 MB). Poczekaj ok. 1–2 minut.

### 3. Sprawdź, czy wszystko działa

```bash
docker compose ps
# Oczekiwany status: "running" dla neo4j, backend, frontend
```

Otwórz przeglądarki:
- **Frontend:** http://localhost:3000
- **Backend API docs:** http://localhost:8000/docs
- **Neo4j Browser:** http://localhost:7474 (login: `neo4j` / `sejm_password`)

### 4. Uruchom import danych (ETL)

Kliknij przycisk **„Statystyki"** w aplikacji, a następnie **„▶ Uruchom ETL"** — lub wywołaj ręcznie:

```bash
curl -X POST "http://localhost:8000/api/etl/run?years=2020-2026"
```

Postęp możesz śledzić w panelu Statystyki lub przez:
```bash
curl http://localhost:8000/api/etl/status
```

ETL pobiera akty z lat 2020–2026, filtruje po tematyce przedsiębiorczości i importuje do Neo4j. Czas: **3–10 minut** (zależy od szybkości API Sejmu).

---

## Uruchomienie lokalne (bez Docker)

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Zmienne środowiskowe (lub edytuj poniżej)
export NEO4J_URI=bolt://localhost:7687
export NEO4J_USER=neo4j
export NEO4J_PASSWORD=sejm_password

# Uruchom serwer
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev     # http://localhost:3000
```

### Neo4j (lokalny Docker)

```bash
docker run -d \
  --name neo4j_local \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/sejm_password \
  neo4j:5.18-community
```

### Skrypt ETL (manualnie)

```bash
cd backend
python etl_sejm.py --years 2020-2026
# Opcje:
#   --years 2023-2024   (tylko wybrane lata)
#   --dry-run           (bez zapisu do Neo4j)
```

---

## API Reference

| Endpoint | Metoda | Opis |
|----------|--------|------|
| `/api/graph` | GET | Graf (Cytoscape.js) — params: `year`, `status`, `keyword`, `limit` |
| `/api/act/{pub}/{year}/{pos}` | GET | Szczegóły aktu |
| `/api/stats` | GET | Statystyki bazy |
| `/api/keywords` | GET | Najczęstsze słowa kluczowe |
| `/api/neighbors/{pub}/{year}/{pos}` | GET | Sąsiedzi węzła (param: `depth`) |
| `/api/etl/run` | POST | Uruchom ETL w tle (param: `years`) |
| `/api/etl/status` | GET | Status ETL |
| `/health` | GET | Health check |

---

## Model danych w Neo4j

### Węzły `:Act`

| Właściwość | Typ | Opis |
|------------|-----|------|
| `id` | String | `WDU/2023/0042` |
| `title` | String | Pełny tytuł aktu |
| `year` | Integer | Rok wydania |
| `pos` | Integer | Pozycja w Dz.U. |
| `status` | String | obowiązujący / uchylony / … |
| `type` | String | Typ aktu (ustawa, rozporządzenie, …) |
| `keywords` | String[] | Słowa kluczowe |
| `announced` | String | Data ogłoszenia |

### Krawędzie

| Typ | Znaczenie |
|-----|-----------|
| `CHANGES` | Akt A zmienia akt B |
| `REPEALS` | Akt A uchyla akt B |
| `REPEALED_BY` | Akt A jest uchylony przez B |
| `EXECUTES` | Akt A wykonuje / implementuje B |

### Przykładowe zapytania Cypher

```cypher
// Wszystkie akty z 2023 roku
MATCH (a:Act {year: 2023}) RETURN a LIMIT 25;

// Akty, które coś uchylają
MATCH (a:Act)-[:REPEALS]->(b:Act) RETURN a, b LIMIT 20;

// Najbardziej połączony akt (hub)
MATCH (a:Act)-[r]-()
RETURN a.id, a.title, count(r) AS degree
ORDER BY degree DESC LIMIT 10;

// Ścieżka między dwoma aktami
MATCH path = shortestPath(
  (a:Act {id: 'WDU/2020/1422'})-[*]-(b:Act {id: 'WDU/2018/0646'})
)
RETURN path;
```

---

## Filtrowanie i słowa kluczowe

Skrypt ETL filtruje akty zawierające w tytule lub słowach kluczowych:

- `przedsiębiorc*` — przedsiębiorca, przedsiębiorczość
- `działalność gospodarcza`
- `swoboda działalności`
- `prawo przedsiębiorców`
- `wilcz*` — historyczna „ustawa wilczka"
- `spółka`, `koncesja`, `zezwolenie gospodarcze`
- …i inne (pełna lista w `etl_sejm.py` → `FILTER_KEYWORDS`)

---

## Rozwiązywanie problemów

### Backend nie łączy się z Neo4j
```bash
docker compose logs neo4j      # sprawdź logi
docker compose restart backend  # poczekaj na Neo4j health check
```

### HTTP 429 od API Sejmu
ETL automatycznie obsługuje rate-limiting z wykładniczym backoff. Jeśli problem się powtarza, zwiększ `REQUEST_DELAY` w `etl_sejm.py` (domyślnie 0.35 s).

### Graf jest pusty po ETL
```bash
curl http://localhost:8000/api/stats   # sprawdź liczby w bazie
docker compose logs backend            # sprawdź błędy ETL
```

### Resetowanie danych
```bash
docker compose down -v   # usuwa wolumeny Neo4j
docker compose up -d
```

---

## Licencja i źródła danych

Dane aktów prawnych pobierane są z publicznego API Sejmu RP (ELI):
- https://api.sejm.gov.pl/eli
- https://eli.gov.pl
- https://isap.sejm.gov.pl

Dane są dostępne na licencji otwartych danych — [Warunki korzystania z danych Sejmu RP](https://www.sejm.gov.pl/Sejm10.nsf/page.xsp?id=warunki_korzystania).
