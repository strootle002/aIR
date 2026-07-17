export interface ImportedDataset {
  id: string;
  fileName: string;
  originalPath: string;
  workingCopyPath: string;
  workspaceDir: string;
  columns: string[];
  rows: string[][];
  totalLines: number;
}

export interface SessionData {
  workingCopyPath: string;
  taggedLines: number[];
  columnWidths: Record<string, number>;
  hiddenColumns: string[];
  wordWrap: boolean;
  /** Display order of data columns (Line/Tag stay fixed). Persisted in session. */
  columnOrder?: string[];
  groupByColumns?: string[];
  userColumns?: string[];
  rowHighlights?: Record<string, string>;
  columnHighlights?: Record<string, string>;
  columnTags?: Record<string, string>;
  cellTags?: Record<string, string>;
  histogramHeight?: number;
  advancedFilter?: FilterNode | null;
  formatRules?: FormatRule[];
  dagMapping?: DagMapping | null;
  /** Column names always shown first in aChart event details */
  dagPinnedDetailFields?: string[];
  mindMapping?: MindMapping | null;
  sortColumn?: string | null;
  sortDir?: "asc" | "desc" | null;
  displayTimezone?: string | null;
  timestampAssumeUtc?: boolean;
}

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
}

export interface TimeRange {
  start: number;
  end: number;
}

/** Per-column filter: contains (default), equals (include), or excludes list */
export type ColumnFilter =
  | { mode: "contains"; value: string }
  | { mode: "equals"; value: string }
  | { mode: "excludes"; values: string[] };

export type FilterOp =
  | "contains"
  | "notContains"
  | "equals"
  | "notEquals"
  | "beginsWith"
  | "isEmpty"
  | "isNotEmpty";

export type FilterNode =
  | { kind: "group"; join: "and" | "or"; not?: boolean; children: FilterNode[] }
  | { kind: "rule"; column: string; op: FilterOp; value: string };

export type FormatRule = {
  id: string;
  column: string; // "*" = any column
  op: "contains" | "equals" | "beginsWith";
  value: string;
  applyTo: "cell" | "row";
  background: string;
  textColor?: string;
  bold?: boolean;
};

export type TrajectoryGlyphId =
  | "spawn"
  | "processCreate"
  | "fileCreate"
  | "networkConnect"
  | "dnsQuery"
  | "processTerminated"
  | "registry"
  | "processAccess"
  | "driverLoaded"
  | "other";

export type DagMapping = {
  processCol: string;
  parentCol: string;
  /** Event action / type column (e.g. event.action) — drives glyph classification */
  eventTypeCol?: string | null;
  /** Optional: disambiguate same-named processes (e.g. process.pid) */
  processPidCol?: string | null;
  /** Optional: link spawn by parent PID (e.g. parent.process.pid) */
  parentPidCol?: string | null;
  /**
   * Optional hostname / computer column (e.g. host.hostname).
   * When set with hostValue, aChart is limited to that host.
   */
  hostCol?: string | null;
  /** Selected hostname value when hostCol is mapped */
  hostValue?: string | null;
  /**
   * Per-value map: raw event.action string → glyph id.
   * Built from the glyph-centric mapping UI.
   */
  actionGlyphMap?: Record<string, TrajectoryGlyphId>;
  /** Glyph types the user chose not to put on the map */
  disabledGlyphs?: TrajectoryGlyphId[];
};

/** aMind: ordered column pivot → tree mindmap */
export type MindMapping = {
  levelColumns: string[];
  rootLabel?: string;
};

/** True for empty / null-like field values that should be hidden in detail UIs */
export function isBlankField(v: unknown): boolean {
  if (v == null) return true;
  const t = String(v).trim();
  return (
    !t ||
    /^(null|none|n\/a|nil|undefined|-|—|\(empty\)|\(null\))$/i.test(t)
  );
}

export interface DatasetTab {
  id: string;
  fileName: string;
  originalPath: string;
  workingCopyPath: string;
  columns: string[];
  /** Display order for grid headers (subset/superset sanitized against columns) */
  columnOrder: string[];
  /** Raw data rows (without Line/Tag checkbox) */
  rows: string[][];
  totalLines: number;
  /** Checkbox "flagged" rows (legacy Tag column) */
  taggedLines: Set<number>;
  columnFilters: Record<string, ColumnFilter>;
  advancedFilter: FilterNode | null;
  formatRules: FormatRule[];
  globalSearch: string;
  hiddenColumns: Set<string>;
  columnWidths: Record<string, number>;
  wordWrap: boolean;
  groupByColumns: string[];
  /** Group ids that are expanded; all others render collapsed (summary only) */
  expandedGroups: Set<string>;
  /** How sibling groups are ordered */
  groupSort: "label" | "count-desc" | "count-asc";
  showHistogram: boolean;
  /** True after the timeline graph has been opened at least once (enables reopen strip) */
  histogramOpenedOnce: boolean;
  histogramHeight: number;
  timestampColumn: string | null;
  timeRangeFilter: TimeRange | null;
  /** Grid sort column (data column name); null = CSV order */
  sortColumn: string | null;
  sortDir: "asc" | "desc" | null;
  /**
   * IANA timezone for displaying timestamp cells (null = show original strings).
   * Does not mutate underlying CSV values.
   */
  displayTimezone: string | null;
  /** When true, timezone-naive timestamps are treated as UTC for sort/display */
  timestampAssumeUtc: boolean;
  showColumnChooser: boolean;
  showFilterEditor: boolean;
  showFormatPanel: boolean;
  showDag: boolean;
  showDagMapping: boolean;
  dagMapping: DagMapping | null;
  dagShowFiles: boolean;
  dagShowNetwork: boolean;
  /** Column names always shown first in aChart event details */
  dagPinnedDetailFields: string[];
  showMind: boolean;
  showMindMapping: boolean;
  mindMapping: MindMapping | null;
  /** Scroll the main grid to this CSV line (one-shot; cleared after scroll) */
  focusLine: number | null;
  /** Columns added by the user (Notes, Tags, …) — editable */
  userColumns: Set<string>;
  rowHighlights: Record<number, string>;
  columnHighlights: Record<string, string>;
  columnTags: Record<string, string>;
  /** key: `${line}:${column}` */
  cellTags: Record<string, string>;
}

export const LINE_COL = "__line__";
export const TAG_COL = "__tag__";
export const TAGS_COL = "Tags";
export const NOTES_COL = "Notes";

export const DEFAULT_COL_WIDTH = 140;
export const LINE_COL_WIDTH = 64;
export const TAG_COL_WIDTH = 48;
export const MIN_COL_WIDTH = 48;

export const HIGHLIGHT_COLORS = [
  "#3d5a40",
  "#3d4a5a",
  "#5a4a3d",
  "#4a3d5a",
  "#5a3d3d",
] as const;

export const FORMAT_PRESET_COLORS = [
  "#5a3d3d",
  "#5a4a3d",
  "#3d5a40",
  "#3d4a5a",
  "#4a3d5a",
  "#5a3d4a",
] as const;

export function cellTagKey(line: number, column: string): string {
  return `${line}:${column}`;
}

export function emptyFilterGroup(): FilterNode {
  return { kind: "group", join: "and", children: [] };
}

export function newFormatRule(): FormatRule {
  return {
    id: crypto.randomUUID(),
    column: "*",
    op: "contains",
    value: "",
    applyTo: "row",
    background: FORMAT_PRESET_COLORS[0],
    bold: false,
  };
}
