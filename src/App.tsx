import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useExplorerStore } from './store/useExplorerStore';
import { RibbonHeader } from './components/RibbonHeader';
import { SidebarPane } from './components/SidebarPane';
import { LayoutsView } from './components/LayoutsView';
import { InspectorPane } from './components/InspectorPane';
import { TerminalDrawer } from './components/TerminalDrawer';
import { ContextMenu } from './components/ContextMenu';
import { KenneyIcon } from './components/KenneyIcon';
import { formatBytes } from './utils/format';
import { fsService } from './services/fsService';
import { handleFileDropToDir, hasFileDragData } from './utils/dragDrop';

export const App: React.FC = () => {
  const {
    init,
    items,
    currentPath,
    layout,
    sortBy,
    sortAsc,
    filterQuery,
    deepSearch,
    deepSearchResults,
    activeTagFilter,
    selectedPath,
    selectedPaths,
    clipboard,
    pendingDeletePath,
    pendingDeletePaths,
    deletePermanently,
    contextMenu,
    promptModal,
    showOptionsModal,
    showHiddenFiles,
    thumbStats,
    folderSizeStats,
    statusMessage,
    error,
    isLoading,
    setLayout,
    goBack,
    goForward,
    goUp,
    refresh,
    checkDirWatcher,
    selectEntry,
    selectAll,
    copyToClipboard,
    cutToClipboard,
    pasteClipboard,
    undoLastOperation,
    openEntry,
    closeContextMenu,
    openPromptModal,
    closePromptModal,
    submitPromptModal,
    toggleSidebar,
    toggleInspector,
    toggleTerminal,
    toggleOptionsModal,
    toggleHiddenFiles,
    setDeletePermanently,
    setThumbMaxSize,
    clearThumbCache,
    clearFolderSizeCache,
    rescanCurrentFolderSizes,
    openPowershellCurrent,
    requestDeleteSelected,
    confirmDeleteSelected,
    cancelDeleteSelected,
    dropEntriesToDir,
  } = useExplorerStore();

  const [maxCacheMbInput, setMaxCacheMbInput] = useState<string>('250');
  const [promptInput, setPromptInput] = useState<string>('');
  const promptInputRef = useRef<HTMLInputElement | null>(null);

  const visibleItems = useMemo(() => {
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
      else if (sortBy === 'extension') cmp = a.extension.localeCompare(b.extension);
      else cmp = a.name.localeCompare(b.name);
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [items, deepSearch, deepSearchResults, showHiddenFiles, filterQuery, layout, activeTagFilter, sortBy, sortAsc]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      checkDirWatcher();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [checkDirWatcher]);

  useEffect(() => {
    if (!promptModal) return;
    setPromptInput(promptModal.defaultValue);
    requestAnimationFrame(() => {
      const input = promptInputRef.current;
      if (!input) return;
      input.focus();
      const val = promptModal.defaultValue;
      const dotIdx = val.lastIndexOf('.');
      if (
        (promptModal.kind === 'rename' || promptModal.kind === 'newFile') &&
        !promptModal.isDirectory &&
        dotIdx > 0
      ) {
        input.setSelectionRange(0, dotIdx);
      } else {
        input.select();
      }
    });
  }, [promptModal]);

  useEffect(() => {
    if (thumbStats.maxCacheMb) {
      setMaxCacheMbInput(String(thumbStats.maxCacheMb));
    }
  }, [thumbStats.maxCacheMb]);

  const handleApplyMaxCacheSize = async () => {
    const parsed = parseInt(maxCacheMbInput, 10);
    if (!Number.isNaN(parsed) && parsed >= 16) {
      await setThumbMaxSize(parsed);
    }
  };

  useEffect(() => {
    init();
  }, [init]);

  // Handle external file drops from Windows Explorer or other Rook windows
  useEffect(() => {
    const onExternalDrop = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && Array.isArray(detail.paths) && detail.paths.length > 0) {
        const dest = detail.targetDir || currentPath;
        if (dest) {
          dropEntriesToDir(detail.paths, dest, Boolean(detail.copy));
        }
      }
    };

    const onWindowDragOver = (e: DragEvent) => {
      if (hasFileDragData(e.dataTransfer)) {
        e.preventDefault();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
        }
      }
    };

    const onWindowDrop = (e: DragEvent) => {
      if (hasFileDragData(e.dataTransfer)) {
        handleFileDropToDir(e, currentPath, dropEntriesToDir);
      }
    };

    const onDragCompleted = () => {
      refresh();
    };

    window.addEventListener('rook-external-drop', onExternalDrop);
    window.addEventListener('rook-drag-completed', onDragCompleted);
    window.addEventListener('dragover', onWindowDragOver);
    window.addEventListener('drop', onWindowDrop);
    return () => {
      window.removeEventListener('rook-external-drop', onExternalDrop);
      window.removeEventListener('rook-drag-completed', onDragCompleted);
      window.removeEventListener('dragover', onWindowDragOver);
      window.removeEventListener('drop', onWindowDrop);
    };
  }, [currentPath, dropEntriesToDir, refresh]);

  // Keyboard & Mouse Side-Button Navigation
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (e.altKey) {
        if (e.key === '1') { e.preventDefault(); setLayout('workspace'); }
        if (e.key === '2') { e.preventDefault(); setLayout('thumbnails'); }
        if (e.key === '3') { e.preventDefault(); setLayout('miller'); }
        if (e.key === '4') { e.preventDefault(); setLayout('dualpane'); }
        if (e.key === '5') { e.preventDefault(); setLayout('faceted'); }
        if (e.key === '6') { e.preventDefault(); setLayout('command'); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); goBack(); }
        if (e.key === 'ArrowRight') { e.preventDefault(); goForward(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); goUp(); }
      }
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === 'b') { e.preventDefault(); toggleSidebar(); }
        if (key === 'i') { e.preventDefault(); toggleInspector(); }
        if (key === 't') { e.preventDefault(); openPowershellCurrent(); }
        if (e.key === ',') { e.preventDefault(); toggleOptionsModal(); }
        if (e.key === '`') { e.preventDefault(); toggleTerminal(); }

        if (!isInput) {
          if (key === 'a') {
            e.preventDefault();
            selectAll(visibleItems.map((i) => i.path));
          } else if (key === 'n' && e.shiftKey) {
            e.preventDefault();
            openPromptModal({
              kind: 'newFolder',
              title: 'Create New Folder',
              subtitle: `In ${currentPath}`,
              defaultValue: 'New Folder',
              isDirectory: true,
            });
          } else if (key === 'c' && !window.getSelection()?.toString()) {
            e.preventDefault();
            copyToClipboard();
          } else if (key === 'x') {
            e.preventDefault();
            cutToClipboard();
          } else if (key === 'v') {
            e.preventDefault();
            pasteClipboard();
          } else if (key === 'z') {
            e.preventDefault();
            undoLastOperation();
          }
        }
      }
      if (e.key === 'F5') {
        e.preventDefault();
        refresh();
      }
      if (
        e.key === 'F2' &&
        !isInput &&
        !pendingDeletePath &&
        !showOptionsModal &&
        !promptModal &&
        selectedPath
      ) {
        e.preventDefault();
        const entry = items.find((i) => i.path === selectedPath);
        const currentName = entry?.name || selectedPath.split(/[\\/]/).pop() || '';
        openPromptModal({
          kind: 'rename',
          title: 'Rename Item',
          subtitle: selectedPath,
          defaultValue: currentName,
          isDirectory: entry?.isDirectory,
        });
      }
      if (
        !isInput &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !pendingDeletePath &&
        !showOptionsModal &&
        !promptModal
      ) {
        const orderedPaths = visibleItems.map((i) => i.path);
        const currentIndex = visibleItems.findIndex((i) => i.path === selectedPath);

        if (
          (e.key === 'ArrowDown' ||
            ((layout === 'thumbnails' || layout === 'faceted') && e.key === 'ArrowRight')) &&
          visibleItems.length > 0
        ) {
          e.preventDefault();
          const nextIdx =
            currentIndex < 0 ? 0 : Math.min(visibleItems.length - 1, currentIndex + 1);
          selectEntry(visibleItems[nextIdx], {
            shift: e.shiftKey,
            orderedPaths,
          });
        } else if (
          (e.key === 'ArrowUp' ||
            ((layout === 'thumbnails' || layout === 'faceted') && e.key === 'ArrowLeft')) &&
          visibleItems.length > 0
        ) {
          e.preventDefault();
          const prevIdx = currentIndex <= 0 ? 0 : currentIndex - 1;
          selectEntry(visibleItems[prevIdx], {
            shift: e.shiftKey,
            orderedPaths,
          });
        } else if (e.key === 'Home' && visibleItems.length > 0) {
          e.preventDefault();
          selectEntry(visibleItems[0], {
            shift: e.shiftKey,
            orderedPaths,
          });
        } else if (e.key === 'End' && visibleItems.length > 0) {
          e.preventDefault();
          selectEntry(visibleItems[visibleItems.length - 1], {
            shift: e.shiftKey,
            orderedPaths,
          });
        } else if (e.key === 'Backspace') {
          e.preventDefault();
          goUp();
        }
      }
      if (
        e.key === 'Enter' &&
        !isInput &&
        !pendingDeletePath &&
        !showOptionsModal &&
        !promptModal
      ) {
        const entry = items.find((i) => i.path === selectedPath);
        if (entry) {
          e.preventDefault();
          openEntry(entry);
        }
      }
      if (e.key === 'Delete' && !isInput && !promptModal) {
        e.preventDefault();
        requestDeleteSelected(e.shiftKey ? true : false);
      }
      if (e.key === 'Escape') {
        if (contextMenu) {
          e.preventDefault();
          closeContextMenu();
        } else if (promptModal) {
          e.preventDefault();
          closePromptModal();
        } else if (pendingDeletePath) {
          e.preventDefault();
          cancelDeleteSelected();
        } else if (showOptionsModal) {
          e.preventDefault();
          toggleOptionsModal();
        }
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      // Mouse Button 3 = Back (XButton1), Mouse Button 4 = Forward (XButton2)
      if (e.button === 3) {
        e.preventDefault();
        goBack();
      } else if (e.button === 4) {
        e.preventDefault();
        goForward();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [
    items,
    visibleItems,
    currentPath,
    selectedPath,
    showHiddenFiles,
    contextMenu,
    promptModal,
    selectEntry,
    selectAll,
    copyToClipboard,
    cutToClipboard,
    pasteClipboard,
    undoLastOperation,
    openEntry,
    closeContextMenu,
    openPromptModal,
    closePromptModal,
    setLayout,
    goBack,
    goForward,
    goUp,
    refresh,
    toggleSidebar,
    toggleInspector,
    toggleTerminal,
    toggleOptionsModal,
    openPowershellCurrent,
    requestDeleteSelected,
    cancelDeleteSelected,
    pendingDeletePath,
    showOptionsModal,
  ]);

  const selectedEntry = items.find((i) => i.path === selectedPath);
  const pendingDeleteName = pendingDeletePath ? pendingDeletePath.split(/[\\/]/).pop() : '';

  return (
    <div className="bg-[var(--sidebar)] text-[var(--foreground)] h-screen w-screen flex flex-col overflow-hidden border border-[var(--border)] relative">
      {/* 8-Way Frameless Native Window Resize Handles */}
      <div
        onMouseDown={() => fsService.winResize('top')}
        className="fixed top-0 left-3 right-3 h-1.5 z-50 cursor-ns-resize"
      />
      <div
        onMouseDown={() => fsService.winResize('bottom')}
        className="fixed bottom-0 left-3 right-3 h-1.5 z-50 cursor-ns-resize"
      />
      <div
        onMouseDown={() => fsService.winResize('left')}
        className="fixed top-3 bottom-3 left-0 w-1.5 z-50 cursor-ew-resize"
      />
      <div
        onMouseDown={() => fsService.winResize('right')}
        className="fixed top-3 bottom-3 right-0 w-1.5 z-50 cursor-ew-resize"
      />
      <div
        onMouseDown={() => fsService.winResize('topLeft')}
        className="fixed top-0 left-0 w-3 h-3 z-50 cursor-nwse-resize"
      />
      <div
        onMouseDown={() => fsService.winResize('topRight')}
        className="fixed top-0 right-0 w-3 h-3 z-50 cursor-nesw-resize"
      />
      <div
        onMouseDown={() => fsService.winResize('bottomLeft')}
        className="fixed bottom-0 left-0 w-3 h-3 z-50 cursor-nesw-resize"
      />
      <div
        onMouseDown={() => fsService.winResize('bottomRight')}
        title="Drag to resize window"
        className="fixed bottom-0 right-0 w-4 h-4 z-50 cursor-nwse-resize"
      />

      <main className="bg-[var(--sidebar)] flex-1 flex flex-col overflow-hidden relative">
        <RibbonHeader />

        {error && (
          <div className="bg-red-500/15 border-b border-red-500/40 text-red-400 px-4 py-1.5 text-xs flex items-center gap-2">
            <KenneyIcon name="warning" size={14} />
            <span>Error: {error}</span>
          </div>
        )}

        <div className="flex-1 flex overflow-hidden">
          <SidebarPane />
          <div className="flex-1 flex overflow-hidden relative z-10 bg-[var(--center-bg)] shadow-[0_0_28px_rgba(0,0,0,0.6)] ring-1 ring-white/[0.04]">
            <LayoutsView />
          </div>
          <InspectorPane />
        </div>

        <TerminalDrawer />
        <ContextMenu />

        {/* Options & Preferences Modal */}
        {showOptionsModal && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl max-w-md w-full p-5 space-y-4 text-xs">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
                <div className="flex items-center gap-2.5">
                  <KenneyIcon name="gear" size={18} />
                  <h3 className="text-sm font-semibold text-[var(--foreground)]">
                    Rook Options & Preferences
                  </h3>
                </div>
                <button
                  onClick={toggleOptionsModal}
                  className="w-7 h-7 rounded-md hover:bg-white/[0.08] flex items-center justify-center cursor-pointer opacity-70 hover:opacity-100 transition-colors"
                >
                  <KenneyIcon name="cross" size={13} />
                </button>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--background)] border border-[var(--border)]">
                  <div>
                    <div className="font-medium text-[var(--foreground)]">Color Theme</div>
                    <div className="text-[var(--muted-foreground)]">Switch between Dark and Light mode</div>
                  </div>
                  <button
                    onClick={() => document.documentElement.classList.toggle('dark')}
                    className="h-8 px-3 rounded-md bg-[var(--card)] border border-[var(--border)] hover:border-[var(--primary)] font-medium text-xs cursor-pointer flex items-center justify-center transition-colors"
                  >
                    Toggle Theme
                  </button>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--background)] border border-[var(--border)]">
                  <div>
                    <div className="font-medium text-[var(--foreground)]">Show Hidden Dot-Files</div>
                    <div className="text-[var(--muted-foreground)]">Display files starting with "."</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={showHiddenFiles}
                    onChange={toggleHiddenFiles}
                    className="w-4 h-4 accent-[var(--primary)] cursor-pointer"
                  />
                </div>

                <div className="p-2.5 rounded-lg bg-[var(--background)] border border-[var(--border)] space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="space-y-1">
                      <div className="font-medium text-[var(--foreground)] flex items-center gap-1.5">
                        <KenneyIcon name="award" size={14} />
                        <span>Thumbnail Disk Cache</span>
                      </div>
                      <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
                        <span className="px-1.5 py-0.5 rounded bg-[var(--card)] border border-[var(--border)] font-mono text-[var(--foreground)]">
                          {thumbStats.count} cached
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-[var(--card)] border border-[var(--border)] font-mono text-[var(--foreground)]">
                          {formatBytes(thumbStats.totalBytes)} / {thumbStats.maxCacheMb ?? 250} MB max
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={clearThumbCache}
                      className="h-8 px-3 rounded-md bg-red-950/40 hover:bg-red-900/55 border border-red-500/30 text-white font-medium text-xs cursor-pointer flex items-center gap-1.5 justify-center transition-colors"
                    >
                      <KenneyIcon name="trashcan" size={13} />
                      <span>Purge</span>
                    </button>
                  </div>

                  {/* Max Cache Size (MB) Input */}
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--border)]/60">
                    <label className="text-[var(--muted-foreground)] font-medium">
                      Max Cache Size (MB)
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={16}
                        max={10240}
                        step={16}
                        value={maxCacheMbInput}
                        onChange={(e) => setMaxCacheMbInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleApplyMaxCacheSize();
                        }}
                        className="w-24 h-8 bg-[var(--card)] border border-[var(--border)] focus:border-[var(--primary)] rounded-md px-2 py-1 text-right text-[var(--foreground)] outline-none"
                      />
                      <button
                        onClick={handleApplyMaxCacheSize}
                        className="h-8 px-3 rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 font-medium text-xs cursor-pointer flex items-center justify-center transition-colors"
                      >
                        Apply
                      </button>
                    </div>
                  </div>

                  {thumbStats.cacheDir && (
                    <div className="font-mono text-[var(--muted-foreground)] truncate" title={thumbStats.cacheDir}>
                      {thumbStats.cacheDir}
                    </div>
                  )}
                </div>

                {/* Folder Size Database */}
                <div className="p-2.5 rounded-lg bg-[var(--background)] border border-[var(--border)] space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="space-y-1">
                      <div className="font-medium text-[var(--foreground)] flex items-center gap-1.5">
                        <KenneyIcon name="pouch" size={14} />
                        <span>Folder Size Database</span>
                      </div>
                      <div className="flex items-center gap-2 text-[var(--muted-foreground)]">
                        <span className="px-1.5 py-0.5 rounded bg-[var(--card)] border border-[var(--border)] font-mono text-[var(--foreground)]">
                          {folderSizeStats.folderCount} dirs cached
                          {folderSizeStats.pendingScans > 0
                            ? ` (${folderSizeStats.pendingScans} scanning…)`
                            : ''}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-[var(--card)] border border-[var(--border)] font-mono text-[var(--foreground)]">
                          {formatBytes(folderSizeStats.dbBytes)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={rescanCurrentFolderSizes}
                        title="Rescan folder sizes in current directory"
                        className="h-8 px-3 rounded-md bg-[var(--card)] border border-[var(--border)] hover:border-[var(--primary)] font-medium text-xs cursor-pointer flex items-center gap-1.5 justify-center transition-colors"
                      >
                        <KenneyIcon name="return" size={12} />
                        <span>Rescan</span>
                      </button>
                      <button
                        onClick={clearFolderSizeCache}
                        className="h-8 px-3 rounded-md bg-red-950/40 hover:bg-red-900/55 border border-red-500/30 text-white font-medium text-xs cursor-pointer flex items-center gap-1.5 justify-center transition-colors"
                      >
                        <KenneyIcon name="trashcan" size={13} />
                        <span>Purge</span>
                      </button>
                    </div>
                  </div>
                  {folderSizeStats.dbPath && (
                    <div className="font-mono text-[var(--muted-foreground)] truncate" title={folderSizeStats.dbPath}>
                      {folderSizeStats.dbPath}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end pt-2 border-t border-[var(--border)]">
                <button
                  onClick={toggleOptionsModal}
                  className="h-8 px-4 rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 font-medium text-xs cursor-pointer flex items-center justify-center transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Custom Rook Inline Prompt Modal (New Folder, New File, Rename F2, Add Tag) */}
        {promptModal && (
          <div
            onClick={closePromptModal}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl max-w-md w-full p-5 space-y-4 text-xs"
            >
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border)]">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-[var(--background)] border border-[var(--border)] flex items-center justify-center shrink-0">
                    <KenneyIcon
                      name={
                        promptModal.kind === 'newFolder'
                          ? 'pouch_add'
                          : promptModal.kind === 'newFile'
                            ? 'card_add'
                            : promptModal.kind === 'rename'
                              ? 'toolPencil'
                              : 'tag'
                      }
                      size={18}
                    />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-[var(--foreground)]">
                      {promptModal.title}
                    </h3>
                    {promptModal.subtitle && (
                      <div
                        className="text-[var(--muted-foreground)] font-mono truncate mt-0.5"
                        title={promptModal.subtitle}
                      >
                        {promptModal.subtitle}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={closePromptModal}
                  className="w-7 h-7 rounded-md hover:bg-white/[0.08] flex items-center justify-center cursor-pointer opacity-70 hover:opacity-100 transition-colors"
                >
                  <KenneyIcon name="cross" size={13} />
                </button>
              </div>

              <div className="space-y-1.5">
                <label className="text-[var(--muted-foreground)] font-medium block">
                  {promptModal.kind === 'addTag' ? 'Tag Name' : 'Name'}
                </label>
                <input
                  ref={promptInputRef}
                  type="text"
                  value={promptInput}
                  onChange={(e) => setPromptInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      submitPromptModal(promptInput);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      closePromptModal();
                    }
                  }}
                  className="w-full bg-[var(--background)] border border-[var(--border)] focus:border-[var(--primary)] rounded-lg px-3 py-2 text-sm text-[var(--foreground)] font-mono outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border)]">
                <button
                  onClick={closePromptModal}
                  className="h-8 px-4 rounded-md border border-[var(--border)] bg-[var(--background)] font-medium text-xs text-[var(--foreground)] hover:opacity-80 cursor-pointer flex items-center justify-center transition-colors"
                >
                  Cancel (Esc)
                </button>
                <button
                  onClick={() => submitPromptModal(promptInput)}
                  className="h-8 px-4 rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 font-semibold text-xs cursor-pointer flex items-center justify-center transition-colors"
                >
                  {promptModal.kind === 'rename'
                    ? 'Rename'
                    : promptModal.kind === 'addTag'
                      ? 'Add Tag'
                      : 'Create'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Prompt Modal */}
        {pendingDeletePath && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl max-w-md w-full p-5 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-red-950/50 border border-red-500/40 flex items-center justify-center shrink-0">
                  <KenneyIcon name="trashcan" size={20} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--foreground)]">
                    {deletePermanently ? 'Confirm Permanent Delete' : 'Move to Recycle Bin'}
                  </h3>
                  <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                    {pendingDeletePaths.length > 1 ? (
                      <>
                        Are you sure you want to {deletePermanently ? 'permanently delete' : 'recycle'}{' '}
                        <strong className="text-[var(--foreground)]">
                          {pendingDeletePaths.length} selected items
                        </strong>
                        ?
                      </>
                    ) : (
                      <>
                        Are you sure you want to {deletePermanently ? 'permanently delete' : 'recycle'}{' '}
                        <strong className="text-[var(--foreground)]">"{pendingDeleteName}"</strong>?
                      </>
                    )}
                  </p>
                </div>
              </div>
              <div className="text-xs font-mono bg-[var(--background)] border border-[var(--border)] rounded p-2 text-[var(--muted-foreground)] break-all max-h-28 overflow-y-auto space-y-1">
                {(pendingDeletePaths.length > 0 ? pendingDeletePaths : [pendingDeletePath]).map((p) => (
                  <div key={p} className="truncate">
                    {p}
                  </div>
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs text-[var(--muted-foreground)] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={deletePermanently}
                  onChange={(e) => setDeletePermanently(e.target.checked)}
                  className="w-4 h-4 accent-red-500 cursor-pointer"
                />
                <span>Permanently delete (skip Windows Recycle Bin — Shift+Del)</span>
              </label>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={cancelDeleteSelected}
                  className="h-8 px-4 rounded-md border border-[var(--border)] bg-[var(--background)] text-xs font-medium text-[var(--foreground)] hover:opacity-80 cursor-pointer flex items-center justify-center transition-colors"
                >
                  Cancel (Esc)
                </button>
                <button
                  onClick={confirmDeleteSelected}
                  className="h-8 px-4 rounded-md bg-red-900/60 hover:bg-red-800/80 border border-red-500/40 text-white text-xs font-semibold cursor-pointer flex items-center gap-1.5 justify-center transition-colors"
                >
                  <KenneyIcon name="trashcan" size={14} />
                  <span>{deletePermanently ? 'Delete Permanently' : 'Move to Recycle Bin'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        <footer className="bg-[var(--sidebar)] border-t border-[var(--border)] px-3 py-1.5 flex items-center justify-between text-xs text-[var(--muted-foreground)] select-none shrink-0">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <KenneyIcon name="pouch" size={13} />
              <span>
                {items.length} items{' '}
                {selectedPaths.length > 1
                  ? `(${selectedPaths.length} selected)`
                  : selectedEntry
                    ? `(Selected: ${selectedEntry.name})`
                    : ''}
              </span>
            </span>
            {clipboard && (
              <span className="text-[var(--primary)] font-medium">
                • Clipboard: {clipboard.paths.length} {clipboard.mode === 'cut' ? 'cut' : 'copied'}
              </span>
            )}
            {isLoading && <span className="text-[var(--primary)]">• Loading...</span>}
            {statusMessage && (
              <span className="text-emerald-500 flex items-center gap-1">
                <KenneyIcon name="checkmark" size={12} />
                <span>{statusMessage}</span>
              </span>
            )}
          </div>
        </footer>
      </main>
    </div>
  );
};
export default App;
