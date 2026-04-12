/**
 * NavMap.jsx
 * Wizualna mapa ścieżki nawigacji w czytniku aktów.
 * Pokazuje skąd użytkownik zaczął, gdzie jest teraz,
 * i pozwala wrócić do dowolnego punktu.
 */

import { useEffect, useRef } from "react";
import "./NavMap.css";

function shortTitle(act) {
  if (!act) return "—";
  if (act.title && act.title.length < 60) return act.title;
  if (act.title) {
    // Wyciągnij rok i pozycję z tytułu jeśli długi
    const match = act.title.match(/z dnia (.+?) r\. (.+)/);
    if (match) return match[2].slice(0, 50) + (match[2].length > 50 ? "…" : "");
    return act.title.slice(0, 55) + "…";
  }
  return `Dz. U. ${act.year} poz. ${act.pos}`;
}

export default function NavMap({ history, currentIdx, onJump }) {
  const containerRef = useRef(null);
  const activeRef    = useRef(null);

  // Auto-scroll do aktywnego elementu
  useEffect(() => {
    if (activeRef.current && containerRef.current) {
      activeRef.current.scrollIntoView({
        behavior: "smooth",
        inline: "center",
        block: "nearest",
      });
    }
  }, [currentIdx]);

  if (!history || history.length === 0) return null;

  return (
    <div className="navmap-wrap">
      <div className="navmap-label">
        <span className="navmap-label-icon">🗺</span>
        Ścieżka nawigacji
        <span className="navmap-count">{currentIdx + 1} / {history.length}</span>
      </div>

      <div className="navmap-scroll" ref={containerRef}>
        <div className="navmap-track">
          {history.map((act, i) => {
            const isActive  = i === currentIdx;
            const isStart   = i === 0;
            const isVisited = i < currentIdx;
            const isFuture  = i > currentIdx;

            return (
              <div key={i} className="navmap-item-wrap">
                {/* Connector line */}
                {i > 0 && (
                  <div className={`navmap-connector ${isVisited || isActive ? "visited" : "future"}`} />
                )}

                {/* Node */}
                <button
                  ref={isActive ? activeRef : null}
                  className={[
                    "navmap-node",
                    isActive  ? "active"  : "",
                    isStart   ? "start"   : "",
                    isVisited ? "visited" : "",
                    isFuture  ? "future"  : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => onJump(i)}
                  title={act.title || `Dz. U. ${act.year} poz. ${act.pos}`}
                >
                  <div className="navmap-node-dot">
                    {isStart  && <span className="navmap-dot-icon">★</span>}
                    {isActive && !isStart && <span className="navmap-dot-icon">●</span>}
                    {isVisited && <span className="navmap-dot-icon">✓</span>}
                    {isFuture && <span className="navmap-dot-icon">○</span>}
                  </div>

                  <div className="navmap-node-info">
                    <div className="navmap-node-ref">
                      {isStart && <span className="navmap-start-badge">START</span>}
                      <span className="navmap-node-id">{act.year}/{act.pos}</span>
                    </div>
                    <div className="navmap-node-title">{shortTitle(act)}</div>
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Skróty */}
      <div className="navmap-shortcuts">
        <button
          className="navmap-shortcut"
          onClick={() => onJump(0)}
          disabled={currentIdx === 0}
        >
          ⏮ Start
        </button>
        <button
          className="navmap-shortcut"
          onClick={() => onJump(currentIdx - 1)}
          disabled={currentIdx === 0}
        >
          ← Wstecz
        </button>
        <button
          className="navmap-shortcut"
          onClick={() => onJump(currentIdx + 1)}
          disabled={currentIdx >= history.length - 1}
        >
          Dalej →
        </button>
        <button
          className="navmap-shortcut"
          onClick={() => onJump(history.length - 1)}
          disabled={currentIdx >= history.length - 1}
        >
          Koniec ⏭
        </button>
      </div>
    </div>
  );
}
