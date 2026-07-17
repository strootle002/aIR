import type {
  ColumnFilter,
  FilterNode,
  FilterOp,
  FormatRule,
  SearchOptions,
  TimeRange,
} from "./types";
import { LINE_COL, TAG_COL } from "./types";
import { looksLikeTimestampColumn, parseTimestamp } from "./timestamp";

export interface FilterableRow {
  line: number;
  tagged: boolean;
  cells: string[];
}

export type SortDir = "asc" | "desc";

function sampleIsTimestampColumn(
  rows: FilterableRow[],
  colIdx: number,
  assumeUtc: boolean,
): boolean {
  let ok = 0;
  let nonEmpty = 0;
  const n = Math.min(rows.length, 40);
  for (let i = 0; i < n; i++) {
    const v = (rows[i]?.cells[colIdx] ?? "").trim();
    if (!v) continue;
    nonEmpty += 1;
    if (parseTimestamp(v, { assumeUtc }) != null) ok += 1;
  }
  return nonEmpty > 0 && ok / nonEmpty >= 0.6;
}

function compareCellValues(
  a: string,
  b: string,
  asTimestamp: boolean,
  assumeUtc: boolean,
): number {
  if (asTimestamp) {
    const ta = parseTimestamp(a, { assumeUtc });
    const tb = parseTimestamp(b, { assumeUtc });
    if (ta == null && tb == null) return a.localeCompare(b);
    if (ta == null) return 1;
    if (tb == null) return -1;
    return ta - tb;
  }
  const na = Number(a);
  const nb = Number(b);
  if (
    a.trim() !== "" &&
    b.trim() !== "" &&
    Number.isFinite(na) &&
    Number.isFinite(nb)
  ) {
    return na - nb;
  }
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** Sort filtered rows by column. Timestamp-like columns sort by parsed epoch ms. */
export function sortFilterableRows(
  rows: FilterableRow[],
  columns: string[],
  sortColumn: string | null | undefined,
  sortDir: SortDir | null | undefined,
  opts?: {
    timestampColumn?: string | null;
    assumeUtc?: boolean;
  },
): FilterableRow[] {
  if (!sortColumn || !sortDir) return rows;
  const colIdx = columns.indexOf(sortColumn);
  if (colIdx < 0) return rows;
  const assumeUtc = Boolean(opts?.assumeUtc);
  const asTimestamp =
    sortColumn === opts?.timestampColumn ||
    looksLikeTimestampColumn(sortColumn) ||
    sampleIsTimestampColumn(rows, colIdx, assumeUtc);
  const dir = sortDir === "asc" ? 1 : -1;
  const sorted = [...rows];
  sorted.sort((ra, rb) => {
    const cmp = compareCellValues(
      ra.cells[colIdx] ?? "",
      rb.cells[colIdx] ?? "",
      asTimestamp,
      assumeUtc,
    );
    return cmp * dir || ra.line - rb.line;
  });
  return sorted;
}

export function applyFilters(
  rows: string[][],
  columns: string[],
  columnFilters: Record<string, ColumnFilter>,
  globalSearch: string,
  searchOptions: SearchOptions,
  taggedLines: Set<number>,
  timeRange: TimeRange | null,
  timestampColumn: string | null,
  advancedFilter: FilterNode | null = null,
): FilterableRow[] {
  const colIndex = new Map(columns.map((c, i) => [c, i]));
  const activeFilters = Object.entries(columnFilters);
  const needle = globalSearch.trim();
  const tsIdx =
    timestampColumn && colIndex.has(timestampColumn)
      ? colIndex.get(timestampColumn)!
      : null;

  const result: FilterableRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const line = i + 1;
    const cells = rows[i];

    let pass = true;
    for (const [col, filter] of activeFilters) {
      const cellValue = getCellValue(col, line, cells, colIndex, taggedLines);
      if (!matchFilter(cellValue, filter, searchOptions)) {
        pass = false;
        break;
      }
    }
    if (!pass) continue;

    if (needle) {
      const haystacks = [String(line), ...cells];
      const found = haystacks.some((h) =>
        matchText(h, needle, searchOptions),
      );
      if (!found) continue;
    }

    if (timeRange && tsIdx !== null) {
      const t = parseTimestamp(cells[tsIdx] ?? "");
      if (t == null || t < timeRange.start || t > timeRange.end) continue;
    }

    if (
      advancedFilter &&
      !evalFilterNode(
        advancedFilter,
        line,
        cells,
        colIndex,
        taggedLines,
        searchOptions,
      )
    ) {
      continue;
    }

    result.push({
      line,
      tagged: taggedLines.has(line),
      cells,
    });
  }

  return result;
}

export function evalFilterNode(
  node: FilterNode,
  line: number,
  cells: string[],
  colIndex: Map<string, number>,
  taggedLines: Set<number>,
  opts: SearchOptions,
): boolean {
  if (node.kind === "rule") {
    const cellValue = getCellValue(
      node.column,
      line,
      cells,
      colIndex,
      taggedLines,
    );
    return matchOp(cellValue, node.op, node.value, opts);
  }

  if (node.children.length === 0) return true;
  const results = node.children.map((child) =>
    evalFilterNode(child, line, cells, colIndex, taggedLines, opts),
  );
  let ok =
    node.join === "and" ? results.every(Boolean) : results.some(Boolean);
  if (node.not) ok = !ok;
  return ok;
}

function matchOp(
  cellValue: string,
  op: FilterOp,
  value: string,
  opts: SearchOptions,
): boolean {
  switch (op) {
    case "contains":
      return matchText(cellValue, value, opts);
    case "notContains":
      return !matchText(cellValue, value, opts);
    case "equals":
      return opts.caseSensitive
        ? cellValue === value
        : cellValue.toLowerCase() === value.toLowerCase();
    case "notEquals":
      return opts.caseSensitive
        ? cellValue !== value
        : cellValue.toLowerCase() !== value.toLowerCase();
    case "beginsWith": {
      const hay = opts.caseSensitive ? cellValue : cellValue.toLowerCase();
      const needle = opts.caseSensitive ? value : value.toLowerCase();
      return hay.startsWith(needle);
    }
    case "isEmpty":
      return cellValue.trim() === "";
    case "isNotEmpty":
      return cellValue.trim() !== "";
    default:
      return true;
  }
}

export function getCellValue(
  col: string,
  line: number,
  cells: string[],
  colIndex: Map<string, number>,
  taggedLines: Set<number>,
): string {
  if (col === LINE_COL) return String(line);
  if (col === TAG_COL) return taggedLines.has(line) ? "1" : "0";
  const idx = colIndex.get(col);
  if (idx === undefined) return "";
  return cells[idx] ?? "";
}

function matchFilter(
  cellValue: string,
  filter: ColumnFilter,
  opts: SearchOptions,
): boolean {
  if (filter.mode === "contains") {
    if (!filter.value.trim()) return true;
    return matchText(cellValue, filter.value, opts);
  }
  if (filter.mode === "equals") {
    if (opts.caseSensitive) return cellValue === filter.value;
    return cellValue.toLowerCase() === filter.value.toLowerCase();
  }
  for (const v of filter.values) {
    if (opts.caseSensitive) {
      if (cellValue === v) return false;
    } else if (cellValue.toLowerCase() === v.toLowerCase()) {
      return false;
    }
  }
  return true;
}

function matchText(value: string, filter: string, opts: SearchOptions): boolean {
  let hay = value;
  let needle = filter;
  if (!opts.caseSensitive) {
    hay = hay.toLowerCase();
    needle = needle.toLowerCase();
  }
  if (opts.wholeWord) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const flags = opts.caseSensitive ? "u" : "iu";
    return new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`, flags).test(value);
  }
  return hay.includes(needle);
}

/** Resolve conditional format for a row/cell. Manual highlights handled by caller. */
export function matchFormatRules(
  rules: FormatRule[],
  columns: string[],
  cells: string[],
  line: number,
  taggedLines: Set<number>,
): { rowStyle?: FormatRule; cellStyles: Record<string, FormatRule> } {
  const colIndex = new Map(columns.map((c, i) => [c, i]));
  let rowStyle: FormatRule | undefined;
  const cellStyles: Record<string, FormatRule> = {};
  const opts = { caseSensitive: false, wholeWord: false };

  for (const rule of rules) {
    if (!rule.value && (rule.op === "equals" || rule.op === "beginsWith")) {
      continue;
    }
    const cols =
      rule.column === "*"
        ? columns
        : rule.column === LINE_COL || rule.column === TAG_COL
          ? [rule.column]
          : columns.includes(rule.column)
            ? [rule.column]
            : [];

    for (const col of cols) {
      const val = getCellValue(col, line, cells, colIndex, taggedLines);
      const hit =
        rule.op === "contains"
          ? matchText(val, rule.value, opts)
          : rule.op === "equals"
            ? val.toLowerCase() === rule.value.toLowerCase()
            : val.toLowerCase().startsWith(rule.value.toLowerCase());
      if (!hit) continue;
      if (rule.applyTo === "row") {
        rowStyle = rule;
      } else {
        cellStyles[col] = rule;
      }
    }
  }

  return { rowStyle, cellStyles };
}

export type GroupSort = "label" | "count-desc" | "count-asc";

export type FlatGridItem =
  | {
      kind: "group";
      id: string;
      label: string;
      count: number;
      depth: number;
      collapsed: boolean;
    }
  | { kind: "row"; row: FilterableRow; depth: number };

export function collectGroupIds(
  rows: FilterableRow[],
  columns: string[],
  groupByColumns: string[],
): string[] {
  if (groupByColumns.length === 0) return [];
  const colIndex = new Map(columns.map((c, i) => [c, i]));
  const ids: string[] = [];

  function walk(subset: FilterableRow[], depth: number, parentPath: string) {
    if (depth >= groupByColumns.length) return;
    const col = groupByColumns[depth];
    const buckets = new Map<string, FilterableRow[]>();
    for (const row of subset) {
      const key = groupValue(row, col, colIndex);
      let list = buckets.get(key);
      if (!list) {
        list = [];
        buckets.set(key, list);
      }
      list.push(row);
    }
    for (const [label, list] of buckets) {
      const id = parentPath ? `${parentPath}||${col}=${label}` : `${col}=${label}`;
      ids.push(id);
      walk(list, depth + 1, id);
    }
  }

  walk(rows, 0, "");
  return ids;
}

function groupValue(
  row: FilterableRow,
  col: string,
  colIndex: Map<string, number>,
): string {
  if (col === LINE_COL) return String(row.line);
  if (col === TAG_COL) return row.tagged ? "1" : "0";
  const idx = colIndex.get(col);
  const val = idx === undefined ? "" : (row.cells[idx] ?? "");
  return val || "(blank)";
}

export function buildGroupedRows(
  rows: FilterableRow[],
  columns: string[],
  groupByColumns: string[],
  expandedGroups: Set<string>,
  groupSort: GroupSort = "label",
): FlatGridItem[] {
  if (groupByColumns.length === 0) {
    return rows.map((row) => ({ kind: "row" as const, row, depth: 0 }));
  }

  const colIndex = new Map(columns.map((c, i) => [c, i]));
  const out: FlatGridItem[] = [];

  function walk(
    subset: FilterableRow[],
    depth: number,
    parentPath: string,
  ) {
    if (depth >= groupByColumns.length) {
      for (const row of subset) {
        out.push({ kind: "row", row, depth });
      }
      return;
    }

    const col = groupByColumns[depth];
    const buckets = new Map<string, FilterableRow[]>();
    for (const row of subset) {
      const key = groupValue(row, col, colIndex);
      let list = buckets.get(key);
      if (!list) {
        list = [];
        buckets.set(key, list);
      }
      list.push(row);
    }

    let entries = [...buckets.entries()];
    if (groupSort === "count-desc") {
      entries.sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    } else if (groupSort === "count-asc") {
      entries.sort((a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0]));
    } else {
      entries.sort((a, b) => a[0].localeCompare(b[0]));
    }

    for (const [label, list] of entries) {
      const id = parentPath ? `${parentPath}||${col}=${label}` : `${col}=${label}`;
      // Default collapsed unless explicitly expanded
      const collapsed = !expandedGroups.has(id);
      out.push({
        kind: "group",
        id,
        label: `${col}: ${label}`,
        count: list.length,
        depth,
        collapsed,
      });
      if (!collapsed) walk(list, depth + 1, id);
    }
  }

  walk(rows, 0, "");
  return out;
}

export function filterInputDisplay(filter: ColumnFilter | undefined): string {
  if (!filter) return "";
  if (filter.mode === "contains") return filter.value;
  if (filter.mode === "equals") return `=${filter.value}`;
  return filter.values.map((v) => `!${v}`).join(" ");
}

export function parseFilterInput(raw: string): ColumnFilter | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.startsWith("=") && s.length > 1) {
    return { mode: "equals", value: s.slice(1) };
  }
  if (s.startsWith("!") || s.includes(" !")) {
    const parts = s
      .split(/\s+/)
      .map((p) => (p.startsWith("!") ? p.slice(1) : p))
      .filter(Boolean);
    if (parts.length === 0) return null;
    return { mode: "excludes", values: parts };
  }
  return { mode: "contains", value: raw };
}
