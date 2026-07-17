import {
  useMemo,
  useRef,
  useEffect,
  useCallback,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTabsStore, nextHighlight } from "../stores/tabsStore";
import {
  buildGroupedRows,
  collectGroupIds,
  filterInputDisplay,
  matchFormatRules,
  type FilterableRow,
  type FlatGridItem,
} from "../lib/filters";
import {
  DEFAULT_COL_WIDTH,
  LINE_COL,
  LINE_COL_WIDTH,
  MIN_COL_WIDTH,
  TAG_COL,
  TAG_COL_WIDTH,
  TAGS_COL,
  cellTagKey,
} from "../lib/types";
import {
  US_DISPLAY_TIMEZONES,
  formatTimestampDisplay,
  looksLikeTimestampColumn,
  timezoneLabel,
} from "../lib/timestamp";
import { ContextMenu, type ContextMenuItem, type ContextMenuState } from "./ContextMenu";
import { CellDetailModal, type CellDetailState } from "./CellDetailModal";

interface DataGridProps {
  rows: FilterableRow[];
}

type GridSelection =
  | { kind: "cells"; lines: number[]; columns: string[] }
  | { kind: "columns"; columns: string[] };

type SelectDrag =
  | {
      mode: "cells";
      pointerId: number;
      anchorLine: number;
      anchorCol: string;
      startX: number;
      startY: number;
      active: boolean;
    }
  | {
      mode: "columns";
      pointerId: number;
      anchorCol: string;
      startX: number;
      startY: number;
      active: boolean;
    };

function sliceRange<T>(items: T[], a: T, b: T): T[] {
  const i = items.indexOf(a);
  const j = items.indexOf(b);
  if (i < 0 || j < 0) return [];
  const lo = Math.min(i, j);
  const hi = Math.max(i, j);
  return items.slice(lo, hi + 1);
}

function isMetaColumn(id: string): boolean {
  return id === LINE_COL || id === TAG_COL;
}

function selectionHasCell(
  sel: GridSelection | null,
  line: number,
  column: string,
): boolean {
  if (!sel) return false;
  if (sel.kind === "columns") return sel.columns.includes(column);
  return sel.lines.includes(line) && sel.columns.includes(column);
}

export function DataGrid({ rows }: DataGridProps) {
  const tab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId)!);
  const toggleTag = useTabsStore((s) => s.toggleTag);
  const setColumnFilter = useTabsStore((s) => s.setColumnFilter);
  const setColumnFilterSpec = useTabsStore((s) => s.setColumnFilterSpec);
  const clearColumnFilters = useTabsStore((s) => s.clearColumnFilters);
  const setColumnWidth = useTabsStore((s) => s.setColumnWidth);
  const setGlobalSearch = useTabsStore((s) => s.setGlobalSearch);
  const updateTab = useTabsStore((s) => s.updateTab);
  const addGroupBy = useTabsStore((s) => s.addGroupBy);
  const removeGroupBy = useTabsStore((s) => s.removeGroupBy);
  const toggleGroupCollapsed = useTabsStore((s) => s.toggleGroupCollapsed);
  const expandAllGroups = useTabsStore((s) => s.expandAllGroups);
  const collapseAllGroups = useTabsStore((s) => s.collapseAllGroups);
  const cycleGroupSort = useTabsStore((s) => s.cycleGroupSort);
  const includeCellValue = useTabsStore((s) => s.includeCellValue);
  const excludeCellValue = useTabsStore((s) => s.excludeCellValue);
  const setCellValue = useTabsStore((s) => s.setCellValue);
  const setRowHighlights = useTabsStore((s) => s.setRowHighlights);
  const clearRowHighlights = useTabsStore((s) => s.clearRowHighlights);
  const setColumnHighlights = useTabsStore((s) => s.setColumnHighlights);
  const setRowTag = useTabsStore((s) => s.setRowTag);
  const setColumnTags = useTabsStore((s) => s.setColumnTags);
  const setCellTags = useTabsStore((s) => s.setCellTags);
  const ensureTagsColumn = useTabsStore((s) => s.ensureTagsColumn);
  const reorderColumn = useTabsStore((s) => s.reorderColumn);

  const parentRef = useRef<HTMLDivElement>(null);
  const chromeInnerRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [cellDetail, setCellDetail] = useState<CellDetailState | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState(false);
  /** HTML5 drag source column (React state for opacity; ref for dragover reliability) */
  const draggingColRef = useRef<string | null>(null);
  const [draggingCol, setDraggingCol] = useState<string | null>(null);
  const colDropRef = useRef<{ id: string; place: "before" | "after" } | null>(
    null,
  );
  const headerRowRef = useRef<HTMLDivElement>(null);
  const dropLineRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<GridSelection | null>(null);
  const selectDrag = useRef<SelectDrag | null>(null);
  /** Ignore the click that ends a Ctrl+select gesture so selection isn't wiped immediately */
  const suppressClearClick = useRef(false);

  const visibleColumns = useMemo(() => {
    const order =
      tab.columnOrder?.length > 0 ? tab.columnOrder : tab.columns;
    return order.filter(
      (c) => tab.columns.includes(c) && !tab.hiddenColumns.has(c),
    );
  }, [tab.columns, tab.columnOrder, tab.hiddenColumns]);

  const allHeaders = useMemo(
    () => [
      { id: LINE_COL, label: "Line", width: tab.columnWidths[LINE_COL] ?? LINE_COL_WIDTH },
      { id: TAG_COL, label: "Tag", width: tab.columnWidths[TAG_COL] ?? TAG_COL_WIDTH },
      ...visibleColumns.map((c) => ({
        id: c,
        label: c,
        width: tab.columnWidths[c] ?? DEFAULT_COL_WIDTH,
      })),
    ],
    [visibleColumns, tab.columnWidths],
  );

  const headerIds = useMemo(() => allHeaders.map((h) => h.id), [allHeaders]);

  const totalWidth = allHeaders.reduce((sum, h) => sum + h.width, 0);
  const hasActiveFilters =
    Object.keys(tab.columnFilters).length > 0 ||
    Boolean(tab.advancedFilter) ||
    Boolean(tab.timeRangeFilter);
  const hasSearch = tab.globalSearch.trim() !== "";
  const hasRowHighlights = Object.keys(tab.rowHighlights).length > 0;

  const activeColumnFilterChips = useMemo(() => {
    return Object.entries(tab.columnFilters).map(([column, filter]) => {
      if (filter.mode === "equals") {
        return {
          column,
          kind: "include" as const,
          label: `${column} = ${filter.value}`,
        };
      }
      if (filter.mode === "excludes") {
        return {
          column,
          kind: "exclude" as const,
          label: `${column} ≠ ${filter.values.join(", ")}`,
        };
      }
      return {
        column,
        kind: "contains" as const,
        label: `${column} contains “${filter.value}”`,
      };
    });
  }, [tab.columnFilters]);

  const flatItems: FlatGridItem[] = useMemo(
    () =>
      buildGroupedRows(
        rows,
        tab.columns,
        tab.groupByColumns,
        tab.expandedGroups,
        tab.groupSort,
      ),
    [rows, tab.columns, tab.groupByColumns, tab.expandedGroups, tab.groupSort],
  );

  const visibleLines = useMemo(
    () =>
      flatItems
        .filter((item): item is Extract<FlatGridItem, { kind: "row" }> => item.kind === "row")
        .map((item) => item.row.line),
    [flatItems],
  );

  const allGroupIds = useMemo(
    () =>
      tab.groupByColumns.length
        ? collectGroupIds(rows, tab.columns, tab.groupByColumns)
        : [],
    [rows, tab.columns, tab.groupByColumns],
  );

  const groupSortLabel =
    tab.groupSort === "count-desc"
      ? "Sort: count ↓"
      : tab.groupSort === "count-asc"
        ? "Sort: count ↑"
        : "Sort: label";

  const GROUP_ROW_H = 30;

  const rowVirtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => {
      if (flatItems[i]?.kind === "group") return GROUP_ROW_H;
      return tab.wordWrap ? 48 : 28;
    },
    overscan: 5,
    // Positions items via DOM; requires measureElement ref on every row
    // so nodes land in the virtualizer element cache.
    directDomUpdates: true,
    measureElement:
      typeof window !== "undefined"
        ? (el) => {
            // Group rows are fixed-height; measuring them can inflate gaps.
            const index = Number(el.getAttribute("data-index"));
            if (flatItems[index]?.kind === "group") return GROUP_ROW_H;
            return el.getBoundingClientRect().height;
          }
        : undefined,
  });

  const colIndex = useMemo(() => {
    const m = new Map<string, number>();
    tab.columns.forEach((c, i) => m.set(c, i));
    return m;
  }, [tab.columns]);

  const formatByLine = useMemo(() => {
    const map = new Map<
      number,
      ReturnType<typeof matchFormatRules>
    >();
    if (!tab.formatRules.length) return map;
    for (const item of flatItems) {
      if (item.kind !== "row") continue;
      const row = item.row;
      map.set(
        row.line,
        matchFormatRules(
          tab.formatRules,
          tab.columns,
          row.cells,
          row.line,
          tab.taggedLines,
        ),
      );
    }
    return map;
  }, [flatItems, tab.formatRules, tab.columns, tab.taggedLines]);

  const selectedLineSet = useMemo(() => {
    if (selection?.kind !== "cells") return null;
    return new Set(selection.lines);
  }, [selection]);

  const selectedColSet = useMemo(() => {
    if (!selection) return null;
    return new Set(selection.columns);
  }, [selection]);

  useEffect(() => {
    rowVirtualizer.measure();
  }, [tab.wordWrap, totalWidth, flatItems.length, rowVirtualizer]);

  // One-shot jump from aChart "Show in grid"
  useEffect(() => {
    if (tab.focusLine == null) return;
    const line = tab.focusLine;
    const idx = flatItems.findIndex(
      (item) => item.kind === "row" && item.row.line === line,
    );
    if (idx < 0) {
      if (tab.groupByColumns.length > 0) {
        expandAllGroups(tab.id, allGroupIds);
        return; // keep focusLine; retry after groups expand
      }
      updateTab(tab.id, { focusLine: null });
      return;
    }
    const handle = requestAnimationFrame(() => {
      rowVirtualizer.scrollToIndex(idx, { align: "center", behavior: "smooth" });
      updateTab(tab.id, { focusLine: null });
    });
    return () => cancelAnimationFrame(handle);
  }, [
    tab.focusLine,
    tab.groupByColumns.length,
    tab.id,
    flatItems,
    allGroupIds,
    rowVirtualizer,
    expandAllGroups,
    updateTab,
  ]);

  const onWheel = useCallback((e: WheelEvent) => {
    if (!e.shiftKey || !parentRef.current) return;
    e.preventDefault();
    parentRef.current.scrollLeft += e.deltaY;
  }, []);

  const syncChromeScroll = useCallback(() => {
    const body = parentRef.current;
    const chrome = chromeInnerRef.current;
    if (!body || !chrome) return;
    chrome.style.transform = `translate3d(${-body.scrollLeft}px, 0, 0)`;
  }, []);

  useEffect(() => {
    syncChromeScroll();
  }, [totalWidth, syncChromeScroll]);

  const clearSelection = useCallback(() => setSelection(null), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenu(null);
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearSelection]);

  const hitCell = useCallback((clientX: number, clientY: number) => {
    const el = document.elementFromPoint(clientX, clientY);
    const cell = el?.closest("[data-grid-line][data-grid-col]") as HTMLElement | null;
    if (!cell) return null;
    const line = Number(cell.dataset.gridLine);
    const col = cell.dataset.gridCol;
    if (!Number.isFinite(line) || !col) return null;
    return { line, col };
  }, []);

  const hitHeaderCol = useCallback((clientX: number, clientY: number) => {
    const el = document.elementFromPoint(clientX, clientY);
    const header = el?.closest("[data-grid-header-col]") as HTMLElement | null;
    return header?.dataset.gridHeaderCol ?? null;
  }, []);

  const applyCellRange = useCallback(
    (anchorLine: number, anchorCol: string, line: number, col: string) => {
      const lines = sliceRange(visibleLines, anchorLine, line);
      const columns = sliceRange(headerIds, anchorCol, col);
      if (lines.length === 0 || columns.length === 0) return;
      setSelection({ kind: "cells", lines, columns });
    },
    [visibleLines, headerIds],
  );

  const applyColumnRange = useCallback(
    (anchorCol: string, col: string) => {
      const next = sliceRange(headerIds, anchorCol, col).filter(
        (id) => !isMetaColumn(id),
      );
      if (next.length === 0) return;
      setSelection({ kind: "columns", columns: next });
    },
    [headerIds],
  );

  const selectMoveRef = useRef<(ev: PointerEvent) => void>(() => {});
  const selectUpRef = useRef<(ev: PointerEvent) => void>(() => {});

  selectMoveRef.current = (ev: PointerEvent) => {
    const drag = selectDrag.current;
    if (!drag || ev.pointerId !== drag.pointerId) return;
    const dx = ev.clientX - drag.startX;
    const dy = ev.clientY - drag.startY;
    if (!drag.active && Math.hypot(dx, dy) < 4) return;
    drag.active = true;

    if (drag.mode === "cells") {
      const hit = hitCell(ev.clientX, ev.clientY);
      if (hit) applyCellRange(drag.anchorLine, drag.anchorCol, hit.line, hit.col);
    } else {
      const col = hitHeaderCol(ev.clientX, ev.clientY);
      if (col && !isMetaColumn(col)) applyColumnRange(drag.anchorCol, col);
    }
  };

  selectUpRef.current = (ev: PointerEvent) => {
    const drag = selectDrag.current;
    if (!drag || ev.pointerId !== drag.pointerId) return;
    suppressClearClick.current = true;
    selectDrag.current = null;
    window.removeEventListener("pointermove", onWindowSelectMove);
    window.removeEventListener("pointerup", onWindowSelectUp);
    window.removeEventListener("pointercancel", onWindowSelectUp);
  };

  function onWindowSelectMove(ev: PointerEvent) {
    selectMoveRef.current(ev);
  }
  function onWindowSelectUp(ev: PointerEvent) {
    selectUpRef.current(ev);
  }

  const beginCellSelect = (
    e: ReactPointerEvent,
    line: number,
    column: string,
  ) => {
    if (e.button !== 0) return;
    // Ctrl/Cmd+drag selects; plain drag keeps text select / copy-paste
    if (!e.ctrlKey && !e.metaKey) return;
    const target = e.target as HTMLElement;
    if (target.closest("input, button, a, .cell-edit")) return;
    e.preventDefault();
    setMenu(null);
    selectDrag.current = {
      mode: "cells",
      pointerId: e.pointerId,
      anchorLine: line,
      anchorCol: column,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
    setSelection({ kind: "cells", lines: [line], columns: [column] });
    window.addEventListener("pointermove", onWindowSelectMove);
    window.addEventListener("pointerup", onWindowSelectUp);
    window.addEventListener("pointercancel", onWindowSelectUp);
  };

  const beginColumnSelect = (e: ReactPointerEvent, columnId: string) => {
    if (e.button !== 0 || isMetaColumn(columnId)) return;
    // Ctrl/Cmd+drag selects columns; plain drag still groups via HTML5 drag
    if (!e.ctrlKey && !e.metaKey) return;
    const target = e.target as HTMLElement;
    if (target.closest(".col-resizer")) return;
    e.preventDefault();
    setMenu(null);
    selectDrag.current = {
      mode: "columns",
      pointerId: e.pointerId,
      anchorCol: columnId,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
    };
    setSelection({ kind: "columns", columns: [columnId] });
    window.addEventListener("pointermove", onWindowSelectMove);
    window.addEventListener("pointerup", onWindowSelectUp);
    window.addEventListener("pointercancel", onWindowSelectUp);
  };

  const hideColDropLine = useCallback(() => {
    colDropRef.current = null;
    const line = dropLineRef.current;
    if (line) {
      line.style.display = "none";
      line.style.opacity = "0";
    }
    headerRowRef.current
      ?.querySelectorAll(".col-drop-before, .col-drop-after")
      .forEach((el) => {
        el.classList.remove("col-drop-before", "col-drop-after");
      });
  }, []);

  const showColDropAt = useCallback(
    (columnId: string, place: "before" | "after", cell: HTMLElement) => {
      const prev = colDropRef.current;
      if (prev?.id === columnId && prev.place === place) return;
      colDropRef.current = { id: columnId, place };

      const row = headerRowRef.current;
      const line = dropLineRef.current;
      if (row && line) {
        const x =
          place === "before"
            ? cell.offsetLeft
            : cell.offsetLeft + cell.offsetWidth;
        line.style.display = "block";
        line.style.opacity = "1";
        line.style.left = `${Math.max(0, x - 2)}px`;
        line.style.height = `${row.offsetHeight}px`;
      }

      row
        ?.querySelectorAll(".col-drop-before, .col-drop-after")
        .forEach((el) => {
          el.classList.remove("col-drop-before", "col-drop-after");
        });
      cell.classList.add(
        place === "before" ? "col-drop-before" : "col-drop-after",
      );
    },
    [],
  );

  const onHeaderDragStart = (e: React.DragEvent, columnId: string) => {
    if (columnId === LINE_COL || columnId === TAG_COL) {
      e.preventDefault();
      return;
    }
    // Ctrl/Cmd column-select owns the gesture — block HTML5 group-by / reorder drag
    if (e.ctrlKey || e.metaKey || selectDrag.current?.mode === "columns") {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData("text/ag-column", columnId);
    e.dataTransfer.setData("text/plain", columnId);
    e.dataTransfer.effectAllowed = "copyMove";
    draggingColRef.current = columnId;
    setDraggingCol(columnId);
    hideColDropLine();
  };

  const onHeaderDragOver = (e: React.DragEvent, columnId: string) => {
    if (columnId === LINE_COL || columnId === TAG_COL) return;
    const dragged = draggingColRef.current;
    if (!dragged) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    if (dragged === columnId) {
      hideColDropLine();
      return;
    }
    const cell = e.currentTarget as HTMLElement;
    const rect = cell.getBoundingClientRect();
    const place: "before" | "after" =
      e.clientX < rect.left + rect.width / 2 ? "before" : "after";
    showColDropAt(columnId, place, cell);
  };

  const onHeaderRowDragOver = (e: React.DragEvent) => {
    const dragged = draggingColRef.current;
    if (!dragged) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    const row = headerRowRef.current;
    if (!row) return;
    const cells = row.querySelectorAll<HTMLElement>("[data-grid-header-col]");
    let target: HTMLElement | null = null;
    for (const cell of cells) {
      const id = cell.dataset.gridHeaderCol;
      if (!id || id === LINE_COL || id === TAG_COL) continue;
      const rect = cell.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX < rect.right) {
        target = cell;
        break;
      }
      if (e.clientX >= rect.right) target = cell;
    }
    if (!target) return;
    const id = target.dataset.gridHeaderCol!;
    if (id === dragged) {
      hideColDropLine();
      return;
    }
    const rect = target.getBoundingClientRect();
    const place: "before" | "after" =
      e.clientX < rect.left + rect.width / 2 ? "before" : "after";
    showColDropAt(id, place, target);
  };

  const onHeaderDrop = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const dragged =
      e.dataTransfer.getData("text/ag-column") ||
      e.dataTransfer.getData("text/plain") ||
      draggingColRef.current;
    const place =
      colDropRef.current?.id === columnId
        ? colDropRef.current.place
        : (() => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            return e.clientX < rect.left + rect.width / 2 ? "before" : "after";
          })();
    draggingColRef.current = null;
    setDraggingCol(null);
    hideColDropLine();
    if (!dragged || dragged === columnId) return;
    if (columnId === LINE_COL || columnId === TAG_COL) return;
    reorderColumn(tab.id, dragged, columnId, place);
  };

  const onHeaderRowDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dragged =
      e.dataTransfer.getData("text/ag-column") ||
      e.dataTransfer.getData("text/plain") ||
      draggingColRef.current;
    const drop = colDropRef.current;
    draggingColRef.current = null;
    setDraggingCol(null);
    hideColDropLine();
    if (!dragged || !drop || dragged === drop.id) return;
    reorderColumn(tab.id, dragged, drop.id, drop.place);
  };

  const onHeaderDragEnd = () => {
    draggingColRef.current = null;
    setDraggingCol(null);
    hideColDropLine();
  };

  const clearSearch = () => setGlobalSearch(tab.id, "");
  const clearFilters = () => {
    clearColumnFilters(tab.id);
    updateTab(tab.id, { timeRangeFilter: null });
  };

  const startResize = (
    e: ReactPointerEvent,
    columnId: string,
    startWidth: number,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const resizeAll = e.altKey;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      setColumnWidth(
        tab.id,
        columnId,
        Math.max(MIN_COL_WIDTH, startWidth + (ev.clientX - startX)),
        resizeAll,
      );
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onGroupDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverGroup(false);
    hideColDropLine();
    const col =
      e.dataTransfer.getData("text/ag-column") ||
      e.dataTransfer.getData("text/plain");
    if (col) addGroupBy(tab.id, col);
  };

  const promptTag = (title: string, initial = ""): string | null => {
    const v = window.prompt(title, initial);
    return v == null ? null : v.trim();
  };

  const openCellMenu = (
    e: React.MouseEvent,
    line: number,
    column: string,
    value: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const inSel = selectionHasCell(selection, line, column);
    const multi =
      inSel &&
      selection &&
      (selection.kind === "cells"
        ? selection.lines.length * selection.columns.length > 1
        : selection.columns.length > 1);

    if (!inSel) {
      setSelection({ kind: "cells", lines: [line], columns: [column] });
    }

    const lines =
      multi && selection?.kind === "cells" ? selection.lines : [line];
    const columns =
      multi && selection
        ? selection.columns.filter((c) => !isMetaColumn(c))
        : isMetaColumn(column)
          ? []
          : [column];
    const dataCols = columns;
    const multiRows = lines.length > 1;
    const multiCols = dataCols.length > 1;

    const items = [
      {
        label: `Include only “${truncate(value)}”`,
        disabled: isMetaColumn(column) || !value || multiRows || multiCols,
        action: () => includeCellValue(tab.id, column, value),
      },
      {
        label: `Exclude “${truncate(value)}”`,
        disabled: isMetaColumn(column) || !value || multiRows || multiCols,
        action: () => excludeCellValue(tab.id, column, value),
      },
      { separator: true as const },
      {
        label: multiRows ? `Highlight ${lines.length} rows` : "Highlight row",
        action: () => {
          const color = nextHighlight(
            lines.length === 1 ? tab.rowHighlights[lines[0]] : undefined,
          );
          setRowHighlights(tab.id, lines, color);
        },
      },
      {
        label: multiRows ? "Clear row highlights" : "Clear row highlight",
        disabled: !lines.some((l) => tab.rowHighlights[l]),
        action: () => setRowHighlights(tab.id, lines, null),
      },
      {
        label: multiCols
          ? `Highlight ${dataCols.length} columns`
          : "Highlight column",
        disabled: dataCols.length === 0,
        action: () => {
          const color = nextHighlight(
            dataCols.length === 1 ? tab.columnHighlights[dataCols[0]] : undefined,
          );
          setColumnHighlights(tab.id, dataCols, color);
        },
      },
      {
        label: multiCols ? "Clear column highlights" : "Clear column highlight",
        disabled: !dataCols.some((c) => tab.columnHighlights[c]),
        action: () => setColumnHighlights(tab.id, dataCols, null),
      },
      { separator: true as const },
      {
        label: multiRows ? `Tag ${lines.length} rows…` : "Tag row…",
        action: () => {
          ensureTagsColumn(tab.id);
          const cur =
            lines.length === 1 && tab.columns.includes(TAGS_COL)
              ? tab.rows[lines[0] - 1]?.[tab.columns.indexOf(TAGS_COL)] ?? ""
              : "";
          const tag = promptTag(
            multiRows
              ? `Tag for ${lines.length} rows (Tags column):`
              : "Tag for this row (stored in Tags column):",
            cur,
          );
          if (tag != null) {
            for (const l of lines) setRowTag(tab.id, l, tag);
          }
        },
      },
      {
        label: multiCols ? `Tag ${dataCols.length} columns…` : "Tag column…",
        disabled: dataCols.length === 0,
        action: () => {
          const tag = promptTag(
            multiCols
              ? `Tag for ${dataCols.length} columns:`
              : `Tag for column “${dataCols[0]}”:`,
            dataCols.length === 1 ? (tab.columnTags[dataCols[0]] ?? "") : "",
          );
          if (tag != null) setColumnTags(tab.id, dataCols, tag || null);
        },
      },
      {
        label:
          multi && selection?.kind === "cells" && lines.length * dataCols.length > 1
            ? `Tag ${lines.length * dataCols.length} cells…`
            : "Tag cell…",
        disabled: dataCols.length === 0,
        action: () => {
          const cells = lines.flatMap((l) =>
            dataCols.map((c) => ({ line: l, column: c })),
          );
          const tag = promptTag(
            cells.length > 1 ? `Tag for ${cells.length} cells:` : "Tag for this cell:",
            cells.length === 1
              ? (tab.cellTags[cellTagKey(cells[0].line, cells[0].column)] ?? "")
              : "",
          );
          if (tag != null) setCellTags(tab.id, cells, tag || null);
        },
      },
      {
        label: "Group by this column",
        disabled: isMetaColumn(column) || multiCols,
        action: () => {
          addGroupBy(tab.id, column);
        },
      },
    ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const openHeaderMenu = (e: React.MouseEvent, columnId: string) => {
    e.preventDefault();
    if (columnId === LINE_COL || columnId === TAG_COL) {
      updateTab(tab.id, { showColumnChooser: true });
      return;
    }

    const inSel =
      selection?.kind === "columns" && selection.columns.includes(columnId);
    const columns =
      inSel && selection && selection.columns.length > 1
        ? selection.columns
        : [columnId];
    if (!inSel) {
      setSelection({ kind: "columns", columns: [columnId] });
    }
    const multi = columns.length > 1;

    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: "Sort ascending",
          disabled: multi,
          action: () =>
            updateTab(tab.id, { sortColumn: columnId, sortDir: "asc" }),
        },
        {
          label: "Sort descending",
          disabled: multi,
          action: () =>
            updateTab(tab.id, { sortColumn: columnId, sortDir: "desc" }),
        },
        {
          label: "Clear sort",
          disabled: !tab.sortColumn,
          action: () => updateTab(tab.id, { sortColumn: null, sortDir: null }),
        },
        { separator: true },
        {
          label: "Group by this column",
          disabled: multi,
          action: () => {
            addGroupBy(tab.id, columnId);
          },
        },
        {
          label: multi ? `Highlight ${columns.length} columns` : "Highlight column",
          action: () => {
            const color = nextHighlight(
              columns.length === 1 ? tab.columnHighlights[columns[0]] : undefined,
            );
            setColumnHighlights(tab.id, columns, color);
          },
        },
        {
          label: multi ? "Clear column highlights" : "Clear column highlight",
          disabled: !columns.some((c) => tab.columnHighlights[c]),
          action: () => setColumnHighlights(tab.id, columns, null),
        },
        {
          label: multi ? `Tag ${columns.length} columns…` : "Tag column…",
          action: () => {
            const tag = promptTag(
              multi
                ? `Tag for ${columns.length} columns:`
                : `Tag for column “${columnId}”:`,
              columns.length === 1 ? (tab.columnTags[columnId] ?? "") : "",
            );
            if (tag != null) setColumnTags(tab.id, columns, tag || null);
          },
        },
        {
          label: multi ? `Hide ${columns.length} columns` : "Hide column",
          action: () => {
            const next = new Set(tab.hiddenColumns);
            for (const c of columns) next.add(c);
            updateTab(tab.id, { hiddenColumns: next });
            clearSelection();
          },
        },
        {
          label: "Column chooser…",
          action: () => updateTab(tab.id, { showColumnChooser: true }),
        },
        ...(!multi
          ? ([
              { separator: true },
              {
                label:
                  tab.timestampColumn === columnId
                    ? "✓ Timestamp column"
                    : "Use as timestamp column",
                action: () =>
                  updateTab(tab.id, { timestampColumn: columnId }),
              },
              ...(columnId === tab.timestampColumn ||
              looksLikeTimestampColumn(columnId)
                ? [
                    {
                      label: tab.timestampAssumeUtc
                        ? "✓ Assume source is UTC"
                        : "Assume source is UTC",
                      action: () =>
                        updateTab(tab.id, {
                          timestampAssumeUtc: !tab.timestampAssumeUtc,
                        }),
                    },
                    {
                      label: `Show times as — ${timezoneLabel(tab.displayTimezone)}`,
                      disabled: true,
                    },
                    {
                      label:
                        tab.displayTimezone == null
                          ? "✓ Original (as imported)"
                          : "Original (as imported)",
                      action: () =>
                        updateTab(tab.id, { displayTimezone: null }),
                    },
                    ...US_DISPLAY_TIMEZONES.map((z) => ({
                      label:
                        tab.displayTimezone === z.id
                          ? `✓ ${z.label}`
                          : z.label,
                      action: () =>
                        updateTab(tab.id, { displayTimezone: z.id }),
                    })),
                  ]
                : []),
            ] as ContextMenuItem[])
          : []),
      ],
    });
  };

  const searchControls = (
    <div className="global-search">
      <button
        type="button"
        className={tab.showColumnChooser ? "active-toggle" : undefined}
        onClick={() =>
          updateTab(tab.id, { showColumnChooser: !tab.showColumnChooser })
        }
        title="Show or hide columns"
      >
        Columns…
      </button>
      <input
        type="text"
        placeholder="Enter text to search…"
        value={tab.globalSearch}
        onChange={(e) => setGlobalSearch(tab.id, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") clearSearch();
        }}
      />
      <button type="button" disabled={!hasSearch} onClick={clearSearch}>
        Clear
      </button>
      <button type="button" disabled={!hasActiveFilters} onClick={clearFilters}>
        Clear filters
      </button>
      <button
        type="button"
        disabled={!hasRowHighlights && !selection}
        onClick={() => {
          clearRowHighlights(tab.id);
          clearSelection();
        }}
        title="Clear row highlights and grid selection"
      >
        Clear highlights
      </button>
    </div>
  );

  return (
    <div className="grid-workspace">
      <div
        className={`group-by-box ${dragOverGroup ? "drag-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOverGroup(true);
          hideColDropLine();
        }}
        onDragLeave={() => setDragOverGroup(false)}
        onDrop={onGroupDrop}
      >
        {tab.groupByColumns.length === 0 ? (
          <span>Drag a column header here to group by that column.</span>
        ) : (
          <>
            <div className="group-chips">
              {tab.groupByColumns.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="group-chip"
                  onClick={() => removeGroupBy(tab.id, c)}
                  title="Click to remove grouping"
                >
                  {c} ×
                </button>
              ))}
            </div>
            <div className="group-actions">
              <button
                type="button"
                onClick={() => expandAllGroups(tab.id, allGroupIds)}
                title="Expand all groups"
              >
                Expand all
              </button>
              <button
                type="button"
                onClick={() => collapseAllGroups(tab.id)}
                title="Collapse all groups"
              >
                Collapse all
              </button>
              <button
                type="button"
                onClick={() => cycleGroupSort(tab.id)}
                title="Cycle: label → count descending → count ascending"
              >
                {groupSortLabel}
              </button>
            </div>
          </>
        )}
        {searchControls}
      </div>

      {(activeColumnFilterChips.length > 0 || tab.advancedFilter) && (
        <div className="active-filter-bar" aria-label="Active column filters">
          <span className="active-filter-bar-label">Filters:</span>
          {activeColumnFilterChips.map((chip) => (
            <span
              key={chip.column}
              className={`active-filter-chip ${chip.kind}`}
              title={chip.label}
            >
              <span className="active-filter-chip-text">{chip.label}</span>
              <button
                type="button"
                onClick={() => setColumnFilterSpec(tab.id, chip.column, null)}
                title={`Clear filter on ${chip.column}`}
                aria-label={`Clear filter on ${chip.column}`}
              >
                ×
              </button>
            </span>
          ))}
          {tab.advancedFilter && (
            <span className="active-filter-chip advanced" title="Advanced filter is active">
              Advanced filter
              <button
                type="button"
                onClick={() => updateTab(tab.id, { advancedFilter: null })}
                title="Clear advanced filter"
                aria-label="Clear advanced filter"
              >
                ×
              </button>
            </span>
          )}
        </div>
      )}

      <div
        className={`data-grid-shell ${tab.wordWrap ? "word-wrap" : ""}`}
        onClick={(e) => {
          setMenu(null);
          if (suppressClearClick.current) {
            suppressClearClick.current = false;
            return;
          }
          // Ctrl/⌘+click is used to build selection — don't clear on that click
          if (e.ctrlKey || e.metaKey) return;
          const t = e.target as HTMLElement;
          if (t.closest(".context-menu")) return;
          // Keep selection when clicking inside it (e.g. before right-click)
          if (
            t.closest(
              ".grid-header-cell.col-selected, .grid-cell.cell-selected, .grid-cell.col-selected",
            )
          ) {
            return;
          }
          clearSelection();
        }}
      >
        <div className="grid-chrome">
          <div
            className="grid-chrome-inner"
            ref={chromeInnerRef}
            style={{ width: totalWidth, minWidth: "100%" }}
          >
            <div
              className={`grid-header-row ${draggingCol ? "is-reordering" : ""}`}
              ref={headerRowRef}
              style={{ width: totalWidth, position: "relative" }}
              onDragOver={onHeaderRowDragOver}
              onDrop={onHeaderRowDrop}
            >
              <div
                ref={dropLineRef}
                className="col-drop-line"
                aria-hidden
              />
              {allHeaders.map((h) => (
                <div
                  key={h.id}
                  className={`grid-header-cell ${selectedColSet?.has(h.id) ? "col-selected" : ""} ${
                    draggingCol === h.id ? "col-dragging" : ""
                  }`}
                  data-grid-header-col={h.id}
                  style={{
                    width: h.width,
                    background: tab.columnHighlights[h.id],
                  }}
                  draggable={h.id !== LINE_COL && h.id !== TAG_COL}
                  onDragStart={(e) => onHeaderDragStart(e, h.id)}
                  onDragOver={(e) => onHeaderDragOver(e, h.id)}
                  onDrop={(e) => onHeaderDrop(e, h.id)}
                  onDragEnd={onHeaderDragEnd}
                  onPointerDown={(e) => beginColumnSelect(e, h.id)}
                  title={
                    h.id !== LINE_COL && h.id !== TAG_COL
                      ? "Drag to reorder · Right-click to sort / timezone · Drop on group box to group · Ctrl/⌘+drag to select · Alt+drag resize = all"
                      : undefined
                  }
                  onContextMenu={(e) => openHeaderMenu(e, h.id)}
                >
                  <span className="header-label">
                    {h.label}
                    {tab.sortColumn === h.id && tab.sortDir ? (
                      <span className="col-sort-indicator" title={`Sorted ${tab.sortDir}ending`}>
                        {tab.sortDir === "asc" ? " ↑" : " ↓"}
                      </span>
                    ) : null}
                    {h.id === tab.timestampColumn && tab.displayTimezone ? (
                      <span
                        className="col-tz-badge"
                        title={`Displayed as ${timezoneLabel(tab.displayTimezone)}`}
                      >
                        {timezoneLabel(tab.displayTimezone)}
                      </span>
                    ) : null}
                    {tab.columnTags[h.id] ? (
                      <span className="col-tag-badge" title="Column tag">
                        {tab.columnTags[h.id]}
                      </span>
                    ) : null}
                  </span>
                  <div
                    className="col-resizer"
                    onPointerDown={(e) => startResize(e, h.id, h.width)}
                  />
                </div>
              ))}
            </div>

            <div className="grid-filter-row" style={{ width: totalWidth }}>
              {allHeaders.map((h) => {
                const filter = tab.columnFilters[h.id];
                const modeClass = filter ? `filter-${filter.mode}` : "";
                const modeTitle =
                  filter?.mode === "equals"
                    ? `Include only: ${filter.value}`
                    : filter?.mode === "excludes"
                      ? `Exclude: ${filter.values.join(", ")}`
                      : filter?.mode === "contains"
                        ? `Contains: ${filter.value}`
                        : undefined;
                return (
                  <div
                    key={h.id}
                    className={`grid-filter-cell ${modeClass}`}
                    style={{ width: h.width }}
                    title={modeTitle}
                  >
                    {filter?.mode === "equals" && (
                      <span className="filter-mode-badge include" title="Include (equals)">
                        =
                      </span>
                    )}
                    {filter?.mode === "excludes" && (
                      <span className="filter-mode-badge exclude" title="Exclude">
                        ≠
                      </span>
                    )}
                    <input
                      type="text"
                      aria-label={`Filter ${h.label}`}
                      placeholder="text | =exact | !exclude"
                      value={filterInputDisplay(filter)}
                      onChange={(e) => setColumnFilter(tab.id, h.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setColumnFilter(tab.id, h.id, "");
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div
          className={`data-grid ${tab.wordWrap ? "word-wrap" : ""}`}
          ref={parentRef}
          onScroll={syncChromeScroll}
          onWheel={onWheel}
        >
          <div className="grid-inner" style={{ width: totalWidth, minWidth: "100%" }}>
            <div
              className="grid-body"
              ref={rowVirtualizer.containerRef}
              style={{
                width: totalWidth,
                height: rowVirtualizer.getTotalSize(),
                position: "relative",
              }}
            >
            {rowVirtualizer.getVirtualItems().map((vRow) => {
              const item = flatItems[vRow.index];
              if (item.kind === "group") {
                return (
                  <div
                    key={vRow.key}
                    data-index={vRow.index}
                    ref={rowVirtualizer.measureElement}
                    className="grid-group-row"
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: totalWidth,
                      height: GROUP_ROW_H,
                      transform: `translate3d(0, ${vRow.start}px, 0)`,
                      paddingLeft: 8 + item.depth * 16,
                    }}
                    onClick={() => toggleGroupCollapsed(tab.id, item.id)}
                  >
                    <span className="group-toggle">{item.collapsed ? "▶" : "▼"}</span>
                    <strong>{item.label}</strong>
                    <span className="group-count">({item.count})</span>
                  </div>
                );
              }

              const row = item.row;
              const manualRowBg = tab.rowHighlights[row.line];
              const fmt = formatByLine.get(row.line) ?? { cellStyles: {} };
              const rowBg = manualRowBg ?? fmt.rowStyle?.background;
              const rowColor = manualRowBg ? undefined : fmt.rowStyle?.textColor;
              const rowBold = !manualRowBg && fmt.rowStyle?.bold;
              return (
                <div
                  key={vRow.key}
                  data-index={vRow.index}
                  ref={rowVirtualizer.measureElement}
                  className={`grid-row ${row.tagged ? "tagged" : ""} ${vRow.index % 2 === 1 ? "alt" : ""} ${manualRowBg ? "row-highlighted" : ""}`}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: totalWidth,
                    transform: `translate3d(0, ${vRow.start}px, 0)`,
                    ...(tab.wordWrap ? {} : { height: vRow.size }),
                    ...(rowBg ? { background: rowBg } : {}),
                    ...(rowColor ? { color: rowColor } : {}),
                    ...(rowBold ? { fontWeight: 700 } : {}),
                  }}
                >
                  {allHeaders.map((h) => {
                    let content: ReactNode;
                    const colHighlight = tab.columnHighlights[h.id];
                    const cellFmt = fmt.cellStyles[h.id];
                    const idx = colIndex.get(h.id) ?? -1;
                    if (h.id === LINE_COL) {
                      content = row.line;
                    } else if (h.id === TAG_COL) {
                      content = (
                        <input
                          type="checkbox"
                          checked={row.tagged}
                          onChange={() => toggleTag(tab.id, row.line)}
                          aria-label={`Tag line ${row.line}`}
                        />
                      );
                    } else {
                      const value = row.cells[idx] ?? "";
                      const editable = tab.userColumns.has(h.id);
                      const ctag = tab.cellTags[cellTagKey(row.line, h.id)];
                      const showTz =
                        Boolean(tab.displayTimezone) &&
                        h.id === tab.timestampColumn &&
                        !editable;
                      const displayValue = showTz
                        ? formatTimestampDisplay(value, tab.displayTimezone, {
                            assumeUtc: tab.timestampAssumeUtc,
                          })
                        : value;
                      if (editable) {
                        content = (
                          <input
                            className="cell-edit"
                            value={value}
                            onChange={(e) =>
                              setCellValue(tab.id, row.line, h.id, e.target.value)
                            }
                            onClick={(e) => e.stopPropagation()}
                          />
                        );
                      } else {
                        content = (
                          <>
                            {displayValue}
                            {ctag ? <span className="cell-tag-badge">{ctag}</span> : null}
                          </>
                        );
                      }
                    }
                    const rawVal =
                      h.id === LINE_COL
                        ? String(row.line)
                        : h.id === TAG_COL
                          ? row.tagged
                            ? "1"
                            : "0"
                          : (row.cells[idx] ?? "");
                    const displayTitle =
                      h.id !== LINE_COL &&
                      h.id !== TAG_COL &&
                      tab.displayTimezone &&
                      h.id === tab.timestampColumn
                        ? `${rawVal}\n→ ${formatTimestampDisplay(rawVal, tab.displayTimezone, {
                            assumeUtc: tab.timestampAssumeUtc,
                          })}\n(Ctrl/⌘+drag to multi-select)`
                        : typeof rawVal === "string"
                          ? `${rawVal}\n(Ctrl/⌘+drag to multi-select)`
                          : undefined;
                    const cellBg =
                      colHighlight ||
                      (!manualRowBg && !fmt.rowStyle
                        ? cellFmt?.background
                        : undefined);
                    const cellSelected =
                      selection?.kind === "cells"
                        ? Boolean(
                            selectedLineSet?.has(row.line) &&
                              selectedColSet?.has(h.id),
                          )
                        : Boolean(
                            selection?.kind === "columns" &&
                              selectedColSet?.has(h.id),
                          );
                    const colSelectedHeader =
                      selection?.kind === "columns" &&
                      Boolean(selectedColSet?.has(h.id));
                    return (
                      <div
                        key={h.id}
                        className={[
                          "grid-cell",
                          h.id === LINE_COL ? "line-cell" : "",
                          h.id === TAG_COL ? "tag-cell" : "",
                          cellSelected ? "cell-selected" : "",
                          colSelectedHeader ? "col-selected" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        data-grid-line={row.line}
                        data-grid-col={h.id}
                        style={{
                          width: h.width,
                          ...(cellBg && !manualRowBg && !rowBg
                            ? { background: cellBg }
                            : colHighlight && !manualRowBg
                              ? { background: colHighlight }
                              : {}),
                          ...(!manualRowBg && cellFmt?.textColor && !fmt.rowStyle
                            ? { color: cellFmt.textColor }
                            : {}),
                          ...(!manualRowBg && cellFmt?.bold && !fmt.rowStyle
                            ? { fontWeight: 700 }
                            : {}),
                        }}
                        title={displayTitle}
                        onPointerDown={(e) => beginCellSelect(e, row.line, h.id)}
                        onContextMenu={(e) =>
                          openCellMenu(e, row.line, h.id, rawVal)
                        }
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          if (h.id === TAG_COL) return;
                          setMenu(null);
                          const rowFields = allHeaders
                            .filter((col) => col.id !== TAG_COL)
                            .map((col) => {
                              if (col.id === LINE_COL) {
                                return { column: "Line", value: String(row.line) };
                              }
                              const cIdx = colIndex.get(col.id) ?? -1;
                              return {
                                column: col.label,
                                value: row.cells[cIdx] ?? "",
                              };
                            });
                          setCellDetail({
                            line: row.line,
                            column: h.label,
                            value: rawVal,
                            rowFields,
                          });
                        }}
                      >
                        {content}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
        </div>
      </div>

      {menu && <ContextMenu state={menu} onClose={() => setMenu(null)} />}
      {cellDetail && (
        <CellDetailModal state={cellDetail} onClose={() => setCellDetail(null)} />
      )}
    </div>
  );
}

function truncate(s: string, n = 32): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
