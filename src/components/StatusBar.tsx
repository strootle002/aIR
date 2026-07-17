import { useTabsStore } from "../stores/tabsStore";

function formatRange(start: number, end: number): string {
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  };
  return `${new Date(start).toLocaleString(undefined, opts)} – ${new Date(end).toLocaleString(undefined, opts)}`;
}

export function StatusBar({ visibleLines }: { visibleLines: number }) {
  const tab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const openFiles = useTabsStore((s) => s.tabs.length);
  const searchOptions = useTabsStore((s) => s.searchOptions);
  const searchOptionsOpen = useTabsStore((s) => s.searchOptionsOpen);
  const setSearchOptions = useTabsStore((s) => s.setSearchOptions);
  const setSearchOptionsOpen = useTabsStore((s) => s.setSearchOptionsOpen);
  const clearColumnFilters = useTabsStore((s) => s.clearColumnFilters);
  const clearRowHighlights = useTabsStore((s) => s.clearRowHighlights);
  const updateTab = useTabsStore((s) => s.updateTab);

  const columnFilterCount = tab ? Object.keys(tab.columnFilters).length : 0;
  const highlightCount = tab ? Object.keys(tab.rowHighlights).length : 0;
  const hasAdvanced = Boolean(tab?.advancedFilter);
  const hasTime = Boolean(tab?.timeRangeFilter);
  const hasAnyFilter = columnFilterCount > 0 || hasAdvanced || hasTime;
  const hasHighlights = highlightCount > 0;

  return (
    <footer className="status-bar">
      <div className="status-path" title={tab?.workingCopyPath}>
        {tab ? (
          <>
            <span className="status-label">Source:</span> {tab.originalPath}
          </>
        ) : (
          "No file open"
        )}
      </div>
      <div className="status-metrics">
        <span>Total lines: {tab?.totalLines ?? 0}</span>
        <span>Visible lines: {tab ? visibleLines : 0}</span>
        <span>Open files: {openFiles}</span>
      </div>
      {tab && (hasAnyFilter || hasHighlights) && (
        <div className="status-filters" title="Active filters and highlights">
          {hasTime && tab.timeRangeFilter && (
            <span className="status-filter-chip time">
              Time range: {formatRange(tab.timeRangeFilter.start, tab.timeRangeFilter.end)}
              <button
                type="button"
                onClick={() => updateTab(tab.id, { timeRangeFilter: null })}
                title="Clear time range filter"
              >
                ×
              </button>
            </span>
          )}
          {columnFilterCount > 0 &&
            tab &&
            Object.entries(tab.columnFilters).map(([column, filter]) => {
              const text =
                filter.mode === "equals"
                  ? `${column} = ${filter.value}`
                  : filter.mode === "excludes"
                    ? `${column} ≠ ${filter.values.join(", ")}`
                    : `${column} ~ ${filter.value}`;
              return (
                <span
                  key={column}
                  className={`status-filter-chip ${
                    filter.mode === "equals"
                      ? "include"
                      : filter.mode === "excludes"
                        ? "exclude"
                        : ""
                  }`}
                  title={text}
                >
                  {text}
                  <button
                    type="button"
                    onClick={() =>
                      useTabsStore.getState().setColumnFilterSpec(tab.id, column, null)
                    }
                    title={`Clear filter on ${column}`}
                  >
                    ×
                  </button>
                </span>
              );
            })}
          {hasAdvanced && (
            <span className="status-filter-chip">Advanced filter</span>
          )}
          {hasHighlights && (
            <span className="status-filter-chip">
              Row highlights: {highlightCount}
              <button
                type="button"
                onClick={() => clearRowHighlights(tab.id)}
                title="Clear all row highlights"
              >
                ×
              </button>
            </span>
          )}
          {hasAnyFilter && (
            <button
              type="button"
              className="status-clear-filters"
              onClick={() => {
                clearColumnFilters(tab.id);
                updateTab(tab.id, { timeRangeFilter: null });
              }}
            >
              Clear all filters
            </button>
          )}
        </div>
      )}
      <div className="status-search-opts">
        <button
          type="button"
          disabled={!tab}
          className={tab?.showFilterEditor ? "active" : ""}
          onClick={() =>
            tab &&
            updateTab(tab.id, {
              showFilterEditor: !tab.showFilterEditor,
            })
          }
        >
          Filter editor
        </button>
        <button
          type="button"
          className={searchOptionsOpen ? "active" : ""}
          onClick={() => setSearchOptionsOpen(!searchOptionsOpen)}
        >
          Search options
        </button>
        {searchOptionsOpen && (
          <div className="search-options-pop">
            <label>
              <input
                type="checkbox"
                checked={searchOptions.caseSensitive}
                onChange={(e) =>
                  setSearchOptions({ caseSensitive: e.target.checked })
                }
              />
              Case sensitive
            </label>
            <label>
              <input
                type="checkbox"
                checked={searchOptions.wholeWord}
                onChange={(e) => setSearchOptions({ wholeWord: e.target.checked })}
              />
              Whole word
            </label>
          </div>
        )}
      </div>
    </footer>
  );
}
