import React from 'react';
import { TransferState, useExplorerStore } from '../store/useExplorerStore';
import { formatBytes, formatDuration } from '../utils/format';
import { parseSshPath } from '../utils/sshPath';

function destinationLabel(destDir: string): string {
  const ssh = parseSshPath(destDir);
  const path = ssh ? ssh.remotePath : destDir;
  const trimmed = path.replace(/[\\/]+$/, '');
  return trimmed.split(/[\\/]/).pop() || path || destDir;
}

const TransferRow: React.FC<{ transfer: TransferState }> = ({ transfer: t }) => {
  const cancelTransfer = useExplorerStore((s) => s.cancelTransfer);

  // Bytes once the host has totalled the batch; top-level items when nothing is transferred
  // byte by byte (same-drive moves are renames) or the host isn't tracking.
  const byBytes = t.totalBytes > 0;
  // Files already at the destination count as progress, but not as transferred bytes or speed.
  const handledBytes = t.doneBytes + t.skippedBytes;
  const handledFiles = t.doneFiles + t.skippedFiles;
  const fraction = t.scanning
    ? null
    : byBytes
      ? Math.min(1, handledBytes / t.totalBytes)
      : t.totalItems > 0
        ? t.doneItems / t.totalItems
        : 0;
  const pct = fraction === null ? null : Math.round(fraction * 100);

  const details: string[] = [];
  if (t.doneBytes > 0 || byBytes) {
    details.push(
      t.scanning || !byBytes
        ? `${formatBytes(t.doneBytes)} copied`
        : `${formatBytes(Math.min(handledBytes, t.totalBytes))} of ${formatBytes(t.totalBytes)}`
    );
  }
  if (t.totalFiles > 1 && !t.scanning) {
    details.push(`${Math.min(handledFiles, t.totalFiles)} of ${t.totalFiles} files`);
  } else if (t.totalFiles === 0 && t.totalItems > 1) {
    details.push(`${t.doneItems} of ${t.totalItems} items`);
  }
  if (t.skippedFiles > 0) details.push(`${t.skippedFiles} already there`);
  if (t.bytesPerSec > 0) {
    details.push(`${formatBytes(t.bytesPerSec)}/s`);
    if (!t.scanning && byBytes && handledBytes < t.totalBytes) {
      details.push(`${formatDuration((t.totalBytes - handledBytes) / t.bytesPerSec)} left`);
    }
  }

  const verb = t.cancelling ? 'Cancelling' : t.kind === 'copy' ? 'Copying' : 'Moving';
  const title = `${verb} ${t.totalItems} item${t.totalItems === 1 ? '' : 's'} to ${destinationLabel(t.destDir)}`;

  return (
    <div className="px-3 py-1.5 flex flex-col gap-1" title={`${title} — ${t.destDir}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-baseline gap-2 min-w-0">
          <span className="font-medium text-[var(--foreground)] shrink-0">{title}</span>
          <span className="truncate">{t.currentName}</span>
        </span>
        <span className="flex items-center gap-3 shrink-0 font-mono text-[11px]">
          <span>{details.join(' · ')}</span>
          <span className="w-9 text-right text-[var(--foreground)]">{pct === null ? '…' : `${pct}%`}</span>
          <button
            type="button"
            onClick={() => cancelTransfer(t.id)}
            disabled={t.cancelling}
            className="px-1.5 py-0.5 rounded border border-[var(--border)] font-sans text-[var(--foreground)] hover:bg-[var(--card)] disabled:opacity-50 disabled:cursor-default cursor-pointer"
          >
            Cancel
          </button>
        </span>
      </div>
      <div
        className="h-1 w-full rounded-full bg-[var(--background)] overflow-hidden"
        role="progressbar"
        aria-label={title}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
      >
        {pct === null ? (
          <div className="h-full w-full rounded-full bg-[var(--primary)]/50 animate-pulse" />
        ) : (
          <div
            className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    </div>
  );
};

/** Progress of running copy/move batches, docked above the status footer. */
export const TransferBar: React.FC = () => {
  const transfers = useExplorerStore((s) => s.transfers);
  const visible = transfers.filter((t) => t.visible);
  if (visible.length === 0) return null;
  return (
    <div className="bg-[var(--sidebar)] border-t border-[var(--border)] text-xs text-[var(--muted-foreground)] select-none shrink-0 divide-y divide-[var(--border)]">
      {visible.map((t) => (
        <TransferRow key={t.id} transfer={t} />
      ))}
    </div>
  );
};
