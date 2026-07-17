import {
  useMemo,
  useRef,
  useState,
  useEffect,
  useCallback,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  buildTrajectory,
  findRelatedEvents,
  glyphTitle,
  type TrajectoryEvent,
  type TrajectoryModel,
  type TrajectorySpawn,
} from "../lib/dag";
import type { TrajectoryGlyphId } from "../lib/types";
import { isBlankField } from "../lib/types";
import type { FilterableRow } from "../lib/filters";
import { useTabsStore } from "../stores/tabsStore";
import { GraphExportMenu } from "./GraphExportMenu";
import {
  captureElementPng,
  defaultExportBasename,
  pngDataUrlsToMultiPagePdfBase64,
  promptSavePath,
  savePngOrPdf,
  waitFrames,
  writeExportFile,
  type GraphExportChoice,
} from "../lib/graphExport";

const LANE_H = 36;
const SIDEBAR_W = 200;
const AXIS_H = 28;
const GLYPH_HIT_PX = 16;
const MIN_AUTO_SPAN_RATIO = 0.02;
/** Keep glyphs clear of the sticky process column / right edge */
const PLOT_INSET_PCT = 1.75;

/** Glyphs that stay on the map (greyed) when legend-toggled off */
const STRUCTURAL_GLYPHS = new Set<TrajectoryGlyphId>([
  "spawn",
  "processCreate",
]);

const LEGEND_GLYPHS: TrajectoryGlyphId[] = [
  "spawn",
  "processCreate",
  "fileCreate",
  "networkConnect",
  "dnsQuery",
  "processTerminated",
  "registry",
  "processAccess",
  "driverLoaded",
  "other",
];

function allGlyphsEnabled(): Set<TrajectoryGlyphId> {
  return new Set(LEGEND_GLYPHS);
}

function formatTick(ms: number, spanMs: number): string {
  const d = new Date(ms);
  if (spanMs < 120_000) {
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  if (spanMs < 86_400_000) {
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Dual-line labels for the incident-window histogram */
function formatMacroTick(
  ms: number,
  spanMs: number,
): { primary: string; secondary?: string } {
  const d = new Date(ms);
  if (spanMs < 60_000) {
    return {
      primary: d.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      secondary: d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
    };
  }
  if (spanMs < 3_600_000) {
    return {
      primary: d.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      secondary: d.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
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

function formatViewWindow(ms: number, spanMs: number): string {
  const d = new Date(ms);
  if (spanMs < 86_400_000) {
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: spanMs < 3_600_000 ? "2-digit" : undefined,
    });
  }
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Glyph({ glyph }: { glyph: TrajectoryGlyphId }) {
  switch (glyph) {
    case "spawn":
      return (
        <svg viewBox="0 0 16 16" className="traj-glyph-svg" aria-hidden>
          <path
            d="M8 2v6M8 8L4 13M8 8l4 5"
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "processCreate":
      return (
        <svg viewBox="0 0 16 16" className="traj-glyph-svg" aria-hidden>
          <rect x="2" y="2" width="12" height="12" rx="2" />
        </svg>
      );
    case "fileCreate":
      return (
        <svg viewBox="0 0 16 16" className="traj-glyph-svg" aria-hidden>
          <path d="M4 2h6l4 4v8H4V2z" />
        </svg>
      );
    case "networkConnect":
      return (
        <svg viewBox="0 0 16 16" className="traj-glyph-svg" aria-hidden>
          <circle cx="8" cy="8" r="5.5" fill="none" strokeWidth="2" />
          <circle cx="8" cy="8" r="2" />
        </svg>
      );
    case "dnsQuery":
      return (
        <svg viewBox="0 0 16 16" className="traj-glyph-svg" aria-hidden>
          <path
            d="M8 3a5 5 0 100 10A5 5 0 008 3z"
            fill="none"
            strokeWidth="1.75"
          />
          <path
            d="M3 8h10M8 3c1.8 1.6 1.8 7.4 0 10M8 3c-1.8 1.6-1.8 7.4 0 10"
            fill="none"
            strokeWidth="1.25"
          />
        </svg>
      );
    case "processTerminated":
      return (
        <svg viewBox="0 0 16 16" className="traj-glyph-svg" aria-hidden>
          <path d="M4 4l8 8M12 4L4 12" fill="none" strokeWidth="2" />
        </svg>
      );
    case "registry":
      return (
        <svg viewBox="0 0 16 16" className="traj-glyph-svg" aria-hidden>
          <rect x="3" y="2" width="10" height="12" rx="1" fill="none" strokeWidth="1.75" />
          <path d="M6 5h4M6 8h4M6 11h3" fill="none" strokeWidth="1.5" />
        </svg>
      );
    case "processAccess":
      return (
        <svg viewBox="0 0 16 16" className="traj-glyph-svg" aria-hidden>
          <rect x="7" y="7" width="6" height="6" rx="1" />
          <path
            d="M3 3l5 5M3 3v3.5M3 3h3.5"
            fill="none"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      );
    case "driverLoaded":
      return (
        <svg viewBox="0 0 16 16" className="traj-glyph-svg" aria-hidden>
          <path
            d="M8 2l2 2h3v3l2 2-2 2v3H10l-2 2-2-2H3v-3L1 9l2-2V4h3z"
            fill="none"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <circle cx="8" cy="8" r="1.75" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 16 16" className="traj-glyph-svg" aria-hidden>
          <circle cx="8" cy="8" r="4" />
        </svg>
      );
  }
}

function glyphClass(evt: Pick<TrajectoryEvent, "glyph">): string {
  return evt.glyph;
}

function clampPct(n: number): number {
  return Math.min(100, Math.max(0, n));
}

/** Map a timestamp into the padded plot area so glyphs don't bleed into the sidebar. */
function timeToPct(t: number, wStart: number, viewSpan: number): number {
  const raw = ((t - wStart) / viewSpan) * 100;
  return PLOT_INSET_PCT + (clampPct(raw) / 100) * (100 - 2 * PLOT_INSET_PCT);
}

/** Visible overlap of [a0,a1] with view window as left%/width% or null if off-screen. */
function lifeSegment(
  lifeStart: number,
  lifeEnd: number,
  wStart: number,
  viewSpan: number,
): { left: number; width: number } | null {
  const a0 = Math.max(lifeStart, wStart);
  const a1 = Math.min(lifeEnd, wStart + viewSpan);
  if (a1 < a0) return null;
  const left = timeToPct(a0, wStart, viewSpan);
  const right = timeToPct(a1, wStart, viewSpan);
  const width = Math.max(right - left, 0.2);
  return { left, width: Math.min(width, 100 - left) };
}

/** True when a spawn vertical would pass through an unrelated glyph at this zoom. */
function spawnCollides(
  model: TrajectoryModel,
  spawn: {
    parentKey: string;
    childKey: string;
    timestamp: number;
    parentEventId: string;
    childEventId: string;
  },
  _wStart: number,
  viewSpan: number,
  gridWidthPx: number,
): boolean {
  if (gridWidthPx <= 0 || viewSpan <= 0) return false;
  const parentIdx = model.lanes.findIndex((l) => l.processKey === spawn.parentKey);
  const childIdx = model.lanes.findIndex((l) => l.processKey === spawn.childKey);
  if (parentIdx < 0 || childIdx < 0) return false;
  const lo = Math.min(parentIdx, childIdx);
  const hi = Math.max(parentIdx, childIdx);
  if (hi - lo <= 1) return false;
  const hitMs = (GLYPH_HIT_PX / gridWidthPx) * viewSpan;
  for (let i = lo + 1; i < hi; i++) {
    const key = model.lanes[i]!.processKey;
    for (const e of model.events) {
      if (e.processKey !== key) continue;
      if (e.id === spawn.parentEventId || e.id === spawn.childEventId) continue;
      if (Math.abs(e.timestamp - spawn.timestamp) <= hitMs) return true;
    }
  }
  return false;
}

/** Zoom the window until spawn verticals clear unrelated nodes, or min span hit. */
function autoWindowClearingSpawns(
  model: TrajectoryModel,
  gridWidthPx: number,
): { start: number; end: number } {
  let start = model.tMin;
  let end = model.tMax;
  const full = Math.max(1, model.tMax - model.tMin);
  const minSpan = Math.max(1000, full * MIN_AUTO_SPAN_RATIO);
  const width = Math.max(gridWidthPx, 320);

  for (let iter = 0; iter < 32; iter++) {
    const span = end - start;
    const colliding = model.spawns.filter(
      (s) =>
        s.timestamp >= start &&
        s.timestamp <= end &&
        spawnCollides(model, s, start, span, width),
    );
    if (colliding.length === 0 || span <= minSpan) break;

    const focus =
      colliding.reduce((sum, s) => sum + s.timestamp, 0) / colliding.length;
    const nextSpan = Math.max(minSpan, span * 0.7);
    let ns = focus - nextSpan / 2;
    let ne = focus + nextSpan / 2;
    if (ns < model.tMin) {
      ns = model.tMin;
      ne = Math.min(model.tMax, ns + nextSpan);
    }
    if (ne > model.tMax) {
      ne = model.tMax;
      ns = Math.max(model.tMin, ne - nextSpan);
    }
    if (ns === start && ne === end) break;
    start = ns;
    end = ne;
  }
  return { start, end };
}

function MacroScrubber({
  model,
  windowStart,
  windowEnd,
  onChange,
  matchTimes = [],
  focusTimes = [],
  focusLineTimes = [],
  focusRange = null,
  trackHeight,
  onTrackHeightChange,
}: {
  model: TrajectoryModel;
  windowStart: number;
  windowEnd: number;
  onChange: (start: number, end: number) => void;
  matchTimes?: number[];
  /** Related entity / selection markers (dots) */
  focusTimes?: number[];
  /** Spawn connection markers (vertical lines) */
  focusLineTimes?: number[];
  /** Lifeline span highlight on the incident histogram */
  focusRange?: { start: number; end: number } | null;
  trackHeight: number;
  onTrackHeightChange: (h: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [draftRange, setDraftRange] = useState<{ a: number; b: number } | null>(
    null,
  );
  const span = Math.max(1, model.tMax - model.tMin);
  const leftPct = ((windowStart - model.tMin) / span) * 100;
  const widthPct = ((windowEnd - windowStart) / span) * 100;
  const viewSpan = Math.max(1, windowEnd - windowStart);

  const density = useMemo(() => {
    const buckets = Math.max(48, Math.round(trackHeight * 1.6));
    const counts = new Array(buckets).fill(0);
    for (const e of model.events) {
      let bi = Math.floor(((e.timestamp - model.tMin) / span) * buckets);
      if (bi >= buckets) bi = buckets - 1;
      if (bi < 0) bi = 0;
      counts[bi] += 1;
    }
    const max = Math.max(1, ...counts);
    return counts.map((c) => c / max);
  }, [model, span, trackHeight]);

  const axisTicks = useMemo(() => {
    const count = span < 120_000 ? 5 : span < 86_400_000 ? 7 : 8;
    return Array.from({ length: count }, (_, i) => {
      const t = model.tMin + (span * i) / (count - 1);
      const pct = (i / (count - 1)) * 100;
      const align = i === 0 ? "start" : i === count - 1 ? "end" : "center";
      return { t, pct, align, ...formatMacroTick(t, span) };
    });
  }, [model.tMin, span]);

  const pointerToTime = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return model.tMin;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return model.tMin + ratio * span;
  };

  const onBrushPointerDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const origStart = windowStart;
    const origEnd = windowEnd;
    const mode =
      (e.target as HTMLElement).dataset.handle === "left"
        ? "left"
        : (e.target as HTMLElement).dataset.handle === "right"
          ? "right"
          : "move";

    const onMove = (ev: PointerEvent) => {
      const el = trackRef.current;
      if (!el) return;
      const dx = ev.clientX - startX;
      const dTime = (dx / el.getBoundingClientRect().width) * span;
      const win = origEnd - origStart;
      if (mode === "move") {
        let ns = origStart + dTime;
        let ne = origEnd + dTime;
        if (ns < model.tMin) {
          ns = model.tMin;
          ne = model.tMin + win;
        }
        if (ne > model.tMax) {
          ne = model.tMax;
          ns = model.tMax - win;
        }
        onChange(ns, ne);
      } else if (mode === "left") {
        const ns = Math.min(
          origEnd - span * 0.02,
          Math.max(model.tMin, origStart + dTime),
        );
        onChange(ns, origEnd);
      } else {
        const ne = Math.max(
          origStart + span * 0.02,
          Math.min(model.tMax, origEnd + dTime),
        );
        onChange(origStart, ne);
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onTrackPointerDown = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest(".traj-macro-brush")) return;
    e.preventDefault();
    const t0 = pointerToTime(e.clientX);
    let t1 = t0;
    setDraftRange({ a: t0, b: t0 });

    const onMove = (ev: PointerEvent) => {
      t1 = pointerToTime(ev.clientX);
      setDraftRange({ a: t0, b: t1 });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setDraftRange(null);
      let start = Math.min(t0, t1);
      let end = Math.max(t0, t1);
      const minSpan = Math.max(span * 0.01, 1);
      if (end - start < minSpan) {
        const mid = (start + end) / 2;
        start = mid - minSpan / 2;
        end = mid + minSpan / 2;
      }
      onChange(Math.max(model.tMin, start), Math.min(model.tMax, end));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onTrackDoubleClick = (e: ReactMouseEvent) => {
    const center = pointerToTime(e.clientX);
    const half = Math.max(span * 0.08, (model.tMax - model.tMin) * 0.05);
    onChange(
      Math.max(model.tMin, center - half),
      Math.min(model.tMax, center + half),
    );
  };

  const onResizePointerDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = trackHeight;
    const onMove = (ev: PointerEvent) => {
      const next = Math.min(160, Math.max(28, startH + (ev.clientY - startY)));
      onTrackHeightChange(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const draftLeft =
    draftRange != null
      ? ((Math.min(draftRange.a, draftRange.b) - model.tMin) / span) * 100
      : 0;
  const draftWidth =
    draftRange != null
      ? (Math.abs(draftRange.b - draftRange.a) / span) * 100
      : 0;

  return (
    <div className="traj-macro">
      <div className="traj-macro-label">
        Incident window · drag track to select · drag edge below to resize
      </div>
      <div
        className="traj-macro-track"
        ref={trackRef}
        style={{ height: trackHeight }}
        onPointerDown={onTrackPointerDown}
        onDoubleClick={onTrackDoubleClick}
        title="Drag across the track to set the time window · drag the brush to scrub · double-click to zoom here"
      >
        <div className="traj-macro-density">
          {density.map((h, i) => (
            <div
              key={i}
              className="traj-macro-bar"
              style={{ height: `${Math.max(8, h * 100)}%` }}
            />
          ))}
        </div>
        {matchTimes.length > 0 && (
          <div className="traj-macro-hits" aria-hidden>
            {matchTimes.map((t, i) => {
              const pct = ((t - model.tMin) / span) * 100;
              return (
                <div
                  key={`search-${t}-${i}`}
                  className="traj-macro-hit"
                  style={{ left: `${pct}%` }}
                />
              );
            })}
          </div>
        )}
        {focusTimes.length > 0 && (
          <div className="traj-macro-hits related" aria-hidden>
            {focusTimes.map((t, i) => {
              const pct = ((t - model.tMin) / span) * 100;
              return (
                <div
                  key={`focus-${t}-${i}`}
                  className="traj-macro-hit related"
                  style={{ left: `${pct}%` }}
                />
              );
            })}
          </div>
        )}
        {focusLineTimes.length > 0 && (
          <div className="traj-macro-hits lines" aria-hidden>
            {focusLineTimes.map((t, i) => {
              const pct = ((t - model.tMin) / span) * 100;
              return (
                <div
                  key={`line-${t}-${i}`}
                  className="traj-macro-focus-line"
                  style={{ left: `${pct}%` }}
                />
              );
            })}
          </div>
        )}
        {focusRange && (
          <div
            className="traj-macro-focus-range"
            aria-hidden
            style={{
              left: `${((focusRange.start - model.tMin) / span) * 100}%`,
              width: `${Math.max(
                ((focusRange.end - focusRange.start) / span) * 100,
                0.35,
              )}%`,
            }}
          />
        )}
        {draftRange && (
          <div
            className="traj-macro-draft"
            style={{
              left: `${draftLeft}%`,
              width: `${Math.max(draftWidth, 0.2)}%`,
            }}
          />
        )}
        <div
          className="traj-macro-brush"
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          onPointerDown={onBrushPointerDown}
        >
          <div className="traj-macro-handle" data-handle="left" />
          <div className="traj-macro-handle" data-handle="right" />
        </div>
      </div>
      <div className="traj-macro-axis" aria-hidden>
        {axisTicks.map((tk) => (
          <div
            key={tk.t}
            className={`traj-macro-axis-tick align-${tk.align}`}
            style={{ left: `${tk.pct}%` }}
          >
            <span className="traj-macro-axis-mark" />
            <span className="traj-macro-axis-primary">{tk.primary}</span>
            {tk.secondary ? (
              <span className="traj-macro-axis-secondary">{tk.secondary}</span>
            ) : null}
          </div>
        ))}
      </div>
      <div className="traj-macro-viewing">
        Viewing {formatViewWindow(windowStart, viewSpan)} –{" "}
        {formatViewWindow(windowEnd, viewSpan)}
        <span className="traj-macro-viewing-span">
          ({formatDuration(viewSpan)})
        </span>
      </div>
      <div
        className="traj-macro-resize"
        onPointerDown={onResizePointerDown}
        title="Drag to resize histogram height"
      />
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    const s = Math.round((ms % 60_000) / 1000);
    return `${m}m ${s}s`;
  }
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.round((ms % 3_600_000) / 60_000);
    return `${h}h ${m}m`;
  }
  const d = Math.floor(ms / 86_400_000);
  const h = Math.round((ms % 86_400_000) / 3_600_000);
  return `${d}d ${h}h`;
}

function eventMatchesSearch(event: TrajectoryEvent, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (event.label.toLowerCase().includes(q)) return true;
  if (event.processName.toLowerCase().includes(q)) return true;
  if (event.eventType?.toLowerCase().includes(q)) return true;
  if (String(event.line).includes(q)) return true;
  for (const [k, v] of Object.entries(event.details)) {
    if (k.toLowerCase().includes(q) || String(v).toLowerCase().includes(q)) {
      return true;
    }
  }
  return false;
}

export function DagTrajectoryPanel() {
  const tab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const updateTab = useTabsStore((s) => s.updateTab);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<TrajectoryEvent | null>(null);
  const [selectedSpawnId, setSelectedSpawnId] = useState<string | null>(null);
  const [selectedLifelineKey, setSelectedLifelineKey] = useState<string | null>(
    null,
  );
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [inspectorWidth, setInspectorWidth] = useState(300);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [windowStart, setWindowStart] = useState<number | null>(null);
  const [windowEnd, setWindowEnd] = useState<number | null>(null);
  const [gridWidthPx, setGridWidthPx] = useState(800);
  const [enabledGlyphs, setEnabledGlyphs] = useState<Set<TrajectoryGlyphId>>(
    () => allGlyphsEnabled(),
  );
  const [trajSearch, setTrajSearch] = useState("");
  const [detailsSearch, setDetailsSearch] = useState("");
  const [macroTrackHeight, setMacroTrackHeight] = useState(48);
  const [exportBusy, setExportBusy] = useState(false);

  /** Glyphs marked “Do not map” in column mapping — stay greyed in the legend */
  const unmappedGlyphs = useMemo(
    () => new Set<TrajectoryGlyphId>(tab?.dagMapping?.disabledGlyphs ?? []),
    [tab?.dagMapping?.disabledGlyphs],
  );

  useEffect(() => {
    if (unmappedGlyphs.size === 0) return;
    setEnabledGlyphs((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of unmappedGlyphs) {
        if (next.has(id)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [unmappedGlyphs]);

  // Build from the full tab dataset — never from grid filters — so selecting an
  // event cannot collapse the swimlane graph to a single process.
  const trajRows = useMemo((): FilterableRow[] => {
    if (!tab) return [];
    return tab.rows.map((cells, i) => ({
      line: i + 1,
      tagged: tab.taggedLines.has(i + 1),
      cells,
    }));
  }, [tab?.rows, tab?.taggedLines]);

  const model = useMemo(() => {
    if (!tab?.dagMapping) return null;
    return buildTrajectory(trajRows, tab.columns, tab.dagMapping, {
      // Legend glyph toggles control visibility; always include these in the model
      showFiles: true,
      showNetwork: true,
      timestampColumn: tab.timestampColumn,
    });
  }, [tab, trajRows]);

  useEffect(() => {
    if (!model) return;
    const { start, end } = autoWindowClearingSpawns(model, gridWidthPx);
    setWindowStart(start);
    setWindowEnd(end);
  }, [model?.tMin, model?.tMax, model?.spawns.length, model?.events.length]);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const apply = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setGridWidthPx(w);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [model != null]);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleFullscreen = async () => {
    const el = rootRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch (err) {
      console.error(err);
      window.alert("Fullscreen was blocked. Maximize the pop-out panel instead.");
    }
  };

  const wStart = windowStart ?? model?.tMin ?? 0;
  const wEnd = windowEnd ?? model?.tMax ?? 1;
  const viewSpan = Math.max(1, wEnd - wStart);

  const axisTicks = useMemo(() => {
    const count = 8;
    return Array.from({ length: count }, (_, i) => {
      const t = wStart + (viewSpan * i) / (count - 1);
      return { t, pct: (i / (count - 1)) * 100, label: formatTick(t, viewSpan) };
    });
  }, [wStart, viewSpan]);

  const visibleEvents = useMemo(() => {
    if (!model) return [];
    return model.events.filter((e) => {
      if (e.timestamp < wStart || e.timestamp > wEnd) return false;
      // Structural glyphs always remain (may render muted)
      if (STRUCTURAL_GLYPHS.has(e.glyph)) return true;
      return enabledGlyphs.has(e.glyph);
    });
  }, [model, wStart, wEnd, enabledGlyphs]);

  const eventsByLane = useMemo(() => {
    const map = new Map<string, TrajectoryEvent[]>();
    for (const e of visibleEvents) {
      const list = map.get(e.processKey) ?? [];
      list.push(e);
      map.set(e.processKey, list);
    }
    return map;
  }, [visibleEvents]);

  /** Lanes with in-window glyphs, or a lifeline that crosses the current window */
  const activeLanes = useMemo(() => {
    if (!model) return [];
    return model.lanes.filter((lane) => {
      if (eventsByLane.has(lane.processKey)) return true;
      // Keep empty-of-glyphs lanes when their process lifeline still crosses the view
      if (lane.eventCount < 2) return false;
      const lifeEnd = Math.max(lane.lifeEnd, lane.lifeStart);
      return lane.lifeStart <= wEnd && lifeEnd >= wStart;
    });
  }, [model, eventsByLane, wStart, wEnd]);

  const laneIndex = useMemo(() => {
    const m = new Map<string, number>();
    activeLanes.forEach((l, i) => m.set(l.processKey, i));
    return m;
  }, [activeLanes]);

  const searchMatches = useMemo(() => {
    if (!model || !trajSearch.trim()) return [];
    return model.events.filter((e) => eventMatchesSearch(e, trajSearch));
  }, [model, trajSearch]);

  const searchMatchIds = useMemo(
    () => new Set(searchMatches.map((e) => e.id)),
    [searchMatches],
  );

  const searchMatchTimes = useMemo(
    () => searchMatches.map((e) => e.timestamp),
    [searchMatches],
  );

  const searchMatchLaneKeys = useMemo(
    () => new Set(searchMatches.map((e) => e.processKey)),
    [searchMatches],
  );

  const selectedSpawn = useMemo(() => {
    if (!model || !selectedSpawnId) return null;
    return (
      model.spawns.find((s) => s.parentEventId === selectedSpawnId) ?? null
    );
  }, [model, selectedSpawnId]);

  const relatedFocus = useMemo(() => {
    if (!model || !selected || selectedSpawnId || selectedLifelineKey) {
      return {
        correlation: null as ReturnType<typeof findRelatedEvents>["correlation"],
        relatedIds: new Set<string>(),
        laneKeys: new Set<string>(),
        times: [] as number[],
      };
    }
    const { correlation, related } = findRelatedEvents(selected, model.events);
    return {
      correlation,
      relatedIds: new Set(related.map((e) => e.id)),
      laneKeys: new Set(related.map((e) => e.processKey)),
      times: related.map((e) => e.timestamp),
    };
  }, [model, selected, selectedSpawnId, selectedLifelineKey]);

  const spawnFocusLaneKeys = useMemo(() => {
    if (!selectedSpawn) return new Set<string>();
    return new Set([selectedSpawn.parentKey, selectedSpawn.childKey]);
  }, [selectedSpawn]);

  const spawnFocusTimes = useMemo(() => {
    if (!selectedSpawn || !model) return [] as number[];
    const times = [selectedSpawn.timestamp];
    const child = model.events.find((e) => e.id === selectedSpawn.childEventId);
    if (child && child.timestamp !== selectedSpawn.timestamp) {
      times.push(child.timestamp);
    }
    return times;
  }, [selectedSpawn, model]);

  const selectedLifeline = useMemo(() => {
    if (!model || !selectedLifelineKey) return null;
    return (
      model.lanes.find((l) => l.processKey === selectedLifelineKey) ?? null
    );
  }, [model, selectedLifelineKey]);

  const lifelineFocusRange = useMemo(() => {
    if (!selectedLifeline) return null;
    return {
      start: selectedLifeline.lifeStart,
      end: Math.max(selectedLifeline.lifeEnd, selectedLifeline.lifeStart),
    };
  }, [selectedLifeline]);

  const lifelineFocusTimes = useMemo(() => {
    if (!selectedLifeline) return [] as number[];
    const times = [selectedLifeline.lifeStart];
    if (selectedLifeline.lifeEnd !== selectedLifeline.lifeStart) {
      times.push(selectedLifeline.lifeEnd);
    }
    return times;
  }, [selectedLifeline]);

  const togglePinnedField = useCallback(
    (field: string) => {
      if (!tab) return;
      const pinned = tab.dagPinnedDetailFields ?? [];
      const next = pinned.includes(field)
        ? pinned.filter((f) => f !== field)
        : [...pinned, field];
      updateTab(tab.id, { dagPinnedDetailFields: next });
    },
    [tab, updateTab],
  );

  const toggleGlyph = useCallback((id: TrajectoryGlyphId) => {
    setEnabledGlyphs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setViewWindow = useCallback((start: number, end: number) => {
    setWindowStart(start);
    setWindowEnd(end);
  }, []);

  const panWindow = useCallback(
    (deltaMs: number) => {
      if (!model) return;
      const span = viewSpan;
      let ns = wStart + deltaMs;
      let ne = wEnd + deltaMs;
      if (ns < model.tMin) {
        ns = model.tMin;
        ne = model.tMin + span;
      }
      if (ne > model.tMax) {
        ne = model.tMax;
        ns = model.tMax - span;
      }
      setViewWindow(ns, ne);
    },
    [model, wStart, wEnd, viewSpan, setViewWindow],
  );

  const zoomAround = useCallback(
    (factor: number, centerMs?: number) => {
      if (!model) return;
      const full = model.tMax - model.tMin;
      const minSpan = Math.max(500, full * 0.005);
      const mid = centerMs ?? (wStart + wEnd) / 2;
      const nextSpan = Math.min(full, Math.max(minSpan, viewSpan * factor));
      let ns = mid - nextSpan / 2;
      let ne = mid + nextSpan / 2;
      if (ns < model.tMin) {
        ns = model.tMin;
        ne = model.tMin + nextSpan;
      }
      if (ne > model.tMax) {
        ne = model.tMax;
        ns = model.tMax - nextSpan;
      }
      setViewWindow(ns, ne);
    },
    [model, wStart, wEnd, viewSpan, setViewWindow],
  );

  const fitAll = useCallback(() => {
    if (!model) return;
    setViewWindow(model.tMin, model.tMax);
  }, [model, setViewWindow]);

  const captureTrajFrame = useCallback(async () => {
    const frame = rootRef.current?.querySelector(
      ".traj-frame",
    ) as HTMLElement | null;
    if (!frame) throw new Error("aChart frame not ready.");
    const scroll = scrollRef.current;
    const prevOverflow = scroll?.style.overflow ?? "";
    const prevScrollTop = scroll?.scrollTop ?? 0;
    if (scroll) {
      scroll.style.overflow = "visible";
      scroll.scrollTop = 0;
    }
    try {
      await waitFrames(2);
      return await captureElementPng(frame, {
        filter: (node) => {
          if (!(node instanceof HTMLElement)) return true;
          return !node.classList.contains("dag-inspector");
        },
      });
    } finally {
      if (scroll) {
        scroll.style.overflow = prevOverflow;
        scroll.scrollTop = prevScrollTop;
      }
    }
  }, []);

  const onExportGraph = useCallback(
    async (choice: GraphExportChoice) => {
      if (!model) return;
      setExportBusy(true);
      const savedStart = wStart;
      const savedEnd = wEnd;
      const wasInspector = inspectorOpen;
      setInspectorOpen(false);
      try {
        await waitFrames(2);
        const base = defaultExportBasename("aChart");
        const path = await promptSavePath(
          `${base}-${choice.scope}.${choice.format}`,
          choice.format,
        );
        if (!path) return;

        if (choice.scope === "view") {
          const el =
            (scrollRef.current as HTMLElement | null) ??
            (rootRef.current?.querySelector(".traj-frame") as HTMLElement | null);
          if (!el) throw new Error("aChart view not ready.");
          const png = await captureElementPng(el);
          await savePngOrPdf(path, png, choice.format);
          return;
        }

        // Whole graph
        if (choice.format === "png") {
          setViewWindow(model.tMin, model.tMax);
          await waitFrames(3);
          const png = await captureTrajFrame();
          await writeExportFile(path, png);
          return;
        }

        // Whole graph PDF — page across time at the current zoom density
        const full = Math.max(1, model.tMax - model.tMin);
        let pageSpan = Math.max(1, viewSpan);
        const maxTimePages = 48;
        if (Math.ceil(full / pageSpan) > maxTimePages) {
          pageSpan = Math.ceil(full / maxTimePages);
        }

        const pages: string[] = [];
        for (let t0 = model.tMin; t0 < model.tMax - 0.5; t0 += pageSpan) {
          const t1 = Math.min(model.tMax, t0 + pageSpan);
          setViewWindow(t0, Math.max(t0 + 1, t1));
          await waitFrames(3);
          pages.push(await captureTrajFrame());
          if (pages.length >= maxTimePages) break;
        }

        if (pages.length === 0) throw new Error("Nothing to export.");
        const pdfB64 = pngDataUrlsToMultiPagePdfBase64(pages);
        await writeExportFile(path, pdfB64);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        window.alert(`Export failed: ${msg}`);
      } finally {
        setViewWindow(savedStart, savedEnd);
        setInspectorOpen(wasInspector);
        setExportBusy(false);
        await waitFrames(1);
      }
    },
    [
      model,
      wStart,
      wEnd,
      viewSpan,
      inspectorOpen,
      setViewWindow,
      captureTrajFrame,
    ],
  );

  const onSelect = useCallback((evt: TrajectoryEvent) => {
    setSelectedSpawnId(null);
    setSelectedLifelineKey(null);
    setSelected(evt);
    setInspectorOpen(true);
    setDetailsSearch("");
  }, []);

  const onSelectSpawn = useCallback(
    (spawn: TrajectorySpawn) => {
      setSelectedSpawnId(spawn.parentEventId);
      setSelectedLifelineKey(null);
      const evt = model?.events.find((e) => e.id === spawn.parentEventId);
      if (evt) {
        setSelected(evt);
        setInspectorOpen(true);
        setDetailsSearch("");
      }
    },
    [model],
  );

  const onSelectLifeline = useCallback(
    (processKey: string) => {
      setSelectedLifelineKey(processKey);
      setSelectedSpawnId(null);
      // Prefer the first in-window event on this lane for the details panel
      const laneEvts = model?.events
        .filter((e) => e.processKey === processKey)
        .sort((a, b) => a.timestamp - b.timestamp || a.line - b.line);
      const first = laneEvts?.[0];
      if (first) {
        setSelected(first);
        setInspectorOpen(true);
        setDetailsSearch("");
      }
    },
    [model],
  );

  const showInGrid = useCallback(() => {
    if (!tab || !selected) return;
    // Jump to the CSV row with surrounding context — highlight + scroll, no line filter.
    useTabsStore.getState().clearColumnFilters(tab.id);
    useTabsStore.getState().setRowHighlight(tab.id, selected.line, "#2f5d4a");
    if (document.fullscreenElement) void document.exitFullscreen();
    setDetailsExpanded(false);
    setInspectorOpen(false);
    setSelected(null);
    setSelectedSpawnId(null);
    setSelectedLifelineKey(null);
    updateTab(tab.id, {
      showDag: false,
      timeRangeFilter: null,
      focusLine: selected.line,
    });
  }, [tab, selected, updateTab]);

  const closeInspector = useCallback(() => {
    setInspectorOpen(false);
    setSelected(null);
    setSelectedSpawnId(null);
    setSelectedLifelineKey(null);
    setDetailsExpanded(false);
  }, []);

  const clearHighlights = useCallback(() => {
    setTrajSearch("");
    setDetailsSearch("");
    setSelected(null);
    setSelectedSpawnId(null);
    setSelectedLifelineKey(null);
    setDetailsExpanded(false);
    setInspectorOpen(false);
  }, []);

  const hasHighlights =
    Boolean(trajSearch.trim()) ||
    selected != null ||
    selectedSpawnId != null ||
    selectedLifelineKey != null;

  const onResizeInspector = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = inspectorWidth;
      const onMove = (ev: PointerEvent) => {
        const dx = startX - ev.clientX;
        const next = Math.min(640, Math.max(220, startW + dx));
        setInspectorWidth(next);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [inspectorWidth],
  );

  const onGridWheel = useCallback(
    (e: WheelEvent) => {
      if (!model) return;
      // Shift+scroll: pan the view across the full incident window
      if (e.shiftKey) {
        e.preventDefault();
        const el = scrollRef.current;
        const width = Math.max(
          gridWidthPx,
          el?.getBoundingClientRect().width ?? 400,
        );
        const delta =
          (e.deltaY / Math.max(width, 1)) * viewSpan ||
          (e.deltaX / Math.max(width, 1)) * viewSpan;
        panWindow(delta);
        return;
      }
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const el = scrollRef.current;
      if (!el) {
        zoomAround(e.deltaY > 0 ? 1.25 : 0.8);
        return;
      }
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left + el.scrollLeft - SIDEBAR_W;
      const gridW = Math.max(1, el.scrollWidth - SIDEBAR_W);
      const ratio = Math.min(1, Math.max(0, x / gridW));
      const center = wStart + ratio * viewSpan;
      zoomAround(e.deltaY > 0 ? 1.25 : 0.8, center);
    },
    [model, zoomAround, panWindow, wStart, viewSpan, gridWidthPx],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => onGridWheel(e);
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [onGridWheel]);

  if (!tab?.showDag || !tab.dagMapping || !model) return null;

  const gridHeight = Math.max(200, activeLanes.length * LANE_H + AXIS_H);

  return (
    <div className="dag-popout-overlay" role="dialog" aria-label="aChart: Asset Logs FlowChart">
      <div className="dag-popout" ref={rootRef}>
        <div className="dag-toolbar">
          <div className="dag-toolbar-title">
            <strong>aChart: Asset Logs FlowChart</strong>
            <span className="dag-toolbar-sub">
              {tab.dagMapping?.hostValue
                ? `Host: ${tab.dagMapping.hostValue} · `
                : ""}
              Shift+scroll to pan · Ctrl/⌘+scroll to zoom · Fit = full incident ·
              Click legend to filter
            </span>
          </div>
          <div className="traj-search-wrap">
            <input
              type="search"
              placeholder="Search aChart…"
              value={trajSearch}
              onChange={(e) => setTrajSearch(e.target.value)}
              title="Search event fields; matches appear as dots on the incident window and glow on glyphs"
            />
            {trajSearch.trim() ? (
              <span className="traj-search-count">
                {searchMatches.length} match
                {searchMatches.length === 1 ? "" : "es"}
              </span>
            ) : null}
          </div>
          <button
            type="button"
            onClick={clearHighlights}
            disabled={!hasHighlights}
            title="Clear search, selection, spawn/lifeline, and related highlights"
          >
            Clear highlights
          </button>
          <div className="traj-zoom-btns">
            <button
              type="button"
              title="Zoom in"
              onClick={() => zoomAround(0.7)}
            >
              Zoom in
            </button>
            <button
              type="button"
              title="Zoom out"
              onClick={() => zoomAround(1.4)}
            >
              Zoom out
            </button>
            <button type="button" title="Fit all time" onClick={fitAll}>
              Fit
            </button>
          </div>
          <GraphExportMenu
            busy={exportBusy}
            onExport={onExportGraph}
            wholePdfHint="Pages across the full timeline at the current zoom density (and splits tall pages vertically)"
          />
          <button
            type="button"
            onClick={() => updateTab(tab.id, { showDagMapping: true })}
          >
            Remap columns…
          </button>
          <button type="button" onClick={() => void toggleFullscreen()}>
            {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              updateTab(tab.id, { showDag: false });
              setSelected(null);
              setSelectedSpawnId(null);
              setSelectedLifelineKey(null);
              setInspectorOpen(false);
            }}
          >
            Close
          </button>
        </div>

        {model.warning && <p className="histogram-hint">{model.warning}</p>}

        <MacroScrubber
          model={model}
          windowStart={wStart}
          windowEnd={wEnd}
          onChange={setViewWindow}
          matchTimes={searchMatchTimes}
          focusTimes={
            selectedSpawnId || selectedLifelineKey ? [] : relatedFocus.times
          }
          focusLineTimes={
            selectedLifelineKey ? lifelineFocusTimes : spawnFocusTimes
          }
          focusRange={lifelineFocusRange}
          trackHeight={macroTrackHeight}
          onTrackHeightChange={setMacroTrackHeight}
        />

        <div className="traj-legend">
          {LEGEND_GLYPHS.map((id) => {
            const unmapped = unmappedGlyphs.has(id);
            const on = !unmapped && enabledGlyphs.has(id);
            const structural = STRUCTURAL_GLYPHS.has(id);
            return (
              <button
                key={id}
                type="button"
                className={`traj-legend-item traj-kind-${id} ${unmapped ? "unmapped" : on ? "" : structural ? "muted" : "off"}`}
                title={
                  unmapped
                    ? "Not mapped — open Remap columns to assign this glyph"
                    : structural
                      ? on
                        ? "Click to mute (stays on map, greyed)"
                        : "Click to show fully"
                      : on
                        ? "Click to hide this event type"
                        : "Click to show this event type"
                }
                onClick={() => {
                  if (!unmapped) toggleGlyph(id);
                }}
                disabled={unmapped}
                aria-pressed={unmapped ? false : on}
              >
                <Glyph glyph={id} /> {glyphTitle(id)}
              </button>
            );
          })}
          <span className="traj-legend-meta">
            {activeLanes.length}/{model.lanes.length} processes ·{" "}
            {visibleEvents.length}/{model.events.length} events in view
            {relatedFocus.correlation &&
            !selectedSpawnId &&
            !selectedLifelineKey ? (
              <>
                {" "}
                · Related: {relatedFocus.correlation.label} (
                {relatedFocus.relatedIds.size})
              </>
            ) : null}
            {selectedSpawn ? (
              <>
                {" "}
                · Spawn: {selectedSpawn.parentName} → {selectedSpawn.childName}
              </>
            ) : null}
            {selectedLifeline ? (
              <>
                {" "}
                · Lifeline: {selectedLifeline.processName}
              </>
            ) : null}
          </span>
        </div>

        <div
          className={`dag-popout-body ${inspectorOpen ? "with-inspector" : ""}`}
        >
          <div className="traj-main">
            <div
              className="traj-scroll"
              ref={scrollRef}
              onClick={(e) => {
                const t = e.target as HTMLElement;
                if (
                  t.closest(
                    ".traj-glyph, .traj-lifeline, .traj-spawn-link, button, input, a, label",
                  )
                ) {
                  return;
                }
                if (hasHighlights) clearHighlights();
              }}
            >
              <div
                className="traj-frame"
                style={{ minHeight: `max(${gridHeight}px, 100%)` }}
              >
                <div
                  className="traj-sidebar"
                  style={{ width: SIDEBAR_W }}
                >
                  <div
                    className="traj-sidebar-head"
                    style={{ height: AXIS_H }}
                  >
                    Process
                  </div>
                  {activeLanes.map((lane) => {
                    const searchLane = searchMatchLaneKeys.has(lane.processKey);
                    const spawnLane = spawnFocusLaneKeys.has(lane.processKey);
                    const lifeLane = selectedLifelineKey === lane.processKey;
                    const relatedLane =
                      !selectedSpawnId &&
                      !selectedLifelineKey &&
                      relatedFocus.laneKeys.has(lane.processKey);
                    return (
                    <div
                      key={lane.processKey}
                      className={`traj-lane-label ${searchLane ? "search-hit" : ""} ${relatedLane ? "related-hit" : ""} ${spawnLane ? "spawn-hit" : ""} ${lifeLane ? "lifeline-hit" : ""}`}
                      style={{
                        height: LANE_H,
                        paddingLeft: 8 + lane.depth * 12,
                      }}
                      title={
                        lane.parentName
                          ? `${lane.processName} ← ${lane.parentName}`
                          : lane.processName
                      }
                    >
                      <span className="traj-lane-name">
                        {lane.processName}
                      </span>
                    </div>
                    );
                  })}
                </div>

                <div className="traj-grid" style={{ minWidth: "100%" }} ref={gridRef}>
                  <div className="traj-axis" style={{ height: AXIS_H }}>
                    {axisTicks.map((tk) => (
                      <div
                        key={tk.t}
                        className="traj-axis-tick"
                        style={{ left: `${timeToPct(tk.t, wStart, viewSpan)}%` }}
                      >
                        <span>{tk.label}</span>
                      </div>
                    ))}
                  </div>

                  {activeLanes.map((lane, li) => {
                    const evts = eventsByLane.get(lane.processKey) ?? [];
                    const seg =
                      lane.eventCount >= 2
                        ? lifeSegment(
                            lane.lifeStart,
                            lane.lifeEnd,
                            wStart,
                            viewSpan,
                          )
                        : null;
                    return (
                      <div
                        key={lane.processKey}
                        className={`traj-lane-row ${li % 2 ? "alt" : ""}`}
                        style={{ height: LANE_H }}
                      >
                        {seg && (
                          <button
                            type="button"
                            className={`traj-lifeline ${lane.terminated ? "terminated" : ""} ${selectedLifelineKey === lane.processKey ? "active" : ""}`}
                            style={{
                              left: `${seg.left}%`,
                              width: `${seg.width}%`,
                            }}
                            title={
                              lane.terminated
                                ? `Lifeline ${new Date(lane.lifeStart).toLocaleString()} → exit ${new Date(lane.lifeEnd).toLocaleString()}\nClick to highlight on histogram`
                                : `Lifeline ${new Date(lane.lifeStart).toLocaleString()} → ${new Date(lane.lifeEnd).toLocaleString()}\nClick to highlight on histogram`
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectLifeline(lane.processKey);
                            }}
                          />
                        )}
                        {evts.map((evt) => {
                          if (evt.timestamp < wStart || evt.timestamp > wEnd) {
                            return null;
                          }
                          const pct = timeToPct(evt.timestamp, wStart, viewSpan);
                          const active = selected?.id === evt.id;
                          const muted =
                            STRUCTURAL_GLYPHS.has(evt.glyph) &&
                            !enabledGlyphs.has(evt.glyph);
                          const searchHit = searchMatchIds.has(evt.id);
                          const relatedHit =
                            !selectedSpawnId &&
                            !selectedLifelineKey &&
                            relatedFocus.relatedIds.has(evt.id);
                          return (
                            <button
                              key={evt.id}
                              type="button"
                              className={`traj-glyph traj-kind-${glyphClass(evt)} ${active ? "active" : ""} ${muted ? "muted" : ""} ${searchHit ? "search-hit" : ""} ${relatedHit ? "related-hit" : ""}`}
                              style={{ left: `${pct}%` }}
                              title={`${evt.label}\n${new Date(evt.timestamp).toLocaleString()}\n${evt.eventType}`}
                              onClick={() => onSelect(evt)}
                            >
                              <Glyph glyph={evt.glyph} />
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}

                  <div className="traj-connectors">
                    {model.spawns.map((spawn) => {
                      const parentEvt = visibleEvents.find(
                        (e) => e.id === spawn.parentEventId,
                      );
                      const childEvt = visibleEvents.find(
                        (e) => e.id === spawn.childEventId,
                      );
                      if (!parentEvt || !childEvt) return null;

                      const parentIdx = laneIndex.get(spawn.parentKey);
                      const childIdx = laneIndex.get(spawn.childKey);
                      if (parentIdx == null || childIdx == null) return null;

                      const xPct = timeToPct(spawn.timestamp, wStart, viewSpan);
                      const y1 = AXIS_H + parentIdx * LANE_H + LANE_H / 2;
                      const y2 = AXIS_H + childIdx * LANE_H + LANE_H / 2;
                      const top = Math.min(y1, y2);
                      const height = Math.max(Math.abs(y2 - y1), 2);
                      const spawnMuted = !enabledGlyphs.has("spawn");
                      const spawnActive =
                        selectedSpawnId === spawn.parentEventId;
                      return (
                        <button
                          key={spawn.parentEventId}
                          type="button"
                          className={`traj-spawn-link ${spawnMuted ? "muted" : ""} ${spawnActive ? "active" : ""}`}
                          style={{
                            left: `${xPct}%`,
                            top,
                            height,
                          }}
                          title={`Spawn link: ${spawn.parentName} → ${spawn.childName}\nClick to highlight on histogram`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectSpawn(spawn);
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {inspectorOpen && (
            <aside
              className="dag-inspector"
              style={{ width: inspectorWidth, maxWidth: "none" }}
            >
              <div
                className="dag-inspector-resize"
                onPointerDown={onResizeInspector}
                title="Drag to resize"
              />
              <div className="dag-inspector-head">
                <h3>Event details</h3>
                {selected && (
                  <button
                    type="button"
                    onClick={() => setDetailsExpanded(true)}
                    title="Open details in a larger window"
                  >
                    Expand
                  </button>
                )}
                <button type="button" onClick={closeInspector} title="Close panel">
                  Close
                </button>
              </div>
              {!selected ? (
                <p className="side-panel-help">
                  Click a glyph on a process track to inspect file path, command
                  line, network destination, and other row fields.
                </p>
              ) : (
                <EventDetailsBody
                  event={selected}
                  detailsSearch={detailsSearch}
                  onDetailsSearchChange={setDetailsSearch}
                  pinnedFields={tab.dagPinnedDetailFields ?? []}
                  onTogglePin={togglePinnedField}
                  relatedLabel={
                    selectedSpawnId || selectedLifelineKey
                      ? null
                      : (relatedFocus.correlation?.label ?? null)
                  }
                  relatedCount={
                    selectedSpawnId || selectedLifelineKey
                      ? 0
                      : relatedFocus.relatedIds.size
                  }
                  onCopy={() => {
                    const text = [
                      `Process: ${selected.processName}`,
                      `Label: ${selected.label}`,
                      `Type: ${selected.eventType}`,
                      ...Object.entries(selected.details).map(
                        ([k, v]) => `${k}: ${v}`,
                      ),
                    ].join("\n");
                    void navigator.clipboard.writeText(text);
                  }}
                  onShowInGrid={showInGrid}
                />
              )}
            </aside>
          )}
        </div>

        {detailsExpanded && selected && (
          <div
            className="dag-details-expand-overlay"
            role="dialog"
            aria-label="Event details"
          >
            <div className="dag-details-expand-panel">
              <div className="dag-inspector-head">
                <h3>Event details</h3>
                <button
                  type="button"
                  onClick={() => setDetailsExpanded(false)}
                >
                  Close
                </button>
              </div>
              <EventDetailsBody
                event={selected}
                detailsSearch={detailsSearch}
                onDetailsSearchChange={setDetailsSearch}
                pinnedFields={tab.dagPinnedDetailFields ?? []}
                onTogglePin={togglePinnedField}
                relatedLabel={
                  selectedSpawnId || selectedLifelineKey
                    ? null
                    : (relatedFocus.correlation?.label ?? null)
                }
                relatedCount={
                  selectedSpawnId || selectedLifelineKey
                    ? 0
                    : relatedFocus.relatedIds.size
                }
                onCopy={() => {
                  const text = [
                    `Process: ${selected.processName}`,
                    `Label: ${selected.label}`,
                    `Type: ${selected.eventType}`,
                    ...Object.entries(selected.details).map(
                      ([k, v]) => `${k}: ${v}`,
                    ),
                  ].join("\n");
                  void navigator.clipboard.writeText(text);
                }}
                onShowInGrid={showInGrid}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EventDetailsBody({
  event,
  detailsSearch,
  onDetailsSearchChange,
  pinnedFields,
  onTogglePin,
  relatedLabel,
  relatedCount,
  onCopy,
  onShowInGrid,
}: {
  event: TrajectoryEvent;
  detailsSearch: string;
  onDetailsSearchChange: (q: string) => void;
  pinnedFields: string[];
  onTogglePin: (field: string) => void;
  relatedLabel?: string | null;
  relatedCount?: number;
  onCopy: () => void;
  onShowInGrid: () => void;
}) {
  const isSpawn = event.glyph === "spawn";
  const q = detailsSearch.trim().toLowerCase();
  const pinnedSet = useMemo(() => new Set(pinnedFields), [pinnedFields]);

  const pinnedRows = useMemo(() => {
    return pinnedFields
      .map((k) => {
        const present = Object.prototype.hasOwnProperty.call(event.details, k);
        const v = present ? String(event.details[k] ?? "") : "";
        const missing = !present || isBlankField(v);
        return { k, v, missing };
      })
      .filter(({ k, v, missing }) => {
        if (!q) return true;
        return (
          k.toLowerCase().includes(q) ||
          (!missing && v.toLowerCase().includes(q))
        );
      });
  }, [pinnedFields, event.details, q]);

  const otherRows = useMemo(() => {
    return Object.entries(event.details)
      .filter(([k, v]) => !pinnedSet.has(k) && !isBlankField(v))
      .filter(([k, v]) => {
        if (!q) return true;
        return k.toLowerCase().includes(q) || v.toLowerCase().includes(q);
      });
  }, [event.details, pinnedSet, q]);

  const cols = "minmax(72px, 34%) minmax(0, 1fr) auto";

  return (
    <>
      <div className={`dag-inspector-badge traj-kind-${event.glyph}`}>
        {glyphTitle(event.glyph)}
      </div>
      <p className="dag-inspector-title">{event.label}</p>
      <p className="side-panel-help">
        {new Date(event.timestamp).toLocaleString()}
        {event.eventType ? ` · ${event.eventType}` : ""}
        <br />
        Lane process: {event.processName}
        {isSpawn && event.details["Spawned process"]
          ? ` · spawned ${event.details["Spawned process"]}`
          : null}
        <br />
        CSV line {event.line}
        {relatedLabel && relatedCount && relatedCount > 1 ? (
          <>
            <br />
            Highlighting {relatedCount} related events · {relatedLabel}
          </>
        ) : null}
      </p>
      <div className="dag-inspector-search">
        <input
          type="search"
          placeholder="Search fields in this event…"
          value={detailsSearch}
          onChange={(e) => onDetailsSearchChange(e.target.value)}
        />
      </div>
      <p className="dag-inspector-pinned-hint">
        Pin a field to always show it at the top of event details for every
        event type.
      </p>
      <dl className="dag-inspector-dl">
        {pinnedRows.map(({ k, v, missing }) => (
          <div
            key={`pin-${k}`}
            className="pinned"
            style={{ gridTemplateColumns: cols }}
          >
            <dt>{k}</dt>
            <dd className={missing ? "missing" : undefined} title={v}>
              {missing ? "—" : v}
            </dd>
            <button
              type="button"
              className="dag-pin-btn pinned"
              title="Unpin this field"
              onClick={() => onTogglePin(k)}
            >
              Unpin
            </button>
          </div>
        ))}
        {otherRows.map(([k, v]) => (
          <div key={k} style={{ gridTemplateColumns: cols }}>
            <dt>{k}</dt>
            <dd title={v}>{v}</dd>
            <button
              type="button"
              className={`dag-pin-btn ${pinnedSet.has(k) ? "pinned" : ""}`}
              title="Pin this field for all events"
              onClick={() => onTogglePin(k)}
            >
              Pin
            </button>
          </div>
        ))}
        {pinnedRows.length === 0 && otherRows.length === 0 && (
          <div style={{ gridTemplateColumns: "1fr" }}>
            <dd className="missing">
              {q ? "No fields match this search." : "No fields to show."}
            </dd>
          </div>
        )}
      </dl>
      <div className="side-panel-actions">
        <button type="button" className="primary-cta" onClick={onCopy}>
          Copy details
        </button>
        <button
          type="button"
          title="Closes aChart, highlights this row, and scrolls to it in the timeline grid"
          onClick={onShowInGrid}
        >
          Show in grid
        </button>
      </div>
      <p className="side-panel-help" style={{ marginTop: 8 }}>
        “Show in grid” closes this view, highlights CSV line {event.line}, and
        scrolls to it so surrounding rows stay visible. Use{" "}
        <strong>Clear highlights</strong> in the grid toolbar (or the status bar)
        to remove the highlight.
      </p>
    </>
  );
}

