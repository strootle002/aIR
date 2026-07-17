const TIMESTAMP_NAME_HINTS = [
  "timestamp",
  "datetime",
  "date_time",
  "date time",
  "time",
  "timecreated",
  "time_created",
  "created",
  "eventtime",
  "event_time",
  "utc",
  "localtime",
  "local_time",
  "time of click",
  "timeofclick",
  "@timestamp",
  "visit_time",
  "visit time",
  "last_visit",
  "last visit",
  "iso",
];

export type ParseTimestampOptions = {
  /** When true, timezone-naive values are treated as UTC */
  assumeUtc?: boolean;
};

export const US_DISPLAY_TIMEZONES: { id: string; label: string }[] = [
  { id: "UTC", label: "UTC" },
  { id: "America/New_York", label: "Eastern (US)" },
  { id: "America/Chicago", label: "Central (US)" },
  { id: "America/Denver", label: "Mountain (US)" },
  { id: "America/Phoenix", label: "Arizona (no DST)" },
  { id: "America/Los_Angeles", label: "Pacific (US)" },
  { id: "America/Anchorage", label: "Alaska" },
  { id: "Pacific/Honolulu", label: "Hawaii" },
];

function makeDate(
  y: number,
  mon: number,
  day: number,
  h: number,
  m: number,
  s: number,
  ms: number,
  assumeUtc: boolean,
): Date {
  return assumeUtc
    ? new Date(Date.UTC(y, mon, day, h, m, s, ms))
    : new Date(y, mon, day, h, m, s, ms);
}

/** Parse common DFIR / browser / Excel timestamp strings to epoch ms. */
export function parseTimestamp(
  raw: string,
  opts?: ParseTimestampOptions,
): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  const assumeUtc = Boolean(opts?.assumeUtc);

  // Strip surrounding quotes
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  if (!s) return null;

  // Kibana / Elastic Discover: "Jul 8, 2026 @ 08:40:25.523"
  const kibana = s.match(
    /^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})\s+@\s+(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/,
  );
  if (kibana) {
    const months: Record<string, number> = {
      jan: 0,
      feb: 1,
      mar: 2,
      apr: 3,
      may: 4,
      jun: 5,
      jul: 6,
      aug: 7,
      sep: 8,
      oct: 9,
      nov: 10,
      dec: 11,
    };
    const mon = months[kibana[1].toLowerCase()];
    if (mon !== undefined) {
      const frac = (kibana[7] ?? "0").padEnd(3, "0").slice(0, 3);
      const d = makeDate(
        Number(kibana[3]),
        mon,
        Number(kibana[2]),
        Number(kibana[4]),
        Number(kibana[5]),
        Number(kibana[6]),
        Number(frac),
        assumeUtc,
      );
      const t = d.getTime();
      if (!Number.isNaN(t)) return t;
    }
  }

  // Also accept Kibana-like strings by stripping " @ " for Date.parse fallbacks
  if (s.includes(" @ ")) {
    const stripped = s.replace(" @ ", " ");
    const kt = Date.parse(stripped);
    if (!Number.isNaN(kt)) return kt;
  }

  // Unix epoch: seconds (10 digits) or milliseconds (13 digits), optional decimals
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    // Likely seconds if in typical Unix range before year ~2286 in seconds
    if (Math.abs(n) < 1e11) return Math.round(n * 1000);
    if (Math.abs(n) < 1e14) return Math.round(n);
    // Chrome/WebKit FILETIME-ish (microseconds since 1601) — convert if huge
    if (n > 1e16) {
      const ms = Math.round(n / 1000 - 11644473600000);
      if (ms > 0 && ms < 4e12) return ms;
    }
    return null;
  }

  // Normalize: space between date and time → T; slash dates kept for Date.parse
  let normalized = s
    .replace(/\u0000/g, "")
    .replace(/(\d) (AM|PM)/i, "$1 $2");

  // "2024-01-15 10:30:45.1234567 +00:00" / "2024-01-15 10:30:45Z"
  if (/^\d{4}-\d{2}-\d{2}[ T]\d/.test(normalized)) {
    normalized = normalized.replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T");
    // Truncate fractional seconds to 3 digits (JS Date limit)
    normalized = normalized.replace(/(\.\d{3})\d+/, "$1");
    // Normalize "+0000" / "+00:00" / " UTC"
    normalized = normalized
      .replace(/ UTC$/i, "Z")
      .replace(/ ([+-]\d{2}):?(\d{2})$/, "$1$2")
      .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    // Timezone-naive ISO → UTC when requested
    if (
      assumeUtc &&
      !/[zZ]$/.test(normalized) &&
      !/[+-]\d{2}:\d{2}$/.test(normalized)
    ) {
      normalized = `${normalized}Z`;
    }
  }

  // US-style: M/D/YYYY h:mm:ss AM/PM
  const us = normalized.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?)?$/i,
  );
  if (us) {
    let hour = Number(us[4] ?? 0);
    const min = Number(us[5] ?? 0);
    const sec = Number(us[6] ?? 0);
    const ap = (us[7] ?? "").toUpperCase();
    if (ap === "PM" && hour < 12) hour += 12;
    if (ap === "AM" && hour === 12) hour = 0;
    const d = makeDate(
      Number(us[3]),
      Number(us[1]) - 1,
      Number(us[2]),
      hour,
      min,
      sec,
      0,
      assumeUtc,
    );
    const t = d.getTime();
    return Number.isNaN(t) ? null : t;
  }

  // EU-style: D/M/YYYY or D.M.YYYY
  const eu = normalized.match(
    /^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (eu && Number(eu[1]) > 12) {
    const d = makeDate(
      Number(eu[3]),
      Number(eu[2]) - 1,
      Number(eu[1]),
      Number(eu[4] ?? 0),
      Number(eu[5] ?? 0),
      Number(eu[6] ?? 0),
      0,
      assumeUtc,
    );
    const t = d.getTime();
    return Number.isNaN(t) ? null : t;
  }

  const t = Date.parse(normalized);
  if (!Number.isNaN(t)) return t;

  // Last resort: replace remaining space with T
  const alt = Date.parse(normalized.replace(" ", "T"));
  if (!Number.isNaN(alt)) return alt;

  return null;
}

export function looksLikeTimestampColumn(name: string): boolean {
  return scoreColumnName(name) >= 2;
}

/** Format a raw cell for display in a target IANA timezone. Returns original if unparsable. */
export function formatTimestampDisplay(
  raw: string,
  timeZone: string | null | undefined,
  opts?: ParseTimestampOptions,
): string {
  if (!timeZone) return raw;
  const ms = parseTimestamp(raw, opts);
  if (ms == null) return raw;
  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZoneName: "short",
    }).format(ms);
    return formatted;
  } catch {
    return raw;
  }
}

export function timezoneLabel(id: string | null | undefined): string {
  if (!id) return "Original";
  return US_DISPLAY_TIMEZONES.find((z) => z.id === id)?.label ?? id;
}

export function detectTimestampColumn(
  columns: string[],
  rows: string[][],
  sampleSize = 40,
): string | null {
  if (columns.length === 0) return null;

  const scored = columns.map((col, idx) => {
    const nameScore = scoreColumnName(col);
    const valueScore = scoreColumnValues(rows, idx, sampleSize);
    return { col, score: nameScore * 2 + valueScore };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 2) return null;
  return best.col;
}

function scoreColumnName(name: string): number {
  const n = name.toLowerCase().replace(/[_-]+/g, " ").trim();
  if (TIMESTAMP_NAME_HINTS.some((h) => n === h || n.includes(h))) return 3;
  if (n.includes("date") || n.includes("time") || n.includes("iso")) return 2;
  return 0;
}

function scoreColumnValues(rows: string[][], colIdx: number, sampleSize: number): number {
  if (rows.length === 0) return 0;
  const sample = rows.slice(0, Math.min(sampleSize, rows.length));
  let ok = 0;
  let nonEmpty = 0;
  for (const row of sample) {
    const v = row[colIdx]?.trim() ?? "";
    if (!v) continue;
    nonEmpty += 1;
    if (parseTimestamp(v) != null) ok += 1;
  }
  if (nonEmpty === 0) return 0;
  const ratio = ok / nonEmpty;
  if (ratio >= 0.7) return 3;
  if (ratio >= 0.4) return 1;
  return 0;
}

export interface HistBucket {
  start: number;
  end: number;
  count: number;
}

export function buildHistogram(
  rows: string[][],
  columns: string[],
  timestampColumn: string,
  bucketCount = 48,
): HistBucket[] {
  const idx = columns.indexOf(timestampColumn);
  if (idx < 0) return [];

  const times: number[] = [];
  for (const row of rows) {
    const t = parseTimestamp(row[idx] ?? "");
    if (t != null) times.push(t);
  }
  if (times.length === 0) return [];

  const min = Math.min(...times);
  const max = Math.max(...times);
  if (min === max) {
    return [{ start: min, end: max + 1, count: times.length }];
  }

  const span = max - min;
  const buckets: HistBucket[] = Array.from({ length: bucketCount }, (_, i) => {
    const start = min + (span * i) / bucketCount;
    const end = min + (span * (i + 1)) / bucketCount;
    return { start, end, count: 0 };
  });

  for (const t of times) {
    let bi = Math.floor(((t - min) / span) * bucketCount);
    if (bi >= bucketCount) bi = bucketCount - 1;
    if (bi < 0) bi = 0;
    buckets[bi].count += 1;
  }

  return buckets;
}
