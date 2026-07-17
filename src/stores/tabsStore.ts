import { create } from "zustand";
import type {
  ColumnFilter,
  DatasetTab,
  ImportedDataset,
  SearchOptions,
  TimeRange,
  FilterNode,
  FormatRule,
  DagMapping,
  MindMapping,
} from "../lib/types";
import {
  DEFAULT_COL_WIDTH,
  HIGHLIGHT_COLORS,
  LINE_COL,
  LINE_COL_WIDTH,
  NOTES_COL,
  TAG_COL,
  TAG_COL_WIDTH,
  TAGS_COL,
  cellTagKey,
} from "../lib/types";
import { detectTimestampColumn } from "../lib/timestamp";
import { parseFilterInput } from "../lib/filters";

interface TabsState {
  tabs: DatasetTab[];
  activeTabId: string | null;
  searchOptions: SearchOptions;
  searchOptionsOpen: boolean;

  openDataset: (
    dataset: ImportedDataset,
    session?: Partial<{
      taggedLines: number[];
      columnWidths: Record<string, number>;
      hiddenColumns: string[];
      wordWrap: boolean;
      columnOrder: string[];
      groupByColumns: string[];
      userColumns: string[];
      rowHighlights: Record<string, string>;
      columnHighlights: Record<string, string>;
      columnTags: Record<string, string>;
      cellTags: Record<string, string>;
      histogramHeight: number;
      advancedFilter?: FilterNode | null;
      formatRules?: FormatRule[];
      dagMapping?: DagMapping | null;
      dagPinnedDetailFields?: string[];
      mindMapping?: MindMapping | null;
      sortColumn?: string | null;
      sortDir?: "asc" | "desc" | null;
      displayTimezone?: string | null;
      timestampAssumeUtc?: boolean;
    }>,
  ) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTab: (id: string, patch: Partial<DatasetTab>) => void;
  toggleTag: (tabId: string, line: number) => void;
  setColumnFilter: (tabId: string, column: string, raw: string) => void;
  setColumnFilterSpec: (tabId: string, column: string, filter: ColumnFilter | null) => void;
  includeCellValue: (tabId: string, column: string, value: string) => void;
  excludeCellValue: (tabId: string, column: string, value: string) => void;
  clearColumnFilters: (tabId: string) => void;
  setGlobalSearch: (tabId: string, value: string) => void;
  setColumnWidth: (tabId: string, column: string, width: number, resizeAll?: boolean) => void;
  equalizeColumns: (tabId: string) => void;
  reorderColumn: (
    tabId: string,
    dragged: string,
    target: string,
    place: "before" | "after",
  ) => void;
  /** Move a column by ±1 in display order (Column chooser ↑/↓) */
  moveColumn: (tabId: string, column: string, delta: -1 | 1) => void;
  addGroupBy: (tabId: string, column: string) => void;
  removeGroupBy: (tabId: string, column: string) => void;
  toggleGroupCollapsed: (tabId: string, groupId: string) => void;
  expandAllGroups: (tabId: string, groupIds: string[]) => void;
  collapseAllGroups: (tabId: string) => void;
  cycleGroupSort: (tabId: string) => void;
  addUserColumn: (tabId: string, name: string) => void;
  setCellValue: (tabId: string, line: number, column: string, value: string) => void;
  setRowHighlight: (tabId: string, line: number, color: string | null) => void;
  setRowHighlights: (tabId: string, lines: number[], color: string | null) => void;
  clearRowHighlights: (tabId: string) => void;
  setColumnHighlight: (tabId: string, column: string, color: string | null) => void;
  setColumnHighlights: (
    tabId: string,
    columns: string[],
    color: string | null,
  ) => void;
  setRowTag: (tabId: string, line: number, tag: string) => void;
  setColumnTag: (tabId: string, column: string, tag: string | null) => void;
  setColumnTags: (
    tabId: string,
    columns: string[],
    tag: string | null,
  ) => void;
  setCellTag: (tabId: string, line: number, column: string, tag: string | null) => void;
  setCellTags: (
    tabId: string,
    cells: { line: number; column: string }[],
    tag: string | null,
  ) => void;
  ensureTagsColumn: (tabId: string) => void;
  setSearchOptions: (opts: Partial<SearchOptions>) => void;
  setSearchOptionsOpen: (open: boolean) => void;
  getActiveTab: () => DatasetTab | null;
}

function initWidths(columns: string[]): Record<string, number> {
  const widths: Record<string, number> = {
    [LINE_COL]: LINE_COL_WIDTH,
    [TAG_COL]: TAG_COL_WIDTH,
  };
  for (const c of columns) widths[c] = DEFAULT_COL_WIDTH;
  return widths;
}

function nextHighlight(existing: string | undefined): string {
  if (!existing) return HIGHLIGHT_COLORS[0];
  const i = (HIGHLIGHT_COLORS as readonly string[]).indexOf(existing);
  return HIGHLIGHT_COLORS[(i + 1) % HIGHLIGHT_COLORS.length];
}

/** Keep saved display order, append any new columns, drop unknowns */
export function normalizeColumnOrder(
  columns: string[],
  order?: string[] | null,
): string[] {
  const known = new Set(columns);
  const out: string[] = [];
  const seen = new Set<string>();
  if (order) {
    for (const c of order) {
      if (known.has(c) && !seen.has(c)) {
        out.push(c);
        seen.add(c);
      }
    }
  }
  for (const c of columns) {
    if (!seen.has(c)) {
      out.push(c);
      seen.add(c);
    }
  }
  return out;
}

export function moveColumnInOrder(
  order: string[],
  dragged: string,
  target: string,
  place: "before" | "after",
): string[] {
  if (dragged === target) return order;
  if (!order.includes(dragged) || !order.includes(target)) return order;
  const without = order.filter((c) => c !== dragged);
  const ti = without.indexOf(target);
  if (ti < 0) return order;
  const insertAt = place === "before" ? ti : ti + 1;
  without.splice(insertAt, 0, dragged);
  return without;
}

function patchTab(
  set: (fn: (s: TabsState) => Partial<TabsState>) => void,
  tabId: string,
  fn: (t: DatasetTab) => DatasetTab,
) {
  set((s) => ({
    tabs: s.tabs.map((t) => (t.id === tabId ? fn(t) : t)),
  }));
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  searchOptions: { caseSensitive: false, wholeWord: false },
  searchOptionsOpen: false,

  openDataset: (dataset, session) => {
    const userColumns = new Set(session?.userColumns ?? []);
    // Tags column is always present by default (editable)
    userColumns.add(TAGS_COL);

    let columns = [...dataset.columns];
    let rows = dataset.rows.map((r) => [...r]);

    // Ensure Tags exists and sits first among data columns: Line | Tag | Tags | …
    if (!columns.includes(TAGS_COL)) {
      columns = [TAGS_COL, ...columns];
      rows = rows.map((r) => ["", ...r]);
    } else {
      columns = [TAGS_COL, ...columns.filter((c) => c !== TAGS_COL)];
      const tagsIdx = dataset.columns.indexOf(TAGS_COL);
      rows = dataset.rows.map((r) => {
        const tagsVal = tagsIdx >= 0 ? (r[tagsIdx] ?? "") : "";
        const rest = r.filter((_, i) => i !== tagsIdx);
        return [tagsVal, ...rest];
      });
    }

    // Restore other user columns into schema if session had them but CSV didn't
    for (const uc of userColumns) {
      if (!columns.includes(uc)) {
        columns.push(uc);
        rows = rows.map((r) => [...r, ""]);
      }
    }

    const rowHighlights: Record<number, string> = {};
    if (session?.rowHighlights) {
      for (const [k, v] of Object.entries(session.rowHighlights)) {
        rowHighlights[Number(k)] = v;
      }
    }

    const tab: DatasetTab = {
      id: dataset.id,
      fileName: dataset.fileName,
      originalPath: dataset.originalPath,
      workingCopyPath: dataset.workingCopyPath,
      columns,
      columnOrder: normalizeColumnOrder(columns, session?.columnOrder),
      rows,
      totalLines: rows.length,
      taggedLines: new Set(session?.taggedLines ?? []),
      columnFilters: {},
      advancedFilter: session?.advancedFilter ?? null,
      formatRules: session?.formatRules ?? [],
      globalSearch: "",
      hiddenColumns: new Set(session?.hiddenColumns ?? []),
      columnWidths: { ...initWidths(columns), ...(session?.columnWidths ?? {}) },
      wordWrap: session?.wordWrap ?? false,
      groupByColumns: session?.groupByColumns ?? [],
      expandedGroups: new Set(),
      groupSort: "label",
      showHistogram: false,
      histogramOpenedOnce: false,
      histogramHeight: session?.histogramHeight ?? 160,
      timestampColumn: detectTimestampColumn(columns, rows),
      timeRangeFilter: null,
      sortColumn: session?.sortColumn ?? null,
      sortDir: session?.sortDir === "asc" || session?.sortDir === "desc"
        ? session.sortDir
        : null,
      displayTimezone: session?.displayTimezone ?? null,
      timestampAssumeUtc: session?.timestampAssumeUtc ?? true,
      showColumnChooser: false,
      showFilterEditor: false,
      showFormatPanel: false,
      showDag: false,
      showDagMapping: false,
      dagMapping: session?.dagMapping ?? null,
      dagShowFiles: true,
      dagShowNetwork: true,
      dagPinnedDetailFields: session?.dagPinnedDetailFields ?? [],
      showMind: false,
      showMindMapping: false,
      mindMapping: session?.mindMapping ?? null,
      focusLine: null,
      userColumns,
      rowHighlights,
      columnHighlights: { ...(session?.columnHighlights ?? {}) },
      columnTags: { ...(session?.columnTags ?? {}) },
      cellTags: { ...(session?.cellTags ?? {}) },
    };
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
    }));
  },

  closeTab: (id) => {
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      let activeTabId = s.activeTabId;
      if (activeTabId === id) {
        activeTabId = tabs.length ? tabs[tabs.length - 1].id : null;
      }
      return { tabs, activeTabId };
    });
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  updateTab: (id, patch) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== id) return t;
        const next = { ...t, ...patch };
        if (patch.showHistogram === true) next.histogramOpenedOnce = true;
        return next;
      }),
    }));
  },

  toggleTag: (tabId, line) => {
    patchTab(set, tabId, (t) => {
      const next = new Set(t.taggedLines);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return { ...t, taggedLines: next };
    });
  },

  setColumnFilter: (tabId, column, raw) => {
    const spec = parseFilterInput(raw);
    get().setColumnFilterSpec(tabId, column, spec);
  },

  setColumnFilterSpec: (tabId, column, filter) => {
    patchTab(set, tabId, (t) => {
      const columnFilters = { ...t.columnFilters };
      if (!filter) delete columnFilters[column];
      else columnFilters[column] = filter;
      return { ...t, columnFilters };
    });
  },

  includeCellValue: (tabId, column, value) => {
    get().setColumnFilterSpec(tabId, column, { mode: "equals", value });
  },

  excludeCellValue: (tabId, column, value) => {
    patchTab(set, tabId, (t) => {
      const existing = t.columnFilters[column];
      const values =
        existing?.mode === "excludes"
          ? [...new Set([...existing.values, value])]
          : [value];
      return {
        ...t,
        columnFilters: {
          ...t.columnFilters,
          [column]: { mode: "excludes", values },
        },
      };
    });
  },

  clearColumnFilters: (tabId) => {
    patchTab(set, tabId, (t) => ({
      ...t,
      columnFilters: {},
      advancedFilter: null,
    }));
  },

  setGlobalSearch: (tabId, value) => {
    patchTab(set, tabId, (t) => ({ ...t, globalSearch: value }));
  },

  setColumnWidth: (tabId, column, width, resizeAll = false) => {
    const w = Math.max(48, width);
    patchTab(set, tabId, (t) => {
      if (resizeAll) {
        const next: Record<string, number> = { ...t.columnWidths };
        for (const c of t.columns) {
          if (!t.hiddenColumns.has(c)) next[c] = w;
        }
        return { ...t, columnWidths: next };
      }
      return { ...t, columnWidths: { ...t.columnWidths, [column]: w } };
    });
  },

  equalizeColumns: (tabId) => {
    patchTab(set, tabId, (t) => {
      const next = { ...t.columnWidths };
      for (const c of t.columns) next[c] = DEFAULT_COL_WIDTH;
      next[LINE_COL] = LINE_COL_WIDTH;
      next[TAG_COL] = TAG_COL_WIDTH;
      return { ...t, columnWidths: next };
    });
  },

  reorderColumn: (tabId, dragged, target, place) => {
    if (dragged === LINE_COL || dragged === TAG_COL) return;
    if (target === LINE_COL || target === TAG_COL) return;
    patchTab(set, tabId, (t) => {
      if (!t.columns.includes(dragged) || !t.columns.includes(target)) return t;
      const columnOrder = moveColumnInOrder(
        normalizeColumnOrder(t.columns, t.columnOrder),
        dragged,
        target,
        place,
      );
      return { ...t, columnOrder };
    });
  },

  moveColumn: (tabId, column, delta) => {
    if (column === LINE_COL || column === TAG_COL) return;
    patchTab(set, tabId, (t) => {
      if (!t.columns.includes(column)) return t;
      const order = normalizeColumnOrder(t.columns, t.columnOrder);
      const i = order.indexOf(column);
      if (i < 0) return t;
      const j = i + delta;
      if (j < 0 || j >= order.length) return t;
      const next = [...order];
      next.splice(i, 1);
      next.splice(j, 0, column);
      return { ...t, columnOrder: next };
    });
  },

  addGroupBy: (tabId, column) => {
    if (column === LINE_COL || column === TAG_COL) return;
    patchTab(set, tabId, (t) => {
      if (t.groupByColumns.includes(column)) return t;
      return {
        ...t,
        groupByColumns: [...t.groupByColumns, column],
        // New groupings start collapsed (summary rows only)
        expandedGroups: new Set(),
      };
    });
  },

  removeGroupBy: (tabId, column) => {
    patchTab(set, tabId, (t) => ({
      ...t,
      groupByColumns: t.groupByColumns.filter((c) => c !== column),
      expandedGroups: new Set(),
    }));
  },

  toggleGroupCollapsed: (tabId, groupId) => {
    patchTab(set, tabId, (t) => {
      const next = new Set(t.expandedGroups);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return { ...t, expandedGroups: next };
    });
  },

  expandAllGroups: (tabId, groupIds) => {
    patchTab(set, tabId, (t) => ({
      ...t,
      expandedGroups: new Set(groupIds),
    }));
  },

  collapseAllGroups: (tabId) => {
    patchTab(set, tabId, (t) => ({ ...t, expandedGroups: new Set() }));
  },

  cycleGroupSort: (tabId) => {
    patchTab(set, tabId, (t) => {
      const order = ["label", "count-desc", "count-asc"] as const;
      const i = order.indexOf(t.groupSort);
      return { ...t, groupSort: order[(i + 1) % order.length] };
    });
  },

  addUserColumn: (tabId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    patchTab(set, tabId, (t) => {
      if (t.columns.includes(trimmed)) return t;
      const userColumns = new Set(t.userColumns);
      userColumns.add(trimmed);
      // Tags stays first among data columns (after Line / Tag checkbox in the grid)
      const columns =
        trimmed === TAGS_COL ? [TAGS_COL, ...t.columns] : [...t.columns, trimmed];
      const rows = t.rows.map((r) =>
        trimmed === TAGS_COL ? ["", ...r] : [...r, ""],
      );
      const baseOrder = normalizeColumnOrder(t.columns, t.columnOrder);
      const columnOrder =
        trimmed === TAGS_COL
          ? [TAGS_COL, ...baseOrder.filter((c) => c !== TAGS_COL)]
          : [...baseOrder, trimmed];
      return {
        ...t,
        columns,
        columnOrder,
        rows,
        userColumns,
        columnWidths: { ...t.columnWidths, [trimmed]: DEFAULT_COL_WIDTH },
      };
    });
  },

  setCellValue: (tabId, line, column, value) => {
    patchTab(set, tabId, (t) => {
      const idx = t.columns.indexOf(column);
      if (idx < 0) return t;
      const rowIdx = line - 1;
      if (rowIdx < 0 || rowIdx >= t.rows.length) return t;
      const rows = t.rows.map((r, i) => {
        if (i !== rowIdx) return r;
        const next = [...r];
        next[idx] = value;
        return next;
      });
      return { ...t, rows };
    });
  },

  setRowHighlight: (tabId, line, color) => {
    get().setRowHighlights(tabId, [line], color);
  },

  setRowHighlights: (tabId, lines, color) => {
    if (lines.length === 0) return;
    patchTab(set, tabId, (t) => {
      const rowHighlights = { ...t.rowHighlights };
      for (const line of lines) {
        if (color == null) delete rowHighlights[line];
        else rowHighlights[line] = color;
      }
      return { ...t, rowHighlights };
    });
  },

  clearRowHighlights: (tabId) => {
    patchTab(set, tabId, (t) => ({ ...t, rowHighlights: {} }));
  },

  setColumnHighlight: (tabId, column, color) => {
    get().setColumnHighlights(tabId, [column], color);
  },

  setColumnHighlights: (tabId, columns, color) => {
    if (columns.length === 0) return;
    patchTab(set, tabId, (t) => {
      const columnHighlights = { ...t.columnHighlights };
      for (const column of columns) {
        if (color == null) delete columnHighlights[column];
        else columnHighlights[column] = color;
      }
      return { ...t, columnHighlights };
    });
  },

  ensureTagsColumn: (tabId) => {
    const t = get().tabs.find((x) => x.id === tabId);
    if (!t) return;
    if (!t.columns.includes(TAGS_COL)) {
      get().addUserColumn(tabId, TAGS_COL);
    }
  },

  setRowTag: (tabId, line, tag) => {
    get().ensureTagsColumn(tabId);
    // re-read after ensure
    const t = get().tabs.find((x) => x.id === tabId);
    if (!t) return;
    get().setCellValue(tabId, line, TAGS_COL, tag);
  },

  setColumnTag: (tabId, column, tag) => {
    get().setColumnTags(tabId, [column], tag);
  },

  setColumnTags: (tabId, columns, tag) => {
    if (columns.length === 0) return;
    patchTab(set, tabId, (t) => {
      const columnTags = { ...t.columnTags };
      for (const column of columns) {
        if (!tag) delete columnTags[column];
        else columnTags[column] = tag;
      }
      return { ...t, columnTags };
    });
  },

  setCellTag: (tabId, line, column, tag) => {
    get().setCellTags(tabId, [{ line, column }], tag);
  },

  setCellTags: (tabId, cells, tag) => {
    if (cells.length === 0) return;
    patchTab(set, tabId, (t) => {
      const cellTags = { ...t.cellTags };
      for (const { line, column } of cells) {
        const key = cellTagKey(line, column);
        if (!tag) delete cellTags[key];
        else cellTags[key] = tag;
      }
      return { ...t, cellTags };
    });
  },

  setSearchOptions: (opts) =>
    set((s) => ({ searchOptions: { ...s.searchOptions, ...opts } })),

  setSearchOptionsOpen: (open) => set({ searchOptionsOpen: open }),

  getActiveTab: () => {
    const s = get();
    return s.tabs.find((t) => t.id === s.activeTabId) ?? null;
  },
}));

export { nextHighlight, NOTES_COL, TAGS_COL };
export type { TimeRange };
