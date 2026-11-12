import React, { useState } from 'react';
import { KenneyIcon } from './KenneyIcon';
import { useExplorerStore } from '../store/useExplorerStore';
import { handleFileDropToDir, hasFileDragData, setAppropriateDropEffect } from '../utils/dragDrop';

export interface TabStripItem {
  id: string;
  title: string;
  /** Folder the tab shows; file drops onto the tab go here. */
  path: string;
}

interface TabStripProps {
  items: TabStripItem[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
  onReorder: (fromId: string, toId: string) => void;
  /** Called after files were dropped onto a tab (e.g. to refresh listings). */
  onFilesDropped?: () => void;
  /** Distinguishes drag payloads so tabs can't be dragged between different strips. */
  dragKey?: string;
}

/** The tab bar look & behavior, shared by the main view and each split pane. */
export const TabStrip: React.FC<TabStripProps> = ({
  items,
  activeId,
  onSelect,
  onClose,
  onAdd,
  onReorder,
  onFilesDropped,
  dragKey = 'main',
}) => {
  const dropEntriesToDir = useExplorerStore((s) => s.dropEntriesToDir);
  const dropUrlToDir = useExplorerStore((s) => s.dropUrlToDir);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);

  const dragType = `application/x-rook-tab-id-${dragKey}`;

  const handleDropOnPath = async (e: React.DragEvent, targetDir: string) => {
    setDragTarget(null);
    await handleFileDropToDir(e, targetDir, dropEntriesToDir, dropUrlToDir);
    onFilesDropped?.();
  };

  return (
    <div className="bg-[var(--sidebar)] border-b border-[var(--border)] h-9 px-0 py-0 flex items-stretch overflow-x-auto no-scrollbar text-xs select-none shrink-0">
      {items.map((tab) => {
        const isActive = tab.id === activeId;
        const isDropOver = dragTarget === tab.id;
        return (
          <div
            key={tab.id}
            title={tab.path}
            draggable={items.length > 1}
            onClick={() => onSelect(tab.id)}
            onMouseDown={(e) => {
              if (e.button === 1) e.preventDefault();
            }}
            onAuxClick={(e) => {
              if (e.button === 1 && items.length > 1) {
                e.preventDefault();
                e.stopPropagation();
                onClose(tab.id);
              }
            }}
            onDragStart={(e) => {
              e.stopPropagation();
              setDraggingId(tab.id);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData(dragType, tab.id);
            }}
            onDragEnd={() => {
              setDraggingId(null);
              setDragTarget(null);
            }}
            onDragOver={(e) => {
              if (draggingId || e.dataTransfer.types.includes(dragType)) {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
                if (draggingId && draggingId !== tab.id) onReorder(draggingId, tab.id);
                return;
              }
              if (!hasFileDragData(e.dataTransfer)) return;
              e.preventDefault();
              e.stopPropagation();
              setAppropriateDropEffect(e.dataTransfer, e.ctrlKey);
              setDragTarget(tab.id);
            }}
            onDragLeave={(e) => {
              e.stopPropagation();
              setDragTarget(null);
            }}
            onDrop={(e) => {
              e.stopPropagation();
              const srcId = e.dataTransfer.getData(dragType);
              if (srcId) {
                e.preventDefault();
                if (srcId !== tab.id) onReorder(srcId, tab.id);
                setDraggingId(null);
                return;
              }
              void handleDropOnPath(e, tab.path);
            }}
            className={`h-full px-4 flex items-center gap-2.5 cursor-pointer transition-colors border-r border-[var(--border)] shrink-0 ${
              draggingId === tab.id ? 'opacity-60 ' : ''
            }${
              isDropOver
                ? 'bg-sky-500/25 ring-1 ring-inset ring-sky-400 text-[var(--foreground)]'
                : isActive
                  ? 'bg-[var(--center-bg)] text-[var(--foreground)]/90 font-semibold border-b-2 border-b-[var(--primary)]'
                  : 'bg-[var(--sidebar)] text-[var(--muted-foreground)] hover:bg-[var(--card)] hover:text-[var(--foreground)]'
            }`}
          >
            <KenneyIcon name={isActive ? 'pouch' : 'book_closed'} size={14} />
            <span className="max-w-[180px] truncate">{tab.title}</span>
            {items.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                className="w-5 h-5 rounded hover:bg-[var(--foreground)]/[0.12] opacity-60 hover:opacity-100 cursor-pointer flex items-center justify-center ml-0.5 shrink-0 transition-colors"
                title="Close Tab"
              >
                <KenneyIcon name="cross" size={11} />
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={onAdd}
        className="h-full w-9 bg-[var(--sidebar)] hover:bg-[var(--card)] border-r border-[var(--border)] flex items-center justify-center cursor-pointer shrink-0 transition-colors"
        title="New Tab"
      >
        <KenneyIcon name="plusBold" size={14} />
      </button>
    </div>
  );
};
