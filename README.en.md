# ttFolio · TT Project Workbench

[简体中文](README.md) | **English**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Windows](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D6.svg)](https://github.com/TT-Tao178/ttfolio/releases)
[![Version](https://img.shields.io/badge/version-0.2.4-1677ff.svg)](CHANGELOG.md)

A **local-first** project workbench: register the project folders on your disk, then browse source code,
inspect Git, manage docs and architecture diagrams, and search across everything — in one place.

**The disk is the source of truth; the database is only an index.** Project files stay where they are;
ttFolio just adds indexing, entry points and relationships on top.

- Fully local: single user, single machine, services listen on `127.0.0.1` only — no telemetry, no CDN, no outbound traffic at runtime
- Registered directories are never touched except by explicit user actions; deletions always go through a restorable trash
- The index database is snapshotted before startup and self-heals on corruption; wiping it never deletes project files

## Features

- **Project registration**: paste paths (multi-line / quoted / `\\?\` prefixed), native folder dialog, batch registration from a parent directory
- **Automatic analysis**: project type detection (frontend / backend / fullstack / microservice / asset repo, etc.),
  byte-based language breakdown (GitHub Linguist compatible, 90+ languages plus Makefile / Dockerfile / .env
  filename recognition), tech-stack tags, Git summary
- **File browsing & editing**: lazy-loaded file tree, CodeMirror 6 editor, draft protection (survives force-kill),
  external-change detection, three-way save-conflict resolution (compare / discard local / overwrite disk),
  byte-exact encoding & EOL preservation (UTF-8/BOM/UTF-16/GBK, CRLF/LF)
- **File operations**: context menu (Copy to… / Move to… / Reveal in Explorer / copy relative & absolute paths);
  click any breadcrumb segment to jump — clicking a directory segment auto-expands the tree to it
- **Git**: working-tree status, diff, staging, commits, history & commit detail, branch switching; no push/pull, no credentials stored
- **Docs**: automatic Markdown discovery, mounted external docs (multi-select), outline navigation, rendered reading
- **Architecture diagrams**: register diagram directories and view them in-app — HTML / image / text (md/json)
  side-by-side layout, served from a read-only port inside an iframe sandbox
- **Search**: command palette (Ctrl+K) and global search across project names / file names / file contents
  (SQLite FTS5, CJK friendly, incremental indexing)
- **Workbench overview**: project cards, items needing attention, aggregated language composition, recent commits across projects
- **Broken-path recovery**: when a directory is moved or deleted, relocate in one click (two entry points) or
  unregister with confirmation
- **Trash**: deleted items go to trash first and can be restored to their original paths; permanent deletion requires confirmation
- **Desktop app**: Electron-packaged Windows installer (NSIS), TT brand icon, native file dialogs

## Install

### Desktop (recommended)

Download `ttFolio-Setup-x.y.z.exe` from the [Releases](../../releases) page:

- Windows 10/11 x64 — no Node.js or other runtimes required
- Custom install directory supported (Chinese paths work), no admin rights needed
- Data lives in `%APPDATA%\ttFolio\` and survives uninstall
- The installer is unsigned; Windows SmartScreen will warn on first run — choose "More info → Run anyway"

### Run from source

Requires Node.js ≥ 22 (verified on Node 24). Git is optional — the Git tab is disabled without it, everything else works.

```bash
npm install
npm run dev
```

Dev mode starts the backend (`127.0.0.1:7717`) and the frontend (`localhost:5173`); open `http://localhost:5173`.

## Build the desktop app

```bash
npm run dist:win
```

Produces an NSIS installer (`ttFolio-Setup-x.y.z.exe`) under `dist-electron/`. The script runs the web build,
the server esbuild bundle, the Electron ABI rebuild of better-sqlite3, and a 7-point artifact self-check
(node_modules integrity, web assets, real boot smoke test) — the build only counts if all checks pass.

Note: packaging takes a few minutes and switches the local `node_modules` to the Electron ABI —
run `npm rebuild better-sqlite3` before continuing local development.

## Development

```bash
npm run typecheck   # strict TypeScript check (shared / server / web)
npm run lint        # ESLint, zero warnings allowed
npm run test        # Vitest unit & integration tests (real SQLite and git fixtures)
npm run build       # production build
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) with bodies explaining
the why, the blast radius and the verification.

### Repository layout

```
packages/
  shared/   Type definitions, Zod schemas, constants (shared by server & web)
  server/   Fastify + better-sqlite3
    core/   Path guard, atomic writes, git, trash, analyzer, dialogs, file watching
    db/     SQLite connection, migrations (append-only + auto snapshot), repositories
    routes/ All REST endpoints
  web/      React 18 + Vite + Ant Design 5 + CodeMirror 6
electron/   Desktop main process (in-process server + native dialog bridge)
scripts/    Development & build scripts
```

### Key design decisions

- Migrations are append-only, run automatically at startup, and snapshot the database before upgrading
- Every file access goes through a single path guard that rejects out-of-scope paths, UNC, symlinks and Windows reserved names
- The server pushes file changes over SSE; editor drafts and version guards never silently overwrite anything
- The desktop app runs the server in-process (no system Node required) and uses Electron native dialogs for file picking

## Data & backups

- Data directory: `%APPDATA%\ttFolio\` — `library.db`, `backups/`, `trash/`, `logs/`, etc.
- Automatic backup when the last one is older than 24 hours (`VACUUM INTO` + integrity check)
- Manual backup, restore and export (JSON / CSV) live in Settings → Data & Backup
- `TTFOLIO_DATA_DIR` and `TTFOLIO_PORT` environment variables override the defaults

## FAQ

**`npm run dev` / `npm test` fails with a better-sqlite3 version error after packaging?**
Packaging switches the local node_modules to the Electron ABI. Stop dev processes and run
`npm rebuild better-sqlite3`; the server's startup preflight exits cleanly on ABI mismatch and
never touches the index database.

**All requests fail in dev mode (ECONNREFUSED)?**
The desktop app writes its probed port into `%APPDATA%\ttFolio\runtime.json`, which the Vite proxy
reads. Change `port` back to `7717` and restart `npm run dev`.

**First launch of the installer is very slow?**
Antivirus scans the unsigned installer on first run (possibly 60+ seconds); the second launch is
usually under 4 seconds. For SmartScreen, choose "More info → Run anyway".

**Frontend changes not showing up?**
Vite may have cached a half-written module (editor atomic writes are not atomic for readers).
Restart the dev server — don't keep editing code to "fix" it.

**Lost data?**
The database is only an index — project files on disk are untouched; re-register and re-analyze to
rebuild. Automatic snapshots (before each migration + daily) live in `%APPDATA%\ttFolio\backups\`.

## License

[MIT](LICENSE) © TT-Tao178
