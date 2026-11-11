import { FsEntry } from '../types/fs';

export function formatBytes(bytes: number, isDirectory = false): string {
  if (isDirectory && bytes < 0) return '…';
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val < 10 && i > 0 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

export function formatRelativeTime(ms: number): string {
  if (!ms) return '--';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  const mins = Math.max(1, Math.floor(diffSec / 60));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(diffSec / 3600);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(diffSec / 86400);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30.4375);
  if (days < 365) return `${Math.max(1, months)}M`;
  const years = Math.floor(days / 365.25);
  return `${Math.max(1, years)}Y`;
}

export function formatTimestamp(ms: number): string {
  if (!ms) return '--';
  const d = new Date(ms);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${mins}`;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function formatBitrate(bitsPerSec: number): string {
  if (bitsPerSec >= 1_000_000) return `${(bitsPerSec / 1_000_000).toFixed(1)} Mbps`;
  return `${Math.round(bitsPerSec / 1000)} kbps`;
}

export function getModifiedHeatStyle(ms: number): {
  backgroundColor?: string;
  borderColor?: string;
  color?: string;
} {
  if (!ms) return { color: 'var(--muted-foreground)', borderColor: 'transparent' };
  const diffMin = (Date.now() - ms) / 60000;
  if (diffMin < 0) return { color: 'var(--muted-foreground)', borderColor: 'transparent' };

  let hue = 0;
  let t = 1; // 0 = start of window (bright/saturated), 1 = end of window (neutral/pale)

  if (diffMin < 60) {
    // Window 1: Last hour (0m - 60m) -> Red
    hue = 4;
    t = Math.max(0, Math.min(1, diffMin / 60));
  } else if (diffMin < 1440) {
    // Window 2: Last 24 hours (1h - 24h) -> Orange
    hue = 26;
    t = Math.max(0, Math.min(1, (diffMin - 60) / (1440 - 60)));
  } else {
    const diffDays = diffMin / 1440;
    if (diffDays < 30) {
      // Window 3: Last week / days scale (1d - 29d) -> Yellow
      hue = 48;
      if (diffDays <= 7) {
        t = Math.max(0, Math.min(0.85, ((diffDays - 1) / 6) * 0.85));
      } else {
        t = 0.85 + Math.max(0, Math.min(0.15, ((diffDays - 7) / 23) * 0.15));
      }
    } else if (diffDays < 365) {
      // Window 4: Month scale (1M - 11M, 30d - 365d) -> Green
      hue = 142;
      t = Math.max(0, Math.min(1, (diffDays - 30) / (365 - 30)));
    } else {
      // Year+ scale (1Y+) -> Neutral muted
      return {
        color: 'rgba(148, 163, 184, 0.72)',
        backgroundColor: 'transparent',
        borderColor: 'transparent',
      };
    }
  }

  // Interpolate from bright/saturated (t = 0) to neutral/pale (t = 1)
  const bgSat = Math.round(86 - t * 76); // 86% -> 10%
  const textSat = Math.round(92 - t * 82); // 92% -> 10%
  const textLight = Math.round(83 - t * 19); // 83% -> 64%
  const bgAlpha = (0.24 * (1 - t) + 0.025 * t).toFixed(3); // 0.24 -> 0.025
  const borderAlpha = (0.38 * (1 - t) + 0.05 * t).toFixed(3); // 0.38 -> 0.05

  return {
    backgroundColor: `hsla(${hue}, ${bgSat}%, 50%, ${bgAlpha})`,
    borderColor: `hsla(${hue}, ${bgSat}%, 58%, ${borderAlpha})`,
    color: `hsl(${hue}, ${textSat}%, ${textLight}%)`,
  };
}

export function getExtensionBadgeClasses(entry: FsEntry): string {
  if (entry.isDirectory) {
    return 'bg-amber-500/15 text-amber-300 border border-amber-500/30';
  }
  switch (entry.extension.toLowerCase()) {
    case 'ts':
    case 'tsx':
      return 'bg-sky-500/15 text-sky-300 border border-sky-500/30';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'bg-yellow-500/15 text-yellow-200 border border-yellow-500/30';
    case 'rs':
    case 'go':
    case 'html':
    case 'htm':
      return 'bg-orange-500/15 text-orange-300 border border-orange-500/30';
    case 'cs':
    case 'csproj':
    case 'sln':
      return 'bg-violet-500/15 text-violet-300 border border-violet-500/30';
    case 'cpp':
    case 'c':
    case 'h':
    case 'hpp':
    case 'css':
    case 'scss':
      return 'bg-blue-500/15 text-blue-300 border border-blue-500/30';
    case 'py':
    case 'csv':
    case 'sql':
    case 'db':
    case 'sqlite':
      return 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
    case 'svg':
    case 'gif':
    case 'ico':
    case 'bmp':
    case 'psd':
      return 'bg-purple-500/15 text-purple-300 border border-purple-500/30';
    case 'mp4':
    case 'mov':
    case 'webm':
    case 'mkv':
    case 'avi':
    case 'mp3':
    case 'wav':
    case 'ogg':
    case 'flac':
      return 'bg-pink-500/15 text-pink-300 border border-pink-500/30';
    case 'exe':
    case 'bat':
    case 'ps1':
    case 'cmd':
    case 'msi':
    case 'pdf':
      return 'bg-rose-500/15 text-rose-300 border border-rose-500/30';
    case 'zip':
    case 'tar':
    case 'gz':
    case '7z':
    case 'rar':
      return 'bg-amber-500/15 text-amber-200 border border-amber-500/30';
    case 'url':
    case 'lnk':
      return 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30';
    default:
      return 'bg-[var(--background)] text-[var(--foreground)]/85 border border-[var(--border)]';
  }
}

export function getFileIconName(entry: FsEntry): string {
  if (entry.isDirectory) return 'pouch';
  switch (entry.extension.toLowerCase()) {
    case 'rs':
      return 'resource_iron';
    case 'ts':
      return 'file_ts';
    case 'tsx':
      return 'file_tsx';
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'file_js';
    case 'jsx':
      return 'file_jsx';
    case 'html':
    case 'htm':
      return 'file_html';
    case 'css':
    case 'scss':
    case 'less':
      return 'file_css';
    case 'py':
      return 'file_py';
    case 'cs':
    case 'csproj':
    case 'sln':
      return 'file_cs';
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'c':
    case 'h':
    case 'hpp':
      return 'file_cpp';
    case 'sql':
    case 'db':
    case 'sqlite':
      return 'file_sql';
    case 'csv':
      return 'file_csv';
    case 'json':
    case 'toml':
    case 'yaml':
    case 'yml':
    case 'ini':
    case 'env':
      return 'file_ini';
    case 'md':
    case 'mdx':
      return 'file_md';
    case 'pdf':
      return 'file_pdf';
    case 'txt':
    case 'log':
      return 'notepad';
    case 'svg':
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
    case 'gif':
    case 'bmp':
    case 'ico':
    case 'psd':
      return 'file_image';
    case 'mp4':
    case 'mov':
    case 'webm':
    case 'mkv':
    case 'avi':
      return 'film';
    case 'mp3':
    case 'wav':
    case 'ogg':
    case 'flac':
      return 'musicOn';
    case 'exe':
    case 'bat':
    case 'ps1':
    case 'cmd':
    case 'dll':
      return 'wrench';
    case 'zip':
    case 'tar':
    case 'gz':
    case '7z':
    case 'rar':
      return 'tokens_stack';
    case 'url':
    case 'lnk':
      return 'globe';
    default:
      return 'card';
  }
}

export function inferTags(entry: FsEntry, customTags: Record<string, string[]>): string[] {
  const saved = customTags[entry.path] || [];
  const inferred: string[] = [];
  if (entry.isDirectory) inferred.push('folder');
  if (['rs', 'toml'].includes(entry.extension)) inferred.push('rust');
  if (['ts', 'tsx', 'html', 'css'].includes(entry.extension)) inferred.push('ui');
  if (['json', 'toml', 'yaml', 'csproj'].includes(entry.extension)) inferred.push('config');
  if (['md', 'txt', 'svg'].includes(entry.extension)) inferred.push('docs');
  if (['url', 'lnk'].includes(entry.extension.toLowerCase())) inferred.push('link');
  return Array.from(new Set([...saved, ...inferred]));
}
