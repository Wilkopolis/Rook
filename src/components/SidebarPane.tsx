import React, { useState, useMemo } from 'react';
import { useExplorerStore } from '../store/useExplorerStore';
import { formatBytes } from '../utils/format';
import { KenneyIcon } from './KenneyIcon';
import { handleFileDropToDir, hasFileDragData, setAppropriateDropEffect } from '../utils/dragDrop';
import { IconPickerDialog } from './IconPickerDialog';
import { SidebarSectionId } from '../types/fs';

function reorderList<T extends { id: string }>(
  list: T[],
  sourceId: string,
  targetId: string,
  position: 'before' | 'after'
): T[] {
  if (sourceId === targetId) return list;
  const sourceIndex = list.findIndex((item) => item.id === sourceId);
  if (sourceIndex === -1) return list;
  const itemToMove = list[sourceIndex];
  const listWithout = list.filter((item) => item.id !== sourceId);
  const targetIndex = listWithout.findIndex((item) => item.id === targetId);
  if (targetIndex === -1) return list;
  const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
  const result = [...listWithout];
  result.splice(insertIndex, 0, itemToMove);
  return result;
}

function reorderArray<T extends string>(
  list: T[],
  source: T,
  target: T,
  position: 'before' | 'after'
): T[] {
  if (source === target) return list;
  const sourceIndex = list.indexOf(source);
  if (sourceIndex === -1) return list;
  const listWithout = list.filter((item) => item !== source);
  const targetIndex = listWithout.indexOf(target);
  if (targetIndex === -1) return list;
  const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
  const result = [...listWithout];
  result.splice(insertIndex, 0, source);
  return result;
}

const GripIcon: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg
    viewBox="0 0 16 16"
    fill="currentColor"
    className={`w-2.5 h-2.5 shrink-0 select-none ${className}`}
    aria-hidden="true"
  >
    <circle cx="5" cy="3.5" r="1.2" />
    <circle cx="11" cy="3.5" r="1.2" />
    <circle cx="5" cy="8" r="1.2" />
    <circle cx="11" cy="8" r="1.2" />
    <circle cx="5" cy="12.5" r="1.2" />
    <circle cx="11" cy="12.5" r="1.2" />
  </svg>
);

const DropIndicator: React.FC = () => (
  <div className="h-0.5 w-full bg-sky-400 rounded-full shadow-[0_0_8px_rgba(56,189,248,0.85)] my-0.5 pointer-events-none transition-all duration-75" />
);

const SectionDropIndicator: React.FC = () => (
  <div className="h-0.5 w-full bg-sky-400 rounded-full shadow-[0_0_8px_rgba(56,189,248,0.85)] my-1 pointer-events-none transition-all duration-75" />
);


interface StyleModalTarget {
  kind: 'quickAccess' | 'workflow';
  id: string;
  label: string;
  icon?: string;
  iconColor?: string;
}

interface EditingTarget {
  kind: 'quickAccess' | 'workflow';
  id: string;
}

export const SidebarPane: React.FC = () => {
  const {
    showSidebar,
    drives,
    driveDetails,
    pinnedFolders,
    workflows,
    sidebarSectionOrder,
    currentPath,
    layout,
    navigateTo,
    togglePinFolder,
    pinQuickAccessFolder,
    unpinQuickAccessFolder,
    renameQuickAccessFolder,
    updateQuickAccessFolderStyle,
    pinWorkflow,
    unpinWorkflow,
    renameWorkflow,
    updateWorkflowStyle,
    loadWorkflow,
    reorderSidebarSections,
    reorderQuickAccessFolders,
    reorderWorkflows,
    dropEntriesToDir,
    dropUrlToDir,
  } = useExplorerStore();

  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingTarget | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [styleModalTarget, setStyleModalTarget] = useState<StyleModalTarget | null>(null);
  const [selectedIcon, setSelectedIcon] = useState<string>('folder');
  const [selectedColor, setSelectedColor] = useState<string>('#38bdf8');

  // Drag and reorder state
  const [draggingSectionId, setDraggingSectionId] = useState<SidebarSectionId | null>(null);
  const [sectionDropTarget, setSectionDropTarget] = useState<{
    id: SidebarSectionId;
    position: 'before' | 'after';
  } | null>(null);

  const [draggingQuickAccessId, setDraggingQuickAccessId] = useState<string | null>(null);
  const [quickAccessDropTarget, setQuickAccessDropTarget] = useState<{
    id: string;
    position: 'before' | 'after';
  } | null>(null);

  const [draggingWorkflowId, setDraggingWorkflowId] = useState<string | null>(null);
  const [workflowDropTarget, setWorkflowDropTarget] = useState<{
    id: string;
    position: 'before' | 'after';
  } | null>(null);

  const [isQuickAccessDropPinActive, setIsQuickAccessDropPinActive] = useState(false);

  const commitRename = () => {
    const clean = editingLabel.trim();
    if (clean && editing) {
      if (editing.kind === 'quickAccess') {
        renameQuickAccessFolder(editing.id, clean);
      } else {
        renameWorkflow(editing.id, clean);
      }
    }
    setEditing(null);
  };

  const commitStyleChange = (selectedIcon: string, selectedColor: string) => {
    if (!styleModalTarget) return;
    if (styleModalTarget.kind === 'quickAccess') {
      updateQuickAccessFolderStyle(styleModalTarget.id, selectedIcon, selectedColor);
    } else {
      updateWorkflowStyle(styleModalTarget.id, selectedIcon, selectedColor);
    }
    setStyleModalTarget(null);
  };

  // Must stay after every hook: an early return above them changes the hook count on toggle (React #300/#310).
  if (!showSidebar) return null;

  const bindDropTarget = (targetDir: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!hasFileDragData(e.dataTransfer)) return;
      e.preventDefault();
      setAppropriateDropEffect(e.dataTransfer, e.ctrlKey);
      setDragTarget(targetDir);
    },
    onDragLeave: () => setDragTarget(null),
    onDrop: async (e: React.DragEvent) => {
      setDragTarget(null);
      await handleFileDropToDir(e, targetDir, dropEntriesToDir, dropUrlToDir);
    },
  });

  const renderQuickAccess = () => (
    <div>
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-rook-sidebar-section', 'quickAccess');
          e.dataTransfer.effectAllowed = 'move';
          setDraggingSectionId('quickAccess');
        }}
        onDragEnd={() => {
          setDraggingSectionId(null);
          setSectionDropTarget(null);
        }}
        className="flex items-center justify-between px-1.5 mb-1 group/sec-hdr cursor-grab active:cursor-grabbing hover:bg-white/[0.04] rounded py-0.5 transition-colors"
        title="Quick Access — Drag header to reorder section"
      >
        <div className="flex items-center gap-1 min-w-0">
          <GripIcon className="text-[var(--muted-foreground)] opacity-30 group-hover/sec-hdr:opacity-100 transition-opacity" />
          <span className="text-[10px] text-[var(--muted-foreground)] group-hover/sec-hdr:text-[var(--foreground)] font-semibold uppercase tracking-wider truncate">
            Quick Access
          </span>
        </div>
        {currentPath && (
          <button
            type="button"
            draggable={false}
            onDragStart={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              togglePinFolder(currentPath);
            }}
            title="Pin Current Folder to Quick Access"
            className="text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer flex items-center gap-0.5 shrink-0"
          >
            <KenneyIcon name="plusBold" size={10} />
            <span>Pin</span>
          </button>
        )}
      </div>

      {isQuickAccessDropPinActive && (
        <div className="mx-1 mb-1 px-2 py-1 text-[10px] text-sky-400 bg-sky-500/10 border border-dashed border-sky-400/50 rounded text-center animate-pulse">
          Drop folder here to pin
        </div>
      )}

      <div
        className="space-y-px min-h-[4px]"
        onDragOver={(e) => {
          if (
            hasFileDragData(e.dataTransfer) &&
            !draggingQuickAccessId &&
            !draggingWorkflowId &&
            !draggingSectionId
          ) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            setIsQuickAccessDropPinActive(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsQuickAccessDropPinActive(false);
          }
        }}
        onDrop={(e) => {
          if (isQuickAccessDropPinActive) {
            setIsQuickAccessDropPinActive(false);
            const rawRook = e.dataTransfer.getData('application/x-rook-paths');
            if (rawRook) {
              try {
                const paths: string[] = JSON.parse(rawRook);
                if (Array.isArray(paths)) {
                  paths.forEach((p) => pinQuickAccessFolder(p));
                }
              } catch {}
            }
          }
        }}
      >
        {pinnedFolders.map((pin) => {
          const isEditing = editing?.kind === 'quickAccess' && editing.id === pin.id;
          const isActive = currentPath.toLowerCase() === pin.path.toLowerCase();
          const isDraggingThis = draggingQuickAccessId === pin.id;
          const isDropTargetBefore =
            quickAccessDropTarget?.id === pin.id && quickAccessDropTarget.position === 'before';
          const isDropTargetAfter =
            quickAccessDropTarget?.id === pin.id && quickAccessDropTarget.position === 'after';

          return (
            <React.Fragment key={pin.id}>
              {isDropTargetBefore && <DropIndicator />}
              <div
                draggable={!isEditing}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-rook-quick-access-item', pin.id);
                  e.dataTransfer.effectAllowed = 'move';
                  setDraggingQuickAccessId(pin.id);
                }}
                onDragEnd={() => {
                  setDraggingQuickAccessId(null);
                  setQuickAccessDropTarget(null);
                }}
                onDragOver={(e) => {
                  if (
                    draggingQuickAccessId ||
                    e.dataTransfer.types.includes('application/x-rook-quick-access-item')
                  ) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'move';
                    const rect = e.currentTarget.getBoundingClientRect();
                    const isAbove = e.clientY < rect.top + rect.height / 2;
                    setQuickAccessDropTarget({ id: pin.id, position: isAbove ? 'before' : 'after' });
                    return;
                  }
                  if (hasFileDragData(e.dataTransfer)) {
                    e.preventDefault();
                    setAppropriateDropEffect(e.dataTransfer, e.ctrlKey);
                    setDragTarget(pin.path);
                  }
                }}
                onDragLeave={(e) => {
                  if (
                    quickAccessDropTarget?.id === pin.id &&
                    !e.currentTarget.contains(e.relatedTarget as Node)
                  ) {
                    setQuickAccessDropTarget(null);
                  }
                  if (dragTarget === pin.path && !e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDragTarget(null);
                  }
                }}
                onDrop={async (e) => {
                  if (
                    draggingQuickAccessId ||
                    e.dataTransfer.types.includes('application/x-rook-quick-access-item')
                  ) {
                    e.preventDefault();
                    e.stopPropagation();
                    const sourceId =
                      e.dataTransfer.getData('application/x-rook-quick-access-item') ||
                      draggingQuickAccessId;
                    if (sourceId && sourceId !== pin.id && quickAccessDropTarget) {
                      const nextList = reorderList(
                        pinnedFolders,
                        sourceId,
                        pin.id,
                        quickAccessDropTarget.position
                      );
                      reorderQuickAccessFolders(nextList);
                    }
                    setDraggingQuickAccessId(null);
                    setQuickAccessDropTarget(null);
                    return;
                  }
                  setDragTarget(null);
                  await handleFileDropToDir(e, pin.path, dropEntriesToDir, dropUrlToDir);
                }}
                onClick={() => {
                  if (!isEditing) navigateTo(pin.path);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditing({ kind: 'quickAccess', id: pin.id });
                  setEditingLabel(pin.label);
                }}
                title={`${pin.path}\nClick to navigate\nDouble-click to rename\nDrag to reorder`}
                className={`group px-2 py-1 rounded cursor-pointer flex items-center justify-between gap-1 transition-colors ${
                  isDraggingThis
                    ? 'opacity-30'
                    : dragTarget === pin.path
                      ? 'bg-sky-500/20 ring-1 ring-sky-400 text-[var(--foreground)]'
                      : isActive
                        ? 'bg-[var(--card)] text-[var(--foreground)] font-medium border border-[var(--border)]'
                        : 'text-[var(--muted-foreground)] hover:bg-[var(--card)]/50'
                }`}
              >
                <span className="flex items-center gap-1.5 truncate min-w-0 flex-1">
                  <span
                    title="Drag to reorder"
                    className="cursor-grab active:cursor-grabbing text-[var(--muted-foreground)] opacity-0 group-hover:opacity-60 hover:!opacity-100 -ml-1 transition-opacity shrink-0 flex items-center"
                  >
                    <GripIcon />
                  </span>
                  <button
                    type="button"
                    draggable={false}
                    onDragStart={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setStyleModalTarget({
                        kind: 'quickAccess',
                        id: pin.id,
                        label: pin.label,
                        icon: pin.icon || 'folder',
                        iconColor: pin.iconColor || '#38bdf8',
                      });
                      setSelectedIcon(pin.icon || 'folder');
                      setSelectedColor(pin.iconColor || '#38bdf8');
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                    title="Click to customize icon & color"
                    className="p-0.5 -ml-0.5 rounded hover:bg-white/[0.08] cursor-pointer flex items-center justify-center shrink-0"
                  >
                    <KenneyIcon
                      name={pin.icon || 'folder'}
                      size={14}
                      color={pin.iconColor}
                    />
                  </button>
                  {isEditing ? (
                    <input
                      autoFocus
                      type="text"
                      draggable={false}
                      value={editingLabel}
                      onFocus={(e) => e.currentTarget.select()}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                      onDragStart={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onChange={(e) => setEditingLabel(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitRename();
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          setEditing(null);
                        }
                      }}
                      className="w-full min-w-0 bg-[var(--background)] text-[var(--foreground)] px-1 py-0 rounded border border-sky-400/70 outline-none text-xs leading-tight"
                    />
                  ) : (
                    <span className="truncate">{pin.label}</span>
                  )}
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    draggable={false}
                    onDragStart={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      unpinQuickAccessFolder(pin.id);
                    }}
                    title="Unpin from Quick Access"
                    className="opacity-0 group-hover:opacity-80 hover:!opacity-100 w-4 h-4 aspect-square flex items-center justify-center rounded hover:bg-[var(--background)] cursor-pointer shrink-0"
                  >
                    <KenneyIcon name="cross" size={10} />
                  </button>
                </span>
              </div>
              {isDropTargetAfter && <DropIndicator />}
            </React.Fragment>
          );
        })}
        {pinnedFolders.length === 0 && (
          <div className="px-2 py-1.5 text-[10px] text-[var(--muted-foreground)]/60 italic">
            No pinned folders
          </div>
        )}
      </div>
    </div>
  );

  const renderDrives = () => (
    <div>
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-rook-sidebar-section', 'drives');
          e.dataTransfer.effectAllowed = 'move';
          setDraggingSectionId('drives');
        }}
        onDragEnd={() => {
          setDraggingSectionId(null);
          setSectionDropTarget(null);
        }}
        className="flex items-center gap-1 px-1.5 mb-1 group/sec-hdr cursor-grab active:cursor-grabbing hover:bg-white/[0.04] rounded py-0.5 transition-colors"
        title="Drives & Mounts — Drag header to reorder section"
      >
        <GripIcon className="text-[var(--muted-foreground)] opacity-30 group-hover/sec-hdr:opacity-100 transition-opacity" />
        <span className="text-[10px] text-[var(--muted-foreground)] group-hover/sec-hdr:text-[var(--foreground)] font-semibold uppercase tracking-wider">
          Drives & Mounts
        </span>
      </div>
      <div className="space-y-0.5">
        {drives.map((drive) => {
          const info = driveDetails.find(
            (d) => d.name.toLowerCase() === drive.toLowerCase()
          );
          const total = info?.totalBytes || 0;
          const free = info?.freeBytes || 0;
          const used = Math.max(0, total - free);
          const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
          const barColor =
            pct >= 90 ? 'bg-rose-500' : pct >= 75 ? 'bg-amber-400' : 'bg-sky-400/80';

          return (
            <div
              key={drive}
              onClick={() => navigateTo(drive)}
              title={
                total > 0
                  ? `${info?.label || 'Local Disk'} (${drive}) — ${formatBytes(free)} free of ${formatBytes(total)} (${pct}% used)`
                  : drive
              }
              {...bindDropTarget(drive)}
              className={`px-2 py-1 rounded cursor-pointer flex flex-col gap-1 ${
                dragTarget === drive
                  ? 'bg-sky-500/20 ring-1 ring-sky-400 text-[var(--foreground)]'
                  : currentPath === drive
                    ? 'bg-[var(--card)] text-[var(--foreground)] font-medium border border-[var(--border)]'
                    : 'text-[var(--muted-foreground)] hover:bg-[var(--card)]/50'
              }`}
            >
              <div className="flex items-center justify-between gap-1.5">
                <span className="flex items-center gap-1.5 truncate min-w-0">
                  <KenneyIcon name="save" size={13} />
                  <span className="truncate">
                    {info?.label ? `${info.label} (${drive.replace('\\', '')})` : drive.replace('\\', '')}
                  </span>
                </span>
                {total > 0 && (
                  <span className="text-[10px] font-mono text-[var(--muted-foreground)] shrink-0">
                    {formatBytes(free)} / {formatBytes(total)}
                  </span>
                )}
              </div>
              {total > 0 && (
                <div className="h-1 w-full rounded-full bg-[var(--background)] overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${barColor}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderWorkflows = () => (
    <div>
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-rook-sidebar-section', 'workflows');
          e.dataTransfer.effectAllowed = 'move';
          setDraggingSectionId('workflows');
        }}
        onDragEnd={() => {
          setDraggingSectionId(null);
          setSectionDropTarget(null);
        }}
        className="flex items-center justify-between px-1.5 mb-1 group/sec-hdr cursor-grab active:cursor-grabbing hover:bg-white/[0.04] rounded py-0.5 transition-colors"
        title="Workflows — Drag header to reorder section"
      >
        <div className="flex items-center gap-1 min-w-0">
          <GripIcon className="text-[var(--muted-foreground)] opacity-30 group-hover/sec-hdr:opacity-100 transition-opacity" />
          <span className="text-[10px] text-[var(--muted-foreground)] group-hover/sec-hdr:text-[var(--foreground)] font-semibold uppercase tracking-wider truncate">
            Workflows
          </span>
        </div>
        <button
          type="button"
          draggable={false}
          onDragStart={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            pinWorkflow();
          }}
          title="Pin Current Workflow (Saves open folders and layout)"
          className="text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer flex items-center gap-0.5 shrink-0"
        >
          <KenneyIcon name="plusBold" size={10} />
          <span>Pin</span>
        </button>
      </div>
      <div className="space-y-px min-h-[4px]">
        {workflows.map((wf) => {
          const tabCount = wf.tabs?.length || 1;
          const layoutShort =
            wf.layout === 'miller'
              ? 'Tree'
              : wf.layout === 'dualpane'
                ? 'Split'
                : wf.layout === 'faceted'
                  ? 'Tags'
                  : wf.layout === 'command'
                    ? 'Fuzzy'
                    : 'Workspace';
          const tooltipTabs =
            tabCount > 1
              ? `\nTabs (${tabCount}): ${wf.tabs.map((t) => t.title).join(', ')}`
              : '';

          const isEditing = editing?.kind === 'workflow' && editing.id === wf.id;
          const isActive = layout === wf.layout && currentPath.toLowerCase() === wf.path.toLowerCase();
          const isDraggingThis = draggingWorkflowId === wf.id;
          const isDropTargetBefore =
            workflowDropTarget?.id === wf.id && workflowDropTarget.position === 'before';
          const isDropTargetAfter =
            workflowDropTarget?.id === wf.id && workflowDropTarget.position === 'after';

          return (
            <React.Fragment key={wf.id}>
              {isDropTargetBefore && <DropIndicator />}
              <div
                draggable={!isEditing}
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-rook-workflow-item', wf.id);
                  e.dataTransfer.effectAllowed = 'move';
                  setDraggingWorkflowId(wf.id);
                }}
                onDragEnd={() => {
                  setDraggingWorkflowId(null);
                  setWorkflowDropTarget(null);
                }}
                onDragOver={(e) => {
                  if (
                    draggingWorkflowId ||
                    e.dataTransfer.types.includes('application/x-rook-workflow-item')
                  ) {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'move';
                    const rect = e.currentTarget.getBoundingClientRect();
                    const isAbove = e.clientY < rect.top + rect.height / 2;
                    setWorkflowDropTarget({ id: wf.id, position: isAbove ? 'before' : 'after' });
                    return;
                  }
                  if (hasFileDragData(e.dataTransfer)) {
                    e.preventDefault();
                    setAppropriateDropEffect(e.dataTransfer, e.ctrlKey);
                    setDragTarget(wf.path);
                  }
                }}
                onDragLeave={(e) => {
                  if (
                    workflowDropTarget?.id === wf.id &&
                    !e.currentTarget.contains(e.relatedTarget as Node)
                  ) {
                    setWorkflowDropTarget(null);
                  }
                  if (dragTarget === wf.path && !e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDragTarget(null);
                  }
                }}
                onDrop={async (e) => {
                  if (
                    draggingWorkflowId ||
                    e.dataTransfer.types.includes('application/x-rook-workflow-item')
                  ) {
                    e.preventDefault();
                    e.stopPropagation();
                    const sourceId =
                      e.dataTransfer.getData('application/x-rook-workflow-item') ||
                      draggingWorkflowId;
                    if (sourceId && sourceId !== wf.id && workflowDropTarget) {
                      const nextList = reorderList(
                        workflows,
                        sourceId,
                        wf.id,
                        workflowDropTarget.position
                      );
                      reorderWorkflows(nextList);
                    }
                    setDraggingWorkflowId(null);
                    setWorkflowDropTarget(null);
                    return;
                  }
                  setDragTarget(null);
                  await handleFileDropToDir(e, wf.path, dropEntriesToDir, dropUrlToDir);
                }}
                onClick={() => {
                  if (!isEditing) loadWorkflow(wf);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setEditing({ kind: 'workflow', id: wf.id });
                  setEditingLabel(wf.label);
                }}
                title={`${wf.label}\nRoot: ${wf.path}\nLayout: ${wf.layout || 'workspace'}${tooltipTabs}\nClick to load workflow (folders & layout)\nDouble-click to rename\nDrag to reorder`}
                className={`group px-2 py-1 rounded cursor-pointer flex items-center justify-between gap-1 transition-colors ${
                  isDraggingThis
                    ? 'opacity-30'
                    : dragTarget === wf.path
                      ? 'bg-sky-500/20 ring-1 ring-sky-400 text-[var(--foreground)]'
                      : isActive
                        ? 'bg-[var(--card)] text-[var(--foreground)] font-medium border border-[var(--border)]'
                        : 'text-[var(--muted-foreground)] hover:bg-[var(--card)]/50'
                }`}
              >
                <span className="flex items-center gap-1.5 truncate min-w-0 flex-1">
                  <span
                    title="Drag to reorder"
                    className="cursor-grab active:cursor-grabbing text-[var(--muted-foreground)] opacity-0 group-hover:opacity-60 hover:!opacity-100 -ml-1 transition-opacity shrink-0 flex items-center"
                  >
                    <GripIcon />
                  </span>
                  <button
                    type="button"
                    draggable={false}
                    onDragStart={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setStyleModalTarget({
                        kind: 'workflow',
                        id: wf.id,
                        label: wf.label,
                        icon: wf.icon || 'crown',
                        iconColor: wf.iconColor || '#38bdf8',
                      });
                      setSelectedIcon(wf.icon || 'crown');
                      setSelectedColor(wf.iconColor || '#38bdf8');
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                    title="Click to customize workflow icon & color"
                    className="p-0.5 -ml-0.5 rounded hover:bg-white/[0.08] cursor-pointer flex items-center justify-center shrink-0"
                  >
                    <KenneyIcon
                      name={wf.icon || 'crown'}
                      size={14}
                      color={wf.iconColor}
                    />
                  </button>
                  {isEditing ? (
                    <input
                      autoFocus
                      type="text"
                      draggable={false}
                      value={editingLabel}
                      onFocus={(e) => e.currentTarget.select()}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                      onDragStart={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onChange={(e) => setEditingLabel(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitRename();
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          setEditing(null);
                        }
                      }}
                      className="w-full min-w-0 bg-[var(--background)] text-[var(--foreground)] px-1 py-0 rounded border border-sky-400/70 outline-none text-xs leading-tight"
                    />
                  ) : (
                    <span className="truncate">{wf.label}</span>
                  )}
                </span>
                <span className="flex items-center gap-1 shrink-0">
                  {layoutShort && (
                    <span className="px-1 py-px rounded bg-white/[0.06] text-[9px] font-mono text-[var(--muted-foreground)]">
                      {layoutShort}
                    </span>
                  )}
                  {tabCount > 1 && (
                    <span className="px-1 py-px rounded bg-sky-500/15 text-sky-300 border border-sky-500/25 text-[9px] font-mono">
                      {tabCount}t
                    </span>
                  )}
                  <button
                    type="button"
                    draggable={false}
                    onDragStart={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      unpinWorkflow(wf.id);
                    }}
                    title="Delete Workflow"
                    className="opacity-0 group-hover:opacity-80 hover:!opacity-100 w-4 h-4 aspect-square flex items-center justify-center rounded hover:bg-[var(--background)] cursor-pointer shrink-0"
                  >
                    <KenneyIcon name="cross" size={10} />
                  </button>
                </span>
              </div>
              {isDropTargetAfter && <DropIndicator />}
            </React.Fragment>
          );
        })}
        {workflows.length === 0 && (
          <div className="px-2 py-1.5 text-[10px] text-[var(--muted-foreground)]/60 italic">
            No saved workflows
          </div>
        )}
      </div>
    </div>
  );

  const renderSectionContent = (sectionId: SidebarSectionId) => {
    switch (sectionId) {
      case 'quickAccess':
        return renderQuickAccess();
      case 'drives':
        return renderDrives();
      case 'workflows':
        return renderWorkflows();
      default:
        return null;
    }
  };

  const sectionOrder =
    sidebarSectionOrder && sidebarSectionOrder.length > 0
      ? sidebarSectionOrder
      : (['quickAccess', 'drives', 'workflows'] as SidebarSectionId[]);

  return (
    <aside className="w-56 border-r border-[var(--border)] bg-[var(--sidebar)] p-2 flex flex-col justify-between text-xs select-none shrink-0 overflow-y-auto">
      <div className="space-y-3">
        {sectionOrder.map((sectionId) => {
          const isDraggingThis = draggingSectionId === sectionId;
          const isDropBefore =
            sectionDropTarget?.id === sectionId && sectionDropTarget.position === 'before';
          const isDropAfter =
            sectionDropTarget?.id === sectionId && sectionDropTarget.position === 'after';

          return (
            <div
              key={sectionId}
              onDragOver={(e) => {
                if (
                  draggingSectionId ||
                  e.dataTransfer.types.includes('application/x-rook-sidebar-section')
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = 'move';
                  const rect = e.currentTarget.getBoundingClientRect();
                  const isAbove = e.clientY < rect.top + rect.height / 2;
                  setSectionDropTarget({ id: sectionId, position: isAbove ? 'before' : 'after' });
                }
              }}
              onDragLeave={(e) => {
                if (
                  sectionDropTarget?.id === sectionId &&
                  !e.currentTarget.contains(e.relatedTarget as Node)
                ) {
                  setSectionDropTarget(null);
                }
              }}
              onDrop={(e) => {
                if (
                  draggingSectionId ||
                  e.dataTransfer.types.includes('application/x-rook-sidebar-section')
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  const source =
                    (e.dataTransfer.getData(
                      'application/x-rook-sidebar-section'
                    ) as SidebarSectionId) || draggingSectionId;
                  if (source && source !== sectionId && sectionDropTarget) {
                    const nextOrder = reorderArray(
                      sectionOrder,
                      source,
                      sectionId,
                      sectionDropTarget.position
                    );
                    reorderSidebarSections(nextOrder);
                  }
                  setDraggingSectionId(null);
                  setSectionDropTarget(null);
                }
              }}
              className={`transition-opacity ${isDraggingThis ? 'opacity-30' : ''}`}
            >
              {isDropBefore && <SectionDropIndicator />}
              {renderSectionContent(sectionId)}
              {isDropAfter && <SectionDropIndicator />}
            </div>
          );
        })}
      </div>

      {/* Expanded Quick Access / Workflow Icon & Color Picker Dialog */}
      {styleModalTarget && (
        <IconPickerDialog
          key={styleModalTarget.id}
          title={styleModalTarget.label}
          initialIcon={selectedIcon}
          initialColor={selectedColor}
          onSave={(icon, color) => commitStyleChange(icon, color)}
          onClose={() => setStyleModalTarget(null)}
        />
      )}
    </aside>
  );
};
