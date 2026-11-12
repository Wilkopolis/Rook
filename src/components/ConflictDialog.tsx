import React, { useEffect, useState } from 'react';
import { ConflictPrompt, useExplorerStore } from '../store/useExplorerStore';
import { TransferConflict } from '../types/fs';
import { formatBytes, formatTimestamp } from '../utils/format';

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

const Side: React.FC<{ size: number; modifiedMs: number; newer: boolean }> = ({ size, modifiedMs, newer }) => (
  <td className="px-2 py-1 whitespace-nowrap font-mono text-[11px]">
    <span>{formatBytes(size)}</span>
    <span className="mx-1.5 opacity-40">·</span>
    <span className={newer ? 'text-[var(--foreground)] font-semibold' : ''}>{formatTimestamp(modifiedMs)}</span>
    {newer && <span className="ml-1.5 text-[10px] font-sans text-emerald-500">newer</span>}
  </td>
);

const ConflictRow: React.FC<{ conflict: TransferConflict }> = ({ conflict: c }) => {
  return (
    <tr className="border-t border-[var(--border)]">
      <td className="px-2 py-1 max-w-0 w-full">
        <div className="truncate text-[var(--foreground)]" title={c.relPath}>
          {c.relPath}
        </div>
        {c.typeMismatch && (
          <div className="text-[10px] text-amber-400">A file on one side and a folder on the other: can be skipped, not replaced</div>
        )}
        {c.sameSize && <div className="text-[10px]">Same size, different date</div>}
      </td>
      <Side size={c.sourceSize} modifiedMs={c.sourceModifiedMs} newer={c.sourceModifiedMs > c.destModifiedMs} />
      <Side size={c.destSize} modifiedMs={c.destModifiedMs} newer={c.destModifiedMs > c.sourceModifiedMs} />
    </tr>
  );
};

const ConflictDialogBody: React.FC<{ prompt: ConflictPrompt }> = ({ prompt }) => {
  const resolve = useExplorerStore((s) => s.resolveConflictPrompt);
  const [verifySameSize, setVerifySameSize] = useState(true);
  const { plan, kind } = prompt;
  const isMove = kind === 'move';
  const total = plan.differentCount + plan.sameSizeCount;
  const verify = plan.sameSizeCount > 0 && verifySameSize;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        resolve({ action: 'cancel' });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [resolve]);

  const button =
    'px-3 py-1.5 rounded-md border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--foreground)]/[0.06] cursor-pointer transition-colors';

  return (
    <div className="fixed inset-0 bg-black/60 z-[1100] flex items-center justify-center p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Files already exist"
        className="bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl w-[min(760px,100%)] max-h-[min(640px,100%)] flex flex-col text-xs text-[var(--muted-foreground)] overflow-hidden"
      >
        <div className="px-5 pt-4 pb-3 border-b border-[var(--border)] shrink-0">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            {plural(total, 'file')} already {total === 1 ? 'exists' : 'exist'} at the destination
          </h3>
          <div className="mt-1 truncate" title={prompt.destDir}>
            {isMove ? 'Moving' : 'Copying'} {plural(prompt.itemCount, 'item')} to {prompt.destDir}
          </div>
        </div>

        <div className="px-5 py-3 space-y-1.5 shrink-0">
          {plan.identicalCount > 0 && (
            <div>
              <span className="text-[var(--foreground)]">{plural(plan.identicalCount, 'identical file')}</span> (same size and
              date) will be skipped{isMove ? ' and removed from the source' : ''}.
            </div>
          )}
          {plan.differentCount > 0 && (
            <div>
              <span className="text-[var(--foreground)]">{plural(plan.differentCount, 'file')}</span>{' '}
              {plan.differentCount === 1 ? 'differs' : 'differ'} from the copy at the destination.
            </div>
          )}
          {plan.sameSizeCount > 0 && (
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={verifySameSize}
                onChange={(e) => setVerifySameSize(e.target.checked)}
              />
              <span>
                <span className="text-[var(--foreground)]">{plural(plan.sameSizeCount, 'file')}</span>{' '}
                {plan.sameSizeCount === 1 ? 'has' : 'have'} the same size but a different date. Compare contents and skip the
                ones that match (reads both copies in full, which is slow over SSH).
              </span>
            </label>
          )}
        </div>

        <div className="mx-5 mb-3 border border-[var(--border)] rounded-md overflow-auto min-h-0">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-[var(--sidebar)] text-left text-[10px] uppercase tracking-wide">
              <tr>
                <th className="px-2 py-1 font-medium">File</th>
                <th className="px-2 py-1 font-medium">{isMove ? 'Moving' : 'Copying'}</th>
                <th className="px-2 py-1 font-medium">Already there</th>
              </tr>
            </thead>
            <tbody>
              {plan.conflicts.map((c) => (
                <ConflictRow key={c.relPath} conflict={c} />
              ))}
            </tbody>
          </table>
          {plan.conflicts.length < total && (
            <div className="px-2 py-1.5 border-t border-[var(--border)]">
              Showing the first {plan.conflicts.length.toLocaleString()} of {total.toLocaleString()}.
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[var(--border)] flex items-center justify-between gap-3 shrink-0">
          <span>{verify ? 'Applies to the files whose contents differ.' : 'Applies to every file listed.'}</span>
          <span className="flex items-center gap-2 shrink-0">
            <button type="button" className={button} onClick={() => resolve({ action: 'cancel' })}>
              Cancel
            </button>
            <button
              type="button"
              autoFocus
              className={button}
              title={`Leave these files as they are on both sides and ${isMove ? 'move' : 'copy'} everything else`}
              onClick={() => resolve({ action: 'skip', verifySameSize: verify })}
            >
              Skip them
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded-md bg-[var(--primary)] text-white font-medium hover:opacity-90 cursor-pointer transition-opacity"
              title="Overwrite the files at the destination"
              onClick={() => resolve({ action: 'replace', verifySameSize: verify })}
            >
              Replace them
            </button>
          </span>
        </div>
      </div>
    </div>
  );
};

/** Asks what to do with files a copy/move would overwrite. Mounted once, in App. */
export const ConflictDialog: React.FC = () => {
  const prompt = useExplorerStore((s) => s.conflictPrompt);
  return prompt ? <ConflictDialogBody prompt={prompt} /> : null;
};
