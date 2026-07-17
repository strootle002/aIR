import dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import { Position } from "@xyflow/react";

export const EXPLORE_NODE_CAP = 2000;

export type ExploreLayoutDir = "TB" | "LR";

export interface ExploreNode {
  id: string;
  label: string;
  count: number;
  /** Sample CSV line numbers that contributed to this node */
  sampleLines: number[];
  depth?: number;
  /** Column this value came from (aMind levels) */
  column?: string;
}

export interface ExploreEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  count: number;
  sampleLines: number[];
}

export interface ExploreGraphModel {
  nodes: ExploreNode[];
  edges: ExploreEdge[];
  warning?: string;
}

export function getExploreMaxDepth(model: ExploreGraphModel): number {
  let max = 0;
  for (const n of model.nodes) {
    if ((n.depth ?? 0) > max) max = n.depth ?? 0;
  }
  return max;
}

export function exploreChildrenMap(
  model: ExploreGraphModel,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const e of model.edges) {
    let list = map.get(e.source);
    if (!list) {
      list = [];
      map.set(e.source, list);
    }
    list.push(e.target);
  }
  return map;
}

/**
 * Hide nodes deeper than maxVisibleDepth, and descendants of collapsedIds.
 * Annotates surviving nodes with child counts for expand/collapse UI.
 */
export function filterExploreTree(
  model: ExploreGraphModel,
  maxVisibleDepth: number,
  collapsedIds: ReadonlySet<string>,
): ExploreGraphModel & {
  nodes: (ExploreNode & { hasChildren: boolean; collapsed: boolean })[];
} {
  const children = exploreChildrenMap(model);
  const depthById = new Map(model.nodes.map((n) => [n.id, n.depth ?? 0]));

  const hidden = new Set<string>();
  const hideDescendants = (id: string) => {
    for (const child of children.get(id) ?? []) {
      if (hidden.has(child)) continue;
      hidden.add(child);
      hideDescendants(child);
    }
  };

  for (const id of collapsedIds) {
    hideDescendants(id);
  }

  for (const n of model.nodes) {
    if ((n.depth ?? 0) > maxVisibleDepth) hidden.add(n.id);
  }

  const nodes = model.nodes
    .filter((n) => !hidden.has(n.id))
    .map((n) => {
      const kids = children.get(n.id) ?? [];
      const hasChildren = kids.length > 0;
      const depthCut =
        hasChildren &&
        kids.some((k) => (depthById.get(k) ?? 0) > maxVisibleDepth);
      const collapsed = collapsedIds.has(n.id) || depthCut;
      return { ...n, hasChildren, collapsed };
    });

  const visible = new Set(nodes.map((n) => n.id));
  const edges = model.edges.filter(
    (e) => visible.has(e.source) && visible.has(e.target),
  );

  return { ...model, nodes, edges };
}

const DEFAULT_NODE_W = 168;
const DEFAULT_NODE_H = 44;
const MAX_LABEL_LINES = 3;
const MIN_NODE_W = 148;
const MAX_NODE_W = 300;
const LABEL_CHAR_W = 6.6;
const LABEL_LINE_H = 15;
const NODE_PAD_Y = 16;

function estimateNodeSize(
  label: string,
  count: number,
  hasChildren: boolean,
): { width: number; height: number } {
  const countChrome = Math.max(28, 14 + String(count).length * 7);
  const toggleChrome = hasChildren ? 28 : 22;
  const sideChrome = 16 + toggleChrome + 6 + countChrome;

  // Slightly wider than before so wrapped text stays readable beside the toggle
  const singleLine = sideChrome + Math.max(48, label.length * LABEL_CHAR_W);
  const width = Math.min(MAX_NODE_W, Math.max(MIN_NODE_W, singleLine));

  const textCol = Math.max(40, width - sideChrome);
  const charsPerLine = Math.max(8, Math.floor(textCol / LABEL_CHAR_W));
  const lines = Math.min(
    MAX_LABEL_LINES,
    Math.max(1, Math.ceil(Math.max(1, label.length) / charsPerLine)),
  );
  const height = Math.max(DEFAULT_NODE_H, NODE_PAD_Y + lines * LABEL_LINE_H);

  return { width, height };
}

/** Layout ExploreGraph into React Flow nodes/edges with dagre. */
export function layoutExploreGraph(
  model: ExploreGraphModel,
  direction: ExploreLayoutDir = "TB",
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 40,
    ranksep: 56,
    marginx: 24,
    marginy: 24,
  });

  const childSources = new Set(model.edges.map((e) => e.source));

  for (const n of model.nodes) {
    const hasChildren =
      Boolean((n as ExploreNode & { hasChildren?: boolean }).hasChildren) ||
      childSources.has(n.id);
    const { width, height } = estimateNodeSize(n.label, n.count, hasChildren);
    g.setNode(n.id, { width, height });
  }
  for (const e of model.edges) {
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  const isHorizontal = direction === "LR";
  const nodes: Node[] = model.nodes.map((n) => {
    const pos = g.node(n.id);
    const w = pos.width ?? DEFAULT_NODE_W;
    const h = pos.height ?? DEFAULT_NODE_H;
    return {
      id: n.id,
      type: "explore",
      position: { x: (pos.x ?? 0) - w / 2, y: (pos.y ?? 0) - h / 2 },
      data: {
        label: n.label,
        count: n.count,
        sampleLines: n.sampleLines,
        column: n.column,
        depth: n.depth,
        hasChildren: Boolean(
          (n as ExploreNode & { hasChildren?: boolean }).hasChildren,
        ),
        collapsed: Boolean(
          (n as ExploreNode & { collapsed?: boolean }).collapsed,
        ),
      },
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      style: { width: w, height: h },
    };
  });

  const edges: Edge[] = model.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label ?? (e.count > 1 ? String(e.count) : undefined),
    style: {
      stroke: "#8b95a5",
      strokeWidth: 1.75,
    },
    labelStyle: {
      fill: "#9aa3b0",
      fontSize: 10,
    },
    labelBgStyle: {
      fill: "#1a1d21",
      fillOpacity: 0.85,
    },
    data: {
      count: e.count,
      sampleLines: e.sampleLines,
      label: e.label,
    },
    animated: false,
  }));

  return { nodes, edges };
}

export function pushSampleLine(lines: number[], line: number, cap = 12): void {
  if (lines.includes(line)) return;
  if (lines.length < cap) lines.push(line);
}

export function stableNodeId(prefix: string, ...parts: string[]): string {
  const raw = parts.map((p) => p.replace(/\0/g, "")).join("\0");
  // Short hash-ish id safe for React Flow
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
  }
  return `${prefix}_${(h >>> 0).toString(36)}_${parts.length}`;
}
