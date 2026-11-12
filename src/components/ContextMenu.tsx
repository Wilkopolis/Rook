import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { activeSplitTarget, effectiveSelection, useExplorerStore } from '../store/useExplorerStore';
import { fsService } from '../services/fsService';
import { KenneyIcon } from './KenneyIcon';

export const ContextMenu: React.FC = () => {
  const {
    contextMenu,
    pinnedFolders,
    clipboard,
    undoStack,
    closeContextMenu,
    openEntry,
    addTab,
    togglePinFolder,
    pinWorkflow,
    revealInExplorer,
    copyToClipboard,
    cutToClipboard,
    pasteClipboard,
    undoLastOperation,
    openPromptModal,
    compressSelectedToZip,
    extractZipArchive,
    requestDeleteSelected,
    refresh,
  } = useExplorerStore();

  // In the split layout the menu belongs to the active pane: its selection and its folder,
  // not the details view's.
  const selectedPaths = useExplorerStore((s) => effectiveSelection(s).selectedPaths);
  const currentPath = useExplorerStore((s) => activeSplitTarget(s)?.panel.path ?? s.currentPath);

  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  /** Name of the SSH host that can fetch the clipboard items itself; null hides the direct-paste entry. */
  const [remotePasteHost, setRemotePasteHost] = useState<string | null>(null);

  const pasteDest = contextMenu
    ? contextMenu.entry?.isDirectory
      ? contextMenu.entry.path
      : currentPath
    : null;

  useEffect(() => {
    setRemotePasteHost(null);
    if (!pasteDest || !clipboard || !pasteDest.startsWith('ssh://')) return;
    if (clipboard.paths.some((p) => p.startsWith('ssh://'))) return;
    let stale = false;
    fsService
      .remoteCopyCheck(clipboard.paths, pasteDest)
      .then((res) => {
        if (!stale && res.available) setRemotePasteHost(res.hostLabel || 'SSH host');
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [pasteDest, clipboard]);

  useEffect(() => {
    if (!contextMenu) {
      setCoords(null);
      return;
    }
    const handleDismiss = () => closeContextMenu();
    window.addEventListener('click', handleDismiss);
    window.addEventListener('scroll', handleDismiss, true);
    window.addEventListener('resize', handleDismiss);
    return () => {
      window.removeEventListener('click', handleDismiss);
      window.removeEventListener('scroll', handleDismiss, true);
      window.removeEventListener('resize', handleDismiss);
    };
  }, [contextMenu, closeContextMenu]);

  useLayoutEffect(() => {
    if (!contextMenu || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const pad = 8;
    const { x, y } = contextMenu;

    let targetX = x;
    let targetY = y;

    // Check right boundary: shift left if extending past window edge
    if (targetX + rect.width > window.innerWidth - pad) {
      targetX = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    targetX = Math.max(pad, targetX);

    // Check bottom boundary: flip upward if space permits, otherwise clamp to bottom
    if (targetY + rect.height > window.innerHeight - pad) {
      if (y - rect.height >= pad) {
        targetY = y - rect.height;
      } else {
        targetY = Math.max(pad, window.innerHeight - rect.height - pad);
      }
    }
    targetY = Math.max(pad, targetY);

    setCoords({ x: targetX, y: targetY });
  }, [contextMenu, remotePasteHost]);

  if (!contextMenu) return null;

  const { entry } = contextMenu;
  const pad = 8;
  const defaultX = Math.max(pad, Math.min(contextMenu.x, window.innerWidth - 230 - pad));
  const defaultY = Math.max(pad, Math.min(contextMenu.y, window.innerHeight - 500 - pad));
  const posX = coords ? coords.x : defaultX;
  const posY = coords ? coords.y : defaultY;

  const handleCopyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
    } catch {}
    closeContextMenu();
  };

  const handleRename = () => {
    if (!entry) return;
    openPromptModal({
      kind: 'rename',
      title: 'Rename Item',
      subtitle: entry.path,
      defaultValue: entry.name,
      isDirectory: entry.isDirectory,
    });
  };

  const handleAddTag = () => {
    if (!entry) return;
    openPromptModal({
      kind: 'addTag',
      title: 'Add Semantic Tag',
      subtitle: `Tagging "${entry.name}"`,
      defaultValue: 'important',
      targetPath: entry.path,
    });
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

  return (
    <div
      ref={menuRef}
      style={{
        left: posX,
        top: posY,
        opacity: coords ? 1 : 0,
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 w-56 max-h-[calc(100vh-16px)] overflow-y-auto rounded-xl bg-[var(--sidebar)] border border-[var(--border)] shadow-2xl py-1.5 text-xs text-[var(--foreground)] select-none"
    >
      {entry ? (
        <>
          <div className="px-3 py-1.5 border-b border-[var(--border)]/70 flex items-center gap-2 text-[var(--muted-foreground)]">
            <KenneyIcon name={entry.isDirectory ? 'pouch' : 'card'} size={14} />
            <span className="font-semibold text-[var(--foreground)] truncate">
              {selectedPaths.length > 1
                ? `${selectedPaths.length} items selected`
                : entry.name}
            </span>
          </div>

          <button
            onClick={() => {
              closeContextMenu();
              openEntry(entry);
            }}
            className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center justify-between cursor-pointer text-left"
          >
            <span className="flex items-center gap-2 font-medium">
              <KenneyIcon name={entry.isDirectory ? 'folder' : 'share2'} size={14} />
              <span>{entry.isDirectory ? 'Open Folder' : 'Open with Default App'}</span>
            </span>
            <span className="text-[10px] text-[var(--muted-foreground)]">Enter</span>
          </button>

          {entry.isDirectory && (
            <>
              <button
                onClick={() => {
                  closeContextMenu();
                  addTab(entry.path);
                }}
                className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center gap-2 cursor-pointer text-left"
              >
                <KenneyIcon name="plusBold" size={13} />
                <span>Open in New Tab</span>
              </button>
              <button
                onClick={() => {
                  closeContextMenu();
                  togglePinFolder(entry.path);
                }}
                className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center gap-2 cursor-pointer text-left"
              >
                <KenneyIcon
                  name={
                    pinnedFolders.some(
                      (p) =>
                        p.path.toLowerCase() === entry.path.replace(/[\\/]+$/, '').toLowerCase()
                    )
                      ? 'cross'
                      : 'plusBold'
                  }
                  size={13}
                />
                <span>
                  {pinnedFolders.some(
                    (p) =>
                      p.path.toLowerCase() === entry.path.replace(/[\\/]+$/, '').toLowerCase()
                  )
                    ? 'Unpin from Quick Access'
                    : 'Pin to Quick Access'}
                </span>
              </button>
            </>
          )}

          <button
            onClick={() => {
              closeContextMenu();
              fsService.openPowershell(entry.isDirectory ? entry.path : currentPath);
            }}
            className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center gap-2 cursor-pointer text-left"
          >
            <KenneyIcon name="campfire" size={14} />
            <span>Launch PowerShell Here</span>
          </button>

          <button
            onClick={() => {
              closeContextMenu();
              revealInExplorer(entry.path);
            }}
            className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center gap-2 cursor-pointer text-left"
          >
            <KenneyIcon name="zoom" size={14} />
            <span>Reveal in Windows Explorer</span>
          </button>

          <button
            onClick={() => {
              closeContextMenu();
              const targets = selectedPaths.length > 0 && selectedPaths.includes(entry.path)
                ? selectedPaths
                : [entry.path];
              fsService.openWith('sublime', targets);
            }}
            className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center gap-2 cursor-pointer text-left"
          >
            <KenneyIcon name="sublime" size={14} className="text-orange-400" />
            <span>Open with Sublime Text</span>
          </button>

          <button
            onClick={() => {
              closeContextMenu();
              const targets = selectedPaths.length > 0 && selectedPaths.includes(entry.path)
                ? selectedPaths
                : [entry.path];
              fsService.openWith('notepad++', targets);
            }}
            className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center gap-2 cursor-pointer text-left"
          >
            <KenneyIcon name="notepadpp" size={14} className="text-emerald-400" />
            <span>Open with Notepad++</span>
          </button>

          <div className="my-1 border-t border-[var(--border)]/70" />

          <button
            onClick={() => {
              closeContextMenu();
              copyToClipboard();
            }}
            className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center justify-between cursor-pointer text-left"
          >
            <span className="flex items-center gap-2">
              <KenneyIcon name="cards_stack" size={14} />
              <span>Copy</span>
            </span>
            <span className="text-[10px] text-[var(--muted-foreground)]">Ctrl+C</span>
          </button>

          <button
            onClick={() => {
              closeContextMenu();
              cutToClipboard();
            }}
            className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center justify-between cursor-pointer text-left"
          >
            <span className="flex items-center gap-2">
              <KenneyIcon name="flip_head" size={14} />
              <span>Cut</span>
            </span>
            <span className="text-[10px] text-[var(--muted-foreground)]">Ctrl+X</span>
          </button>

          {clipboard && (
            <button
              onClick={() => {
                closeContextMenu();
                pasteClipboard(entry.isDirectory ? entry.path : currentPath);
              }}
              className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center justify-between cursor-pointer text-left"
            >
              <span className="flex items-center gap-2">
                <KenneyIcon name="import" size={14} />
                <span>Paste ({clipboard.paths.length})</span>
              </span>
              <span className="text-[10px] text-[var(--muted-foreground)]">Ctrl+V</span>
            </button>
          )}

          {clipboard && remotePasteHost && (
            <button
              onClick={() => {
                closeContextMenu();
                pasteClipboard(entry.isDirectory ? entry.path : currentPath, true);
              }}
              title={`${remotePasteHost} copies straight from the network share with rsync; nothing passes through this PC`}
              className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center gap-2 cursor-pointer text-left"
            >
              <KenneyIcon name="import" size={14} className="text-emerald-400" />
              <span>
                {clipboard.mode === 'cut' ? 'Move' : 'Paste'} directly on {remotePasteHost} ({clipboard.paths.length})
              </span>
            </button>
          )}

          <button
            onClick={handleRename}
            className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center justify-between cursor-pointer text-left"
          >
            <span className="flex items-center gap-2">
              <KenneyIcon name="toolPencil" size={14} />
              <span>Rename</span>
            </span>
            <span className="text-[10px] text-[var(--muted-foreground)]">F2</span>
          </button>

          <button
            onClick={() => {
              closeContextMenu();
              compressSelectedToZip();
            }}
            className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center justify-between cursor-pointer text-left"
          >
            <span className="flex items-center gap-2">
              <KenneyIcon name="tokens_stack" size={14} />
              <span>Compress to .zip</span>
            </span>
          </button>

          {!entry.isDirectory && entry.extension.toLowerCase() === 'zip' && (
            <button
              onClick={() => {
                closeContextMenu();
                extractZipArchive(entry.path);
              }}
              className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center justify-between cursor-pointer text-left"
            >
              <span className="flex items-center gap-2">
                <KenneyIcon name="folder" size={14} />
                <span>Extract Archive Here</span>
              </span>
            </button>
          )}

          <button
            onClick={handleAddTag}
            className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center gap-2 cursor-pointer text-left"
          >
            <KenneyIcon name="tag" size={14} />
            <span>Add Semantic Tag...</span>
          </button>

          <button
            onClick={() => handleCopyPath(entry.path)}
            className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center gap-2 cursor-pointer text-left"
          >
            <KenneyIcon name="book" size={14} />
            <span>Copy Full Path</span>
          </button>

          <div className="my-1 border-t border-[var(--border)]/70" />

          <button
            onClick={() => {
              closeContextMenu();
              requestDeleteSelected();
            }}
            className="w-full px-3 py-1.5 hover:bg-red-900/40 text-red-300 flex items-center justify-between cursor-pointer text-left"
          >
            <span className="flex items-center gap-2">
              <KenneyIcon name="trashcan" size={14} />
              <span>Delete</span>
            </span>
            <span className="text-[10px] text-red-400/80">Del</span>
          </button>
        </>
      ) : (
        <>
          <div className="px-3 py-1.5 border-b border-[var(--border)]/70 flex items-center gap-2 text-[var(--muted-foreground)]">
            <KenneyIcon name="pouch" size={14} />
            <span className="font-semibold text-[var(--foreground)] truncate">Current Folder</span>
          </div>

          <button
            onClick={handleNewFolder}
            className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center gap-2 cursor-pointer text-left"
          >
            <KenneyIcon name="pouch_add" size={14} />
            <span>New Folder</span>
          </button>

          <button
            onClick={handleNewFile}
            className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center gap-2 cursor-pointer text-left"
          >
            <KenneyIcon name="card_add" size={14} />
            <span>New File</span>
          </button>

          <button
            onClick={() => {
              closeContextMenu();
              togglePinFolder(currentPath);
            }}
            className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center gap-2 cursor-pointer text-left"
          >
            <KenneyIcon
              name={
                pinnedFolders.some(
                  (p) =>
                    p.path.toLowerCase() === currentPath.replace(/[\\/]+$/, '').toLowerCase()
                )
                  ? 'cross'
                  : 'plusBold'
              }
              size={13}
            />
            <span>
              {pinnedFolders.some(
                (p) =>
                  p.path.toLowerCase() === currentPath.replace(/[\\/]+$/, '').toLowerCase()
              )
                ? 'Unpin Folder from Quick Access'
                : 'Pin Folder to Quick Access'}
            </span>
          </button>

          <button
            onClick={() => {
              closeContextMenu();
              pinWorkflow();
            }}
            className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center gap-2 cursor-pointer text-left"
          >
            <KenneyIcon name="crown" size={14} className="text-sky-400" />
            <span>Save Workflow (Folders & Layout)</span>
          </button>

          {clipboard && (
            <button
              onClick={() => {
                closeContextMenu();
                pasteClipboard(currentPath);
              }}
              className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center justify-between cursor-pointer text-left"
            >
              <span className="flex items-center gap-2">
                <KenneyIcon name="import" size={14} />
                <span>Paste ({clipboard.paths.length} item{clipboard.paths.length === 1 ? '' : 's'})</span>
              </span>
              <span className="text-[10px] text-[var(--muted-foreground)]">Ctrl+V</span>
            </button>
          )}

          {clipboard && remotePasteHost && (
            <button
              onClick={() => {
                closeContextMenu();
                pasteClipboard(currentPath, true);
              }}
              title={`${remotePasteHost} copies straight from the network share with rsync; nothing passes through this PC`}
              className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center gap-2 cursor-pointer text-left"
            >
              <KenneyIcon name="import" size={14} className="text-emerald-400" />
              <span>
                {clipboard.mode === 'cut' ? 'Move' : 'Paste'} directly on {remotePasteHost} ({clipboard.paths.length})
              </span>
            </button>
          )}

          {undoStack.length > 0 && (
            <button
              onClick={() => {
                closeContextMenu();
                undoLastOperation();
              }}
              className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center justify-between cursor-pointer text-left"
            >
              <span className="flex items-center gap-2">
                <KenneyIcon name="return" size={14} />
                <span>Undo Last Operation</span>
              </span>
              <span className="text-[10px] text-[var(--muted-foreground)]">Ctrl+Z</span>
            </button>
          )}

          <div className="my-1 border-t border-[var(--border)]/70" />

          <button
            onClick={() => {
              closeContextMenu();
              fsService.openPowershell(currentPath);
            }}
            className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center justify-between cursor-pointer text-left"
          >
            <span className="flex items-center gap-2">
              <KenneyIcon name="campfire" size={14} />
              <span>Launch PowerShell Here</span>
            </span>
            <span className="text-[10px] text-[var(--muted-foreground)]">Ctrl+T</span>
          </button>

          <button
            onClick={() => {
              closeContextMenu();
              revealInExplorer(currentPath);
            }}
            className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center gap-2 cursor-pointer text-left"
          >
            <KenneyIcon name="zoom" size={14} />
            <span>Reveal in Windows Explorer</span>
          </button>

          <button
            onClick={() => {
              closeContextMenu();
              fsService.openWith('sublime', currentPath);
            }}
            className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center gap-2 cursor-pointer text-left"
          >
            <KenneyIcon name="sublime" size={14} className="text-orange-400" />
            <span>Open in Sublime Text</span>
          </button>

          <button
            onClick={() => {
              closeContextMenu();
              fsService.openWith('notepad++', currentPath);
            }}
            className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center gap-2 cursor-pointer text-left"
          >
            <KenneyIcon name="notepadpp" size={14} className="text-emerald-400" />
            <span>Open in Notepad++</span>
          </button>

          <button
            onClick={() => handleCopyPath(currentPath)}
            className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center gap-2 cursor-pointer text-left"
          >
            <KenneyIcon name="book" size={14} />
            <span>Copy Folder Path</span>
          </button>

          <button
            onClick={() => {
              closeContextMenu();
              refresh();
            }}
            className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center justify-between cursor-pointer text-left"
          >
            <span className="flex items-center gap-2">
              <KenneyIcon name="return" size={14} />
              <span>Refresh</span>
            </span>
            <span className="text-[10px] text-[var(--muted-foreground)]">F5</span>
          </button>
        </>
      )}
    </div>
  );
};
