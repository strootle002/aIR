import { useCallback, useEffect, useMemo, useState } from "react";
import { ExploreGraphShell } from "./ExploreGraphShell";
import { buildMindMap } from "../lib/mindMap";
import {
  exploreChildrenMap,
  filterExploreTree,
  getExploreMaxDepth,
} from "../lib/exploreGraph";
import { applyFilters, sortFilterableRows } from "../lib/filters";
import { useTabsStore } from "../stores/tabsStore";

export function MindMapPanel() {
  const tab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null);
  const updateTab = useTabsStore((s) => s.updateTab);
  const searchOptions = useTabsStore((s) => s.searchOptions);

  const filteredRows = useMemo(() => {
    if (!tab) return [];
    const filtered = applyFilters(
      tab.rows,
      tab.columns,
      tab.columnFilters,
      tab.globalSearch,
      searchOptions,
      tab.taggedLines,
      tab.timeRangeFilter,
      tab.timestampColumn,
      tab.advancedFilter,
    );
    return sortFilterableRows(filtered, tab.columns, tab.sortColumn, tab.sortDir, {
      timestampColumn: tab.timestampColumn,
      assumeUtc: tab.timestampAssumeUtc,
    });
  }, [
    tab?.rows,
    tab?.columns,
    tab?.columnFilters,
    tab?.globalSearch,
    tab?.taggedLines,
    tab?.timeRangeFilter,
    tab?.timestampColumn,
    tab?.advancedFilter,
    tab?.sortColumn,
    tab?.sortDir,
    tab?.timestampAssumeUtc,
    searchOptions,
  ]);

  const fullModel = useMemo(() => {
    if (!tab?.mindMapping) return null;
    return buildMindMap(filteredRows, tab.columns, tab.mindMapping);
  }, [tab?.mindMapping, tab?.columns, filteredRows]);

  const maxDepth = fullModel ? getExploreMaxDepth(fullModel) : 0;
  const childrenMap = useMemo(
    () => (fullModel ? exploreChildrenMap(fullModel) : new Map<string, string[]>()),
    [fullModel],
  );
  const [visibleDepth, setVisibleDepth] = useState(maxDepth);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());

  const mapKey = tab?.mindMapping
    ? `${tab.mindMapping.levelColumns.join("|")}:${tab.mindMapping.rootLabel ?? ""}:${filteredRows.length}`
    : "";
  useEffect(() => {
    setVisibleDepth(maxDepth);
    setCollapsedIds(new Set());
  }, [mapKey, maxDepth]);

  const visibleModel = useMemo(() => {
    if (!fullModel) return null;
    return filterExploreTree(fullModel, visibleDepth, collapsedIds);
  }, [fullModel, visibleDepth, collapsedIds]);

  const onToggleCollapse = useCallback(
    (nodeId: string) => {
      if (!fullModel) return;
      const node = fullModel.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const kids = childrenMap.get(nodeId) ?? [];
      if (kids.length === 0) return;

      setCollapsedIds((prev) => {
        if (prev.has(nodeId)) {
          const next = new Set(prev);
          next.delete(nodeId);
          return next;
        }

        const depthCut = kids.some((k) => {
          const child = fullModel.nodes.find((n) => n.id === k);
          return (child?.depth ?? 0) > visibleDepth;
        });
        if (depthCut) {
          setVisibleDepth((d) =>
            Math.min(maxDepth, Math.max(d, (node.depth ?? 0) + 1)),
          );
          return prev;
        }

        const next = new Set(prev);
        next.add(nodeId);
        return next;
      });
    },
    [fullModel, childrenMap, visibleDepth, maxDepth],
  );

  const onVisibleDepthChange = useCallback(
    (depth: number) => {
      setVisibleDepth(depth);
      setCollapsedIds((prev) => {
        if (!fullModel || prev.size === 0) return prev;
        const next = new Set<string>();
        for (const id of prev) {
          const n = fullModel.nodes.find((x) => x.id === id);
          if (n && (n.depth ?? 0) < depth) next.add(id);
        }
        return next;
      });
    },
    [fullModel],
  );

  if (!tab?.showMind || !tab.mindMapping || !fullModel || !visibleModel) return null;

  return (
    <ExploreGraphShell
      title="aMind"
      subtitle={`${filteredRows.length.toLocaleString()} filtered rows · ${visibleModel.nodes.length}/${fullModel.nodes.length} nodes`}
      model={visibleModel}
      defaultDirection="LR"
      onRemap={() => updateTab(tab.id, { showMindMapping: true })}
      onClose={() => updateTab(tab.id, { showMind: false })}
      onShowInGrid={(line) => {
        useTabsStore.getState().setRowHighlight(tab.id, line, "#2f5d4a");
        updateTab(tab.id, { showMind: false, focusLine: line });
      }}
      treeControls={{
        maxDepth,
        visibleDepth,
        onVisibleDepthChange,
        onExpandAll: () => {
          setVisibleDepth(maxDepth);
          setCollapsedIds(new Set());
        },
        onCollapseAll: () => {
          setVisibleDepth(0);
          setCollapsedIds(new Set());
        },
        onToggleCollapse,
      }}
    />
  );
}
