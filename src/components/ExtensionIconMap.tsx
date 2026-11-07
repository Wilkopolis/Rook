import React, { useMemo, useState } from 'react';
import { KenneyIcon } from './KenneyIcon';
import { useExplorerStore } from '../store/useExplorerStore';
import { IconPickerDialog } from './IconPickerDialog';
import { getFileIconName } from '../utils/format';
import type { FsEntry } from '../types/fs';

const DEFAULT_EXTENSIONS = [
  'ts', 'tsx', 'js', 'jsx', 'html', 'css', 'json', 'md', 'txt', 'pdf',
  'py', 'cs', 'cpp', 'rs', 'sql', 'csv', 'png', 'jpg', 'svg', 'zip',
];

const normalizeExt = (v: string) => v.trim().replace(/^\.+/, '').toLowerCase();

const iconForExt = (ext: string) =>
  getFileIconName({ isDirectory: false, extension: ext } as FsEntry);

const DEFAULT_COLOR = '#94a3b8';

export const ExtensionIconMap: React.FC = () => {
  const overrides = useExplorerStore((s) => s.extensionIcons);
  const setExtensionIcon = useExplorerStore((s) => s.setExtensionIcon);
  const [addedExtensions, setAddedExtensions] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [editingExt, setEditingExt] = useState<string | null>(null);

  // Defaults, then any saved mappings for other extensions, then ones added this session.
  const extensions = useMemo(() => {
    const seen = new Set<string>();
    return [...DEFAULT_EXTENSIONS, ...Object.keys(overrides), ...addedExtensions].filter((e) =>
      seen.has(e) ? false : (seen.add(e), true)
    );
  }, [overrides, addedExtensions]);

  const addExtension = () => {
    const ext = normalizeExt(draft);
    if (!ext || /[\\/\s]/.test(ext)) return;
    setAddedExtensions((prev) => (prev.includes(ext) ? prev : [...prev, ext]));
    setDraft('');
  };

  return (
    <div className="p-2.5 rounded-lg bg-[var(--background)] border border-[var(--border)] space-y-2.5">
      <div>
        <div className="font-medium text-[var(--foreground)]">File Extension Icons</div>
        <div className="text-[var(--muted-foreground)]">Choose which icon is shown for each file extension</div>
      </div>
      <div className="flex items-center gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addExtension(); }}
          placeholder="Add extension (e.g. mkv)"
          className="h-7 flex-1 min-w-0 px-2 rounded-md bg-[var(--card)] border border-[var(--border)] text-xs outline-none focus:border-[var(--primary)]"
        />
        <button
          onClick={addExtension}
          className="h-7 px-3 rounded-md bg-[var(--card)] border border-[var(--border)] hover:border-[var(--primary)] text-xs font-medium cursor-pointer transition-colors"
        >
          Add
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {extensions.map((ext) => (
          <button
            key={ext}
            onClick={() => setEditingExt(ext)}
            title={`Change icon for .${ext}`}
            className="flex items-center gap-2 px-2 h-8 rounded-md bg-[var(--card)] border border-[var(--border)] hover:border-[var(--primary)] cursor-pointer text-left transition-colors"
          >
            <KenneyIcon name={overrides[ext]?.icon ?? iconForExt(ext)} size={16} color={overrides[ext]?.color} />
            <span className="font-mono text-xs text-[var(--foreground)]">.{ext}</span>
          </button>
        ))}
      </div>
      {editingExt && (
        <IconPickerDialog
          key={editingExt}
          title={`.${editingExt}`}
          initialIcon={overrides[editingExt]?.icon ?? iconForExt(editingExt)}
          initialColor={overrides[editingExt]?.color ?? DEFAULT_COLOR}
          onSave={(icon, color) => {
            setExtensionIcon(editingExt, icon, color);
            setEditingExt(null);
          }}
          onClose={() => setEditingExt(null)}
        />
      )}
    </div>
  );
};

