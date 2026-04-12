import { useState, useCallback } from "react";
import LawGraph from "./components/LawGraph.jsx";
import Sidebar from "./components/Sidebar.jsx";
import Header from "./components/Header.jsx";
import StatsPanel from "./components/StatsPanel.jsx";
import ActTextViewer from "./components/ActTextViewer.jsx";
import "./App.css";

export default function App() {
  const [selectedAct, setSelectedAct]   = useState(null);
  const [filters, setFilters]           = useState({ year: "", status: "", keyword: "" });
  const [showStats, setShowStats]       = useState(false);
  const [readingAct, setReadingAct]     = useState(null);  // akt otwarty w czytniku

  const handleSelectAct = useCallback((act) => {
    setSelectedAct(act);
    setShowStats(false);
  }, []);

  const handleReadAct = useCallback((act) => {
    setReadingAct(act);
  }, []);

  const handleNavigateInReader = useCallback((act) => {
    // Gdy w czytniku klikniemy odesłanie — zaznacz też węzeł w grafie
    setSelectedAct(act);
  }, []);

  return (
    <div className="app-shell">
      <Header
        filters={filters}
        onFiltersChange={setFilters}
        onToggleStats={() => setShowStats(s => !s)}
        showStats={showStats}
      />

      <div className="app-body">
        <main className="graph-area">
          <LawGraph filters={filters} onSelectAct={handleSelectAct} />
        </main>

        <aside className="sidebar">
          {showStats ? (
            <StatsPanel />
          ) : (
            <Sidebar
              act={selectedAct}
              onReadAct={handleReadAct}
            />
          )}
        </aside>
      </div>

      {/* Czytnik aktu — panel nakładkowy */}
      {readingAct && (
        <ActTextViewer
          act={readingAct}
          onClose={() => setReadingAct(null)}
          onNavigate={handleNavigateInReader}
        />
      )}
    </div>
  );
}
