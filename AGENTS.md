# AGENTS.md — Rook File Explorer

Rook is a Windows file explorer. The UI is a React SPA. It runs inside a frameless
WinForms + WebView2 window hosted by a .NET 10 app, which also serves a local
HTTP file-system API. Roadmap and feature status live in [`punchlist.md`](./punchlist.md).

## Prerequisites

- **Node.js** LTS (20+) with npm
- **.NET 10 SDK** (`net10.0-windows`; Windows only)
- **WebView2 Runtime** (ships with Windows 10/11)
- Optional: Python 3 (icon scripts in `scripts/`), Rust (legacy Tauri shell only)

## Commands

Run from the repo root:

| Task | Command |
|---|---|
| Install deps | `npm install` |
| Type-check + build frontend → `dist/` | `npm run build` |
| Frontend dev server (http://localhost:1420) | `npm run dev` |
| Build desktop exe → `release\Rook.exe` | `npm run build:standalone` (or `build-standalone.bat`) |
| Build + launch desktop | `npm run desktop` / `run-desktop.bat` |
| Regenerate app icon | `npm run icons` |

There is no test suite or linter. `npm run build` (`tsc -b && vite build`) is the
validation step for frontend changes. For host changes, run
`dotnet build desktop-host/CrushExplorer.csproj -c Release`.

## Architecture

```
src/                     React 19 + TypeScript + Tailwind v4 + Zustand
  App.tsx                Root shell, global keyboard shortcuts
  store/useExplorerStore.ts   Central Zustand store (tabs, panes, selection, undo, clipboard, prefs)
  services/fsService.ts  ALL backend calls go through here (POST /api/fs/{action})
  types/fs.ts            Shared DTO types (must match backend JSON)
  components/            LayoutsView (5 layouts), RibbonHeader, SidebarPane,
                         InspectorPane, ContextMenu, TerminalDrawer, icons
desktop-host/Program.cs  PRIMARY backend: Kestrel on loopback + RookWindow (WinForms/WebView2)
vite.config.ts           Dev-only Node FS API plugin (subset of the .NET API)
electron/main.mjs        Legacy/experimental shell (small API subset)
src-tauri/               Legacy Tauri v2 shell ("crush-explorer"); only list_directory/read_file_preview
```

### Backend API contract

- The frontend calls `POST /api/fs/{action}` with a JSON body. It also calls
  `GET /api/fs/raw` and `GET /api/fs/thumb` for media and thumbnails.
- **`desktop-host/Program.cs` is the source of truth.** It implements every action
  (`list`, `search`, `preview`, `copy`/`move`/`rename`/`delete`, `zipCompress`/`zipExtract`,
  `openWith`, `runCommand`, `gitStatus`, `folderSizeStats`, `win*` window controls, etc.).
- `vite.config.ts` only mirrors a subset. Window controls, search, zip, folder sizes,
  and `runCommand` won't work under `npm run dev`. Use the desktop build to test them.
- Adding or changing an action means updating `fsService.ts`, `types/fs.ts`, and
  `Program.cs` together. Update the Vite plugin too if the feature should work in dev.
  Keep JSON field names camelCase.
- Errors are returned as `{ "error": "..." }` with a non-2xx status. `postApi` throws on them.

### Desktop host notes

- `dist/` is embedded into the exe as resources (`wwwroot`) **and** copied next to it.
  Always run `npm run build` before `dotnet build`. `build:standalone` does both.
- The window is frameless. Drag, resize, min/max, and close go through `win*` API actions and Win32 P/Invoke.
  The host pushes `rook-window-state` CustomEvents into the page.
- User data lives under `%LOCALAPPDATA%\Rook` (thumbnail cache with LRU eviction,
  folder-size cache, UI/session state).
- Close a running `Rook.exe` before rebuilding, or the output files will be locked.

## Conventions

- TypeScript `strict` is on. Use functional React components with hooks. Keep state in the
  Zustand store, not in ad-hoc component state, when it's shared across panes or tabs.
- Style with Tailwind utilities. Theme tokens and scrollbars are in `src/index.css`.
- Use `@tanstack/react-virtual` for any potentially large list.
- Icons: Kenney board-game icons (`KenneyIcon.tsx`, `iconCatalog.ts`) and Phosphor data.
  `src/assets/LICENSE-kenney-board-game-icons.txt` must stay with the assets.
- File operations are destructive. Preserve the confirmation, Recycle Bin (`Del`) vs. permanent
  (`Shift+Del`), and undo-stack behavior when touching delete/move/rename code.
- When you finish a punchlist item, update its checkbox in `punchlist.md`.
- Don't commit `dist/`, `release/`, `bin/`, `obj/`, `node_modules/`, or `EBWebView/`.

## Naming

Older names still appear: **Crush Explorer** (`CrushExplorer.csproj`, Tauri config).
The product name is **Rook** (assembly name `Rook`). Don't rename the project files
unless the task asks for it, because scripts reference them by path.
