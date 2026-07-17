import { useEffect, useRef, useState, type ReactNode } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useTabsStore } from "../stores/tabsStore";
import { useSettingsStore } from "../stores/settingsStore";
import type { DatasetTab, ImportedDataset, SessionData } from "../lib/types";
import { LINE_COL, NOTES_COL, TAG_COL, TAGS_COL } from "../lib/types";
import { applyFilters, sortFilterableRows, type FilterableRow } from "../lib/filters";

type MenuId = "file" | "tools" | "tabs" | "graph" | "settings" | "help";

function MenuItem({
  id,
  label,
  openMenu,
  setOpenMenu,
  children,
}: {
  id: MenuId;
  label: string;
  openMenu: MenuId | null;
  setOpenMenu: (id: MenuId | null) => void;
  children: ReactNode;
}) {
  const isOpen = openMenu === id;
  return (
    <div className={`menu-item ${isOpen ? "open" : ""}`}>
      <button
        type="button"
        className="menu-trigger"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          setOpenMenu(isOpen ? null : id);
        }}
      >
        {label}
      </button>
      {isOpen && (
        <div className="menu-dropdown" role="menu" onClick={() => setOpenMenu(null)}>
          {children}
        </div>
      )}
    </div>
  );
}

async function openDataFile() {
  const selected = await open({
    multiple: false,
    filters: [
      {
        name: "Tabular data",
        extensions: ["csv", "tsv", "txt", "json", "jsonl", "ndjson"],
      },
      { name: "CSV / TSV / TXT", extensions: ["csv", "tsv", "txt"] },
      { name: "JSON", extensions: ["json"] },
      { name: "NDJSON / JSONL", extensions: ["ndjson", "jsonl"] },
    ],
  });
  if (!selected || Array.isArray(selected)) return;

  const dataset = await invoke<ImportedDataset>("import_csv", {
    sourcePath: selected,
  });

  let session: SessionData | null = null;
  try {
    session = await invoke<SessionData | null>("load_session", {
      workingCopyPath: dataset.workingCopyPath,
    });
  } catch {
    session = null;
  }

  useTabsStore.getState().openDataset(dataset, session ?? undefined);
}

/** @deprecated Prefer openDataFile — kept as alias for existing imports */
const openCsvFile = openDataFile;

function buildExportPayload(
  tab: DatasetTab,
  filtered: FilterableRow[],
  mode: "visible" | "highlighted",
): { columns: string[]; rows: string[][] } | null {
  const highlightedRowLines = new Set(
    Object.keys(tab.rowHighlights).map((k) => Number(k)),
  );
  const highlightedCols = Object.keys(tab.columnHighlights).filter(
    (c) => c !== LINE_COL && c !== TAG_COL && !tab.hiddenColumns.has(c),
  );

  if (mode === "highlighted") {
    if (highlightedRowLines.size === 0 && highlightedCols.length === 0) {
      return null;
    }
  }

  const sourceRows =
    mode === "highlighted" && highlightedRowLines.size > 0
      ? filtered.filter((r) => highlightedRowLines.has(r.line))
      : filtered;

  const dataCols =
    mode === "highlighted" && highlightedCols.length > 0
      ? tab.columnOrder.filter(
          (c) => highlightedCols.includes(c) && !tab.hiddenColumns.has(c),
        )
      : tab.columnOrder.filter((c) => !tab.hiddenColumns.has(c));

  const columns = ["Line", "Tag", ...dataCols];
  const rows = sourceRows.map((r) => {
    const cells = [String(r.line), r.tagged ? "1" : "0"];
    for (const col of dataCols) {
      const idx = tab.columns.indexOf(col);
      cells.push(idx >= 0 ? (r.cells[idx] ?? "") : "");
    }
    return cells;
  });

  return { columns, rows };
}

async function exportData(
  format: "csv" | "json",
  mode: "visible" | "highlighted",
) {
  const state = useTabsStore.getState();
  const tab = state.getActiveTab();
  if (!tab) return;

  const filtered = sortFilterableRows(
    applyFilters(
      tab.rows,
      tab.columns,
      tab.columnFilters,
      tab.globalSearch,
      state.searchOptions,
      tab.taggedLines,
      tab.timeRangeFilter,
      tab.timestampColumn,
      tab.advancedFilter,
    ),
    tab.columns,
    tab.sortColumn,
    tab.sortDir,
    {
      timestampColumn: tab.timestampColumn,
      assumeUtc: tab.timestampAssumeUtc,
    },
  );

  const payload = buildExportPayload(tab, filtered, mode);
  if (!payload) {
    window.alert(
      "No highlighted rows or columns to export. Right-click a cell to highlight a row or column first.",
    );
    return;
  }
  if (payload.rows.length === 0) {
    window.alert("No matching highlighted rows in the current filtered view.");
    return;
  }

  const suffix =
    mode === "highlighted"
      ? format === "json"
        ? ".highlighted.json"
        : ".highlighted.csv"
      : format === "json"
        ? ".json"
        : ".filtered.csv";

  const defaultPath = tab.fileName.replace(/\.csv$/i, "") + suffix;

  const path = await save({
    defaultPath,
    filters:
      format === "json"
        ? [{ name: "JSON", extensions: ["json"] }]
        : [{ name: "CSV", extensions: ["csv"] }],
  });
  if (!path) return;

  if (format === "json") {
    await invoke("export_json", {
      path,
      columns: payload.columns,
      rows: payload.rows,
    });
  } else {
    await invoke("export_csv", {
      path,
      columns: payload.columns,
      rows: payload.rows,
    });
  }
}

async function persistSession() {
  const tab = useTabsStore.getState().getActiveTab();
  if (!tab) return;
  const rowHighlights: Record<string, string> = {};
  for (const [k, v] of Object.entries(tab.rowHighlights)) {
    rowHighlights[String(k)] = v;
  }
  const session: SessionData = {
    workingCopyPath: tab.workingCopyPath,
    taggedLines: Array.from(tab.taggedLines),
    columnWidths: tab.columnWidths,
    hiddenColumns: Array.from(tab.hiddenColumns),
    wordWrap: tab.wordWrap,
    columnOrder: tab.columnOrder,
    groupByColumns: tab.groupByColumns,
    userColumns: Array.from(tab.userColumns),
    rowHighlights,
    columnHighlights: tab.columnHighlights,
    columnTags: tab.columnTags,
    cellTags: tab.cellTags,
    histogramHeight: tab.histogramHeight,
    advancedFilter: tab.advancedFilter,
    formatRules: tab.formatRules,
    dagMapping: tab.dagMapping,
    dagPinnedDetailFields: tab.dagPinnedDetailFields,
    mindMapping: tab.mindMapping,
    sortColumn: tab.sortColumn,
    sortDir: tab.sortDir,
    displayTimezone: tab.displayTimezone,
    timestampAssumeUtc: tab.timestampAssumeUtc,
  };
  await invoke("save_session", { session });
}

export function MenuBar() {
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const updateTab = useTabsStore((s) => s.updateTab);
  const equalizeColumns = useTabsStore((s) => s.equalizeColumns);
  const addUserColumn = useTabsStore((s) => s.addUserColumn);
  const closeTab = useTabsStore((s) => s.closeTab);
  const tabs = useTabsStore((s) => s.tabs);
  const tab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const setSettingsOpen = useSettingsStore((s) => s.setSettingsOpen);
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const barRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu]);

  const hasHighlights = Boolean(
    tab &&
      (Object.keys(tab.rowHighlights).length > 0 ||
        Object.keys(tab.columnHighlights).length > 0),
  );

  const addNamedColumn = (defaultName: string) => {
    if (!tab) return;
    const name = window.prompt("Column name:", defaultName);
    if (name?.trim()) addUserColumn(tab.id, name.trim());
  };

  return (
    <header className="menu-bar" ref={barRef}>
      <nav className="menu-nav" aria-label="Application menu">
        <MenuItem id="file" label="File" openMenu={openMenu} setOpenMenu={setOpenMenu}>
          <button type="button" onClick={() => void openCsvFile()}>
            Open CSV / JSON / TXT…
          </button>
          <button
            type="button"
            disabled={!tab}
            onClick={() => void exportData("csv", "visible")}
          >
            Export Visible → CSV…
          </button>
          <button
            type="button"
            disabled={!tab}
            onClick={() => void exportData("json", "visible")}
          >
            Export Visible → JSON…
          </button>
          <button
            type="button"
            disabled={!tab || !hasHighlights}
            onClick={() => void exportData("csv", "highlighted")}
            title={
              hasHighlights
                ? "Export highlighted rows and/or columns"
                : "Highlight rows or columns first"
            }
          >
            Export Highlighted → CSV…
          </button>
          <button
            type="button"
            disabled={!tab || !hasHighlights}
            onClick={() => void exportData("json", "highlighted")}
            title={
              hasHighlights
                ? "Export highlighted rows and/or columns"
                : "Highlight rows or columns first"
            }
          >
            Export Highlighted → JSON…
          </button>
          <button
            type="button"
            disabled={!tab}
            onClick={() => void persistSession()}
          >
            Save Session
          </button>
        </MenuItem>

        <MenuItem id="tools" label="Tools" openMenu={openMenu} setOpenMenu={setOpenMenu}>
          <button
            type="button"
            disabled={!tab}
            onClick={() => tab && equalizeColumns(tab.id)}
          >
            Equalize Column Widths
          </button>
          <button
            type="button"
            disabled={!tab}
            onClick={() =>
              tab && updateTab(tab.id, { wordWrap: !tab.wordWrap })
            }
          >
            {tab?.wordWrap ? "Disable Word Wrap" : "Enable Word Wrap"}
          </button>
          <button
            type="button"
            disabled={!tab}
            onClick={() =>
              tab && updateTab(tab.id, { showColumnChooser: !tab.showColumnChooser })
            }
          >
            Column Chooser
          </button>
          <button
            type="button"
            disabled={!tab}
            onClick={() => addNamedColumn(NOTES_COL)}
          >
            Add Column… (e.g. Notes)
          </button>
          <button
            type="button"
            disabled={!tab}
            onClick={() => {
              if (!tab) return;
              useTabsStore.getState().addGroupBy(tab.id, TAGS_COL);
            }}
          >
            Group by Tags
          </button>
          <button
            type="button"
            disabled={!tab}
            onClick={() =>
              tab && updateTab(tab.id, { showFilterEditor: !tab.showFilterEditor })
            }
          >
            Filter Editor…
          </button>
          <button
            type="button"
            disabled={!tab}
            onClick={() =>
              tab && updateTab(tab.id, { showFormatPanel: !tab.showFormatPanel })
            }
          >
            Conditional Formatting…
          </button>
        </MenuItem>

        <MenuItem id="tabs" label="Tabs" openMenu={openMenu} setOpenMenu={setOpenMenu}>
          <button
            type="button"
            disabled={!activeTabId}
            onClick={() => activeTabId && closeTab(activeTabId)}
          >
            Close Active Tab
          </button>
          <button
            type="button"
            disabled={tabs.length === 0}
            onClick={() => tabs.forEach((t) => closeTab(t.id))}
          >
            Close All Tabs
          </button>
        </MenuItem>

        <MenuItem id="graph" label="Graph" openMenu={openMenu} setOpenMenu={setOpenMenu}>
          <button
            type="button"
            disabled={!tab}
            onClick={() =>
              tab && updateTab(tab.id, { showHistogram: !tab.showHistogram })
            }
          >
            {tab?.showHistogram ? "Hide Timeline Graph" : "Graph Timeline…"}
          </button>
          {tab?.dagMapping ? (
            <>
              <button
                type="button"
                onClick={() => updateTab(tab.id, { showDag: !tab.showDag })}
              >
                {tab.showDag
                  ? "Hide aChart: Asset Logs FlowChart"
                  : "Show aChart: Asset Logs FlowChart"}
              </button>
              <button
                type="button"
                onClick={() => updateTab(tab.id, { showDagMapping: true })}
              >
                Remap aChart…
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={!tab}
              onClick={() =>
                tab && updateTab(tab.id, { showDagMapping: true })
              }
            >
              Convert to aChart: Asset Logs FlowChart…
            </button>
          )}
          {tab?.mindMapping ? (
            <>
              <button
                type="button"
                onClick={() => updateTab(tab.id, { showMind: !tab.showMind })}
              >
                {tab.showMind ? "Hide aMind" : "Show aMind"}
              </button>
              <button
                type="button"
                onClick={() => updateTab(tab.id, { showMindMapping: true })}
              >
                Remap aMind…
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={!tab}
              onClick={() =>
                tab && updateTab(tab.id, { showMindMapping: true })
              }
            >
              Convert to aMind…
            </button>
          )}
        </MenuItem>

        <MenuItem id="settings" label="Settings" openMenu={openMenu} setOpenMenu={setOpenMenu}>
          <button type="button" onClick={() => setSettingsOpen(true)}>
            Appearance & Themes…
          </button>
        </MenuItem>

        <MenuItem id="help" label="Help" openMenu={openMenu} setOpenMenu={setOpenMenu}>
          <button
            type="button"
            onClick={() =>
              alert(
                "aIR: Annotated Incident Response and Data Analysis\n\n" +
                  "• aGrid: Artifact Grid — timeline spreadsheet\n" +
                  "• aChart: Asset Logs FlowChart — process flowchart\n" +
                  "• aMind — pivot mindmap explorer\n" +
                  "• Right-click cells: include/exclude, highlight, tag\n" +
                  "• File → Export Highlighted for highlighted rows/columns\n" +
                  "• Settings menu for light/dark mode and accent themes",
              )
            }
          >
            About aIR
          </button>
        </MenuItem>
      </nav>

      <div
        className="brand-chip"
        title="aIR: Annotated Incident Response and Data Analysis"
      >
        aIR
      </div>
    </header>
  );
}

export { openCsvFile, persistSession };
