import React from 'react';

export function hasFileDragData(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types || []);
  return (
    types.includes('application/x-rook-paths') ||
    types.includes('Files') ||
    types.includes('text/plain')
  );
}

export async function handleFileDropToDir(
  e: React.DragEvent | DragEvent,
  targetDir: string,
  dropEntriesToDir: (sourcePaths: string[], targetDir: string, copy?: boolean) => Promise<void>
): Promise<void> {
  e.preventDefault();
  e.stopPropagation();

  const dt = e.dataTransfer;
  if (!dt || !targetDir) return;

  const copy = Boolean(e.ctrlKey);

  // 1. Check Rook internal or cross-window path list
  const rawRook = dt.getData('application/x-rook-paths');
  if (rawRook) {
    try {
      const parsed: string[] = JSON.parse(rawRook);
      if (Array.isArray(parsed) && parsed.length > 0) {
        await dropEntriesToDir(parsed, targetDir, copy);
        return;
      }
    } catch {}
  }

  // 2. Check Windows Explorer native file drop via WebView2 AdditionalObjects
  if (dt.files && dt.files.length > 0) {
    const webview = (window as any).chrome?.webview;
    if (webview && typeof webview.postMessageWithAdditionalObjects === 'function') {
      try {
        webview.postMessageWithAdditionalObjects(
          { type: 'externalDrop', targetDir, copy },
          Array.from(dt.files)
        );
        return;
      } catch {}
    }
  }

  // 3. Fallback: Check text/plain for newline-separated filesystem paths
  const rawText = dt.getData('text/plain');
  if (rawText) {
    const lines = rawText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => /^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('\\\\') || s.startsWith('/'));
    if (lines.length > 0) {
      await dropEntriesToDir(lines, targetDir, copy);
    }
  }
}
