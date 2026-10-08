<div align="center">

# ttFolio

**A local-first project workbench**

[简体中文](README.md) | English

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D6.svg)](../../releases)
[![Version](https://img.shields.io/badge/version-0.2.12-1677ff.svg)](CHANGELOG.md)

</div>

ttFolio brings the project folders on your disk into a single workspace: browse code, inspect Git, manage docs and architecture diagrams, search across everything.

**The disk is the source of truth; the database is only an index.** Project files stay where they are — ttFolio layers indexing, entry points and relationships on top.

## Features

- **Register & analyze** — paste paths / folder dialog / batch-register children; automatic project type, language breakdown (Linguist-compatible), tech stack and Git summary
- **Browse & edit** — lazy-loading file tree, CodeMirror 6, draft protection, external-change detection, three-way save conflicts; UTF-8/BOM/UTF-16/GBK and CRLF/LF preserved as-is
- **File operations** — context menu (copy / move / rename / copy paths / reveal in Explorer), breadcrumb navigation; deletions always go to a restorable trash
- **Git** — status, diff, staging, commit, history & details, branch switching; no push/pull, no credentials stored
- **Docs & architecture** — Markdown discovery and rendering, external doc mounts, HTML / image / text preview for architecture dirs (read-only port + iframe sandbox)
- **Search** — Ctrl+K command palette; project / file / content search (SQLite FTS5, CJK friendly, incremental index)
- **Collections · tags · views** — group projects, collapsible sidebars, tags & notes, card/table views, one-click relocate for missing directories
- **Dashboard** — KPIs, projects needing attention, aggregated language breakdown, cross-project recent commits
- **Desktop** — Electron + NSIS installer, in-process server, native dialogs, built-in update check

## Screenshots

![Dashboard](docs/images/overview.png)

![Project files](docs/images/project-files.png)

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

## Layout

```
packages/
  shared/   types, Zod schemas, constants (shared by frontend & backend)
  server/   Fastify + better-sqlite3
    core/   path guard, atomic writes, git, trash, analyzer, dialogs, watcher
    db/     SQLite connection, migrations (append-only + auto snapshot), repositories
    routes/ REST endpoints
  web/      React 18 + Vite + Ant Design 5 + CodeMirror 6
electron/   desktop main process (in-process server + native dialog bridge)
scripts/    dev & build scripts
```

## Design principles

- Migrations are append-only; a database snapshot is taken before every upgrade, corruption self-heals
- All file access goes through a single path guard: traversal, UNC, symlinks and Windows reserved names are rejected
- File changes are pushed over SSE; draft and version guards never silently overwrite modifications
- The desktop build runs the server in-process — no system Node required

## Security & privacy

- Server binds to `127.0.0.1` only; single user, no telemetry, no CDN
- No network access except explicit user actions (update check, reveal in Explorer)
- Registered directories are untouched outside user actions; wiping the index never touches project files
- Data & backups: `%APPDATA%\ttFolio\` (daily auto-snapshot + manual backup/restore + JSON/CSV export); override with `TTFOLIO_DATA_DIR`, `TTFOLIO_PORT`

## Scope

Explicitly out of scope: Git push/pull and credential management, multi-user and permissions, cloud sync, directory auto-scanning, AI generation, IDE capabilities (build/debug/LSP), embedded terminal. ttFolio is a project repository and workbench — it does not compete with your IDE.

## Roadmap

- Tag-filtered project views
- Manual collection ordering
- Auto-update (under evaluation; currently manual check + guided download)

## Feedback

[Issues](../../issues) welcome — please include the app version and reproduction steps.

## License

[MIT](LICENSE) © TT-Tao178
