import { create } from 'zustand';
import { DriveInfoItem, ExplorerTab, FilePreview, FolderSizeStats, FsEntry, LayoutMode, PinnedWorkspace, SortField, ThumbCacheStats } from '../types/fs';
import { fsService } from '../services/fsService';
import { inferTags } from '../utils/format';

export type UndoOperation =
  | { kind: 'rename'; currentPath: string; oldName: string }
  | { kind: 'move'; moves: { currentPath: string; originalDir: string }[] }
  | { kind: 'copy'; createdPaths: string[] }
  | { kind: 'create'; createdPath: string };

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
  parentItems: FsEntry[];
  gitBranch: string | null;
  gitStatuses: Record<string, string>;
  thumbStats: ThumbCacheStats;
  folderSizeStats: FolderSizeStats;
  isLoading: boolean;
  error: string | null;
  statusMessage: string | null;

  // Dual-Pane right side state
  rightPanePath: string;
  rightPaneItems: FsEntry[];
  activePane: 'left' | 'right';

  // Selection, Clipboard, Undo & Preview
  selectedPath: string | null;
  selectedPaths: string[];
  clipboard: { paths: string[]; mode: 'copy' | 'cut' } | null;
  undoStack: UndoOperation[];
  preview: FilePreview | null;
  pendingDeletePath: string | null;
  pendingDeletePaths: string[];
  deletePermanently: boolean;
  contextMenu: { x: number; y: number; entry: FsEntry | null } | null;
  promptModal: PromptModalConfig | null;

  // Layout & UI Options Ribbon
  layout: LayoutMode;
  sortBy: SortField;
  sortAsc: boolean;
  filterQuery: string;
  deepSearch: boolean;
  deepSearchResults: FsEntry[] | null;
  isSearching: boolean;
  dirVersion: number;
  pinnedFolders: PinnedWorkspace[];
  activeTagFilter: string;
  showSidebar: boolean;
  showInspector: boolean;
  showTerminal: boolean;
  showQuickLookModal: boolean;
  showOptionsModal: boolean;
  showHiddenFiles: boolean;
  customTags: Record<string, string[]>;

  // Actions
  init: () => Promise<void>;
  navigateTo: (path: string, pushHistory?: boolean) => Promise<void>;
  navigateRightPane: (path: string) => Promise<void>;
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  goUp: () => Promise<void>;
  refresh: () => Promise<void>;
  checkDirWatcher: () => Promise<void>;
  runDeepSearch: (query?: string) => Promise<void>;
  toggleDeepSearch: () => void;
  togglePinFolder: (folderPath?: string) => void;
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

  // Clipboard & Undo Actions
  copyToClipboard: () => void;
  cutToClipboard: () => void;
  pasteClipboard: (targetDir?: string) => Promise<void>;
  undoLastOperation: () => Promise<void>;

  // Tab Actions
  addTab: (path?: string) => Promise<void>;
  closeTab: (id: string) => void;
  switchTab: (id: string) => Promise<void>;
  reorderTabs: (fromId: string, toId: string) => void;

  // Layout & Ribbon Actions
  setLayout: (layout: LayoutMode) => void;
  setSortBy: (field: SortField) => void;
  toggleSortAsc: () => void;
  setFilterQuery: (q: string) => void;
  setActiveTagFilter: (tag: string) => void;
  toggleSidebar: () => void;
  toggleInspector: () => void;
  toggleTerminal: () => void;
  toggleQuickLookModal: () => void;
  toggleOptionsModal: () => void;
  toggleHiddenFiles: () => void;
  setDeletePermanently: (perm: boolean) => void;
  setActivePane: (pane: 'left' | 'right') => void;
  addTagToPath: (path: string, tag: string) => void;

  // File CRUD & Shell Actions
  createNewFolder: (name: string) => Promise<void>;
  createNewFile: (name: string) => Promise<void>;
  renameSelected: (newName: string) => Promise<void>;
  requestDeleteSelected: (forcePermanent?: boolean) => void;
  confirmDeleteSelected: () => Promise<void>;
  cancelDeleteSelected: () => void;
  deleteSelected: () => Promise<void>;
  copySelectedToOtherPane: () => Promise<void>;
  moveSelectedToOtherPane: () => Promise<void>;
  dropEntriesToDir: (sourcePaths: string[], targetDir: string, copy?: boolean) => Promise<void>;
  compressSelectedToZip: () => Promise<void>;
  extractZipArchive: (zipPath: string) => Promise<void>;
  openPowershellCurrent: () => Promise<void>;
}

const SESSION_KEY = 'rook_session_v1';

interface SavedSession {
  tabs?: ExplorerTab[];
  activeTabId?: string;
  rightPanePath?: string;
  layout?: LayoutMode;
  sortBy?: SortField;
  sortAsc?: boolean;
  showSidebar?: boolean;
  showInspector?: boolean;
  showHiddenFiles?: boolean;
}

const loadSavedSession = (): SavedSession => {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
  } catch {
    return {};
  }
};

const persistSession = (state: Partial<ExplorerState>) => {
  try {
    const prev = loadSavedSession();
    const next: SavedSession = {
      tabs: state.tabs ?? prev.tabs,
      activeTabId: state.activeTabId ?? prev.activeTabId,
      rightPanePath: state.rightPanePath ?? prev.rightPanePath,
      layout: state.layout ?? prev.layout,
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

const makeDefaultPin = (pathStr: string, index: number): PinnedWorkspace => {
  const norm = pathStr.replace(/[\\/]+$/, '');
  const label = norm.split(/[\\/]/).filter(Boolean).pop() || norm;
  const tabId = `pin-tab-${index}`;
  return {
    id: `pin-${index}-${norm.toLowerCase()}`,
    label,
    path: norm,
    tabs: [
      {
        id: tabId,
        title: label,
        path: norm,
        history: [norm],
        historyIndex: 0,
      },
    ],
    activeTabId: tabId,
    layout: 'workspace',
  };
};

const savedPinnedFolders = (): PinnedWorkspace[] => {
  try {
    const raw = localStorage.getItem('rook_pinned_folders_v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((item, idx) => {
          if (typeof item === 'string') {
            return makeDefaultPin(item, idx);
          }
          return item as PinnedWorkspace;
        });
      }
    }
  } catch {}
  return [
    makeDefaultPin('c:\\Projects\\Repos\\Crush\\New Folder', 0),
    makeDefaultPin('c:\\Projects\\Repos\\Crush\\New Folder\\public\\icons', 1),
  ];
};

const initialSession = loadSavedSession();

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  drives: ['C:\\'],
  driveDetails: [],
  homeDir: '',
  tabs: [],
  activeTabId: 'tab-1',
  currentPath: '',
  parentPath: null,
  items: [],
  parentItems: [],
  gitBranch: null,
  gitStatuses: {},
  thumbStats: { count: 0, totalBytes: 0 },
  folderSizeStats: { folderCount: 0, dbBytes: 0, pendingScans: 0 },
  isLoading: false,
  error: null,
  statusMessage: null,

  rightPanePath: '',
  rightPaneItems: [],
  activePane: 'left',

  selectedPath: null,
  selectedPaths: [],
  clipboard: null,
  undoStack: [],
  preview: null,
  pendingDeletePath: null,
  pendingDeletePaths: [],
  deletePermanently: false,
  contextMenu: null,
  promptModal: null,

  layout: initialSession.layout ?? 'workspace',
  sortBy: initialSession.sortBy ?? 'name',
  sortAsc: initialSession.sortAsc ?? true,
  filterQuery: '',
  deepSearch: false,
  deepSearchResults: null,
  isSearching: false,
  dirVersion: 0,
  pinnedFolders: savedPinnedFolders(),
  activeTagFilter: 'all',
  showSidebar: initialSession.showSidebar ?? true,
  showInspector: initialSession.showInspector ?? true,
  showTerminal: false,
  showQuickLookModal: false,
  showOptionsModal: false,
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
      const rightTarget = sess.rightPanePath || info.home || info.cwd;

      set({
        drives: info.drives,
        driveDetails: info.driveDetails || [],
        homeDir: info.home,
        tabs: tabsToUse,
        activeTabId: activeTab.id,
        rightPanePath: rightTarget,
      });

      await get().navigateTo(activeTab.path, false);
      await get().navigateRightPane(rightTarget);
      await get().refreshThumbStats();
      await get().refreshFolderSizeStats();
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
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

  navigateTo: async (targetPath: string, pushHistory = true) => {
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

      let parentItems: FsEntry[] = [];
      if (res.parentPath) {
        try {
          const parentRes = await fsService.listDirectory(res.parentPath, false);
          parentItems = parentRes.items;
        } catch {
          // ignore
        }
      }

      const { tabs, activeTabId } = get();
      const folderName = res.path.split(/[\\/]/).filter(Boolean).pop() || res.path;
      const updatedTabs = tabs.map((t) => {
        if (t.id !== activeTabId) return t;
        if (!pushHistory) {
          return { ...t, path: res.path, title: folderName };
        }
        const nextHistory = t.history.slice(0, t.historyIndex + 1);
        nextHistory.push(res.path);
        return {
          ...t,
          path: res.path,
          title: folderName,
          history: nextHistory,
          historyIndex: nextHistory.length - 1,
        };
      });

      set({
        currentPath: res.path,
        parentPath: res.parentPath,
        items: enriched,
        parentItems,
        gitBranch: git.branch,
        gitStatuses: git.statuses,
        tabs: updatedTabs,
        dirVersion: typeof res.version === 'number' ? res.version : get().dirVersion,
        deepSearchResults: null,
        isLoading: false,
      });
      persistSession({ tabs: updatedTabs, activeTabId });

      if (get().deepSearch && get().filterQuery.trim()) {
        get().runDeepSearch(get().filterQuery);
      }

      const prevSelected = get().selectedPath;
      const stillExists =
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

  navigateRightPane: async (targetPath: string) => {
    try {
      const res = await fsService.listDirectory(targetPath, false);
      const custom = get().customTags;
      const enriched = res.items.map((item) => ({
        ...item,
        tags: inferTags(item, custom),
      }));
      set({ rightPanePath: res.path, rightPaneItems: enriched });
      persistSession({ rightPanePath: res.path });
    } catch (err: any) {
      set({ statusMessage: `Right pane error: ${err.message}` });
    }
  },

  goBack: async () => {
    const { tabs, activeTabId } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab || tab.historyIndex <= 0) return;
    const nextIndex = tab.historyIndex - 1;
    const targetPath = tab.history[nextIndex];
    set({
      tabs: tabs.map((t) => (t.id === activeTabId ? { ...t, historyIndex: nextIndex } : t)),
    });
    await get().navigateTo(targetPath, false);
  },

  goForward: async () => {
    const { tabs, activeTabId } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab || tab.historyIndex >= tab.history.length - 1) return;
    const nextIndex = tab.historyIndex + 1;
    const targetPath = tab.history[nextIndex];
    set({
      tabs: tabs.map((t) => (t.id === activeTabId ? { ...t, historyIndex: nextIndex } : t)),
    });
    await get().navigateTo(targetPath, false);
  },

  goUp: async () => {
    const { parentPath } = get();
    if (parentPath) {
      await get().navigateTo(parentPath, true);
    }
  },

  refresh: async () => {
    const { currentPath, rightPanePath } = get();
    if (currentPath) await get().navigateTo(currentPath, false);
    if (rightPanePath) await get().navigateRightPane(rightPanePath);
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
    const { selectedPaths, selectedPath } = get();
    const paths = selectedPaths.length > 0 ? selectedPaths : selectedPath ? [selectedPath] : [];
    if (paths.length === 0) return;
    set({
      clipboard: { paths, mode: 'copy' },
      statusMessage: `Copied ${paths.length} item${paths.length === 1 ? '' : 's'} to clipboard`,
    });
  },

  cutToClipboard: () => {
    const { selectedPaths, selectedPath } = get();
    const paths = selectedPaths.length > 0 ? selectedPaths : selectedPath ? [selectedPath] : [];
    if (paths.length === 0) return;
    set({
      clipboard: { paths, mode: 'cut' },
      statusMessage: `Cut ${paths.length} item${paths.length === 1 ? '' : 's'} to clipboard`,
    });
  },

  pasteClipboard: async (targetDir?: string) => {
    const { clipboard, currentPath, undoStack } = get();
    const destDir = targetDir || currentPath;
    if (!clipboard || clipboard.paths.length === 0 || !destDir) return;

    if (clipboard.mode === 'copy') {
      const createdPaths: string[] = [];
      for (const src of clipboard.paths) {
        const res = await fsService.copyItem(src, destDir);
        if (res.path) createdPaths.push(res.path);
      }
      set({
        undoStack: [...undoStack, { kind: 'copy', createdPaths }],
        statusMessage: `Pasted ${createdPaths.length} copied item${createdPaths.length === 1 ? '' : 's'}`,
      });
    } else {
      const moves: { currentPath: string; originalDir: string }[] = [];
      for (const src of clipboard.paths) {
        const originalDir = src.replace(/[\\/][^\\/]+$/, '');
        const res = await fsService.moveItem(src, destDir);
        if (res.path) {
          moves.push({ currentPath: res.path, originalDir });
        }
      }
      set({
        clipboard: null,
        undoStack: [...undoStack, { kind: 'move', moves }],
        statusMessage: `Moved ${moves.length} item${moves.length === 1 ? '' : 's'}`,
      });
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

  setLayout: (layout) => {
    set({ layout });
    persistSession({ layout });
  },
  setSortBy: (sortBy) => {
    const sortAsc = get().sortBy === sortBy ? !get().sortAsc : true;
    set({ sortBy, sortAsc });
    persistSession({ sortBy, sortAsc });
  },
  toggleSortAsc: () => {
    const sortAsc = !get().sortAsc;
    set({ sortAsc });
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
  togglePinFolder: (folderPath?: string) => {
    const {
      currentPath,
      tabs,
      activeTabId,
      layout,
      rightPanePath,
      sortBy,
      sortAsc,
      showInspector,
      showHiddenFiles,
      pinnedFolders,
    } = get();

    const targetPath = (folderPath || currentPath).replace(/[\\/]+$/, '');
    if (!targetPath) return;

    // If invoked from a folder context menu and an identical single-folder pin exists, allow unpinning
    if (folderPath) {
      const existing = pinnedFolders.find(
        (p) => p.path.toLowerCase() === targetPath.toLowerCase() && p.tabs.length <= 1
      );
      if (existing) {
        const next = pinnedFolders.filter((p) => p.id !== existing.id);
        localStorage.setItem('rook_pinned_folders_v1', JSON.stringify(next));
        set({
          pinnedFolders: next,
          statusMessage: `Unpinned "${existing.label}" from Quick Access`,
        });
        return;
      }
    }

    const folderName = targetPath.split(/[\\/]/).filter(Boolean).pop() || targetPath;

    let visibleCols: PinnedWorkspace['visibleCols'];
    let colWidths: PinnedWorkspace['colWidths'];
    try {
      const rawVis = localStorage.getItem('rook_visible_columns');
      if (rawVis) visibleCols = JSON.parse(rawVis);
      const rawWidths = localStorage.getItem('rook_column_widths');
      if (rawWidths) colWidths = JSON.parse(rawWidths);
    } catch {}

    const snapshotTabs: ExplorerTab[] =
      folderPath && folderPath.toLowerCase() !== currentPath.toLowerCase()
        ? [
            {
              id: `tab-${Date.now()}`,
              title: folderName,
              path: targetPath,
              history: [targetPath],
              historyIndex: 0,
            },
          ]
        : tabs.map((t) => ({ ...t, history: [...t.history] }));

    const snapshotActiveTabId =
      folderPath && folderPath.toLowerCase() !== currentPath.toLowerCase()
        ? snapshotTabs[0].id
        : activeTabId;

    const newPin: PinnedWorkspace = {
      id: `pin-${Date.now()}`,
      label: folderName,
      path: targetPath,
      tabs: snapshotTabs,
      activeTabId: snapshotActiveTabId,
      layout,
      rightPanePath,
      sortBy,
      sortAsc,
      showInspector,
      showHiddenFiles,
      visibleCols,
      colWidths,
    };

    const next = [...pinnedFolders, newPin];
    localStorage.setItem('rook_pinned_folders_v1', JSON.stringify(next));
    set({
      pinnedFolders: next,
      statusMessage: `Pinned "${folderName}" (${snapshotTabs.length} tab${
        snapshotTabs.length === 1 ? '' : 's'
      }, ${layout} view) to Quick Access`,
    });
  },
  unpinWorkspace: (id: string) => {
    const current = get().pinnedFolders;
    const target = current.find((p) => p.id === id);
    const next = current.filter((p) => p.id !== id);
    localStorage.setItem('rook_pinned_folders_v1', JSON.stringify(next));
    set({
      pinnedFolders: next,
      statusMessage: target ? `Unpinned "${target.label}" from Quick Access` : 'Unpinned from Quick Access',
    });
  },
  renamePinnedWorkspace: (id: string, newLabel: string) => {
    const trimmed = newLabel.trim();
    if (!trimmed) return;
    const current = get().pinnedFolders;
    const next = current.map((p) => (p.id === id ? { ...p, label: trimmed } : p));
    localStorage.setItem('rook_pinned_folders_v1', JSON.stringify(next));
    set({
      pinnedFolders: next,
      statusMessage: `Renamed Quick Access entry to "${trimmed}"`,
    });
  },
  updatePinnedWorkspaceStyle: (id: string, icon: string, iconColor: string) => {
    const current = get().pinnedFolders;
    const next = current.map((p) =>
      p.id === id ? { ...p, icon, iconColor } : p
    );
    localStorage.setItem('rook_pinned_folders_v1', JSON.stringify(next));
    set({
      pinnedFolders: next,
      statusMessage: `Updated Quick Access icon`,
    });
  },
  loadPinnedWorkspace: async (pin: PinnedWorkspace) => {
    const restoredTabs: ExplorerTab[] =
      Array.isArray(pin.tabs) && pin.tabs.length > 0
        ? pin.tabs.map((t) => ({ ...t, history: Array.isArray(t.history) ? [...t.history] : [t.path] }))
        : [
            {
              id: `tab-${Date.now()}`,
              title: pin.label,
              path: pin.path,
              history: [pin.path],
              historyIndex: 0,
            },
          ];

    const restoredActiveId = restoredTabs.some((t) => t.id === pin.activeTabId)
      ? pin.activeTabId
      : restoredTabs[0].id;
    const activeTab = restoredTabs.find((t) => t.id === restoredActiveId) || restoredTabs[0];

    const nextLayout = pin.layout || get().layout;
    const nextSortBy = pin.sortBy ?? get().sortBy;
    const nextSortAsc = pin.sortAsc ?? get().sortAsc;
    const nextShowInspector = pin.showInspector ?? get().showInspector;
    const nextShowHidden = pin.showHiddenFiles ?? get().showHiddenFiles;

    if (pin.visibleCols) {
      try {
        localStorage.setItem('rook_visible_columns', JSON.stringify(pin.visibleCols));
      } catch {}
    }
    if (pin.colWidths) {
      try {
        localStorage.setItem('rook_column_widths', JSON.stringify(pin.colWidths));
      } catch {}
    }
    if (pin.visibleCols || pin.colWidths) {
      window.dispatchEvent(new CustomEvent('rook-columns-restored'));
    }

    set({
      tabs: restoredTabs,
      activeTabId: restoredActiveId,
      layout: nextLayout,
      sortBy: nextSortBy,
      sortAsc: nextSortAsc,
      showInspector: nextShowInspector,
      showHiddenFiles: nextShowHidden,
      statusMessage: `Loaded pinned workspace "${pin.label}" (${restoredTabs.length} tab${
        restoredTabs.length === 1 ? '' : 's'
      })`,
    });

    persistSession({
      tabs: restoredTabs,
      activeTabId: restoredActiveId,
      layout: nextLayout,
      sortBy: nextSortBy,
      sortAsc: nextSortAsc,
      showInspector: nextShowInspector,
      showHiddenFiles: nextShowHidden,
      rightPanePath: pin.rightPanePath,
    });

    await get().navigateTo(activeTab.path, false);
    if (pin.rightPanePath) {
      await get().navigateRightPane(pin.rightPanePath);
    }
  },
  setActiveTagFilter: (activeTagFilter) => set({ activeTagFilter }),
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
  toggleHiddenFiles: () => {
    const next = !get().showHiddenFiles;
    set({ showHiddenFiles: next });
    persistSession({ showHiddenFiles: next });
  },
  setDeletePermanently: (deletePermanently) => set({ deletePermanently }),
  setActivePane: (activePane) => set({ activePane }),

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
    const res = await fsService.createDirectory(currentPath, name);
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
    const res = await fsService.createFile(currentPath, name, '');
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
    const { selectedPaths, selectedPath, deletePermanently } = get();
    const targets = selectedPaths.length > 0 ? selectedPaths : selectedPath ? [selectedPath] : [];
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

  copySelectedToOtherPane: async () => {
    const { selectedPaths, selectedPath, rightPanePath, undoStack } = get();
    const targets = selectedPaths.length > 0 ? selectedPaths : selectedPath ? [selectedPath] : [];
    if (targets.length === 0 || !rightPanePath) return;
    const createdPaths: string[] = [];
    for (const src of targets) {
      const res = await fsService.copyItem(src, rightPanePath);
      if (res.path) createdPaths.push(res.path);
    }
    set({
      undoStack: [...undoStack, { kind: 'copy', createdPaths }],
      statusMessage: `Copied ${targets.length} item(s) to ${rightPanePath}`,
    });
    await get().refresh();
  },

  moveSelectedToOtherPane: async () => {
    const { selectedPaths, selectedPath, rightPanePath, undoStack } = get();
    const targets = selectedPaths.length > 0 ? selectedPaths : selectedPath ? [selectedPath] : [];
    if (targets.length === 0 || !rightPanePath) return;
    const moves: { currentPath: string; originalDir: string }[] = [];
    for (const src of targets) {
      const originalDir = src.replace(/[\\/][^\\/]+$/, '');
      const res = await fsService.moveItem(src, rightPanePath);
      if (res.path) moves.push({ currentPath: res.path, originalDir });
    }
    set({
      undoStack: [...undoStack, { kind: 'move', moves }],
      statusMessage: `Moved ${targets.length} item(s) to ${rightPanePath}`,
    });
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
    const { undoStack } = get();

    if (copy) {
      const createdPaths: string[] = [];
      for (const src of validSources) {
        const res = await fsService.copyItem(src, targetDir);
        if (res.path) createdPaths.push(res.path);
      }
      set({
        undoStack: [...undoStack, { kind: 'copy', createdPaths }],
        statusMessage: `Copied ${validSources.length} item(s) to ${targetDir}`,
      });
    } else {
      const moves: { currentPath: string; originalDir: string }[] = [];
      for (const src of validSources) {
        const originalDir = src.replace(/[\\/][^\\/]+$/, '');
        const res = await fsService.moveItem(src, targetDir);
        if (res.path) moves.push({ currentPath: res.path, originalDir });
      }
      set({
        undoStack: [...undoStack, { kind: 'move', moves }],
        statusMessage: `Moved ${validSources.length} item(s) to ${targetDir}`,
      });
    }
    await get().refresh();
  },

  openPowershellCurrent: async () => {
    const { currentPath } = get();
    if (!currentPath) return;
    await fsService.openPowershell(currentPath);
    set({ statusMessage: `Launched PowerShell in ${currentPath}` });
  },

  compressSelectedToZip: async () => {
    const { selectedPaths, selectedPath, undoStack } = get();
    const targets = selectedPaths.length > 0 ? selectedPaths : selectedPath ? [selectedPath] : [];
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
