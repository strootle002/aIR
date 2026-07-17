import { useEffect, useMemo, useState } from "react";
import type { MindMapping } from "../lib/types";
import { suggestMindMapping } from "../lib/mindMap";
import { useTabsStore } from "../stores/tabsStore";

export function MindMappingDialog() {
  const tab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const updateTab = useTabsStore((s) => s.updateTab);

  const suggested = useMemo(
    () => (tab ? suggestMindMapping(tab.columns) : { levelColumns: [] }),
    [tab?.columns],
  );

  const [levels, setLevels] = useState<string[]>([]);
  const [rootLabel, setRootLabel] = useState("aMind");
  const [pickCol, setPickCol] = useState("");

  useEffect(() => {
    if (!tab?.showMindMapping) return;
    const saved = tab.mindMapping;
    setLevels(
      saved?.levelColumns?.length
        ? saved.levelColumns.filter((c) => tab.columns.includes(c))
        : (suggested.levelColumns ?? []),
    );
    setRootLabel(saved?.rootLabel ?? suggested.rootLabel ?? "aMind");
    setPickCol("");
  }, [tab?.showMindMapping, tab?.id, tab?.mindMapping, tab?.columns, suggested]);

  if (!tab?.showMindMapping) return null;

  const available = tab.columns.filter((c) => !levels.includes(c));

  const addLevel = () => {
    if (!pickCol || levels.includes(pickCol)) return;
    setLevels((prev) => [...prev, pickCol]);
    setPickCol("");
  };

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...levels];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setLevels(next);
  };

  const apply = () => {
    if (levels.length === 0) return;
    const mapping: MindMapping = {
      levelColumns: levels,
      rootLabel: rootLabel.trim() || "aMind",
    };
    updateTab(tab.id, {
      mindMapping: mapping,
      showMind: true,
      showMindMapping: false,
    });
  };

  return (
    <div
      className="settings-overlay explore-mapping-overlay"
      role="presentation"
      onClick={() => updateTab(tab.id, { showMindMapping: false })}
    >
      <div
        className="settings-panel explore-mapping-panel"
        role="dialog"
        aria-label="Convert to aMind"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2>Convert to aMind</h2>
          <button
            type="button"
            onClick={() => updateTab(tab.id, { showMindMapping: false })}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <p className="settings-help">
          Pick an ordered list of columns. Distinct value paths become a mindmap
          tree; node badges show how many <strong>currently filtered</strong>{" "}
          rows contribute.
        </p>

        <div className="settings-section">
          <h3>Root label</h3>
          <input
            type="text"
            value={rootLabel}
            onChange={(e) => setRootLabel(e.target.value)}
            placeholder="aMind"
          />
        </div>

        <div className="settings-section">
          <h3>Level columns (root → leaves)</h3>
          <ol className="explore-level-list">
            {levels.map((col, idx) => (
              <li key={`${col}-${idx}`}>
                <span>
                  L{idx + 1}: {col}
                </span>
                <span className="explore-level-actions">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => move(idx, -1)}
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={idx === levels.length - 1}
                    onClick={() => move(idx, 1)}
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="filter-remove-btn"
                    onClick={() =>
                      setLevels((prev) => prev.filter((_, i) => i !== idx))
                    }
                    title="Remove"
                  >
                    −
                  </button>
                </span>
              </li>
            ))}
          </ol>
          <div className="explore-level-add">
            <select
              value={pickCol}
              onChange={(e) => setPickCol(e.target.value)}
            >
              <option value="">Add column…</option>
              {available.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button type="button" disabled={!pickCol} onClick={addLevel}>
              Add level
            </button>
          </div>
        </div>

        <div className="side-panel-actions">
          <button
            type="button"
            onClick={() => updateTab(tab.id, { showMindMapping: false })}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary-cta"
            disabled={levels.length === 0}
            onClick={apply}
          >
            Build aMind
          </button>
        </div>
      </div>
    </div>
  );
}
