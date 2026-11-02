import React, { useEffect } from 'react';
import { useExplorerStore } from '../store/useExplorerStore';
import { fsService } from '../services/fsService';
import { KenneyIcon } from './KenneyIcon';

export const ContextMenu: React.FC = () => {
  const {
    contextMenu,
    currentPath,
    pinnedFolders,
    selectedPaths,
    clipboard,
    undoStack,
    closeContextMenu,
    openEntry,
    addTab,
    togglePinFolder,
    revealInExplorer,
    copyToClipboard,
    cutToClipboard,
    pasteClipboard,
    undoLastOperation,
    openPromptModal,
    copySelectedToOtherPane,
    moveSelectedToOtherPane,
    compressSelectedToZip,
    extractZipArchive,
    requestDeleteSelected,
    refresh,
  } = useExplorerStore();

  useEffect(() => {
    if (!contextMenu) return;
    const handleDismiss = () => closeContextMenu();
    window.addEventListener('click', handleDismiss);
    window.addEventListener('scroll', handleDismiss, true);
    return () => {
      window.removeEventListener('click', handleDismiss);
      window.removeEventListener('scroll', handleDismiss, true);
    };
  }, [contextMenu, closeContextMenu]);

  if (!contextMenu) return null;

  const { x, y, entry } = contextMenu;
  const menuWidth = 230;
  const menuHeight = entry ? 330 : 210;
  const clampedX = Math.min(x, window.innerWidth - menuWidth - 8);
  const clampedY = Math.min(y, window.innerHeight - menuHeight - 8);

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
      style={{ left: Math.max(8, clampedX), top: Math.max(8, clampedY) }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 w-56 rounded-xl bg-[var(--sidebar)] border border-[var(--border)] shadow-2xl py-1.5 text-xs text-[var(--foreground)] select-none"
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
                <KenneyIcon name="plus" size={14} />
                <span>Open in New Tab</span>
              </button>
              <button
                onClick={() => {
                  closeContextMenu();
                  togglePinFolder(entry.path);
                }}
                className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center gap-2 cursor-pointer text-left"
              >
                <KenneyIcon name="award" size={14} />
                <span>
                  {pinnedFolders.some(
                    (p) =>
                      p.path.toLowerCase() === entry.path.replace(/[\\/]+$/, '').toLowerCase() &&
                      (p.tabs?.length || 1) <= 1
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
              copySelectedToOtherPane();
            }}
            className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center justify-between cursor-pointer text-left"
          >
            <span className="flex items-center gap-2">
              <KenneyIcon name="export" size={14} />
              <span>Copy to Target Pane</span>
            </span>
            <span className="text-[10px] text-[var(--muted-foreground)]">F5</span>
          </button>

          <button
            onClick={() => {
              closeContextMenu();
              moveSelectedToOtherPane();
            }}
            className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center justify-between cursor-pointer text-left"
          >
            <span className="flex items-center gap-2">
              <KenneyIcon name="import" size={14} />
              <span>Move to Target Pane</span>
            </span>
            <span className="text-[10px] text-[var(--muted-foreground)]">F6</span>
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
              togglePinFolder();
            }}
            className="w-full px-3 py-1.5 hover:bg-[var(--primary)]/20 flex items-center gap-2 cursor-pointer text-left"
          >
            <KenneyIcon name="award" size={14} />
            <span>Pin Workspace to Quick Access</span>
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
