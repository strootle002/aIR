import type { FilterNode, FilterOp } from "../lib/types";
import { LINE_COL, TAG_COL, emptyFilterGroup } from "../lib/types";
import { useTabsStore } from "../stores/tabsStore";

const OPS: { value: FilterOp; label: string }[] = [
  { value: "contains", label: "Contains" },
  { value: "notContains", label: "Does not contain" },
  { value: "equals", label: "Equals" },
  { value: "notEquals", label: "Does not equal" },
  { value: "beginsWith", label: "Begins with" },
  { value: "isEmpty", label: "Is empty" },
  { value: "isNotEmpty", label: "Is not empty" },
];

function cloneNode(node: FilterNode): FilterNode {
  return JSON.parse(JSON.stringify(node)) as FilterNode;
}

function FilterNodeEditor({
  node,
  columns,
  onChange,
  onRemove,
  depth,
}: {
  node: FilterNode;
  columns: string[];
  onChange: (n: FilterNode) => void;
  onRemove?: () => void;
  depth: number;
}) {
  if (node.kind === "rule") {
    const needsValue = node.op !== "isEmpty" && node.op !== "isNotEmpty";
    return (
      <div className="filter-rule" style={{ marginLeft: depth * 12 }}>
        <select
          value={node.column}
          onChange={(e) => onChange({ ...node, column: e.target.value })}
        >
          <option value={LINE_COL}>Line</option>
          <option value={TAG_COL}>Tag</option>
          {columns.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={node.op}
          onChange={(e) =>
            onChange({ ...node, op: e.target.value as FilterOp })
          }
        >
          {OPS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {needsValue && (
          <input
            type="text"
            value={node.value}
            placeholder="Value"
            onChange={(e) => onChange({ ...node, value: e.target.value })}
          />
        )}
        {onRemove && (
          <button
            type="button"
            className="filter-remove-btn"
            onClick={onRemove}
            title="Remove this rule"
            aria-label="Remove rule"
          >
            −
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="filter-group" style={{ marginLeft: depth * 12 }}>
      <div className="filter-group-bar">
        <label>
          Join
          <select
            value={node.join}
            onChange={(e) =>
              onChange({
                ...node,
                join: e.target.value as "and" | "or",
              })
            }
          >
            <option value="and">AND</option>
            <option value="or">OR</option>
          </select>
        </label>
        <label className="filter-not">
          <input
            type="checkbox"
            checked={Boolean(node.not)}
            onChange={(e) => onChange({ ...node, not: e.target.checked })}
          />
          NOT
        </label>
        <button
          type="button"
          onClick={() =>
            onChange({
              ...node,
              children: [
                ...node.children,
                {
                  kind: "rule",
                  column: columns[0] ?? LINE_COL,
                  op: "contains",
                  value: "",
                },
              ],
            })
          }
        >
          + Rule
        </button>
        <button
          type="button"
          onClick={() =>
            onChange({
              ...node,
              children: [...node.children, emptyFilterGroup()],
            })
          }
        >
          + Group
        </button>
        {onRemove && (
          <button
            type="button"
            className="filter-remove-btn"
            onClick={onRemove}
            title="Remove this group"
            aria-label="Remove group"
          >
            −
          </button>
        )}
      </div>
      {node.children.map((child, i) => (
        <FilterNodeEditor
          key={i}
          node={child}
          columns={columns}
          depth={depth + 1}
          onChange={(next) => {
            const children = [...node.children];
            children[i] = next;
            onChange({ ...node, children });
          }}
          onRemove={() => {
            const children = node.children.filter((_, j) => j !== i);
            onChange({ ...node, children });
          }}
        />
      ))}
    </div>
  );
}

export function FilterEditor() {
  const tab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const updateTab = useTabsStore((s) => s.updateTab);

  if (!tab?.showFilterEditor) return null;

  const draft = tab.advancedFilter
    ? cloneNode(tab.advancedFilter)
    : emptyFilterGroup();

  const setDraft = (node: FilterNode) => {
    updateTab(tab.id, { advancedFilter: node });
  };

  return (
    <div className="side-panel filter-editor" role="dialog" aria-label="Filter editor">
      <div className="side-panel-header">
        <strong>Filter Editor</strong>
        <button
          type="button"
          onClick={() => updateTab(tab.id, { showFilterEditor: false })}
        >
          ×
        </button>
      </div>
      <p className="side-panel-help">
        Build AND / OR / NOT conditions. Use − to remove a rule or nested group.
        Applied together with column filters and search.
      </p>
      <FilterNodeEditor
        node={draft}
        columns={tab.columns}
        depth={0}
        onChange={setDraft}
      />
      {draft.kind === "group" && draft.children.length === 0 && (
        <p className="filter-editor-empty">No rules yet — click + Rule to add one.</p>
      )}
      <div className="side-panel-actions">
        <button
          type="button"
          onClick={() => updateTab(tab.id, { advancedFilter: null })}
        >
          Clear advanced filter
        </button>
        <button
          type="button"
          className="primary-cta"
          onClick={() => updateTab(tab.id, { showFilterEditor: false })}
        >
          Done
        </button>
      </div>
    </div>
  );
}
