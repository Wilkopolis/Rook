import React, { useEffect, useRef } from 'react';
import { useExplorerStore } from '../store/useExplorerStore';
import { FsEntry } from '../types/fs';

/**
 * Shows the entry's name, or an in-place text box while that entry is being renamed.
 * The base name (without extension) is pre-selected for files; folders select everything.
 */
export const InlineRenameName: React.FC<{
  entry: FsEntry;
  className?: string;
  inputClassName?: string;
  multiline?: boolean;
}> = ({ entry, className, inputClassName, multiline }) => {
  const isRenaming = useExplorerStore((s) => s.inlineRename?.path === entry.path);
  if (!isRenaming) return <span className={className}>{entry.name}</span>;
  return <RenameInput entry={entry} className={inputClassName} multiline={multiline} />;
};

const RenameInput: React.FC<{ entry: FsEntry; className?: string; multiline?: boolean }> = ({
  entry,
  className,
  multiline,
}) => {
  const commit = useExplorerStore((s) => s.commitInlineRename);
  const cancel = useExplorerStore((s) => s.cancelInlineRename);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = entry.name.lastIndexOf('.');
    if (!entry.isDirectory && dot > 0) el.setSelectionRange(0, dot);
    else el.select();
  }, [entry]);

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) void commit(ref.current?.value ?? entry.name);
    else cancel();
  };

  const props = {
    ref,
    defaultValue: entry.name,
    spellCheck: false,
    draggable: false,
    className: `min-w-0 bg-[var(--background)] text-[var(--foreground)] border border-[var(--accent,#3b82f6)] rounded-sm px-1 outline-none ${className ?? 'w-full'}`,
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    },
    onBlur: () => finish(true),
    onMouseDown: (e: React.MouseEvent) => e.stopPropagation(),
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
    onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
    onContextMenu: (e: React.MouseEvent) => e.stopPropagation(),
    onDragStart: (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    },
  };

  return multiline ? (
    <textarea {...props} rows={2} className={`${props.className} resize-none text-center`} />
  ) : (
    <input {...props} type="text" />
  );
};
