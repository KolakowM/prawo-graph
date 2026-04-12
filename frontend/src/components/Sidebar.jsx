import "./Sidebar.css";

// ── Statusy ────────────────────────────────────────────────────
const STATUS_MAP = {
  "obowiązujący":    { cls: "green",  label: "Obowiązujący"   },
  "uchylony":        { cls: "red",    label: "Uchylony"       },
  "nieobowiązujący": { cls: "orange", label: "Nieobowiązujący"},
  "zmieniony":       { cls: "blue",   label: "Zmieniony"      },
  "EXTERNAL":        { cls: "gray",   label: "Zewnętrzny"     },
  "UNKNOWN":         { cls: "gray",   label: "Nieznany"       },
};

function getStatus(s) {
  const key = (s || "").toLowerCase();
  for (const [k, v] of Object.entries(STATUS_MAP))
    if (k.toLowerCase() === key) return v;
  return { cls: "gray", label: s || "—" };
}

// ── Opis typów relacji ──────────────────────────────────────────
const REL_INFO = {
  CHANGES:       { icon: "↔", color: "#3b82f6", label: "Zmienia",       desc: "Nowelizacja — akt modyfikuje treść innego aktu, nie uchylając go w całości." },
  CHANGED_BY:    { icon: "↔", color: "#3b82f6", label: "Zmieniony przez",desc: "Akt był zmieniony przez inny akt." },
  REPEALS:       { icon: "✕", color: "#ef4444", label: "Uchyla",         desc: "Akt trwale usuwa z systemu prawnego inny akt lub jego część." },
  REPEALED_BY:   { icon: "✕", color: "#ef4444", label: "Uchylony przez", desc: "Akt przestał obowiązywać na skutek wydania innego aktu." },
  EXECUTES:      { icon: "→", color: "#22c55e", label: "Wykonuje",       desc: "Akt wydany na podstawie upoważnienia zawartego w innym akcie (np. rozporządzenie wykonawcze do ustawy)." },
  INTRODUCED_BY: { icon: "→", color: "#22c55e", label: "Wprowadzony przez", desc: "Akt został wprowadzony w życie przez inny akt." },
  CONSOLIDATES:  { icon: "≡", color: "#8b5cf6", label: "Tekst jednolity", desc: "Akt jest ujednoliconą wersją innego aktu, uwzględniającą wszystkie zmiany." },
  REFERENCES:    { icon: "↗", color: "#64748b", label: "Odwołuje się",   desc: "Ogólne odesłanie do innego aktu bez konkretnego efektu prawnego." },
};

// ── Generowanie poprawnych linków ISAP ─────────────────────────
function buildIsapId(year, pos) {
  // Format: WDU + rok + pozycja uzupełniona zerami do 7 cyfr
  return `WDU${year}${String(pos).padStart(7, "0")}`;
}

function buildIsapUrl(year, pos) {
  return `https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=${buildIsapId(year, pos)}`;
}

function buildPdfUrl(year, pos) {
  const isapId = buildIsapId(year, pos);
  return `https://isap.sejm.gov.pl/isap.nsf/download.xsp/${isapId}/O/D${year}${pos}.pdf`;
}

function buildEliTextUrl(year, pos) {
  // ELI HTML — wydawca DU (nie WDU!)
  return `https://api.sejm.gov.pl/eli/acts/DU/${year}/${pos}/text.html`;
}

// ── Komponent główny ────────────────────────────────────────────
export default function Sidebar({ act, onReadAct }) {
  if (!act) return <SidebarEmpty />;

  const status  = getStatus(act.status);
  const hasLinks = act.year && act.pos && act.status !== "EXTERNAL";

  return (
    <div className="sidebar-content">
      <div className="sidebar-header">
        <span className="sidebar-tag">Akt prawny</span>
        <span className={`status-badge ${status.cls}`}>{status.label}</span>
      </div>

      <h2 className="act-title">{act.title || act.id}</h2>

      <div className="act-meta">
        <MetaRow label="ID"       value={act.id}        mono />
        <MetaRow label="Rok"      value={act.year}            />
        <MetaRow label="Pozycja"  value={act.pos}             />
        <MetaRow label="Typ"      value={act.type || "—"}     />
        <MetaRow label="Ogłoszony" value={act.announced || "—"} />
      </div>

      {act.keywords?.length > 0 && (
        <div className="act-section">
          <div className="section-label">Słowa kluczowe</div>
          <div className="keywords-list">
            {act.keywords.map((kw, i) => (
              <span key={i} className="keyword-tag">{kw}</span>
            ))}
          </div>
        </div>
      )}

      {/* Czytnik aktu — główny przycisk */}
      {hasLinks && onReadAct && (
        <button
          className="read-btn"
          onClick={() => onReadAct(act)}
        >
          📖 Czytaj tekst aktu
        </button>
      )}

      {/* Linki zewnętrzne */}
      {hasLinks && (
        <div className="act-section">
          <div className="section-label">Linki</div>
          <a
            href={buildIsapUrl(act.year, act.pos)}
            target="_blank" rel="noopener noreferrer"
            className="act-link"
          >
            ↗ ISAP Sejm (strona aktu)
          </a>
          <a
            href={buildPdfUrl(act.year, act.pos)}
            target="_blank" rel="noopener noreferrer"
            className="act-link"
          >
            ↓ Pobierz PDF
          </a>
          <a
            href={buildEliTextUrl(act.year, act.pos)}
            target="_blank" rel="noopener noreferrer"
            className="act-link"
          >
            ↗ Tekst HTML (ELI API)
          </a>
        </div>
      )}

      {/* Legenda relacji */}
      <div className="act-section">
        <div className="section-label">Typy powiązań w grafie</div>
        <div className="rel-legend">
          {Object.entries(REL_INFO).map(([key, r]) => (
            <div key={key} className="rel-item">
              <span className="rel-icon" style={{ color: r.color }}>{r.icon}</span>
              <div className="rel-text">
                <span className="rel-label" style={{ color: r.color }}>{r.label}</span>
                <span className="rel-desc">{r.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="sidebar-hint">
        Kliknij węzeł aby zobaczyć szczegóły. Kliknij tło aby odznaczyć.
      </div>
    </div>
  );
}

// ── Pusta strona ────────────────────────────────────────────────
function SidebarEmpty() {
  return (
    <div className="sidebar-empty">
      <div className="empty-icon">⬡</div>
      <p>Kliknij węzeł na grafie<br />aby wyświetlić szczegóły aktu prawnego.</p>
      <div className="empty-hints">
        <div className="hint-item">🖱 Scroll — powiększ / pomniejsz</div>
        <div className="hint-item">🖱 Drag — przesuń widok</div>
        <div className="hint-item">🖱 Klik węzła — szczegóły + 📖 czytaj</div>
        <div className="hint-item">🖱 Klik tła — odznacz</div>
      </div>
      <div className="rel-legend-empty">
        <div className="section-label" style={{marginBottom:"8px"}}>Typy powiązań</div>
        {Object.entries(REL_INFO).map(([key, r]) => (
          <div key={key} className="rel-item">
            <span className="rel-icon" style={{ color: r.color }}>{r.icon}</span>
            <div className="rel-text">
              <span className="rel-label" style={{ color: r.color }}>{r.label}</span>
              <span className="rel-desc">{r.desc}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MetaRow({ label, value, mono }) {
  return (
    <div className="meta-row">
      <span className="meta-label">{label}</span>
      <span className={`meta-value${mono ? " mono" : ""}`}>{value ?? "—"}</span>
    </div>
  );
}

export { buildIsapUrl, buildPdfUrl, buildEliTextUrl, buildIsapId };
