<div align="center">

# ttFolio

**A local project workbench**

[简体中文](README.md) | English

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D6.svg)](../../releases)
[![Version](https://img.shields.io/github/v/release/TT-Tao178/ttfolio?label=version&color=1677ff)](CHANGELOG.md)

</div>

ttFolio brings the project folders on your disk into a single workspace: browse code, inspect Git, manage docs and architecture diagrams, search across everything.

## Features

- **Register & analyze** — paste paths / folder dialog / batch-register children; automatic project type, language breakdown (Linguist-compatible), tech stack and Git summary
- **Browse & edit** — lazy-loading file tree, CodeMirror 6, draft protection, external-change detection, three-way save conflicts; UTF-8/BOM/UTF-16/GBK and CRLF/LF preserved as-is
- **File operations** — context menu (copy / move / rename / copy paths / reveal in Explorer), breadcrumb navigation; deletions always go to a restorable trash
- **Git** — status, diff, staging, commit, history & details, branch switching; no push/pull, no credentials stored
- **Docs & architecture** — Markdown discovery and rendering, external doc mounts, HTML / image / text preview for architecture dirs (read-only port + iframe sandbox)
- **Search** — Ctrl+K command palette; project / file / content search (SQLite FTS5, CJK friendly, incremental index)
- **Collections · tags · views** — group projects, collapsible sidebars, tags & notes, tag-filtered views, card/table views, one-click relocate for missing directories
- **Dashboard** — KPIs, projects needing attention, aggregated language breakdown, cross-project recent commits
- **Themes** — light / dark / electric-red (OLED black + red glow) / cyberpunk (neon cyan glow) /
  minimal-sketch (paper feel) / follow system; native title bar follows
- **Desktop** — Electron + NSIS installer, in-process server, native dialogs, built-in update check

## Screenshots

Dashboard (light, default): KPIs, aggregated language breakdown, collections and last-opened times:

![Dashboard](docs/images/overview.png)

File browsing & editing (electric-red theme): lazy-loading tree, CodeMirror 6, tags & notes:

![Project files](docs/images/project-files.png)

Git: working-tree status and commit history (no push/pull, no credentials stored):

![Git history](docs/images/git-history.png)

Command palette (Ctrl+K): project / file / content search with highlighted matches:

![Command palette](docs/images/command-palette.png)

## Download

Grab `ttFolio-Setup-x.y.z.exe` from [Releases](../../releases).

- Windows 10/11 x64; no Node.js or other runtime required
- Custom install directory (non-ASCII paths supported), no admin rights needed
- Data lives in `%APPDATA%\ttFolio\`; uninstalling keeps your data
- Installer is unsigned: choose "More info → Run anyway" on SmartScreen; the first launch may trigger a full antivirus scan (~1 min), subsequent starts take under 4 seconds

## Run from source

Requires Node.js ≥ 22. Git is optional (Git tab disabled without it).

```bash
npm install
npm run dev        # backend 127.0.0.1:7717 + frontend localhost:5173
```

| Command | Description |
| --- | --- |
| `npm run dev` | Development mode (Vite + Fastify hot reload) |
| `npm run typecheck` | Strict TypeScript check (shared / server / web) |
| `npm run lint` | ESLint, zero-warning policy |
| `npm run test` | Vitest unit & integration tests (real SQLite / git fixtures) |
| `npm run build` | Production build |
| `npm run dist:win` | Package the Windows installer (with artifact self-check) |

> Packaging flips better-sqlite3 in your local `node_modules` to the Electron ABI — run `npm rebuild better-sqlite3` before continuing development.

## Feedback

[Issues](../../issues) welcome.

## License

[MIT](LICENSE) © TT-Tao178
