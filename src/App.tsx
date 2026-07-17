import { useMemo } from "react";
import { MenuBar, openCsvFile } from "./components/MenuBar";
import { TabBar } from "./components/TabBar";
import { DataGrid } from "./components/DataGrid";
import { StatusBar } from "./components/StatusBar";
import { ColumnChooser } from "./components/ColumnChooser";
import { HistogramPanel } from "./components/HistogramPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { FilterEditor } from "./components/FilterEditor";
import { ConditionalFormatPanel } from "./components/ConditionalFormatPanel";
import { DagMappingDialog } from "./components/DagMappingDialog";
import { DagTrajectoryPanel } from "./components/DagTrajectoryPanel";
import { MindMappingDialog } from "./components/MindMappingDialog";
import { MindMapPanel } from "./components/MindMapPanel";
import { useTabsStore } from "./stores/tabsStore";
import { applyFilters, sortFilterableRows } from "./lib/filters";
import "./App.css";

function App() {
  const tab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const searchOptions = useTabsStore((s) => s.searchOptions);

  const filteredRows = useMemo(() => {
    if (!tab) return [];
    const filtered = applyFilters(
      tab.rows,
      tab.columns,
      tab.columnFilters,
      tab.globalSearch,
      searchOptions,
      tab.taggedLines,
      tab.timeRangeFilter,
      tab.timestampColumn,
      tab.advancedFilter,
    );
    return sortFilterableRows(
      filtered,
      tab.columns,
      tab.sortColumn,
      tab.sortDir,
      {
        timestampColumn: tab.timestampColumn,
        assumeUtc: tab.timestampAssumeUtc,
      },
    );
  }, [
    tab?.rows,
    tab?.columns,
    tab?.columnFilters,
    tab?.globalSearch,
    tab?.taggedLines,
    tab?.timeRangeFilter,
    tab?.timestampColumn,
    tab?.advancedFilter,
    tab?.sortColumn,
    tab?.sortDir,
    tab?.timestampAssumeUtc,
    searchOptions,
  ]);

  return (
    <div className="app-shell">
      <MenuBar />
      <TabBar />
      <main className="main-stage">
        {tab ? (
          <>
            <HistogramPanel />
            <DagTrajectoryPanel />
            <MindMapPanel />
            <DataGrid key={tab.id} rows={filteredRows} />
            <ColumnChooser />
            <FilterEditor />
            <ConditionalFormatPanel />
            <DagMappingDialog />
            <MindMappingDialog />
          </>
        ) : (
          <div className="empty-state">
            <h1>aIR</h1>
            <p className="tagline">
              Annotated Incident Response and Data Analysis
            </p>
            <p>
              Open a CSV in <strong>aGrid: Artifact Grid</strong> to begin. The
              original file is never modified — aIR works on a local working copy.
            </p>
            <button type="button" className="primary-cta" onClick={() => void openCsvFile()}>
              Open CSV / JSON / TXT…
            </button>
            <ul className="feature-hints">
              <li>Shift + scroll for horizontal pan</li>
              <li>Filter Editor · Conditional Formatting · aChart</li>
              <li>aMind mindmaps for data exploration</li>
              <li>Tags column by default · highlight &amp; export</li>
              <li>Settings menu for light/dark mode and accent themes</li>
            </ul>
          </div>
        )}
      </main>
      <StatusBar visibleLines={filteredRows.length} />
      <SettingsPanel />
    </div>
  );
}

export default App;
