# aIR: Annotated Incident Response and Data Analysis

Open-source, cross-platform DFIR triage toolkit built with **Tauri 2 + React + TypeScript** for Windows, macOS, and Linux.

## Product names

| Name | Role |
|------|------|
| **aIR: Annotated Incident Response and Data Analysis** | Application |
| **aGrid: Artifact Grid** | Timeline spreadsheet / CSV viewer |
| **aChart: Asset Logs FlowChart** | Process / asset logs swimlane flowchart |
| **aMind** | Pivot mindmap explorer (column levels → tree) |

## Features

- **Safe import** — selecting a CSV / TSV / TXT / JSON / NDJSON copies it into an app workspace; the original file is never opened for write and is not locked by aIR
- **aGrid** — virtualized spreadsheet with **Line → Tag → Tags → data** column order
- **Per-column filters**, **global search**, and **Filter Editor** (AND / OR / NOT)
- **Conditional formatting** rules (cell or entire row); manual highlights always win
- **Shift + scroll** for horizontal panning; **word wrap**; **Alt + drag** resize-all
- **Group by** column headers (expand/collapse all, sort by count)
- **Export** visible or **highlighted** rows as CSV or JSON
- **Session persistence** (`.ag_sess` sidecar)
- **Timestamp histogram** (Graph → Graph Timeline) with resizable height
- **aChart: Asset Logs FlowChart** — swimlane timeline with process lifelines, parent→child spawn links, event glyphs on a time X-axis, macro scrubber + event inspector. Lifelines end on `process_terminate` / `process_exit` when present in the event type column.
- **aMind** — pivot mindmap from ordered columns over currently filtered rows
- **Settings** — light/dark mode and accent themes

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) (stable)
- Platform deps for Tauri: see [Tauri prerequisites](https://tauri.app/start/prerequisites/)

## Develop

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

## Sample data

Open [`samples/demo_timeline.csv`](samples/demo_timeline.csv) for a small process/network timeline. Use **Graph → Convert to aChart: Asset Logs FlowChart…** — columns auto-suggest for `process` / `parent.process` / `event_type` / `path` / `destination_ip`.

## Import safety

On open, aIR copies the selected file to:

```text
<app-data>/artifactgrid/imports/<uuid>/<filename>.csv
```

(The on-disk workspace folder name is unchanged for compatibility.)

## License

See repository license file.
