/** Per-folder view modes. Split view is not one of them: it is a global display setting. */
export type FolderLayout = 'workspace' | 'thumbnails' | 'command';
/**
 * A folder view, or 'split' for split view. Used where a saved snapshot records the whole
 * display (workflows) and for older saved data; the live store keeps the two apart.
 */
export type LayoutMode = FolderLayout | 'split';

export type SortField = 'name' | 'modified' | 'created' | 'size' | 'extension';

/** View style the user picked for one folder. */
export interface FolderViewStyle {
  /**
   * Folder view. Absent when the user only changed the sort for this folder. Never split view:
   * that is a global display setting, not remembered per folder.
   */
  layout?: FolderLayout;
  /** Thumbnail tile size in px, recorded for the thumbnails layout. */
  thumbSize?: number;
  /** Sort order the user picked for this folder. */
  sortBy?: SortField;
  sortAsc?: boolean;
  /** Detail-view columns (visibility and widths) the user set for this folder. */
  columns?: { visible: Record<string, boolean>; widths: Record<string, number> };
}

export interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  sizeBytes: number;
  modifiedMs: number;
  /** Creation time (Unix ms). Absent for sources that don't report it (e.g. SFTP). */
  createdMs?: number;
  extension: string;
  gitStatus?: string;
  tags?: string[];
}

export interface DirListResponse {
  path: string;
  parentPath: string | null;
  items: FsEntry[];
  version?: number;
}

export interface FilePreview {
  kind: 'text' | 'directory' | 'binary' | 'image' | 'video' | 'audio' | 'empty';
  content?: string;
  children?: string[];
  message?: string;
  url?: string;
  thumbUrl?: string;
  width?: number | null;
  height?: number | null;
}

/** Response of the `mediaInfo` action. Fields that don't apply or can't be read are null. */
export interface MediaInfo {
  kind: 'image' | 'video' | 'other';
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  /** Bits per second. */
  bitrate: number | null;
  sizeBytes: number;
  /** Unix ms, UTC. */
  createdMs: number;
  /** Unix ms, UTC. */
  modifiedMs: number;
}

export interface ThumbCacheStats {
  count: number;
  totalBytes: number;
  maxCacheMb?: number;
  cacheDir?: string;
}

/** Result of the desktop host's `startDrag` action (native OS drag-out). */
export interface StartDragResult {
  ok: boolean;
  started: boolean;
  count: number;
}

export interface FolderSizeStats {
  folderCount: number;
  dbBytes: number;
  pendingScans: number;
  dbPath?: string;
}

export interface ExplorerTab {
  id: string;
  title: string;
  path: string;
  history: string[];
  historyIndex: number;
  /** Independent left/right panels for the `split` layout. Created on demand. */
  splitPanels?: [SplitPanelState, SplitPanelState];
  /** Focused / last-clicked split panel; receives shortcuts and navigation. Defaults to 0. */
  activeSplitPanel?: SplitPanelIndex;
}

/** One panel of the split layout: its own folder, back/forward history and selection. */
export interface SplitPanelState {
  path: string;
  history: string[];
  historyIndex: number;
  selectedPath: string | null;
  selectedPaths: string[];
  /**
   * This pane's own tab strip. The active tab's live state is mirrored in the fields above;
   * inactive tabs hold saved snapshots. Created on demand (absent = a single implicit tab).
   */
  paneTabs?: SplitPaneTab[];
  activePaneTabId?: string;
}

/** Saved folder/history/selection of one tab inside a split pane. */
export interface SplitPaneTab {
  id: string;
  path: string;
  history: string[];
  historyIndex: number;
  selectedPath: string | null;
  selectedPaths: string[];
}

export type SplitPanelIndex = 0 | 1;

export interface PinnedWorkspace {
  id: string;
  label: string;
  path: string;
  icon?: string;
  iconColor?: string;
  tabs: ExplorerTab[];
  activeTabId: string;
  /** Folder view of the main view. Older saved workflows may say 'split'; they are migrated on load. */
  layout: FolderLayout;
  /**
   * Whether split view was on. Each tab's `splitPanels` (folders, history and pane tabs of the
   * left and right panels) is saved with the tab, so the panel layout comes back as it was.
   */
  splitView?: boolean;
  sortBy?: SortField;
  sortAsc?: boolean;
  showInspector?: boolean;
  showHiddenFiles?: boolean;
  visibleCols?: {
    type: boolean;
    modified: boolean;
    modifiedTimestamp: boolean;
    size: boolean;
  };
  colWidths?: {
    type: number;
    modified: number;
    modifiedTimestamp: number;
    size: number;
  };
}

export type Workflow = PinnedWorkspace;

export type SidebarSectionId = 'quickAccess' | 'drives' | 'workflows';

export interface QuickAccessFolder {
  id: string;
  label: string;
  path: string;
  icon?: string;
  iconColor?: string;
}

export interface DriveInfoItem {
  name: string;
  label?: string;
  totalBytes: number;
  freeBytes: number;
}

export interface SystemInfo {
  cwd: string;
  home: string;
  drives: string[];
  driveDetails?: DriveInfoItem[];
  platform: string;
}

export type LogLevel = 'debug' | 'info' | 'perf' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  level: LogLevel;
  category: string;
  message: string;
  data?: unknown;
  ts: number;
}

export interface LogSettings {
  enabled: boolean;
  logDir?: string;
  logFile?: string;
}

/** Path prefix for folders on SSH hosts: `ssh://{connectionId}/absolute/remote/path`. */
export const SSH_PATH_PREFIX = 'ssh://';

/** A saved SSH host (key-based auth, added as `user@host[:port]`). Returned by the `ssh*` actions. */
export interface SshConnection {
  id: string;
  user: string;
  host: string;
  port: number;
  label: string | null;
  /** Explicit private key path; null means the default keys in ~/.ssh are tried. */
  keyPath: string | null;
  /** `user@host`, or `user@host:port` when the port isn't 22. */
  target: string;
  /** `ssh://{id}/`, the remote filesystem root. */
  rootPath: string;
  /** SHA256 host key fingerprint pinned on first connect; null until then. */
  hostKeyFingerprint: string | null;
  /** True while the host keeps an open SFTP session for this connection. */
  connected: boolean;
}

/** A disk mounted on an SSH host (from the remote mount table). Returned by `sshDrives`. */
export interface SshDrive {
  /** Last segment of the mount point (`/` for the root filesystem). */
  name: string;
  /** The mount point as an SSH path, e.g. `ssh://{id}/mnt/media1`. */
  path: string;
  mountPoint: string;
  /** Source device or share, e.g. `/dev/sdb1` or `nas:/export`. */
  device: string;
  fsType: string;
  /** 0 when the server can't report capacity. */
  totalBytes: number;
  freeBytes: number;
}

/** Host-side progress of a copy/move batch. Returned by `transferProgress`. */
export interface TransferProgress {
  /** Totals come from a background scan and keep growing while `scanning` is true. */
  totalBytes: number;
  totalFiles: number;
  doneBytes: number;
  doneFiles: number;
  /** Files already at the destination (identical, or a conflict left alone): counted toward progress, not copied. */
  skippedBytes: number;
  skippedFiles: number;
  /** Name of the file being copied right now. */
  currentName: string;
  scanning: boolean;
}

/** How a copy/move treats a file that already exists at the destination with different content. */
export type ConflictPolicy = 'replace' | 'skip';

export interface TransferConflict {
  /** Path below the destination folder, `/`-separated, starting with the item's own name. */
  relPath: string;
  /** Same size but another modified date: possibly the same file. */
  sameSize: boolean;
  /** A file where a folder should go, or the reverse. Never overwritten. */
  typeMismatch: boolean;
  sourceSize: number;
  destSize: number;
  sourceModifiedMs: number;
  destModifiedMs: number;
}

/** What a copy/move batch would run into at the destination. Returned by `transferPlan`. */
export interface TransferPlan {
  /** Files that differ, capped by the host; the counts below are complete. */
  conflicts: TransferConflict[];
  differentCount: number;
  sameSizeCount: number;
  /** Same size and date: skipped automatically (a move still removes them from the source). */
  identicalCount: number;
}

export interface TransferItemOptions {
  /** Ties the request to a progress job opened with `transferStart`. */
  transferId?: string;
  /** Without a policy the host refuses to overwrite and fails with "already exists". */
  onConflict?: ConflictPolicy;
  /** Compare contents of same-size files and skip the ones that match. */
  verifySameSize?: boolean;
  /**
   * Let the destination SSH host fetch the item itself (rsync from its own mount of the source
   * share) instead of streaming it through this PC. Only valid after `remoteCopyCheck` said yes.
   */
  viaRemote?: boolean;
}

/** Returned by `remoteCopyCheck`. */
export interface RemoteCopyCheck {
  /** The destination host has the share every source lives on mounted. */
  available: boolean;
  hostLabel?: string;
}

export interface TransferItemResult {
  ok: boolean;
  path: string;
  /** Conflicting files left alone under the `skip` policy. */
  skipped?: number;
  /** The destination already existed and was merged into, so the item can't be undone as a unit. */
  merged?: boolean;
}

export interface SshAddRequest {
  /** `user@host` or `user@host:port`. */
  target: string;
  label?: string;
  keyPath?: string;
}

export interface SshConnectResult {
  connection: SshConnection;
  /** The remote user's home folder as an SSH path, e.g. `ssh://{id}/home/pi`. */
  homePath: string;
}
