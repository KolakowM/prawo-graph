import { useState, useEffect, useRef, useCallback } from "react";
import { API_BASE } from "../api.js";
import "./StatsPanel.css";

const PHASE_LABELS = {
  idle:     { label: "Bezczynny",           icon: "○", cls: "idle"    },
  scanning: { label: "Skanowanie list…",    icon: "⟳", cls: "running" },
  fetching: { label: "Pobieranie aktów…",   icon: "⟳", cls: "running" },
  saving:   { label: "Zapisywanie relacji…",icon: "⟳", cls: "running" },
  done:     { label: "Zakończony",          icon: "✓", cls: "done"    },
};

const LOG_COLORS = {
  info:    "#64748b",
  success: "#22c55e",
  warn:    "#f59e0b",
  error:   "#ef4444",
};

export default function StatsPanel() {
  const [dbStats, setDbStats]   = useState(null);
  const [etl, setEtl]           = useState(null);
  const [connecting, setConn]   = useState(false);
  const [years, setYears]       = useState("2020-2026");
  const logRef                  = useRef(null);
  const esRef                   = useRef(null);

  // Załaduj statystyki bazy
  const loadStats = useCallback(async () => {
    try {
      const s = await fetch(`${API_BASE}/stats`).then(r => r.json());
      setDbStats(s);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  // SSE — live stream ETL
  const connectSSE = useCallback(() => {
    if (esRef.current) { esRef.current.close(); }
    setConn(true);

    const apiUrl = API_BASE.startsWith("http")
      ? API_BASE
      : window.location.origin + API_BASE;

    const es = new EventSource(`${apiUrl}/etl/stream`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "ping") return;
        setEtl(data);
        if (data.type === "done") {
          setConn(false);
          loadStats();  // odśwież statystyki po zakończeniu
        }
      } catch { /* ignore */ }
    };

    es.onerror = () => {
      setConn(false);
      es.close();
    };

    return es;
  }, [loadStats]);

  // Połącz SSE przy montowaniu (żeby zobaczyć aktualny stan)
  useEffect(() => {
    const es = connectSSE();
    return () => es.close();
  }, [connectSSE]);

  // Auto-scroll logu
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [etl?.log]);

  const startEtl = async () => {
    await fetch(`${API_BASE}/etl/run?years=${years}`, { method: "POST" });
    connectSSE();
  };

  const phase = PHASE_LABELS[etl?.phase] || PHASE_LABELS.idle;
  const isRunning = etl?.running;
  const totals = dbStats?.totals || {};

  return (
    <div className="stats-panel">

      {/* ── Baza danych ───────────────────────────── */}
      <section className="sp-section">
        <div className="sp-title">📊 Stan bazy Neo4j</div>
        <div className="sp-cards">
          <StatCard
            value={totals.total_acts ?? "—"}
            label="Aktów prawnych"
            accent={!!totals.total_acts}
          />
          <StatCard value={totals.external ?? "—"} label="Zewnętrznych" />
          <StatCard
            value={totals.year_min && totals.year_max
              ? `${totals.year_min}–${totals.year_max}` : "—"}
            label="Zakres lat"
          />
          <StatCard
            value={(dbStats?.relations || []).reduce((s, r) => s + r.cnt, 0) || "—"}
            label="Relacji"
          />
        </div>

        {(dbStats?.relations || []).length > 0 && (
          <div className="sp-bars">
            <div className="sp-sub">Typy relacji</div>
            {dbStats.relations.map(r => (
              <BarRow key={r.rel_type} label={r.rel_type} value={r.cnt}
                max={dbStats.relations[0].cnt} color="var(--blue)" />
            ))}
          </div>
        )}

        {(dbStats?.statuses || []).length > 0 && (
          <div className="sp-bars">
            <div className="sp-sub">Statusy</div>
            {dbStats.statuses.map(s => (
              <BarRow key={s.status} label={s.status || "—"} value={s.cnt}
                max={dbStats.statuses[0].cnt} color="var(--green)" />
            ))}
          </div>
        )}

        <button className="sp-refresh-btn" onClick={loadStats}>⟳ Odśwież statystyki</button>
      </section>

      {/* ── ETL Dashboard ─────────────────────────── */}
      <section className="sp-section etl-section">
        <div className="sp-title">⚙️ Import danych (ETL)</div>

        {/* Status header */}
        <div className="etl-header">
          <span className={`etl-phase-dot ${phase.cls}`}>{phase.icon}</span>
          <span className="etl-phase-label">{phase.label}</span>
          {etl?.elapsed_s > 0 && (
            <span className="etl-elapsed">
              {Math.floor(etl.elapsed_s / 60)}m {etl.elapsed_s % 60}s
            </span>
          )}
          {connecting && !isRunning && (
            <span className="etl-connecting">łączenie…</span>
          )}
        </div>

        {/* Siatka metryk */}
        {etl && etl.phase !== "idle" && (
          <div className="etl-metrics">
            <Metric icon="📅" label="Lata" value={`${etl.years_done}/${etl.years_total}`} sub={`${etl.years_pct}%`} />
            <Metric icon="🔍" label="Przeskanowano" value={etl.acts_scanned} sub="aktów" />
            <Metric icon="🎯" label="Pasuje" value={etl.acts_found} sub="filtr" />
            <Metric icon="💾" label="Zapisano" value={etl.acts_saved} sub={`z ${etl.acts_total}`} accent />
            <Metric icon="🔗" label="Relacje" value={etl.refs_saved} sub={`z ${etl.refs_total}`} />
            <Metric icon="📡" label="Żądań API" value={etl.api_calls} sub={etl.api_errors ? `${etl.api_errors} błędów` : "OK"} err={etl.api_errors > 0} />
            {etl.rate_limited > 0 && (
              <Metric icon="⚠" label="Rate limit" value={etl.rate_limited} sub="razy" err />
            )}
          </div>
        )}

        {/* Paski postępu */}
        {etl && etl.phase !== "idle" && (
          <div className="etl-progress-bars">
            <ProgressBar
              label={`Lata: ${etl.years_done}/${etl.years_total}`}
              pct={etl.years_pct}
              color="var(--accent)"
              sub={etl.current_year ? `Aktualnie: ${etl.current_year}` : ""}
            />
            {etl.acts_total > 0 && (
              <ProgressBar
                label={`Akty: ${etl.acts_saved}/${etl.acts_total}`}
                pct={etl.acts_pct}
                color="var(--blue)"
                sub={etl.current_act ? etl.current_act : ""}
              />
            )}
            {etl.refs_total > 0 && (
              <ProgressBar
                label={`Relacje: ${etl.refs_saved}/${etl.refs_total}`}
                pct={etl.refs_total > 0 ? Math.round(etl.refs_saved / etl.refs_total * 100) : 0}
                color="var(--green)"
              />
            )}
          </div>
        )}

        {/* Błąd */}
        {etl?.error && (
          <div className="etl-error">💥 {etl.error}</div>
        )}

        {/* Log */}
        {(etl?.log || []).length > 0 && (
          <div className="etl-log-wrap">
            <div className="sp-sub">Live log</div>
            <div className="etl-log" ref={logRef}>
              {etl.log.map((entry, i) => (
                <div key={i} className="log-line">
                  <span className="log-ts">{entry.ts}</span>
                  <span className="log-msg" style={{ color: LOG_COLORS[entry.level] || LOG_COLORS.info }}>
                    {entry.msg}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Kontrolki */}
        <div className="etl-controls">
          <div className="etl-year-row">
            <label className="etl-year-label">Lata:</label>
            <input
              value={years}
              onChange={e => setYears(e.target.value)}
              placeholder="np. 2020-2026 lub 2023,2024"
              disabled={isRunning}
            />
          </div>
          <button
            className={`etl-run-btn ${isRunning ? "running" : ""}`}
            onClick={startEtl}
            disabled={isRunning}
          >
            {isRunning ? "⟳ ETL w toku…" : "▶ Uruchom ETL"}
          </button>
        </div>

        <p className="etl-note">
          ETL pobiera akty z API Sejmu RP (WDU), filtruje po słowach kluczowych
          (przedsiębiorczość, ustawa wilczka) i zapisuje do Neo4j.
          Import 7 lat danych trwa ok. <strong>10–15 minut</strong>.
          Możesz obserwować postęp na żywo powyżej.
        </p>
      </section>

    </div>
  );
}

// ── Sub-komponenty ──────────────────────────────────────────────

function StatCard({ value, label, accent }) {
  return (
    <div className={`sp-card ${accent ? "accent" : ""}`}>
      <div className="sp-card-value">{value}</div>
      <div className="sp-card-label">{label}</div>
    </div>
  );
}

function BarRow({ label, value, max, color }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="bar-value">{value}</span>
    </div>
  );
}

function ProgressBar({ label, pct, color, sub }) {
  return (
    <div className="prog-wrap">
      <div className="prog-header">
        <span>{label}</span>
        <span>{pct}%</span>
      </div>
      <div className="prog-track">
        <div
          className="prog-fill"
          style={{ width: `${pct}%`, background: color,
            transition: "width 0.4s ease" }}
        />
      </div>
      {sub && <div className="prog-sub">{sub}</div>}
    </div>
  );
}

function Metric({ icon, label, value, sub, accent, err }) {
  return (
    <div className={`metric ${accent ? "accent" : ""} ${err ? "err" : ""}`}>
      <div className="metric-icon">{icon}</div>
      <div className="metric-value">{value ?? "—"}</div>
      <div className="metric-label">{label}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}
