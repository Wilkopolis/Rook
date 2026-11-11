import { SSH_PATH_PREFIX } from '../types/fs';

/** True for paths on an SSH host (`ssh://{connectionId}/remote/path`). */
export function isSshPath(path: string | null | undefined): path is string {
  return !!path && path.toLowerCase().startsWith(SSH_PATH_PREFIX);
}

/** Splits an SSH path into its connection id and absolute POSIX remote path. */
export function parseSshPath(path: string): { id: string; remotePath: string } | null {
  if (!isSshPath(path)) return null;
  const rest = path.slice(SSH_PATH_PREFIX.length).split('\\').join('/');
  const slash = rest.indexOf('/');
  const id = slash < 0 ? rest : rest.slice(0, slash);
  if (!id) return null;
  return { id, remotePath: normalizeRemotePath(slash < 0 ? '/' : rest.slice(slash)) };
}

export function buildSshPath(id: string, remotePath = '/'): string {
  return `${SSH_PATH_PREFIX}${id}${normalizeRemotePath(remotePath)}`;
}

/** Mirrors SshManager.NormalizeRemotePath on the host: resolves `.`/`..` and collapses slashes. */
export function normalizeRemotePath(remotePath: string): string {
  const parts: string[] = [];
  for (const seg of remotePath.split('\\').join('/').split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return '/' + parts.join('/');
}
