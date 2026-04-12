/**
 * ActTextViewer.jsx
 * Czytnik tekstu aktu prawnego z klikalnymi odesłaniami.
 * Pobiera HTML z API ELI, parsuje wzorce "Dz. U. z YYYY r. poz. NNNN"
 * i zamienia je na klikalne linki do powiązanych aktów.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import "./ActTextViewer.css";
import NavMap from "./NavMap.jsx";

const ELI_BASE = "https://api.sejm.gov.pl/eli/acts/DU";

// ── Parser odesłań do Dziennika Ustaw ──────────────────────────
// Wzorzec: "Dz. U. z 2019 r. poz. 2407" lub "(Dz. U. z 2021 r. poz. 1162, 1981 i 2270)"
// Obsługuje: wiele pozycji po jednym roku, wiele lat w jednym nawiasie
const DZ_U_RE = /Dz\.\s*U\.\s*(?:z\s+)?(\d{4})\s*r\.\s*poz\.\s*([\d,\s]+?(?:\si\s\d+)?(?:\soraz\sz\s+\d{4}\s*r\.\s*poz\.\s*[\d,\s]+?(?:\si\s\d+)?)*)/g;

// Przetwarza ciąg "1162, 1981 i 2270" → [1162, 1981, 2270]
function parsePozList(str) {
  return str
    .replace(/\si\s/g, ",")
    .replace(/\soraz\s.*/g, "") // ucinamy "oraz z YYYY r. poz." — będzie osobno
    .split(",")
    .map(s => parseInt(s.trim(), 10))
    .filter(n => n > 0 && n < 100000);
}

// Zwraca tablicę { year, pos } ze złożonego odwołania
export function parseReference(dzuText) {
  const refs = [];
  // "z 2019 r. poz. 2407 oraz z 2021 r. poz. 1162, 1981 i 2270"
  const yearPozRe = /(?:z\s+)?(\d{4})\s*r\.\s*poz\.\s*([\d,\s]+?(?:\si\s\d+)?)/g;
  let m;
  while ((m = yearPozRe.exec(dzuText)) !== null) {
    const year = parseInt(m[1], 10);
    parsePozList(m[2]).forEach(pos => refs.push({ year, pos }));
  }
  return refs;
}

// Wstrzyknięcie klikanych spanów w tekst HTML
function injectClickableRefs(html, onRef) {
  // Pracujemy na tekście — nie możemy modyfikować HTML za pomocą DOMParser tutaj
  // Wstrzykujemy znaczniki przed/po wzorcach
  return html.replace(DZ_U_RE, (match, year, pozStr) => {
    const positions = parsePozList(pozStr);
    if (positions.length === 0) return match;

    // Każda pozycja staje się osobnym linkiem
    const linki = positions.map(pos =>
      `<span class="ref-link" data-year="${year}" data-pos="${pos}" title="Otwórz akt: Dz. U. z ${year} r. poz. ${pos}">` +
      `Dz. U. z ${year} r. poz. ${pos}</span>`
    );

    // Jeśli wiele pozycji w tym samym roku — pokaż je oddzielnie
    if (positions.length === 1) return linki[0];
    return `(Dz. U. z ${year} r. poz. ${linki.join(", poz. ").replace(/<span[^>]*>Dz\. U\. z \d+ r\. poz\. /g, "<span class=\"ref-link\" data-year=\"" + year + "\" data-pos=\"").replace(/<\/span>/g, " </span>")})`;
  });
}

// ── Komponent czytnika ──────────────────────────────────────────
export default function ActTextViewer({ act, onClose, onNavigate }) {
  const [html, setHtml]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [history, setHistory] = useState([act]);
  const [histIdx, setHistIdx] = useState(0);
  const contentRef            = useRef(null);

  const currentAct = history[histIdx];

  const loadText = useCallback(async (a) => {
    setLoading(true);
    setError(null);
    setHtml(null);
    try {
      const url = `${ELI_BASE}/${a.year}/${a.pos}/text.html`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} — tekst niedostępny`);
      let text = await res.text();

      // Wyciągnij samo <body> jeśli jest pełny dokument
      const bodyMatch = text.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      if (bodyMatch) text = bodyMatch[1];

      // Wstrzyknij klikalne odesłania
      text = text.replace(DZ_U_RE, (match, year, pozStr) => {
        const positions = parsePozList(pozStr);
        if (positions.length === 0) return match;
        return positions.map(pos =>
          `<span class="ref-link" data-year="${year}" data-pos="${pos}" title="Pokaż akt: Dz. U. z ${year} r. poz. ${pos}">${match}</span>`
        ).join("");
      });

      setHtml(text);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadText(currentAct); }, [currentAct, loadText]);

  // Obsługa kliknięć w odesłania
  useEffect(() => {
    const container = contentRef.current;
    if (!container || !html) return;

    const handler = (e) => {
      const span = e.target.closest(".ref-link");
      if (!span) return;
      const year = parseInt(span.dataset.year, 10);
      const pos  = parseInt(span.dataset.pos,  10);
      if (!year || !pos) return;
      e.preventDefault();
      e.stopPropagation();

      const newAct = {
        id:    `DU/${year}/${pos}`,
        year,
        pos,
        title: `Dz. U. z ${year} r. poz. ${pos}`,
        status: "UNKNOWN",
      };

      // Dodaj do historii nawigacji
      setHistory(h => {
        const trimmed = h.slice(0, histIdx + 1);
        return [...trimmed, newAct];
      });
      setHistIdx(i => i + 1);
      if (onNavigate) onNavigate(newAct);
    };

    container.addEventListener("click", handler);
    return () => container.removeEventListener("click", handler);
  }, [html, histIdx, onNavigate]);

  const goBack = () => { if (histIdx > 0) setHistIdx(i => i - 1); };
  const goFwd  = () => { if (histIdx < history.length - 1) setHistIdx(i => i + 1); };

  const handleJump = (i) => setHistIdx(i);

  return (
    <div className="atv-overlay">
      <div className="atv-panel">

        {/* Nagłówek */}
        <div className="atv-header">
          <div className="atv-title-block">
            <div className="atv-title">
              {currentAct.title || `Dz. U. ${currentAct.year} poz. ${currentAct.pos}`}
            </div>
            <div className="atv-meta-row">
              <span className="atv-ref-tag">
                DU/{currentAct.year}/{currentAct.pos}
              </span>
              {currentAct.status && currentAct.status !== "UNKNOWN" && (
                <span className={`atv-status atv-status-${currentAct.status === "obowiązujący" ? "ok" : "off"}`}>
                  {currentAct.status}
                </span>
              )}
            </div>
          </div>

          <div className="atv-actions">
            <a
              href={`https://isap.sejm.gov.pl/isap.nsf/DocDetails.xsp?id=WDU${currentAct.year}${String(currentAct.pos).padStart(7,"0")}`}
              target="_blank" rel="noopener noreferrer"
              className="atv-ext-link"
            >↗ ISAP</a>
            <a
              href={`https://isap.sejm.gov.pl/isap.nsf/download.xsp/WDU${currentAct.year}${String(currentAct.pos).padStart(7,"0")}/O/D${currentAct.year}${currentAct.pos}.pdf`}
              target="_blank" rel="noopener noreferrer"
              className="atv-ext-link"
            >↓ PDF</a>
            <button className="atv-close-btn" onClick={onClose} title="Zamknij czytnik">✕</button>
          </div>
        </div>

        {/* Mapa nawigacji */}
        <NavMap
          history={history}
          currentIdx={histIdx}
          onJump={handleJump}
        />

        {/* Treść aktu */}
        <div className="atv-body">
          {loading && (
            <div className="atv-loading">
              <div className="spinner" />
              <span>Pobieranie tekstu aktu z API Sejmu…</span>
            </div>
          )}

          {error && (
            <div className="atv-error">
              <div className="atv-error-icon">⚠</div>
              <div>
                <div>Nie udało się pobrać tekstu aktu.</div>
                <div className="atv-error-detail">{error}</div>
                <div className="atv-error-hint">
                  Tekst może być niedostępny w ELI API dla starszych aktów.
                  Spróbuj pobrać PDF lub otworzyć w ISAP.
                </div>
              </div>
            </div>
          )}

          {html && !loading && (
            <>
              <div className="atv-hint">
                💡 Kliknij w podświetlone odesłanie <span className="ref-link-demo">Dz. U. z YYYY r. poz. NNNN</span> aby przejść do cytowanego aktu.
              </div>
              <div
                ref={contentRef}
                className="atv-content"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </>
          )}
        </div>

      </div>
    </div>
  );
}
