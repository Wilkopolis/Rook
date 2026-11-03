import { logger } from './logger';
import { fsService, setApiTimingListener } from './fsService';

/** Store actions that fire on timers/polling or per keystroke; logging them would drown out real user actions. */
const SILENT_STORE_ACTIONS = new Set([
  'checkDirWatcher',
  'refreshThumbStats',
  'refreshFolderSizeStats',
  'refreshLogSettings',
  'setFilterQuery',
  'runDeepSearch',
  'setActivePane',
  'closeContextMenu',
]);

/** API calls that are polled, user-paced (window drag/resize block until mouse-up) or are the logger itself. */
const UNTIMED_API_ACTIONS = new Set([
  'log',
  'logSettings',
  'dirVersion',
  'winDrag',
  'winResize',
  'thumbStats',
  'folderSizeStats',
  'saveUiState',
]);

const LONG_TASK_THRESHOLD_MS = 150;

function summarizeArg(arg: unknown, depth = 0): unknown {
  if (arg === null || arg === undefined) return arg;
  if (typeof arg === 'string') return arg.length > 300 ? arg.slice(0, 300) + '…' : arg;
  if (typeof arg === 'number' || typeof arg === 'boolean') return arg;
  if (typeof arg === 'function') return '[fn]';
  if (typeof Event !== 'undefined' && arg instanceof Event) return `[event ${arg.type}]`;
  if (typeof arg === 'object' && 'nativeEvent' in arg) {
    return `[event ${String((arg as unknown as { type?: unknown }).type)}]`;
  }
  if (Array.isArray(arg)) {
    if (arg.length > 5) return { count: arg.length, first: summarizeArg(arg[0], depth + 1) };
    return arg.map((a) => summarizeArg(a, depth + 1));
  }
  if (typeof arg === 'object') {
    const obj = arg as Record<string, unknown>;
    if (typeof obj.path === 'string' && 'isDirectory' in obj) return obj.path;
    if (depth > 1) return '[object]';
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj).slice(0, 12)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        out[k] = summarizeArg(v, depth + 1);
      } else if (Array.isArray(v)) {
        out[k] = `[${v.length} items]`;
      }
    }
    return out;
  }
  return String(arg);
}

type AnyStore = {
  getState: () => object;
  setState: (partial: Record<string, unknown>) => void;
};

/**
 * Wraps every store action so user actions (navigation, file ops, layout/sidebar toggles…) are logged,
 * async actions are timed, and failures inside actions are captured with their arguments.
 */
export function instrumentStore(store: AnyStore) {
  const state = store.getState() as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(state)) {
    if (typeof value !== 'function') continue;
    const original = value as (...args: unknown[]) => unknown;
    const silent = SILENT_STORE_ACTIONS.has(name);
    patch[name] = (...args: unknown[]) => {
      const summary = args.length ? args.map((a) => summarizeArg(a)) : undefined;
      if (!silent) logger.action(`store.${name}`, summary);
      const started = performance.now();
      let result: unknown;
      try {
        result = original(...args);
      } catch (err) {
        logger.error('action-error', `store.${name} threw: ${(err as Error)?.message ?? err}`, { error: err, args: summary });
        throw err;
      }
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        return (result as Promise<unknown>).then(
          (v) => {
            if (!silent) logger.perf(`store.${name}`, performance.now() - started, summary);
            return v;
          },
          (err) => {
            logger.error('action-error', `store.${name} rejected: ${err?.message ?? err}`, { error: err, args: summary });
            throw err;
          }
        );
      }
      return result;
    };
  }
  store.setState(patch);
}

function describeElement(el: Element): string {
  const aria = el.getAttribute('aria-label');
  const title = el.getAttribute('title');
  const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
  const label = aria || title || text || el.tagName.toLowerCase();
  return label.length > 80 ? label.slice(0, 80) + '…' : label;
}

function installUserActionLogging() {
  const onClick = (e: MouseEvent) => {
    const target = e.target as Element | null;
    const el = target?.closest?.('button, a, [role="button"], [role="tab"], [role="menuitem"], input[type="checkbox"], select');
    if (!el) return;
    logger.action(e.type === 'contextmenu' ? 'right-click' : 'click', { target: describeElement(el) });
  };
  document.addEventListener('click', onClick, true);
  document.addEventListener('contextmenu', onClick, true);

  window.addEventListener(
    'keydown',
    (e) => {
      const t = e.target as HTMLElement | null;
      const inInput = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      const isModified = e.ctrlKey || e.altKey || e.metaKey;
      const isNamedKey = /^(F\d{1,2}|Delete|Enter|Escape|Backspace|Tab)$/.test(e.key);
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
      // Never record plain typed characters; only shortcuts and command keys.
      if (!isModified && !(isNamedKey && !inInput)) return;
      const combo = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta', e.key]
        .filter(Boolean)
        .join('+');
      logger.action('shortcut', { keys: combo, inInput });
    },
    true
  );

  let lastWheelLog = 0;
  window.addEventListener(
    'wheel',
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const now = performance.now();
      if (now - lastWheelLog < 150) return;
      lastWheelLog = now;
      logger.action('ctrl+wheel zoom', { direction: e.deltaY < 0 ? 'in' : 'out' });
    },
    { capture: true, passive: true }
  );

  const watchDevicePixelRatio = () => {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener(
      'change',
      () => {
        logger.action('zoom changed', {
          devicePixelRatio: window.devicePixelRatio,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
        });
        watchDevicePixelRatio();
      },
      { once: true }
    );
  };
  watchDevicePixelRatio();

  let resizeTimer: number | null = null;
  window.addEventListener('resize', () => {
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      logger.action('window resized', { viewport: `${window.innerWidth}x${window.innerHeight}` });
    }, 400);
  });

  document.addEventListener('visibilitychange', () => {
    logger.info('lifecycle', `visibility ${document.visibilityState}`);
  });
}

function installErrorHandlers() {
  window.addEventListener('error', (e) => {
    // Resource load failures (e.g. missing thumbnails) bubble here without an error object; ignore them.
    if (!(e instanceof ErrorEvent)) return;
    logger.error('uncaught', e.message || 'Uncaught error', {
      error: e.error,
      source: `${e.filename}:${e.lineno}:${e.colno}`,
    });
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    logger.error('unhandled-rejection', reason?.message || String(reason), { error: reason });
  });
}

function installPerformanceLogging() {
  setApiTimingListener((action, durationMs, ok, error) => {
    if (UNTIMED_API_ACTIONS.has(action)) return;
    if (ok) logger.perf(`api.${action}`, durationMs);
    else logger.warn('api', `api.${action} failed after ${Math.round(durationMs)}ms: ${error}`);
  });

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration >= LONG_TASK_THRESHOLD_MS) {
          logger.perf('long task (main thread blocked)', entry.duration, { startTime: Math.round(entry.startTime) });
        }
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
  } catch {
    // longtask not supported in this runtime.
  }

  window.addEventListener('load', () => {
    setTimeout(() => {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      if (!nav) return;
      logger.perf('page load', nav.loadEventEnd || nav.duration, {
        domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
        transferSize: nav.transferSize,
      });
    }, 0);
  });
}

let installed = false;

export function installInstrumentation(store: AnyStore) {
  if (installed) return;
  installed = true;
  installErrorHandlers();
  installPerformanceLogging();
  installUserActionLogging();
  instrumentStore(store);
  logger.info('lifecycle', 'UI started', {
    userAgent: navigator.userAgent,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    devicePixelRatio: window.devicePixelRatio,
  });
  // The host injects the flag into index.html; fetch it too for the Vite dev server / stale pages.
  void fsService.getLogSettings().then((s) => logger.setEnabled(!!s.enabled));
}
