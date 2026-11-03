import {
  DirListResponse,
  FilePreview,
  FolderSizeStats,
  LogEntry,
  LogSettings,
  SystemInfo,
  ThumbCacheStats,
} from '../types/fs';

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
    if (isTauri() && path) {
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
    if (isTauri()) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke<FilePreview>('read_file_preview', { path });
    }
    return postApi<FilePreview>('preview', { path });
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

  async deleteItem(path: string, permanent = false): Promise<{ ok: boolean }> {
    return postApi('delete', { path, permanent });
  },

  async copyItem(sourcePath: string, destDir: string): Promise<{ ok: boolean; path: string }> {
    return postApi('copy', { sourcePath, destDir });
  },

  async moveItem(sourcePath: string, destDir: string): Promise<{ ok: boolean; path: string }> {
    return postApi('move', { sourcePath, destDir });
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

  async openFile(path: string): Promise<{ ok: boolean }> {
    return postApi('openFile', { path });
  },

  async openWith(app: 'sublime' | 'notepad++', paths: string[] | string): Promise<{ ok: boolean; error?: string }> {
    const list = Array.isArray(paths) ? paths : [paths];
    return postApi('openWith', { app, paths: list });
  },

  async revealInExplorer(path: string): Promise<{ ok: boolean }> {
    return postApi('revealInExplorer', { path });
  },
};
