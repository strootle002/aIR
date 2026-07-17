import { useEffect, useMemo, useState } from "react";
import type { DagMapping, TrajectoryGlyphId } from "../lib/types";
import {
  suggestDagMapping,
  TRAJECTORY_GLYPH_DEFS,
  classifyAction,
  collectActionValues,
  collectHostValues,
} from "../lib/dag";
import { useTabsStore } from "../stores/tabsStore";

/** Glyphs the user can map log actions onto (spawn stays synthetic). */
const MAPPABLE_GLYPHS: TrajectoryGlyphId[] = [
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

type GlyphConfig = {
  /** false = do not put this node type on the map */
  mapped: boolean;
  /** event.action values assigned to this glyph */
  actions: string[];
};

function emptyGlyphConfig(): Record<string, GlyphConfig> {
  const out: Record<string, GlyphConfig> = {};
  for (const id of MAPPABLE_GLYPHS) {
    out[id] = { mapped: true, actions: [] };
  }
  return out;
}

function buildConfigFromSaved(
  actionValues: { value: string; count: number }[],
  savedMap?: Record<string, TrajectoryGlyphId>,
  disabled?: TrajectoryGlyphId[],
): Record<string, GlyphConfig> {
  const cfg = emptyGlyphConfig();
  const disabledSet = new Set(disabled ?? []);

  for (const id of MAPPABLE_GLYPHS) {
    if (disabledSet.has(id)) cfg[id].mapped = false;
  }

  if (savedMap && Object.keys(savedMap).length > 0) {
    for (const [action, glyph] of Object.entries(savedMap)) {
      if (!cfg[glyph]) continue;
      if (!cfg[glyph].actions.includes(action)) {
        cfg[glyph].actions.push(action);
      }
      cfg[glyph].mapped = true;
    }
    return cfg;
  }

  // Defaults: group by regex classification
  for (const { value } of actionValues) {
    const glyph = classifyAction(value).glyph;
    if (!cfg[glyph]) continue;
    if (disabledSet.has(glyph)) continue;
    if (!cfg[glyph].actions.includes(value)) {
      cfg[glyph].actions.push(value);
    }
  }
  return cfg;
}

function configToMaps(cfg: Record<string, GlyphConfig>): {
  actionGlyphMap: Record<string, TrajectoryGlyphId>;
  disabledGlyphs: TrajectoryGlyphId[];
} {
  const actionGlyphMap: Record<string, TrajectoryGlyphId> = {};
  const disabledGlyphs: TrajectoryGlyphId[] = [];
  for (const id of MAPPABLE_GLYPHS) {
    const row = cfg[id];
    if (!row?.mapped) {
      disabledGlyphs.push(id);
      continue;
    }
    for (const action of row.actions) {
      actionGlyphMap[action] = id;
    }
  }
  return { actionGlyphMap, disabledGlyphs };
}

export function DagMappingDialog() {
  const tab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const updateTab = useTabsStore((s) => s.updateTab);

  const suggested = useMemo(
    () => (tab ? suggestDagMapping(tab.columns) : {}),
    [tab?.columns],
  );

  const [processCol, setProcessCol] = useState("");
  const [parentCol, setParentCol] = useState("");
  const [processPidCol, setProcessPidCol] = useState("");
  const [parentPidCol, setParentPidCol] = useState("");
  const [eventTypeCol, setEventTypeCol] = useState("");
  const [hostCol, setHostCol] = useState("");
  const [hostValue, setHostValue] = useState("");
  const [glyphConfig, setGlyphConfig] = useState<Record<string, GlyphConfig>>(
    () => emptyGlyphConfig(),
  );
  const [expandedGlyph, setExpandedGlyph] = useState<string | null>(null);

  const actionValues = useMemo(() => {
    if (!tab || !eventTypeCol) return [];
    return collectActionValues(tab.rows, tab.columns, eventTypeCol);
  }, [tab, eventTypeCol]);

  const hostValues = useMemo(() => {
    if (!tab || !hostCol) return [];
    return collectHostValues(tab.rows, tab.columns, hostCol);
  }, [tab, hostCol]);

  useEffect(() => {
    if (!tab?.showDagMapping) return;
    setProcessCol(tab.dagMapping?.processCol ?? suggested.processCol ?? "");
    setParentCol(tab.dagMapping?.parentCol ?? suggested.parentCol ?? "");
    setProcessPidCol(
      tab.dagMapping?.processPidCol ?? suggested.processPidCol ?? "",
    );
    setParentPidCol(
      tab.dagMapping?.parentPidCol ?? suggested.parentPidCol ?? "",
    );
    const nextAction =
      tab.dagMapping?.eventTypeCol ?? suggested.eventTypeCol ?? "";
    setEventTypeCol(nextAction);
    const nextHost = tab.dagMapping?.hostCol ?? suggested.hostCol ?? "";
    setHostCol(nextHost);
    setHostValue(tab.dagMapping?.hostValue ?? "");
    setExpandedGlyph(null);
  }, [tab?.showDagMapping, tab?.id, suggested, tab?.dagMapping]);

  // When host column changes, keep a saved value if still valid; else auto-pick
  // when there's exactly one hostname.
  useEffect(() => {
    if (!tab?.showDagMapping || !hostCol) {
      if (!hostCol) setHostValue("");
      return;
    }
    const values = collectHostValues(tab.rows, tab.columns, hostCol);
    const saved =
      tab.dagMapping?.hostCol === hostCol ? tab.dagMapping?.hostValue : null;
    if (saved && values.some((v) => v.value === saved)) {
      setHostValue(saved);
      return;
    }
    if (values.length === 1) {
      setHostValue(values[0]!.value);
      return;
    }
    setHostValue("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab?.showDagMapping, tab?.id, hostCol]);

  useEffect(() => {
    if (!tab?.showDagMapping || !eventTypeCol) {
      if (!eventTypeCol) setGlyphConfig(emptyGlyphConfig());
      return;
    }
    const values = collectActionValues(tab.rows, tab.columns, eventTypeCol);
    const sameCol = tab.dagMapping?.eventTypeCol === eventTypeCol;
    setGlyphConfig(
      buildConfigFromSaved(
        values,
        sameCol ? tab.dagMapping?.actionGlyphMap : undefined,
        sameCol ? tab.dagMapping?.disabledGlyphs : undefined,
      ),
    );
    // Only re-seed when the action column (or dialog open) changes — not on every edit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab?.showDagMapping, tab?.id, eventTypeCol]);

  if (!tab?.showDagMapping) return null;

  const colOptions = tab.columns;

  const setMapped = (glyph: TrajectoryGlyphId, mapped: boolean) => {
    setGlyphConfig((prev) => ({
      ...prev,
      [glyph]: {
        mapped,
        actions: mapped ? prev[glyph]?.actions ?? [] : [],
      },
    }));
  };

  const toggleAction = (glyph: TrajectoryGlyphId, action: string) => {
    setGlyphConfig((prev) => {
      const wasOn = prev[glyph]?.actions.includes(action) ?? false;
      const next: Record<string, GlyphConfig> = {};
      for (const id of MAPPABLE_GLYPHS) {
        const row = prev[id] ?? { mapped: true, actions: [] };
        next[id] = {
          mapped: row.mapped,
          actions: row.actions.filter((a) => a !== action),
        };
      }
      if (!wasOn) {
        const target = next[glyph] ?? { mapped: true, actions: [] };
        target.mapped = true;
        target.actions = [...target.actions, action];
        next[glyph] = target;
      }
      return next;
    });
  };

  const apply = () => {
    if (!processCol || !parentCol) {
      window.alert("Process and Parent process columns are required.");
      return;
    }
    const { actionGlyphMap, disabledGlyphs } = configToMaps(glyphConfig);
    const mapping: DagMapping = {
      processCol,
      parentCol,
      processPidCol: processPidCol || null,
      parentPidCol: parentPidCol || null,
      eventTypeCol: eventTypeCol || null,
      hostCol: hostCol || null,
      hostValue: hostCol && hostValue ? hostValue : null,
      actionGlyphMap: eventTypeCol ? actionGlyphMap : undefined,
      disabledGlyphs: eventTypeCol ? disabledGlyphs : undefined,
    };
    updateTab(tab.id, {
      dagMapping: mapping,
      showDag: true,
      showDagMapping: false,
      showHistogram: true,
    });
  };

  return (
    <div
      className="settings-overlay dag-mapping-overlay"
      role="dialog"
      aria-label="aChart: Asset Logs FlowChart column mapping"
    >
      <div className="settings-panel dag-mapping-panel">
        <div className="settings-header">
          <h2>Convert to aChart: Asset Logs FlowChart</h2>
          <button
            type="button"
            onClick={() => updateTab(tab.id, { showDagMapping: false })}
          >
            ×
          </button>
        </div>
        <p className="settings-help">
          Map columns for **aChart: Asset Logs FlowChart**. Map process identity
          and an event action column. Optionally scope to one hostname when the
          CSV covers multiple machines. Then assign log action values to each
          glyph — or mark a glyph as not mapped so it stays off the chart.
        </p>

        <label className="dag-map-field">
          Hostname column (optional)
          <select
            value={hostCol}
            onChange={(e) => setHostCol(e.target.value)}
          >
            <option value="">— none —</option>
            {colOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        {hostCol ? (
          <label className="dag-map-field">
            Hostname value
            <select
              value={hostValue}
              onChange={(e) => setHostValue(e.target.value)}
            >
              <option value="">
                {hostValues.length > 1
                  ? "— select a host (recommended) —"
                  : "— all hosts —"}
              </option>
              {hostValues.map(({ value, count }) => (
                <option key={value} value={value}>
                  {value} ({count})
                </option>
              ))}
            </select>
            {hostValues.length > 1 && !hostValue ? (
              <span className="dag-map-field-hint">
                {hostValues.length} distinct hosts in this column — pick one to
                keep the aChart on a single machine.
              </span>
            ) : null}
          </label>
        ) : null}
        <label className="dag-map-field">
          Process name *
          <select value={processCol} onChange={(e) => setProcessCol(e.target.value)}>
            <option value="">— select —</option>
            {colOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="dag-map-field">
          Parent process name *
          <select value={parentCol} onChange={(e) => setParentCol(e.target.value)}>
            <option value="">— select —</option>
            {colOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="dag-map-field">
          Process PID (optional)
          <select
            value={processPidCol}
            onChange={(e) => setProcessPidCol(e.target.value)}
          >
            <option value="">— none —</option>
            {colOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="dag-map-field">
          Parent process PID (optional)
          <select
            value={parentPidCol}
            onChange={(e) => setParentPidCol(e.target.value)}
          >
            <option value="">— none —</option>
            {colOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="dag-map-field">
          Event action (optional)
          <select
            value={eventTypeCol}
            onChange={(e) => {
              setEventTypeCol(e.target.value);
              setExpandedGlyph(null);
            }}
          >
            <option value="">— none —</option>
            {colOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        {eventTypeCol && actionValues.length > 0 && (
          <>
            <h3 className="dag-map-section-title">Map glyphs → event actions</h3>
            <p className="settings-help dag-map-section-help">
              For each node type, pick which <code>{eventTypeCol}</code> values
              belong to it. Choose “Do not map” to keep that glyph off the
              aChart. Spawn is still derived from process creation when that
              glyph is mapped.
            </p>
            <div className="dag-glyph-map-list">
              <div className="dag-glyph-map-row traj-kind-spawn">
                <span className="dag-glyph-swatch traj-kind-spawn">
                  <span className="dag-glyph-swatch-dot" />
                </span>
                <div className="dag-glyph-map-body">
                  <div className="dag-glyph-map-title">Spawn</div>
                  <div className="dag-glyph-map-note">
                    Derived automatically when Process creation is mapped and a
                    parent link exists
                  </div>
                </div>
              </div>

              {MAPPABLE_GLYPHS.map((id) => {
                const def = TRAJECTORY_GLYPH_DEFS.find((d) => d.id === id);
                const title = def?.title ?? id;
                const row = glyphConfig[id] ?? { mapped: true, actions: [] };
                const open = expandedGlyph === id;
                return (
                  <div
                    key={id}
                    className={`dag-glyph-map-row traj-kind-${id} ${row.mapped ? "" : "dag-glyph-unmapped"}`}
                  >
                    <span className={`dag-glyph-swatch traj-kind-${id}`}>
                      <span className="dag-glyph-swatch-dot" />
                    </span>
                    <div className="dag-glyph-map-body">
                      <div className="dag-glyph-map-title-row">
                        <div className="dag-glyph-map-title">{title}</div>
                        <select
                          className="dag-glyph-map-mode"
                          value={row.mapped ? "map" : "off"}
                          onChange={(e) =>
                            setMapped(id, e.target.value === "map")
                          }
                          aria-label={`${title} mapping mode`}
                        >
                          <option value="map">Map event actions…</option>
                          <option value="off">Do not map this event type</option>
                        </select>
                      </div>
                      {row.mapped ? (
                        <>
                          <button
                            type="button"
                            className="dag-glyph-map-toggle"
                            onClick={() =>
                              setExpandedGlyph(open ? null : id)
                            }
                          >
                            {open ? "Hide" : "Choose"} actions
                            {row.actions.length
                              ? ` (${row.actions.length} selected)`
                              : ""}
                          </button>
                          {open && (
                            <div className="dag-action-checklist">
                              {actionValues.map(({ value, count }) => {
                                const checked = row.actions.includes(value);
                                const claimedBy = MAPPABLE_GLYPHS.find(
                                  (g) =>
                                    g !== id &&
                                    glyphConfig[g]?.mapped &&
                                    glyphConfig[g]?.actions.includes(value),
                                );
                                return (
                                  <label
                                    key={value}
                                    className="dag-action-check"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggleAction(id, value)}
                                    />
                                    <span title={value}>
                                      {value}
                                      <span className="dag-action-map-count">
                                        ×{count}
                                        {claimedBy && !checked
                                          ? ` · in ${TRAJECTORY_GLYPH_DEFS.find((d) => d.id === claimedBy)?.title ?? claimedBy}`
                                          : ""}
                                      </span>
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="dag-glyph-map-note">
                          Not shown on the aChart map
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {!eventTypeCol && (
          <>
            <h3 className="dag-map-section-title">Glyph legend</h3>
            <p className="settings-help dag-map-section-help">
              Pick an event action column above to assign log values to glyphs.
            </p>
            <div className="dag-glyph-map-list">
              {TRAJECTORY_GLYPH_DEFS.filter((g) => g.id !== "other").map((g) => (
                <div key={g.id} className={`dag-glyph-map-row traj-kind-${g.id}`}>
                  <span
                    className={`dag-glyph-swatch traj-kind-${g.id}`}
                    title={g.title}
                  >
                    <span className="dag-glyph-swatch-dot" />
                  </span>
                  <div className="dag-glyph-map-body">
                    <div className="dag-glyph-map-title">{g.title}</div>
                    {g.note ? (
                      <div className="dag-glyph-map-note">{g.note}</div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="side-panel-actions">
          <button
            type="button"
            onClick={() => updateTab(tab.id, { showDagMapping: false })}
          >
            Cancel
          </button>
          <button type="button" className="primary-cta" onClick={apply}>
            Build aChart
          </button>
        </div>
      </div>
    </div>
  );
}
