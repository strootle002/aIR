# aIR: Annotated Incident Response and Data Analysis

Cross-platform DFIR triage and data exploration toolkit built with **Tauri 2 + React + TypeScript** for Windows, macOS, and Linux.

Import tabular logs, filter and annotate them in a fast spreadsheet, then explore with timeline charts and mindmaps — without modifying the original evidence files.

## Product names

| Name | Role |
|------|------|
| **aIR** | Application (*Annotated Incident Response and Data Analysis*) |
| **aGrid** | Artifact Grid — virtualized spreadsheet / timeline viewer |
| **aChart** | Asset Logs FlowChart — process / asset swimlane timeline |
| **aMind** | Pivot mindmap explorer (ordered columns → tree) |

## Features

### aGrid
- Safe import of **CSV / TSV / TXT / JSON / NDJSON** (working copy only; originals stay untouched)
- Virtualized grid with **Line → Tag → Tags → data** column order
- Per-column filters (contains / include / exclude), global search, and **Filter Editor** (AND / OR / NOT)
- Sort by column (timestamp-aware when applicable)
- Optional **display timezone** for timestamp columns (display-only; CSV values unchanged)
- Conditional formatting; manual row/column/cell highlights and tags
- Group-by column headers (expand/collapse, sort by count)
- Column show/hide, reorder, resize, word wrap
- Export **visible** or **highlighted** rows as CSV or JSON
- Session persistence via `.ag_sess` sidecars

### Graphs
- **Timeline histogram** — brush a time range to filter the grid (**Graph → Graph Timeline…**)
- **aChart** — process lifelines, parent→child spawn links, event glyphs, macro scrubber, and inspector (**Graph → Convert to aChart…**)
- **aMind** — map ordered columns into a mindmap over the *currently filtered* rows; expand/collapse by level or branch (**Graph → Convert to aMind…**)
- Graph **Export…** — current view or whole graph as **PNG** or **PDF** (aChart full-timeline PDF can be multi-page)

### Other
- Light/dark appearance and accent themes (**Settings**)
- Jump from graph nodes/events back to the matching aGrid row (with highlight)

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://rustup.rs/) (stable)
- Platform packages for Tauri: [Tauri prerequisites](https://tauri.app/start/prerequisites/)

## Develop

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build
```

Installers are written under `src-tauri/target/release/bundle/` for **the OS you build on** (e.g. `.deb` / AppImage on Linux). A Windows `.exe` must be built on Windows (or via CI).

### GitHub Release (Windows + Linux)

This repo includes [`.github/workflows/release.yml`](.github/workflows/release.yml), which builds:

| Platform | Typical artifacts |
|----------|-------------------|
| Windows | NSIS `.exe`, `.msi` |
| Linux | `.deb`, `.AppImage` |

Publish a release draft by tagging a version that matches `src-tauri/tauri.conf.json` (currently `0.1.0`):

```bash
git tag v0.1.0
git push origin v0.1.0
```

Or run **Actions → Release → Run workflow**.  
In the repo: **Settings → Actions → General → Workflow permissions → Read and write permissions**.

## Sample data

Open [`samples/demo_boot_session.csv`](samples/demo_boot_session.csv) — a synthetic Sysmon-style boot / login session on host `DEMO-PC01`.

Suggested exploration:

1. **Graph → Graph Timeline…** to browse density over time  
2. **Graph → Convert to aChart: Asset Logs FlowChart…** — mapping auto-suggests process / parent / event action columns  
3. **Graph → Convert to aMind…** — e.g. levels `event.category` → `process.name` → `event.action`

## Import safety

On open, aIR copies the selected file into an app workspace:

```text
<data-dir>/artifactgrid/imports/<uuid>/<filename>
```

The source file is never opened for write and is not locked by aIR. (The on-disk folder name `artifactgrid` is kept for compatibility.)

## License

[MIT](LICENSE) — Copyright (c) 2026 ArtifactGrid Contributors
