import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useExplorerStore } from '../store/useExplorerStore';
import { FsEntry, SplitPanelIndex, SplitPanelState } from '../types/fs';
import { formatBytes, formatRelativeTime } from '../utils/format';
import { KenneyIcon } from './KenneyIcon';
import { FileThumbnail } from './FileThumbnail';
import { handleFileDropToDir, hasFileDragData, setAppropriateDropEffect } from '../utils/dragDrop';
import { visibleSplitItems } from '../utils/splitPanels';

const ROW_HEIGHT = 28;

interface PanelProps {
  index: SplitPanelIndex;
  panel: SplitPanelState;
  items: FsEntry[];
  error: string | null;
}

const SplitPanel: React.FC<PanelProps> = ({ index, panel, items, error }) => {
  const sortBy = useExplorerStore((s) => s.sortBy);
  const sortAsc = useExplorerStore((s) => s.sortAsc);
  const showHiddenFiles = useExplorerStore((s) => s.showHiddenFiles);
  const clipboard = useExplorerStore((s) => s.clipboard);
  const navigateSplitPanel = useExplorerStore((s) => s.navigateSplitPanel);
  const splitPanelBack = useExplorerStore((s) => s.splitPanelBack);
  const splitPanelForward = useExplorerStore((s) => s.splitPanelForward);
  const splitPanelUp = useExplorerStore((s) => s.splitPanelUp);
  const selectSplitPanelEntry = useExplorerStore((s) => s.selectSplitPanelEntry);
  const setSplitPanelSelection = useExplorerStore((s) => s.setSplitPanelSelection);
  const openEntry = useExplorerStore((s) => s.openEntry);
  const dropEntriesToDir = useExplorerStore((s) => s.dropEntriesToDir);
  const dropUrlToDir = useExplorerStore((s) => s.dropUrlToDir);

  const setActiveSplitPanel = useExplorerStore((s) => s.setActiveSplitPanel);
  const isActive = useExplorerStore(
    (s) => (s.tabs.find((t) => t.id === s.activeTabId)?.activeSplitPanel ?? 0) === index,
  );

  const [dragTargetDir, setDragTargetDir] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const visible = useMemo(
    () => visibleSplitItems(items, showHiddenFiles, sortBy, sortAsc),
    [items, showHiddenFiles, sortBy, sortAsc],
  );

  const orderedPaths = useMemo(() => visible.map((f) => f.path), [visible]);
  const selectedSet = useMemo(() => new Set(panel.selectedPaths), [panel.selectedPaths]);

  const rowVirtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  // Start at the top when the panel moves to a different folder.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [panel.path]);

  // Keep the keyboard-selected row in view.
  useEffect(() => {
    if (!panel.selectedPath) return;
    const idx = orderedPaths.indexOf(panel.selectedPath);
    if (idx >= 0) rowVirtualizer.scrollToIndex(idx, { align: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel.selectedPath]);

  const isCut = (path: string) => clipboard?.mode === 'cut' && clipboard.paths.includes(path);

  const refreshPanels = () => {
    const { tabs, activeTabId } = useExplorerStore.getState();
    const panels = tabs.find((t) => t.id === activeTabId)?.splitPanels;
    if (!panels) return;
    void navigateSplitPanel(0, panels[0].path, false);
    void navigateSplitPanel(1, panels[1].path, false);
  };

  const dropTo = async (e: React.DragEvent, dir: string) => {
    setDragTargetDir(null);
    await handleFileDropToDir(e, dir, dropEntriesToDir, dropUrlToDir);
    refreshPanels();
  };

  const dragOver = (e: React.DragEvent, dir: string) => {
    if (!hasFileDragData(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setAppropriateDropEffect(e.dataTransfer, e.ctrlKey);
    if (dragTargetDir !== dir) setDragTargetDir(dir);
  };

  const dragLeave = (e: React.DragEvent, dir: string) => {
    e.stopPropagation();
    if (dragTargetDir === dir) setDragTargetDir(null);
  };

  const dragStart = (e: React.DragEvent, entry: FsEntry) => {
    const paths = selectedSet.has(entry.path) && panel.selectedPaths.length > 0
      ? panel.selectedPaths
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

  const openItem = (entry: FsEntry) => {
    if (entry.isDirectory) void navigateSplitPanel(index, entry.path, true);
    else void openEntry(entry);
  };

  const canBack = panel.historyIndex > 0;
  const canForward = panel.historyIndex < panel.history.length - 1;
  const navBtn = (enabled: boolean) =>
    `p-1 rounded border border-[var(--border)] bg-[var(--card)] shrink-0 ${
      enabled ? 'cursor-pointer hover:border-[var(--primary)]' : 'opacity-40 cursor-default'
    }`;

  return (
    <div
      data-split-panel={index}
      tabIndex={-1}
      onMouseDownCapture={() => setActiveSplitPanel(index)}
      onFocusCapture={() => setActiveSplitPanel(index)}
      onDragOver={(e) => dragOver(e, panel.path)}
      onDragLeave={(e) => dragLeave(e, panel.path)}
      onDrop={(e) => dropTo(e, panel.path)}
      className={`flex-1 min-w-0 flex flex-col bg-[var(--center-bg)] overflow-hidden ${
        dragTargetDir === panel.path ? 'ring-2 ring-inset ring-sky-400' : ''
      }`}
    >
      <div
        className={`px-2 py-1.5 bg-[var(--sidebar)] border-b flex items-center gap-1.5 ${
          isActive ? 'border-[var(--primary)] shadow-[inset_0_-2px_0_var(--primary)]' : 'border-[var(--border)]'
        }`}
        data-active={isActive}
      >
        <button
          className={navBtn(canBack)}
          disabled={!canBack}
          onClick={() => void splitPanelBack(index)}
          title="Back"
        >
          <KenneyIcon name="arrowLeft" size={12} />
        </button>
        <button
          className={navBtn(canForward)}
          disabled={!canForward}
          onClick={() => void splitPanelForward(index)}
          title="Forward"
        >
          <KenneyIcon name="arrowRight" size={12} />
        </button>
        <button className={navBtn(true)} onClick={() => void splitPanelUp(index)} title="Up one level">
          <KenneyIcon name="arrowUp" size={12} />
        </button>
        <span
          className="font-mono text-xs font-semibold text-[var(--foreground)]/85 truncate ml-1"
          title={panel.path}
        >
          {panel.path}
        </span>
      </div>

      {error ? (
        <div className="p-3 text-xs text-red-400">{error}</div>
      ) : (
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto text-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSplitPanelSelection(index, []);
          }}
        >
          <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map((vr) => {
              const f = visible[vr.index];
              const selected = selectedSet.has(f.path);
              const dropTarget = f.isDirectory && dragTargetDir === f.path;
              return (
                <div
                  key={f.path}
                  data-entry-path={f.path}
                  draggable
                  onDragStart={(e) => dragStart(e, f)}
                  onDragOver={f.isDirectory ? (e) => dragOver(e, f.path) : undefined}
                  onDragLeave={f.isDirectory ? (e) => dragLeave(e, f.path) : undefined}
                  onDrop={f.isDirectory ? (e) => dropTo(e, f.path) : undefined}
                  onClick={(e) =>
                    selectSplitPanelEntry(index, f, {
                      ctrl: e.ctrlKey || e.metaKey,
                      shift: e.shiftKey,
                      orderedPaths,
                    })
                  }
                  onDoubleClick={() => openItem(f)}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: ROW_HEIGHT,
                    transform: `translateY(${vr.start}px)`,
                  }}
                  className={`px-3 flex items-center gap-2 cursor-pointer ${
                    dropTarget
                      ? 'bg-sky-500/20 ring-1 ring-inset ring-sky-400'
                      : selected
                        ? 'bg-white/[0.12] text-[var(--foreground)] ring-1 ring-inset ring-slate-400/40 dark:ring-white/[0.22]'
                        : f.isDirectory
                          ? 'bg-white/[0.02] hover:bg-white/[0.05]'
                          : 'hover:bg-white/[0.035]'
                  } ${isCut(f.path) ? 'opacity-50' : ''}`}
                >
                  <FileThumbnail entry={f} size={18} />
                  <span className={`flex-1 truncate ${f.isDirectory ? 'text-[var(--foreground)]/85' : ''}`}>
                    {f.name}
                  </span>
                  <span className="text-[var(--muted-foreground)] shrink-0 w-14 text-right">
                    {formatRelativeTime(f.modifiedMs)}
                  </span>
                  <span className="font-mono text-[var(--muted-foreground)] shrink-0 w-20 text-right">
                    {formatBytes(f.sizeBytes, f.isDirectory)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

/** Split layout: two independent folder views side by side, each with its own path, history and selection. */
export const SplitPanelsView: React.FC = () => {
  const activeTabId = useExplorerStore((s) => s.activeTabId);
  const panels = useExplorerStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.splitPanels);
  const splitPanelItems = useExplorerStore((s) => s.splitPanelItems);
  const splitPanelErrors = useExplorerStore((s) => s.splitPanelErrors);
  const initSplitPanels = useExplorerStore((s) => s.initSplitPanels);

  // Listings are per active tab and session-only, so (re)load them on mount and tab switch.
  useEffect(() => {
    void initSplitPanels();
  }, [activeTabId, initSplitPanels]);

  if (!panels) {
    return <div className="flex-1 p-3 text-xs text-[var(--muted-foreground)]">Loading panels…</div>;
  }

  return (
    <div className="flex-1 flex divide-x divide-[var(--border)] overflow-hidden">
      <SplitPanel index={0} panel={panels[0]} items={splitPanelItems[0]} error={splitPanelErrors[0]} />
      <SplitPanel index={1} panel={panels[1]} items={splitPanelItems[1]} error={splitPanelErrors[1]} />
    </div>
  );
};
