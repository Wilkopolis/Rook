import React, { useState } from 'react';
import { useExplorerStore } from '../store/useExplorerStore';
import { KenneyIcon } from './KenneyIcon';
import { handleFileDropToDir, hasFileDragData, setAppropriateDropEffect } from '../utils/dragDrop';

export const TabBar: React.FC = () => {
  const {
    tabs,
    activeTabId,
    switchTab,
    closeTab,
    addTab,
    reorderTabs,
    dropEntriesToDir,
    dropUrlToDir,
  } = useExplorerStore();

  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<string | null>(null);

  const handleDropOnPath = async (e: React.DragEvent, targetDir: string) => {
    setDragTarget(null);
    await handleFileDropToDir(e, targetDir, dropEntriesToDir, dropUrlToDir);
  };

  return (
    <div className="bg-[var(--sidebar)] border-b border-[var(--border)] h-9 px-0 py-0 flex items-stretch overflow-x-auto no-scrollbar text-xs select-none shrink-0">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const isDropOver = dragTarget === `tab:${tab.id}`;
        return (
          <div
            key={tab.id}
            draggable={tabs.length > 1}
            onClick={() => switchTab(tab.id)}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
              }
            }}
            onAuxClick={(e) => {
              if (e.button === 1 && tabs.length > 1) {
                e.preventDefault();
                e.stopPropagation();
                closeTab(tab.id);
              }
            }}
            onDragStart={(e) => {
              setDraggingTabId(tab.id);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('application/x-rook-tab-id', tab.id);
            }}
            onDragEnd={() => {
              setDraggingTabId(null);
              setDragTarget(null);
            }}
            onDragOver={(e) => {
              if (draggingTabId || e.dataTransfer.types.includes('application/x-rook-tab-id')) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (draggingTabId && draggingTabId !== tab.id) {
                  reorderTabs(draggingTabId, tab.id);
                }
                return;
              }
              if (!hasFileDragData(e.dataTransfer)) return;
              e.preventDefault();
              setAppropriateDropEffect(e.dataTransfer, e.ctrlKey);
              setDragTarget(`tab:${tab.id}`);
            }}
            onDragLeave={() => setDragTarget(null)}
            onDrop={(e) => {
              const srcTabId = e.dataTransfer.getData('application/x-rook-tab-id');
              if (srcTabId) {
                e.preventDefault();
                if (srcTabId !== tab.id) {
                  reorderTabs(srcTabId, tab.id);
                }
                setDraggingTabId(null);
                return;
              }
              handleDropOnPath(e, tab.path);
            }}
            className={`h-full px-4 flex items-center gap-2.5 cursor-pointer transition-colors border-r border-[var(--border)] shrink-0 ${
              draggingTabId === tab.id ? 'opacity-60 ' : ''
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
            {tabs.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="w-5 h-5 rounded hover:bg-white/[0.12] opacity-60 hover:opacity-100 cursor-pointer flex items-center justify-center ml-0.5 shrink-0 transition-colors"
                title="Close Tab"
              >
                <KenneyIcon name="cross" size={11} />
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={() => addTab()}
        className="h-full w-9 bg-[var(--sidebar)] hover:bg-[var(--card)] border-r border-[var(--border)] flex items-center justify-center cursor-pointer shrink-0 transition-colors"
        title="New Tab"
      >
        <KenneyIcon name="plusBold" size={14} />
      </button>
    </div>
  );
};
