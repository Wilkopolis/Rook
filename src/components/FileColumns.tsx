import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { FsEntry, SortField } from '../types/fs';
import {
  formatBytes,
  formatRelativeTime,
  formatTimestamp,
  getExtensionBadgeClasses,
  getModifiedHeatStyle,
} from '../utils/format';
import { KenneyIcon } from './KenneyIcon';

/**
 * Detail-view columns (Type / Modified / Modified timestamp / Size), shared by the single-pane
 * workspace layout and each split pane. Visibility and widths live in one module-level store
 * (persisted to localStorage), so every view that shows columns stays in sync.
 */

export type ColumnKey = 'type' | 'modified' | 'modifiedTimestamp' | 'created' | 'size';
export type VisibleColumns = Record<ColumnKey, boolean>;
/** 'name' is the flexible Name column; width 0 means auto (fills the remaining space). */
export type WidthKey = ColumnKey | 'name';
export type ColumnWidths = Record<WidthKey, number>;

const VIS_KEY = 'rook_visible_columns';
const WIDTH_KEY = 'rook_column_widths';

export const DEFAULT_COL_WIDTHS: ColumnWidths = { name: 0, type: 96, modified: 64, modifiedTimestamp: 136, created: 136, size: 96 };
const DEFAULT_VISIBLE: VisibleColumns = { type: false, modified: true, modifiedTimestamp: true, created: false, size: true };
const WIDTH_LIMITS: Record<WidthKey, [number, number]> = {
  name: [80, 1200],
  type: [60, 320],
  modified: [44, 320],
  modifiedTimestamp: [96, 320],
  created: [96, 320],
  size: [64, 260],
};

const COLUMN_ORDER: ColumnKey[] = ['type', 'modified', 'modifiedTimestamp', 'created', 'size'];
const COLUMN_LABELS: Record<ColumnKey, string> = {
  type: 'Type / Extension',
  modified: 'Modified (Relative)',
  modifiedTimestamp: 'Modified (Timestamp)',
  created: 'Created (Timestamp)',
  size: 'Size',
};

const clampWidth = (key: WidthKey, w: number) => {
  if (key === 'name' && w <= 0) return 0;
  const [min, max] = WIDTH_LIMITS[key];
  return Math.max(min, Math.min(max, w));
};

const parseVisible = (p: any): VisibleColumns => {
  return {
        type: Boolean(p.type),
        modified: p.modified !== undefined ? Boolean(p.modified) : true,
        modifiedTimestamp: p.modifiedTimestamp !== undefined ? Boolean(p.modifiedTimestamp) : true,
        created: Boolean(p.created),
        size: p.size !== undefined ? Boolean(p.size) : true,
  };
};

const loadVisible = (): VisibleColumns => {
  try {
    const saved = localStorage.getItem(VIS_KEY);
    if (saved) return parseVisible(JSON.parse(saved));
  } catch {}
  return DEFAULT_VISIBLE;
};

const parseWidths = (p: any): ColumnWidths => {
  return {
        name: clampWidth('name', Number(p.name) || 0),
        type: clampWidth('type', Number(p.type) || DEFAULT_COL_WIDTHS.type),
        modified: clampWidth('modified', Number(p.modified) || DEFAULT_COL_WIDTHS.modified),
        modifiedTimestamp: clampWidth(
          'modifiedTimestamp',
          Number(p.modifiedTimestamp) || DEFAULT_COL_WIDTHS.modifiedTimestamp,
        ),
        created: clampWidth('created', Number(p.created) || DEFAULT_COL_WIDTHS.created),
        size: clampWidth('size', Number(p.size) || DEFAULT_COL_WIDTHS.size),
  };
};

const loadWidths = (): ColumnWidths => {
  try {
    const saved = localStorage.getItem(WIDTH_KEY);
    if (saved) return parseWidths(JSON.parse(saved));
  } catch {}
  return DEFAULT_COL_WIDTHS;
};

interface ColumnState {
  visible: VisibleColumns;
  widths: ColumnWidths;
  resizing: WidthKey | null;
}

let state: ColumnState = { visible: loadVisible(), widths: loadWidths(), resizing: null };
const listeners = new Set<() => void>();
const emit = (next: Partial<ColumnState>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

// Pinned workspaces write new column settings to localStorage and announce it with this event.
if (typeof window !== 'undefined') {
  window.addEventListener('rook-columns-restored', () =>
    emit({ visible: loadVisible(), widths: loadWidths() }),
  );
}

let changeHandler: (() => void) | null = null;
/** Called after the user changes visibility or widths (not when a folder's saved columns are applied). */
export const setColumnsChangeHandler = (h: (() => void) | null) => {
  changeHandler = h;
};
export const getColumns = () => ({ visible: state.visible, widths: state.widths });
/** Shows a folder's saved columns without announcing a user change. */
export const applyColumns = (c: { visible?: unknown; widths?: unknown }) => {
  const visible = c.visible ? parseVisible(c.visible) : state.visible;
  const widths = c.widths ? parseWidths(c.widths) : state.widths;
  try {
    localStorage.setItem(VIS_KEY, JSON.stringify(visible));
    localStorage.setItem(WIDTH_KEY, JSON.stringify(widths));
  } catch {}
  emit({ visible, widths });
};

const saveWidths = (widths: ColumnWidths) => {
  try {
    localStorage.setItem(WIDTH_KEY, JSON.stringify(widths));
  } catch {}
  emit({ widths });
};

export const columnActions = {
  toggle(key: ColumnKey) {
    const visible = { ...state.visible, [key]: !state.visible[key] };
    try {
      localStorage.setItem(VIS_KEY, JSON.stringify(visible));
    } catch {}
    emit({ visible });
    changeHandler?.();
  },
  resetWidth(key: WidthKey) {
    saveWidths({ ...state.widths, [key]: DEFAULT_COL_WIDTHS[key] });
    changeHandler?.();
  },
  resetAllWidths() {
    saveWidths(DEFAULT_COL_WIDTHS);
    changeHandler?.();
  },
  startResize(e: React.MouseEvent, key: WidthKey) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth =
      key === 'name' && !state.widths.name
        ? (e.currentTarget as HTMLElement).parentElement?.offsetWidth ?? 200
        : state.widths[key];
    emit({ resizing: key });
    const onMove = (m: MouseEvent) =>
      saveWidths({ ...state.widths, [key]: clampWidth(key, startWidth + m.clientX - startX) });
    const onUp = () => {
      emit({ resizing: null });
      changeHandler?.();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  },
};

export const useFileColumns = (): ColumnState => useSyncExternalStore(subscribe, () => state);

const SortIcon: React.FC<{ field: SortField; sortBy: SortField; sortAsc: boolean }> = ({
  field,
  sortBy,
  sortAsc,
}) =>
  sortBy === field ? (
    <KenneyIcon name={sortAsc ? 'caretUp' : 'caretDown'} size={12} className="text-[var(--foreground)]" />
  ) : null;

const ResizeHandle: React.FC<{ col: WidthKey; resizing: WidthKey | null }> = ({ col, resizing }) => (
  <div
    onMouseDown={(e) => columnActions.startResize(e, col)}
    onDoubleClick={(e) => {
      e.stopPropagation();
      columnActions.resetWidth(col);
    }}
    title="Drag to resize column • Double-click to reset"
    className="absolute right-0 top-0 bottom-0 w-2 -mr-1 cursor-col-resize flex items-center justify-center group z-20"
  >
    <div
      className={`w-[2px] h-3.5 rounded-full transition-colors ${
        resizing === col ? 'bg-sky-400' : 'bg-[var(--border)] group-hover:bg-sky-400'
      }`}
    />
  </div>
);

interface HeaderProps {
  sortBy: SortField;
  sortAsc: boolean;
  onSort: (field: SortField) => void;
  /** Extra classes (padding, stickiness) for the header row. */
  className?: string;
  /** Min-width class for the Name column; keep it equal to the rows' name cell. */
  nameMinWidth?: string;
}

/** Sortable, resizable column header row. Right-click opens the column picker. */
export const FileColumnHeader: React.FC<HeaderProps> = ({
  sortBy,
  sortAsc,
  onSort,
  className = '',
  nameMinWidth = 'min-w-[140px]',
}) => {
  const { visible, widths, resizing } = useFileColumns();
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!menuPos) return;
    const close = () => setMenuPos(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuPos]);

  return (
    <>
      <div
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenuPos({
            x: Math.min(e.clientX, window.innerWidth - 210),
            y: Math.min(e.clientY, window.innerHeight - 250),
          });
        }}
        title="Click a column to sort • Drag handles to resize • Right-click to choose columns"
        className={`flex items-center py-1.5 border-b border-[var(--border)] text-xs font-semibold text-[var(--foreground)]/80 select-none bg-[var(--sidebar)] ${className}`}
      >
        <div
          style={widths.name ? { width: widths.name } : undefined}
          className={`${widths.name ? 'shrink-0' : 'flex-1'} ${nameMinWidth} flex items-center relative pr-2`}
        >
          <button
            type="button"
            onClick={() => onSort('name')}
            className="w-full flex items-center gap-1.5 text-left hover:text-[var(--foreground)] cursor-pointer truncate"
          >
            <span>Name</span>
            <SortIcon field="name" sortBy={sortBy} sortAsc={sortAsc} />
          </button>
          <ResizeHandle col="name" resizing={resizing} />
        </div>

        {visible.type && (
          <div style={{ width: widths.type }} className="shrink-0 flex items-center relative px-2.5">
            <button
              type="button"
              onClick={() => onSort('extension')}
              className="w-full flex items-center gap-1.5 text-left hover:text-[var(--foreground)] cursor-pointer truncate"
            >
              <span>Type</span>
              <SortIcon field="extension" sortBy={sortBy} sortAsc={sortAsc} />
            </button>
            <ResizeHandle col="type" resizing={resizing} />
          </div>
        )}

        {visible.modified && (
          <div style={{ width: widths.modified }} className="shrink-0 flex items-center justify-center relative px-2">
            <button
              type="button"
              onClick={() => onSort('modified')}
              title="Sort by Modified Date"
              className="w-full flex items-center justify-center gap-1 text-center hover:text-[var(--foreground)] cursor-pointer truncate"
            >
              <KenneyIcon name="clock" size={14} />
              <SortIcon field="modified" sortBy={sortBy} sortAsc={sortAsc} />
            </button>
            <ResizeHandle col="modified" resizing={resizing} />
          </div>
        )}

        {visible.modifiedTimestamp && (
          <div style={{ width: widths.modifiedTimestamp }} className="shrink-0 flex items-center relative px-2.5">
            <button
              type="button"
              onClick={() => onSort('modified')}
              className="w-full flex items-center gap-1.5 text-left hover:text-[var(--foreground)] cursor-pointer truncate"
            >
              <span>Modified</span>
              <SortIcon field="modified" sortBy={sortBy} sortAsc={sortAsc} />
            </button>
            <ResizeHandle col="modifiedTimestamp" resizing={resizing} />
          </div>
        )}

        {visible.created && (
          <div style={{ width: widths.created }} className="shrink-0 flex items-center relative px-2.5">
            <button
              type="button"
              onClick={() => onSort('created')}
              className="w-full flex items-center gap-1.5 text-left hover:text-[var(--foreground)] cursor-pointer truncate"
            >
              <span>Created</span>
              <SortIcon field="created" sortBy={sortBy} sortAsc={sortAsc} />
            </button>
            <ResizeHandle col="created" resizing={resizing} />
          </div>
        )}

        {visible.size && (
          <div style={{ width: widths.size }} className="shrink-0 flex items-center justify-end relative px-2.5">
            <button
              type="button"
              onClick={() => onSort('size')}
              className="w-full flex items-center justify-end gap-1.5 text-right hover:text-[var(--foreground)] cursor-pointer truncate"
            >
              <span>Size</span>
              <SortIcon field="size" sortBy={sortBy} sortAsc={sortAsc} />
            </button>
            <ResizeHandle col="size" resizing={resizing} />
          </div>
        )}
      </div>

      {menuPos && (
        <div
          style={{ left: menuPos.x, top: menuPos.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          className="fixed z-50 w-48 rounded-lg bg-[var(--card)] border border-[var(--border)] shadow-2xl py-1.5 text-xs font-normal select-none"
        >
          <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] border-b border-[var(--border)]/60 mb-1">
            Visible Columns
          </div>
          <div className="px-3 py-1.5 flex items-center justify-between text-[var(--muted-foreground)] opacity-60 cursor-default">
            <span>Name</span>
            <KenneyIcon name="checkmark" size={13} />
          </div>
          {COLUMN_ORDER.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => columnActions.toggle(key)}
              className="w-full px-3 py-1.5 flex items-center justify-between text-left hover:bg-[var(--foreground)]/[0.06] text-[var(--foreground)] cursor-pointer"
            >
              <span>{COLUMN_LABELS[key]}</span>
              {visible[key] ? (
                <KenneyIcon name="checkmark" size={13} className="text-sky-400" />
              ) : (
                <span className="w-3.5 h-3.5 rounded border border-[var(--border)]" />
              )}
            </button>
          ))}
          <div className="border-t border-[var(--border)]/60 mt-1 pt-1">
            <button
              type="button"
              onClick={() => {
                columnActions.resetAllWidths();
                setMenuPos(null);
              }}
              className="w-full px-3 py-1.5 text-left text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--foreground)]/[0.06] cursor-pointer"
            >
              Reset Column Widths
            </button>
          </div>
        </div>
      )}
    </>
  );
};

/** The non-name cells of a row, matching FileColumnHeader. */
export const FileColumnCells: React.FC<{ entry: FsEntry }> = ({ entry: f }) => {
  const { visible, widths } = useFileColumns();
  return (
    <>
      {visible.type && (
        <div style={{ width: widths.type }} className="shrink-0 px-2.5 flex items-center overflow-hidden">
          {!f.isDirectory && (
            <span
              className={`px-1.5 py-0.5 rounded font-mono text-[11px] leading-tight truncate ${getExtensionBadgeClasses(f)}`}
            >
              {f.extension ? `.${f.extension}` : 'File'}
            </span>
          )}
        </div>
      )}
      {visible.modified && (
        <div style={{ width: widths.modified }} className="shrink-0 px-2 flex items-center justify-center">
          <div
            style={getModifiedHeatStyle(f.modifiedMs)}
            className="w-full px-1.5 py-0.5 rounded border text-[11px] leading-tight text-center truncate transition-colors"
          >
            {formatRelativeTime(f.modifiedMs)}
          </div>
        </div>
      )}
      {visible.modifiedTimestamp && (
        <div
          style={{ width: widths.modifiedTimestamp }}
          className="shrink-0 px-2.5 flex items-center font-mono text-[11px] text-[var(--muted-foreground)] truncate"
        >
          {formatTimestamp(f.modifiedMs)}
        </div>
      )}
      {visible.created && (
        <div
          style={{ width: widths.created }}
          className="shrink-0 px-2.5 flex items-center font-mono text-[11px] text-[var(--muted-foreground)] truncate"
        >
          {formatTimestamp(f.createdMs ?? f.modifiedMs)}
        </div>
      )}
      {visible.size && (
        <div
          style={{ width: widths.size }}
          className="shrink-0 px-2.5 text-right font-mono text-[var(--muted-foreground)] truncate"
        >
          {formatBytes(f.sizeBytes, f.isDirectory)}
        </div>
      )}
    </>
  );
};
