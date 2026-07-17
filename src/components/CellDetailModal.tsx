import { useEffect, useMemo, useRef, useState } from "react";
import { isBlankField } from "../lib/types";

export interface CellDetailField {
  column: string;
  value: string;
}

export interface CellDetailState {
  line: number;
  column: string;
  value: string;
  /** Full row fields (including the focused column) */
  rowFields: CellDetailField[];
}

function fieldMatches(field: CellDetailField, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    field.column.toLowerCase().includes(q) ||
    field.value.toLowerCase().includes(q)
  );
}

export function CellDetailModal({
  state,
  onClose,
}: {
  state: CellDetailState;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [focusCol, setFocusCol] = useState(state.column);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const populatedFields = useMemo(
    () => state.rowFields.filter((f) => !isBlankField(f.value)),
    [state.rowFields],
  );

  const filteredFields = useMemo(
    () => populatedFields.filter((f) => fieldMatches(f, search)),
    [populatedFields, search],
  );

  useEffect(() => {
    setFocusCol(state.column);
    setSearch("");
  }, [state.line, state.column]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (search.trim()) {
          e.preventDefault();
          setSearch("");
          return;
        }
        onClose();
      }
      // Focus search with / when not typing in an input
      if (
        e.key === "/" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, search]);

  useEffect(() => {
    // Keep focus on a visible field when search narrows the list
    if (filteredFields.length === 0) return;
    if (!filteredFields.some((f) => f.column === focusCol)) {
      setFocusCol(filteredFields[0].column);
    }
  }, [filteredFields, focusCol]);

  const focused =
    filteredFields.find((f) => f.column === focusCol) ??
    filteredFields[0] ??
    populatedFields.find((f) => f.column === focusCol) ??
    populatedFields[0] ?? {
      column: state.column,
      value: state.value,
    };

  const others = filteredFields.filter((f) => f.column !== focused.column);
  const searching = search.trim().length > 0;

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const copyFocused = () => void copyText(focused.value);

  const copyRow = () => {
    const source = searching ? filteredFields : populatedFields;
    const text = source.map((f) => `${f.column}: ${f.value}`).join("\n");
    void copyText(text);
  };

  return (
    <div className="cell-detail-overlay" onClick={onClose} role="presentation">
      <div
        className="cell-detail-modal"
        role="dialog"
        aria-label="Cell details"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="cell-detail-header">
          <div>
            <h2>{focused.column || "Cell value"}</h2>
            <p className="cell-detail-meta">Line {state.line}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="cell-detail-search">
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search fields in this event…"
            aria-label="Search fields in this event"
            autoFocus
          />
          {searching && (
            <span className="cell-detail-search-meta">
              {filteredFields.length} of {populatedFields.length}
            </span>
          )}
        </div>

        <pre className="cell-detail-body">{focused.value || "(empty)"}</pre>

        {populatedFields.length > 0 && (
          <div className="cell-detail-row">
            <h3 className="cell-detail-row-title">
              {searching
                ? `Matching fields (${filteredFields.length})`
                : "Other fields on this row"}
            </h3>
            {filteredFields.length === 0 ? (
              <p className="cell-detail-search-empty">No fields match “{search.trim()}”</p>
            ) : (
              <dl className="cell-detail-row-dl">
                {(searching ? filteredFields : others).map((f) => (
                  <div
                    key={f.column}
                    className={`cell-detail-row-item ${
                      f.column === focused.column ? "is-focused" : ""
                    }`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setFocusCol(f.column)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setFocusCol(f.column);
                      }
                    }}
                    title="Show this field"
                  >
                    <dt>{f.column}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}

        <div className="cell-detail-actions">
          <button
            type="button"
            onClick={copyRow}
            disabled={populatedFields.length === 0 || filteredFields.length === 0}
            title={
              searching
                ? "Copy matching fields"
                : "Copy all populated fields on this row"
            }
          >
            {searching ? "Copy matches" : "Copy row"}
          </button>
          <button type="button" className="primary-cta" onClick={copyFocused}>
            {copied ? "Copied" : "Copy field"}
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
