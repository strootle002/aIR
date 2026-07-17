import {
  FORMAT_PRESET_COLORS,
  LINE_COL,
  TAG_COL,
  newFormatRule,
  type FormatRule,
} from "../lib/types";
import { useTabsStore } from "../stores/tabsStore";

export function ConditionalFormatPanel() {
  const tab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const updateTab = useTabsStore((s) => s.updateTab);

  if (!tab?.showFormatPanel) return null;

  const setRules = (formatRules: FormatRule[]) => {
    updateTab(tab.id, { formatRules });
  };

  const updateRule = (id: string, patch: Partial<FormatRule>) => {
    setRules(tab.formatRules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  return (
    <div
      className="side-panel format-panel"
      role="dialog"
      aria-label="Conditional formatting"
    >
      <div className="side-panel-header">
        <strong>Conditional Formatting</strong>
        <button
          type="button"
          onClick={() => updateTab(tab.id, { showFormatPanel: false })}
        >
          ×
        </button>
      </div>
      <p className="side-panel-help">
        Rules color matching cells or entire rows. Manual highlights always win.
      </p>

      <div className="format-rules">
        {tab.formatRules.length === 0 && (
          <p className="side-panel-help">No rules yet.</p>
        )}
        {tab.formatRules.map((rule) => (
          <div key={rule.id} className="format-rule">
            <div className="format-rule-row">
              <select
                value={rule.column}
                onChange={(e) => updateRule(rule.id, { column: e.target.value })}
              >
                <option value="*">Any column</option>
                <option value={LINE_COL}>Line</option>
                <option value={TAG_COL}>Tag</option>
                {tab.columns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select
                value={rule.op}
                onChange={(e) =>
                  updateRule(rule.id, {
                    op: e.target.value as FormatRule["op"],
                  })
                }
              >
                <option value="contains">Contains</option>
                <option value="equals">Equals</option>
                <option value="beginsWith">Begins with</option>
              </select>
              <input
                type="text"
                value={rule.value}
                placeholder="Value"
                onChange={(e) => updateRule(rule.id, { value: e.target.value })}
              />
            </div>
            <div className="format-rule-row">
              <label>
                <input
                  type="checkbox"
                  checked={rule.applyTo === "row"}
                  onChange={(e) =>
                    updateRule(rule.id, {
                      applyTo: e.target.checked ? "row" : "cell",
                    })
                  }
                />
                Entire row
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={Boolean(rule.bold)}
                  onChange={(e) => updateRule(rule.id, { bold: e.target.checked })}
                />
                Bold
              </label>
              <div className="format-swatches">
                {FORMAT_PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={`format-swatch ${rule.background === c ? "active" : ""}`}
                    style={{ background: c }}
                    title={c}
                    onClick={() => updateRule(rule.id, { background: c })}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  setRules(tab.formatRules.filter((r) => r.id !== rule.id))
                }
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="side-panel-actions">
        <button
          type="button"
          onClick={() => setRules([...tab.formatRules, newFormatRule()])}
        >
          Add rule
        </button>
        <button
          type="button"
          className="primary-cta"
          onClick={() => updateTab(tab.id, { showFormatPanel: false })}
        >
          Done
        </button>
      </div>
    </div>
  );
}
