import { InlineRenameName } from './InlineRename';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useExplorerStore } from '../store/useExplorerStore';
import { FsEntry, SortField } from '../types/fs';
import { formatBytes } from '../utils/format';
import { FileColumnCells, FileColumnHeader, useFileColumns } from './FileColumns';
import { KenneyIcon } from './KenneyIcon';
import { FileThumbnail } from './FileThumbnail';
import { SplitPanelsView } from './SplitPanelsView';
import { handleFileDropToDir, hasFileDragData, setAppropriateDropEffect, startNativeFileDrag } from '../utils/dragDrop';
import { naturalCompare } from '../utils/naturalSort';

export const LayoutsView: React.FC = () => {
  const nameWidth = useFileColumns().widths.name;
  const {
    layout,
    splitView,
    items,
    parentPath,
    currentPath,
    selectedPath,
    selectedPaths,
    clipboard,
    preview,
    filterQuery,
    deepSearch,
    deepSearchResults,
    sortBy,
    sortAsc,
    showHiddenFiles,
    thumbGridSize,
    setThumbGridSize,
    selectEntry,
    openEntry,
    openContextMenu,
    navigateTo,
    setSortBy,
    setFilterQuery,
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

    list.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      let cmp = 0;
      if (sortBy === 'size') cmp = a.sizeBytes - b.sizeBytes;
      else if (sortBy === 'modified') cmp = a.modifiedMs - b.modifiedMs;
      else if (sortBy === 'created') cmp = (a.createdMs ?? a.modifiedMs) - (b.createdMs ?? b.modifiedMs);
      else if (sortBy === 'extension') cmp = naturalCompare(a.extension, b.extension) || naturalCompare(a.name, b.name);
      else cmp = naturalCompare(a.name, b.name);
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [items, deepSearch, deepSearchResults, showHiddenFiles, filterQuery, layout, sortBy, sortAsc]);

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

    if (startNativeFileDrag(e, paths)) return;

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
  if (splitView) {
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
        <FileColumnHeader
          sortBy={sortBy}
          sortAsc={sortAsc}
          onSort={setSortBy}
          className="px-4 sticky top-0 z-10 shadow-sm"
        />

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
                      ? 'bg-[var(--foreground)]/[0.12] text-[var(--foreground)] ring-1 ring-inset ring-[var(--border)]'
                      : f.isDirectory
                        ? 'bg-[var(--foreground)]/[0.02] hover:bg-[var(--foreground)]/[0.05]'
                        : 'hover:bg-[var(--foreground)]/[0.035]'
                } ${isCut ? 'opacity-50' : ''}`}
              >
                <div
                  style={nameWidth ? { width: nameWidth } : undefined}
                  className={`${nameWidth ? 'shrink-0' : 'flex-1'} min-w-[140px] flex items-center gap-2 pr-2`}
                >
                  <FileThumbnail entry={f} size={18} />
                  <div className="min-w-0 flex flex-col">
                    <InlineRenameName entry={f} className={`truncate ${f.isDirectory ? 'text-[var(--foreground)]/85' : 'text-[var(--foreground)]'}`} />
                    {deepSearch && filterQuery.trim() !== '' && (
                      <span className="text-[10px] text-[var(--muted-foreground)] font-mono truncate">
                        {f.path.replace(currentPath, '').replace(/^[\\/]+/, '')}
                      </span>
                    )}
                  </div>
                </div>
                <FileColumnCells entry={f} />
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
                { id: 'created', label: 'Created' },
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
                    ? 'bg-[var(--foreground)]/[0.10] text-[var(--foreground)] font-medium'
                    : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--foreground)]/[0.04]'
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
                      ? 'bg-[var(--foreground)]/[0.12] border-[var(--border)] ring-1 ring-inset ring-[var(--foreground)]/[0.15] text-[var(--foreground)] shadow-sm'
                      : f.isDirectory
                        ? 'bg-[var(--foreground)]/[0.02] border-[var(--foreground)]/[0.04] hover:bg-[var(--foreground)]/[0.05] hover:border-[var(--border)] shadow-xs'
                        : 'bg-transparent border-transparent hover:bg-[var(--foreground)]/[0.04] hover:border-[var(--border)]/70'
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
                    <InlineRenameName entry={f} multiline inputClassName="w-full text-[11px]" />
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
                      ? 'bg-[var(--foreground)]/[0.12] text-[var(--foreground)] ring-1 ring-inset ring-[var(--border)]'
                      : 'hover:bg-[var(--background)]/70'
                  } ${isCut ? 'opacity-50' : ''}`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <FileThumbnail entry={f} size={18} />
                    <InlineRenameName entry={f} className="truncate" />
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
