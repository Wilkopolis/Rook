export type LayoutMode = 'workspace' | 'thumbnails' | 'miller' | 'dualpane' | 'faceted' | 'command';

export type SortField = 'name' | 'modified' | 'size' | 'extension';

export interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  sizeBytes: number;
  modifiedMs: number;
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

export interface ThumbCacheStats {
  count: number;
  totalBytes: number;
  maxCacheMb?: number;
  cacheDir?: string;
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
}

export interface PinnedWorkspace {
  id: string;
  label: string;
  path: string;
  icon?: string;
  iconColor?: string;
  tabs: ExplorerTab[];
  activeTabId: string;
  layout: LayoutMode;
  rightPanePath?: string;
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
