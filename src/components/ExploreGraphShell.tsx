import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  useStoreApi,
  getNodesBounds,
  getViewportForBounds,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  layoutExploreGraph,
  type ExploreGraphModel,
  type ExploreLayoutDir,
} from "../lib/exploreGraph";
import {
  captureElementPng,
  defaultExportBasename,
  promptSavePath,
  savePngOrPdf,
  waitFrames,
  type GraphExportChoice,
} from "../lib/graphExport";
import { GraphExportMenu } from "./GraphExportMenu";

export type ExploreNodeData = {
  label: string;
  count: number;
  sampleLines: number[];
  column?: string;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  [key: string]: unknown;
};

function ExploreNodeView({ data, selected, id }: NodeProps) {
  const d = data as ExploreNodeData;
  const onToggle = d.onToggleCollapse as ((nodeId: string) => void) | undefined;
  return (
    <div
      className={`explore-node ${selected ? "is-selected" : ""} ${
        d.depth === 0 ? "is-root" : ""
      } ${d.collapsed && d.hasChildren ? "is-collapsed" : ""}`}
    >
      <Handle type="target" position={Position.Top} className="explore-handle" />
      <Handle type="target" position={Position.Left} className="explore-handle" />
      {d.hasChildren ? (
        <button
          type="button"
          className="explore-node-toggle"
          title={d.collapsed ? "Expand branch" : "Collapse branch"}
          aria-label={d.collapsed ? "Expand branch" : "Collapse branch"}
          onClick={(e) => {
            e.stopPropagation();
            onToggle?.(id);
          }}
        >
          {d.collapsed ? "▶" : "▼"}
        </button>
      ) : (
        <span className="explore-node-toggle-spacer" />
      )}
      <div className="explore-node-label" title={d.label}>
        {d.label}
      </div>
      <span className="explore-node-count">{d.count}</span>
      <Handle type="source" position={Position.Bottom} className="explore-handle" />
      <Handle type="source" position={Position.Right} className="explore-handle" />
    </div>
  );
}

const nodeTypes = { explore: memo(ExploreNodeView) };

export type ExploreSelection =
  | { kind: "node"; id: string; data: ExploreNodeData }
  | {
      kind: "edge";
      id: string;
      label?: string;
      count: number;
      sampleLines: number[];
      source: string;
      target: string;
    }
  | null;

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2;
const PAN_SPEED = 0.85;

/**
 * Custom wheel nav: scroll = vertical pan, Shift+scroll = horizontal pan,
 * Ctrl/⌘+scroll = zoom. Replaces React Flow panOnScroll, which zeroes out
 * Shift+scroll on Linux when the browser already maps it to deltaX.
 */
function ExploreWheelNavigation() {
  const { getViewport, setViewport } = useReactFlow();
  const store = useStoreApi();

  useEffect(() => {
    let attached: HTMLElement | null = null;

    const onWheel = (event: WheelEvent) => {
      if ((event.target as Element | null)?.closest?.(".nowheel")) return;

      event.preventDefault();
      event.stopPropagation();

      const el = attached;
      if (!el) return;

      const normalize = event.deltaMode === 1 ? 20 : 1;
      const vp = getViewport();

      if (event.ctrlKey || event.metaKey) {
        const rect = el.getBoundingClientRect();
        const cx = event.clientX - rect.left;
        const cy = event.clientY - rect.top;
        const xs = (cx - vp.x) / vp.zoom;
        const ys = (cy - vp.y) / vp.zoom;
        const nextZoom = Math.min(
          MAX_ZOOM,
          Math.max(
            MIN_ZOOM,
            vp.zoom * Math.pow(2, (-event.deltaY * normalize) / 100),
          ),
        );
        setViewport({
          x: cx - xs * nextZoom,
          y: cy - ys * nextZoom,
          zoom: nextZoom,
        });
        return;
      }

      let deltaX: number;
      let deltaY: number;
      if (event.shiftKey) {
        // Browsers disagree: some put the delta on X, others keep Y.
        deltaX = (event.deltaX || event.deltaY) * normalize;
        deltaY = 0;
      } else {
        deltaX = event.deltaX * normalize;
        deltaY = event.deltaY * normalize;
      }

      setViewport({
        x: vp.x - (deltaX / vp.zoom) * PAN_SPEED,
        y: vp.y - (deltaY / vp.zoom) * PAN_SPEED,
        zoom: vp.zoom,
      });
    };

    const detach = () => {
      if (!attached) return;
      attached.removeEventListener("wheel", onWheel, { capture: true });
      attached = null;
    };

    const tryAttach = () => {
      const el = store.getState().domNode;
      if (!el || el === attached) return;
      detach();
      attached = el;
      el.addEventListener("wheel", onWheel, { passive: false, capture: true });
    };

    tryAttach();
    const unsub = store.subscribe(() => tryAttach());

    return () => {
      unsub();
      detach();
    };
  }, [getViewport, setViewport, store]);

  return null;
}

function excludeFlowChrome(node: HTMLElement): boolean {
  if (!(node instanceof HTMLElement)) return true;
  const cls = node.classList;
  if (!cls) return true;
  return !(
    cls.contains("react-flow__minimap") ||
    cls.contains("react-flow__controls") ||
    cls.contains("react-flow__panel") ||
    cls.contains("react-flow__attribution")
  );
}

/** html-to-image often drops stylesheet strokes on SVG edges — bake them in. */
function inlineExploreEdgeStrokes(root: HTMLElement): () => void {
  const restored: { el: Element; stroke: string | null; width: string | null; fill: string | null }[] =
    [];
  root.querySelectorAll(".react-flow__edge-path, .react-flow__connection-path").forEach((el) => {
    restored.push({
      el,
      stroke: el.getAttribute("stroke"),
      width: el.getAttribute("stroke-width"),
      fill: el.getAttribute("fill"),
    });
    el.setAttribute("stroke", "#8b95a5");
    el.setAttribute("stroke-width", "1.75");
    el.setAttribute("fill", "none");
  });
  root.querySelectorAll(".react-flow__edge marker path, marker path").forEach((el) => {
    restored.push({
      el,
      stroke: el.getAttribute("stroke"),
      width: el.getAttribute("stroke-width"),
      fill: el.getAttribute("fill"),
    });
    el.setAttribute("fill", "#8b95a5");
    el.setAttribute("stroke", "#8b95a5");
  });
  return () => {
    for (const r of restored) {
      if (r.stroke == null) r.el.removeAttribute("stroke");
      else r.el.setAttribute("stroke", r.stroke);
      if (r.width == null) r.el.removeAttribute("stroke-width");
      else r.el.setAttribute("stroke-width", r.width);
      if (r.fill == null) r.el.removeAttribute("fill");
      else r.el.setAttribute("fill", r.fill);
    }
  };
}

function ExploreExportButton({ graphName }: { graphName: string }) {
  const [busy, setBusy] = useState(false);
  const store = useStoreApi();
  const { getNodes } = useReactFlow();

  const onExport = useCallback(
    async (choice: GraphExportChoice) => {
      setBusy(true);
      let restoreEdges: (() => void) | null = null;
      try {
        const flow = store.getState().domNode;
        if (!flow) throw new Error("Graph view is not ready yet.");
        const viewport = flow.querySelector(
          ".react-flow__viewport",
        ) as HTMLElement | null;
        if (!viewport) throw new Error("Could not find graph viewport.");

        const base = defaultExportBasename(graphName.replace(/\s+/g, "-"));
        const path = await promptSavePath(
          `${base}-${choice.scope}.${choice.format}`,
          choice.format,
        );
        if (!path) return;

        restoreEdges = inlineExploreEdgeStrokes(flow);
        await waitFrames(1);

        let png: string;
        if (choice.scope === "view") {
          png = await captureElementPng(flow, {
            filter: excludeFlowChrome,
          });
        } else {
          const nodes = getNodes().filter((n) => !n.hidden);
          if (nodes.length === 0) throw new Error("No nodes to export.");
          const bounds = getNodesBounds(nodes);
          const imageW = 1920;
          const imageH = Math.min(
            8192,
            Math.max(
              720,
              Math.ceil(
                (bounds.height * imageW) / Math.max(bounds.width, 1) + 100,
              ),
            ),
          );
          const vp = getViewportForBounds(
            bounds,
            imageW,
            imageH,
            MIN_ZOOM,
            MAX_ZOOM,
            0.12,
          );
          png = await captureElementPng(viewport, {
            width: imageW,
            height: imageH,
            style: {
              width: `${imageW}px`,
              height: `${imageH}px`,
              transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
            },
            filter: excludeFlowChrome,
          });
        }

        await savePngOrPdf(path, png, choice.format);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        window.alert(`Export failed: ${msg}`);
      } finally {
        restoreEdges?.();
        setBusy(false);
      }
    },
    [getNodes, graphName, store],
  );

  return <GraphExportMenu busy={busy} onExport={onExport} />;
}

export function ExploreGraphCanvas({
  model,
  direction,
  search,
  onSelect,
  onToggleCollapse,
}: {
  model: ExploreGraphModel;
  direction: ExploreLayoutDir;
  search: string;
  onSelect: (sel: ExploreSelection) => void;
  onToggleCollapse?: (nodeId: string) => void;
}) {
  const laidOut = useMemo(
    () => layoutExploreGraph(model, direction),
    [model, direction],
  );

  const q = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    const nodes: Node[] = laidOut.nodes.map((n) => {
      const data = n.data as ExploreNodeData;
      const label = String(data.label ?? "");
      const hidden = q ? !label.toLowerCase().includes(q) : false;
      return {
        ...n,
        hidden,
        data: {
          ...data,
          onToggleCollapse,
        },
      };
    });
    const visible = new Set(nodes.filter((n) => !n.hidden).map((n) => n.id));
    const edges: Edge[] = laidOut.edges.map((e) => ({
      ...e,
      hidden: q ? !(visible.has(e.source) && visible.has(e.target)) : false,
    }));
    return { nodes, edges };
  }, [laidOut, q, onToggleCollapse]);

  const [nodes, setNodes] = useState<Node[]>(filtered.nodes);
  const [edges, setEdges] = useState<Edge[]>(filtered.edges);

  useEffect(() => {
    setNodes(filtered.nodes);
    setEdges(filtered.edges);
  }, [filtered]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((ns) => applyNodeChanges(changes, ns)),
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((es) => applyEdgeChanges(changes, es)),
    [],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onSelect({
        kind: "node",
        id: node.id,
        data: node.data as ExploreNodeData,
      });
    },
    [onSelect],
  );

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      const data = (edge.data ?? {}) as {
        count?: number;
        sampleLines?: number[];
        label?: string;
      };
      onSelect({
        kind: "edge",
        id: edge.id,
        label: data.label ?? (typeof edge.label === "string" ? edge.label : undefined),
        count: data.count ?? 1,
        sampleLines: data.sampleLines ?? [],
        source: edge.source,
        target: edge.target,
      });
    },
    [onSelect],
  );

  return (
    <ReactFlow
      key={`${direction}-${model.nodes.length}-${model.edges.length}`}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onEdgeClick={onEdgeClick}
      onPaneClick={() => onSelect(null)}
      fitView
      nodesConnectable={false}
      nodesDraggable
      panOnScroll={false}
      zoomOnScroll={false}
      zoomOnPinch={false}
      preventScrolling
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      defaultEdgeOptions={{
        style: { stroke: "#8b95a5", strokeWidth: 1.75 },
      }}
      proOptions={{ hideAttribution: true }}
    >
      <ExploreWheelNavigation />
      <Background gap={16} size={1} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable />
    </ReactFlow>
  );
}

export function ExploreGraphShell({
  title,
  subtitle,
  model,
  onRemap,
  onClose,
  onShowInGrid,
  defaultDirection = "TB",
  treeControls,
}: {
  title: string;
  subtitle?: string;
  model: ExploreGraphModel;
  onRemap: () => void;
  onClose: () => void;
  onShowInGrid: (line: number) => void;
  defaultDirection?: ExploreLayoutDir;
  /** aMind: level expand/collapse + per-node branch toggle */
  treeControls?: {
    maxDepth: number;
    visibleDepth: number;
    onVisibleDepthChange: (depth: number) => void;
    onExpandAll: () => void;
    onCollapseAll: () => void;
    onToggleCollapse: (nodeId: string) => void;
  };
}) {
  const [direction, setDirection] = useState<ExploreLayoutDir>(defaultDirection);
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<ExploreSelection>(null);

  const sampleLines =
    selection?.kind === "node"
      ? selection.data.sampleLines
      : selection?.kind === "edge"
        ? selection.sampleLines
        : [];

  return (
    <div className="explore-popout-overlay" role="dialog" aria-label={title}>
      <ReactFlowProvider>
        <div className="explore-popout">
          <div className="explore-toolbar">
            <div className="explore-toolbar-title">
              <strong>{title}</strong>
              {subtitle ? (
                <span className="explore-toolbar-sub">
                  {subtitle}
                  {" · "}
                  Scroll to pan · Shift+scroll horizontal · Ctrl/⌘+scroll zoom
                </span>
              ) : null}
            </div>
            <div className="explore-search-wrap">
              <input
                type="search"
                placeholder="Search nodes…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search nodes"
              />
            </div>
            {treeControls ? (
              <div className="explore-tree-controls" role="group" aria-label="Tree levels">
                <button
                  type="button"
                  title="Collapse all levels"
                  onClick={treeControls.onCollapseAll}
                >
                  Collapse all
                </button>
                <button
                  type="button"
                  title="Hide one level"
                  disabled={treeControls.visibleDepth <= 0}
                  onClick={() =>
                    treeControls.onVisibleDepthChange(
                      Math.max(0, treeControls.visibleDepth - 1),
                    )
                  }
                >
                  − Level
                </button>
                <span className="explore-tree-depth">
                  Depth {treeControls.visibleDepth}/{treeControls.maxDepth}
                </span>
                <button
                  type="button"
                  title="Show one more level"
                  disabled={
                    treeControls.visibleDepth >= treeControls.maxDepth
                  }
                  onClick={() =>
                    treeControls.onVisibleDepthChange(
                      Math.min(
                        treeControls.maxDepth,
                        treeControls.visibleDepth + 1,
                      ),
                    )
                  }
                >
                  + Level
                </button>
                <button
                  type="button"
                  title="Expand all levels"
                  onClick={treeControls.onExpandAll}
                >
                  Expand all
                </button>
              </div>
            ) : null}
            <label className="explore-dir-toggle">
              Layout
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value as ExploreLayoutDir)}
              >
                <option value="TB">Top → bottom</option>
                <option value="LR">Left → right</option>
              </select>
            </label>
            <ExploreExportButton graphName={title} />
            <button type="button" onClick={onRemap}>
              Remap columns…
            </button>
            <button type="button" onClick={onClose} aria-label="Close">
              Close
            </button>
          </div>

          {model.warning ? (
            <p className="explore-warning" role="status">
              {model.warning}
            </p>
          ) : null}

          <div
            className={`explore-body ${selection ? "with-inspector" : ""}`}
          >
            <div className="explore-canvas">
              <ExploreGraphCanvas
                model={model}
                direction={direction}
                search={search}
                onSelect={setSelection}
                onToggleCollapse={treeControls?.onToggleCollapse}
              />
            </div>

            {selection ? (
              <aside className="explore-inspector">
                <div className="explore-inspector-head">
                  <h3>
                    {selection.kind === "node" ? "Node" : "Edge"}
                  </h3>
                  <button type="button" onClick={() => setSelection(null)}>
                    ×
                  </button>
                </div>
                {selection.kind === "node" ? (
                  <>
                    <p className="explore-inspector-title">{selection.data.label}</p>
                    <p className="explore-inspector-meta">
                      Count: {selection.data.count}
                      {selection.data.column
                        ? ` · Column: ${selection.data.column}`
                        : ""}
                      {selection.data.hasChildren
                        ? selection.data.collapsed
                          ? " · collapsed"
                          : " · expanded"
                        : ""}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="explore-inspector-title">
                      {selection.label || "Edge"}
                    </p>
                    <p className="explore-inspector-meta">
                      {selection.source} → {selection.target} · Count:{" "}
                      {selection.count}
                    </p>
                  </>
                )}
                {sampleLines.length > 0 ? (
                  <div className="explore-inspector-lines">
                    <h4>Sample lines</h4>
                    <ul>
                      {sampleLines.map((line) => (
                        <li key={line}>
                          <button
                            type="button"
                            onClick={() => onShowInGrid(line)}
                          >
                            Line {line}
                          </button>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      className="primary-cta"
                      onClick={() => onShowInGrid(sampleLines[0])}
                    >
                      Show in grid
                    </button>
                  </div>
                ) : null}
              </aside>
            ) : null}
          </div>
        </div>
      </ReactFlowProvider>
    </div>
  );
}
