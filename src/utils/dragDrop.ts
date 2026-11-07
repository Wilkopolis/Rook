import React from 'react';
import { useExplorerStore } from '../store/useExplorerStore';

export interface DroppedUrlEntry {
  url: string;
  title?: string;
}

/** Check whether a drag payload contains Rook internal paths, files, or text/URLs. */
export function hasFileDragData(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types || []);
  return (
    types.includes('application/x-rook-paths') ||
    types.includes('Files') ||
    types.includes('text/uri-list') ||
    types.includes('text/x-moz-url') ||
    types.includes('text/plain')
  );
}

export const hasDragData = hasFileDragData;

/** Specifically checks if drag payload indicates a URL from a web browser. */
export function hasUrlDragData(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types || []);
  return types.includes('text/uri-list') || types.includes('text/x-moz-url');
}

/**
 * Sets the appropriate dropEffect based on the source's effectAllowed and modifiers.
 * URLs and link drags are given 'copy' or 'link' (avoiding 'move' which browsers reject).
 */
export function setAppropriateDropEffect(
  dt: DataTransfer,
  isCopyModifier: boolean
): void {
  const allowed = (dt.effectAllowed || 'all').toLowerCase();
  const isUrl = hasUrlDragData(dt);

  if (isUrl) {
    if (allowed === 'link' || allowed === 'linkmove') {
      dt.dropEffect = 'link';
    } else {
      dt.dropEffect = 'copy';
    }
    return;
  }

  const preferred = isCopyModifier ? 'copy' : 'move';
  if (allowed === 'all' || allowed === 'uninitialized' || allowed.includes(preferred)) {
    dt.dropEffect = preferred;
  } else if (allowed.includes('copy')) {
    dt.dropEffect = 'copy';
  } else if (allowed.includes('link')) {
    dt.dropEffect = 'link';
  } else if (allowed.includes('move')) {
    dt.dropEffect = 'move';
  } else {
    dt.dropEffect = 'none';
  }
}

/**
 * Validates whether a string is an external browser URL (http, https, ftp, ftps).
 * Excludes local Windows drives, UNC paths, and Unix root paths.
 */
export function isValidBrowserUrl(str: string): boolean {
  if (!str) return false;
  const trimmed = str.trim();
  if (/^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\') || trimmed.startsWith('/')) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    return (
      parsed.protocol === 'http:' ||
      parsed.protocol === 'https:' ||
      parsed.protocol === 'ftp:' ||
      parsed.protocol === 'ftps:'
    );
  } catch {
    return false;
  }
}

/**
 * Sanitizes a proposed base filename for the Windows filesystem.
 * Removes illegal characters (<>:"/\|?* and control characters),
 * strips leading/trailing periods and spaces, trims to a max length,
 * and guards against reserved DOS/Windows device names (CON, PRN, etc.).
 */
export function sanitizeShortcutFileName(rawName: string, maxLength = 200): string {
  if (!rawName) return '';
  // Replace illegal characters and ASCII control chars with space
  let clean = rawName.replace(/[<>:"/\\|?*\x00-\x1F]+/g, ' ');
  // Collapse whitespace
  clean = clean.replace(/\s+/g, ' ');
  // Strip leading and trailing spaces and dots (invalid in Windows file names)
  clean = clean.replace(/^[\s.]+|[\s.]+$/g, '');

  // Guard against Windows reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9)
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(clean)) {
    clean = `_${clean}`;
  }

  // Truncate to maximum length safely
  if (clean.length > maxLength) {
    clean = clean.slice(0, maxLength).replace(/[\s.]+$/, '');
  }

  return clean;
}

/**
 * Derives a clean, Windows-safe shortcut filename (without .url extension)
 * from a dropped URL and optional title/link text.
 */
export function generateUrlShortcutName(url: string, title?: string): string {
  if (title) {
    const sanitizedTitle = sanitizeShortcutFileName(title);
    if (sanitizedTitle.length > 0) {
      return sanitizedTitle;
    }
  }

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '');
    const pathname = parsed.pathname.replace(/\/+$/, '');
    const segments = pathname.split('/').filter(Boolean);

    if (segments.length > 0) {
      // Decode last segment and remove any typical web file extension (.html, .php, etc.)
      let lastSegment = '';
      try {
        lastSegment = decodeURIComponent(segments[segments.length - 1]);
      } catch {
        lastSegment = segments[segments.length - 1];
      }
      lastSegment = lastSegment.replace(/\.[a-zA-Z0-9]{1,5}$/, '');

      // If the last segment is a generic index/home page, try the preceding segment if available
      const genericNames = ['index', 'default', 'home', 'main'];
      if (genericNames.includes(lastSegment.toLowerCase()) && segments.length > 1) {
        try {
          lastSegment = decodeURIComponent(segments[segments.length - 2]);
        } catch {
          lastSegment = segments[segments.length - 2];
        }
        lastSegment = lastSegment.replace(/\.[a-zA-Z0-9]{1,5}$/, '');
      }

      const sanitizedSegment = sanitizeShortcutFileName(lastSegment, 60);

      if (sanitizedSegment.length > 0 && host) {
        const candidate = sanitizeShortcutFileName(`${host} - ${sanitizedSegment}`);
        if (candidate.length > 0) return candidate;
      } else if (sanitizedSegment.length > 0) {
        return sanitizedSegment;
      }
    }

    if (host) {
      const sanitizedHost = sanitizeShortcutFileName(host);
      if (sanitizedHost.length > 0) return sanitizedHost;
    }
  } catch {}

  return 'Shortcut';
}

/**
 * Builds the content of a Windows Internet Shortcut (.url) file.
 * Uses CRLF line endings as standard for Windows INI / .url files.
 */
export function buildInternetShortcutContent(url: string): string {
  const cleanUrl = url.trim();
  return `[InternetShortcut]\r\nURL=${cleanUrl}\r\n`;
}

/** Extracts href and human-readable link text from HTML snippets (e.g. Chrome/Firefox link drags). */
function extractHtmlLinkInfo(html: string): { url?: string; title?: string } | null {
  try {
    if (typeof DOMParser === 'undefined') return null;
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const a = doc.querySelector('a[href]');
    if (a) {
      const href = a.getAttribute('href') || undefined;
      let text = a.textContent?.trim();
      if (!text) {
        text = a.getAttribute('title')?.trim() || a.getAttribute('aria-label')?.trim();
      }
      if (!text) {
        const img = a.querySelector('img[alt]');
        if (img) {
          text = img.getAttribute('alt')?.trim();
        }
      }
      return { url: href, title: text || undefined };
    }
  } catch {}
  return null;
}

/**
 * Extracts URLs and optional titles dropped from a web browser.
 * Handles text/x-moz-url (Firefox), text/uri-list (RFC 2483), text/html (link text), and text/plain.
 */
export function extractDroppedUrls(dt: DataTransfer): DroppedUrlEntry[] {
  const results: DroppedUrlEntry[] = [];
  const seenUrls = new Set<string>();

  // 1. Firefox text/x-moz-url: "url\ntitle"
  try {
    const mozUrl = dt.getData('text/x-moz-url');
    if (mozUrl) {
      const lines = mozUrl.split(/\r?\n/).map((s) => s.trim());
      if (lines.length > 0 && isValidBrowserUrl(lines[0])) {
        const url = lines[0];
        const title = lines[1] || undefined;
        results.push({ url, title });
        seenUrls.add(url);
      }
    }
  } catch {}

  // 2. HTML anchor tag (often carries link text as title)
  let htmlUrl: string | undefined;
  let htmlTitle: string | undefined;
  try {
    const rawHtml = dt.getData('text/html');
    if (rawHtml) {
      const info = extractHtmlLinkInfo(rawHtml);
      if (info?.url && isValidBrowserUrl(info.url)) {
        htmlUrl = info.url;
        htmlTitle = info.title;
      }
    }
  } catch {}

  // 3. text/uri-list (standard for browser URL drags)
  try {
    const uriList = dt.getData('text/uri-list');
    if (uriList) {
      const lines = uriList
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith('#'));
      for (const line of lines) {
        if (isValidBrowserUrl(line) && !seenUrls.has(line)) {
          const title = line === htmlUrl ? htmlTitle : undefined;
          results.push({ url: line, title });
          seenUrls.add(line);
        }
      }
    }
  } catch {}

  // 4. Fallback: text/plain
  if (results.length === 0) {
    try {
      const plain = dt.getData('text/plain');
      if (plain) {
        const lines = plain
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        for (const line of lines) {
          if (isValidBrowserUrl(line) && !seenUrls.has(line)) {
            const title = line === htmlUrl ? htmlTitle : undefined;
            results.push({ url: line, title });
            seenUrls.add(line);
          }
        }
      }
    } catch {}
  }

  // 5. If HTML had a valid URL and neither uri-list nor plain provided it
  if (results.length === 0 && htmlUrl && !seenUrls.has(htmlUrl)) {
    results.push({ url: htmlUrl, title: htmlTitle });
  }

  return results;
}

export async function handleFileDropToDir(
  e: React.DragEvent | DragEvent,
  targetDir: string,
  dropEntriesToDir: (sourcePaths: string[], targetDir: string, copy?: boolean) => Promise<void>,
  dropUrlToDir?: (url: string, targetDir: string, title?: string) => Promise<any>
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

  // 3. Check for URLs dropped from a web browser
  const droppedUrls = extractDroppedUrls(dt);
  if (droppedUrls.length > 0) {
    const urlHandler = dropUrlToDir ?? useExplorerStore.getState().dropUrlToDir;
    if (urlHandler) {
      for (const entry of droppedUrls) {
        await urlHandler(entry.url, targetDir, entry.title);
      }
      return;
    }
  }

  // 4. Fallback: Check text/plain for newline-separated filesystem paths
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

export const handleDropToDir = handleFileDropToDir;
