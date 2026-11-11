import React, { useEffect, useState } from 'react';
import { useExplorerStore } from '../store/useExplorerStore';
import { LayoutMode } from '../types/fs';
import { fsService } from '../services/fsService';
import { KenneyIcon } from './KenneyIcon';
import { handleFileDropToDir, hasFileDragData, setAppropriateDropEffect } from '../utils/dragDrop';
import { buildSshPath, parseSshPath } from '../utils/sshPath';

export const RibbonHeader: React.FC = () => {
  const {
    currentPath,
    gitBranch,
    layout,
    filterQuery,
    deepSearch,
    isSearching,
    showSidebar,
    showInspector,
    showTerminal,
    showOptionsModal,
    selectedPath,
    items,
    goBack,
    goForward,
    goUp,
    refresh,
    navigateTo,
    setLayout,
    setFilterQuery,
    toggleDeepSearch,
    toggleSidebar,
    toggleInspector,
    toggleTerminal,
    toggleOptionsModal,
    openPromptModal,
    requestDeleteSelected,
    copySelectedToOtherPane,
    moveSelectedToOtherPane,
    dropEntriesToDir,
    dropUrlToDir,
    openPowershellCurrent,
    sshConnections,
  } = useExplorerStore();

  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState(currentPath);
  const [copiedPath, setCopiedPath] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [dragTarget, setDragTarget] = useState<string | null>(null);

  useEffect(() => {
    const onWinState = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail.isMaximized === 'boolean') {
        setIsMaximized(detail.isMaximized);
      }
    };
    window.addEventListener('rook-window-state', onWinState);
    return () => window.removeEventListener('rook-window-state', onWinState);
  }, []);

  // SSH paths (ssh://{id}/remote/path) show the host as the first crumb, then the remote folders.
  const sshLoc = parseSshPath(currentPath);
  const sshConn = sshLoc ? sshConnections.find((c) => c.id === sshLoc.id) : undefined;
  const pathSegments = sshLoc
    ? [sshConn?.label || sshConn?.target || 'SSH', ...sshLoc.remotePath.split('/').filter(Boolean)]
    : currentPath.split(/[\\/]/).filter(Boolean);
  const crumbSeparator = sshLoc ? '/' : '\\';
  const getCrumbPath = (idx: number) => {
    if (sshLoc) return buildSshPath(sshLoc.id, '/' + pathSegments.slice(1, idx + 1).join('/'));
    const isWindowsDrive = /^[a-zA-Z]:[\\/]/.test(currentPath) || currentPath.includes('\\');
    const prefix = isWindowsDrive ? '' : '\\';
    const sep = '\\';
    return (
      prefix +
      pathSegments.slice(0, idx + 1).join(sep) +
      (idx === 0 && /^[a-zA-Z]:$/i.test(pathSegments[0]) ? '\\' : '')
    );
  };

  const handleCrumbClick = (idx: number) => {
    navigateTo(getCrumbPath(idx));
  };

  const handleDropOnPath = async (e: React.DragEvent, targetDir: string) => {
    setDragTarget(null);
    await handleFileDropToDir(e, targetDir, dropEntriesToDir, dropUrlToDir);
  };

  const handleNewFolder = () => {
    openPromptModal({
      kind: 'newFolder',
      title: 'Create New Folder',
      subtitle: `In ${currentPath}`,
      defaultValue: 'New Folder',
      isDirectory: true,
    });
  };

  const handleNewFile = () => {
    openPromptModal({
      kind: 'newFile',
      title: 'Create New File',
      subtitle: `In ${currentPath}`,
      defaultValue: 'notes.md',
    });
  };

  const handleRename = () => {
    if (!selectedPath) return;
    const entry = items.find((i) => i.path === selectedPath);
    const currentName = entry?.name || selectedPath.split(/[\\/]/).pop() || '';
    openPromptModal({
      kind: 'rename',
      title: 'Rename Item',
      subtitle: selectedPath,
      defaultValue: currentName,
      isDirectory: entry?.isDirectory,
    });
  };

  const handleToolbarMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (
      target.closest('button') ||
      target.closest('select') ||
      target.closest('input') ||
      target.closest('label')
    ) {
      return;
    }
    fsService.winDrag();
  };

  const handleToolbarDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (
      target.closest('button') ||
      target.closest('select') ||
      target.closest('input') ||
      target.closest('label')
    ) {
      return;
    }
    handleToggleMaximize();
  };

  const handleToggleMaximize = async () => {
    const res = await fsService.winMaximize();
    if (typeof res.isMaximized === 'boolean') {
      setIsMaximized(res.isMaximized);
    } else {
      setIsMaximized((prev) => !prev);
    }
  };

  const layouts: { id: LayoutMode; icon: string; tooltip: string }[] = [
    { id: 'workspace', icon: 'menuList', tooltip: 'Details' },
    { id: 'thumbnails', icon: 'menuGrid', tooltip: 'Thumbnails' },
    { id: 'miller', icon: 'barsVertical', tooltip: 'Miller Columns' },
    { id: 'dualpane', icon: 'scrollHorizontal', tooltip: 'Dual-Pane' },
    { id: 'split', icon: 'columns', tooltip: 'Split Panels (two independent folders)' },
    { id: 'faceted', icon: 'tag', tooltip: 'Faceted' },
    { id: 'command', icon: 'zoom', tooltip: 'Fuzzy' },
  ];

  return (
    <header className="select-none shrink-0 flex flex-col">
      {/* ROW 1 (TOP): FRAMELESS ROOK TOOLBAR / COMMAND RIBBON */}
      <div
        onMouseDown={handleToolbarMouseDown}
        onDoubleClick={handleToolbarDoubleClick}
        className="bg-[var(--sidebar)] border-b border-[var(--border)] px-3 py-1.5 flex items-center justify-between gap-2 text-xs select-none cursor-default"
      >
        {/* Left: Rook Brand + Icon-Only File & Shell Command Buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div
            className="h-8 flex items-center gap-2 pr-2.5 mr-0.5 border-r border-[var(--border)] shrink-0"
            title="Rook File Explorer — Drag here to move window"
          >
            <KenneyIcon name="chess_rook" size={18} alt="Rook" />
            <span className="font-semibold text-[var(--foreground)] tracking-tight text-[13px] leading-none select-none">
              Rook
            </span>
          </div>

          <button
            onClick={handleNewFolder}
            title="New Folder"
            className="w-8 h-8 rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 cursor-pointer flex items-center justify-center shrink-0 transition-colors shadow-sm"
          >
            <KenneyIcon name="pouch_add" size={16} />
          </button>

          <button
            onClick={handleNewFile}
            title="New File"
            className="w-8 h-8 rounded-md bg-[var(--card)] border border-[var(--border)] hover:border-[var(--primary)] cursor-pointer flex items-center justify-center shrink-0 transition-colors"
          >
            <KenneyIcon name="card_add" size={16} />
          </button>

          <div className="h-5 w-px bg-[var(--border)] mx-0.5 shrink-0" />

          <button
            onClick={copySelectedToOtherPane}
            disabled={!selectedPath}
            title="Copy"
            className="w-8 h-8 rounded-md bg-[var(--card)] border border-[var(--border)] hover:border-[var(--primary)] disabled:opacity-40 cursor-pointer flex items-center justify-center shrink-0 transition-colors"
          >
            <KenneyIcon name="export" size={16} />
          </button>

          <button
            onClick={moveSelectedToOtherPane}
            disabled={!selectedPath}
            title="Move"
            className="w-8 h-8 rounded-md bg-[var(--card)] border border-[var(--border)] hover:border-[var(--primary)] disabled:opacity-40 cursor-pointer flex items-center justify-center shrink-0 transition-colors"
          >
            <KenneyIcon name="import" size={16} />
          </button>

          <button
            onClick={handleRename}
            disabled={!selectedPath}
            title="Rename"
            className="w-8 h-8 rounded-md bg-[var(--card)] border border-[var(--border)] hover:border-[var(--primary)] disabled:opacity-40 cursor-pointer flex items-center justify-center shrink-0 transition-colors"
          >
            <KenneyIcon name="toolPencil" size={16} />
          </button>

          {/* Delete Button: Subtle muted red tint */}
          <button
            onClick={(e) => requestDeleteSelected(e.shiftKey)}
            disabled={!selectedPath}
            title="Delete"
            className="w-8 h-8 rounded-md bg-red-950/35 hover:bg-red-900/50 border border-red-500/25 text-white disabled:opacity-40 cursor-pointer flex items-center justify-center shrink-0 transition-colors"
          >
            <KenneyIcon name="trashcan" size={16} />
          </button>

          <div className="h-5 w-px bg-[var(--border)] mx-0.5 shrink-0" />

          <button
            onClick={openPowershellCurrent}
            title="PowerShell"
            className="w-8 h-8 rounded-md bg-[var(--card)] border border-[var(--border)] hover:border-[var(--primary)] cursor-pointer flex items-center justify-center shrink-0 transition-colors"
          >
            <KenneyIcon name="campfire" size={16} />
          </button>
        </div>

        {/* Right: 5-Layout Switcher + Sort + Dockable Panes + Options + Window Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* 5-Layout Switcher Pill */}
          <div className="h-8 flex items-center bg-[var(--background)] p-0.5 rounded-md border border-[var(--border)] gap-0.5 shrink-0">
            {layouts.map((m) => {
              const active = layout === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => setLayout(m.id)}
                  title={m.tooltip}
                  className={`w-7 h-7 rounded transition-all flex items-center justify-center cursor-pointer shrink-0 ${
                    active
                      ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                      : 'text-[var(--muted-foreground)] hover:bg-[var(--card)] hover:text-[var(--foreground)]'
                  }`}
                >
                  <KenneyIcon name={m.icon} size={15} />
                </button>
              );
            })}
          </div>

          {/* Dockable Pane Toggles + Options Button */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={toggleSidebar}
              title="Sidebar"
              className={`w-8 h-8 rounded-md border cursor-pointer flex items-center justify-center shrink-0 transition-colors ${
                showSidebar
                  ? 'bg-[var(--primary)]/25 border-[var(--primary)] text-[var(--primary)]'
                  : 'bg-[var(--card)] border-[var(--border)] opacity-80 hover:opacity-100 hover:border-[var(--primary)]'
              }`}
            >
              <KenneyIcon name="barsHorizontal" size={16} />
            </button>
            <button
              onClick={toggleInspector}
              title="Inspector"
              className={`w-8 h-8 rounded-md border cursor-pointer flex items-center justify-center shrink-0 transition-colors ${
                showInspector
                  ? 'bg-[var(--primary)]/25 border-[var(--primary)] text-[var(--primary)]'
                  : 'bg-[var(--card)] border-[var(--border)] opacity-80 hover:opacity-100 hover:border-[var(--primary)]'
              }`}
            >
              <KenneyIcon name="information" size={16} />
            </button>
            <button
              onClick={toggleTerminal}
              title="Terminal"
              className={`w-8 h-8 rounded-md border cursor-pointer flex items-center justify-center shrink-0 transition-colors ${
                showTerminal
                  ? 'bg-[var(--primary)]/25 border-[var(--primary)] text-[var(--primary)]'
                  : 'bg-[var(--card)] border-[var(--border)] opacity-80 hover:opacity-100 hover:border-[var(--primary)]'
              }`}
            >
              <KenneyIcon name="cpu" size={16} />
            </button>

            <button
              onClick={toggleOptionsModal}
              title="Options"
              className={`w-8 h-8 rounded-md border cursor-pointer flex items-center justify-center shrink-0 transition-colors ${
                showOptionsModal
                  ? 'bg-[var(--primary)]/25 border-[var(--primary)] text-[var(--primary)]'
                  : 'bg-[var(--card)] border-[var(--border)] opacity-80 hover:opacity-100 hover:border-[var(--primary)]'
              }`}
            >
              <KenneyIcon name="gear" size={16} />
            </button>
          </div>

          <div className="h-5 w-px bg-[var(--border)] mx-0.5 shrink-0" />

          {/* Window Controls: Minimize, Maximize/Restore, Exit */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => fsService.winMinimize()}
              title="Minimize"
              className="w-8 h-8 rounded-md hover:bg-[var(--card)] border border-transparent hover:border-[var(--border)] cursor-pointer flex items-center justify-center opacity-80 hover:opacity-100 shrink-0 transition-colors"
            >
              <KenneyIcon name="minus" size={14} />
            </button>
            <button
              onClick={handleToggleMaximize}
              title={isMaximized ? 'Restore' : 'Maximize'}
              className="w-8 h-8 rounded-md hover:bg-[var(--card)] border border-transparent hover:border-[var(--border)] cursor-pointer flex items-center justify-center opacity-80 hover:opacity-100 shrink-0 transition-colors"
            >
              <KenneyIcon name={isMaximized ? 'smaller' : 'larger'} size={14} />
            </button>
            <button
              onClick={() => fsService.winClose()}
              title="Exit"
              className="w-8 h-8 rounded-md hover:bg-red-600 border border-transparent hover:border-red-500 cursor-pointer flex items-center justify-center opacity-85 hover:opacity-100 hover:text-white shrink-0 transition-colors"
            >
              <KenneyIcon name="cross" size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* ROW 2 (BELOW RIBBON): NAVIGATION & SEARCH BAR */}
      <div className="bg-[var(--sidebar)] border-b border-[var(--border)] px-3 py-1.5 flex items-center justify-between gap-2 text-xs select-none">
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={goBack}
            className="w-8 h-8 rounded-md bg-[var(--card)] hover:border-[var(--primary)] border border-[var(--border)] cursor-pointer flex items-center justify-center shrink-0 transition-colors"
            title="Back"
          >
            <KenneyIcon name="caretLeft" size={16} />
          </button>
          <button
            onClick={goForward}
            className="w-8 h-8 rounded-md bg-[var(--card)] hover:border-[var(--primary)] border border-[var(--border)] cursor-pointer flex items-center justify-center shrink-0 transition-colors"
            title="Forward"
          >
            <KenneyIcon name="caretRight" size={16} />
          </button>
          <button
            onClick={goUp}
            className="w-8 h-8 rounded-md bg-[var(--card)] hover:border-[var(--primary)] border border-[var(--border)] cursor-pointer flex items-center justify-center shrink-0 transition-colors"
            title="Up"
          >
            <KenneyIcon name="caretUp" size={16} />
          </button>
          <button
            onClick={refresh}
            className="w-8 h-8 rounded-md bg-[var(--card)] hover:border-[var(--primary)] border border-[var(--border)] cursor-pointer flex items-center justify-center shrink-0 transition-colors"
            title="Refresh"
          >
            <KenneyIcon name="arrowsClockwise" size={16} />
          </button>
        </div>

        {/* Interactive Breadcrumb / Path Omnibar */}
        <div className="flex-1 min-w-[260px] h-8 flex items-center gap-2 bg-[var(--background)] border border-[var(--border)] rounded-md px-2.5">
          <div
            onClick={() => {
              if (!editingPath) {
                setPathInput(currentPath.replace(/\//g, '\\'));
                setEditingPath(true);
              }
            }}
            className="flex items-center gap-2 flex-1 min-w-0 cursor-text"
            title="Click empty space to edit full path"
          >
            <KenneyIcon name="open" size={15} />
            {editingPath ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setEditingPath(false);
                  if (pathInput.trim()) navigateTo(pathInput.trim());
                }}
                className="flex-1 min-w-0"
              >
                <input
                  autoFocus
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setEditingPath(false);
                    }
                  }}
                  onBlur={() => setEditingPath(false)}
                  className="w-full bg-transparent text-xs text-[var(--foreground)] outline-none font-mono"
                />
              </form>
            ) : (
              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar flex-1">
                {pathSegments.map((seg, idx) => {
                  const crumbPath = getCrumbPath(idx);
                  const isDropOver = dragTarget === `crumb:${crumbPath}`;
                  return (
                    <React.Fragment key={idx}>
                      {idx > 0 && <span className="text-[var(--muted-foreground)] opacity-40 select-none">{crumbSeparator}</span>}
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCrumbClick(idx);
                        }}
                        onDragOver={(e) => {
                          if (!hasFileDragData(e.dataTransfer)) return;
                          e.preventDefault();
                          setAppropriateDropEffect(e.dataTransfer, e.ctrlKey);
                          setDragTarget(`crumb:${crumbPath}`);
                        }}
                        onDragLeave={() => setDragTarget(null)}
                        onDrop={(e) => handleDropOnPath(e, crumbPath)}
                        className={`cursor-pointer hover:underline whitespace-nowrap px-1 py-0.5 rounded transition-colors ${
                          isDropOver
                            ? 'bg-sky-500/25 ring-1 ring-sky-400 text-[var(--foreground)]'
                            : idx === pathSegments.length - 1
                              ? 'font-semibold text-[var(--foreground)]/85'
                              : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                        }`}
                      >
                        {seg}
                      </span>
                    </React.Fragment>
                  );
                })}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(sshLoc ? currentPath : currentPath.replace(/\//g, '\\')).catch(() => {});
              setCopiedPath(true);
              setTimeout(() => setCopiedPath(false), 1500);
            }}
            title="Copy Path"
            className="w-6.5 h-6.5 rounded hover:bg-[var(--card)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer flex items-center justify-center shrink-0 transition-colors"
          >
            <KenneyIcon
              name={copiedPath ? 'checkmark' : 'cards_stack'}
              size={14}
              className={copiedPath ? 'text-emerald-400' : ''}
            />
          </button>

          {/* Instant Filter & Recursive Subfolder Search Box */}
          <div className="ml-auto flex items-center gap-1.5 border-l border-[var(--border)] pl-2 shrink-0">
            <KenneyIcon name={deepSearch ? 'zoomIn' : 'zoom'} size={14} className={deepSearch ? 'text-sky-400' : ''} />
            <input
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              type="text"
              placeholder={deepSearch ? 'Search subfolders...' : 'Filter view...'}
              className="bg-transparent text-xs text-[var(--foreground)] outline-none w-36 placeholder:text-[var(--muted-foreground)]"
            />
            {isSearching && (
              <span className="text-[10px] text-sky-400 font-mono">...</span>
            )}
            {filterQuery && (
              <button
                onClick={() => setFilterQuery('')}
                className="w-5 h-5 rounded hover:bg-[var(--card)] flex items-center justify-center cursor-pointer opacity-70 hover:opacity-100 shrink-0 transition-colors"
                title="Clear filter"
              >
                <KenneyIcon name="cross" size={11} />
              </button>
            )}
            <button
              type="button"
              onClick={toggleDeepSearch}
              title={deepSearch ? 'Recursive Search: On' : 'Recursive Search: Off'}
              className={`h-6 px-2 rounded text-[10px] font-medium border cursor-pointer transition-colors flex items-center justify-center shrink-0 ${
                deepSearch
                  ? 'bg-sky-500/25 border-sky-400/70 text-sky-300'
                  : 'bg-[var(--card)] border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              Deep
            </button>
          </div>
        </div>

        {gitBranch && (
          <div className="flex items-center gap-1.5 px-2.5 h-8 rounded-md border border-[var(--border)] bg-[var(--background)] shrink-0">
            <KenneyIcon name="flag" size={14} />
            <span className="text-[var(--muted-foreground)]">Git:</span>
            <strong className="text-emerald-500">{gitBranch}</strong>
          </div>
        )}
      </div>

    </header>
  );
};
