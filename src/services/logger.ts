import { fsService } from './fsService';
import { LogEntry, LogLevel } from '../types/fs';

declare global {
  interface Window {
    __ROOK_LOGGING_ENABLED__?: boolean;
  }
}

const FLUSH_INTERVAL_MS = 2000;
const MAX_QUEUE = 1000;
const BREADCRUMB_LIMIT = 40;

let enabled = typeof window !== 'undefined' && window.__ROOK_LOGGING_ENABLED__ === true;
let queue: LogEntry[] = [];
let flushTimer: number | null = null;
let flushing = false;
const breadcrumbs: string[] = [];
const listeners = new Set<(enabled: boolean) => void>();

function safeData(data: unknown): unknown {
  if (data === undefined) return undefined;
  try {
    return JSON.parse(
      JSON.stringify(data, (_k, v) => {
        if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
        if (typeof v === 'string' && v.length > 2000) return v.slice(0, 2000) + '…';
        return v;
      })
    );
  } catch {
    return String(data);
  }
}

function scheduleFlush(immediate = false) {
  if (immediate) {
    void flush();
    return;
  }
  if (flushTimer !== null) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
}

async function flush(keepalive = false) {
  if (flushing || queue.length === 0) return;
  flushing = true;
  const batch = queue;
  queue = [];
  try {
    await fsService.writeLogs(batch, keepalive);
  } catch {
    // Host unreachable (e.g. shutting down) — drop the batch rather than retry forever.
  } finally {
    flushing = false;
    if (queue.length > 0) scheduleFlush();
  }
}

function push(level: LogLevel, category: string, message: string, data?: unknown) {
  const always = level === 'error' || level === 'fatal';
  if (!always && !enabled) return;
  if (queue.length >= MAX_QUEUE) queue.shift();
  queue.push({ level, category, message, data: safeData(data), ts: Date.now() });
  scheduleFlush(always);
}

function addBreadcrumb(text: string) {
  breadcrumbs.push(`${new Date().toISOString().slice(11, 23)} ${text}`);
  if (breadcrumbs.length > BREADCRUMB_LIMIT) breadcrumbs.shift();
}

/**
 * Frontend logger. Errors/crashes are always forwarded to the host log (with recent breadcrumbs for context);
 * user actions, performance and info entries are only sent when diagnostic logging is enabled in Options.
 */
export const logger = {
  isEnabled: () => enabled,

  setEnabled(next: boolean) {
    if (enabled === next) return;
    enabled = next;
    listeners.forEach((l) => l(next));
  },

  onEnabledChange(listener: (enabled: boolean) => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  info(category: string, message: string, data?: unknown) {
    push('info', category, message, data);
  },

  warn(category: string, message: string, data?: unknown) {
    addBreadcrumb(`warn ${category}: ${message}`);
    push('warn', category, message, data);
  },

  /** A user-initiated action. Always kept as an in-memory breadcrumb; written to disk only when enabled. */
  action(name: string, data?: unknown) {
    let suffix = '';
    if (data !== undefined) {
      try {
        suffix = ' ' + JSON.stringify(data).slice(0, 200);
      } catch {}
    }
    addBreadcrumb(`action ${name}${suffix}`);
    push('info', 'action', name, data);
  },

  perf(name: string, durationMs: number, data?: unknown) {
    const ms = Math.round(durationMs);
    push(ms >= 1000 ? 'warn' : 'perf', 'perf', `${name} ${ms}ms`, data);
  },

  error(category: string, message: string, data?: unknown) {
    push('error', category, message, { ...(asObject(data)), ...context(), breadcrumbs: [...breadcrumbs] });
  },

  fatal(category: string, message: string, data?: unknown) {
    push('fatal', category, message, { ...(asObject(data)), ...context(), breadcrumbs: [...breadcrumbs] });
  },

  flush,
};

function asObject(data: unknown): Record<string, unknown> {
  if (data === undefined) return {};
  if (data instanceof Error) return { error: { name: data.name, message: data.message, stack: data.stack } };
  if (data && typeof data === 'object' && !Array.isArray(data)) return data as Record<string, unknown>;
  return { detail: data };
}

function context() {
  return {
    url: location.href,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    devicePixelRatio: window.devicePixelRatio,
  };
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => void flush(true));
}
