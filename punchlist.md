# Rook File Explorer — Project Punchlist

> **Status Legend:** `[ ]` Pending · `[~]` In Progress · `[x]` Completed

---

## Phase 0: Product Direction & Tech Stack Decisions
- [x] Draft interactive UI/Layout mockups ([file_explorer_mockups.html](./file_explorer_mockups.html))
- [x] **Select Primary Layout Paradigm**
  - [x] Layouts: `Modern Workspace`, `Thumbnails`, `Split Panels`, and `Fuzzy Command-First` (Miller Columns, Dual-Pane Commander and Tag/Faceted Canvas were removed)
  - [x] Top **Navigation & Options Ribbon** to seamlessly switch layouts (`Alt+1`, `Alt+2`, `Alt+5`, `Alt+7`), filter/sort, and toggle Inspector/Terminal panes
- [x] **Finalize Tech Stack**
  - [x] Desktop shell / runtime: **Tauri v2 + Rust**
  - [x] Frontend UI framework: **React + TypeScript + Tailwind CSS + Vite**
  - [x] State management & virtualized list renderer: **Zustand + `@tanstack/react-virtual`**
  - [x] Local metadata/tag persistence store: **SQLite (`rusqlite`)**

---

## Phase 1: Core File System & Virtual FS (VFS) Engine
- [x] **Directory Reading & Enumeration**
  - [x] Non-blocking async directory streaming (`src-tauri/src/lib.rs` + Vite Node FS bridge)
  - [x] Fast metadata extraction (size, modified timestamps, directory/extension detection)
  - [x] Drive / mount point detection
- [x] **File Operations (CRUD & Batch)**
  - [x] Copy, move, rename, and create file/directory (with recursive folder copy & same-folder `- Copy` auto-rename)
  - [x] Standard Clipboard (`Ctrl+C` Copy, `Ctrl+X` Cut, `Ctrl+V` Paste) across tabs and context menu
  - [x] Delete file/directory with confirmation
  - [x] Safe Windows Recycle Bin integration (`Del`) vs. Permanent Delete (`Shift+Del`)
  - [ ] Conflict resolution dialog (skip, overwrite, rename, compare timestamps/hashes)
  - [~] Progress queue with pause/cancel and transfer speed telemetry (transfer bar with progress, speed, ETA, and cancel is in; pause and queueing are not)
  - [x] Undo stack (`Ctrl+Z`) for rename, move, copy/paste, and create operations
- [ ] **File System Watcher**
  - [ ] Real-time directory change notifications (debounced UI updates)

---

## Phase 2: Primary UI Shell & Navigation
- [x] **Window & Tab Management**
  - [x] Frameless native WebView2 window (`RookWindow`) with integrated Minimize, Maximize/Restore, Exit, drag-to-move, and 8-way edge/corner resizing
  - [x] Multi-tab bar (`RibbonHeader.tsx`) with full-height box tabs, new tab, switch tab, and close tab
  - [x] Options & Preferences modal (`Ctrl+,`) with theme toggle, hidden dot-file filter, and configurable max thumbnail cache size
  - [x] Session persistence (restore open tabs, panes, active paths, layout, and window bounds on launch)
  - [x] Dark / Light theme token engine & custom dark-blue scrollbars (`src/index.css`)
- [x] **Omnibar & Breadcrumb Header**
  - [x] Interactive path breadcrumbs
  - [x] Double-click to edit raw path input
  - [x] Navigation history stack (`Back`, `Forward`, `Up`, `Refresh`)
- [~] **Virtualized File Viewport**
  - [ ] Smooth 60/120fps scrolling in directories with 50,000+ entries
  - [x] Multi-column sorting (Name, Size, Modified, Extension) with folders-first
  - [x] Multi-selection (`Ctrl+Click` toggle, `Shift+Click` range, `Ctrl+A` select all) with batch operations
  - [ ] Rubber-band marquee drag selection

---

## Phase 3: Layout Paradigms & Inspector
- [x] **View Mode 1: Modern Workspace**
  - [x] Collapsible left sidebar (`SidebarPane.tsx`: Quick Access, Drives, Smart Workflows with drag-and-drop reordering for sections and items)
  - [x] Detailed table list view (`LayoutsView.tsx`)
- [x] **View Mode 5: Fuzzy Command-First**
  - [x] Split instant fuzzy filter & live code/directory preview
- [x] **Live Inspector & QuickLook (`InspectorPane.tsx`)**
  - [x] Live text/code file preview & directory child summary
  - [x] Full-resolution Image, SVG, Audio, and Video preview (`GET /api/fs/raw`)
  - [x] Interactive `+ Tag` button with `localStorage` persistence

---

## Phase 4: Search, Indexing & Semantic Organization
- [~] **Instant Filter & Fuzzy Finder**
  - [x] In-folder type-ahead filter
  - [ ] Global command palette (`Ctrl+K` / `Ctrl+P`) for actions and recent paths
  - [ ] High-speed recursive search (filename + ripgrep content integration)
- [~] **Tagging & Faceted Views**
  - [x] Assign custom text tags to files and folders (`localStorage` persistence)
  - [ ] Smart Collections / Saved Queries (e.g., `ext:rs modified:today`, `size:>100MB`)

---

## Phase 5: Developer & Power-User Integrations
- [x] **Git Integration**
  - [x] Per-file Git status badges (`Modified`, `Untracked`, `Staged`)
  - [x] Current branch indicator in navigation header
- [~] **Integrated Terminal & Shell Integration**
  - [x] Launch PowerShell in current directory (`Ctrl+T` + top ribbon button)
  - [x] Toggleable bottom shell pane (`Ctrl+\``) automatically synced to active directory
  - [ ] Interactive command execution inside the bottom terminal drawer
  - [ ] "Open in Editor" / custom external tool hooks
- [~] **Keyboard-First & Mouse Ergonomics**
  - [x] Mouse side-button (`Back` / `Forward`) navigation & `Alt+1..5` layout hotkeys
  - [ ] Customizable keymap (`keymap.toml` / JSON) with optional Vim-style navigation (`j`/`k`/`h`/`l`)
  - [ ] Batch rename utility with regex & token replacement preview
- [ ] **Archive & Remote VFS (Stretch Goals)**
  - [ ] Browse `.zip`, `.tar.gz`, `.7z` archives as virtual folders without full extraction
  - [ ] SFTP / SSH and S3 mount support in Dual-Pane view

---

## Phase 6: Performance, Testing & Packaging
- [~] **Benchmarks, Media & Thumbnail Pipeline**
  - [x] Disk-cached image & shell thumbnail generator (`%LOCALAPPDATA%\Rook\Thumbnails` via GDI+ & Windows `IShellItemImageFactory`) + live media QuickLook
  - [x] Automatic 250 MB LRU thumbnail cache eviction + live Sidebar cache telemetry & one-click clear button
  - [ ] Cold start time < 150ms & Directory load time < 20ms for 10k files
- [x] **Cross-Platform / OS Integration**
  - [x] Standalone Windows Desktop Executable (`release/Rook.exe` via `npm run build:standalone` / [Program.cs](./desktop-host/Program.cs))
  - [x] Custom Kenney icon skin + `chess_rook` native `.ico` application icon
  - [x] Open files with default Windows application on double-click (`Enter`) + Reveal in Windows Explorer
  - [x] Custom Rook Right-click context menu (`ContextMenu.tsx`) for files, folders, and empty directory space
  - [x] Drag-and-drop interoperability with external OS apps
