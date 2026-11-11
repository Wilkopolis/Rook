import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useExplorerStore } from '../store/useExplorerStore';
import { FsEntry, SortField } from '../types/fs';
import {
  formatBytes,
  formatRelativeTime,
  formatTimestamp,
  getExtensionBadgeClasses,
  getModifiedHeatStyle,
} from '../utils/format';
import { KenneyIcon } from './KenneyIcon';
import { FileThumbnail } from './FileThumbnail';
import { SplitPanelsView } from './SplitPanelsView';
import { handleFileDropToDir, hasFileDragData, setAppropriateDropEffect } from '../utils/dragDrop';
import { naturalCompare } from '../utils/naturalSort';

const PANE_COL = { type: 'w-16', size: 'w-20', modified: 'w-32' } as const;

/** Column header bar (Name / Type / Size / Modified) used by each dual-pane side. */
const PaneColumnHeader: React.FC<{
  sortBy: SortField;
  sortAsc: boolean;
  onSort: (field: SortField) => void;
}> = ({ sortBy, sortAsc, onSort }) => {
  const cell = (label: string, field: SortField, cls: string, align = 'text-left') => (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={`${cls} shrink-0 px-2 flex items-center gap-1 ${align} hover:text-[var(--foreground)] cursor-pointer truncate`}
    >
      <span className="truncate">{label}</span>
      {sortBy === field && (
        <KenneyIcon
          name={sortAsc ? 'caretUp' : 'caretDown'}
          size={12}
          className="text-[var(--foreground)]"
        />
      )}
    </button>
  );
  return (
    <div className="flex items-center px-3 py-1 border-b border-[var(--border)] text-[11px] font-semibold text-[var(--foreground)]/80 select-none bg-[var(--sidebar)]">
      <button
        type="button"
        onClick={() => onSort('name')}
        className="flex-1 min-w-0 flex items-center gap-1 text-left hover:text-[var(--foreground)] cursor-pointer truncate"
      >
        <span>Name</span>
        {sortBy === 'name' && (
          <KenneyIcon
            name={sortAsc ? 'caretUp' : 'caretDown'}
            size={12}
            className="text-[var(--foreground)]"
          />
        )}
      </button>
      {cell('Type', 'extension', PANE_COL.type)}
      {cell('Size', 'size', PANE_COL.size, 'justify-end text-right')}
      {cell('Modified', 'modified', PANE_COL.modified)}
    </div>
  );
};

/** Type / Size / Modified cells matching PaneColumnHeader. */
const PaneRowCells: React.FC<{ entry: FsEntry }> = ({ entry }) => (
  <>
    <span className={`${PANE_COL.type} shrink-0 px-2 truncate text-[var(--muted-foreground)]`}>
      {entry.isDirectory ? '' : entry.extension ? `.${entry.extension}` : 'File'}
    </span>
    <span className={`${PANE_COL.size} shrink-0 px-2 text-right font-mono text-[var(--muted-foreground)]`}>
      {formatBytes(entry.sizeBytes, entry.isDirectory)}
    </span>
    <span className={`${PANE_COL.modified} shrink-0 px-2 truncate font-mono text-[11px] text-[var(--muted-foreground)]`}>
      {formatTimestamp(entry.modifiedMs)}
    </span>
  </>
);

export const LayoutsView: React.FC = () => {
  const {
    layout,
    items,
    parentItems,
    parentPath,
    currentPath,
    rightPanePath,
    rightPaneItems,
    rightSortBy,
    rightSortAsc,
    setRightSortBy,
    activePane,
    setActivePane,
    selectedPath,
    selectedPaths,
    clipboard,
    preview,
    filterQuery,
    deepSearch,
    deepSearchResults,
    sortBy,
    sortAsc,
    activeTagFilter,
    showHiddenFiles,
    thumbGridSize,
    setThumbGridSize,
    selectEntry,
    openEntry,
    openContextMenu,
    navigateTo,
    navigateRightPane,
    setSortBy,
    setFilterQuery,
    setActiveTagFilter,
    copySelectedToOtherPane,
    moveSelectedToOtherPane,
    dropEntriesToDir,
    dropUrlToDir,
  } = useExplorerStore();

  // Track the main list's scroll offset (workspace/thumbnails layouts) and save it to the
  // session-only store map when leaving a folder. Tracked in a ref so the value isn't
  // affected by the DOM clamping scrollTop once the next folder's items render.
  const setFolderScrollPosition = useExplorerStore((s) => s.setFolderScrollPosition);
  const lastScrollRef = useRef<{ path: string; top: number }>({ path: currentPath, top: 0 });
  const handleMainScroll = (e: React.UIEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return; // ignore bubbled scrolls from nested lists
    lastScrollRef.current = { path: currentPath, top: e.currentTarget.scrollTop };
  };
  // Layout effect so the cleanup (save for the old folder) runs before the restore for the new
  // one in the same commit, and the restored offset is applied before paint (no visible jump).
  // `items` and `currentPath` are set together by the store, so the new folder's rows are
  // already in the DOM here and scrollTop is not clamped.
  const mainScrollRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (lastScrollRef.current.path !== currentPath) {
      lastScrollRef.current = { path: currentPath, top: 0 };
    }
    const saved = useExplorerStore.getState().folderScrollPositions[currentPath] ?? 0;
    const el = mainScrollRef.current;
    if (el) {
      el.scrollTop = saved;
      lastScrollRef.current = { path: currentPath, top: el.scrollTop };
    }
    return () => {
      const last = lastScrollRef.current;
      if (last.path === currentPath) setFolderScrollPosition(currentPath, last.top);
    };
  }, [currentPath, setFolderScrollPosition]);

  const [dragTargetDir, setDragTargetDir] = useState<string | null>(null);
  const [colMenuPos, setColMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [visibleCols, setVisibleCols] = useState<{
    type: boolean;
    modified: boolean;
    modifiedTimestamp: boolean;
    size: boolean;
  }>(() => {
    try {
      const saved = localStorage.getItem('rook_visible_columns');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          type: Boolean(parsed.type),
          modified: parsed.modified !== undefined ? Boolean(parsed.modified) : true,
          modifiedTimestamp:
            parsed.modifiedTimestamp !== undefined ? Boolean(parsed.modifiedTimestamp) : true,
          size: parsed.size !== undefined ? Boolean(parsed.size) : true,
        };
      }
    } catch {}
    return { type: false, modified: true, modifiedTimestamp: true, size: true };
  });

  const DEFAULT_COL_WIDTHS = {
    type: 96,
    modified: 64,
    modifiedTimestamp: 136,
    size: 96,
  };

  const [colWidths, setColWidths] = useState<typeof DEFAULT_COL_WIDTHS>(() => {
    try {
      const saved = localStorage.getItem('rook_column_widths');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          type: Math.max(60, Math.min(320, Number(parsed.type) || DEFAULT_COL_WIDTHS.type)),
          modified: Math.max(44, Math.min(320, Number(parsed.modified) || DEFAULT_COL_WIDTHS.modified)),
          modifiedTimestamp: Math.max(
            96,
            Math.min(320, Number(parsed.modifiedTimestamp) || DEFAULT_COL_WIDTHS.modifiedTimestamp)
          ),
          size: Math.max(64, Math.min(260, Number(parsed.size) || DEFAULT_COL_WIDTHS.size)),
        };
      }
    } catch {}
    return DEFAULT_COL_WIDTHS;
  });

  const [resizingCol, setResizingCol] = useState<keyof typeof DEFAULT_COL_WIDTHS | null>(null);

  const startColumnResize = (
    e: React.MouseEvent,
    colKey: keyof typeof DEFAULT_COL_WIDTHS,
    minW = 64,
    maxW = 340
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = colWidths[colKey];
    setResizingCol(colKey);

    const onMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startX;
      const nextWidth = Math.max(minW, Math.min(maxW, startWidth + dx));
      setColWidths((prev) => {
        const updated = { ...prev, [colKey]: nextWidth };
        try {
          localStorage.setItem('rook_column_widths', JSON.stringify(updated));
        } catch {}
        return updated;
      });
    };

    const onMouseUp = () => {
      setResizingCol(null);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const resetColumnWidth = (colKey: keyof typeof DEFAULT_COL_WIDTHS) => {
    setColWidths((prev) => {
      const updated = { ...prev, [colKey]: DEFAULT_COL_WIDTHS[colKey] };
      try {
        localStorage.setItem('rook_column_widths', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const toggleColumn = (key: keyof typeof visibleCols) => {
    setVisibleCols((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem('rook_visible_columns', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  useEffect(() => {
    const onRestoreCols = () => {
      try {
        const savedVis = localStorage.getItem('rook_visible_columns');
        if (savedVis) {
          const parsed = JSON.parse(savedVis);
          setVisibleCols({
            type: Boolean(parsed.type),
            modified: parsed.modified !== undefined ? Boolean(parsed.modified) : true,
            modifiedTimestamp:
              parsed.modifiedTimestamp !== undefined ? Boolean(parsed.modifiedTimestamp) : true,
            size: parsed.size !== undefined ? Boolean(parsed.size) : true,
          });
        }
        const savedWidths = localStorage.getItem('rook_column_widths');
        if (savedWidths) {
          const parsed = JSON.parse(savedWidths);
          setColWidths({
            type: Math.max(60, Math.min(320, Number(parsed.type) || DEFAULT_COL_WIDTHS.type)),
            modified: Math.max(44, Math.min(320, Number(parsed.modified) || DEFAULT_COL_WIDTHS.modified)),
            modifiedTimestamp: Math.max(
              96,
              Math.min(320, Number(parsed.modifiedTimestamp) || DEFAULT_COL_WIDTHS.modifiedTimestamp)
            ),
            size: Math.max(64, Math.min(260, Number(parsed.size) || DEFAULT_COL_WIDTHS.size)),
          });
        }
      } catch {}
    };
    window.addEventListener('rook-columns-restored', onRestoreCols);
    return () => window.removeEventListener('rook-columns-restored', onRestoreCols);
  }, []);

  useEffect(() => {
    if (!colMenuPos) return;
    const close = () => setColMenuPos(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [colMenuPos]);

  const filteredItems = useMemo(() => {
    const baseSource =
      deepSearch && filterQuery.trim() !== '' && deepSearchResults
        ? deepSearchResults
        : items;
    let list = [...baseSource];
    if (!showHiddenFiles) {
      list = list.filter((f) => !f.name.startsWith('.'));
    }
    if (!deepSearch && filterQuery.trim() !== '') {
      const q = filterQuery.toLowerCase();
      list = list.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          (f.tags || []).some((t) => t.toLowerCase().includes(q))
      );
    }
    if (layout === 'faceted' && activeTagFilter !== 'all') {
      list = list.filter((f) => (f.tags || []).includes(activeTagFilter));
    }

    list.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      let cmp = 0;
      if (sortBy === 'size') cmp = a.sizeBytes - b.sizeBytes;
      else if (sortBy === 'modified') cmp = a.modifiedMs - b.modifiedMs;
      else if (sortBy === 'extension') cmp = naturalCompare(a.extension, b.extension) || naturalCompare(a.name, b.name);
      else cmp = naturalCompare(a.name, b.name);
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [items, deepSearch, deepSearchResults, showHiddenFiles, filterQuery, layout, activeTagFilter, sortBy, sortAsc]);

  // Dual-pane partition bar: drag to resize the left pane (percent of container width).
  const [leftPanePct, setLeftPanePct] = useState(50);
  const dualPaneRef = useRef<HTMLDivElement | null>(null);
  const [draggingDivider, setDraggingDivider] = useState(false);
  const startDividerDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const box = dualPaneRef.current?.getBoundingClientRect();
    if (!box) return;
    setDraggingDivider(true);
    const onMove = (ev: MouseEvent) => {
      const pct = ((ev.clientX - box.left) / box.width) * 100;
      setLeftPanePct(Math.min(80, Math.max(20, pct)));
    };
    const onUp = () => {
      setDraggingDivider(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Right dual-pane rows use their own sort, independent of the left pane.
  const sortedRightItems = useMemo(() => {
    const list = [...rightPaneItems];
    list.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      let cmp = 0;
      if (rightSortBy === 'size') cmp = a.sizeBytes - b.sizeBytes;
      else if (rightSortBy === 'modified') cmp = a.modifiedMs - b.modifiedMs;
      else if (rightSortBy === 'extension') cmp = naturalCompare(a.extension, b.extension) || naturalCompare(a.name, b.name);
      else cmp = naturalCompare(a.name, b.name);
      return rightSortAsc ? cmp : -cmp;
    });
    return list;
  }, [rightPaneItems, rightSortBy, rightSortAsc]);

  const orderedPaths = useMemo(() => filteredItems.map((i) => i.path), [filteredItems]);

  useEffect(() => {
    if (!selectedPath) return;
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(selectedPath) : selectedPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const el = document.querySelector(`[data-entry-path="${escaped}"]`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedPath]);

  const selectedEntry = items.find((i) => i.path === selectedPath) || filteredItems[0];

  const isEntrySelected = (path: string) =>
    selectedPaths.includes(path) || path === selectedPath;

  const isEntryCut = (path: string) =>
    clipboard?.mode === 'cut' && clipboard.paths.includes(path);

  const handleSelectItem = (e: React.MouseEvent, entry: FsEntry) => {
    selectEntry(entry, {
      ctrl: e.ctrlKey || e.metaKey,
      shift: e.shiftKey,
      orderedPaths,
    });
  };

  const handleOpenItem = (entry: FsEntry) => {
    openEntry(entry);
  };

  const handleItemContextMenu = (e: React.MouseEvent, entry: FsEntry) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu(e.clientX, e.clientY, entry);
  };

  const handleEmptyContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, null);
  };

  const handleDragStart = (e: React.DragEvent, entry: FsEntry) => {
    const paths = isEntrySelected(entry.path) && selectedPaths.length > 0
      ? selectedPaths
      : [entry.path];

    const webview = (window as any).chrome?.webview;
    if (webview && typeof webview.postMessage === 'function') {
      webview.postMessage({ type: 'startDrag', paths });
      e.preventDefault();
      return;
    }

    e.dataTransfer.setData('application/x-rook-paths', JSON.stringify(paths));
    e.dataTransfer.setData('text/plain', paths.join('\n'));
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  const handleFolderDragOver = (e: React.DragEvent, folderPath: string) => {
    if (!hasFileDragData(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setAppropriateDropEffect(e.dataTransfer, e.ctrlKey);
    if (dragTargetDir !== folderPath) {
      setDragTargetDir(folderPath);
    }
  };

  const handleFolderDragLeave = (e: React.DragEvent, folderPath: string) => {
    e.stopPropagation();
    if (dragTargetDir === folderPath) {
      setDragTargetDir(null);
    }
  };

  const handleFolderDrop = async (e: React.DragEvent, folderPath: string) => {
    setDragTargetDir(null);
    await handleFileDropToDir(e, folderPath, dropEntriesToDir, dropUrlToDir);
  };

  const renderSortIcon = (field: SortField) => {
    if (sortBy !== field) return null;
    return (
      <KenneyIcon
        name={sortAsc ? 'caretUp' : 'caretDown'}
        size={12}
        className="text-[var(--foreground)]"
      />
    );
  };

  // 0. SPLIT PANELS (two independent folder views; own component keeps hook order stable)
  if (layout === 'split') {
    return <SplitPanelsView />;
  }

  // 1. MODERN WORKSPACE TABLE
  if (layout === 'workspace') {
    return (
      <section
        ref={mainScrollRef}
        onContextMenu={handleEmptyContextMenu}
        onDragOver={(e) => handleFolderDragOver(e, currentPath)}
        onDragLeave={(e) => handleFolderDragLeave(e, currentPath)}
        onDrop={(e) => handleFolderDrop(e, currentPath)}
        onScroll={handleMainScroll}
        className={`flex-1 flex flex-col bg-[var(--center-bg)] overflow-y-auto relative ${
          dragTargetDir === currentPath ? 'ring-2 ring-inset ring-sky-400/70' : ''
        }`}
      >
        <div
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setColMenuPos({
              x: Math.min(e.clientX, window.innerWidth - 210),
              y: Math.min(e.clientY, window.innerHeight - 250),
            });
          }}
          title="Click a column to sort • Drag handles to resize • Right-click to choose columns"
          className="flex items-center px-4 py-1.5 border-b border-[var(--border)] text-xs font-semibold text-[var(--foreground)]/80 select-none sticky top-0 bg-[var(--sidebar)] z-10 shadow-sm"
        >
          <div className="flex-1 min-w-[140px] flex items-center relative pr-2">
            <button
              type="button"
              onClick={() => setSortBy('name')}
              className="w-full flex items-center gap-1.5 text-left hover:text-[var(--foreground)] cursor-pointer truncate"
            >
              <span>Name</span>
              {renderSortIcon('name')}
            </button>
            {(visibleCols.type ||
              visibleCols.modified ||
              visibleCols.modifiedTimestamp ||
              visibleCols.size) && (
              <div className="absolute right-0 top-0 bottom-0 w-2 -mr-1 flex items-center justify-center pointer-events-none">
                <div className="w-[2px] h-3.5 rounded-full bg-[var(--border)]" />
              </div>
            )}
          </div>

          {visibleCols.type && (
            <div
              style={{ width: `${colWidths.type}px` }}
              className="shrink-0 flex items-center relative px-2.5"
            >
              <button
                type="button"
                onClick={() => setSortBy('extension')}
                className="w-full flex items-center gap-1.5 text-left hover:text-[var(--foreground)] cursor-pointer truncate"
              >
                <span>Type</span>
                {renderSortIcon('extension')}
              </button>
              <div
                onMouseDown={(e) => startColumnResize(e, 'type', 60, 320)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  resetColumnWidth('type');
                }}
                title="Drag to resize column • Double-click to reset"
                className="absolute right-0 top-0 bottom-0 w-2 -mr-1 cursor-col-resize flex items-center justify-center group z-20"
              >
                <div
                  className={`w-[2px] h-3.5 rounded-full transition-colors ${
                    resizingCol === 'type'
                      ? 'bg-sky-400'
                      : 'bg-[var(--border)] group-hover:bg-sky-400'
                  }`}
                />
              </div>
            </div>
          )}

          {visibleCols.modified && (
            <div
              style={{ width: `${colWidths.modified}px` }}
              className="shrink-0 flex items-center justify-center relative px-2"
            >
              <button
                type="button"
                onClick={() => setSortBy('modified')}
                title="Sort by Modified Date"
                className="w-full flex items-center justify-center gap-1 text-center hover:text-[var(--foreground)] cursor-pointer truncate"
              >
                <KenneyIcon name="clock" size={14} />
                {renderSortIcon('modified')}
              </button>
              <div
                onMouseDown={(e) => startColumnResize(e, 'modified', 44, 320)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  resetColumnWidth('modified');
                }}
                title="Drag to resize column • Double-click to reset"
                className="absolute right-0 top-0 bottom-0 w-2 -mr-1 cursor-col-resize flex items-center justify-center group z-20"
              >
                <div
                  className={`w-[2px] h-3.5 rounded-full transition-colors ${
                    resizingCol === 'modified'
                      ? 'bg-sky-400'
                      : 'bg-[var(--border)] group-hover:bg-sky-400'
                  }`}
                />
              </div>
            </div>
          )}

          {visibleCols.modifiedTimestamp && (
            <div
              style={{ width: `${colWidths.modifiedTimestamp}px` }}
              className="shrink-0 flex items-center relative px-2.5"
            >
              <button
                type="button"
                onClick={() => setSortBy('modified')}
                className="w-full flex items-center gap-1.5 text-left hover:text-[var(--foreground)] cursor-pointer truncate"
              >
                <span>Modified</span>
                {renderSortIcon('modified')}
              </button>
              <div
                onMouseDown={(e) => startColumnResize(e, 'modifiedTimestamp', 96, 320)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  resetColumnWidth('modifiedTimestamp');
                }}
                title="Drag to resize column • Double-click to reset"
                className="absolute right-0 top-0 bottom-0 w-2 -mr-1 cursor-col-resize flex items-center justify-center group z-20"
              >
                <div
                  className={`w-[2px] h-3.5 rounded-full transition-colors ${
                    resizingCol === 'modifiedTimestamp'
                      ? 'bg-sky-400'
                      : 'bg-[var(--border)] group-hover:bg-sky-400'
                  }`}
                />
              </div>
            </div>
          )}

          {visibleCols.size && (
            <div
              style={{ width: `${colWidths.size}px` }}
              className="shrink-0 flex items-center justify-end relative px-2.5"
            >
              <button
                type="button"
                onClick={() => setSortBy('size')}
                className="w-full flex items-center justify-end gap-1.5 text-right hover:text-[var(--foreground)] cursor-pointer truncate"
              >
                <span>Size</span>
                {renderSortIcon('size')}
              </button>
              <div
                onMouseDown={(e) => startColumnResize(e, 'size', 64, 260)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  resetColumnWidth('size');
                }}
                title="Drag to resize column • Double-click to reset"
                className="absolute right-0 top-0 bottom-0 w-2 -mr-1 cursor-col-resize flex items-center justify-center group z-20"
              >
                <div
                  className={`w-[2px] h-3.5 rounded-full transition-colors ${
                    resizingCol === 'size'
                      ? 'bg-sky-400'
                      : 'bg-[var(--border)] group-hover:bg-sky-400'
                  }`}
                />
              </div>
            </div>
          )}
        </div>

        {/* Right-Click Column Picker Menu */}
        {colMenuPos && (
          <div
            style={{ left: colMenuPos.x, top: colMenuPos.y }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
            className="fixed z-50 w-48 rounded-lg bg-[#151820] border border-[var(--border)] shadow-2xl py-1.5 text-xs select-none"
          >
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] border-b border-[var(--border)]/60 mb-1">
              Visible Columns
            </div>
            <div className="px-3 py-1.5 flex items-center justify-between text-[var(--muted-foreground)] opacity-60 cursor-default">
              <span>Name</span>
              <KenneyIcon name="checkmark" size={13} />
            </div>
            {(
              [
                { key: 'type', label: 'Type / Extension' },
                { key: 'modified', label: 'Modified (Relative)' },
                { key: 'modifiedTimestamp', label: 'Modified (Timestamp)' },
                { key: 'size', label: 'Size' },
              ] as const
            ).map((col) => (
              <button
                key={col.key}
                type="button"
                onClick={() => toggleColumn(col.key)}
                className="w-full px-3 py-1.5 flex items-center justify-between text-left hover:bg-white/[0.06] text-[var(--foreground)] cursor-pointer"
              >
                <span>{col.label}</span>
                {visibleCols[col.key] ? (
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
                  setColWidths(DEFAULT_COL_WIDTHS);
                  try {
                    localStorage.setItem('rook_column_widths', JSON.stringify(DEFAULT_COL_WIDTHS));
                  } catch {}
                  setColMenuPos(null);
                }}
                className="w-full px-3 py-1.5 text-left text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-white/[0.06] cursor-pointer"
              >
                Reset Column Widths
              </button>
            </div>
          </div>
        )}

        <div className="divide-y divide-[var(--border)]/20 text-xs">
          {filteredItems.map((f) => {
            const isSelected = isEntrySelected(f.path);
            const isCut = isEntryCut(f.path);
            const isDropTarget = f.isDirectory && dragTargetDir === f.path;
            return (
              <div
                key={f.path}
                data-entry-path={f.path}
                draggable
                onDragStart={(e) => handleDragStart(e, f)}
                onDragOver={f.isDirectory ? (e) => handleFolderDragOver(e, f.path) : undefined}
                onDragLeave={f.isDirectory ? (e) => handleFolderDragLeave(e, f.path) : undefined}
                onDrop={f.isDirectory ? (e) => handleFolderDrop(e, f.path) : undefined}
                onClick={(e) => handleSelectItem(e, f)}
                onDoubleClick={() => handleOpenItem(f)}
                onContextMenu={(e) => handleItemContextMenu(e, f)}
                className={`flex items-center px-4 py-1 cursor-pointer ${
                  isSelected ? 'transition-none' : 'transition-colors duration-75'
                } ${
                  isDropTarget
                    ? 'bg-sky-500/20 ring-1 ring-inset ring-sky-400'
                    : isSelected
                      ? 'bg-white/[0.12] text-[var(--foreground)] ring-1 ring-inset ring-slate-400/40 dark:ring-white/[0.22]'
                      : f.isDirectory
                        ? 'bg-white/[0.02] hover:bg-white/[0.05]'
                        : 'hover:bg-white/[0.035]'
                } ${isCut ? 'opacity-50' : ''}`}
              >
                <div className="flex-1 min-w-[140px] flex items-center gap-2 pr-2">
                  <FileThumbnail entry={f} size={18} />
                  <div className="min-w-0 flex flex-col">
                    <span className={`truncate ${f.isDirectory ? 'text-[var(--foreground)]/85' : 'text-[var(--foreground)]'}`}>{f.name}</span>
                    {deepSearch && filterQuery.trim() !== '' && (
                      <span className="text-[10px] text-[var(--muted-foreground)] font-mono truncate">
                        {f.path.replace(currentPath, '').replace(/^[\\/]+/, '')}
                      </span>
                    )}
                  </div>
                </div>
                {visibleCols.type && (
                  <div
                    style={{ width: `${colWidths.type}px` }}
                    className="shrink-0 px-2.5 flex items-center overflow-hidden"
                  >
                    {!f.isDirectory && (
                      <span
                        className={`px-1.5 py-0.5 rounded font-mono text-[11px] leading-tight truncate ${getExtensionBadgeClasses(
                          f
                        )}`}
                      >
                        {f.extension ? `.${f.extension}` : 'File'}
                      </span>
                    )}
                  </div>
                )}
                {visibleCols.modified && (
                  <div
                    style={{ width: `${colWidths.modified}px` }}
                    className="shrink-0 px-2 flex items-center justify-center"
                  >
                    <div
                      style={getModifiedHeatStyle(f.modifiedMs)}
                      className="w-full px-1.5 py-0.5 rounded border text-[11px] leading-tight text-center truncate transition-colors"
                    >
                      {formatRelativeTime(f.modifiedMs)}
                    </div>
                  </div>
                )}
                {visibleCols.modifiedTimestamp && (
                  <div
                    style={{ width: `${colWidths.modifiedTimestamp}px` }}
                    className="shrink-0 px-2.5 flex items-center font-mono text-[11px] text-[var(--muted-foreground)] truncate"
                  >
                    {formatTimestamp(f.modifiedMs)}
                  </div>
                )}
                {visibleCols.size && (
                  <div
                    style={{ width: `${colWidths.size}px` }}
                    className="shrink-0 px-2.5 text-right font-mono text-[var(--muted-foreground)] truncate"
                  >
                    {formatBytes(f.sizeBytes, f.isDirectory)}
                  </div>
                )}
              </div>
            );
          })}
          {filteredItems.length === 0 && (
            <div className="p-8 text-center text-[var(--muted-foreground)]">
              No matching files in this directory.
            </div>
          )}
        </div>
      </section>
    );
  }

  // 2. LARGE THUMBNAIL ICONS GRID
  if (layout === 'thumbnails') {
    const tileMinWidth = Math.max(48, thumbGridSize + 12);
    // Scrollbar scales with the Ctrl+Scroll icon size (96px = default 16px bar).
    const scrollbarSize = Math.round(Math.min(32, Math.max(10, (16 * thumbGridSize) / 96)));
    return (
      <section
        ref={mainScrollRef}
        style={{ '--scrollbar-size': `${scrollbarSize}px` } as React.CSSProperties}
        onContextMenu={handleEmptyContextMenu}
        onDragOver={(e) => handleFolderDragOver(e, currentPath)}
        onDragLeave={(e) => handleFolderDragLeave(e, currentPath)}
        onDrop={(e) => handleFolderDrop(e, currentPath)}
        onScroll={handleMainScroll}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const delta = e.deltaY < 0 ? 12 : -12;
            setThumbGridSize(thumbGridSize + delta);
          }
        }}
        className={`flex-1 flex flex-col bg-[var(--center-bg)] overflow-y-auto relative select-none ${
          dragTargetDir === currentPath ? 'ring-2 ring-inset ring-sky-400/70' : ''
        }`}
      >
        {/* Sticky Top Toolbar: Sort Controls + Thumbnail Size Slider */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-1.5 border-b border-[var(--border)] text-xs bg-[var(--sidebar)] sticky top-0 z-10 shadow-sm">
          <div className="flex items-center gap-1.5">
            <span className="text-[var(--muted-foreground)] mr-1">Sort:</span>
            {(
              [
                { id: 'name', label: 'Name' },
                { id: 'modified', label: 'Modified' },
                { id: 'size', label: 'Size' },
                { id: 'extension', label: 'Type' },
              ] as { id: SortField; label: string }[]
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSortBy(s.id)}
                className={`px-2 py-0.5 rounded flex items-center gap-1 transition-colors cursor-pointer ${
                  sortBy === s.id
                    ? 'bg-white/[0.10] text-[var(--foreground)] font-medium'
                    : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-white/[0.04]'
                }`}
              >
                <span>{s.label}</span>
                {renderSortIcon(s.id)}
              </button>
            ))}
          </div>

          {/* Right: Icon Size Slider */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--muted-foreground)] hidden sm:inline">
              Icon Size
            </span>
            <button
              type="button"
              onClick={() => setThumbGridSize(thumbGridSize - 12)}
              title="Decrease icon size (or Ctrl + Scroll Down)"
              className="w-5 h-5 rounded flex items-center justify-center bg-[var(--background)] border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] cursor-pointer"
            >
              <KenneyIcon name="minus" size={11} />
            </button>
            <input
              type="range"
              min={40}
              max={240}
              step={4}
              value={thumbGridSize}
              onChange={(e) => setThumbGridSize(Number(e.target.value))}
              title={`Icon Size: ${thumbGridSize}px (Ctrl + Scroll to zoom)`}
              className="w-28 h-1.5 accent-sky-400 bg-[var(--background)] rounded-lg cursor-pointer"
            />
            <button
              type="button"
              onClick={() => setThumbGridSize(thumbGridSize + 12)}
              title="Increase icon size (or Ctrl + Scroll Up)"
              className="w-5 h-5 rounded flex items-center justify-center bg-[var(--background)] border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--primary)] cursor-pointer"
            >
              <KenneyIcon name="plus" size={11} />
            </button>
            <button
              type="button"
              onClick={() => setThumbGridSize(96)}
              title="Click to reset icon size to 96px"
              className="px-1.5 py-0.5 rounded bg-[var(--background)] border border-[var(--border)] font-mono text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer min-w-[44px] text-center"
            >
              {thumbGridSize}px
            </button>
          </div>
        </div>

        {/* Thumbnail Icons Grid */}
        <div
          style={{
            gridTemplateColumns: `repeat(auto-fill, minmax(${tileMinWidth}px, 1fr))`,
          }}
          className="grid gap-1.5 p-3"
        >
          {filteredItems.map((f) => {
            const isSelected = isEntrySelected(f.path);
            const isCut = isEntryCut(f.path);
            const isDropTarget = f.isDirectory && dragTargetDir === f.path;
            return (
              <div
                key={f.path}
                data-entry-path={f.path}
                draggable
                onDragStart={(e) => handleDragStart(e, f)}
                onDragOver={f.isDirectory ? (e) => handleFolderDragOver(e, f.path) : undefined}
                onDragLeave={f.isDirectory ? (e) => handleFolderDragLeave(e, f.path) : undefined}
                onDrop={f.isDirectory ? (e) => handleFolderDrop(e, f.path) : undefined}
                onClick={(e) => handleSelectItem(e, f)}
                onDoubleClick={() => handleOpenItem(f)}
                onContextMenu={(e) => handleItemContextMenu(e, f)}
                title={`${f.name}${!f.isDirectory ? ` (${formatBytes(f.sizeBytes)})` : ''}`}
                className={`group rounded-lg p-1.5 flex flex-col items-center gap-1 cursor-pointer border ${
                  isSelected ? 'transition-none' : 'transition-all duration-75'
                } ${
                  isDropTarget
                    ? 'bg-sky-500/20 border-sky-400 shadow-md'
                    : isSelected
                      ? 'bg-white/[0.12] border-slate-300/60 ring-1 ring-inset ring-white/[0.15] text-[var(--foreground)] shadow-sm'
                      : f.isDirectory
                        ? 'bg-white/[0.02] border-white/[0.04] hover:bg-white/[0.05] hover:border-slate-500/40 shadow-xs'
                        : 'bg-transparent border-transparent hover:bg-white/[0.04] hover:border-[var(--border)]/70'
                } ${isCut ? 'opacity-50' : ''}`}
              >
                <div
                  style={{ height: `${thumbGridSize}px`, width: '100%' }}
                  className="flex items-center justify-center overflow-hidden rounded-md"
                >
                  <FileThumbnail
                    entry={f}
                    size={thumbGridSize}
                    className="transition-transform duration-150 group-hover:scale-[1.03] max-w-full max-h-full"
                  />
                </div>
                <div className="w-full text-center flex flex-col items-center px-0.5 min-w-0">
                  <span
                    className={`text-[11px] leading-tight line-clamp-2 break-words font-normal w-full select-none ${
                      f.isDirectory ? 'text-[var(--foreground)]/85' : 'text-[var(--foreground)]/90'
                    }`}
                  >
                    {f.name}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {filteredItems.length === 0 && (
          <div className="p-8 text-center text-xs text-[var(--muted-foreground)]">
            No matching files in this directory.
          </div>
        )}
      </section>
    );
  }

  // 3. MILLER COLUMNS
  if (layout === 'miller') {
    return (
      <div className="flex-1 grid grid-cols-3 divide-x divide-[var(--border)] bg-[var(--center-bg)] text-xs overflow-hidden">
        {/* Column 1: Parent Directory */}
        <div className="flex flex-col overflow-hidden">
          <div className="px-3 py-2 bg-[var(--sidebar)] border-b border-[var(--border)] font-semibold text-[var(--muted-foreground)] truncate">
            {parentPath || 'Root'}
          </div>
          <div className="p-1 space-y-0.5 overflow-y-auto flex-1">
            {parentItems.map((p) => {
              const isCurrentFolder = p.path.toLowerCase() === currentPath.toLowerCase();
              return (
                <div
                  key={p.path}
                  onClick={() => p.isDirectory && navigateTo(p.path)}
                  className={`px-2.5 py-1 rounded-md cursor-pointer flex justify-between items-center ${
                    isCurrentFolder
                      ? 'bg-[var(--primary)]/15 text-[var(--foreground)] font-medium'
                      : 'text-[var(--muted-foreground)] hover:bg-[var(--background)]'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <FileThumbnail entry={p} size={16} />
                    <span className="truncate">{p.name}</span>
                  </span>
                  {p.isDirectory && <KenneyIcon name="caretRight" size={12} />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Column 2: Active Directory */}
        <div
          onContextMenu={handleEmptyContextMenu}
          className="flex flex-col overflow-hidden"
        >
          <div className="px-3 py-2 bg-[var(--sidebar)] border-b border-[var(--border)] font-semibold text-[var(--foreground)]/85 truncate">
            {currentPath.split(/[\\/]/).filter(Boolean).pop() || currentPath}{' '}<span className="text-[var(--muted-foreground)] opacity-40 select-none">\</span>
          </div>
          <div className="p-1 space-y-0.5 overflow-y-auto flex-1">
            {filteredItems.map((f) => {
              const isSelected = isEntrySelected(f.path);
              const isCut = isEntryCut(f.path);
              const isDropTarget = f.isDirectory && dragTargetDir === f.path;
              return (
                <div
                  key={f.path}
                  data-entry-path={f.path}
                  draggable
                  onDragStart={(e) => handleDragStart(e, f)}
                  onDragOver={f.isDirectory ? (e) => handleFolderDragOver(e, f.path) : undefined}
                  onDragLeave={f.isDirectory ? (e) => handleFolderDragLeave(e, f.path) : undefined}
                  onDrop={f.isDirectory ? (e) => handleFolderDrop(e, f.path) : undefined}
                  onClick={(e) => handleSelectItem(e, f)}
                  onDoubleClick={() => handleOpenItem(f)}
                  onContextMenu={(e) => handleItemContextMenu(e, f)}
                  className={`px-2.5 py-1 rounded-md cursor-pointer flex justify-between items-center ${
                    isSelected ? 'transition-none' : 'transition-colors duration-75'
                  } ${
                    isDropTarget
                      ? 'bg-sky-500/20 ring-1 ring-sky-400'
                      : isSelected
                        ? 'bg-white/[0.12] text-[var(--foreground)] ring-1 ring-inset ring-slate-400/40 dark:ring-white/[0.22]'
                        : f.isDirectory
                          ? 'bg-white/[0.02] hover:bg-white/[0.05]'
                          : 'hover:bg-white/[0.035]'
                  } ${isCut ? 'opacity-50' : ''}`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <FileThumbnail entry={f} size={18} />
                    <span className={`truncate ${f.isDirectory ? 'text-[var(--foreground)]/85' : ''}`}>{f.name}</span>
                  </span>
                  <span className="shrink-0 ml-2">
                    {f.isDirectory ? <KenneyIcon name="caretRight" size={12} /> : formatBytes(f.sizeBytes)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Column 3: Child Directory or File Preview */}
        <div className="flex flex-col bg-[var(--background)]/40 overflow-hidden">
          <div className="px-3 py-2 bg-[var(--sidebar)] border-b border-[var(--border)] font-semibold text-[var(--muted-foreground)] truncate">
            {selectedEntry
              ? selectedEntry.isDirectory
                ? `${selectedEntry.name} /`
                : `Preview: ${selectedEntry.name}`
              : 'Preview'}
          </div>
          <div className="p-3 space-y-1.5 overflow-y-auto flex-1">
            {preview?.kind === 'image' && preview.url && (
              <div className="p-4 rounded-lg bg-[var(--card)] border border-[var(--border)] flex flex-col items-center gap-2">
                <img
                  src={preview.url}
                  alt={selectedEntry?.name}
                  className="max-h-64 max-w-full object-contain rounded"
                />
                {preview.width && preview.height && (
                  <span className="text-[var(--muted-foreground)] font-mono">
                    {preview.width} × {preview.height} px
                  </span>
                )}
              </div>
            )}
            {preview?.kind === 'directory' &&
              (preview.children || []).map((child) => (
                <div
                  key={child}
                  onClick={() =>
                    selectedEntry && navigateTo(`${selectedEntry.path}\\${child}`)
                  }
                  className="px-3 py-2 rounded-md bg-[var(--card)] border border-[var(--border)] flex items-center gap-2 cursor-pointer hover:border-[var(--primary)]"
                >
                  <KenneyIcon name="card" size={14} />
                  <span className="truncate">{child}</span>
                </div>
              ))}
            {preview?.kind === 'text' && (
              <pre className="p-3 rounded-lg bg-[var(--card)] border border-[var(--border)] font-mono text-xs whitespace-pre-wrap">
                {preview.content}
              </pre>
            )}
            {preview?.kind === 'binary' && (
              <div className="p-3 rounded-lg bg-[var(--card)] border border-[var(--border)] text-[var(--muted-foreground)]">
                {preview.message}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 3. DUAL-PANE COMMANDER
  if (layout === 'dualpane') {
    const rightParent =
      rightPanePath.split(/[\\/]/).length > 1
        ? rightPanePath.replace(/[\\/][^\\/]+$/, '')
        : null;
    // The active pane (last one clicked) is where sidebar navigation lands.
    const paneHeaderBorder = (pane: 'left' | 'right') =>
      activePane === pane
        ? 'border-[var(--primary)] shadow-[inset_0_-2px_0_var(--primary)]'
        : 'border-[var(--border)]';
    const paneTitleTone = (pane: 'left' | 'right') =>
      activePane === pane
        ? 'font-semibold text-[var(--foreground)]/85'
        : 'text-[var(--muted-foreground)]';

    return (
      <div ref={dualPaneRef} className="flex-1 flex text-xs overflow-hidden">
        {/* Left Pane */}
        <div
          onMouseDownCapture={() => setActivePane('left')}
          onContextMenu={handleEmptyContextMenu}
          onDragOver={(e) => handleFolderDragOver(e, currentPath)}
          onDragLeave={(e) => handleFolderDragLeave(e, currentPath)}
          onDrop={(e) => handleFolderDrop(e, currentPath)}
          style={{ flex: `0 0 calc(${leftPanePct}% - 24px)`, minWidth: 0 }}
          className={`flex flex-col bg-[var(--center-bg)] overflow-hidden ${
            dragTargetDir === currentPath ? 'ring-2 ring-inset ring-sky-400' : ''
          }`}
        >
          <div className={`px-3 py-2 bg-[var(--sidebar)] border-b flex justify-between items-center ${paneHeaderBorder('left')}`}>
            <span className={`font-mono truncate ${paneTitleTone('left')}`}>
              LEFT: {currentPath}
            </span>
            <span className="px-2 py-0.5 rounded bg-slate-700/70 text-[var(--foreground)] text-xs shrink-0">
              SOURCE
            </span>
          </div>
          <PaneColumnHeader sortBy={sortBy} sortAsc={sortAsc} onSort={setSortBy} />
          <div className="divide-y divide-[var(--border)]/20 flex-1 overflow-y-auto">
            {filteredItems.map((f) => {
              const isSelected = isEntrySelected(f.path);
              const isCut = isEntryCut(f.path);
              const isDropTarget = f.isDirectory && dragTargetDir === f.path;
              return (
                <div
                  key={f.path}
                  data-entry-path={f.path}
                  draggable
                  onDragStart={(e) => handleDragStart(e, f)}
                  onDragOver={f.isDirectory ? (e) => handleFolderDragOver(e, f.path) : undefined}
                  onDragLeave={f.isDirectory ? (e) => handleFolderDragLeave(e, f.path) : undefined}
                  onDrop={f.isDirectory ? (e) => handleFolderDrop(e, f.path) : undefined}
                  onClick={(e) => handleSelectItem(e, f)}
                  onDoubleClick={() => handleOpenItem(f)}
                  onContextMenu={(e) => handleItemContextMenu(e, f)}
                  className={`px-3 py-1 flex items-center cursor-pointer ${
                    isSelected ? 'transition-none' : 'transition-colors duration-75'
                  } ${
                    isDropTarget
                      ? 'bg-sky-500/20 ring-1 ring-inset ring-sky-400'
                      : isSelected
                        ? 'bg-white/[0.12] text-[var(--foreground)] ring-1 ring-inset ring-slate-400/40 dark:ring-white/[0.22]'
                        : f.isDirectory
                          ? 'bg-white/[0.02] hover:bg-white/[0.05]'
                          : 'hover:bg-white/[0.035]'
                  } ${isCut ? 'opacity-50' : ''}`}
                >
                  <span className="flex-1 min-w-0 flex items-center gap-2 truncate">
                    <FileThumbnail entry={f} size={18} />
                    <span className={`truncate ${f.isDirectory ? 'text-[var(--foreground)]/85' : ''}`}>{f.name}</span>
                  </span>
                  <PaneRowCells entry={f} />
                </div>
              );
            })}
          </div>
        </div>

        {/* Partition bar: drag to resize panes, double-click to reset to 50/50 */}
        <div
          onMouseDown={startDividerDrag}
          onDoubleClick={() => setLeftPanePct(50)}
          title="Drag to resize panes • Double-click to reset"
          className="w-1.5 shrink-0 cursor-col-resize bg-[var(--border)] hover:bg-sky-400 transition-colors"
          style={draggingDivider ? { background: 'rgb(56 189 248)' } : undefined}
        />

        {/* Center Action Strip */}
        <div className="w-12 bg-[var(--sidebar)] flex flex-col items-center justify-center gap-3 p-1 select-none shrink-0">
          <button
            onClick={copySelectedToOtherPane}
            className="p-2 rounded bg-[var(--card)] border border-[var(--border)] hover:border-[var(--primary)] cursor-pointer"
            title="Copy Selected to Right Pane (F5)"
          >
            <KenneyIcon name="export" size={16} />
          </button>
          <button
            onClick={moveSelectedToOtherPane}
            className="p-2 rounded bg-[var(--card)] border border-[var(--border)] hover:border-[var(--primary)] cursor-pointer"
            title="Move Selected to Right Pane (F6)"
          >
            <KenneyIcon name="import" size={16} />
          </button>
          <button
            onClick={() => navigateRightPane(currentPath)}
            className="p-2 rounded bg-[var(--card)] border border-[var(--border)] hover:border-[var(--primary)] cursor-pointer"
            title="Sync Right Pane to Left Path"
          >
            <KenneyIcon name="return" size={16} />
          </button>
        </div>

        <div className="w-px shrink-0 bg-[var(--border)]" />

        {/* Right Pane */}
        <div
          onMouseDownCapture={() => setActivePane('right')}
          onDragOver={(e) => handleFolderDragOver(e, rightPanePath)}
          onDragLeave={(e) => handleFolderDragLeave(e, rightPanePath)}
          onDrop={(e) => handleFolderDrop(e, rightPanePath)}
          className={`flex-1 min-w-0 flex flex-col bg-[var(--center-bg)] overflow-hidden ${
            dragTargetDir === rightPanePath ? 'ring-2 ring-inset ring-sky-400 bg-sky-500/10' : ''
          }`}
        >
          <div className={`px-3 py-2 bg-[var(--sidebar)] border-b flex justify-between items-center gap-2 ${paneHeaderBorder('right')}`}>
            <span className={`font-mono truncate ${paneTitleTone('right')}`}>
              RIGHT: {rightPanePath}
            </span>
            {rightParent && (
              <button
                onClick={() => navigateRightPane(rightParent)}
                className="px-2 py-0.5 rounded bg-[var(--card)] border border-[var(--border)] text-[var(--foreground)] cursor-pointer shrink-0 flex items-center gap-1"
              >
                <KenneyIcon name="arrowUp" size={12} />
                <span>Up</span>
              </button>
            )}
          </div>
          <PaneColumnHeader sortBy={rightSortBy} sortAsc={rightSortAsc} onSort={setRightSortBy} />
          <div className="divide-y divide-[var(--border)]/20 flex-1 overflow-y-auto">
            {sortedRightItems.map((r) => (
              <div
                key={r.path}
                draggable
                onDragStart={(e) => handleDragStart(e, r)}
                onDragOver={r.isDirectory ? (e) => handleFolderDragOver(e, r.path) : undefined}
                onDragLeave={r.isDirectory ? (e) => handleFolderDragLeave(e, r.path) : undefined}
                onDrop={r.isDirectory ? (e) => handleFolderDrop(e, r.path) : undefined}
                onDoubleClick={() => (r.isDirectory ? navigateRightPane(r.path) : openEntry(r))}
                onContextMenu={(e) => handleItemContextMenu(e, r)}
                className={`px-3 py-1 flex items-center cursor-pointer transition-colors ${
                  r.isDirectory && dragTargetDir === r.path
                    ? 'bg-sky-500/20 ring-1 ring-inset ring-sky-400'
                    : r.isDirectory
                      ? 'bg-white/[0.02] hover:bg-white/[0.05]'
                      : 'hover:bg-white/[0.035]'
                }`}
              >
                <span className="flex-1 min-w-0 flex items-center gap-2 truncate">
                  <FileThumbnail entry={r} size={18} />
                  <span className={`truncate ${r.isDirectory ? 'text-[var(--foreground)]/85' : ''}`}>{r.name}</span>
                </span>
                <PaneRowCells entry={r} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 4. TAG & FACETED CANVAS (Large Thumbnail Cards)
  if (layout === 'faceted') {
    const allTags = Array.from(
      new Set(['all', 'folder', 'rust', 'ui', 'config', 'docs', ...items.flatMap((i) => i.tags || [])])
    );

    return (
      <div
        onContextMenu={handleEmptyContextMenu}
        className="flex-1 flex flex-col bg-[var(--center-bg)] p-4 overflow-y-auto gap-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--border)]">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-[var(--muted-foreground)] mr-1 flex items-center gap-1">
              <KenneyIcon name="tag_shield" size={14} />
              <span>Filter by Tag:</span>
            </span>
            {allTags.map((t) => (
              <button
                key={t}
                onClick={() => setActiveTagFilter(t)}
                className={`px-2.5 py-1 rounded-full text-xs transition-all cursor-pointer ${
                  activeTagFilter === t
                    ? 'bg-[var(--primary)] text-[var(--primary-foreground)] font-medium'
                    : 'bg-[var(--background)] border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                }`}
              >
                {t === 'all' ? 'All Items' : `#${t}`}
              </button>
            ))}
          </div>
          <div className="text-xs text-[var(--muted-foreground)]">
            Showing {filteredItems.length} items
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {filteredItems.map((f) => {
            const isSelected = isEntrySelected(f.path);
            const isCut = isEntryCut(f.path);
            const isDropTarget = f.isDirectory && dragTargetDir === f.path;
            return (
              <div
                key={f.path}
                data-entry-path={f.path}
                draggable
                onDragStart={(e) => handleDragStart(e, f)}
                onDragOver={f.isDirectory ? (e) => handleFolderDragOver(e, f.path) : undefined}
                onDragLeave={f.isDirectory ? (e) => handleFolderDragLeave(e, f.path) : undefined}
                onDrop={f.isDirectory ? (e) => handleFolderDrop(e, f.path) : undefined}
                onClick={(e) => handleSelectItem(e, f)}
                onDoubleClick={() => handleOpenItem(f)}
                onContextMenu={(e) => handleItemContextMenu(e, f)}
                className={`p-3.5 rounded-xl border cursor-pointer flex flex-col justify-between gap-3 ${
                  isSelected ? 'transition-none' : 'transition-all duration-75'
                } ${
                  isDropTarget
                    ? 'border-sky-400 bg-sky-500/20 shadow-md'
                    : isSelected
                      ? 'border-white/[0.30] ring-1 ring-inset ring-white/[0.20] bg-white/[0.12] text-[var(--foreground)] shadow-sm'
                      : f.isDirectory
                        ? 'border-white/[0.05] bg-white/[0.025] hover:bg-white/[0.05] hover:border-slate-500/40 shadow-xs'
                        : 'border-[var(--border)] bg-[var(--background)]/60 hover:border-[var(--muted-foreground)]'
                } ${isCut ? 'opacity-50' : ''}`}
              >
                <div className="h-20 rounded-lg bg-[var(--card)]/70 border border-[var(--border)]/60 flex items-center justify-center p-2 relative">
                  <FileThumbnail entry={f} size={56} />
                  <span className="absolute top-1.5 right-1.5 text-xs px-1.5 py-0.5 rounded bg-[var(--background)]/90 border border-[var(--border)] text-[var(--muted-foreground)]">
                    {formatBytes(f.sizeBytes, f.isDirectory)}
                  </span>
                </div>
                <div>
                  <div className={`text-sm truncate font-medium ${f.isDirectory ? 'text-[var(--foreground)]/85' : 'text-[var(--foreground)]'}`} title={f.name}>
                    {f.name}
                  </div>
                  <div className="text-xs text-[var(--muted-foreground)] mt-0.5">
                    {formatRelativeTime(f.modifiedMs)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 pt-1 border-t border-[var(--border)]/60">
                  {(f.tags || []).map((t) => (
                    <span key={t} className="text-xs text-[var(--muted-foreground)]">
                      #{t}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // 5. FUZZY / KEYBOARD-FIRST NAVIGATOR
  return (
    <div
      onContextMenu={handleEmptyContextMenu}
      className="flex-1 flex flex-col items-center justify-center bg-[var(--background)]/60 p-6 overflow-y-auto"
    >
      <div
        className="w-full max-w-4xl bg-[var(--card)] border border-[var(--border)] rounded-2xl shadow-xl overflow-hidden flex flex-col"
        style={{ height: '460px' }}
      >
        <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-3 bg-[var(--sidebar)]">
          <KenneyIcon name="zoom" size={18} />
          <input
            autoFocus
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Fuzzy filter files, extensions, or #tags..."
            className="bg-transparent text-sm text-[var(--foreground)] font-mono flex-1 outline-none"
          />
          <span className="text-xs px-2 py-0.5 rounded bg-[var(--background)] border border-[var(--border)] text-[var(--muted-foreground)]">
            {filteredItems.length} matches
          </span>
        </div>

        <div className="flex-1 grid grid-cols-12 divide-x divide-[var(--border)] overflow-hidden text-xs">
          <div className="col-span-5 p-1.5 space-y-0.5 overflow-y-auto">
            {filteredItems.map((f, idx) => {
              const isSelected = isEntrySelected(f.path);
              const isCut = isEntryCut(f.path);
              return (
                <div
                  key={f.path}
                  data-entry-path={f.path}
                  onClick={(e) => handleSelectItem(e, f)}
                  onDoubleClick={() => handleOpenItem(f)}
                  onContextMenu={(e) => handleItemContextMenu(e, f)}
                  className={`px-3 py-1 rounded-lg cursor-pointer flex items-center justify-between ${
                    isSelected ? 'transition-none' : 'transition-colors duration-75'
                  } ${
                    isSelected
                      ? 'bg-white/[0.12] text-[var(--foreground)] ring-1 ring-inset ring-slate-400/40 dark:ring-white/[0.22]'
                      : 'hover:bg-[var(--background)]/70'
                  } ${isCut ? 'opacity-50' : ''}`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <FileThumbnail entry={f} size={18} />
                    <span className="truncate">{f.name}</span>
                  </span>
                  {idx < 5 && (
                    <KenneyIcon name={`keyboard_${idx + 1}_outline`} size={14} className="opacity-75 shrink-0 ml-2" />
                  )}
                </div>
              );
            })}
          </div>
          <div className="col-span-7 p-4 bg-[var(--background)]/50 flex flex-col justify-between overflow-hidden">
            <div className="space-y-3 overflow-y-auto flex-1">
              <div className="flex items-center justify-between border-b border-[var(--border)] pb-2">
                <span className="font-mono font-semibold text-sm truncate flex items-center gap-2">
                  {selectedEntry && <FileThumbnail entry={selectedEntry} size={18} />}
                  <span>{selectedEntry?.name || 'No selection'}</span>
                </span>
                <span className="text-[var(--muted-foreground)] shrink-0">
                  {selectedEntry
                    ? formatBytes(selectedEntry.sizeBytes, selectedEntry.isDirectory)
                    : ''}
                </span>
              </div>
              {preview?.kind === 'image' && preview.url ? (
                <div className="p-4 rounded-lg bg-[var(--card)] border border-[var(--border)] flex items-center justify-center max-h-72">
                  <img
                    src={preview.url}
                    alt={selectedEntry?.name}
                    className="max-h-60 max-w-full object-contain rounded"
                  />
                </div>
              ) : (
                <pre className="font-mono text-xs p-3 rounded-lg bg-[var(--card)] border border-[var(--border)] whitespace-pre-wrap overflow-y-auto max-h-72">
                  {preview?.kind === 'text' && preview.content}
                  {preview?.kind === 'directory' && (preview.children || []).join('\n')}
                  {preview?.kind === 'binary' && preview.message}
                </pre>
              )}
            </div>
            <div className="flex items-center justify-between text-[var(--muted-foreground)] pt-2 border-t border-[var(--border)] shrink-0">
              <span className="flex items-center gap-1.5">
                <KenneyIcon name="mouse_left_outline" size={14} />
                <span>Double-Click Open</span>
              </span>
              <span className="flex items-center gap-1">
                <KenneyIcon name="keyboard_alt_outline" size={14} />
                <span>1..5 Switch Mode</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
