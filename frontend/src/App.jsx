import { useState, useCallback } from "react";
import LawGraph from "./components/LawGraph.jsx";
import Sidebar from "./components/Sidebar.jsx";
import Header from "./components/Header.jsx";
import StatsPanel from "./components/StatsPanel.jsx";
import "./App.css";

export default function App() {
  const [selectedAct, setSelectedAct] = useState(null);
  const [filters, setFilters] = useState({ year: "", status: "", keyword: "" });
  const [showStats, setShowStats] = useState(false);

  const handleSelectAct = useCallback((act) => {
    setSelectedAct(act);
    setShowStats(false);
  }, []);

  return (
    <div className="app-shell">
      <Header
        filters={filters}
        onFiltersChange={setFilters}
        onToggleStats={() => setShowStats((s) => !s)}
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
            <Sidebar act={selectedAct} />
          )}
        </aside>
      </div>
    </div>
  );
}
