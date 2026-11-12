import React from 'react';
import { useExplorerStore } from '../store/useExplorerStore';
import { formatBytes, formatRelativeTime, formatDuration, formatBitrate, formatTimestamp } from '../utils/format';
import { fsService } from '../services/fsService';
import type { MediaInfo } from '../types/fs';
import { KenneyIcon } from './KenneyIcon';
import { FileThumbnail } from './FileThumbnail';

export const InspectorPane: React.FC = () => {
  const {
    showInspector,
    items,
    selectedPath,
    preview,
    openPromptModal,
    setLayout,
    setFilterQuery,
    navigateTo,
  } = useExplorerStore();

  const selectedItem = items.find((i) => i.path === selectedPath);
  const mediaPath =
    showInspector &&
    selectedItem &&
    !selectedItem.isDirectory &&
    (preview?.kind === 'video' || preview?.kind === 'image')
      ? selectedItem.path
      : null;

  // Keyed by path so a result for a previously selected file never shows for the current one.
  const [mediaState, setMediaState] = React.useState<{ path: string; info: MediaInfo } | null>(null);
  React.useEffect(() => {
    if (!mediaPath) return;
    let cancelled = false;
    fsService
      .getMediaInfo(mediaPath)
      .then((info) => {
        if (!cancelled) setMediaState({ path: mediaPath, info });
      })
      .catch(() => {
        /* unavailable (e.g. npm run dev); hide media rows */
      });
    return () => {
      cancelled = true;
    };
  }, [mediaPath]);
  const mediaInfo = mediaPath && mediaState?.path === mediaPath ? mediaState.info : null;

  if (!showInspector) return null;

  const handleAddTag = () => {
    if (!selectedItem) return;
    openPromptModal({
      kind: 'addTag',
      title: 'Add Semantic Tag',
      subtitle: `Tagging "${selectedItem.name}"`,
      defaultValue: 'important',
      targetPath: selectedItem.path,
    });
  };

  if (!selectedItem) {
    return (
      <aside className="w-80 border-l border-[var(--border)] bg-[var(--sidebar)] p-4 flex flex-col justify-center items-center text-xs text-[var(--muted-foreground)] shrink-0">
        Select a file or folder to inspect
      </aside>
    );
  }

  return (
    <aside className="w-80 border-l border-[var(--border)] bg-[var(--sidebar)] p-4 flex flex-col justify-between overflow-y-auto shrink-0">
      <div className="space-y-4">
        <div className="flex items-center gap-3 pb-3 border-b border-[var(--border)]">
          <div className="w-11 h-11 rounded-lg bg-[var(--card)] border border-[var(--border)] flex items-center justify-center shrink-0 overflow-hidden p-1">
            <FileThumbnail entry={selectedItem} size={32} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-[var(--foreground)]/85 truncate" title={selectedItem.name}>
              {selectedItem.name}
            </div>
            <div className="text-xs text-[var(--muted-foreground)]">
              {selectedItem.isDirectory ? 'Folder' : selectedItem.extension.toUpperCase() || 'File'} •{' '}
              {formatBytes(selectedItem.sizeBytes, selectedItem.isDirectory)}
            </div>
          </div>
        </div>

        {/* Live QuickLook Preview */}
        <div>
          <div className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <KenneyIcon name="zoomIn" size={14} />
              <span>Live QuickLook</span>
            </span>
            {preview?.kind === 'image' && preview.width && preview.height && (
              <span className="font-mono text-xs text-[var(--foreground)] bg-[var(--card)] px-1.5 py-0.5 rounded border border-[var(--border)]">
                {preview.width}×{preview.height}
              </span>
            )}
          </div>

          {preview?.kind === 'image' && preview.url && (
            <div className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3 flex flex-col items-center justify-center min-h-[160px] max-h-64 overflow-hidden">
              <img
                src={preview.url}
                alt={selectedItem.name}
                className="max-h-56 max-w-full object-contain rounded"
              />
            </div>
          )}

          {preview?.kind === 'video' && preview.url && (
            <div className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-2">
              <video
                src={preview.url}
                controls
                className="w-full max-h-56 rounded"
              />
            </div>
          )}

          {preview?.kind === 'audio' && preview.url && (
            <div className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3">
              <audio src={preview.url} controls className="w-full" />
            </div>
          )}

          {preview?.kind !== 'image' &&
            preview?.kind !== 'video' &&
            preview?.kind !== 'audio' && (
              <div className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-3 text-xs font-mono text-[var(--foreground)] max-h-64 overflow-y-auto whitespace-pre-wrap">
                {preview?.kind === 'text' && (preview.content || '(Empty file)')}
                {preview?.kind === 'directory' &&
                  (preview.children && preview.children.length > 0
                    ? `Folder (${preview.children.length} items):\n• ` + preview.children.join('\n• ')
                    : '(Empty directory)')}
                {preview?.kind === 'binary' && (
                  <span className="text-[var(--muted-foreground)]">{preview.message}</span>
                )}
                {!preview && <span className="text-[var(--muted-foreground)]">Loading preview...</span>}
              </div>
            )}
        </div>

        {/* Semantic Tags */}
        <div>
          <div className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <KenneyIcon name="tag_shield" size={14} />
            <span>Semantic Tags</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(selectedItem.tags || []).map((t) => (
              <span
                key={t}
                onClick={() => {
                  setFilterQuery(t);
                }}
                className="px-2 py-0.5 rounded-full text-xs bg-[var(--card)] border border-[var(--border)] text-[var(--foreground)] cursor-pointer hover:border-[var(--primary)]"
              >
                #{t}
              </span>
            ))}
            <button
              onClick={handleAddTag}
              className="px-2 py-0.5 rounded-full text-xs border border-dashed border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] cursor-pointer flex items-center gap-1"
            >
              <KenneyIcon name="plus" size={11} />
              <span>Tag</span>
            </button>
          </div>
        </div>

        {/* Metadata */}
        <div className="space-y-1.5 text-xs border-t border-[var(--border)] pt-3">
          <div className="flex justify-between">
            <span className="text-[var(--muted-foreground)]">Modified</span>
            <span>{formatRelativeTime(selectedItem.modifiedMs)}</span>
          </div>
          {mediaInfo && (mediaInfo.kind === 'video' || mediaInfo.kind === 'image') && (
            <>
              {mediaInfo.width && mediaInfo.height ? (
                <div className="flex justify-between">
                  <span className="text-[var(--muted-foreground)]">Resolution</span>
                  <span className="font-mono">{mediaInfo.width}×{mediaInfo.height}</span>
                </div>
              ) : null}
              {mediaInfo.durationSeconds != null && (
                <div className="flex justify-between">
                  <span className="text-[var(--muted-foreground)]">Duration</span>
                  <span className="font-mono">{formatDuration(mediaInfo.durationSeconds)}</span>
                </div>
              )}
              {mediaInfo.bitrate != null && (
                <div className="flex justify-between">
                  <span className="text-[var(--muted-foreground)]">Bitrate</span>
                  <span className="font-mono">{formatBitrate(mediaInfo.bitrate)}</span>
                </div>
              )}
              {mediaInfo.createdMs ? (
                <div className="flex justify-between">
                  <span className="text-[var(--muted-foreground)]">Created</span>
                  <span className="font-mono">{formatTimestamp(mediaInfo.createdMs)}</span>
                </div>
              ) : null}
              {mediaInfo.modifiedMs ? (
                <div className="flex justify-between">
                  <span className="text-[var(--muted-foreground)]">Modified (exact)</span>
                  <span className="font-mono">{formatTimestamp(mediaInfo.modifiedMs)}</span>
                </div>
              ) : null}
            </>
          )}
          {selectedItem.gitStatus && (
            <div className="flex justify-between">
              <span className="text-[var(--muted-foreground)]">Git Status</span>
              <span className="text-amber-500 font-semibold font-mono">{selectedItem.gitStatus}</span>
            </div>
          )}
          <div className="flex flex-col gap-1 pt-1">
            <span className="text-[var(--muted-foreground)]">Full Path</span>
            <span className="font-mono text-xs bg-[var(--card)] p-1.5 rounded border border-[var(--border)] break-all">
              {selectedItem.path}
            </span>
          </div>
        </div>
      </div>

      {selectedItem.isDirectory && (
        <div className="pt-3 border-t border-[var(--border)] flex gap-2">
          <button
            onClick={() => navigateTo(selectedItem.path)}
            className="flex-1 h-8 px-3 rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-medium cursor-pointer flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity"
          >
            <KenneyIcon name="open" size={14} />
            <span>Open Folder</span>
            <KenneyIcon name="keyboard_enter_outline" size={14} />
          </button>
        </div>
      )}
    </aside>
  );
};
