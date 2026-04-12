/**
 * LawGraph.jsx
 * Główny komponent wizualizacji grafu aktów prawnych.
 * Używa biblioteki cytoscape z cache localStorage (TTL 30min).
 */

import { useEffect, useRef, useCallback, useState } from "react";
import cytoscape from "cytoscape";
import { API_BASE } from "../api.js";
import { saveToCache, loadFromCache, clearCache, getCacheInfo } from "../cache.js";
import "./LawGraph.css";

// cose jest wbudowany w cytoscape — nie potrzeba plugina

const CY_STYLE = [
  {
    selector: "node",
    style: {
      "background-color": "data(color)",
      "label": "data(label)",
      "color": "#e2e8f0",
      "text-valign": "bottom",
      "text-halign": "center",
      "text-margin-y": 6,
      "font-size": 9,
      "font-family": "IBM Plex Sans, sans-serif",
      "text-wrap": "ellipsis",
      "text-max-width": 120,
      "width": 28,
      "height": 28,
      "border-width": 2,
      "border-color": "data(color)",
      "border-opacity": 0.4,
      "text-background-color": "#0d0f14",
      "text-background-opacity": 0.85,
      "text-background-padding": "2px",
      "text-background-shape": "roundrectangle",
      "overlay-padding": 8,
      "transition-property": "background-color, border-color, width, height",
      "transition-duration": "0.15s",
    },
  },
  {
    selector: "node:selected",
    style: {
      "border-width": 3,
      "border-color": "#f59e0b",
      "border-opacity": 1,
      "width": 38,
      "height": 38,
    },
  },
  {
    selector: "node.highlighted",
    style: { "border-width": 3, "border-color": "#f59e0b", "opacity": 1 },
  },
  {
    selector: "node.faded",
    style: { "opacity": 0.2 },
  },
  {
    selector: "edge",
    style: {
      "width": 1.5,
      "line-color": "#2a3447",
      "target-arrow-color": "#2a3447",
      "target-arrow-shape": "triangle",
      "curve-style": "bezier",
      "label": "data(label)",
      "font-size": 8,
      "color": "#64748b",
      "font-family": "Space Mono, monospace",
      "text-rotation": "autorotate",
      "text-background-color": "#0d0f14",
      "text-background-opacity": 0.7,
      "text-background-padding": "2px",
      "arrow-scale": 1.2,
    },
  },
  { selector: "edge[label='CHANGES']",    style: { "line-color": "#3b82f6", "target-arrow-color": "#3b82f6" } },
  { selector: "edge[label='REPEALS']",    style: { "line-color": "#ef4444", "target-arrow-color": "#ef4444" } },
  { selector: "edge[label='REPEALED_BY']",style: { "line-color": "#ef4444", "target-arrow-color": "#ef4444", "line-style": "dashed" } },
  { selector: "edge[label='EXECUTES']",   style: { "line-color": "#22c55e", "target-arrow-color": "#22c55e" } },
  { selector: "edge.faded",               style: { "opacity": 0.08 } },
];

// Szybki layout (jak w poland-legal-links) — cose zamiast cose-bilkent
// cose-bilkent z numIter=2500 blokuje główny wątek przeglądarki na ~3s przy 200+ węzłach
const LAYOUT_FAST = {
  name: "cose",
  animate: false,          // bez animacji = 5-10x szybciej
  nodeRepulsion: 15000,
  idealEdgeLength: 150,
  gravity: 0.15,
  padding: 50,
  randomize: false,
  componentSpacing: 80,
  nodeOverlap: 20,
};

// Ładny layout z animacją (tylko dla małych grafów < 100 węzłów)
const LAYOUT_ANIMATED = {
  name: "cose",
  animate: true,
  animationDuration: 600,
  nodeRepulsion: 15000,
  idealEdgeLength: 150,
  gravity: 0.15,
  padding: 50,
};

function pickLayout(nodeCount) {
  return nodeCount > 80 ? LAYOUT_FAST : LAYOUT_ANIMATED;
}

export default function LawGraph({ filters, onSelectAct }) {
  const containerRef = useRef(null);
  const cyRef        = useRef(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [counts, setCounts]         = useState({ nodes: 0, edges: 0 });
  const [fromCache, setFromCache]   = useState(false);
  const [cacheInfo, setCacheInfo]   = useState({ entries: 0, sizeKB: 0 });

  const refreshCacheInfo = () => setCacheInfo(getCacheInfo());

  const loadGraph = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    setFromCache(false);

    try {
      const params = new URLSearchParams();
      if (filters.year)    params.set("year",    filters.year);
      if (filters.status)  params.set("status",  filters.status);
      if (filters.keyword) params.set("keyword", filters.keyword);
      params.set("limit", "500");

      let elements;

      // Sprawdź cache (chyba że wymuszono odświeżenie)
      if (!forceRefresh) {
        const cached = loadFromCache(filters);
        if (cached) {
          elements = cached;
          setFromCache(true);
        }
      }

      // Pobierz z API jeśli brak cache
      if (!elements) {
        const res = await fetch(`${API_BASE}/graph?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status} — backend niedostępny`);
        const json = await res.json();
        elements = json.elements;
        saveToCache(filters, elements);
        refreshCacheInfo();
      }

      if (!cyRef.current) return;
      const cy = cyRef.current;
      cy.elements().remove();
      cy.add(elements);

      setCounts({ nodes: cy.nodes().length, edges: cy.edges().length });
      cy.layout(pickLayout(cy.nodes().length)).run();

    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  // Inicjalizacja Cytoscape
  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements:  [],
      style:     CY_STYLE,
      layout:    { name: "preset" },
      minZoom:   0.1,
      maxZoom:   4,
      wheelSensitivity: 0.2,
    });

    cyRef.current = cy;

    cy.on("tap", "node", (evt) => {
      const data = evt.target.data();
      cy.elements().removeClass("highlighted faded");
      const neighborhood = evt.target.neighborhood().add(evt.target);
      cy.elements().not(neighborhood).addClass("faded");
      neighborhood.addClass("highlighted");
      evt.target.select();
      onSelectAct(data);
    });

    cy.on("tap", (evt) => {
      if (evt.target === cy) {
        cy.elements().removeClass("highlighted faded");
        cy.elements().unselect();
        onSelectAct(null);
      }
    });

    refreshCacheInfo();
    return () => cy.destroy();
  }, [onSelectAct]);

  useEffect(() => {
    if (cyRef.current) loadGraph();
  }, [loadGraph]);

  const handleClearCache = () => {
    const n = clearCache();
    refreshCacheInfo();
    loadGraph(true);
  };

  const handleFitView   = () => cyRef.current?.fit(undefined, 40);
  const handleRelayout  = () => cyRef.current?.layout(LAYOUT_ANIMATED).run();

  return (
    <div className="law-graph-wrapper">
      {loading && (
        <div className="graph-overlay">
          <div className="spinner" />
          <span>{fromCache ? "Ładowanie z cache…" : "Pobieranie z API Sejmu…"}</span>
        </div>
      )}
      {error && (
        <div className="graph-overlay error">
          <span className="error-icon">⚠</span>
          <span>{error}</span>
          <button onClick={() => loadGraph(true)}>Spróbuj ponownie</button>
        </div>
      )}

      <div ref={containerRef} className="cy-container" />

      <div className="graph-toolbar">
        <button onClick={handleFitView}  title="Dopasuj widok">⊡ Fit</button>
        <button onClick={handleRelayout} title="Przeorganizuj">↻ Layout</button>
        <button onClick={() => loadGraph(true)} title="Pobierz świeże dane z API">⟳ Odśwież</button>
        <button onClick={handleClearCache} title="Wyczyść cache i pobierz ponownie" className="cache-btn">
          🗑 Cache ({cacheInfo.sizeKB}KB)
        </button>
      </div>

      <div className="graph-counter">
        <span>{counts.nodes} węzłów</span>
        <span className="sep">·</span>
        <span>{counts.edges} krawędzi</span>
        {fromCache && <span className="cache-badge">📦 z cache</span>}
      </div>

      <div className="graph-legend">
        <LegendItem color="#22c55e" label="Obowiązujący" />
        <LegendItem color="#ef4444" label="Uchylony" />
        <LegendItem color="#f97316" label="Nieobowiązujący" />
        <LegendItem color="#3b82f6" label="Zmieniony" />
        <LegendItem color="#64748b" label="Zewnętrzny" />
        <div className="legend-sep" />
        <LegendEdge color="#3b82f6" label="Zmienia" />
        <LegendEdge color="#ef4444" label="Uchyla" />
        <LegendEdge color="#22c55e" label="Wykonuje" />
      </div>
    </div>
  );
}

function LegendItem({ color, label }) {
  return (
    <div className="legend-item">
      <span className="legend-dot" style={{ background: color }} />
      <span>{label}</span>
    </div>
  );
}

function LegendEdge({ color, label }) {
  return (
    <div className="legend-item">
      <span className="legend-line" style={{ background: color }} />
      <span>{label}</span>
    </div>
  );
}
