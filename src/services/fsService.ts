import {
  DirListResponse,
  FilePreview,
  FolderSizeStats,
  LogEntry,
  LogSettings,
  MediaInfo,
  SshAddRequest,
  SshConnectResult,
  SshConnection,
  SshDrive,
  SystemInfo,
  ThumbCacheStats,
  TransferItemOptions,
  TransferItemResult,
  RemoteCopyCheck,
  TransferPlan,
  TransferProgress,
} from '../types/fs';
import { isSshPath } from '../utils/sshPath';

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export type ApiTimingListener = (action: string, durationMs: number, ok: boolean, error?: string) => void;

let apiTimingListener: ApiTimingListener | null = null;

/** Registered by the logger so fsService does not import it (avoids a module cycle). */
export function setApiTimingListener(listener: ApiTimingListener | null) {
  apiTimingListener = listener;
}

async function postApi<T>(action: string, body: Record<string, any> = {}): Promise<T> {
  const started = performance.now();
  try {
    const res = await fetch(`/api/fs/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `FS request failed: ${action}`);
    }
    apiTimingListener?.(action, performance.now() - started, true);
    return data as T;
  } catch (err: any) {
    apiTimingListener?.(action, performance.now() - started, false, err?.message || String(err));
    throw err;
  }
}

export const fsService = {
  /** Sends log entries straight to the host; bypasses postApi so logging never logs itself. */
  async writeLogs(entries: LogEntry[], keepalive = false): Promise<void> {
    await fetch('/api/fs/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
      keepalive,
    });
  },

  async getLogSettings(): Promise<LogSettings> {
    try {
      return await postApi<LogSettings>('logSettings');
    } catch {
      return { enabled: false };
    }
  },

  async setLoggingEnabled(enabled: boolean): Promise<LogSettings> {
    return postApi<LogSettings>('logSettings', { enabled });
  },

  async openLogFolder(): Promise<{ ok: boolean }> {
    return postApi('openLogFolder');
  },
  async getSystemInfo(): Promise<SystemInfo> {
    return postApi<SystemInfo>('info');
  },

  async winDrag(): Promise<void> {
    try {
      await postApi('winDrag');
    } catch {}
  },

  async winResize(dir: string): Promise<void> {
    try {
      await postApi('winResize', { dir });
    } catch {}
  },

  async winMinimize(): Promise<void> {
    try {
      await postApi('winMinimize');
    } catch {}
  },

  async winMaximize(): Promise<{ isMaximized?: boolean }> {
    try {
      return await postApi('winMaximize');
    } catch {
      return {};
    }
  },

  async winClose(): Promise<void> {
    try {
      await postApi('winClose');
    } catch {
      window.close();
    }
  },

  async getZoom(): Promise<number> {
    try {
      const res = await postApi<{ zoom: number }>('getZoom');
      return res.zoom ?? 1.0;
    } catch {
      return 1.0;
    }
  },

  async setZoom(zoom: number): Promise<void> {
    try {
      await postApi('setZoom', { zoom });
    } catch {}
  },

  async getThumbStats(): Promise<ThumbCacheStats> {
    try {
      return await postApi<ThumbCacheStats>('thumbStats');
    } catch {
      return { count: 0, totalBytes: 0, maxCacheMb: 250 };
    }
  },

  async setThumbMaxSize(maxCacheMb: number): Promise<ThumbCacheStats> {
    return postApi<ThumbCacheStats>('setThumbMaxSize', { maxCacheMb });
  },

  async clearThumbCache(): Promise<ThumbCacheStats> {
    return postApi<ThumbCacheStats>('clearThumbs');
  },

  async getFolderSizeStats(): Promise<FolderSizeStats> {
    try {
      return await postApi<FolderSizeStats>('folderSizeStats');
    } catch {
      return { folderCount: 0, dbBytes: 0, pendingScans: 0 };
    }
  },

  async clearFolderSizes(): Promise<FolderSizeStats> {
    return postApi<FolderSizeStats>('clearFolderSizes');
  },

  async rescanFolderSizes(path: string): Promise<FolderSizeStats> {
    return postApi<FolderSizeStats>('rescanFolderSizes', { path });
  },

  async listDirectory(path?: string, watch = true): Promise<DirListResponse> {
    if (isTauri() && path && !isSshPath(path)) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<DirListResponse>('list_directory', { path });
    }
    return postApi<DirListResponse>('list', { path, watch });
  },

  async getDirVersion(): Promise<{ version: number }> {
    try {
      return await postApi<{ version: number }>('dirVersion');
    } catch {
      return { version: 0 };
    }
  },

  async searchDirectory(path: string, query: string): Promise<{ path: string; items: DirListResponse['items'] }> {
    return postApi('search', { path, query });
  },

  async readPreview(path: string): Promise<FilePreview> {
    if (isTauri() && !isSshPath(path)) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<FilePreview>('read_file_preview', { path });
    }
    return postApi<FilePreview>('preview', { path });
  },

  /** Media details (resolution, duration, bitrate, times) for an image or video. Not mirrored in the Vite dev plugin. */
  async getMediaInfo(path: string): Promise<MediaInfo> {
    return postApi<MediaInfo>('mediaInfo', { path });
  },

  async getGitStatus(path: string): Promise<{ branch: string | null; statuses: Record<string, string> }> {
    try {
      return await postApi<{ branch: string | null; statuses: Record<string, string> }>('gitStatus', { path });
    } catch {
      return { branch: null, statuses: {} };
    }
  },

  async createDirectory(dir: string, name: string): Promise<{ ok: boolean; path: string }> {
    return postApi('mkdir', { dir, name });
  },

  async createFile(dir: string, name: string, content = ''): Promise<{ ok: boolean; path: string }> {
    return postApi('createFile', { dir, name, content });
  },

  async renameItem(oldPath: string, newName: string): Promise<{ ok: boolean; path: string }> {
    return postApi('rename', { oldPath, newName });
  },

  /** SSH paths have no Recycle Bin: the host always deletes them permanently and returns `permanent: true`. */
  async deleteItem(path: string, permanent = false): Promise<{ ok: boolean; permanent?: boolean }> {
    return postApi('delete', { path, permanent });
  },

  /** Copies into `destDir`, merging into a folder of the same name. Identical files are skipped. */
  async copyItem(sourcePath: string, destDir: string, options: TransferItemOptions = {}): Promise<TransferItemResult> {
    return postApi('copy', { sourcePath, destDir, ...options });
  },

  /** Like `copyItem`, but each file leaves the source once it is safely at the destination. */
  async moveItem(sourcePath: string, destDir: string, options: TransferItemOptions = {}): Promise<TransferItemResult> {
    return postApi('move', { sourcePath, destDir, ...options });
  },

  /** Checks the destination for files a copy/move batch would collide with (metadata only). */
  async transferPlan(kind: 'copy' | 'move', paths: string[], destDir: string): Promise<TransferPlan> {
    return postApi('transferPlan', { kind, paths, destDir });
  },

  /** Whether the SSH host behind `destDir` can copy `paths` itself, straight from the network share. */
  async remoteCopyCheck(paths: string[], destDir: string): Promise<RemoteCopyCheck> {
    return postApi('remoteCopyCheck', { paths, destDir });
  },

  /** Opens a progress job for a copy/move batch; the host sizes up `paths` in the background. */
  async transferStart(id: string, kind: 'copy' | 'move', paths: string[], destDir: string): Promise<void> {
    await postApi('transferStart', { id, kind, paths, destDir });
  },

  /** Polled several times a second, so it bypasses postApi to keep it out of the API timing log. */
  async transferProgress(id: string): Promise<TransferProgress> {
    const res = await fetch('/api/fs/transferProgress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'FS request failed: transferProgress');
    return data as TransferProgress;
  },

  /** Stops the file being copied; the pending copy/move request then fails with "Cancelled". */
  async transferCancel(id: string): Promise<void> {
    await postApi('transferCancel', { id });
  },

  async transferEnd(id: string): Promise<void> {
    await postApi('transferEnd', { id });
  },

  async compressToZip(paths: string[]): Promise<{ ok: boolean; path: string }> {
    return postApi('zipCompress', { paths });
  },

  async extractZip(path: string): Promise<{ ok: boolean; path: string }> {
    return postApi('zipExtract', { path });
  },

  async openPowershell(path: string): Promise<{ ok: boolean }> {
    return postApi('openPowershell', { path });
  },

  async runCommand(
    command: string,
    cwd: string
  ): Promise<{
    output: string;
    error: string;
    exitCode: number;
    cwd: string;
    timedOut: boolean;
    cancelled: boolean;
  }> {
    return postApi('runCommand', { command, cwd });
  },

  async cancelCommand(): Promise<{ ok: boolean }> {
    return postApi('cancelCommand');
  },

  /** For SSH paths the host downloads a temporary local copy and opens that; edits aren't synced back. */
  async openFile(path: string): Promise<{ ok: boolean; tempCopy?: string }> {
    return postApi('openFile', { path });
  },

  async openWith(app: 'sublime' | 'notepad++', paths: string[] | string): Promise<{ ok: boolean; error?: string }> {
    const list = Array.isArray(paths) ? paths : [paths];
    return postApi('openWith', { app, paths: list });
  },

  async revealInExplorer(path: string): Promise<{ ok: boolean }> {
    return postApi('revealInExplorer', { path });
  },

  // ---- SSH hosts (desktop host only; not mirrored in the Vite dev plugin) ----
  // Folders on a saved host are addressed as `ssh://{connectionId}/remote/path` and work with
  // listDirectory, readPreview, copy/move/rename/delete etc. like local paths.

  async sshList(): Promise<SshConnection[]> {
    const res = await postApi<{ connections: SshConnection[] }>('sshList');
    return res.connections ?? [];
  },

  async sshAdd(req: SshAddRequest): Promise<SshConnection> {
    const res = await postApi<{ connection: SshConnection }>('sshAdd', { ...req });
    return res.connection;
  },

  async sshRemove(id: string): Promise<{ ok: boolean }> {
    return postApi('sshRemove', { id });
  },

  /** Opens (or reuses) the SFTP session; use it to test a host before browsing it. */
  async sshConnect(id: string): Promise<SshConnectResult> {
    return postApi<SshConnectResult>('sshConnect', { id });
  },

  /** Disks mounted on the host (connects if needed). Empty for hosts without a Linux-style mount table. */
  async sshDrives(id: string): Promise<SshDrive[]> {
    const res = await postApi<{ drives: SshDrive[] }>('sshDrives', { id });
    return res.drives ?? [];
  },

  async sshDisconnect(id: string): Promise<{ ok: boolean }> {
    return postApi('sshDisconnect', { id });
  },

  /** Forgets the pinned host key, e.g. after the remote machine was reinstalled. */
  async sshResetHostKey(id: string): Promise<{ ok: boolean }> {
    return postApi('sshResetHostKey', { id });
  },
};
