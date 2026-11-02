import React, { useEffect, useState } from 'react';
import { useExplorerStore } from '../store/useExplorerStore';
import { LayoutMode } from '../types/fs';
import { fsService } from '../services/fsService';
import { KenneyIcon } from './KenneyIcon';
import { handleFileDropToDir, hasFileDragData } from '../utils/dragDrop';

export const RibbonHeader: React.FC = () => {
  const {
    tabs,
    activeTabId,
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
    switchTab,
    closeTab,
    addTab,
    reorderTabs,
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
    openPowershellCurrent,
  } = useExplorerStore();

  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState(currentPath);
  const [copiedPath, setCopiedPath] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);

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

  const pathSegments = currentPath.split(/[\\/]/).filter(Boolean);
  const getCrumbPath = (idx: number) => {
    const isWindowsDrive = currentPath.includes(':\\');
    const prefix = isWindowsDrive ? '' : '/';
    const sep = isWindowsDrive ? '\\' : '/';
    return (
      prefix +
      pathSegments.slice(0, idx + 1).join(sep) +
      (idx === 0 && isWindowsDrive ? '\\' : '')
    );
  };

  const handleCrumbClick = (idx: number) => {
    navigateTo(getCrumbPath(idx));
  };

  const handleDropOnPath = async (e: React.DragEvent, targetDir: string) => {
    setDragTarget(null);
    await handleFileDropToDir(e, targetDir, dropEntriesToDir);
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
    { id: 'workspace', icon: 'menuList', tooltip: '1. Modern Workspace Layout (Alt+1)' },
    { id: 'thumbnails', icon: 'menuGrid', tooltip: '2. Large Thumbnail Icons Layout (Alt+2)' },
    { id: 'miller', icon: 'barsVertical', tooltip: '3. Miller Columns Layout (Alt+3)' },
    { id: 'dualpane', icon: 'scrollHorizontal', tooltip: '4. Dual-Pane Commander Layout (Alt+4)' },
    { id: 'faceted', icon: 'tag', tooltip: '5. Tag & Faceted Canvas Layout (Alt+5)' },
    { id: 'command', icon: 'zoom', tooltip: '6. Fuzzy Navigator Layout (Alt+6)' },
  ];

  return (
    <header className="select-none shrink-0 flex flex-col">
      {/* ROW 1 (TOP): FRAMELESS ROOK TOOLBAR / COMMAND RIBBON */}
      <div
        onMouseDown={handleToolbarMouseDown}
        onDoubleClick={handleToolbarDoubleClick}
        className="bg-[var(--sidebar)] border-b border-[var(--border)] pl-2.5 pr-1 py-[5px] flex flex-wrap items-center justify-between gap-1.5 text-xs cursor-default"
      >
        {/* Left: Rook Brand + Icon-Only File & Shell Command Buttons */}
        <div className="flex flex-wrap items-center gap-1">
          <div
            className="flex items-center gap-1.5 pr-2 mr-0.5 border-r border-[var(--border)]"
            title="Rook File Explorer — Drag here to move window"
          >
            <KenneyIcon name="chess_rook" size={17} alt="Rook" />
            <span className="font-semibold text-[var(--foreground)] tracking-tight text-[13px] leading-none">
              Rook
            </span>
          </div>

          <button
            onClick={handleNewFolder}
            title="New Folder"
            className="p-1 rounded bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 cursor-pointer flex items-center justify-center"
          >
            <KenneyIcon name="pouch_add" size={15} />
          </button>

          <button
            onClick={handleNewFile}
            title="New File"
            className="p-1 rounded bg-[var(--card)] border border-[var(--border)] hover:border-[var(--primary)] cursor-pointer flex items-center justify-center"
          >
            <KenneyIcon name="card_add" size={15} />
          </button>

          <div className="h-4 w-px bg-[var(--border)] mx-0.5" />

          <button
            onClick={copySelectedToOtherPane}
            disabled={!selectedPath}
            title="Copy Selected to Target Pane (F5)"
            className="p-1 rounded bg-[var(--card)] border border-[var(--border)] hover:border-[var(--primary)] disabled:opacity-40 cursor-pointer flex items-center justify-center"
          >
            <KenneyIcon name="export" size={15} />
          </button>

          <button
            onClick={moveSelectedToOtherPane}
            disabled={!selectedPath}
            title="Move Selected to Target Pane (F6)"
            className="p-1 rounded bg-[var(--card)] border border-[var(--border)] hover:border-[var(--primary)] disabled:opacity-40 cursor-pointer flex items-center justify-center"
          >
            <KenneyIcon name="import" size={15} />
          </button>

          <button
            onClick={handleRename}
            disabled={!selectedPath}
            title="Rename Selected Item (F2)"
            className="p-1 rounded bg-[var(--card)] border border-[var(--border)] hover:border-[var(--primary)] disabled:opacity-40 cursor-pointer flex items-center justify-center"
          >
            <KenneyIcon name="toolPencil" size={15} />
          </button>

          {/* Delete Button: Subtle muted red tint */}
          <button
            onClick={(e) => requestDeleteSelected(e.shiftKey)}
            disabled={!selectedPath}
            title="Delete Selected Item (Del = Recycle Bin, Shift+Del = Permanent)"
            className="p-1 rounded bg-red-950/35 hover:bg-red-900/50 border border-red-500/25 text-white disabled:opacity-40 cursor-pointer flex items-center justify-center"
          >
            <KenneyIcon name="trashcan" size={15} />
          </button>

          <div className="h-4 w-px bg-[var(--border)] mx-0.5" />

          <button
            onClick={openPowershellCurrent}
            title="Launch PowerShell in Current Directory (Ctrl+T)"
            className="p-1 rounded bg-[var(--card)] border border-[var(--border)] hover:border-[var(--primary)] cursor-pointer flex items-center justify-center"
          >
            <KenneyIcon name="campfire" size={15} />
          </button>
        </div>

        {/* Right: 5-Layout Switcher + Sort + Dockable Panes + Options + Window Controls */}
        <div className="flex flex-wrap items-center gap-1">
          {/* 5-Layout Switcher Pill */}
          <div className="flex items-center bg-[var(--background)] p-0.5 rounded-md border border-[var(--border)] gap-0.5">
            {layouts.map((m) => {
              const active = layout === m.id;
              return (
                <button
                  key={m.id}
                  onClick={() => setLayout(m.id)}
                  title={m.tooltip}
                  className={`p-1 rounded transition-all flex items-center justify-center cursor-pointer ${
                    active
                      ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                      : 'text-[var(--muted-foreground)] hover:bg-[var(--card)]'
                  }`}
                >
                  <KenneyIcon name={m.icon} size={14} />
                </button>
              );
            })}
          </div>

          {/* Dockable Pane Toggles + Options Button */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={toggleSidebar}
              title="Toggle Left Sidebar (Ctrl+B)"
              className={`p-1 rounded border border-[var(--border)] cursor-pointer flex items-center justify-center ${
                showSidebar
                  ? 'bg-[var(--primary)]/25 border-[var(--primary)]'
                  : 'bg-[var(--background)] opacity-60 hover:opacity-100'
              }`}
            >
              <KenneyIcon name="barsHorizontal" size={15} />
            </button>
            <button
              onClick={toggleInspector}
              title="Toggle Inspector Pane (Ctrl+I)"
              className={`p-1 rounded border border-[var(--border)] cursor-pointer flex items-center justify-center ${
                showInspector
                  ? 'bg-[var(--primary)]/25 border-[var(--primary)]'
                  : 'bg-[var(--background)] opacity-60 hover:opacity-100'
              }`}
            >
              <KenneyIcon name="information" size={15} />
            </button>
            <button
              onClick={toggleTerminal}
              title="Toggle Integrated Terminal Drawer (Ctrl+`)"
              className={`p-1 rounded border border-[var(--border)] cursor-pointer flex items-center justify-center ${
                showTerminal
                  ? 'bg-[var(--primary)]/25 border-[var(--primary)]'
                  : 'bg-[var(--background)] opacity-60 hover:opacity-100'
              }`}
            >
              <KenneyIcon name="cpu" size={15} />
            </button>

            <button
              onClick={toggleOptionsModal}
              title="Options & Preferences"
              className={`p-1 rounded border border-[var(--border)] cursor-pointer flex items-center justify-center ${
                showOptionsModal
                  ? 'bg-[var(--primary)]/25 border-[var(--primary)]'
                  : 'bg-[var(--background)] opacity-80 hover:opacity-100 hover:border-[var(--primary)]'
              }`}
            >
              <KenneyIcon name="gear" size={15} />
            </button>
          </div>

          <div className="h-4 w-px bg-[var(--border)] mx-0.5" />

          {/* Window Controls: Minimize, Maximize/Restore, Exit */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => fsService.winMinimize()}
              title="Minimize Window"
              className="px-1.5 py-1 rounded hover:bg-[var(--background)] border border-transparent hover:border-[var(--border)] cursor-pointer flex items-center justify-center opacity-80 hover:opacity-100"
            >
              <KenneyIcon name="minus" size={13} />
            </button>
            <button
              onClick={handleToggleMaximize}
              title={isMaximized ? 'Restore Window' : 'Maximize Window'}
              className="px-1.5 py-1 rounded hover:bg-[var(--background)] border border-transparent hover:border-[var(--border)] cursor-pointer flex items-center justify-center opacity-80 hover:opacity-100"
            >
              <KenneyIcon name={isMaximized ? 'smaller' : 'larger'} size={13} />
            </button>
            <button
              onClick={() => fsService.winClose()}
              title="Exit Rook"
              className="px-1.5 py-1 rounded hover:bg-red-600/70 border border-transparent hover:border-red-500/60 cursor-pointer flex items-center justify-center opacity-85 hover:opacity-100 transition-colors"
            >
              <KenneyIcon name="cross" size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* ROW 2 (BELOW RIBBON, ABOVE TABS): NAVIGATION UI ELEMENT */}
      <div className="bg-[var(--sidebar)] border-b border-[var(--border)] px-3 py-2 flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={goBack}
            className="p-1.5 rounded-md bg-[var(--card)] hover:border-[var(--primary)] border border-[var(--border)] cursor-pointer flex items-center justify-center"
            title="Back (Alt+Left or Mouse Back Button)"
          >
            <KenneyIcon name="arrowLeft" size={15} />
          </button>
          <button
            onClick={goForward}
            className="p-1.5 rounded-md bg-[var(--card)] hover:border-[var(--primary)] border border-[var(--border)] cursor-pointer flex items-center justify-center"
            title="Forward (Alt+Right or Mouse Forward Button)"
          >
            <KenneyIcon name="arrowRight" size={15} />
          </button>
          <button
            onClick={goUp}
            className="p-1.5 rounded-md bg-[var(--card)] hover:border-[var(--primary)] border border-[var(--border)] cursor-pointer flex items-center justify-center"
            title="Parent Directory (Alt+Up)"
          >
            <KenneyIcon name="arrowUp" size={15} />
          </button>
          <button
            onClick={refresh}
            className="p-1.5 rounded-md bg-[var(--card)] hover:border-[var(--primary)] border border-[var(--border)] cursor-pointer flex items-center justify-center"
            title="Refresh (F5)"
          >
            <KenneyIcon name="return" size={15} />
          </button>
        </div>

        {/* Interactive Breadcrumb / Path Omnibar */}
        <div className="flex-1 min-w-[260px] flex items-center gap-2 bg-[var(--background)] border border-[var(--border)] rounded-lg px-3 py-1.5">
          <div
            onClick={() => {
              if (!editingPath) {
                setPathInput(currentPath);
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
                      {idx > 0 && <span className="text-[var(--muted-foreground)] select-none">/</span>}
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCrumbClick(idx);
                        }}
                        onDragOver={(e) => {
                          if (!hasFileDragData(e.dataTransfer)) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
                          setDragTarget(`crumb:${crumbPath}`);
                        }}
                        onDragLeave={() => setDragTarget(null)}
                        onDrop={(e) => handleDropOnPath(e, crumbPath)}
                        className={`cursor-pointer hover:underline whitespace-nowrap px-1 py-0.5 rounded transition-colors ${
                          isDropOver
                            ? 'bg-indigo-500/25 ring-1 ring-indigo-400 text-[var(--foreground)]'
                            : idx === pathSegments.length - 1
                              ? 'font-semibold text-[var(--foreground)]'
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
              navigator.clipboard.writeText(currentPath).catch(() => {});
              setCopiedPath(true);
              setTimeout(() => setCopiedPath(false), 1500);
            }}
            title="Copy Current Directory Path"
            className="p-1 rounded hover:bg-[var(--card)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer flex items-center justify-center shrink-0 transition-colors"
          >
            <KenneyIcon
              name={copiedPath ? 'checkmark' : 'cards_stack'}
              size={14}
              className={copiedPath ? 'text-emerald-400' : ''}
            />
          </button>

          {/* Instant Filter & Recursive Subfolder Search Box */}
          <div className="ml-auto flex items-center gap-1.5 border-l border-[var(--border)] pl-2.5 shrink-0">
            <KenneyIcon name={deepSearch ? 'zoomIn' : 'zoom'} size={14} className={deepSearch ? 'text-indigo-400' : ''} />
            <input
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              type="text"
              placeholder={deepSearch ? 'Search subfolders...' : 'Filter view...'}
              className="bg-transparent text-xs text-[var(--foreground)] outline-none w-36 placeholder:text-[var(--muted-foreground)]"
            />
            {isSearching && (
              <span className="text-[10px] text-indigo-400 font-mono">...</span>
            )}
            {filterQuery && (
              <button
                onClick={() => setFilterQuery('')}
                className="cursor-pointer opacity-70 hover:opacity-100"
                title="Clear filter"
              >
                <KenneyIcon name="cross" size={12} />
              </button>
            )}
            <button
              type="button"
              onClick={toggleDeepSearch}
              title={deepSearch ? 'Recursive Subfolder Search: ON' : 'Toggle Recursive Subfolder Search'}
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium border cursor-pointer transition-colors ${
                deepSearch
                  ? 'bg-indigo-500/25 border-indigo-400/70 text-indigo-300'
                  : 'bg-[var(--card)] border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              Deep
            </button>
          </div>
        </div>

        {gitBranch && (
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] shrink-0">
            <KenneyIcon name="flag" size={14} />
            <span className="text-[var(--muted-foreground)]">Git:</span>
            <strong className="text-emerald-500">{gitBranch}</strong>
          </div>
        )}
      </div>

      {/* ROW 3 (BELOW NAVIGATION): FULL-HEIGHT BOX TABS BAR */}
      <div className="bg-[var(--sidebar)] border-b border-[var(--border)] h-9 px-0 py-0 flex items-stretch overflow-x-auto no-scrollbar text-xs">
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
                e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'move';
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
                  ? 'bg-indigo-500/25 ring-1 ring-inset ring-indigo-400 text-[var(--foreground)]'
                  : isActive
                    ? 'bg-[var(--center-bg)] text-[var(--foreground)] font-semibold border-b-2 border-b-[var(--primary)]'
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
                  className="opacity-60 hover:opacity-100 cursor-pointer flex items-center ml-1"
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
          className="h-full px-3.5 bg-[var(--sidebar)] hover:bg-[var(--card)] border-r border-[var(--border)] flex items-center justify-center cursor-pointer shrink-0"
          title="New Tab"
        >
          <KenneyIcon name="plusBold" size={13} />
        </button>
      </div>
    </header>
  );
};
