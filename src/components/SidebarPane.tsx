import React, { useState } from 'react';
import { useExplorerStore } from '../store/useExplorerStore';
import { PinnedWorkspace } from '../types/fs';
import { formatBytes } from '../utils/format';
import { KenneyIcon } from './KenneyIcon';
import { handleFileDropToDir, hasFileDragData } from '../utils/dragDrop';

const QUICK_ACCESS_ICONS = [
  'pouch',
  'folder',
  'book_closed',
  'book',
  'briefcase',
  'rocket',
  'gameController',
  'cube',
  'database',
  'lightning',
  'globe',
  'heart',
  'award',
  'campfire',
  'cpu',
  'save',
  'tag',
  'tag_shield',
  'wrench',
  'toolBrush',
  'toolPencil',
  'file_image',
  'film',
  'musicOn',
  'cards_diagonal',
  'cards_stack',
  'tokens_stack',
  'chess_rook',
];

const QUICK_ACCESS_COLORS = [
  '#fcd34d', // Amber (default folder tint)
  '#f87171', // Red
  '#fb923c', // Orange
  '#facc15', // Yellow
  '#a3e635', // Lime
  '#34d399', // Emerald
  '#2dd4bf', // Teal
  '#38bdf8', // Sky
  '#60a5fa', // Blue
  '#818cf8', // Indigo
  '#a78bfa', // Violet
  '#e879f9', // Fuchsia
  '#f472b6', // Pink
  '#cbd5e1', // Slate
];

export const SidebarPane: React.FC = () => {
  const {
    showSidebar,
    drives,
    driveDetails,
    pinnedFolders,
    currentPath,
    navigateTo,
    setLayout,
    togglePinFolder,
    unpinWorkspace,
    renamePinnedWorkspace,
    updatePinnedWorkspaceStyle,
    loadPinnedWorkspace,
    dropEntriesToDir,
  } = useExplorerStore();

  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [editingPinId, setEditingPinId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [styleModalPin, setStyleModalPin] = useState<PinnedWorkspace | null>(null);
  const [selectedIcon, setSelectedIcon] = useState<string>('pouch');
  const [selectedColor, setSelectedColor] = useState<string>('#fcd34d');

  if (!showSidebar) return null;

  const commitPinRename = (id: string) => {
    const clean = editingLabel.trim();
    if (clean) {
      renamePinnedWorkspace(id, clean);
    }
    setEditingPinId(null);
  };

  const bindDropTarget = (targetDir: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!hasFileDragData(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
      setDragTarget(targetDir);
    },
    onDragLeave: () => setDragTarget(null),
    onDrop: async (e: React.DragEvent) => {
      setDragTarget(null);
      await handleFileDropToDir(e, targetDir, dropEntriesToDir);
    },
  });

  return (
    <aside className="w-56 border-r border-[var(--border)] bg-[var(--sidebar)] p-2 flex flex-col justify-between text-xs select-none shrink-0 overflow-y-auto">
      <div className="space-y-3">
        {/* Pinned Places */}
        <div>
          <div className="flex items-center justify-between px-1.5 mb-1">
            <span className="text-[10px] text-[var(--muted-foreground)] font-semibold uppercase tracking-wider">
              Quick Access
            </span>
            {currentPath && (
              <button
                type="button"
                onClick={() => togglePinFolder()}
                title="Pin Current Workspace (Tabs, Layout & Columns)"
                className="text-[10px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer flex items-center gap-0.5"
              >
                <KenneyIcon name="plus" size={10} />
                <span>Pin</span>
              </button>
            )}
          </div>
          <div className="space-y-px">
            {pinnedFolders.map((pin) => {
              const tabCount = pin.tabs?.length || 1;
              const layoutShort =
                pin.layout === 'miller'
                  ? 'Tree'
                  : pin.layout === 'dualpane'
                    ? 'Split'
                    : pin.layout === 'faceted'
                      ? 'Tags'
                      : pin.layout === 'command'
                        ? 'Fuzzy'
                        : null;
              const tooltipTabs =
                tabCount > 1
                  ? `\nTabs (${tabCount}): ${pin.tabs.map((t) => t.title).join(', ')}`
                  : '';

              const isEditing = editingPinId === pin.id;

              return (
                <div
                  key={pin.id}
                  onClick={() => {
                    if (!isEditing) loadPinnedWorkspace(pin);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setEditingPinId(pin.id);
                    setEditingLabel(pin.label);
                  }}
                  title={`${pin.path} (${pin.layout || 'workspace'})${tooltipTabs}\nDouble-click to rename`}
                  {...bindDropTarget(pin.path)}
                  className={`group px-2 py-1 rounded cursor-pointer flex items-center justify-between gap-1 ${
                    dragTarget === pin.path
                      ? 'bg-indigo-500/20 ring-1 ring-indigo-400 text-[var(--foreground)]'
                      : 'text-[var(--muted-foreground)] hover:bg-[var(--card)]/50'
                  }`}
                >
                  <span className="flex items-center gap-1.5 truncate min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setStyleModalPin(pin);
                        setSelectedIcon(pin.icon || 'pouch');
                        setSelectedColor(pin.iconColor || '#fcd34d');
                      }}
                      onDoubleClick={(e) => e.stopPropagation()}
                      title="Click to customize icon & color"
                      className="p-0.5 -ml-0.5 rounded hover:bg-white/[0.08] cursor-pointer flex items-center justify-center shrink-0"
                    >
                      <KenneyIcon
                        name={pin.icon || 'pouch'}
                        size={14}
                        color={pin.iconColor}
                      />
                    </button>
                    {isEditing ? (
                      <input
                        autoFocus
                        type="text"
                        value={editingLabel}
                        onFocus={(e) => e.currentTarget.select()}
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                        onChange={(e) => setEditingLabel(e.target.value)}
                        onBlur={() => commitPinRename(pin.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitPinRename(pin.id);
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setEditingPinId(null);
                          }
                        }}
                        className="w-full min-w-0 bg-[var(--background)] text-[var(--foreground)] px-1 py-0 rounded border border-sky-400/70 outline-none text-xs leading-tight"
                      />
                    ) : (
                      <span className="truncate">{pin.label}</span>
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
                      onClick={(e) => {
                        e.stopPropagation();
                        unpinWorkspace(pin.id);
                      }}
                      title="Unpin from Quick Access"
                      className="opacity-0 group-hover:opacity-80 hover:!opacity-100 w-4 h-4 aspect-square flex items-center justify-center rounded hover:bg-[var(--background)] cursor-pointer shrink-0"
                    >
                      <KenneyIcon name="cross" size={10} />
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Drives */}
        <div>
          <div className="text-[10px] text-[var(--muted-foreground)] font-semibold uppercase tracking-wider px-1.5 mb-1">
            Drives & Mounts
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
                pct >= 90 ? 'bg-rose-500' : pct >= 75 ? 'bg-amber-400' : 'bg-indigo-400/80';

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
                      ? 'bg-indigo-500/20 ring-1 ring-indigo-400 text-[var(--foreground)]'
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

        {/* Smart Layout Shortcuts */}
        <div>
          <div className="text-[10px] text-[var(--muted-foreground)] font-semibold uppercase tracking-wider px-1.5 mb-1">
            Workflows
          </div>
          <div className="space-y-px text-[var(--muted-foreground)]">
            <div
              onClick={() => setLayout('miller')}
              className="px-2 py-1 rounded hover:bg-[var(--card)]/50 cursor-pointer flex items-center justify-between"
            >
              <span className="flex items-center gap-1.5">
                <KenneyIcon name="barsVertical" size={14} />
                <span>Deep Tree Browser</span>
              </span>
              <span className="flex items-center gap-0.5 opacity-75">
                <KenneyIcon name="keyboard_alt_outline" size={13} />
                <KenneyIcon name="keyboard_2_outline" size={13} />
              </span>
            </div>
            <div
              onClick={() => setLayout('dualpane')}
              className="px-2 py-1 rounded hover:bg-[var(--card)]/50 cursor-pointer flex items-center justify-between"
            >
              <span className="flex items-center gap-1.5">
                <KenneyIcon name="scrollHorizontal" size={14} />
                <span>Split Commander</span>
              </span>
              <span className="flex items-center gap-0.5 opacity-75">
                <KenneyIcon name="keyboard_alt_outline" size={13} />
                <KenneyIcon name="keyboard_3_outline" size={13} />
              </span>
            </div>
            <div
              onClick={() => setLayout('faceted')}
              className="px-2 py-1 rounded hover:bg-[var(--card)]/50 cursor-pointer flex items-center justify-between"
            >
              <span className="flex items-center gap-1.5">
                <KenneyIcon name="menuGrid" size={14} />
                <span>Semantic Tags</span>
              </span>
              <span className="flex items-center gap-0.5 opacity-75">
                <KenneyIcon name="keyboard_alt_outline" size={13} />
                <KenneyIcon name="keyboard_4_outline" size={13} />
              </span>
            </div>
            <div
              onClick={() => setLayout('command')}
              className="px-2 py-1 rounded hover:bg-[var(--card)]/50 cursor-pointer flex items-center justify-between"
            >
              <span className="flex items-center gap-1.5">
                <KenneyIcon name="zoom" size={14} />
                <span>Fuzzy Navigator</span>
              </span>
              <span className="flex items-center gap-0.5 opacity-75">
                <KenneyIcon name="keyboard_alt_outline" size={13} />
                <KenneyIcon name="keyboard_5_outline" size={13} />
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Access Icon & Color Picker Dialog */}
      {styleModalPin && (
        <div
          onClick={() => setStyleModalPin(null)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-xl bg-[#161922] border border-[var(--border)] shadow-2xl p-4 space-y-4 text-xs"
          >
            {/* Header + Live Preview */}
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-[var(--card)] border border-[var(--border)] flex items-center justify-center shrink-0">
                  <KenneyIcon name={selectedIcon} size={20} color={selectedColor} />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-[var(--foreground)] text-sm truncate">
                    {styleModalPin.label}
                  </div>
                  <div className="text-[11px] text-[var(--muted-foreground)] truncate">
                    Customize Icon & Color
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setStyleModalPin(null)}
                className="w-6 h-6 rounded hover:bg-[var(--card)] flex items-center justify-center text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
              >
                <KenneyIcon name="cross" size={12} />
              </button>
            </div>

            {/* Icon Grid */}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)] mb-1.5">
                Icon
              </div>
              <div className="grid grid-cols-7 gap-1.5 bg-[var(--background)]/70 p-2 rounded-lg border border-[var(--border)]/70">
                {QUICK_ACCESS_ICONS.map((iconName) => {
                  const active = selectedIcon === iconName;
                  return (
                    <button
                      key={iconName}
                      type="button"
                      onClick={() => setSelectedIcon(iconName)}
                      title={iconName}
                      className={`h-8 rounded-md flex items-center justify-center cursor-pointer transition-all ${
                        active
                          ? 'bg-sky-500/20 ring-1 ring-sky-400 scale-105'
                          : 'hover:bg-[var(--card)]'
                      }`}
                    >
                      <KenneyIcon
                        name={iconName}
                        size={16}
                        color={active ? selectedColor : '#cbd5e1'}
                      />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Color Swatches */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Color
                </span>
                <label className="flex items-center gap-1.5 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer">
                  <span>Custom:</span>
                  <input
                    type="color"
                    value={selectedColor}
                    onChange={(e) => setSelectedColor(e.target.value)}
                    className="w-5 h-5 rounded border border-[var(--border)] bg-transparent cursor-pointer"
                  />
                </label>
              </div>
              <div className="grid grid-cols-7 gap-2 bg-[var(--background)]/70 p-2.5 rounded-lg border border-[var(--border)]/70">
                {QUICK_ACCESS_COLORS.map((hex) => {
                  const active = selectedColor.toLowerCase() === hex.toLowerCase();
                  return (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => setSelectedColor(hex)}
                      title={hex}
                      className={`h-6 rounded-md cursor-pointer flex items-center justify-center transition-transform ${
                        active ? 'ring-2 ring-white scale-110' : 'hover:scale-105 opacity-85 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: hex }}
                    />
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-1 border-t border-[var(--border)]">
              <button
                type="button"
                onClick={() => setStyleModalPin(null)}
                className="px-3 py-1.5 rounded-lg bg-[var(--card)] border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  updatePinnedWorkspaceStyle(styleModalPin.id, selectedIcon, selectedColor);
                  setStyleModalPin(null);
                }}
                className="px-3.5 py-1.5 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] font-medium hover:opacity-90 cursor-pointer"
              >
                Save Icon
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
