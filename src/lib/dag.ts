import type { DagMapping, TrajectoryGlyphId } from "./types";
import { isBlankField } from "./types";
import type { FilterableRow } from "./filters";
import { parseTimestamp } from "./timestamp";

export type TrajectoryEventKind =
  | "process"
  | "file"
  | "network"
  | "exit"
  | "other";

export interface TrajectoryEvent {
  id: string;
  line: number;
  timestamp: number;
  kind: TrajectoryEventKind;
  /** Distinct glyph / color identity */
  glyph: TrajectoryGlyphId;
  /** Unique lane key (name, or name::pid when PID mapped) */
  processKey: string;
  /** Display label for the swimlane / inspector */
  processName: string;
  label: string;
  eventType: string;
  details: Record<string, string>;
}

export interface TrajectoryLane {
  processKey: string;
  processName: string;
  parentKey: string;
  parentName: string;
  depth: number;
  lifeStart: number;
  lifeEnd: number;
  terminated: boolean;
  eventCount: number;
}

export interface TrajectorySpawn {
  parentKey: string;
  childKey: string;
  parentName: string;
  childName: string;
  timestamp: number;
  parentEventId: string;
  childEventId: string;
}

export interface TrajectoryModel {
  lanes: TrajectoryLane[];
  events: TrajectoryEvent[];
  spawns: TrajectorySpawn[];
  tMin: number;
  tMax: number;
  warning?: string;
}

/** Friendly titles + Sysmon/ECS event.action matchers for each glyph */
export const TRAJECTORY_GLYPH_DEFS: {
  id: TrajectoryGlyphId;
  title: string;
  kind: TrajectoryEventKind;
  /** Matched against event.action tokens (and the full string) */
  matchers: RegExp[];
  /** Synthetic spawn fork — not matched from CSV */
  synthetic?: boolean;
  note?: string;
}[] = [
  {
    id: "spawn",
    title: "Spawn",
    kind: "process",
    matchers: [],
    synthetic: true,
    note: "Derived from process creation + parent link",
  },
  {
    id: "processCreate",
    title: "Process creation",
    kind: "process",
    matchers: [/^process creation$/i, /^process_create$/i, /^procstart$/i],
  },
  {
    id: "fileCreate",
    title: "File create",
    kind: "file",
    matchers: [
      /^filecreate$/i,
      /^file_create$/i,
      /^file create$/i,
      /^filecreate/i,
    ],
  },
  {
    id: "networkConnect",
    title: "Network connection",
    kind: "network",
    matchers: [
      /^network connection$/i,
      /^network_connect$/i,
      /^network.?connection$/i,
    ],
  },
  {
    id: "dnsQuery",
    title: "DNS query",
    kind: "network",
    matchers: [/^dnsevent/i, /^dns.?query$/i, /^dns$/i],
  },
  {
    id: "processTerminated",
    title: "Process terminated",
    kind: "exit",
    matchers: [
      /^process terminated$/i,
      /^process_terminate$/i,
      /^process.?exit$/i,
      /^process.?end$/i,
      /^proc.?end$/i,
      /^process.?stop$/i,
    ],
    note: "Ends process lifeline",
  },
  {
    id: "registry",
    title: "Registry",
    kind: "other",
    matchers: [/^registryevent/i, /^registry.?event/i, /^registry$/i],
  },
  {
    id: "processAccess",
    title: "Process access",
    kind: "other",
    matchers: [/^processaccess$/i, /^process.?access$/i],
  },
  {
    id: "driverLoaded",
    title: "Driver loaded",
    kind: "other",
    matchers: [/^driver loaded$/i, /^driver.?load/i],
  },
];

const GLYPH_TITLE = Object.fromEntries(
  TRAJECTORY_GLYPH_DEFS.map((d) => [d.id, d.title]),
) as Record<TrajectoryGlyphId, string>;

export function glyphTitle(id: TrajectoryGlyphId): string {
  return GLYPH_TITLE[id] ?? id;
}

function makeKey(name: string, pid: string): string {
  return pid ? `${name}::${pid}` : name;
}

function makeLabel(name: string, pid: string): string {
  return pid ? `${name} (${pid})` : name;
}

export function suggestDagMapping(columns: string[]): Partial<DagMapping> {
  const lower = columns.map((c) => ({
    c,
    n: c.toLowerCase().replace(/[_\s.]+/g, ""),
  }));
  const findExact = (...hints: string[]) => {
    for (const h of hints) {
      const key = h.replace(/[_\s.]+/g, "");
      const hit = lower.find((x) => x.n === key);
      if (hit) return hit.c;
    }
    return null;
  };
  const find = (...hints: string[]) => {
    const exact = findExact(...hints);
    if (exact) return exact;
    for (const h of hints) {
      const key = h.replace(/[_\s.]+/g, "");
      const hit = lower.find((x) => x.n.includes(key));
      if (hit) return hit.c;
    }
    return null;
  };

  return {
    processCol:
      findExact("process.name", "processname") ??
      find("process.name", "processname") ??
      undefined,
    parentCol:
      findExact(
        "parent.process.name",
        "process.parent.name",
        "parentprocessname",
        "parentprocess",
      ) ??
      find(
        "parent.process.name",
        "process.parent.name",
        "parentprocess",
        "parent.image",
        "parentimage",
      ) ??
      undefined,
    processPidCol:
      findExact("process.pid", "processpid") ??
      find("process.pid", "processpid") ??
      null,
    parentPidCol:
      findExact(
        "parent.process.pid",
        "process.parent.pid",
        "parentprocesspid",
        "ppid",
      ) ??
      find("parent.process.pid", "parent.pid", "ppid", "parent_pid") ??
      null,
    // Prefer exact event.action — avoid loose "action" matches on unrelated cols
    eventTypeCol:
      findExact("event.action", "eventaction", "event.type", "eventtype") ??
      find("event.action", "eventaction", "event.type", "eventtype") ??
      null,
    hostCol:
      findExact(
        "host.hostname",
        "host.name",
        "hostname",
        "computer_name",
        "winlog.computer_name",
        "computername",
      ) ??
      find(
        "host.hostname",
        "hostname",
        "computer_name",
        "winlog.computer_name",
        "computername",
      ) ??
      null,
  };
}

function rowDetails(
  columns: string[],
  cells: string[],
  line: number,
): Record<string, string> {
  const d: Record<string, string> = { Line: String(line) };
  for (let i = 0; i < columns.length; i++) {
    const v = cells[i] ?? "";
    if (!isBlankField(v)) d[columns[i]] = v.trim();
  }
  return d;
}

/** Normalize Elastic multi-value actions like "Image loaded, load" */
function actionTokens(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Classify glyph from event.action (regex defaults).
 * Unmatched values (e.g. "Image loaded, load") become "other".
 */
export function classifyAction(event: string): {
  glyph: TrajectoryGlyphId;
  kind: TrajectoryEventKind;
} {
  if (!event.trim()) {
    return { glyph: "other", kind: "other" };
  }

  const tokens = actionTokens(event);
  const haystack = [...tokens, event.trim()];

  const order: TrajectoryGlyphId[] = [
    "processTerminated",
    "processAccess",
    "processCreate",
    "fileCreate",
    "dnsQuery",
    "networkConnect",
    "registry",
    "driverLoaded",
  ];

  for (const id of order) {
    const def = TRAJECTORY_GLYPH_DEFS.find((d) => d.id === id)!;
    for (const token of haystack) {
      if (def.matchers.some((re) => re.test(token))) {
        return { glyph: id, kind: def.kind };
      }
    }
  }

  return { glyph: "other", kind: "other" };
}

function kindForGlyph(glyph: TrajectoryGlyphId): TrajectoryEventKind {
  return (
    TRAJECTORY_GLYPH_DEFS.find((d) => d.id === glyph)?.kind ?? "other"
  );
}

/**
 * Resolve glyph using optional per-value map, then regex defaults.
 * Returns null when the resolved glyph is in disabledGlyphs (omit from map).
 */
export function resolveActionGlyph(
  event: string,
  actionGlyphMap?: Record<string, TrajectoryGlyphId> | null,
  disabledGlyphs?: TrajectoryGlyphId[] | null,
): { glyph: TrajectoryGlyphId; kind: TrajectoryEventKind } | null {
  const disabled = new Set(disabledGlyphs ?? []);
  let glyph: TrajectoryGlyphId;
  if (actionGlyphMap) {
    const direct = actionGlyphMap[event];
    if (direct) glyph = direct;
    else {
      let fromToken: TrajectoryGlyphId | undefined;
      for (const token of actionTokens(event)) {
        const mapped = actionGlyphMap[token];
        if (mapped) {
          fromToken = mapped;
          break;
        }
      }
      glyph = fromToken ?? classifyAction(event).glyph;
    }
  } else {
    glyph = classifyAction(event).glyph;
  }

  if (disabled.has(glyph)) {
    // Fall back to "other" when the primary glyph is off, unless other is also off
    if (glyph !== "other" && !disabled.has("other")) {
      return { glyph: "other", kind: "other" };
    }
    return null;
  }
  return { glyph, kind: kindForGlyph(glyph) };
}

/** Unique event.action values in a column, sorted by frequency (desc). */
export function collectActionValues(
  rows: string[][],
  columns: string[],
  actionCol: string,
  limit = 80,
): { value: string; count: number }[] {
  const idx = columns.indexOf(actionCol);
  if (idx < 0) return [];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const raw = (row[idx] ?? "").trim();
    if (isBlankField(raw)) continue;
    // Prefer full multi-value string as the map key; also count tokens
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, limit);
}

/** Distinct values for an optional host / computer column */
export function collectHostValues(
  rows: string[][],
  columns: string[],
  hostCol: string,
  limit = 200,
): { value: string; count: number }[] {
  const idx = columns.indexOf(hostCol);
  if (idx < 0) return [];
  const counts = new Map<string, number>();
  for (const row of rows) {
    const raw = (row[idx] ?? "").trim();
    if (isBlankField(raw)) continue;
    // host.ip may be multi-value — keep full string as identity when that's the col
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, limit);
}

/**
 * Build aChart (asset logs flowchart): glyphs are nodes; lifelines/spawns only connect nodes.
 * When PID columns are mapped, lanes are unique per (name, pid).
 * Glyph type comes only from the mapped event.action column.
 */
export function buildTrajectory(
  rows: FilterableRow[],
  columns: string[],
  mapping: DagMapping,
  opts: {
    showFiles: boolean;
    showNetwork: boolean;
    timestampColumn: string | null;
  },
): TrajectoryModel {
  const colIndex = new Map(columns.map((c, i) => [c, i]));
  const pIdx = colIndex.get(mapping.processCol);
  const parIdx = colIndex.get(mapping.parentCol);
  if (pIdx === undefined || parIdx === undefined) {
    return {
      lanes: [],
      events: [],
      spawns: [],
      tMin: 0,
      tMax: 1,
      warning: "Process/parent columns not found.",
    };
  }

  const tsIdx =
    opts.timestampColumn && colIndex.has(opts.timestampColumn)
      ? colIndex.get(opts.timestampColumn)!
      : null;
  const eventIdx =
    mapping.eventTypeCol != null
      ? colIndex.get(mapping.eventTypeCol)
      : undefined;
  const pidIdx =
    mapping.processPidCol != null
      ? colIndex.get(mapping.processPidCol)
      : undefined;
  const ppidIdx =
    mapping.parentPidCol != null
      ? colIndex.get(mapping.parentPidCol)
      : undefined;
  const hostIdx =
    mapping.hostCol != null ? colIndex.get(mapping.hostCol) : undefined;
  const hostFilter =
    hostIdx !== undefined && mapping.hostValue && !isBlankField(mapping.hostValue)
      ? mapping.hostValue.trim()
      : null;

  const scopedRows =
    hostFilter != null
      ? rows.filter((row) => (row.cells[hostIdx!] ?? "").trim() === hostFilter)
      : rows;

  const timed = scopedRows.map((row) => {
    const t = tsIdx != null ? parseTimestamp(row.cells[tsIdx] ?? "") : null;
    return { row, t };
  });
  timed.sort((a, b) => {
    if (a.t == null && b.t == null) return a.row.line - b.row.line;
    if (a.t == null) return 1;
    if (b.t == null) return -1;
    return a.t - b.t || a.row.line - b.row.line;
  });

  if (hostFilter != null && timed.length === 0) {
    return {
      lanes: [],
      events: [],
      spawns: [],
      tMin: 0,
      tMax: 1,
      warning: `No events for host “${hostFilter}”. Remap and pick another hostname.`,
    };
  }

  const parentOf = new Map<string, string>();
  const labelOf = new Map<string, string>();
  const spawnedChild = new Set<string>();
  const events: TrajectoryEvent[] = [];
  const spawns: TrajectorySpawn[] = [];
  let fallbackT = Date.now();
  const times: number[] = [];

  for (const { row, t: rawT } of timed) {
    const proc = (row.cells[pIdx] ?? "").trim() || "(blank)";
    const parent = (row.cells[parIdx] ?? "").trim();
    const procPid =
      pidIdx !== undefined ? (row.cells[pidIdx] ?? "").trim() : "";
    const parentPid =
      ppidIdx !== undefined ? (row.cells[ppidIdx] ?? "").trim() : "";
    const event =
      eventIdx !== undefined ? (row.cells[eventIdx] ?? "").trim() : "";
    const t = rawT ?? fallbackT++;
    times.push(t);

    const procKey = makeKey(proc, procPid);
    const procLabel = makeLabel(proc, procPid);
    const parentKey = parent ? makeKey(parent, parentPid) : "";
    const parentLabel = parent ? makeLabel(parent, parentPid) : "";
    labelOf.set(procKey, procLabel);
    if (parentKey) labelOf.set(parentKey, parentLabel);

    const resolved = resolveActionGlyph(
      event,
      mapping.actionGlyphMap,
      mapping.disabledGlyphs,
    );
    if (!resolved) continue;
    const { glyph, kind } = resolved;

    if (kind === "file" && !opts.showFiles) continue;
    if (kind === "network" && !opts.showNetwork) continue;

    const childId = `evt:${row.line}`;
    const details = rowDetails(columns, row.cells, row.line);

    const isCreate = glyph === "processCreate";
    if (
      isCreate &&
      parentKey &&
      parentKey !== procKey &&
      !spawnedChild.has(procKey)
    ) {
      spawnedChild.add(procKey);
      parentOf.set(procKey, parentKey);
      const parentEventId = `spawn:${parentKey}->${procKey}:${row.line}`;
      const spawnDetails: Record<string, string> = {
        Line: String(row.line),
        "Lane process": parentLabel,
        Event: "spawn",
        "Spawned process": procLabel,
      };
      if (!isBlankField(parentPid)) spawnDetails["Lane PID"] = parentPid;
      if (!isBlankField(procPid)) spawnDetails["Spawned PID"] = procPid;
      events.push({
        id: parentEventId,
        line: row.line,
        timestamp: t,
        kind: "process",
        glyph: "spawn",
        processKey: parentKey,
        processName: parentLabel,
        label: `→ ${procLabel}`,
        eventType: "spawn",
        details: spawnDetails,
      });
      spawns.push({
        parentKey,
        childKey: procKey,
        parentName: parentLabel,
        childName: procLabel,
        timestamp: t,
        parentEventId,
        childEventId: childId,
      });
    } else if (parentKey && parentKey !== procKey && !parentOf.has(procKey)) {
      parentOf.set(procKey, parentKey);
    }

    let label = procLabel;
    if (glyph === "processTerminated") label = `${procLabel} (exit)`;
    else if (event) label = `${procLabel} · ${actionTokens(event)[0] ?? event}`;

    events.push({
      id: childId,
      line: row.line,
      timestamp: t,
      kind,
      glyph,
      processKey: procKey,
      processName: procLabel,
      label,
      eventType: event || glyphTitle(glyph),
      details,
    });
  }

  const byProc = new Map<string, TrajectoryEvent[]>();
  for (const e of events) {
    const list = byProc.get(e.processKey) ?? [];
    list.push(e);
    byProc.set(e.processKey, list);
  }

  const depthOf = new Map<string, number>();
  for (const p of byProc.keys()) {
    let d = 0;
    let cur: string | undefined = p;
    const seen = new Set<string>();
    while (cur && parentOf.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = parentOf.get(cur);
      d += 1;
      if (d > 50) break;
    }
    depthOf.set(p, d);
  }

  const lanes: TrajectoryLane[] = [...byProc.entries()]
    .map(([processKey, evts]) => {
      const sorted = [...evts].sort(
        (a, b) => a.timestamp - b.timestamp || a.line - b.line,
      );
      const first = sorted[0]!;
      const exitEvt = sorted.find((e) => e.glyph === "processTerminated");
      const last = sorted[sorted.length - 1]!;
      const lifeStart = first.timestamp;
      const lifeEnd = exitEvt ? exitEvt.timestamp : last.timestamp;
      const parentKey = parentOf.get(processKey) ?? "";
      return {
        processKey,
        processName: labelOf.get(processKey) ?? first.processName,
        parentKey,
        parentName: parentKey ? (labelOf.get(parentKey) ?? parentKey) : "",
        depth: depthOf.get(processKey) ?? 0,
        lifeStart,
        lifeEnd: Math.max(lifeEnd, lifeStart),
        terminated: Boolean(exitEvt),
        eventCount: sorted.length,
      };
    })
    .sort((a, b) => {
      if (a.depth !== b.depth) return a.depth - b.depth;
      return (
        a.lifeStart - b.lifeStart || a.processName.localeCompare(b.processName)
      );
    });

  const eventIds = new Set(events.map((e) => e.id));
  const laneKeys = new Set(lanes.map((l) => l.processKey));
  const validSpawns = spawns.filter(
    (s) =>
      eventIds.has(s.parentEventId) &&
      eventIds.has(s.childEventId) &&
      laneKeys.has(s.parentKey) &&
      laneKeys.has(s.childKey),
  );

  const tMin = times.length ? Math.min(...times) : 0;
  const rawTMax = times.length ? Math.max(...times) : tMin + 1;
  const tMax = rawTMax === tMin ? tMin + 1 : rawTMax;

  let warning: string | undefined;
  if (events.length > 5000) {
    warning = `Large aChart (${events.length} events). Filter the grid first.`;
  }
  if (tsIdx == null) {
    warning =
      (warning ? warning + " " : "") +
      "No timestamp column selected — events ordered by row only.";
  }
  if (eventIdx === undefined) {
    warning =
      (warning ? warning + " " : "") +
      "No event action column mapped — glyphs default to “other”.";
  }
  if (hostIdx !== undefined && !hostFilter) {
    const hosts = new Set<string>();
    for (const row of rows) {
      const h = (row.cells[hostIdx] ?? "").trim();
      if (!isBlankField(h)) hosts.add(h);
    }
    if (hosts.size > 1) {
      warning =
        (warning ? warning + " " : "") +
        `${hosts.size} hostnames found — remap and pick a host to avoid mixing machines.`;
    }
  }

  return {
    lanes,
    events,
    spawns: validSpawns,
    tMin,
    tMax,
    warning,
  };
}

/** @deprecated Use buildTrajectory */
export function buildDag(
  rows: FilterableRow[],
  columns: string[],
  mapping: DagMapping,
  opts: {
    showFiles: boolean;
    showNetwork: boolean;
    timestampColumn: string | null;
  },
) {
  return buildTrajectory(rows, columns, mapping, opts);
}

/** Strip PID suffix from lane labels like "cmd.exe [1234]" */
export function stripProcessPid(name: string): string {
  return name
    .replace(/\s*\[\d+\]\s*$/, "")
    .replace(/\s*::\s*\d+\s*$/, "")
    .trim();
}

function detailLookup(
  details: Record<string, string>,
  names: string[],
): string | null {
  const byLower = new Map(
    Object.entries(details).map(([k, v]) => [k.toLowerCase(), v] as const),
  );
  for (const name of names) {
    const exact = byLower.get(name.toLowerCase());
    if (exact && !isBlankField(exact)) return exact.trim();
  }
  for (const name of names) {
    const needle = name.toLowerCase();
    for (const [k, v] of byLower) {
      if (
        !isBlankField(v) &&
        (k === needle ||
          k.endsWith(`.${needle}`) ||
          k.endsWith(`_${needle}`) ||
          k.includes(needle))
      ) {
        return v.trim();
      }
    }
  }
  return null;
}

export type EventCorrelation = {
  type: "process" | "ip" | "domain" | "file" | "registry" | "module";
  /** Normalized compare value */
  value: string;
  /** Display value */
  display: string;
  label: string;
};

/** Primary correlation key for “find related” on node click */
export function extractCorrelation(
  event: TrajectoryEvent,
): EventCorrelation | null {
  const d = event.details;
  switch (event.glyph) {
    case "networkConnect": {
      const ip = detailLookup(d, [
        "destination.ip",
        "source.ip",
        "destinationip",
        "sourceip",
        "dest_ip",
        "src_ip",
        "ip",
      ]);
      if (ip) {
        return {
          type: "ip",
          value: ip.toLowerCase(),
          display: ip,
          label: `IP ${ip}`,
        };
      }
      break;
    }
    case "dnsQuery": {
      const domain = detailLookup(d, [
        "dns.question.name",
        "queryname",
        "destination.domain",
        "query",
        "domain",
      ]);
      if (domain) {
        return {
          type: "domain",
          value: domain.toLowerCase(),
          display: domain,
          label: `Domain ${domain}`,
        };
      }
      break;
    }
    case "fileCreate": {
      const path = detailLookup(d, [
        "file.path",
        "targetfilename",
        "file.name",
        "path",
        "filename",
      ]);
      if (path) {
        const base = path.split(/[/\\]/).pop() ?? path;
        return {
          type: "file",
          value: path.toLowerCase(),
          display: path,
          label: `File ${base}`,
        };
      }
      break;
    }
    case "registry": {
      const key = detailLookup(d, [
        "registry.path",
        "registry.key",
        "targetobject",
      ]);
      if (key) {
        return {
          type: "registry",
          value: key.toLowerCase(),
          display: key,
          label: `Registry ${key}`,
        };
      }
      break;
    }
    case "driverLoaded": {
      const mod = detailLookup(d, [
        "dll.path",
        "dll.name",
        "imageloaded",
        "image",
      ]);
      if (mod) {
        const base = mod.split(/[/\\]/).pop() ?? mod;
        return {
          type: "module",
          value: mod.toLowerCase(),
          display: mod,
          label: `Module ${base}`,
        };
      }
      break;
    }
    default:
      break;
  }

  const name = stripProcessPid(event.processName);
  if (!name) return null;
  return {
    type: "process",
    value: name.toLowerCase(),
    display: name,
    label: `Process ${name}`,
  };
}

function eventMatchesCorrelation(
  event: TrajectoryEvent,
  corr: EventCorrelation,
): boolean {
  const own = extractCorrelation(event);
  if (own && own.type === corr.type && own.value === corr.value) return true;

  if (corr.type === "process") {
    if (stripProcessPid(event.processName).toLowerCase() === corr.value) {
      return true;
    }
    const spawned = event.details["Spawned process"];
    if (spawned && stripProcessPid(spawned).toLowerCase() === corr.value) {
      return true;
    }
    return false;
  }

  for (const v of Object.values(event.details)) {
    if (v.trim().toLowerCase() === corr.value) return true;
    if (corr.type === "file") {
      const base = v.split(/[/\\]/).pop()?.toLowerCase();
      const corrBase = corr.display.split(/[/\\]/).pop()?.toLowerCase();
      if (base && corrBase && base === corrBase) return true;
    }
  }
  return false;
}

/** Events sharing the same correlation key as `selected` (includes selected) */
export function findRelatedEvents(
  selected: TrajectoryEvent,
  all: TrajectoryEvent[],
): { correlation: EventCorrelation | null; related: TrajectoryEvent[] } {
  const correlation = extractCorrelation(selected);
  if (!correlation) {
    return { correlation: null, related: [selected] };
  }
  const related = all.filter((e) => eventMatchesCorrelation(e, correlation));
  return {
    correlation,
    related: related.length ? related : [selected],
  };
}
