/**
 * LawGraph.jsx
 * Główny komponent wizualizacji grafu aktów prawnych.
 * Używa biblioteki cytoscape (bezpośrednio, nie react-cytoscapejs)
 * dla pełnej kontroli nad layoutem i interakcjami.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import cytoscape from "cytoscape";
import coseBilkent from "cytoscape-cose-bilkent";
import "./LawGraph.css";

cytoscape.use(coseBilkent);

const API_BASE = "/api";

// ── Style Cytoscape ──────────────────────────────────────────────

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
    style: {
      "border-width": 3,
      "border-color": "#f59e0b",
      "opacity": 1,
    },
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
  {
    selector: "edge[label='CHANGES']",
    style: { "line-color": "#3b82f6", "target-arrow-color": "#3b82f6" },
  },
  {
    selector: "edge[label='REPEALS']",
    style: { "line-color": "#ef4444", "target-arrow-color": "#ef4444" },
  },
  {
    selector: "edge[label='REPEALED_BY']",
    style: { "line-color": "#ef4444", "target-arrow-color": "#ef4444", "line-style": "dashed" },
  },
  {
    selector: "edge[label='EXECUTES']",
    style: { "line-color": "#22c55e", "target-arrow-color": "#22c55e" },
  },
  {
    selector: "edge.faded",
    style: { "opacity": 0.08 },
  },
];

// ── Layout ────────────────────────────────────────────────────────

const LAYOUT = {
  name: "cose-bilkent",
  quality: "default",
  animate: true,
  animationDuration: 800,
  nodeRepulsion: 4500,
  idealEdgeLength: 100,
  edgeElasticity: 0.45,
  nestingFactor: 0.1,
  gravity: 0.25,
  numIter: 2500,
  tile: true,
  tilingPaddingVertical: 10,
  tilingPaddingHorizontal: 10,
  gravityRangeCompound: 1.5,
  gravityCompound: 1.0,
  gravityRange: 3.8,
  initialEnergyOnIncremental: 0.5,
};


// ── Komponent ────────────────────────────────────────────────────

export default function LawGraph({ filters, onSelectAct }) {
  const containerRef = useRef(null);
  const cyRef        = useRef(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [counts, setCounts]     = useState({ nodes: 0, edges: 0 });

  // Pobierz dane i zbuduj graf
  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.year)    params.set("year",    filters.year);
      if (filters.status)  params.set("status",  filters.status);
      if (filters.keyword) params.set("keyword", filters.keyword);
      params.set("limit", "500");

      const res = await fetch(`${API_BASE}/graph?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { elements } = await res.json();

      if (!cyRef.current) return;
      const cy = cyRef.current;

      cy.elements().remove();
      cy.add(elements);

      setCounts({
        nodes: cy.nodes().length,
        edges: cy.edges().length,
      });

      cy.layout(LAYOUT).run();
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

    // Klik na węzeł
    cy.on("tap", "node", (evt) => {
      const node = evt.target;
      const data = node.data();

      // Highlight sąsiadów
      cy.elements().removeClass("highlighted faded");
      const neighborhood = node.neighborhood().add(node);
      cy.elements().not(neighborhood).addClass("faded");
      neighborhood.addClass("highlighted");
      node.select();

      onSelectAct(data);
    });

    // Klik na tło — odznacz
    cy.on("tap", (evt) => {
      if (evt.target === cy) {
        cy.elements().removeClass("highlighted faded");
        cy.elements().unselect();
        onSelectAct(null);
      }
    });

    return () => cy.destroy();
  }, [onSelectAct]);

  // Przeładuj graf przy zmianie filtrów
  useEffect(() => {
    if (cyRef.current) loadGraph();
  }, [loadGraph]);

  const handleFitView = () => cyRef.current?.fit(undefined, 40);
  const handleRelayout = () => cyRef.current?.layout(LAYOUT).run();

  return (
    <div className="law-graph-wrapper">
      {/* Overlay stanu */}
      {loading && (
        <div className="graph-overlay">
          <div className="spinner" />
          <span>Ładowanie grafu…</span>
        </div>
      )}
      {error && (
        <div className="graph-overlay error">
          <span className="error-icon">⚠</span>
          <span>{error}</span>
          <button onClick={loadGraph}>Spróbuj ponownie</button>
        </div>
      )}

      {/* Płótno grafu */}
      <div ref={containerRef} className="cy-container" />

      {/* Pasek narzędzi */}
      <div className="graph-toolbar">
        <button onClick={handleFitView} title="Dopasuj widok">⊡ Fit</button>
        <button onClick={handleRelayout} title="Przeorganizuj">↻ Layout</button>
        <button onClick={loadGraph} title="Odśwież dane">⟳ Odśwież</button>
      </div>

      {/* Licznik elementów */}
      <div className="graph-counter">
        <span>{counts.nodes} węzłów</span>
        <span className="sep">·</span>
        <span>{counts.edges} krawędzi</span>
      </div>

      {/* Legenda */}
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
