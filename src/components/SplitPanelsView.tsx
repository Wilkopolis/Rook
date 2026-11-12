import { InlineRenameName } from './InlineRename';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useExplorerStore } from '../store/useExplorerStore';
import { FsEntry, SplitPanelIndex, SplitPanelState } from '../types/fs';
import { FileThumbnail } from './FileThumbnail';
import { FileColumnCells, FileColumnHeader, useFileColumns } from './FileColumns';
import { TabStrip } from './TabStrip';
import { handleFileDropToDir, hasFileDragData, setAppropriateDropEffect, startNativeFileDrag } from '../utils/dragDrop';
import { visibleSplitItems } from '../utils/splitPanels';

const ROW_HEIGHT = 28;

interface PanelProps {
  index: SplitPanelIndex;
  panel: SplitPanelState;
  items: FsEntry[];
  error: string | null;
}

const SplitPanel: React.FC<PanelProps> = ({ index, panel, items, error }) => {
  const { widths: colWidths, visible: colVisible } = useFileColumns();
  const nameWidth = colWidths.name;
  // Natural width of the columns; below this the panel scrolls horizontally as one piece.
  const contentMinWidth =
    24 + 16 + (nameWidth || 120) +
    (Object.keys(colVisible) as (keyof typeof colVisible)[]).reduce(
      (sum, k) => sum + (colVisible[k] ? colWidths[k] : 0),
      0,
    );
  const sortBy = useExplorerStore((s) => s.splitPanelSorts[index].sortBy);
  const sortAsc = useExplorerStore((s) => s.splitPanelSorts[index].sortAsc);
  const setSplitPanelSort = useExplorerStore((s) => s.setSplitPanelSort);
  const showHiddenFiles = useExplorerStore((s) => s.showHiddenFiles);
  const clipboard = useExplorerStore((s) => s.clipboard);
  const navigateSplitPanel = useExplorerStore((s) => s.navigateSplitPanel);
  const selectSplitPanelEntry = useExplorerStore((s) => s.selectSplitPanelEntry);
  const setSplitPanelSelection = useExplorerStore((s) => s.setSplitPanelSelection);
  const openEntry = useExplorerStore((s) => s.openEntry);
  const openSplitPanelContextMenu = useExplorerStore((s) => s.openSplitPanelContextMenu);
  const dropEntriesToDir = useExplorerStore((s) => s.dropEntriesToDir);
  const dropUrlToDir = useExplorerStore((s) => s.dropUrlToDir);

  const setActiveSplitPanel = useExplorerStore((s) => s.setActiveSplitPanel);
  const addSplitPaneTab = useExplorerStore((s) => s.addSplitPaneTab);
  const switchSplitPaneTab = useExplorerStore((s) => s.switchSplitPaneTab);
  const closeSplitPaneTab = useExplorerStore((s) => s.closeSplitPaneTab);
  const reorderSplitPaneTabs = useExplorerStore((s) => s.reorderSplitPaneTabs);
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
    if (startNativeFileDrag(e, paths)) return;
    e.dataTransfer.setData('application/x-rook-paths', JSON.stringify(paths));
    e.dataTransfer.setData('text/plain', paths.join('\n'));
    e.dataTransfer.effectAllowed = 'copyMove';
  };

  const openItem = (entry: FsEntry) => {
    if (entry.isDirectory) void navigateSplitPanel(index, entry.path, true);
    else void openEntry(entry);
  };

  const activePaneTabId = panel.activePaneTabId ?? 'pt-0';
  const paneTabs = panel.paneTabs?.length
    ? panel.paneTabs
    : [{ id: activePaneTabId, path: panel.path }];
  const tabLabel = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

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
        className={`h-0.5 shrink-0 ${isActive ? 'bg-[var(--primary)]' : 'bg-[var(--border)]'}`}
        data-active={isActive}
      />

      <TabStrip
        items={paneTabs.map((t) => {
          const path = t.id === activePaneTabId ? panel.path : t.path;
          return { id: t.id, title: tabLabel(path), path };
        })}
        activeId={activePaneTabId}
        onSelect={(id) => void switchSplitPaneTab(index, id)}
        onClose={(id) => void closeSplitPaneTab(index, id)}
        onAdd={() => void addSplitPaneTab(index)}
        onReorder={(from, to) => reorderSplitPaneTabs(index, from, to)}
        onFilesDropped={refreshPanels}
        dragKey={`pane-${index}`}
      />

      {/* One horizontal scroller for header + rows; its scrollbar sits along the bottom. */}
      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
      <div className="h-full flex flex-col" style={{ minWidth: contentMinWidth }}>
      {/* Same gutter rule as the list below so header and row columns line up. */}
      <div className="shrink-0 overflow-hidden [scrollbar-gutter:stable]">
        <FileColumnHeader
          sortBy={sortBy}
          sortAsc={sortAsc}
          onSort={(field) => setSplitPanelSort(index, field)}
          className="px-3"
          nameMinWidth="min-w-[80px]"
        />
      </div>

      {error ? (
        <div className="p-3 text-xs text-red-400">{error}</div>
      ) : (
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable] text-xs"
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
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openSplitPanelContextMenu(index, e.clientX, e.clientY, f);
                  }}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: ROW_HEIGHT,
                    transform: `translateY(${vr.start}px)`,
                  }}
                  className={`px-3 flex items-center cursor-pointer ${
                    dropTarget
                      ? 'bg-sky-500/20 ring-1 ring-inset ring-sky-400'
                      : selected
                        ? 'bg-[var(--foreground)]/[0.12] text-[var(--foreground)] ring-1 ring-inset ring-[var(--border)]'
                        : f.isDirectory
                          ? 'bg-[var(--foreground)]/[0.02] hover:bg-[var(--foreground)]/[0.05]'
                          : 'hover:bg-[var(--foreground)]/[0.035]'
                  } ${isCut(f.path) ? 'opacity-50' : ''}`}
                >
                  <div
                    style={nameWidth ? { width: nameWidth } : undefined}
                    className={`${nameWidth ? 'shrink-0' : 'flex-1'} min-w-[80px] flex items-center gap-2 pr-2`}
                  >
                    <FileThumbnail entry={f} size={18} />
                    <InlineRenameName
                      entry={f}
                      className={`truncate ${f.isDirectory ? 'text-[var(--foreground)]/85' : 'text-[var(--foreground)]'}`}
                    />
                  </div>
                  <FileColumnCells entry={f} />
                </div>
              );
            })}
          </div>
        </div>
      )}
      </div>
      </div>
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
