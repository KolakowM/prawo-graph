import "./Header.css";

const STATUSES = ["", "obowiązujący", "uchylony", "nieobowiązujący", "zmieniony"];
const YEARS    = ["", ...Array.from({ length: 7 }, (_, i) => String(2020 + i))];

export default function Header({ filters, onFiltersChange, onToggleStats, showStats }) {
  const set = (key) => (e) =>
    onFiltersChange((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <header className="header">
      <div className="header-brand">
        <span className="brand-bracket">[</span>
        <span className="brand-title">PRAWO.GRAPH</span>
        <span className="brand-bracket">]</span>
        <span className="brand-sub">Dziennik Ustaw RP — Powiązania aktów prawnych</span>
      </div>

      <div className="header-filters">
        <select value={filters.year} onChange={set("year")}>
          {YEARS.map((y) => (
            <option key={y} value={y}>{y || "Wszystkie lata"}</option>
          ))}
        </select>

        <select value={filters.status} onChange={set("status")}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s || "Wszystkie statusy"}</option>
          ))}
        </select>

        <input
          placeholder="Szukaj w tytule…"
          value={filters.keyword}
          onChange={set("keyword")}
          style={{ width: 200 }}
        />
      </div>

      <div className="header-actions">
        <button
          className={showStats ? "active" : ""}
          onClick={onToggleStats}
        >
          {showStats ? "← Graf" : "Statystyki"}
        </button>
      </div>
    </header>
  );
}
