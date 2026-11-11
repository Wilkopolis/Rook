import React, { useEffect, useState } from 'react';
import { useExplorerStore } from '../store/useExplorerStore';
import { SshConnection } from '../types/fs';
import { KenneyIcon } from './KenneyIcon';

type TestState = { status: 'testing' } | { status: 'ok'; message: string } | { status: 'error'; message: string };

const inputClass =
  'h-8 w-full bg-[var(--card)] border border-[var(--border)] focus:border-[var(--primary)] rounded-md px-2 text-[var(--foreground)] outline-none';
const buttonClass =
  'h-7 px-2.5 rounded-md bg-[var(--card)] border border-[var(--border)] hover:border-[var(--primary)] font-medium text-xs cursor-pointer flex items-center gap-1.5 justify-center transition-colors disabled:opacity-50 disabled:cursor-default';

/**
 * Settings panel for SSH hosts: add a host as `user@host` (key-based auth), test it, reset its
 * pinned host key, or remove it. Connections are stored by the desktop host.
 */
export const SshHostsPanel: React.FC = () => {
  const {
    sshConnections,
    loadSshConnections,
    addSshConnection,
    removeSshConnection,
    testSshConnection,
    resetSshHostKey,
  } = useExplorerStore();

  const [target, setTarget] = useState('');
  const [label, setLabel] = useState('');
  const [keyPath, setKeyPath] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  useEffect(() => {
    loadSshConnections();
  }, [loadSshConnections]);

  const runTest = async (id: string) => {
    setTests((t) => ({ ...t, [id]: { status: 'testing' } }));
    try {
      const res = await testSshConnection(id);
      const home = res.homePath.replace(/^ssh:\/\/[^/]+/, '') || '/';
      setTests((t) => ({ ...t, [id]: { status: 'ok', message: `Connected (home: ${home})` } }));
    } catch (err: any) {
      setTests((t) => ({ ...t, [id]: { status: 'error', message: err?.message || String(err) } }));
    }
  };

  const handleAdd = async () => {
    const trimmed = target.trim();
    if (!trimmed) {
      setAddError('Enter the host as user@ipaddress, for example pi@192.168.1.20');
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const conn = await addSshConnection({
        target: trimmed,
        label: label.trim() || undefined,
        keyPath: keyPath.trim() || undefined,
      });
      setTarget('');
      setLabel('');
      setKeyPath('');
      // Check the key right away so problems show up here, not later while browsing.
      runTest(conn.id);
    } catch (err: any) {
      setAddError(err?.message || String(err));
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (conn: SshConnection) => {
    if (confirmRemoveId !== conn.id) {
      setConfirmRemoveId(conn.id);
      return;
    }
    setConfirmRemoveId(null);
    try {
      await removeSshConnection(conn.id);
      setTests(({ [conn.id]: _removed, ...rest }) => rest);
    } catch (err: any) {
      setTests((t) => ({ ...t, [conn.id]: { status: 'error', message: err?.message || String(err) } }));
    }
  };

  const handleResetKey = async (conn: SshConnection) => {
    try {
      await resetSshHostKey(conn.id);
      setTests(({ [conn.id]: _cleared, ...rest }) => rest);
    } catch (err: any) {
      setTests((t) => ({ ...t, [conn.id]: { status: 'error', message: err?.message || String(err) } }));
    }
  };

  return (
    <div className="space-y-3">
      <div className="p-2.5 rounded-lg bg-[var(--background)] border border-[var(--border)] space-y-2.5">
        <div>
          <div className="font-medium text-[var(--foreground)] flex items-center gap-1.5">
            <KenneyIcon name="terminal-window" size={14} />
            <span>Add SSH Host</span>
          </div>
          <div className="text-[var(--muted-foreground)]">
            Connects with your SSH key (~/.ssh/id_ed25519, id_ecdsa or id_rsa). The key must be unencrypted and listed in the
            remote ~/.ssh/authorized_keys.
          </div>
        </div>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            handleAdd();
          }}
        >
          <div className="flex flex-wrap gap-2">
            <label className="flex-1 min-w-[180px] space-y-1">
              <span className="text-[var(--muted-foreground)]">Host</span>
              <input
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  setAddError(null);
                }}
                placeholder="user@192.168.1.20"
                spellCheck={false}
                autoComplete="off"
                className={`${inputClass} font-mono`}
              />
            </label>
            <label className="flex-1 min-w-[140px] space-y-1">
              <span className="text-[var(--muted-foreground)]">Name (optional)</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Raspberry Pi"
                className={inputClass}
              />
            </label>
          </div>
          {showAdvanced ? (
            <label className="block space-y-1">
              <span className="text-[var(--muted-foreground)]">Private key file (optional)</span>
              <input
                value={keyPath}
                onChange={(e) => setKeyPath(e.target.value)}
                placeholder="Default: keys in %USERPROFILE%\.ssh"
                spellCheck={false}
                className={`${inputClass} font-mono`}
              />
            </label>
          ) : (
            <button
              type="button"
              onClick={() => setShowAdvanced(true)}
              className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] underline-offset-2 hover:underline cursor-pointer"
            >
              Use a different key file…
            </button>
          )}
          {addError && (
            <div className="flex items-start gap-1.5 text-red-400" role="alert">
              <KenneyIcon name="warning" size={13} />
              <span>{addError}</span>
            </div>
          )}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={adding}
              className="h-8 px-3 rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 font-medium text-xs cursor-pointer flex items-center gap-1.5 justify-center transition-colors disabled:opacity-60 disabled:cursor-default"
            >
              <KenneyIcon name="plus" size={13} />
              <span>{adding ? 'Adding…' : 'Add Host'}</span>
            </button>
          </div>
        </form>
      </div>

      <div className="p-2.5 rounded-lg bg-[var(--background)] border border-[var(--border)] space-y-2">
        <div className="font-medium text-[var(--foreground)]">Saved Hosts</div>
        {sshConnections.length === 0 ? (
          <div className="text-[var(--muted-foreground)] italic">No SSH hosts yet</div>
        ) : (
          <ul className="divide-y divide-[var(--border)]/60">
            {sshConnections.map((conn) => {
              const test = tests[conn.id];
              return (
                <li key={conn.id} className="py-2 first:pt-0 last:pb-0 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${conn.connected ? 'bg-emerald-400' : 'bg-[var(--muted-foreground)]/40'}`}
                        title={conn.connected ? 'Connected' : 'Not connected'}
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-[var(--foreground)] truncate">{conn.label || conn.target}</div>
                        {conn.label && <div className="font-mono text-[var(--muted-foreground)] truncate">{conn.target}</div>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => runTest(conn.id)}
                        disabled={test?.status === 'testing'}
                        className={buttonClass}
                        title="Connect now to check the key and host"
                      >
                        <KenneyIcon name="plugs-connected" size={12} />
                        <span>{test?.status === 'testing' ? 'Testing…' : 'Test'}</span>
                      </button>
                      {conn.hostKeyFingerprint && (
                        <button
                          onClick={() => handleResetKey(conn)}
                          className={buttonClass}
                          title="Forget the trusted host key (use after the machine was reinstalled)"
                        >
                          <KenneyIcon name="key" size={12} />
                          <span>Reset Key</span>
                        </button>
                      )}
                      <button
                        onClick={() => handleRemove(conn)}
                        onBlur={() => setConfirmRemoveId((id) => (id === conn.id ? null : id))}
                        className={
                          confirmRemoveId === conn.id
                            ? 'h-7 px-2.5 rounded-md bg-red-950/60 hover:bg-red-900/70 border border-red-500/50 text-white font-medium text-xs cursor-pointer flex items-center gap-1.5 justify-center transition-colors'
                            : buttonClass
                        }
                        title="Remove this host from Rook (nothing on the remote machine is changed)"
                      >
                        <KenneyIcon name="trashcan" size={12} />
                        <span>{confirmRemoveId === conn.id ? 'Confirm Remove' : 'Remove'}</span>
                      </button>
                    </div>
                  </div>
                  {conn.keyPath && (
                    <div className="font-mono text-[var(--muted-foreground)] truncate" title={conn.keyPath}>
                      Key: {conn.keyPath}
                    </div>
                  )}
                  {conn.hostKeyFingerprint && (
                    <div className="font-mono text-[var(--muted-foreground)] truncate" title="Trusted host key fingerprint">
                      {conn.hostKeyFingerprint.startsWith('SHA256:') ? conn.hostKeyFingerprint : `SHA256:${conn.hostKeyFingerprint}`}
                    </div>
                  )}
                  {test && test.status !== 'testing' && (
                    <div
                      className={`flex items-start gap-1.5 ${test.status === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}
                      role={test.status === 'error' ? 'alert' : undefined}
                    >
                      <KenneyIcon name={test.status === 'ok' ? 'checkmark' : 'warning'} size={13} />
                      <span className="break-words min-w-0">{test.message}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};
