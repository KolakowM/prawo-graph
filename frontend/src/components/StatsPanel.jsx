import { useState, useEffect } from "react";
import "./StatsPanel.css";

import { API_BASE } from "../api.js";

export default function StatsPanel() {
  const [stats, setStats] = useState(null);
  const [keywords, setKeywords] = useState([]);
  const [etl, setEtl] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [s, k, e] = await Promise.all([
          fetch(`${API_BASE}/stats`).then((r) => r.json()),
          fetch(`${API_BASE}/keywords`).then((r) => r.json()),
          fetch(`${API_BASE}/etl/status`).then((r) => r.json()),
        ]);
        setStats(s);
        setKeywords(k.slice(0, 20));
        setEtl(e);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const runEtl = async () => {
    await fetch(`${API_BASE}/etl/run?years=2020-2026`, { method: "POST" });
    setEtl({ running: true, last_log: "ETL uruchomiony…" });
  };

  if (loading) {
    return (
      <div className="stats-loading">
        <div className="spinner-sm" />
        Ładowanie statystyk…
      </div>
    );
  }

  const totals = stats?.totals || {};
  const relations = stats?.relations || [];
  const statuses = stats?.statuses || [];

  return (
    <div className="stats-panel">
      <div className="stats-section">
        <div className="stats-title">Baza danych</div>
        <div className="stats-cards">
          <StatCard value={totals.total_acts ?? "—"} label="Aktów prawnych" accent />
          <StatCard value={totals.external ?? "—"}   label="Akt. zewnętrznych" />
          <StatCard
            value={totals.year_min && totals.year_max
              ? `${totals.year_min} – ${totals.year_max}`
              : "—"}
            label="Zakres lat"
          />
        </div>
      </div>

      {relations.length > 0 && (
        <div className="stats-section">
          <div className="stats-title">Typy relacji</div>
          {relations.map((r) => (
            <BarRow key={r.rel_type} label={r.rel_type} value={r.cnt}
              max={relations[0].cnt} />
          ))}
        </div>
      )}

      {statuses.length > 0 && (
        <div className="stats-section">
          <div className="stats-title">Statusy aktów</div>
          {statuses.map((s) => (
            <BarRow key={s.status} label={s.status || "—"} value={s.cnt}
              max={statuses[0].cnt} colorClass="blue" />
          ))}
        </div>
      )}

      {keywords.length > 0 && (
        <div className="stats-section">
          <div className="stats-title">Najczęstsze słowa kluczowe</div>
          <div className="kw-cloud">
            {keywords.map((k) => (
              <span
                key={k.kw}
                className="kw-chip"
                style={{ fontSize: Math.max(10, Math.min(16, 10 + k.cnt / 3)) + "px" }}
              >
                {k.kw}
                <span className="kw-cnt">{k.cnt}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="stats-section etl-section">
        <div className="stats-title">Import danych (ETL)</div>
        <div className="etl-status">
          <span className={`etl-dot ${etl?.running ? "running" : "idle"}`} />
          <span>{etl?.running ? "Działa…" : "Bezczynny"}</span>
        </div>
        {etl?.last_log && (
          <pre className="etl-log">{etl.last_log}</pre>
        )}
        <button
          className={etl?.running ? "" : "active"}
          onClick={runEtl}
          disabled={etl?.running}
        >
          {etl?.running ? "⟳ ETL w toku…" : "▶ Uruchom ETL (2020–2026)"}
        </button>
        <p className="etl-note">
          ETL pobiera akty z API Sejmu, filtruje po słowach kluczowych
          (przedsiębiorczość, ustawa wilczka) i zapisuje do Neo4j.
          Pierwsze uruchomienie może potrwać kilka minut.
        </p>
      </div>
    </div>
  );
}

function StatCard({ value, label, accent }) {
  return (
    <div className={`stat-card ${accent ? "accent" : ""}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function BarRow({ label, value, max, colorClass = "amber" }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <div className="bar-track">
        <div
          className={`bar-fill ${colorClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="bar-value">{value}</span>
    </div>
  );
}
