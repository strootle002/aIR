import { useEffect, useMemo, useRef, useState } from "react";
import { useTabsStore } from "../stores/tabsStore";

export function ColumnChooser() {
  const tab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const updateTab = useTabsStore((s) => s.updateTab);
  const reorderColumn = useTabsStore((s) => s.reorderColumn);
  const moveColumn = useTabsStore((s) => s.moveColumn);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    place: "before" | "after";
  } | null>(null);
  const dragColRef = useRef<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const columns = useMemo(() => {
    if (!tab) return [];
    const order = tab.columnOrder?.length ? tab.columnOrder : tab.columns;
    const known = new Set(tab.columns);
    const ordered = order.filter((c) => known.has(c));
    for (const c of tab.columns) {
      if (!ordered.includes(c)) ordered.push(c);
    }
    return ordered;
  }, [tab]);

  const filteredColumns = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return columns;
    return columns.filter((c) => c.toLowerCase().includes(q));
  }, [columns, query]);

  const searching = query.trim().length > 0;
  const open = Boolean(tab?.showColumnChooser);

  useEffect(() => {
    if (!open) {
      setExpanded(false);
      setQuery("");
      dragColRef.current = null;
      setDragging(null);
      setDropTarget(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (expanded) setExpanded(false);
      else if (tab) updateTab(tab.id, { showColumnChooser: false });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, expanded, tab, updateTab]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open, expanded]);

  if (!tab?.showColumnChooser) return null;

  const toggle = (col: string) => {
    const next = new Set(tab.hiddenColumns);
    if (next.has(col)) next.delete(col);
    else next.add(col);
    updateTab(tab.id, { hiddenColumns: next });
  };

  const selectAll = () => {
    updateTab(tab.id, { hiddenColumns: new Set() });
  };

  const deselectAll = () => {
    updateTab(tab.id, { hiddenColumns: new Set(tab.columns) });
  };

  const close = () => updateTab(tab.id, { showColumnChooser: false });

  const visibleCount = tab.columns.length - tab.hiddenColumns.size;

  const clearDrag = () => {
    dragColRef.current = null;
    setDragging(null);
    setDropTarget(null);
  };

  const onRowDragStart = (e: React.DragEvent, col: string) => {
    if (searching) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData("text/ag-column-order", col);
    e.dataTransfer.setData("text/plain", col);
    e.dataTransfer.effectAllowed = "move";
    dragColRef.current = col;
    setDragging(col);
    setDropTarget(null);
  };

  const onRowDragOver = (e: React.DragEvent, col: string) => {
    const dragged = dragColRef.current;
    if (!dragged || searching) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragged === col) {
      setDropTarget(null);
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const place: "before" | "after" =
      e.clientY < rect.top + rect.height / 2 ? "before" : "after";
    setDropTarget((prev) =>
      prev?.id === col && prev.place === place ? prev : { id: col, place },
    );
  };

  const onRowDrop = (e: React.DragEvent, col: string) => {
    e.preventDefault();
    const dragged =
      e.dataTransfer.getData("text/ag-column-order") ||
      e.dataTransfer.getData("text/plain") ||
      dragColRef.current;
    const place =
      dropTarget?.id === col
        ? dropTarget.place
        : (() => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            return e.clientY < rect.top + rect.height / 2 ? "before" : "after";
          })();
    clearDrag();
    if (!dragged || dragged === col) return;
    reorderColumn(tab.id, dragged, col, place);
  };

  const panel = (
    <div
      className={`column-chooser ${expanded ? "column-chooser-expanded" : ""}`}
      role="dialog"
      aria-label="Column chooser"
      aria-modal={expanded || undefined}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="column-chooser-header">
        <strong>Columns</strong>
        <div className="column-chooser-header-actions">
          <button
            type="button"
            className="column-chooser-icon-btn"
            title={expanded ? "Restore" : "Maximize"}
            aria-label={expanded ? "Restore columns panel" : "Maximize columns panel"}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "❐" : "▣"}
          </button>
          <button
            type="button"
            className="column-chooser-icon-btn"
            onClick={close}
            aria-label="Close"
          >
            ×
          </button>
        </div>
      </div>
      <p className="column-chooser-meta">
        {visibleCount} of {tab.columns.length} visible
        {!searching ? " · Drag or use ↑↓ to reorder" : " · Clear search to reorder"}
      </p>
      <input
        ref={searchRef}
        type="search"
        className="column-chooser-search"
        placeholder="Search columns…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search columns"
      />
      <div className="column-chooser-actions">
        <button type="button" onClick={selectAll}>
          Select all
        </button>
        <button type="button" onClick={deselectAll}>
          Deselect all
        </button>
      </div>
      <ul className="column-chooser-list">
        {filteredColumns.length === 0 ? (
          <li className="column-chooser-empty">No columns match</li>
        ) : (
          filteredColumns.map((col) => {
            const fullIndex = columns.indexOf(col);
            const isFirst = fullIndex <= 0;
            const isLast = fullIndex >= columns.length - 1;
            return (
              <li
                key={col}
                className={[
                  dragging === col ? "dragging" : "",
                  dropTarget?.id === col
                    ? dropTarget.place === "before"
                      ? "drop-before"
                      : "drop-after"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                draggable={!searching}
                onDragStart={(e) => onRowDragStart(e, col)}
                onDragOver={(e) => onRowDragOver(e, col)}
                onDrop={(e) => onRowDrop(e, col)}
                onDragEnd={clearDrag}
              >
                <span
                  className="column-chooser-handle"
                  title={searching ? "Clear search to reorder" : "Drag to reorder"}
                  aria-hidden
                >
                  ⋮⋮
                </span>
                <label>
                  <input
                    type="checkbox"
                    checked={!tab.hiddenColumns.has(col)}
                    onChange={() => toggle(col)}
                  />
                  <span title={col}>{col}</span>
                </label>
                <div className="column-chooser-move">
                  <button
                    type="button"
                    title="Move up"
                    aria-label={`Move ${col} up`}
                    disabled={searching || isFirst}
                    onClick={() => moveColumn(tab.id, col, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    title="Move down"
                    aria-label={`Move ${col} down`}
                    disabled={searching || isLast}
                    onClick={() => moveColumn(tab.id, col, 1)}
                  >
                    ↓
                  </button>
                </div>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );

  if (expanded) {
    return (
      <div
        className="column-chooser-overlay"
        onClick={() => setExpanded(false)}
        role="presentation"
      >
        {panel}
      </div>
    );
  }

  return panel;
}
