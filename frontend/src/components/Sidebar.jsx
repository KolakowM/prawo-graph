import "./Sidebar.css";

const STATUS_LABELS = {
  "obowiązujący":    { label: "Obowiązujący",   cls: "green"  },
  "uchylony":        { label: "Uchylony",        cls: "red"    },
  "nieobowiązujący": { label: "Nieobowiązujący", cls: "orange" },
  "zmieniony":       { label: "Zmieniony",       cls: "blue"   },
  "EXTERNAL":        { label: "Zewnętrzny",      cls: "gray"   },
  "UNKNOWN":         { label: "Nieznany",        cls: "gray"   },
};

function getStatus(status) {
  const key = (status || "").toLowerCase();
  for (const [k, v] of Object.entries(STATUS_LABELS)) {
    if (k.toLowerCase() === key) return v;
  }
  return { label: status || "—", cls: "gray" };
}

export default function Sidebar({ act }) {
  if (!act) return <SidebarEmpty />;

  const status = getStatus(act.status);
  const sejmUrl = act.year && act.pos
    ? `https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU${act.year}${String(act.pos).padStart(4, "0")}`
    : null;

  const eliUrl = act.year && act.pos
    ? `https://api.sejm.gov.pl/eli/acts/WDU/${act.year}/${act.pos}/text.html`
    : null;

  return (
    <div className="sidebar-content">
      <div className="sidebar-header">
        <span className="sidebar-tag">Akt prawny</span>
        <span className={`status-badge ${status.cls}`}>{status.label}</span>
      </div>

      <h2 className="act-title">{act.title || act.id}</h2>

      <div className="act-meta">
        <MetaRow label="Identyfikator" value={act.id} mono />
        <MetaRow label="Rok"           value={act.year} />
        <MetaRow label="Pozycja"       value={act.pos} />
        <MetaRow label="Typ"           value={act.type || "—"} />
        <MetaRow label="Ogłoszony"     value={act.announced || "—"} />
      </div>

      {act.keywords?.length > 0 && (
        <div className="act-keywords">
          <div className="section-label">Słowa kluczowe</div>
          <div className="keywords-list">
            {act.keywords.map((kw, i) => (
              <span key={i} className="keyword-tag">{kw}</span>
            ))}
          </div>
        </div>
      )}

      {(sejmUrl || eliUrl) && (
        <div className="act-links">
          <div className="section-label">Linki</div>
          {sejmUrl && (
            <a href={sejmUrl} target="_blank" rel="noopener noreferrer" className="act-link">
              ↗ ISAP Sejm
            </a>
          )}
          {eliUrl && (
            <a href={eliUrl} target="_blank" rel="noopener noreferrer" className="act-link">
              ↗ Tekst aktu (ELI)
            </a>
          )}
        </div>
      )}

      <div className="sidebar-hint">
        Kliknij inny węzeł aby zobaczyć jego szczegóły.
        Kliknij tło aby odznaczyć.
      </div>
    </div>
  );
}

function SidebarEmpty() {
  return (
    <div className="sidebar-empty">
      <div className="empty-icon">⬡</div>
      <p>Kliknij węzeł na grafie<br />aby wyświetlić szczegóły aktu prawnego.</p>
      <div className="empty-hints">
        <div className="hint-item">🖱 Scroll — powiększ / pomniejsz</div>
        <div className="hint-item">🖱 Drag — przesuń widok</div>
        <div className="hint-item">🖱 Klik węzła — szczegóły + sąsiedzi</div>
        <div className="hint-item">🖱 Klik tła — odznacz</div>
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
