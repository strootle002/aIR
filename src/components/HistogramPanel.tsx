import { useMemo, useRef, useState, useCallback, type PointerEvent } from "react";
import { useTabsStore } from "../stores/tabsStore";
import { buildHistogram, parseTimestamp } from "../lib/timestamp";

function formatTick(ms: number, spanMs: number): { primary: string; secondary?: string } {
  const d = new Date(ms);
  if (spanMs < 60_000) {
    return {
      primary: d.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    };
  }
  if (spanMs < 86_400_000) {
    return {
      primary: d.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      }),
      secondary: d.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    };
  }
  if (spanMs < 86_400_000 * 45) {
    return {
      primary: d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
      secondary: d.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };
  }
  return {
    primary: d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    secondary: d.toLocaleDateString(undefined, { year: "numeric" }),
  };
}

export function HistogramPanel() {
  const tab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const updateTab = useTabsStore((s) => s.updateTab);
  const svgRef = useRef<SVGSVGElement>(null);
  const [brush, setBrush] = useState<{ a: number; b: number } | null>(null);
  const dragging = useRef(false);

  const chartHeight = Math.max(60, (tab?.histogramHeight ?? 160) - 48);
  const width = 1000;
  const pad = { top: 10, right: 12, bottom: 8, left: 40 };
  const innerW = width - pad.left - pad.right;
  const innerH = Math.max(40, chartHeight - pad.top - pad.bottom);

  const buckets = useMemo(() => {
    if (!tab?.timestampColumn) return [];
    return buildHistogram(tab.rows, tab.columns, tab.timestampColumn, 64);
  }, [tab?.rows, tab?.columns, tab?.timestampColumn]);

  const parseStats = useMemo(() => {
    if (!tab?.timestampColumn) return null;
    const idx = tab.columns.indexOf(tab.timestampColumn);
    if (idx < 0) return null;
    let ok = 0;
    let empty = 0;
    const samples: string[] = [];
    for (const row of tab.rows) {
      const v = row[idx] ?? "";
      if (!v.trim()) {
        empty += 1;
        continue;
      }
      if (parseTimestamp(v) != null) ok += 1;
      else if (samples.length < 3) samples.push(v);
    }
    return { ok, empty, total: tab.rows.length, samples };
  }, [tab?.rows, tab?.columns, tab?.timestampColumn]);

  const maxCount = useMemo(
    () => Math.max(1, ...buckets.map((b) => b.count)),
    [buckets],
  );

  const spanMs =
    buckets.length > 0
      ? buckets[buckets.length - 1].end - buckets[0].start
      : 0;

  const ticks = useMemo(() => {
    if (buckets.length === 0) return [];
    const t0 = buckets[0].start;
    const t1 = buckets[buckets.length - 1].end;
    const count = 7;
    return Array.from({ length: count }, (_, i) => {
      const t = t0 + ((t1 - t0) * i) / (count - 1);
      const pct = (i / (count - 1)) * 100;
      return { t, pct, ...formatTick(t, spanMs) };
    });
  }, [buckets, spanMs]);

  const yTicks = useMemo(() => {
    const steps = [0, 0.5, 1].map((f) => Math.round(maxCount * f));
    return [...new Set(steps)].map((c) => ({
      c,
      y: innerH - (c / maxCount) * innerH,
    }));
  }, [maxCount, innerH]);

  const xFor = useCallback(
    (clientX: number) => {
      const svg = svgRef.current;
      if (!svg || buckets.length === 0) return 0;
      const rect = svg.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * width - pad.left;
      const t0 = buckets[0].start;
      const t1 = buckets[buckets.length - 1].end;
      const ratio = Math.min(1, Math.max(0, x / innerW));
      return t0 + ratio * (t1 - t0);
    },
    [buckets, innerW, pad.left],
  );

  const startHeightResize = (e: PointerEvent) => {
    if (!tab) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = tab.histogramHeight;
    const onMove = (ev: globalThis.PointerEvent) => {
      const next = Math.min(420, Math.max(120, startH + (ev.clientY - startY)));
      updateTab(tab.id, { histogramHeight: next });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  if (!tab) return null;

  if (!tab.showHistogram) {
    if (!tab.histogramOpenedOnce && !tab.dagMapping) return null;
    return (
      <div className="timeline-reopen-bar">
        <button
          type="button"
          onClick={() => updateTab(tab.id, { showHistogram: true })}
        >
          Show timeline graph
        </button>
        {tab.dagMapping ? (
          <button
            type="button"
            disabled={tab.showDag}
            onClick={() => updateTab(tab.id, { showDag: true })}
          >
            Show aChart: Asset Logs FlowChart
          </button>
        ) : (
          <button
            type="button"
            onClick={() => updateTab(tab.id, { showDagMapping: true })}
          >
            Convert to aChart: Asset Logs FlowChart…
          </button>
        )}
      </div>
    );
  }

  const onPointerDown = (e: PointerEvent) => {
    if (!tab.timestampColumn) return;
    dragging.current = true;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const t = xFor(e.clientX);
    setBrush({ a: t, b: t });
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging.current || !brush) return;
    setBrush({ a: brush.a, b: xFor(e.clientX) });
  };

  const onPointerUp = () => {
    if (!dragging.current || !brush || !tab) return;
    dragging.current = false;
    const start = Math.min(brush.a, brush.b);
    const end = Math.max(brush.a, brush.b);
    if (end - start < 1000) {
      updateTab(tab.id, { timeRangeFilter: null });
      setBrush(null);
      return;
    }
    updateTab(tab.id, { timeRangeFilter: { start, end } });
  };

  const leftLabelPct = (pad.left / width) * 100;
  const plotWidthPct = (innerW / width) * 100;

  return (
    <section className="histogram-panel">
      <div className="histogram-toolbar">
        <label>
          Timestamp column
          <select
            value={tab.timestampColumn ?? ""}
            onChange={(e) =>
              updateTab(tab.id, {
                timestampColumn: e.target.value || null,
                timeRangeFilter: null,
              })
            }
          >
            <option value="">— none —</option>
            {tab.columns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="hist-height-label">
          Height
          <input
            type="range"
            min={120}
            max={420}
            value={tab.histogramHeight}
            onChange={(e) =>
              updateTab(tab.id, { histogramHeight: Number(e.target.value) })
            }
          />
          <span>{tab.histogramHeight}px</span>
        </label>
        <button
          type="button"
          disabled={!tab.timeRangeFilter}
          onClick={() => updateTab(tab.id, { timeRangeFilter: null })}
        >
          Clear time filter
        </button>
        {tab.dagMapping ? (
          <>
            <button
              type="button"
              disabled={tab.showDag}
              onClick={() => updateTab(tab.id, { showDag: true })}
            >
              Show aChart: Asset Logs FlowChart
            </button>
            <button
              type="button"
              onClick={() => updateTab(tab.id, { showDagMapping: true })}
            >
              Remap columns…
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => updateTab(tab.id, { showDagMapping: true })}
          >
            Convert to aChart: Asset Logs FlowChart…
          </button>
        )}
        <button type="button" onClick={() => updateTab(tab.id, { showHistogram: false })}>
          Close
        </button>
      </div>

      {!tab.timestampColumn ? (
        <p className="histogram-empty">
          Select a timestamp column to graph this timeline.
        </p>
      ) : buckets.length === 0 ? (
        <p className="histogram-empty">
          No parseable timestamps in “{tab.timestampColumn}”
          {parseStats
            ? ` (${parseStats.total - parseStats.empty} non-empty values).`
            : "."}
          {parseStats?.samples.length ? (
            <> Examples: {parseStats.samples.map((s) => `"${s}"`).join(", ")}</>
          ) : null}
        </p>
      ) : (
        <div className="histogram-chart-wrap">
          <div className="histogram-plot">
            <svg
              ref={svgRef}
              className="histogram-svg"
              viewBox={`0 0 ${width} ${chartHeight}`}
              preserveAspectRatio="none"
              style={{ height: chartHeight }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              <defs>
                <linearGradient id="histBarGrad" x1="0" y1="1" x2="0" y2="0">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.75" />
                  <stop offset="100%" stopColor="var(--accent-hover)" />
                </linearGradient>
              </defs>
              <rect x={0} y={0} width={width} height={chartHeight} className="hist-bg" />
              <g transform={`translate(${pad.left},${pad.top})`}>
                {yTicks.map((yt) => (
                  <g key={yt.c}>
                    <line
                      x1={0}
                      x2={innerW}
                      y1={yt.y}
                      y2={yt.y}
                      className="hist-grid"
                    />
                  </g>
                ))}
                {buckets.map((b, i) => {
                  const bw = innerW / buckets.length;
                  const bh = (b.count / maxCount) * innerH;
                  return (
                    <rect
                      key={i}
                      x={i * bw + 0.4}
                      y={innerH - bh}
                      width={Math.max(1, bw - 0.8)}
                      height={bh}
                      className="hist-bar"
                      rx={1}
                    />
                  );
                })}
                {brush && (
                  <rect
                    x={
                      ((Math.min(brush.a, brush.b) - buckets[0].start) / spanMs) *
                      innerW
                    }
                    y={0}
                    width={Math.max(
                      1,
                      (Math.abs(brush.b - brush.a) / spanMs) * innerW,
                    )}
                    height={innerH}
                    className="hist-brush"
                  />
                )}
                {tab.timeRangeFilter && (
                  <rect
                    x={
                      ((tab.timeRangeFilter.start - buckets[0].start) / spanMs) *
                      innerW
                    }
                    y={0}
                    width={Math.max(
                      1,
                      ((tab.timeRangeFilter.end - tab.timeRangeFilter.start) /
                        spanMs) *
                        innerW,
                    )}
                    height={innerH}
                    className="hist-filter"
                  />
                )}
                <line
                  x1={0}
                  y1={innerH}
                  x2={innerW}
                  y2={innerH}
                  className="hist-axis-line"
                />
              </g>
            </svg>

            <div className="hist-y-labels" style={{ height: chartHeight }}>
              {yTicks.map((yt) => (
                <span
                  key={yt.c}
                  className="hist-y-label"
                  style={{
                    top: `${((pad.top + yt.y) / chartHeight) * 100}%`,
                  }}
                >
                  {yt.c}
                </span>
              ))}
            </div>
          </div>

          <div
            className="hist-x-axis"
            style={{
              marginLeft: `${leftLabelPct}%`,
              width: `${plotWidthPct}%`,
            }}
          >
            {ticks.map((tk) => (
              <div
                key={tk.t}
                className="hist-x-tick"
                style={{ left: `${tk.pct}%` }}
              >
                <span className="hist-x-primary">{tk.primary}</span>
                {tk.secondary ? (
                  <span className="hist-x-secondary">{tk.secondary}</span>
                ) : null}
              </div>
            ))}
          </div>

          <div
            className="histogram-resize-handle"
            title="Drag to resize histogram height"
            onPointerDown={startHeightResize}
          />
        </div>
      )}
      <p className="histogram-hint">
        Drag to filter by time range. Click without dragging to clear.
        {parseStats && buckets.length > 0
          ? ` Parsed ${parseStats.ok}/${parseStats.total - parseStats.empty} values.`
          : null}
      </p>
    </section>
  );
}
