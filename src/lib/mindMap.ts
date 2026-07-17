import type { FilterableRow } from "./filters";
import { isBlankField, type MindMapping } from "./types";
import {
  EXPLORE_NODE_CAP,
  pushSampleLine,
  stableNodeId,
  type ExploreEdge,
  type ExploreGraphModel,
  type ExploreNode,
} from "./exploreGraph";

const SKIP_SUGGEST = /^(line|tag|tags|notes|id|uuid|guid|hash|md5|sha1|sha256|_time|@timestamp)$/i;
const TIMESTAMPISH = /time|date|timestamp|@timestamp|_time/i;

export function suggestMindMapping(columns: string[]): Partial<MindMapping> {
  const candidates = columns.filter(
    (c) => !SKIP_SUGGEST.test(c) && !TIMESTAMPISH.test(c),
  );
  const levels = candidates.slice(0, 3);
  return {
    levelColumns: levels,
    rootLabel: "aMind",
  };
}

export function buildMindMap(
  rows: FilterableRow[],
  columns: string[],
  mapping: MindMapping,
): ExploreGraphModel {
  const levels = mapping.levelColumns.filter((c) => columns.includes(c));
  if (levels.length === 0) {
    return { nodes: [], edges: [], warning: "Select at least one level column." };
  }

  const idxs = levels.map((c) => columns.indexOf(c));
  const rootLabel = (mapping.rootLabel || "aMind").trim() || "aMind";
  const rootId = "mind_root";

  const nodeMap = new Map<string, ExploreNode>();
  const edgeMap = new Map<string, ExploreEdge>();

  nodeMap.set(rootId, {
    id: rootId,
    label: rootLabel,
    count: 0,
    sampleLines: [],
    depth: 0,
  });

  const ensureNode = (
    id: string,
    label: string,
    depth: number,
    column: string | undefined,
    line: number,
  ) => {
    let n = nodeMap.get(id);
    if (!n) {
      n = {
        id,
        label,
        count: 0,
        sampleLines: [],
        depth,
        column,
      };
      nodeMap.set(id, n);
    }
    n.count += 1;
    pushSampleLine(n.sampleLines, line);
  };

  const ensureEdge = (source: string, target: string, line: number) => {
    const id = `e:${source}->${target}`;
    let e = edgeMap.get(id);
    if (!e) {
      e = { id, source, target, count: 0, sampleLines: [] };
      edgeMap.set(id, e);
    }
    e.count += 1;
    pushSampleLine(e.sampleLines, line);
  };

  let capped = false;

  for (const row of rows) {
    if (nodeMap.size >= EXPLORE_NODE_CAP) {
      capped = true;
      break;
    }

    ensureNode(rootId, rootLabel, 0, undefined, row.line);

    let parentId = rootId;
    const pathParts: string[] = [];

    for (let i = 0; i < idxs.length; i++) {
      const col = levels[i];
      const raw = row.cells[idxs[i]] ?? "";
      if (isBlankField(raw)) continue; // skip blank level, continue path

      const value = String(raw).trim();
      pathParts.push(`${col}=${value}`);
      const id = stableNodeId("mind", ...pathParts);

      if (!nodeMap.has(id) && nodeMap.size >= EXPLORE_NODE_CAP) {
        capped = true;
        break;
      }

      ensureNode(id, value, i + 1, col, row.line);
      ensureEdge(parentId, id, row.line);
      parentId = id;
    }
  }

  // If no data rows, drop empty root count quirk
  if (rows.length === 0) {
    return { nodes: [], edges: [], warning: "No filtered rows to map." };
  }

  const warningParts: string[] = [];
  if (capped) {
    warningParts.push(
      `Node cap reached (${EXPLORE_NODE_CAP}). Narrow filters or use fewer levels.`,
    );
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(edgeMap.values()),
    warning: warningParts.length ? warningParts.join(" ") : undefined,
  };
}
