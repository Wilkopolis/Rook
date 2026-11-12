import { create } from 'zustand';
import {
  DriveInfoItem,
  ExplorerTab,
  FilePreview,
  FolderViewStyle,
  FolderSizeStats,
  FolderLayout,
  FsEntry,
  LayoutMode,
  PinnedWorkspace,
  QuickAccessFolder,
  SidebarSectionId,
  SortField,
  SplitPanelIndex,
  SplitPanelState,
  SplitPaneTab,
  SshAddRequest,
  SshConnectResult,
  SshConnection,
  SshDrive,
  ThumbCacheStats,
  ConflictPolicy,
  TransferItemOptions,
  TransferItemResult,
  TransferPlan,
  Workflow,
} from '../types/fs';
import { fsService } from '../services/fsService';
import { logger } from '../services/logger';
import { inferTags } from '../utils/format';
import { applyColumns, getColumns, setColumnsChangeHandler } from '../components/FileColumns';
import { visibleSplitItems } from '../utils/splitPanels';
import { generateUrlShortcutName, buildInternetShortcutContent } from '../utils/dragDrop';

/** Tabs of the options modal (App.tsx). */
export type OptionsCategory = 'appearance' | 'files' | 'network' | 'storage' | 'diagnostics';

export type UndoOperation =
  | { kind: 'rename'; currentPath: string; oldName: string }
  | { kind: 'move'; moves: { currentPath: string; originalDir: string }[] }
  | { kind: 'copy'; createdPaths: string[] }
  | { kind: 'create'; createdPath: string };

/** A copy/move batch in flight, shown by TransferBar. */
export interface SplitPanelSort {
  sortBy: SortField;
  sortAsc: boolean;
}

export interface HistoryViewState {
  path: string;
  scrollTop: number;
  selectedPath: string | null;
  selectedPaths: string[];
}

export interface TransferState {
  id: string;
  kind: 'copy' | 'move';
  destDir: string;
  /** Top-level items of the batch (what the user selected). */
  totalItems: number;
  doneItems: number;
  /** Byte and file counts come from the host; they stay 0 when it doesn't track progress (dev server). */
  totalBytes: number;
  doneBytes: number;
  totalFiles: number;
  doneFiles: number;
  /** Already at the destination: counted toward progress, not copied. */
  skippedBytes: number;
  skippedFiles: number;
  currentName: string;
  /** The host is still totalling the batch, so totalBytes/totalFiles are not final. */
  scanning: boolean;
  bytesPerSec: number;
  /** False for the first moments, so instant operations never flash the bar. */
  visible: boolean;
  cancelling: boolean;
}

/** A copy/move waiting for the user to decide what happens to files that already exist. */
export interface ConflictPrompt {
  kind: 'copy' | 'move';
  destDir: string;
  itemCount: number;
  plan: TransferPlan;
}

export type ConflictDecision =
  | { action: 'cancel' }
  | { action: ConflictPolicy; verifySameSize: boolean };

export interface PromptModalConfig {
  kind: 'newFolder' | 'newFile' | 'rename' | 'addTag';
  title: string;
  subtitle?: string;
  defaultValue: string;
  targetPath?: string;
  isDirectory?: boolean;
}

interface ExplorerState {
  // System & Navigation
  drives: string[];
  driveDetails: DriveInfoItem[];
  homeDir: string;
  tabs: ExplorerTab[];
  activeTabId: string;
  currentPath: string;
  parentPath: string | null;
  items: FsEntry[];
  gitBranch: string | null;
  gitStatuses: Record<string, string>;
  thumbStats: ThumbCacheStats;
  folderSizeStats: FolderSizeStats;
  loggingEnabled: boolean;
  logFile: string | null;
  isLoading: boolean;
  error: string | null;
  statusMessage: string | null;
  /**
   * Session-only scroll offsets keyed by folder path. Never persisted: not in `SavedSession`,
   * `persistSession`, `rook_*` localStorage keys, workflows, or `ui-state.json`.
   */
  folderScrollPositions: Record<string, number>;
  setFolderScrollPosition: (path: string, offset: number) => void;
  /**
   * Session-only view state saved when leaving a history entry, keyed `${tabId}:${historyIndex}`.
   * Never persisted (same rules as `folderScrollPositions`). Read by the restore tasks.
   */
  historyViewStates: Record<string, HistoryViewState>;
  /** Snapshots scroll + selection of the active tab's current history entry. */
  captureHistoryView: () => void;

  // Dual-Pane right side state
  /** Dual-pane right side sorts independently from the left pane (session-only). */

  // Split layout: per-panel listings for the active tab (session-only; paths,
  // history and selection live on `ExplorerTab.splitPanels`).
  splitPanelItems: [FsEntry[], FsEntry[]];
  splitPanelErrors: [string | null, string | null];
  /** Independent column sort per split panel (session-only). */
  splitPanelSorts: [SplitPanelSort, SplitPanelSort];
  setSplitPanelSort: (index: 0 | 1, field: SortField) => void;

  // Selection, Clipboard, Undo & Preview
  selectedPath: string | null;
  selectedPaths: string[];
  clipboard: { paths: string[]; mode: 'copy' | 'cut' } | null;
  undoStack: UndoOperation[];
  transfers: TransferState[];
  cancelTransfer: (id: string) => void;
  conflictPrompt: ConflictPrompt | null;
  resolveConflictPrompt: (decision: ConflictDecision) => void;
  preview: FilePreview | null;
  pendingDeletePath: string | null;
  pendingDeletePaths: string[];
  deletePermanently: boolean;
  contextMenu: { x: number; y: number; entry: FsEntry | null } | null;
  promptModal: PromptModalConfig | null;
  /** Item currently being renamed in place (F2 / Rename). */
  inlineRename: { path: string; name: string; isDirectory: boolean } | null;
  cancelInlineRename: () => void;
  commitInlineRename: (value: string) => Promise<void>;

  // Layout & UI Options Ribbon
  /** Folder view mode for the main view. Never 'split': see `splitView`. */
  layout: FolderLayout;
  /** Global Rook display setting: show two independent folder panels. Independent of `layout`. */
  splitView: boolean;
  thumbGridSize: number;
  folderViews: Record<string, FolderViewStyle>;
  sortBy: SortField;
  sortAsc: boolean;
  filterQuery: string;
  deepSearch: boolean;
  deepSearchResults: FsEntry[] | null;
  isSearching: boolean;
  dirVersion: number;
  sidebarSectionOrder: SidebarSectionId[];
  /** Drive roots (e.g. `D:\`) hidden from the Drives and Mounts section. Persisted. */
  hiddenDrives: string[];
  /** Saved SSH hosts. Persisted by the desktop host in %LOCALAPPDATA%/Rook/ssh-connections.json. */
  sshConnections: SshConnection[];
  /**
   * Disks mounted on each SSH host, keyed by connection id. Refreshed on every connect and cached
   * in localStorage so they stay listed in the sidebar while the host is disconnected.
   */
  sshDrives: Record<string, SshDrive[]>;
  pinnedFolders: QuickAccessFolder[];
  workflows: Workflow[];
  showSidebar: boolean;
  showInspector: boolean;
  showTerminal: boolean;
  showQuickLookModal: boolean;
  showOptionsModal: boolean;
  /** Settings tab to show the next time the options modal opens (consumed by App). */
  optionsInitialCategory: OptionsCategory | null;
  showHiddenFiles: boolean;
  customTags: Record<string, string[]>;

  // Actions
  init: () => Promise<void>;
  navigateTo: (path: string, pushHistory?: boolean, restoreView?: boolean) => Promise<void>;
  /** Sidebar navigation: goes to the active panel in the split and dual-pane layouts, else the main view. */
  navigateSidebar: (path: string) => Promise<void>;
  goBack: () => Promise<void>;
  /** Creates split panels for the active tab if missing and loads both listings. */
  initSplitPanels: () => Promise<void>;
  navigateSplitPanel: (index: SplitPanelIndex, path: string, pushHistory?: boolean) => Promise<void>;
  splitPanelBack: (index: SplitPanelIndex) => Promise<void>;
  splitPanelForward: (index: SplitPanelIndex) => Promise<void>;
  splitPanelUp: (index: SplitPanelIndex) => Promise<void>;
  selectSplitPanelEntry: (
    index: SplitPanelIndex,
    entry: FsEntry,
    opts?: { ctrl?: boolean; shift?: boolean; orderedPaths?: string[] }
  ) => void;
  setSplitPanelSelection: (index: SplitPanelIndex, paths: string[]) => void;
  /** Marks a split panel as the active one for the current tab. */
  setActiveSplitPanel: (index: SplitPanelIndex) => void;
  addSplitPaneTab: (index: SplitPanelIndex, path?: string) => Promise<void>;
  switchSplitPaneTab: (index: SplitPanelIndex, tabId: string) => Promise<void>;
  closeSplitPaneTab: (index: SplitPanelIndex, tabId: string) => Promise<void>;
  reorderSplitPaneTabs: (index: SplitPanelIndex, fromId: string, toId: string) => void;
  // Keyboard routing: these act on the active split panel and return false when the
  // split layout isn't showing, so callers can fall back to the single-view behavior.
  splitNavigateHistory: (dir: 'back' | 'forward' | 'up') => boolean;
  splitMoveSelection: (to: 'next' | 'prev' | 'first' | 'last', shift: boolean) => boolean;
  splitSelectAll: () => boolean;
  splitOpenSelected: () => boolean;
  /** Copies the active panel's selection into the global selection used by copy/cut/delete/rename. */
  bridgeSplitSelection: () => boolean;
  goForward: () => Promise<void>;
  goUp: () => Promise<void>;
  refresh: () => Promise<void>;
  checkDirWatcher: () => Promise<void>;
  runDeepSearch: (query?: string) => Promise<void>;
  toggleDeepSearch: () => void;
  // Quick Access & Workflows
  reorderSidebarSections: (order: SidebarSectionId[]) => void;
  hideDrive: (drive: string) => void;
  unhideDrive: (drive: string) => void;
  loadSshConnections: () => Promise<void>;
  /** Saves a new SSH host. Throws with the host's message on invalid input or a duplicate. */
  addSshConnection: (req: SshAddRequest) => Promise<SshConnection>;
  removeSshConnection: (id: string) => Promise<void>;
  /** Connects to the host to check the key works. Throws with the host's message on failure. */
  testSshConnection: (id: string) => Promise<SshConnectResult>;
  resetSshHostKey: (id: string) => Promise<void>;
  /** Connects to a saved host and browses its home folder (or `/` when requested). */
  openSshHost: (id: string, at?: 'home' | 'root' | { path: string }) => Promise<void>;
  /** Re-reads the host's mounted disks (connects if needed). Failures keep the cached list. */
  loadSshDrives: (id: string) => Promise<void>;
  disconnectSsh: (id: string) => Promise<void>;
  reorderQuickAccessFolders: (folders: QuickAccessFolder[]) => void;
  reorderWorkflows: (workflows: Workflow[]) => void;
  togglePinFolder: (folderPath?: string) => void;
  pinQuickAccessFolder: (folderPath?: string, label?: string) => void;
  unpinQuickAccessFolder: (id: string) => void;
  renameQuickAccessFolder: (id: string, newLabel: string) => void;
  updateQuickAccessFolderStyle: (id: string, icon: string, iconColor: string) => void;
  pinWorkflow: (customLabel?: string) => void;
  unpinWorkflow: (id: string) => void;
  renameWorkflow: (id: string, newLabel: string) => void;
  updateWorkflowStyle: (id: string, icon: string, iconColor: string) => void;
  loadWorkflow: (wf: Workflow) => Promise<void>;
  unpinWorkspace: (id: string) => void;
  renamePinnedWorkspace: (id: string, newLabel: string) => void;
  updatePinnedWorkspaceStyle: (id: string, icon: string, iconColor: string) => void;
  loadPinnedWorkspace: (pin: PinnedWorkspace) => Promise<void>;
  selectEntry: (
    entry: FsEntry,
    opts?: { ctrl?: boolean; shift?: boolean; orderedPaths?: string[] }
  ) => Promise<void>;
  selectAll: (paths: string[]) => void;
  openEntry: (entry: FsEntry) => Promise<void>;
  revealInExplorer: (path?: string) => Promise<void>;
  openContextMenu: (x: number, y: number, entry: FsEntry | null) => void;
  /** Right-click on a row in a split pane: selects within that pane, makes it active, opens the menu. */
  openSplitPanelContextMenu: (index: SplitPanelIndex, x: number, y: number, entry: FsEntry) => void;
  closeContextMenu: () => void;
  openPromptModal: (config: PromptModalConfig) => void;
  closePromptModal: () => void;
  submitPromptModal: (value: string) => Promise<void>;
  refreshThumbStats: () => Promise<void>;
  setThumbMaxSize: (maxCacheMb: number) => Promise<void>;
  clearThumbCache: () => Promise<void>;
  refreshFolderSizeStats: () => Promise<void>;
  clearFolderSizeCache: () => Promise<void>;
  rescanCurrentFolderSizes: () => Promise<void>;
  refreshLogSettings: () => Promise<void>;
  setLoggingEnabled: (enabled: boolean) => Promise<void>;
  openLogFolder: () => Promise<void>;

  // Clipboard & Undo Actions
  copyToClipboard: () => void;
  cutToClipboard: () => void;
  /** `viaRemote`: have the destination SSH host copy from the network share itself (see `remoteCopyCheck`). */
  pasteClipboard: (targetDir?: string, viaRemote?: boolean) => Promise<void>;
  undoLastOperation: () => Promise<void>;

  // Tab Actions
  addTab: (path?: string) => Promise<void>;
  closeTab: (id: string) => void;
  switchTab: (id: string) => Promise<void>;
  reorderTabs: (fromId: string, toId: string) => void;

  // Layout & Ribbon Actions
  /** Picks a folder view. Choosing one also leaves split view. */
  setLayout: (layout: FolderLayout, opts?: { saveForFolder?: boolean }) => void;
  setSplitView: (on: boolean) => void;
  toggleSplitView: () => void;
  setThumbGridSize: (size: number) => void;
  themePreference: ThemePreference;
  setThemePreference: (theme: ThemePreference) => void;
  /** User overrides of the icon (and tint) shown per file extension, keyed by lowercase extension without dot. */
  extensionIcons: Record<string, ExtensionIconStyle>;
  setExtensionIcon: (ext: string, icon: string, color: string) => void;
  resetExtensionIcon: (ext: string) => void;
  setSortBy: (field: SortField) => void;
  toggleSortAsc: () => void;
  setFilterQuery: (q: string) => void;
  toggleSidebar: () => void;
  toggleInspector: () => void;
  toggleTerminal: () => void;
  toggleQuickLookModal: () => void;
  toggleOptionsModal: () => void;
  /** Opens the options modal on a specific settings tab. */
  openOptionsTo: (category: OptionsCategory) => void;
  clearOptionsInitialCategory: () => void;
  toggleHiddenFiles: () => void;
  setDeletePermanently: (perm: boolean) => void;
  addTagToPath: (path: string, tag: string) => void;

  // File CRUD & Shell Actions
  createNewFolder: (name: string) => Promise<void>;
  createNewFile: (name: string) => Promise<void>;
  renameSelected: (newName: string) => Promise<void>;
  requestDeleteSelected: (forcePermanent?: boolean) => void;
  confirmDeleteSelected: () => Promise<void>;
  cancelDeleteSelected: () => void;
  deleteSelected: () => Promise<void>;
  dropEntriesToDir: (sourcePaths: string[], targetDir: string, copy?: boolean) => Promise<void>;
  dropUrlToDir: (url: string, targetDir?: string, title?: string) => Promise<string | null>;
  lastDroppedUrl: { url: string; targetDir: string; title?: string; createdPath?: string } | null;
  compressSelectedToZip: () => Promise<void>;
  extractZipArchive: (zipPath: string) => Promise<void>;
  openPowershellCurrent: () => Promise<void>;
}

/**
 * The selection file actions should operate on: the active split pane's when the split layout is
 * showing, otherwise the details-view selection. Returns existing array references (no copies) so
 * it is safe to use inside a zustand selector.
 */
export const effectiveSelection = (
  s: Pick<ExplorerState, 'splitView' | 'tabs' | 'activeTabId' | 'selectedPath' | 'selectedPaths'>
): { selectedPath: string | null; selectedPaths: string[] } => {
  const split = activeSplitTarget(s);
  return split
    ? { selectedPath: split.panel.selectedPath, selectedPaths: split.panel.selectedPaths }
    : { selectedPath: s.selectedPath, selectedPaths: s.selectedPaths };
};

/** Paths a copy/cut/compress/delete should act on right now. */
const effectiveTargets = (s: Parameters<typeof effectiveSelection>[0]): string[] => {
  const { selectedPath, selectedPaths } = effectiveSelection(s);
  return selectedPaths.length > 0 ? selectedPaths : selectedPath ? [selectedPath] : [];
};

const newSplitPanel = (path: string): SplitPanelState => ({
  path,
  history: [path],
  historyIndex: 0,
  selectedPath: null,
  selectedPaths: [],
});

const snapshotPaneTab = (id: string, p: SplitPanelState): SplitPaneTab => ({
  id,
  path: p.path,
  history: p.history,
  historyIndex: p.historyIndex,
  selectedPath: p.selectedPath,
  selectedPaths: p.selectedPaths,
});

/** Ensure a pane has a tab list (legacy panes get one implicit tab) and write the live state into the active tab. */
const withPaneTabs = (p: SplitPanelState): { tabs: SplitPaneTab[]; activeId: string } => {
  const activeId = p.activePaneTabId ?? 'pt-0';
  const tabs = p.paneTabs?.length ? p.paneTabs : [snapshotPaneTab(activeId, p)];
  return { tabs: tabs.map((t) => (t.id === activeId ? snapshotPaneTab(activeId, p) : t)), activeId };
};

const parentOf = (p: string): string | null => {
  const trimmed = p.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  if (idx < 0) return null;
  const parent = trimmed.slice(0, idx);
  // Drive root: "C:" -> "C:\"
  return /^[A-Za-z]:$/.test(parent) ? parent + '\\' : parent || null;
};

/** The active split panel of the active tab, or null when the split layout isn't showing. */
export const activeSplitTarget = (
  s: Pick<ExplorerState, 'splitView' | 'tabs' | 'activeTabId'>
): { index: SplitPanelIndex; panel: SplitPanelState } | null => {
  if (!s.splitView) return null;
  const tab = s.tabs.find((t) => t.id === s.activeTabId);
  if (!tab?.splitPanels) return null;
  const index: SplitPanelIndex = tab.activeSplitPanel ?? 0;
  return { index, panel: tab.splitPanels[index] };
};

/** Range / ctrl-toggle selection shared by the main view and split panels. */
const computeSelection = (
  anchor: string | null,
  current: string[],
  target: string,
  opts?: { ctrl?: boolean; shift?: boolean; orderedPaths?: string[] }
): string[] => {
  if (opts?.shift && anchor && opts.orderedPaths && opts.orderedPaths.length > 0) {
    const startIdx = opts.orderedPaths.indexOf(anchor);
    const endIdx = opts.orderedPaths.indexOf(target);
    if (startIdx !== -1 && endIdx !== -1) {
      return opts.orderedPaths.slice(Math.min(startIdx, endIdx), Math.max(startIdx, endIdx) + 1);
    }
  } else if (opts?.ctrl) {
    if (current.includes(target)) {
      const filtered = current.filter((p) => p !== target);
      return filtered.length > 0 ? filtered : [target];
    }
    return [...current, target];
  }
  return [target];
};

const SESSION_KEY = 'rook_session_v1';

interface SavedSession {
  tabs?: ExplorerTab[];
  activeTabId?: string;
  layout?: FolderLayout;
  splitView?: boolean;
  sortBy?: SortField;
  sortAsc?: boolean;
  showSidebar?: boolean;
  showInspector?: boolean;
  showHiddenFiles?: boolean;
}

/** Layout modes that were removed; saved prefs may still name them. */
const normalizeLayout = (layout: unknown): LayoutMode | undefined => {
  if (layout === 'workspace' || layout === 'thumbnails' || layout === 'split' || layout === 'command') {
    return layout;
  }
  if (layout === 'dualpane') return 'split';
  if (layout === 'miller' || layout === 'faceted') return 'workspace';
  return undefined;
};

/** Splits a saved layout into the folder view and the split-view flag it implies. */
const splitLayoutMode = (
  layout: LayoutMode | undefined
): { layout?: FolderLayout; splitView?: boolean } =>
  layout === 'split' ? { splitView: true } : layout ? { layout } : {};

const loadSavedSession = (): SavedSession => {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
    if (parsed && parsed.layout !== undefined) {
      // Older sessions stored split view as layout 'split'.
      const migrated = splitLayoutMode(normalizeLayout(parsed.layout));
      parsed.layout = migrated.layout;
      if (migrated.splitView) parsed.splitView = true;
    }
    if (parsed && typeof parsed.splitView !== 'boolean') delete parsed.splitView;
    return parsed;
  } catch {
    return {};
  }
};

/**
 * Writes the session snapshot to localStorage. Only the explicit fields below are saved.
 * Never spread the whole store (or add session-only fields such as `folderScrollPositions`)
 * here: scroll offsets are per-session and must not reach disk.
 */
const persistSession = (state: Partial<ExplorerState>) => {
  try {
    const prev = loadSavedSession();
    const next: SavedSession = {
      tabs: state.tabs ?? prev.tabs,
      activeTabId: state.activeTabId ?? prev.activeTabId,
      layout: state.layout ?? prev.layout,
      splitView: state.splitView ?? prev.splitView,
      sortBy: state.sortBy ?? prev.sortBy,
      sortAsc: state.sortAsc ?? prev.sortAsc,
      showSidebar: state.showSidebar ?? prev.showSidebar,
      showInspector: state.showInspector ?? prev.showInspector,
      showHiddenFiles: state.showHiddenFiles ?? prev.showHiddenFiles,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(next));
  } catch {}
};

const savedTags = (): Record<string, string[]> => {
  try {
    return JSON.parse(localStorage.getItem('rook_custom_tags') || '{}');
  } catch {
    return {};
  }
};

export interface ExtensionIconStyle {
  icon: string;
  color: string;
}

const EXTENSION_ICONS_KEY = 'rook_extension_icons_v1';

const savedExtensionIcons = (): Record<string, ExtensionIconStyle> => {
  try {
    const raw = JSON.parse(localStorage.getItem(EXTENSION_ICONS_KEY) || '{}');
    const out: Record<string, ExtensionIconStyle> = {};
    if (raw && typeof raw === 'object') {
      for (const [ext, v] of Object.entries(raw as Record<string, any>)) {
        if (v && typeof v.icon === 'string' && typeof v.color === 'string') {
          out[ext] = { icon: v.icon, color: v.color };
        }
      }
    }
    return out;
  } catch {
    return {};
  }
};

const persistExtensionIcons = (map: Record<string, ExtensionIconStyle>) => {
  try {
    localStorage.setItem(EXTENSION_ICONS_KEY, JSON.stringify(map));
  } catch {}
};

const savedThumbGridSize = (): number => {
  try {
    const saved = Number(localStorage.getItem('rook_thumb_grid_size'));
    if (saved && saved >= 40 && saved <= 240) return saved;
  } catch {}
  return 96;
};

export type ThemePreference = 'light' | 'dark' | 'system';
const THEME_KEY = 'rook_theme_preference';

const savedThemePreference = (): ThemePreference => {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {}
  return 'system';
};

const FOLDER_VIEWS_KEY = 'rook_folder_views_v1';

/** Key for `folderViews`. Windows paths are case-insensitive, so one folder gets one key. */
export const folderViewKey = (path: string) =>
  path.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();

const savedFolderViews = (): Record<string, FolderViewStyle> => {
  try {
    const parsed = JSON.parse(localStorage.getItem(FOLDER_VIEWS_KEY) || '{}');
    let cleaned = false;
    for (const key of Object.keys(parsed)) {
      const entry = parsed[key];
      if (!entry || entry.layout === undefined) continue;
      // Split view isn't remembered per folder. Older entries may hold 'split' (or the removed
      // 'dualpane'); drop the layout but keep the entry's sort, columns and thumb size.
      const layout = normalizeLayout(entry.layout);
      if (layout === 'split' || layout === undefined) {
        delete entry.layout;
        cleaned = true;
        if (Object.keys(entry).length === 0) delete parsed[key];
      } else {
        entry.layout = layout;
      }
    }
    if (cleaned) {
      try {
        localStorage.setItem(FOLDER_VIEWS_KEY, JSON.stringify(parsed));
      } catch {}
    }
    return parsed;
  } catch {
    return {};
  }
};

const persistFolderView = (
  views: Record<string, FolderViewStyle>,
  path: string,
  style: FolderViewStyle
): Record<string, FolderViewStyle> => {
  const key = folderViewKey(path);
  const next = { ...views, [key]: { ...views[key], ...style } };
  try {
    localStorage.setItem(FOLDER_VIEWS_KEY, JSON.stringify(next));
  } catch {}
  return next;
};

const sanitizePath = (p: string) =>
  p.replace(/c:\\Projects\\Repos\\Crush\\New Folder/gi, 'C:\\Projects\\Repos\\Rook');

const defaultQuickAccess = (): QuickAccessFolder[] => [
  {
    id: 'qa-rook',
    label: 'Rook Repo',
    path: 'C:\\Projects\\Repos\\Rook',
    icon: 'chess_rook',
    iconColor: '#38bdf8',
  },
  {
    id: 'qa-src',
    label: 'src',
    path: 'C:\\Projects\\Repos\\Rook\\src',
    icon: 'folder',
    iconColor: '#818cf8',
  },
  {
    id: 'qa-repos',
    label: 'Repos',
    path: 'C:\\Projects\\Repos',
    icon: 'briefcase',
    iconColor: '#34d399',
  },
];

const savedQuickAccessFolders = (): QuickAccessFolder[] => {
  try {
    const raw = localStorage.getItem('rook_quick_access_v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((item, idx) => {
          if (typeof item === 'string') {
            const cleanPath = sanitizePath(item);
            const norm = cleanPath.replace(/[\\/]+$/, '');
            const label = norm.split(/[\\/]/).filter(Boolean).pop() || norm;
            return { id: `qa-${idx}`, label, path: norm, icon: 'folder', iconColor: '#94a3b8' };
          }
          return {
            ...item,
            path: sanitizePath(item.path),
          };
        });
      }
    }
  } catch {}
  return defaultQuickAccess();
};

const defaultWorkflows = (): Workflow[] => [
  {
    id: 'wf-rook-core',
    label: 'Rook Workspace',
    path: 'C:\\Projects\\Repos\\Rook',
    icon: 'crown',
    iconColor: '#38bdf8',
    layout: 'workspace',
    tabs: [
      {
        id: 'tab-wf-rook',
        title: 'Rook',
        path: 'C:\\Projects\\Repos\\Rook',
        history: ['C:\\Projects\\Repos\\Rook'],
        historyIndex: 0,
      },
    ],
    activeTabId: 'tab-wf-rook',
  },
  {
    id: 'wf-split-commander',
    label: 'Split Commander',
    path: 'C:\\Projects\\Repos\\Rook',
    icon: 'columns',
    iconColor: '#14b8a6',
    layout: 'workspace',
    splitView: true,
    tabs: [
      {
        id: 'tab-wf-split',
        title: 'Rook',
        path: 'C:\\Projects\\Repos\\Rook',
        history: ['C:\\Projects\\Repos\\Rook'],
        historyIndex: 0,
      },
    ],
    activeTabId: 'tab-wf-split',
  },
];

/** Deep copy of a split panel, so a saved workflow never shares state with the live tabs. */
const cloneSplitPanel = (p: SplitPanelState): SplitPanelState => ({
  ...p,
  path: sanitizePath(p.path),
  history: Array.isArray(p.history) ? p.history.map(sanitizePath) : [sanitizePath(p.path)],
  selectedPaths: Array.isArray(p.selectedPaths) ? [...p.selectedPaths] : [],
  ...(Array.isArray(p.paneTabs) && {
    paneTabs: p.paneTabs.map((pt) => ({
      ...pt,
      path: sanitizePath(pt.path),
      history: Array.isArray(pt.history) ? pt.history.map(sanitizePath) : [sanitizePath(pt.path)],
      selectedPaths: Array.isArray(pt.selectedPaths) ? [...pt.selectedPaths] : [],
    })),
  }),
});

/** Deep copy of a tab for saving into, or restoring from, a workflow (split panels included). */
const cloneWorkflowTab = (t: ExplorerTab): ExplorerTab => ({
  ...t,
  path: sanitizePath(t.path),
  history: Array.isArray(t.history) ? [...t.history] : [t.path],
  ...(Array.isArray(t.splitPanels) &&
    t.splitPanels.length === 2 && {
      splitPanels: [cloneSplitPanel(t.splitPanels[0]), cloneSplitPanel(t.splitPanels[1])],
    }),
});

const savedWorkflows = (): Workflow[] => {
  try {
    const raw = localStorage.getItem('rook_workflows_v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((wf) => {
          // Older workflows stored split view as layout 'split'.
          const view = splitLayoutMode(normalizeLayout(wf.layout));
          return {
            ...wf,
            layout: view.layout ?? 'workspace',
            splitView: typeof wf.splitView === 'boolean' ? wf.splitView : view.splitView ?? false,
            path: sanitizePath(wf.path),
            tabs: Array.isArray(wf.tabs) ? wf.tabs.map(cloneWorkflowTab) : [],
          };
        });
      }
    }
    // Migration from old rook_pinned_folders_v1
    const oldRaw = localStorage.getItem('rook_pinned_folders_v1');
    if (oldRaw) {
      const oldParsed = JSON.parse(oldRaw);
      if (Array.isArray(oldParsed) && oldParsed.length > 0 && oldParsed[0].tabs) {
        return oldParsed.map((wf) => ({
          ...wf,
          path: sanitizePath(wf.path),
          tabs: Array.isArray(wf.tabs)
            ? wf.tabs.map((t: ExplorerTab) => ({ ...t, path: sanitizePath(t.path) }))
            : [],
        }));
      }
    }
  } catch {}
  return defaultWorkflows();
};

const defaultSectionOrder: SidebarSectionId[] = ['quickAccess', 'drives', 'workflows'];

const savedSectionOrder = (): SidebarSectionId[] => {
  try {
    const raw = localStorage.getItem('rook_sidebar_section_order_v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const valid = parsed.filter((id): id is SidebarSectionId =>
          ['quickAccess', 'drives', 'workflows'].includes(id)
        );
        const missing = defaultSectionOrder.filter((id) => !valid.includes(id));
        return [...valid, ...missing];
      }
    }
  } catch {}
  return defaultSectionOrder;
};

const HIDDEN_DRIVES_KEY = 'rook_hidden_drives_v1';
const SSH_DRIVES_KEY = 'rook_ssh_drives_v1';

const savedSshDrives = (): Record<string, SshDrive[]> => {
  try {
    const parsed = JSON.parse(localStorage.getItem(SSH_DRIVES_KEY) || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, SshDrive[]> = {};
      for (const [id, list] of Object.entries(parsed)) {
        if (!Array.isArray(list)) continue;
        out[id] = list.filter(
          (d): d is SshDrive => !!d && typeof d.path === 'string' && typeof d.mountPoint === 'string'
        );
      }
      return out;
    }
  } catch {}
  return {};
};

const persistSshDrives = (drives: Record<string, SshDrive[]>) => {
  try {
    localStorage.setItem(SSH_DRIVES_KEY, JSON.stringify(drives));
  } catch {}
};

const savedHiddenDrives = (): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(HIDDEN_DRIVES_KEY) || '[]');
    if (Array.isArray(parsed)) {
      return parsed.filter((d): d is string => typeof d === 'string' && d.length > 0);
    }
  } catch {}
  return [];
};

const sameDrive = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const initialSession = loadSavedSession();

// ---- Copy/move batches with progress (TransferBar) ----

const patchTransfer = (id: string, patch: Partial<TransferState>) =>
  useExplorerStore.setState((s) => ({
    transfers: s.transfers.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  }));

const leafName = (p: string) => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

interface TransferOutcome<T> {
  /** One result per item that finished, in source order. */
  results: T[];
  cancelled: boolean;
  error: string | null;
}

let conflictResolver: ((decision: ConflictDecision) => void) | null = null;
let conflictQueue: Promise<unknown> = Promise.resolve();

/** Shows the conflict dialog (ConflictDialog.tsx) and waits for the answer. One prompt at a time. */
function askConflictDecision(prompt: ConflictPrompt): Promise<ConflictDecision> {
  const ask = conflictQueue.then(
    () =>
      new Promise<ConflictDecision>((resolve) => {
        conflictResolver = resolve;
        useExplorerStore.setState({ conflictPrompt: prompt });
      })
  );
  conflictQueue = ask;
  return ask;
}

/**
 * Runs `op` for each source in turn (transfers are sequential) while publishing progress to
 * `transfers`. Before anything is touched the destination is checked: files that already exist
 * with other content are put to the user, identical ones are skipped without asking. Never
 * throws: a failure or a cancel stops the batch and is reported in the outcome, so callers can
 * still record the items that did finish on the undo stack.
 */
async function runTransfer<T>(
  kind: 'copy' | 'move',
  sources: string[],
  destDir: string,
  op: (src: string, options: TransferItemOptions) => Promise<T>
): Promise<TransferOutcome<T>> {
  // No plan (dev server): requests go out without a policy, and the host refuses to overwrite.
  let conflictOptions: Pick<TransferItemOptions, 'onConflict' | 'verifySameSize'> = {};
  try {
    const plan = await fsService.transferPlan(kind, sources, destDir);
    if (plan.differentCount + plan.sameSizeCount > 0) {
      const decision = await askConflictDecision({ kind, destDir, itemCount: sources.length, plan });
      if (decision.action === 'cancel') return { results: [], cancelled: true, error: null };
      conflictOptions = { onConflict: decision.action, verifySameSize: decision.verifySameSize };
    } else {
      // Nothing to ask. Should a file appear meanwhile, leaving both alone is the safe outcome.
      conflictOptions = { onConflict: 'skip' };
    }
  } catch {
    // Fall through without a policy.
  }

  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  useExplorerStore.setState((s) => ({
    transfers: [
      ...s.transfers,
      {
        id,
        kind,
        destDir,
        totalItems: sources.length,
        doneItems: 0,
        totalBytes: 0,
        doneBytes: 0,
        totalFiles: 0,
        doneFiles: 0,
        skippedBytes: 0,
        skippedFiles: 0,
        currentName: sources.length > 0 ? leafName(sources[0]) : '',
        scanning: true,
        bytesPerSec: 0,
        visible: false,
        cancelling: false,
      },
    ],
  }));
  const showTimer = setTimeout(() => patchTransfer(id, { visible: true }), 350);
  const isCancelling = () => useExplorerStore.getState().transfers.some((t) => t.id === id && t.cancelling);

  // Byte-level progress needs the desktop host; without it the bar falls back to item counts.
  let tracked = true;
  try {
    await fsService.transferStart(id, kind, sources, destDir);
  } catch {
    tracked = false;
    patchTransfer(id, { scanning: false });
  }

  // Speed (and with it the time-left estimate) is the average over a sliding window, so short
  // bursts and stalls between samples don't make the readout jump around.
  const SPEED_WINDOW_MS = 20_000;
  const samples: { at: number; bytes: number }[] = [{ at: performance.now(), bytes: 0 }];
  let speed = 0;
  let polling = false;
  const poll = async () => {
    if (polling) return;
    polling = true;
    try {
      const p = await fsService.transferProgress(id);
      const now = performance.now();
      samples.push({ at: now, bytes: p.doneBytes });
      // Keep one sample at or just beyond the window's edge as the baseline.
      while (samples.length > 2 && now - samples[1].at >= SPEED_WINDOW_MS) samples.shift();
      const dt = (now - samples[0].at) / 1000;
      // Wait for a second of data before showing a figure, so the first reading isn't a spike.
      if (dt >= 1) speed = Math.max(0, p.doneBytes - samples[0].bytes) / dt;
      patchTransfer(id, {
        totalBytes: p.totalBytes,
        doneBytes: p.doneBytes,
        totalFiles: p.totalFiles,
        doneFiles: p.doneFiles,
        skippedBytes: p.skippedBytes ?? 0,
        skippedFiles: p.skippedFiles ?? 0,
        scanning: p.scanning,
        bytesPerSec: speed,
        ...(p.currentName ? { currentName: p.currentName } : {}),
      });
    } catch {
      // A missed sample is harmless; the next one catches up.
    } finally {
      polling = false;
    }
  };
  const pollTimer = tracked ? setInterval(poll, 400) : null;

  const results: T[] = [];
  let error: string | null = null;
  let cancelled = false;
  try {
    for (let i = 0; i < sources.length; i++) {
      if (isCancelling()) break;
      if (!tracked) patchTransfer(id, { currentName: leafName(sources[i]) });
      results.push(await op(sources[i], { transferId: id, ...conflictOptions }));
      patchTransfer(id, { doneItems: i + 1 });
    }
  } catch (err: any) {
    if (!isCancelling()) error = err?.message || String(err);
  } finally {
    cancelled = isCancelling();
    clearTimeout(showTimer);
    if (pollTimer) clearInterval(pollTimer);
    if (tracked) void fsService.transferEnd(id).catch(() => {});
    useExplorerStore.setState((s) => ({ transfers: s.transfers.filter((t) => t.id !== id) }));
  }
  return { results, cancelled: cancelled && results.length < sources.length, error };
}

const transferStatus = (
  verb: 'Copy' | 'Move',
  outcome: TransferOutcome<{ skipped: number }>,
  total: number,
  doneMessage: string
): string => {
  const progress = `${outcome.results.length} of ${total} item${total === 1 ? '' : 's'} done`;
  if (outcome.error) return `${verb} failed (${progress}): ${outcome.error}`;
  if (outcome.cancelled) return `${verb} cancelled (${progress})`;
  const skipped = outcome.results.reduce((sum, r) => sum + r.skipped, 0);
  if (skipped === 0) return doneMessage;
  return `${doneMessage} — ${skipped} conflicting file${skipped === 1 ? '' : 's'} left as ${skipped === 1 ? 'it was' : 'they were'}`;
};

const itemOutcome = (res: TransferItemResult) => ({
  path: res.path,
  skipped: res.skipped ?? 0,
  // Merged into something that was already there: undoing it as a unit would take that along.
  undoable: Boolean(res.path) && !res.merged,
});

/** Copies `sources` into `destDir` with progress, then records what was created for undo. */
async function copyItemsTo(sources: string[], destDir: string, doneMessage: string, viaRemote = false): Promise<void> {
  const outcome = await runTransfer('copy', sources, destDir, async (src, options) =>
    itemOutcome(await fsService.copyItem(src, destDir, viaRemote ? { ...options, viaRemote } : options))
  );
  const createdPaths = outcome.results.filter((r) => r.undoable).map((r) => r.path);
  useExplorerStore.setState((s) => ({
    undoStack: createdPaths.length > 0 ? [...s.undoStack, { kind: 'copy', createdPaths }] : s.undoStack,
    statusMessage: transferStatus('Copy', outcome, sources.length, doneMessage),
  }));
}

/** Moves `sources` into `destDir` with progress and records the moves for undo. Returns the sources left unmoved. */
async function moveItemsTo(sources: string[], destDir: string, doneMessage: string, viaRemote = false): Promise<string[]> {
  const outcome = await runTransfer('move', sources, destDir, async (src, options) => ({
    ...itemOutcome(await fsService.moveItem(src, destDir, viaRemote ? { ...options, viaRemote } : options)),
    originalDir: src.replace(/[\\/][^\\/]+$/, ''),
  }));
  const moves = outcome.results
    .filter((r) => r.undoable)
    .map((r) => ({ currentPath: r.path, originalDir: r.originalDir }));
  useExplorerStore.setState((s) => ({
    undoStack: moves.length > 0 ? [...s.undoStack, { kind: 'move', moves }] : s.undoStack,
    statusMessage: transferStatus('Move', outcome, sources.length, doneMessage),
  }));
  return sources.slice(outcome.results.length);
}

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  drives: ['C:\\'],
  driveDetails: [],
  homeDir: '',
  tabs: [],
  activeTabId: 'tab-1',
  currentPath: '',
  parentPath: null,
  items: [],
  gitBranch: null,
  gitStatuses: {},
  thumbStats: { count: 0, totalBytes: 0 },
  folderSizeStats: { folderCount: 0, dbBytes: 0, pendingScans: 0 },
  loggingEnabled: logger.isEnabled(),
  logFile: null,
  isLoading: false,
  error: null,
  statusMessage: null,
  lastDroppedUrl: null,
  folderScrollPositions: {},
  setFolderScrollPosition: (path, offset) =>
    set((s) => {
      if (!path) return s;
      if (offset <= 0) {
        if (!(path in s.folderScrollPositions)) return s;
        const { [path]: _removed, ...rest } = s.folderScrollPositions;
        return { folderScrollPositions: rest };
      }
      if (s.folderScrollPositions[path] === offset) return s;
      return { folderScrollPositions: { ...s.folderScrollPositions, [path]: offset } };
    }),

  historyViewStates: {},
  captureHistoryView: () => {
    const s = get();
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (!tab || !s.currentPath) return;
    const state: HistoryViewState = {
      path: s.currentPath,
      scrollTop: s.folderScrollPositions[s.currentPath] ?? 0,
      selectedPath: s.selectedPath,
      selectedPaths: [...s.selectedPaths],
    };
    set({ historyViewStates: { ...s.historyViewStates, [`${tab.id}:${tab.historyIndex}`]: state } });
  },


  splitPanelItems: [[], []],
  splitPanelErrors: [null, null],
  splitPanelSorts: [
    { sortBy: initialSession.sortBy ?? 'name', sortAsc: initialSession.sortAsc ?? true },
    { sortBy: initialSession.sortBy ?? 'name', sortAsc: initialSession.sortAsc ?? true },
  ],
  setSplitPanelSort: (index, field) => {
    const sorts: [SplitPanelSort, SplitPanelSort] = [...get().splitPanelSorts];
    const cur = sorts[index];
    sorts[index] = { sortBy: field, sortAsc: cur.sortBy === field ? !cur.sortAsc : true };
    set({ splitPanelSorts: sorts });
  },

  selectedPath: null,
  selectedPaths: [],
  clipboard: null,
  undoStack: [],
  transfers: [],
  conflictPrompt: null,
  resolveConflictPrompt: (decision: ConflictDecision) => {
    const resolve = conflictResolver;
    conflictResolver = null;
    set({ conflictPrompt: null });
    resolve?.(decision);
  },
  cancelTransfer: (id: string) => {
    patchTransfer(id, { cancelling: true });
    void fsService.transferCancel(id).catch(() => {});
  },
  preview: null,
  pendingDeletePath: null,
  pendingDeletePaths: [],
  deletePermanently: false,
  contextMenu: null,
  promptModal: null,
  inlineRename: null,
  cancelInlineRename: () => set({ inlineRename: null }),
  commitInlineRename: async (value) => {
    const target = get().inlineRename;
    if (!target) return;
    set({ inlineRename: null });
    const clean = value.trim();
    if (!clean || clean === target.name) return;
    set({ selectedPath: target.path, selectedPaths: [target.path] });
    try {
      await get().renameSelected(clean);
    } catch (err) {
      set({ statusMessage: `Rename failed: ${err instanceof Error ? err.message : String(err)}` });
    }
  },

  layout: initialSession.layout ?? 'workspace',
  splitView: initialSession.splitView ?? false,
  thumbGridSize: savedThumbGridSize(),
  themePreference: savedThemePreference(),
  extensionIcons: savedExtensionIcons(),
  folderViews: savedFolderViews(),
  sortBy: initialSession.sortBy ?? 'name',
  sortAsc: initialSession.sortAsc ?? true,
  filterQuery: '',
  deepSearch: false,
  deepSearchResults: null,
  isSearching: false,
  dirVersion: 0,
  sidebarSectionOrder: savedSectionOrder(),
  hiddenDrives: savedHiddenDrives(),
  sshConnections: [],
  sshDrives: savedSshDrives(),
  pinnedFolders: savedQuickAccessFolders(),
  workflows: savedWorkflows(),
  showSidebar: initialSession.showSidebar ?? true,
  showInspector: initialSession.showInspector ?? true,
  showTerminal: false,
  showQuickLookModal: false,
  showOptionsModal: false,
  optionsInitialCategory: null,
  showHiddenFiles: initialSession.showHiddenFiles ?? true,
  customTags: savedTags(),

  init: async () => {
    set({ isLoading: true });
    try {
      const info = await fsService.getSystemInfo();
      const sess = loadSavedSession();

      const validSavedTabs =
        Array.isArray(sess.tabs) && sess.tabs.length > 0 ? sess.tabs : null;

      const defaultTab: ExplorerTab = {
        id: 'tab-1',
        title: info.cwd.split(/[\\/]/).filter(Boolean).pop() || info.cwd,
        path: info.cwd,
        history: [info.cwd],
        historyIndex: 0,
      };

      const tabsToUse = validSavedTabs || [defaultTab];
      const activeTab =
        tabsToUse.find((t) => t.id === sess.activeTabId) || tabsToUse[0];
      set({
        drives: info.drives,
        driveDetails: info.driveDetails || [],
        homeDir: info.home,
        tabs: tabsToUse,
        activeTabId: activeTab.id,
      });

      await get().navigateTo(activeTab.path, false);
      await get().refreshThumbStats();
      await get().refreshFolderSizeStats();
      await get().refreshLogSettings();
      await get().loadSshConnections();
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  },

  refreshLogSettings: async () => {
    const s = await fsService.getLogSettings();
    logger.setEnabled(!!s.enabled);
    set({ loggingEnabled: !!s.enabled, logFile: s.logFile ?? null });
  },

  setLoggingEnabled: async (enabled: boolean) => {
    try {
      const s = await fsService.setLoggingEnabled(enabled);
      logger.setEnabled(!!s.enabled);
      set({
        loggingEnabled: !!s.enabled,
        logFile: s.logFile ?? null,
        statusMessage: s.enabled ? 'Diagnostic logging enabled' : 'Diagnostic logging disabled',
      });
    } catch (err: any) {
      set({ error: `Could not change logging setting: ${err.message}` });
    }
  },

  openLogFolder: async () => {
    try {
      await fsService.openLogFolder();
    } catch (err: any) {
      set({ error: `Could not open log folder: ${err.message}` });
    }
  },

  refreshThumbStats: async () => {
    const thumbStats = await fsService.getThumbStats();
    set({ thumbStats });
  },

  setThumbMaxSize: async (maxCacheMb: number) => {
    const thumbStats = await fsService.setThumbMaxSize(maxCacheMb);
    set({ thumbStats, statusMessage: `Updated max thumbnail cache to ${thumbStats.maxCacheMb ?? maxCacheMb} MB` });
  },

  clearThumbCache: async () => {
    const thumbStats = await fsService.clearThumbCache();
    set({ thumbStats, statusMessage: 'Cleared thumbnail disk cache' });
  },

  refreshFolderSizeStats: async () => {
    const folderSizeStats = await fsService.getFolderSizeStats();
    set({ folderSizeStats });
  },

  clearFolderSizeCache: async () => {
    const folderSizeStats = await fsService.clearFolderSizes();
    set({ folderSizeStats, statusMessage: 'Purged folder size database' });
    await get().refresh();
  },

  rescanCurrentFolderSizes: async () => {
    const { currentPath } = get();
    if (!currentPath) return;
    const folderSizeStats = await fsService.rescanFolderSizes(currentPath);
    set({ folderSizeStats, statusMessage: 'Rescanning folder sizes in current directory...' });
    await get().refresh();
  },

  navigateSidebar: async (targetPath: string) => {
    const s = get();
    if (s.splitView) {
      const target = activeSplitTarget(s);
      if (target) return s.navigateSplitPanel(target.index, targetPath);
    }
    return s.navigateTo(targetPath);
  },

  navigateTo: async (targetPath: string, pushHistory = true, restoreView = false) => {
    // Leaving the current entry for a new one; back/forward capture in goBack/goForward.
    if (pushHistory) get().captureHistoryView();
    // Saved view of the entry we are returning to (back/forward: the new current entry;
    // Up: the latest earlier entry for the same folder).
    let historyView: HistoryViewState | undefined;
    if (restoreView) {
      const { tabs: ts, activeTabId: aid, historyViewStates: hvs } = get();
      const tb = ts.find((t) => t.id === aid);
      if (tb) {
        const want = targetPath.toLowerCase();
        const start = tb.historyIndex;
        const stop = pushHistory ? 0 : start;
        for (let i = start; i >= stop; i--) {
          const v = hvs[`${tb.id}:${i}`];
          if (v && (!pushHistory || v.path.toLowerCase() === want)) {
            historyView = v;
            break;
          }
        }
      }
    }
    set({ isLoading: true, error: null });
    try {
      const res = await fsService.listDirectory(targetPath);
      const git = await fsService.getGitStatus(res.path);
      const custom = get().customTags;

      const enriched: FsEntry[] = res.items.map((item) => ({
        ...item,
        gitStatus: git.statuses[item.name] || undefined,
        tags: inferTags(item, custom),
      }));

      const { tabs, activeTabId } = get();
      const folderName = res.path.split(/[\\/]/).filter(Boolean).pop() || res.path;
      const updatedTabs = tabs.map((t) => {
        if (t.id !== activeTabId) return t;
        if (!pushHistory) {
          return { ...t, path: res.path, title: folderName };
        }
        const nextHistory = t.history.slice(0, t.historyIndex + 1);
        nextHistory.push(res.path);
        // Forward entries are discarded, so drop their saved view state too.
        const prefix = `${t.id}:`;
        const kept: Record<string, HistoryViewState> = {};
        for (const [k, v] of Object.entries(get().historyViewStates)) {
          if (k.startsWith(prefix) && Number(k.slice(prefix.length)) > t.historyIndex) continue;
          kept[k] = v;
        }
        set({ historyViewStates: kept });
        return {
          ...t,
          path: res.path,
          title: folderName,
          history: nextHistory,
          historyIndex: nextHistory.length - 1,
        };
      });

      // Only on entering a folder: refreshes also land here, and must not undo a
      // temporary layout such as the Inspector's jump to the tag view.
      const { currentPath, folderViews } = get();
      const openedFolder = folderViewKey(res.path) !== folderViewKey(currentPath);
      const savedView = openedFolder ? folderViews[folderViewKey(res.path)] : undefined;

      // Uses `set`, not setLayout/setThumbGridSize, so restoring never rewrites saved entries.
      set({
        currentPath: res.path,
        parentPath: res.parentPath,
        items: enriched,
        gitBranch: git.branch,
        gitStatuses: git.statuses,
        tabs: updatedTabs,
        dirVersion: typeof res.version === 'number' ? res.version : get().dirVersion,
        deepSearchResults: null,
        isLoading: false,
        // Applied with currentPath/items in one commit; LayoutsView reads this map in a layout
        // effect keyed on currentPath, so the entry's own offset wins over the per-folder one.
        ...(historyView && {
          folderScrollPositions: (() => {
            const { [res.path]: _drop, ...rest } = get().folderScrollPositions;
            return historyView.scrollTop > 0 ? { ...rest, [res.path]: historyView.scrollTop } : rest;
          })(),
        }),
        // Only the folder view is restored; split view is global and never per folder.
        ...(savedView?.layout && { layout: savedView.layout }),
        ...(savedView?.sortBy && { sortBy: savedView.sortBy, sortAsc: savedView.sortAsc ?? true }),
        ...(openedFolder && { thumbGridSize: savedView?.thumbSize ?? savedThumbGridSize() }),
      });
      if (savedView?.columns) applyColumns(savedView.columns);
      persistSession({ tabs: updatedTabs, activeTabId, layout: get().layout });

      if (get().deepSearch && get().filterQuery.trim()) {
        get().runDeepSearch(get().filterQuery);
      }

      const restoredEntry = historyView?.selectedPath
        ? enriched.find((e) => e.path.toLowerCase() === historyView!.selectedPath!.toLowerCase())
        : undefined;
      if (historyView && restoredEntry) {
        await get().selectEntry(restoredEntry);
        const existing = new Set(enriched.map((e) => e.path.toLowerCase()));
        const paths = historyView.selectedPaths.filter((p) => existing.has(p.toLowerCase()));
        if (paths.length > 1) set({ selectedPaths: paths });
      }

      const prevSelected = get().selectedPath;
      const stillExists =
        !!restoredEntry ||
        !pushHistory &&
        prevSelected &&
        enriched.some((e) => e.path.toLowerCase() === prevSelected.toLowerCase());

      if (!stillExists) {
        if (enriched.length > 0) {
          await get().selectEntry(enriched[0]);
        } else {
          set({ selectedPath: null, selectedPaths: [], preview: null });
        }
      }
      setTimeout(() => {
        get().refreshThumbStats();
        get().refreshFolderSizeStats();
      }, 400);
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  },

  initSplitPanels: async () => {
    const { tabs, activeTabId, currentPath } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    let panels = tab.splitPanels;
    if (!panels) {
      const start = tab.path || currentPath;
      panels = [newSplitPanel(start), newSplitPanel(start)];
      const updatedTabs = tabs.map((t) => (t.id === activeTabId ? { ...t, splitPanels: panels } : t));
      set({ tabs: updatedTabs });
      persistSession({ tabs: updatedTabs, activeTabId });
    }
    await Promise.all([
      get().navigateSplitPanel(0, panels[0].path, false),
      get().navigateSplitPanel(1, panels[1].path, false),
    ]);
  },

  navigateSplitPanel: async (index, targetPath, pushHistory = true) => {
    const tabIdAtStart = get().activeTabId;
    try {
      const res = await fsService.listDirectory(targetPath, false);
      const custom = get().customTags;
      const enriched = res.items.map((item) => ({ ...item, tags: inferTags(item, custom) }));
      const { tabs, activeTabId } = get();
      if (activeTabId !== tabIdAtStart) return; // tab switched while loading
      const updatedTabs = tabs.map((t) => {
        if (t.id !== activeTabId) return t;
        const panels: [SplitPanelState, SplitPanelState] = t.splitPanels
          ? [t.splitPanels[0], t.splitPanels[1]]
          : [newSplitPanel(t.path), newSplitPanel(t.path)];
        const prev = panels[index];
        const samePath = prev.path.toLowerCase() === res.path.toLowerCase();
        let next: SplitPanelState = { ...prev, path: res.path };
        if (pushHistory && !samePath) {
          const history = prev.history.slice(0, prev.historyIndex + 1);
          history.push(res.path);
          next = { ...next, history, historyIndex: history.length - 1 };
        }
        // Keep the selection on refresh if the items still exist; clear it on folder change.
        const existing = new Set(enriched.map((e) => e.path.toLowerCase()));
        const kept = samePath ? prev.selectedPaths.filter((p) => existing.has(p.toLowerCase())) : [];
        next.selectedPaths = kept;
        next.selectedPath =
          samePath && prev.selectedPath && existing.has(prev.selectedPath.toLowerCase())
            ? prev.selectedPath
            : kept[0] ?? null;
        panels[index] = next;
        return { ...t, splitPanels: panels };
      });
      const items: [FsEntry[], FsEntry[]] = [...get().splitPanelItems];
      items[index] = enriched;
      const errors: [string | null, string | null] = [...get().splitPanelErrors];
      errors[index] = null;
      set({ tabs: updatedTabs, splitPanelItems: items, splitPanelErrors: errors });
      persistSession({ tabs: updatedTabs, activeTabId });
    } catch (err: any) {
      const errors: [string | null, string | null] = [...get().splitPanelErrors];
      errors[index] = err.message;
      set({ splitPanelErrors: errors, statusMessage: `Panel ${index + 1}: ${err.message}` });
    }
  },

  splitPanelBack: async (index) => {
    const { tabs, activeTabId } = get();
    const panel = tabs.find((t) => t.id === activeTabId)?.splitPanels?.[index];
    if (!panel || panel.historyIndex <= 0) return;
    const nextIndex = panel.historyIndex - 1;
    set({
      tabs: tabs.map((t) => {
        if (t.id !== activeTabId || !t.splitPanels) return t;
        const panels: [SplitPanelState, SplitPanelState] = [t.splitPanels[0], t.splitPanels[1]];
        panels[index] = { ...panel, historyIndex: nextIndex };
        return { ...t, splitPanels: panels };
      }),
    });
    await get().navigateSplitPanel(index, panel.history[nextIndex], false);
  },

  splitPanelForward: async (index) => {
    const { tabs, activeTabId } = get();
    const panel = tabs.find((t) => t.id === activeTabId)?.splitPanels?.[index];
    if (!panel || panel.historyIndex >= panel.history.length - 1) return;
    const nextIndex = panel.historyIndex + 1;
    set({
      tabs: tabs.map((t) => {
        if (t.id !== activeTabId || !t.splitPanels) return t;
        const panels: [SplitPanelState, SplitPanelState] = [t.splitPanels[0], t.splitPanels[1]];
        panels[index] = { ...panel, historyIndex: nextIndex };
        return { ...t, splitPanels: panels };
      }),
    });
    await get().navigateSplitPanel(index, panel.history[nextIndex], false);
  },

  splitPanelUp: async (index) => {
    const { tabs, activeTabId } = get();
    const panel = tabs.find((t) => t.id === activeTabId)?.splitPanels?.[index];
    const parent = panel ? parentOf(panel.path) : null;
    if (parent) await get().navigateSplitPanel(index, parent, true);
  },

  selectSplitPanelEntry: (index, entry, opts) => {
    const { tabs, activeTabId } = get();
    set({
      tabs: tabs.map((t) => {
        if (t.id !== activeTabId || !t.splitPanels) return t;
        const panels: [SplitPanelState, SplitPanelState] = [t.splitPanels[0], t.splitPanels[1]];
        const prev = panels[index];
        panels[index] = {
          ...prev,
          selectedPath: entry.path,
          selectedPaths: computeSelection(prev.selectedPath, prev.selectedPaths, entry.path, opts),
        };
        return { ...t, splitPanels: panels };
      }),
    });
  },

  setSplitPanelSelection: (index, paths) => {
    const { tabs, activeTabId } = get();
    set({
      tabs: tabs.map((t) => {
        if (t.id !== activeTabId || !t.splitPanels) return t;
        const panels: [SplitPanelState, SplitPanelState] = [t.splitPanels[0], t.splitPanels[1]];
        panels[index] = { ...panels[index], selectedPaths: paths, selectedPath: paths[0] ?? null };
        return { ...t, splitPanels: panels };
      }),
    });
  },

  setActiveSplitPanel: (index) => {
    const { tabs, activeTabId } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab || (tab.activeSplitPanel ?? 0) === index) return;
    set({ tabs: tabs.map((t) => (t.id === activeTabId ? { ...t, activeSplitPanel: index } : t)) });
  },

  addSplitPaneTab: async (index, path) => {
    const { tabs, activeTabId } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    const panel = tab?.splitPanels?.[index];
    if (!tab || !panel) return;
    const { tabs: paneTabs } = withPaneTabs(panel);
    const id = `pt-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const start = path ?? panel.path;
    const fresh: SplitPanelState = { ...newSplitPanel(start), paneTabs: [...paneTabs, snapshotPaneTab(id, newSplitPanel(start))], activePaneTabId: id };
    const updated = tabs.map((t) => {
      if (t.id !== activeTabId || !t.splitPanels) return t;
      const panels: [SplitPanelState, SplitPanelState] = [t.splitPanels[0], t.splitPanels[1]];
      panels[index] = fresh;
      return { ...t, splitPanels: panels, activeSplitPanel: index };
    });
    set({ tabs: updated });
    persistSession({ tabs: updated, activeTabId });
    await get().navigateSplitPanel(index, start, false);
  },

  switchSplitPaneTab: async (index, tabId) => {
    const { tabs, activeTabId } = get();
    const panel = tabs.find((t) => t.id === activeTabId)?.splitPanels?.[index];
    if (!panel || (panel.activePaneTabId ?? 'pt-0') === tabId) return;
    const { tabs: paneTabs } = withPaneTabs(panel);
    const target = paneTabs.find((t) => t.id === tabId);
    if (!target) return;
    const next: SplitPanelState = { ...target, paneTabs, activePaneTabId: tabId };
    const updated = tabs.map((t) => {
      if (t.id !== activeTabId || !t.splitPanels) return t;
      const panels: [SplitPanelState, SplitPanelState] = [t.splitPanels[0], t.splitPanels[1]];
      panels[index] = next;
      return { ...t, splitPanels: panels, activeSplitPanel: index };
    });
    set({ tabs: updated });
    persistSession({ tabs: updated, activeTabId });
    await get().navigateSplitPanel(index, target.path, false);
  },

  closeSplitPaneTab: async (index, tabId) => {
    const { tabs, activeTabId } = get();
    const panel = tabs.find((t) => t.id === activeTabId)?.splitPanels?.[index];
    if (!panel) return;
    const { tabs: paneTabs, activeId } = withPaneTabs(panel);
    if (paneTabs.length <= 1) return; // a pane always keeps one tab
    const pos = paneTabs.findIndex((t) => t.id === tabId);
    if (pos < 0) return;
    const remaining = paneTabs.filter((t) => t.id !== tabId);
    if (tabId !== activeId) {
      const updated = tabs.map((t) => {
        if (t.id !== activeTabId || !t.splitPanels) return t;
        const panels: [SplitPanelState, SplitPanelState] = [t.splitPanels[0], t.splitPanels[1]];
        panels[index] = { ...panel, paneTabs: remaining, activePaneTabId: activeId };
        return { ...t, splitPanels: panels };
      });
      set({ tabs: updated });
      persistSession({ tabs: updated, activeTabId });
      return;
    }
    const neighbor = remaining[Math.min(pos, remaining.length - 1)];
    const next: SplitPanelState = { ...neighbor, paneTabs: remaining, activePaneTabId: neighbor.id };
    const updated = tabs.map((t) => {
      if (t.id !== activeTabId || !t.splitPanels) return t;
      const panels: [SplitPanelState, SplitPanelState] = [t.splitPanels[0], t.splitPanels[1]];
      panels[index] = next;
      return { ...t, splitPanels: panels };
    });
    set({ tabs: updated });
    persistSession({ tabs: updated, activeTabId });
    await get().navigateSplitPanel(index, neighbor.path, false);
  },

  reorderSplitPaneTabs: (index, fromId, toId) => {
    if (fromId === toId) return;
    const { tabs, activeTabId } = get();
    const panel = tabs.find((t) => t.id === activeTabId)?.splitPanels?.[index];
    if (!panel) return;
    const { tabs: paneTabs, activeId } = withPaneTabs(panel);
    const fromIdx = paneTabs.findIndex((t) => t.id === fromId);
    const toIdx = paneTabs.findIndex((t) => t.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const reordered = [...paneTabs];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    const updated = tabs.map((t) => {
      if (t.id !== activeTabId || !t.splitPanels) return t;
      const panels: [SplitPanelState, SplitPanelState] = [t.splitPanels[0], t.splitPanels[1]];
      panels[index] = { ...panel, paneTabs: reordered, activePaneTabId: activeId };
      return { ...t, splitPanels: panels };
    });
    set({ tabs: updated });
    persistSession({ tabs: updated, activeTabId });
  },

  splitNavigateHistory: (dir) => {
    const target = activeSplitTarget(get());
    if (!target) return false;
    const s = get();
    if (dir === 'back') void s.splitPanelBack(target.index);
    else if (dir === 'forward') void s.splitPanelForward(target.index);
    else void s.splitPanelUp(target.index);
    return true;
  },

  splitMoveSelection: (to, shift) => {
    const s = get();
    const target = activeSplitTarget(s);
    if (!target) return false;
    const rows = visibleSplitItems(s.splitPanelItems[target.index], s.showHiddenFiles, s.splitPanelSorts[target.index].sortBy, s.splitPanelSorts[target.index].sortAsc);
    if (rows.length === 0) return true;
    const cur = rows.findIndex((r) => r.path === target.panel.selectedPath);
    let next = 0;
    if (to === 'next') next = cur < 0 ? 0 : Math.min(rows.length - 1, cur + 1);
    else if (to === 'prev') next = cur <= 0 ? 0 : cur - 1;
    else if (to === 'last') next = rows.length - 1;
    s.selectSplitPanelEntry(target.index, rows[next], { shift, orderedPaths: rows.map((r) => r.path) });
    return true;
  },

  splitSelectAll: () => {
    const s = get();
    const target = activeSplitTarget(s);
    if (!target) return false;
    const rows = visibleSplitItems(s.splitPanelItems[target.index], s.showHiddenFiles, s.splitPanelSorts[target.index].sortBy, s.splitPanelSorts[target.index].sortAsc);
    if (rows.length > 0) {
      s.setSplitPanelSelection(target.index, rows.map((r) => r.path));
      set({ statusMessage: `Selected ${rows.length} items` });
    }
    return true;
  },

  splitOpenSelected: () => {
    const s = get();
    const target = activeSplitTarget(s);
    if (!target) return false;
    const entry = s.splitPanelItems[target.index].find((r) => r.path === target.panel.selectedPath);
    if (entry) {
      if (entry.isDirectory) void s.navigateSplitPanel(target.index, entry.path, true);
      else void s.openEntry(entry);
    }
    return true;
  },

  bridgeSplitSelection: () => {
    const target = activeSplitTarget(get());
    if (!target) return false;
    set({ selectedPath: target.panel.selectedPath, selectedPaths: target.panel.selectedPaths });
    return true;
  },

  goBack: async () => {
    const { tabs, activeTabId } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab || tab.historyIndex <= 0) return;
    const nextIndex = tab.historyIndex - 1;
    const targetPath = tab.history[nextIndex];
    get().captureHistoryView();
    set({
      tabs: tabs.map((t) => (t.id === activeTabId ? { ...t, historyIndex: nextIndex } : t)),
    });
    await get().navigateTo(targetPath, false, true);
  },

  goForward: async () => {
    const { tabs, activeTabId } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab || tab.historyIndex >= tab.history.length - 1) return;
    const nextIndex = tab.historyIndex + 1;
    const targetPath = tab.history[nextIndex];
    get().captureHistoryView();
    set({
      tabs: tabs.map((t) => (t.id === activeTabId ? { ...t, historyIndex: nextIndex } : t)),
    });
    await get().navigateTo(targetPath, false, true);
  },

  goUp: async () => {
    const { parentPath } = get();
    if (parentPath) {
      await get().navigateTo(parentPath, true, true);
    }
  },

  refresh: async () => {
    const { currentPath } = get();
    if (currentPath) await get().navigateTo(currentPath, false);
    if (get().splitView) await get().initSplitPanels();
    await get().refreshThumbStats();
  },

  selectEntry: async (entry: FsEntry, opts) => {
    const { selectedPath, selectedPaths } = get();
    let nextSelectedPaths = [entry.path];

    if (opts?.shift && selectedPath && opts.orderedPaths && opts.orderedPaths.length > 0) {
      const startIdx = opts.orderedPaths.indexOf(selectedPath);
      const endIdx = opts.orderedPaths.indexOf(entry.path);
      if (startIdx !== -1 && endIdx !== -1) {
        const low = Math.min(startIdx, endIdx);
        const high = Math.max(startIdx, endIdx);
        nextSelectedPaths = opts.orderedPaths.slice(low, high + 1);
      }
    } else if (opts?.ctrl) {
      if (selectedPaths.includes(entry.path)) {
        const filtered = selectedPaths.filter((p) => p !== entry.path);
        nextSelectedPaths = filtered.length > 0 ? filtered : [entry.path];
      } else {
        nextSelectedPaths = [...selectedPaths, entry.path];
      }
    }

    set({
      selectedPath: entry.path,
      selectedPaths: nextSelectedPaths,
    });

    try {
      const preview = await fsService.readPreview(entry.path);
      set({ preview });
      get().refreshThumbStats();
    } catch {
      set({ preview: { kind: 'empty', message: 'Preview unavailable' } });
    }
  },

  selectAll: (paths: string[]) => {
    if (paths.length === 0) return;
    set({
      selectedPaths: paths,
      selectedPath: paths[0],
      statusMessage: `Selected ${paths.length} items`,
    });
  },

  copyToClipboard: () => {
    const paths = effectiveTargets(get());
    if (paths.length === 0) return;
    set({
      clipboard: { paths, mode: 'copy' },
      statusMessage: `Copied ${paths.length} item${paths.length === 1 ? '' : 's'} to clipboard`,
    });
  },

  cutToClipboard: () => {
    const paths = effectiveTargets(get());
    if (paths.length === 0) return;
    set({
      clipboard: { paths, mode: 'cut' },
      statusMessage: `Cut ${paths.length} item${paths.length === 1 ? '' : 's'} to clipboard`,
    });
  },

  pasteClipboard: async (targetDir?: string, viaRemote = false) => {
    const { clipboard, currentPath } = get();
    const destDir = targetDir || activeSplitTarget(get())?.panel.path || currentPath;
    if (!clipboard || clipboard.paths.length === 0 || !destDir) return;

    const count = clipboard.paths.length;
    const plural = count === 1 ? '' : 's';
    if (clipboard.mode === 'copy') {
      await copyItemsTo(clipboard.paths, destDir, `Pasted ${count} copied item${plural}`, viaRemote);
    } else {
      const unmoved = await moveItemsTo(clipboard.paths, destDir, `Moved ${count} item${plural}`, viaRemote);
      // Leave the clipboard alone if the user cut or copied something else while this was running.
      if (get().clipboard === clipboard) {
        set({ clipboard: unmoved.length > 0 ? { paths: unmoved, mode: 'cut' } : null });
      }
    }
    await get().refresh();
  },

  undoLastOperation: async () => {
    const { undoStack } = get();
    if (undoStack.length === 0) {
      set({ statusMessage: 'Nothing to undo' });
      return;
    }
    const last = undoStack[undoStack.length - 1];
    const nextStack = undoStack.slice(0, -1);

    try {
      if (last.kind === 'rename') {
        await fsService.renameItem(last.currentPath, last.oldName);
        set({ undoStack: nextStack, statusMessage: `Undid rename to "${last.oldName}"` });
      } else if (last.kind === 'move') {
        for (const m of last.moves) {
          await fsService.moveItem(m.currentPath, m.originalDir);
        }
        set({ undoStack: nextStack, statusMessage: `Undid move of ${last.moves.length} item(s)` });
      } else if (last.kind === 'copy') {
        for (const p of last.createdPaths) {
          await fsService.deleteItem(p, true);
        }
        set({ undoStack: nextStack, statusMessage: `Undid paste of ${last.createdPaths.length} item(s)` });
      } else if (last.kind === 'create') {
        await fsService.deleteItem(last.createdPath, true);
        set({ undoStack: nextStack, statusMessage: `Undid creation` });
      }
      await get().refresh();
    } catch (err: any) {
      set({ statusMessage: `Undo failed: ${err.message}` });
    }
  },

  openEntry: async (entry: FsEntry) => {
    if (entry.isDirectory) {
      await get().navigateTo(entry.path, true);
    } else {
      await fsService.openFile(entry.path);
      set({ statusMessage: `Opened "${entry.name}"` });
    }
  },

  revealInExplorer: async (path?: string) => {
    const target = path || get().selectedPath || get().currentPath;
    if (!target) return;
    await fsService.revealInExplorer(target);
    set({ statusMessage: `Revealed in Windows Explorer` });
  },

  openContextMenu: (x, y, entry) => {
    if (entry && !get().selectedPaths.includes(entry.path)) {
      get().selectEntry(entry);
    }
    set({ contextMenu: { x, y, entry } });
  },

  openSplitPanelContextMenu: (index, x, y, entry) => {
    const s = get();
    s.setActiveSplitPanel(index);
    const panel = s.tabs.find((t) => t.id === s.activeTabId)?.splitPanels?.[index];
    // Like the details view: keep a multi-selection if the row is already in it, else select just this row.
    if (!panel?.selectedPaths.includes(entry.path)) {
      s.selectSplitPanelEntry(index, entry);
    }
    set({ contextMenu: { x, y, entry } });
  },

  closeContextMenu: () => {
    set({ contextMenu: null });
  },

  addTab: async (path?: string) => {
    const target = path || get().currentPath || get().homeDir;
    const id = `tab-${Date.now()}`;
    const folderName = target.split(/[\\/]/).filter(Boolean).pop() || target;
    const newTab: ExplorerTab = {
      id,
      title: folderName,
      path: target,
      history: [target],
      historyIndex: 0,
    };
    const nextTabs = [...get().tabs, newTab];
    set({ tabs: nextTabs, activeTabId: id });
    persistSession({ tabs: nextTabs, activeTabId: id });
    await get().navigateTo(target, false);
  },

  closeTab: (id: string) => {
    const { tabs, activeTabId } = get();
    if (tabs.length <= 1) return;
    const filtered = tabs.filter((t) => t.id !== id);
    if (id === activeTabId) {
      const nextTab = filtered[filtered.length - 1];
      set({ tabs: filtered, activeTabId: nextTab.id });
      persistSession({ tabs: filtered, activeTabId: nextTab.id });
      get().navigateTo(nextTab.path, false);
    } else {
      set({ tabs: filtered });
      persistSession({ tabs: filtered });
    }
  },

  switchTab: async (id: string) => {
    const tab = get().tabs.find((t) => t.id === id);
    if (!tab) return;
    set({ activeTabId: id });
    persistSession({ activeTabId: id });
    await get().navigateTo(tab.path, false);
  },

  reorderTabs: (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const { tabs } = get();
    const fromIdx = tabs.findIndex((t) => t.id === fromId);
    const toIdx = tabs.findIndex((t) => t.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const nextTabs = [...tabs];
    const [moved] = nextTabs.splice(fromIdx, 1);
    nextTabs.splice(toIdx, 0, moved);
    set({ tabs: nextTabs });
    persistSession({ tabs: nextTabs });
  },

  setLayout: (layout, opts) => {
    const { currentPath, folderViews, thumbGridSize } = get();
    if (currentPath && opts?.saveForFolder !== false) {
      const style = layout === 'thumbnails' ? { layout, thumbSize: thumbGridSize } : { layout };
      set({ folderViews: persistFolderView(folderViews, currentPath, style) });
    }
    set({ layout, splitView: false });
    persistSession({ layout, splitView: false });
  },
  setSplitView: (on) => {
    if (on === get().splitView) return;
    set({ splitView: on });
    persistSession({ splitView: on });
  },
  toggleSplitView: () => get().setSplitView(!get().splitView),
  setExtensionIcon: (ext, icon, color) => {
    const key = ext.trim().replace(/^\.+/, '').toLowerCase();
    if (!key) return;
    const next = { ...get().extensionIcons, [key]: { icon, color } };
    set({ extensionIcons: next });
    persistExtensionIcons(next);
  },
  resetExtensionIcon: (ext) => {
    const key = ext.trim().replace(/^\.+/, '').toLowerCase();
    const { [key]: _removed, ...rest } = get().extensionIcons;
    set({ extensionIcons: rest });
    persistExtensionIcons(rest);
  },
  setThemePreference: (theme) => {
    if (theme === get().themePreference) return;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {}
    set({ themePreference: theme });
  },

  setThumbGridSize: (size) => {
    const clamped = Math.max(40, Math.min(240, Math.round(size)));
    const { thumbGridSize, currentPath, layout, folderViews } = get();
    if (clamped === thumbGridSize) return;
    logger.action('thumbnail size changed', { from: thumbGridSize, to: clamped });
    try {
      localStorage.setItem('rook_thumb_grid_size', String(clamped));
    } catch {}
    set({
      thumbGridSize: clamped,
      folderViews: currentPath
        ? persistFolderView(folderViews, currentPath, { layout, thumbSize: clamped })
        : folderViews,
    });
  },
  setSortBy: (sortBy) => {
    const sortAsc = get().sortBy === sortBy ? !get().sortAsc : true;
    const { currentPath, folderViews } = get();
    set({
      sortBy,
      sortAsc,
      ...(currentPath && { folderViews: persistFolderView(folderViews, currentPath, { sortBy, sortAsc }) }),
    });
    persistSession({ sortBy, sortAsc });
  },
  toggleSortAsc: () => {
    const sortAsc = !get().sortAsc;
    const { currentPath, folderViews, sortBy } = get();
    set({
      sortAsc,
      ...(currentPath && { folderViews: persistFolderView(folderViews, currentPath, { sortBy, sortAsc }) }),
    });
    persistSession({ sortAsc });
  },
  setFilterQuery: (filterQuery) => {
    set({ filterQuery });
    if (get().deepSearch) {
      if (filterQuery.trim() === '') {
        set({ deepSearchResults: null, isSearching: false });
      } else {
        get().runDeepSearch(filterQuery);
      }
    }
  },
  toggleDeepSearch: () => {
    const next = !get().deepSearch;
    set({ deepSearch: next, deepSearchResults: null });
    if (next && get().filterQuery.trim() !== '') {
      get().runDeepSearch(get().filterQuery);
    }
  },
  runDeepSearch: async (queryOverride?: string) => {
    const q = (queryOverride ?? get().filterQuery).trim();
    const { currentPath, customTags } = get();
    if (!q || !currentPath) {
      set({ deepSearchResults: null, isSearching: false });
      return;
    }
    set({ isSearching: true });
    try {
      const res = await fsService.searchDirectory(currentPath, q);
      const enriched = res.items.map((item) => ({
        ...item,
        tags: inferTags(item, customTags),
      }));
      set({ deepSearchResults: enriched, isSearching: false });
    } catch {
      set({ isSearching: false });
    }
  },
  checkDirWatcher: async () => {
    const { currentPath, isLoading, dirVersion, folderSizeStats } = get();
    if (!currentPath || isLoading) return;
    const { version } = await fsService.getDirVersion();
    if (version > dirVersion) {
      set({ dirVersion: version });
      await get().refresh();
    } else if (folderSizeStats.pendingScans > 0) {
      await get().refreshFolderSizeStats();
    }
  },
  hideDrive: (drive: string) => {
    const { hiddenDrives } = get();
    if (hiddenDrives.some((d) => sameDrive(d, drive))) return;
    const next = [...hiddenDrives, drive];
    try {
      localStorage.setItem(HIDDEN_DRIVES_KEY, JSON.stringify(next));
    } catch {}
    set({ hiddenDrives: next });
  },
  unhideDrive: (drive: string) => {
    const next = get().hiddenDrives.filter((d) => !sameDrive(d, drive));
    try {
      localStorage.setItem(HIDDEN_DRIVES_KEY, JSON.stringify(next));
    } catch {}
    set({ hiddenDrives: next });
  },
  loadSshConnections: async () => {
    try {
      const connections = await fsService.sshList();
      set({ sshConnections: connections });
      // Hosts that already have a live session can be refreshed without opening new connections.
      for (const c of connections) if (c.connected) void get().loadSshDrives(c.id);
    } catch {
      // Not available under the Vite dev server or legacy shells.
      set({ sshConnections: [] });
    }
  },
  addSshConnection: async (req: SshAddRequest) => {
    const conn = await fsService.sshAdd(req);
    set({
      sshConnections: [...get().sshConnections, conn],
      statusMessage: `Added SSH host ${conn.label || conn.target}`,
    });
    return conn;
  },
  removeSshConnection: async (id: string) => {
    const conn = get().sshConnections.find((c) => c.id === id);
    await fsService.sshRemove(id);
    const { [id]: _dropped, ...remainingDrives } = get().sshDrives;
    persistSshDrives(remainingDrives);
    set({
      sshDrives: remainingDrives,
      sshConnections: get().sshConnections.filter((c) => c.id !== id),
      statusMessage: conn ? `Removed SSH host ${conn.label || conn.target}` : 'Removed SSH host',
    });
  },
  testSshConnection: async (id: string) => {
    const res = await fsService.sshConnect(id);
    set({
      sshConnections: get().sshConnections.map((c) => (c.id === id ? res.connection : c)),
      statusMessage: `Connected to ${res.connection.label || res.connection.target}`,
    });
    void get().loadSshDrives(id);
    return res;
  },
  loadSshDrives: async (id: string) => {
    try {
      const drives = await fsService.sshDrives(id);
      // The host may have been removed while the request was in flight.
      if (!get().sshConnections.some((c) => c.id === id)) return;
      const next = { ...get().sshDrives, [id]: drives };
      persistSshDrives(next);
      set({
        sshDrives: next,
        sshConnections: get().sshConnections.map((c) => (c.id === id ? { ...c, connected: true } : c)),
      });
    } catch {
      // Unreachable host or no mount table: keep whatever was listed before.
    }
  },
  openSshHost: async (id: string, at: 'home' | 'root' | { path: string } = 'home') => {
    const conn = get().sshConnections.find((c) => c.id === id);
    const name = conn ? conn.label || conn.target : 'SSH host';
    set({ statusMessage: `Connecting to ${name}...` });
    try {
      const res = await fsService.sshConnect(id);
      set({ sshConnections: get().sshConnections.map((c) => (c.id === id ? res.connection : c)) });
      // Not awaited: a slow or stale mount on the remote must not hold up navigation.
      void get().loadSshDrives(id);
      await get().navigateSidebar(
        at === 'root' ? res.connection.rootPath : at === 'home' ? res.homePath : at.path
      );
      set({ statusMessage: `Connected to ${name}` });
    } catch (err: any) {
      set({ statusMessage: `Could not connect to ${name}: ${err?.message || err}` });
    }
  },
  disconnectSsh: async (id: string) => {
    try {
      await fsService.sshDisconnect(id);
    } catch {}
    set({ sshConnections: get().sshConnections.map((c) => (c.id === id ? { ...c, connected: false } : c)) });
  },
  resetSshHostKey: async (id: string) => {
    await fsService.sshResetHostKey(id);
    set({
      sshConnections: get().sshConnections.map((c) =>
        c.id === id ? { ...c, hostKeyFingerprint: null, connected: false } : c
      ),
      statusMessage: 'Host key cleared; it will be trusted again on the next connect',
    });
  },
  reorderSidebarSections: (order: SidebarSectionId[]) => {
    localStorage.setItem('rook_sidebar_section_order_v1', JSON.stringify(order));
    set({
      sidebarSectionOrder: order,
      statusMessage: 'Reordered sidebar sections',
    });
  },
  reorderQuickAccessFolders: (folders: QuickAccessFolder[]) => {
    localStorage.setItem('rook_quick_access_v1', JSON.stringify(folders));
    set({
      pinnedFolders: folders,
      statusMessage: 'Reordered Quick Access',
    });
  },
  reorderWorkflows: (workflows: Workflow[]) => {
    localStorage.setItem('rook_workflows_v1', JSON.stringify(workflows));
    set({
      workflows,
      statusMessage: 'Reordered Workflows',
    });
  },
  togglePinFolder: (folderPath?: string) => {
    const { currentPath, pinnedFolders } = get();
    const targetPath = (folderPath || currentPath).replace(/[\\/]+$/, '');
    if (!targetPath) return;

    const existing = pinnedFolders.find(
      (p) => p.path.toLowerCase() === targetPath.toLowerCase()
    );

    if (existing) {
      const next = pinnedFolders.filter((p) => p.id !== existing.id);
      localStorage.setItem('rook_quick_access_v1', JSON.stringify(next));
      set({
        pinnedFolders: next,
        statusMessage: `Unpinned "${existing.label}" from Quick Access`,
      });
      return;
    }

    const folderName = targetPath.split(/[\\/]/).filter(Boolean).pop() || targetPath;
    const newPin: QuickAccessFolder = {
      id: `qa-${Date.now()}`,
      label: folderName,
      path: targetPath,
      icon: 'folder',
      iconColor: '#94a3b8',
    };

    const next = [...pinnedFolders, newPin];
    localStorage.setItem('rook_quick_access_v1', JSON.stringify(next));
    set({
      pinnedFolders: next,
      statusMessage: `Pinned "${folderName}" to Quick Access`,
    });
  },
  pinQuickAccessFolder: (folderPath?: string, label?: string) => {
    const { currentPath, pinnedFolders } = get();
    const targetPath = (folderPath || currentPath).replace(/[\\/]+$/, '');
    if (!targetPath) return;

    const folderName = label || targetPath.split(/[\\/]/).filter(Boolean).pop() || targetPath;
    const filtered = pinnedFolders.filter((p) => p.path.toLowerCase() !== targetPath.toLowerCase());
    const newPin: QuickAccessFolder = {
      id: `qa-${Date.now()}`,
      label: folderName,
      path: targetPath,
      icon: 'folder',
      iconColor: '#94a3b8',
    };

    const next = [...filtered, newPin];
    localStorage.setItem('rook_quick_access_v1', JSON.stringify(next));
    set({
      pinnedFolders: next,
      statusMessage: `Pinned "${folderName}" to Quick Access`,
    });
  },
  unpinQuickAccessFolder: (id: string) => {
    const current = get().pinnedFolders;
    const target = current.find((p) => p.id === id);
    const next = current.filter((p) => p.id !== id);
    localStorage.setItem('rook_quick_access_v1', JSON.stringify(next));
    set({
      pinnedFolders: next,
      statusMessage: target ? `Unpinned "${target.label}" from Quick Access` : 'Unpinned from Quick Access',
    });
  },
  renameQuickAccessFolder: (id: string, newLabel: string) => {
    const trimmed = newLabel.trim();
    if (!trimmed) return;
    const current = get().pinnedFolders;
    const next = current.map((p) => (p.id === id ? { ...p, label: trimmed } : p));
    localStorage.setItem('rook_quick_access_v1', JSON.stringify(next));
    set({
      pinnedFolders: next,
      statusMessage: `Renamed Quick Access entry to "${trimmed}"`,
    });
  },
  updateQuickAccessFolderStyle: (id: string, icon: string, iconColor: string) => {
    const current = get().pinnedFolders;
    const next = current.map((p) =>
      p.id === id ? { ...p, icon, iconColor } : p
    );
    localStorage.setItem('rook_quick_access_v1', JSON.stringify(next));
    set({
      pinnedFolders: next,
      statusMessage: `Updated Quick Access icon`,
    });
  },
  pinWorkflow: (customLabel?: string) => {
    const {
      currentPath,
      tabs,
      activeTabId,
      layout: folderLayout,
      splitView,
      sortBy,
      sortAsc,
      showInspector,
      showHiddenFiles,
      workflows,
    } = get();
    // What's on screen, for the default label and icon. The workflow itself stores the folder
    // layout and the split-view flag separately.
    const layout: LayoutMode = splitView ? 'split' : folderLayout;

    const rootPath = (currentPath || tabs[0]?.path || 'C:\\').replace(/[\\/]+$/, '');
    const folderName = rootPath.split(/[\\/]/).filter(Boolean).pop() || rootPath;
    const layoutShort =
      layout === 'split'
        ? 'Split'
        : layout === 'command'
          ? 'Fuzzy'
          : layout === 'thumbnails'
            ? 'Thumbnails'
            : 'Workspace';

    const defaultLabel = customLabel || `${folderName} (${layoutShort})`;

    let visibleCols: PinnedWorkspace['visibleCols'];
    let colWidths: PinnedWorkspace['colWidths'];
    try {
      const rawVis = localStorage.getItem('rook_visible_columns');
      if (rawVis) visibleCols = JSON.parse(rawVis);
      const rawWidths = localStorage.getItem('rook_column_widths');
      if (rawWidths) colWidths = JSON.parse(rawWidths);
    } catch {}

    const iconMap: Record<LayoutMode, { icon: string; color: string }> = {
      workspace: { icon: 'crown', color: '#38bdf8' },
      split: { icon: 'columns', color: '#14b8a6' },
      command: { icon: 'zoom', color: '#f43f5e' },
      thumbnails: { icon: 'file_image', color: '#ec4899' },
    };

    const iconInfo = iconMap[layout] || { icon: 'crown', color: '#38bdf8' };

    // Tabs carry their split panels (which folder is in which panel, with history and pane
    // tabs), so the split configuration is saved whether or not split view is showing.
    const snapshotTabs: ExplorerTab[] = tabs.map(cloneWorkflowTab);

    const newWf: Workflow = {
      id: `wf-${Date.now()}`,
      label: defaultLabel,
      path: rootPath,
      icon: iconInfo.icon,
      iconColor: iconInfo.color,
      tabs: snapshotTabs,
      activeTabId,
      layout: folderLayout,
      splitView,
      sortBy,
      sortAsc,
      showInspector,
      showHiddenFiles,
      visibleCols,
      colWidths,
    };

    const next = [...workflows, newWf];
    localStorage.setItem('rook_workflows_v1', JSON.stringify(next));
    set({
      workflows: next,
      statusMessage: `Saved workflow "${defaultLabel}" (${snapshotTabs.length} tab${
        snapshotTabs.length === 1 ? '' : 's'
      }, ${layoutShort} layout)`,
    });
  },
  unpinWorkflow: (id: string) => {
    const current = get().workflows;
    const target = current.find((p) => p.id === id);
    const next = current.filter((p) => p.id !== id);
    localStorage.setItem('rook_workflows_v1', JSON.stringify(next));
    set({
      workflows: next,
      statusMessage: target ? `Removed workflow "${target.label}"` : 'Removed workflow',
    });
  },
  renameWorkflow: (id: string, newLabel: string) => {
    const trimmed = newLabel.trim();
    if (!trimmed) return;
    const current = get().workflows;
    const next = current.map((p) => (p.id === id ? { ...p, label: trimmed } : p));
    localStorage.setItem('rook_workflows_v1', JSON.stringify(next));
    set({
      workflows: next,
      statusMessage: `Renamed workflow to "${trimmed}"`,
    });
  },
  updateWorkflowStyle: (id: string, icon: string, iconColor: string) => {
    const current = get().workflows;
    const next = current.map((p) =>
      p.id === id ? { ...p, icon, iconColor } : p
    );
    localStorage.setItem('rook_workflows_v1', JSON.stringify(next));
    set({
      workflows: next,
      statusMessage: `Updated workflow icon`,
    });
  },
  loadWorkflow: async (wf: Workflow) => {
    const restoredTabs: ExplorerTab[] =
      Array.isArray(wf.tabs) && wf.tabs.length > 0
        ? wf.tabs.map(cloneWorkflowTab)
        : [
            {
              id: `tab-${Date.now()}`,
              title: wf.label,
              path: wf.path,
              history: [wf.path],
              historyIndex: 0,
            },
          ];

    const restoredActiveId = restoredTabs.some((t) => t.id === wf.activeTabId)
      ? wf.activeTabId
      : restoredTabs[0].id;
    const activeTab = restoredTabs.find((t) => t.id === restoredActiveId) || restoredTabs[0];

    // A folder's saved style beats the workflow's layout, as in normal navigation. Applied
    // here too because navigateTo skips restore when the workflow opens the folder on screen.
    const savedView = get().folderViews[folderViewKey(activeTab.path)];
    // Split view comes from the workflow only; a folder's saved style never sets it.
    const wfView = splitLayoutMode(wf.layout as LayoutMode);
    const nextLayout = savedView?.layout || wfView.layout || get().layout;
    const nextSplitView = wf.splitView ?? wfView.splitView ?? false;
    const nextThumbGridSize = savedView?.thumbSize ?? savedThumbGridSize();
    const nextSortBy = savedView?.sortBy ?? wf.sortBy ?? get().sortBy;
    const nextSortAsc = savedView?.sortBy
      ? savedView.sortAsc ?? true
      : wf.sortAsc ?? get().sortAsc;
    const nextShowInspector = wf.showInspector ?? get().showInspector;
    const nextShowHidden = wf.showHiddenFiles ?? get().showHiddenFiles;

    if (wf.visibleCols) {
      try {
        localStorage.setItem('rook_visible_columns', JSON.stringify(wf.visibleCols));
      } catch {}
    }
    if (wf.colWidths) {
      try {
        localStorage.setItem('rook_column_widths', JSON.stringify(wf.colWidths));
      } catch {}
    }
    if (wf.visibleCols || wf.colWidths) {
      window.dispatchEvent(new CustomEvent('rook-columns-restored'));
    }

    set({
      tabs: restoredTabs,
      activeTabId: restoredActiveId,
      layout: nextLayout,
      splitView: nextSplitView,
      thumbGridSize: nextThumbGridSize,
      sortBy: nextSortBy,
      sortAsc: nextSortAsc,
      showInspector: nextShowInspector,
      showHiddenFiles: nextShowHidden,
      statusMessage: `Loaded workflow "${wf.label}" (${restoredTabs.length} tab${
        restoredTabs.length === 1 ? '' : 's'
      }, ${nextSplitView ? 'split' : nextLayout} layout)`,
    });

    persistSession({
      tabs: restoredTabs,
      activeTabId: restoredActiveId,
      layout: nextLayout,
      splitView: nextSplitView,
      sortBy: nextSortBy,
      sortAsc: nextSortAsc,
      showInspector: nextShowInspector,
      showHiddenFiles: nextShowHidden,
    });

    await get().navigateTo(activeTab.path, false);
    // In split view the panels are what's on screen. Tabs saved with panels get them back; a
    // tab without any starts both panels at the workflow's path (activeTab.path).
    if (nextSplitView) {
      await get().initSplitPanels();
    }
  },
  unpinWorkspace: (id: string) => {
    if (get().workflows.some((w) => w.id === id)) {
      get().unpinWorkflow(id);
    } else {
      get().unpinQuickAccessFolder(id);
    }
  },
  renamePinnedWorkspace: (id: string, newLabel: string) => {
    if (get().workflows.some((w) => w.id === id)) {
      get().renameWorkflow(id, newLabel);
    } else {
      get().renameQuickAccessFolder(id, newLabel);
    }
  },
  updatePinnedWorkspaceStyle: (id: string, icon: string, iconColor: string) => {
    if (get().workflows.some((w) => w.id === id)) {
      get().updateWorkflowStyle(id, icon, iconColor);
    } else {
      get().updateQuickAccessFolderStyle(id, icon, iconColor);
    }
  },
  loadPinnedWorkspace: async (pin: PinnedWorkspace) => {
    await get().loadWorkflow(pin);
  },
  toggleSidebar: () => {
    const next = !get().showSidebar;
    set({ showSidebar: next });
    persistSession({ showSidebar: next });
  },
  toggleInspector: () => {
    const next = !get().showInspector;
    set({ showInspector: next });
    persistSession({ showInspector: next });
  },
  toggleTerminal: () => set((s) => ({ showTerminal: !s.showTerminal })),
  toggleQuickLookModal: () => set((s) => ({ showQuickLookModal: !s.showQuickLookModal })),
  toggleOptionsModal: () => set((s) => ({ showOptionsModal: !s.showOptionsModal })),
  openOptionsTo: (category: OptionsCategory) => set({ showOptionsModal: true, optionsInitialCategory: category }),
  clearOptionsInitialCategory: () => set({ optionsInitialCategory: null }),
  toggleHiddenFiles: () => {
    const next = !get().showHiddenFiles;
    set({ showHiddenFiles: next });
    persistSession({ showHiddenFiles: next });
  },
  setDeletePermanently: (deletePermanently) => set({ deletePermanently }),

  addTagToPath: (path, tag) => {
    const clean = tag.trim().replace(/^#/, '').toLowerCase();
    if (!clean) return;
    const current = get().customTags;
    const targets = get().selectedPaths.includes(path) ? get().selectedPaths : [path];
    const next = { ...current };
    for (const p of targets) {
      const existing = next[p] || [];
      next[p] = Array.from(new Set([...existing, clean]));
    }
    localStorage.setItem('rook_custom_tags', JSON.stringify(next));
    set({ customTags: next, statusMessage: `Added tag #${clean} to ${targets.length} item(s)` });
    get().refresh();
  },

  createNewFolder: async (name: string) => {
    const { currentPath, undoStack } = get();
    const res = await fsService.createDirectory(activeSplitTarget(get())?.panel.path || currentPath, name);
    set({
      undoStack: res.path ? [...undoStack, { kind: 'create', createdPath: res.path }] : undoStack,
      statusMessage: `Created folder "${name}"`,
    });
    await get().refresh();
    if (res.path) {
      set({ selectedPath: res.path, selectedPaths: [res.path] });
    }
  },

  createNewFile: async (name: string) => {
    const { currentPath, undoStack } = get();
    const res = await fsService.createFile(activeSplitTarget(get())?.panel.path || currentPath, name, '');
    set({
      undoStack: res.path ? [...undoStack, { kind: 'create', createdPath: res.path }] : undoStack,
      statusMessage: `Created file "${name}"`,
    });
    await get().refresh();
    if (res.path) {
      set({ selectedPath: res.path, selectedPaths: [res.path] });
    }
  },

  renameSelected: async (newName: string) => {
    const { selectedPath, undoStack } = get();
    if (!selectedPath) return;
    const oldName = selectedPath.split(/[\\/]/).pop() || '';
    const res = await fsService.renameItem(selectedPath, newName);
    set({
      undoStack: res.path ? [...undoStack, { kind: 'rename', currentPath: res.path, oldName }] : undoStack,
      statusMessage: `Renamed to "${newName}"`,
    });
    await get().refresh();
    if (res.path) {
      set({ selectedPath: res.path, selectedPaths: [res.path] });
    }
  },

  openPromptModal: (config) => {
    if (config.kind === 'rename') {
      const path = config.targetPath || config.subtitle || '';
      if (path) {
        set({ inlineRename: { path, name: config.defaultValue, isDirectory: !!config.isDirectory }, contextMenu: null });
        return;
      }
    }
    set({ promptModal: config, contextMenu: null });
  },

  closePromptModal: () => {
    set({ promptModal: null });
  },

  submitPromptModal: async (value: string) => {
    const { promptModal, selectedPath } = get();
    if (!promptModal) return;
    const clean = value.trim();
    set({ promptModal: null });
    if (!clean) return;

    if (promptModal.kind === 'newFolder') {
      await get().createNewFolder(clean);
    } else if (promptModal.kind === 'newFile') {
      await get().createNewFile(clean);
    } else if (promptModal.kind === 'rename') {
      if (clean !== promptModal.defaultValue) {
        await get().renameSelected(clean);
      }
    } else if (promptModal.kind === 'addTag') {
      const target = promptModal.targetPath || selectedPath;
      if (target) {
        get().addTagToPath(target, clean);
      }
    }
  },

  requestDeleteSelected: (forcePermanent?: boolean) => {
    const s = get();
    const { deletePermanently } = s;
    // In the split layout the active pane's selection is the one that counts; the details-view
    // selection can be stale. Resolve here so every caller (Del key, ribbon, context menu) agrees.
    const targets = effectiveTargets(s);
    if (targets.length === 0) return;
    set({
      pendingDeletePath: targets[0],
      pendingDeletePaths: targets,
      deletePermanently: typeof forcePermanent === 'boolean' ? forcePermanent : deletePermanently,
    });
  },

  confirmDeleteSelected: async () => {
    const { pendingDeletePaths, pendingDeletePath, deletePermanently } = get();
    const targets =
      pendingDeletePaths.length > 0
        ? pendingDeletePaths
        : pendingDeletePath
          ? [pendingDeletePath]
          : [];
    if (targets.length === 0) return;

    for (const p of targets) {
      await fsService.deleteItem(p, deletePermanently);
    }
    const label =
      targets.length === 1
        ? `"${targets[0].split(/[\\/]/).pop() || 'item'}"`
        : `${targets.length} items`;
    set({
      statusMessage: deletePermanently
        ? `Permanently deleted ${label}`
        : `Moved ${label} to Recycle Bin`,
      pendingDeletePath: null,
      pendingDeletePaths: [],
      selectedPath: null,
      selectedPaths: [],
    });
    // Drop the deleted paths from any split pane selection so nothing stale is left behind.
    const deleted = new Set(targets);
    set({
      tabs: get().tabs.map((t) => {
        if (!t.splitPanels) return t;
        const prune = (p: SplitPanelState): SplitPanelState => {
          if (!p.selectedPaths.some((x) => deleted.has(x)) && !(p.selectedPath && deleted.has(p.selectedPath))) return p;
          const kept = p.selectedPaths.filter((x) => !deleted.has(x));
          return { ...p, selectedPaths: kept, selectedPath: kept[0] ?? null };
        };
        return { ...t, splitPanels: [prune(t.splitPanels[0]), prune(t.splitPanels[1])] };
      }),
    });
    await get().refresh();
  },

  cancelDeleteSelected: () => {
    set({ pendingDeletePath: null, pendingDeletePaths: [] });
  },

  deleteSelected: async () => {
    const { selectedPaths, selectedPath, deletePermanently } = get();
    const targets = selectedPaths.length > 0 ? selectedPaths : selectedPath ? [selectedPath] : [];
    if (targets.length === 0) return;
    for (const p of targets) {
      await fsService.deleteItem(p, deletePermanently);
    }
    set({ statusMessage: `Deleted ${targets.length} item(s)`, selectedPath: null, selectedPaths: [] });
    await get().refresh();
  },

  dropEntriesToDir: async (sourcePaths: string[], targetDir: string, copy = false) => {
    const normTarget = targetDir.replace(/[\\/]+$/, '').toLowerCase();
    const validSources = sourcePaths.filter((src) => {
      const normSrc = src.replace(/[\\/]+$/, '').toLowerCase();
      if (normSrc === normTarget) return false;
      if (normTarget.startsWith(normSrc + '\\') || normTarget.startsWith(normSrc + '/')) {
        return false;
      }
      if (!copy) {
        const parentDir = src.replace(/[\\/][^\\/]+$/, '').replace(/[\\/]+$/, '').toLowerCase();
        if (parentDir === normTarget) return false;
      }
      return true;
    });

    if (validSources.length === 0) return;
    if (copy) {
      await copyItemsTo(validSources, targetDir, `Copied ${validSources.length} item(s) to ${targetDir}`);
    } else {
      await moveItemsTo(validSources, targetDir, `Moved ${validSources.length} item(s) to ${targetDir}`);
    }
    await get().refresh();
  },

  dropUrlToDir: async (url: string, targetDir?: string, title?: string): Promise<string | null> => {
    logger.action('dropUrlToDir', { url, targetDir, title });
    const { currentPath, undoStack } = get();
    const destDir = targetDir || currentPath;
    if (!destDir || !url) return null;

    try {
      const baseName = generateUrlShortcutName(url, title);
      const content = buildInternetShortcutContent(url);

      const existingNames = new Set<string>();
      if (destDir.toLowerCase() === currentPath.toLowerCase()) {
        for (const item of get().items) {
          existingNames.add(item.name.toLowerCase());
        }
      } else {
        try {
          const dir = await fsService.listDirectory(destDir, false);
          for (const item of dir.items) {
            existingNames.add(item.name.toLowerCase());
          }
        } catch {}
      }

      let fileName = `${baseName}.url`;
      let counter = 2;
      while (existingNames.has(fileName.toLowerCase())) {
        fileName = `${baseName} (${counter}).url`;
        counter++;
      }

      let res: { ok: boolean; path: string } | null = null;
      for (let attempt = 0; attempt < 50; attempt++) {
        try {
          res = await fsService.createFile(destDir, fileName, content);
          break;
        } catch (err: any) {
          const msg = String(err?.message || '');
          if (msg.includes('EEXIST') || msg.includes('already exists')) {
            fileName = `${baseName} (${counter}).url`;
            counter++;
            continue;
          }
          throw err;
        }
      }

      if (!res || !res.path) {
        throw new Error(`Failed to create shortcut "${fileName}"`);
      }

      const createdPath = res.path;
      const isCurrent = destDir.toLowerCase() === (get().currentPath || '').toLowerCase();
      const dirName = destDir.split(/[\\/]/).filter(Boolean).pop() || destDir;
      const status = isCurrent
        ? `Created shortcut "${fileName}"`
        : `Created shortcut "${fileName}" in "${dirName}"`;

      set({
        lastDroppedUrl: { url, targetDir: destDir, title, createdPath },
        undoStack: [...undoStack, { kind: 'create', createdPath }],
        statusMessage: status,
      });

      await get().refresh();

      if (isCurrent) {
        set({ selectedPath: createdPath, selectedPaths: [createdPath] });
      }

      return createdPath;
    } catch (err: any) {
      logger.error('dropUrlToDir failed', err);
      const errMsg = err?.message || 'Failed to create shortcut file';
      set({
        error: errMsg,
        statusMessage: `Failed to create shortcut: ${errMsg}`,
      });
      return null;
    }
  },

  openPowershellCurrent: async () => {
    const dir = activeSplitTarget(get())?.panel.path || get().currentPath;
    if (!dir) return;
    await fsService.openPowershell(dir);
    set({ statusMessage: `Launched PowerShell in ${dir}` });
  },

  compressSelectedToZip: async () => {
    const { undoStack } = get();
    const targets = effectiveTargets(get());
    if (targets.length === 0) return;
    set({ isLoading: true });
    try {
      const res = await fsService.compressToZip(targets);
      const zipName = res.path.split(/[\\/]/).pop() || 'Archive.zip';
      set({
        isLoading: false,
        undoStack: res.path ? [...undoStack, { kind: 'create', createdPath: res.path }] : undoStack,
        statusMessage: `Compressed ${targets.length} item(s) to ${zipName}`,
      });
      await get().refresh();
      if (res.path) {
        set({ selectedPath: res.path, selectedPaths: [res.path] });
      }
    } catch (err: any) {
      set({ isLoading: false, error: err.message });
    }
  },

  extractZipArchive: async (zipPath: string) => {
    const { undoStack } = get();
    set({ isLoading: true });
    try {
      const res = await fsService.extractZip(zipPath);
      const folderName = res.path.split(/[\\/]/).pop() || 'Extracted';
      set({
        isLoading: false,
        undoStack: res.path ? [...undoStack, { kind: 'create', createdPath: res.path }] : undoStack,
        statusMessage: `Extracted archive to "${folderName}"`,
      });
      await get().refresh();
      if (res.path) {
        set({ selectedPath: res.path, selectedPaths: [res.path] });
      }
    } catch (err: any) {
      set({ isLoading: false, error: err.message });
    }
  },
}));

// Column visibility/width changes made by the user are remembered for the folder on screen.
setColumnsChangeHandler(() => {
  const { currentPath, folderViews } = useExplorerStore.getState();
  if (currentPath) {
    useExplorerStore.setState({ folderViews: persistFolderView(folderViews, currentPath, { columns: getColumns() }) });
  }
});
