import React, { useEffect, useRef, useState } from 'react';
import { useExplorerStore } from '../store/useExplorerStore';
import { naturalCompare } from '../utils/naturalSort';
import { fsService } from '../services/fsService';
import { KenneyIcon } from './KenneyIcon';

interface TerminalEntry {
  id: string;
  cwd: string;
  gitBranch?: string | null;
  command: string;
  output?: string;
  error?: string;
  exitCode?: number;
  timedOut?: boolean;
  cancelled?: boolean;
  isRunning?: boolean;
}

interface AutocompleteSession {
  prefix: string;
  suffix: string;
  matches: string[];
  index: number;
  initialValue: string;
}

function getAutocompleteTarget(text: string, cursor: number) {
  const before = text.slice(0, cursor);

  // Check for unclosed quote
  let inDouble = false;
  let inSingle = false;
  let quoteStart = -1;

  for (let i = 0; i < before.length; i++) {
    const ch = before[i];
    if (ch === '"' && !inSingle) {
      if (!inDouble) {
        inDouble = true;
        quoteStart = i;
      } else {
        inDouble = false;
        quoteStart = -1;
      }
    } else if (ch === "'" && !inDouble) {
      if (!inSingle) {
        inSingle = true;
        quoteStart = i;
      } else {
        inSingle = false;
        quoteStart = -1;
      }
    }
  }

  let start = 0;
  let quoteChar: "'" | '"' | null = null;

  if (inDouble || inSingle) {
    quoteChar = inDouble ? '"' : "'";
    start = quoteStart;
  } else {
    // Find last whitespace before cursor
    const lastSpace = before.search(/\s[^\s]*$/);
    start = lastSpace === -1 ? 0 : lastSpace + 1;
  }

  const token = before.slice(start);
  return { start, end: cursor, token, quoteChar };
}

function parseToken(rawToken: string) {
  let token = rawToken;
  let quoteChar: "'" | '"' | null = null;

  if (token.startsWith('"')) {
    quoteChar = '"';
    token = token.slice(1);
    if (token.endsWith('"')) {
      token = token.slice(0, -1);
    }
  } else if (token.startsWith("'")) {
    quoteChar = "'";
    token = token.slice(1);
    if (token.endsWith("'")) {
      token = token.slice(0, -1);
    }
  }

  const lastSlash = Math.max(token.lastIndexOf('/'), token.lastIndexOf('\\'));
  let dirPart = '';
  let nameQuery = token;
  let sep = '\\';

  if (lastSlash !== -1) {
    dirPart = token.slice(0, lastSlash + 1);
    nameQuery = token.slice(lastSlash + 1);
    sep = token[lastSlash];
  }

  return { dirPart, nameQuery, sep, quoteChar };
}

function formatCandidate(
  cand: { name: string; isDirectory: boolean; isCommand?: boolean },
  dirPart: string,
  sep: string,
  quoteChar: "'" | '"' | null
): string {
  if (cand.isCommand) {
    return `${cand.name} `;
  }

  const trailingSlash = cand.isDirectory ? sep : '';
  const fullPath = `${dirPart}${cand.name}${trailingSlash}`;

  if (quoteChar) {
    return `${quoteChar}${fullPath}${quoteChar}`;
  }

  if (fullPath.includes(' ')) {
    return `'${fullPath}'`;
  }

  return fullPath;
}

async function getDirectoryCandidates(
  currentPath: string,
  dirPart: string,
  items: { name: string; isDirectory: boolean }[]
): Promise<{ name: string; isDirectory: boolean; isCommand?: boolean }[]> {
  if (!dirPart) {
    return items.map((i) => ({ name: i.name, isDirectory: i.isDirectory }));
  }

  let targetDir = dirPart;
  if (!(/^[a-zA-Z]:[\\/]/.test(targetDir) || targetDir.startsWith('\\\\'))) {
    const isBackslash = currentPath.includes('\\');
    const sep = isBackslash ? '\\' : '/';
    const base = currentPath.replace(/[\\/]+$/, '');
    targetDir = `${base}${sep}${dirPart}`;
  }

  try {
    const res = await fsService.listDirectory(targetDir, false);
    if (res && Array.isArray(res.items)) {
      return res.items.map((i) => ({ name: i.name, isDirectory: i.isDirectory }));
    }
  } catch {}
  return [];
}

export const TerminalDrawer: React.FC = () => {
  const { showTerminal, currentPath, items, gitBranch, toggleTerminal, navigateTo, refresh } =
    useExplorerStore();

  const [entries, setEntries] = useState<TerminalEntry[]>([
    {
      id: 'welcome',
      cwd: currentPath,
      gitBranch,
      command: '',
      output: 'Rook Integrated Shell (PowerShell)\nType any command and press Enter. Commands run in the active folder.',
      exitCode: 0,
    },
  ]);
  const [inputVal, setInputVal] = useState('');
  const [history, setHistory] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('rook_terminal_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [isRunning, setIsRunning] = useState(false);
  const [autocompleteSession, setAutocompleteSession] = useState<AutocompleteSession | null>(null);
  const [drawerHeight, setDrawerHeight] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem('rook_terminal_height'));
      if (saved && saved >= 100 && saved <= 600) return saved;
    } catch {}
    return 190;
  });

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isResizingRef = useRef(false);

  // Auto focus input whenever terminal opens or command completes
  useEffect(() => {
    if (showTerminal) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [showTerminal, isRunning]);

  // Auto-scroll to bottom when entries update
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, isRunning]);

  // Resize handling
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    const startY = e.clientY;
    const startH = drawerHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRef.current) return;
      const dy = startY - moveEvent.clientY;
      const nextH = Math.max(100, Math.min(600, startH + dy));
      setDrawerHeight(nextH);
      try {
        localStorage.setItem('rook_terminal_height', String(nextH));
      } catch {}
    };

    const onMouseUp = () => {
      isResizingRef.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  if (!showTerminal) return null;

  const handleClear = () => {
    setEntries([]);
  };

  const handleCancel = async () => {
    if (!isRunning) return;
    try {
      await fsService.cancelCommand();
    } catch {}
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setAutocompleteSession(null);
    const cmd = inputVal.trim();
    if (!cmd || isRunning) return;

    // Built-in commands
    if (cmd.toLowerCase() === 'clear' || cmd.toLowerCase() === 'cls') {
      setEntries([]);
      setInputVal('');
      setHistoryIndex(-1);
      return;
    }

    if (cmd.toLowerCase() === 'exit') {
      setInputVal('');
      toggleTerminal();
      return;
    }

    // Save to history
    const nextHistory = [cmd, ...history.filter((h) => h !== cmd)].slice(0, 100);
    setHistory(nextHistory);
    try {
      localStorage.setItem('rook_terminal_history', JSON.stringify(nextHistory));
    } catch {}
    setHistoryIndex(-1);

    const entryId = `${Date.now()}-${Math.random()}`;
    const newEntry: TerminalEntry = {
      id: entryId,
      cwd: currentPath,
      gitBranch,
      command: cmd,
      isRunning: true,
    };

    setEntries((prev) => [...prev, newEntry]);
    setInputVal('');
    setIsRunning(true);

    try {
      const res = await fsService.runCommand(cmd, currentPath);
      setEntries((prev) =>
        prev.map((item) =>
          item.id === entryId
            ? {
                ...item,
                output: res.output,
                error: res.error,
                exitCode: res.exitCode,
                timedOut: res.timedOut,
                cancelled: res.cancelled,
                isRunning: false,
              }
            : item
        )
      );

      // If directory changed via `cd`, navigate Rook to match
      if (res.cwd && res.cwd.toLowerCase() !== currentPath.toLowerCase()) {
        await navigateTo(res.cwd, false);
      } else {
        // Refresh items in case command created or modified files
        await refresh();
      }
    } catch (err: any) {
      setEntries((prev) =>
        prev.map((item) =>
          item.id === entryId
            ? {
                ...item,
                error: err.message || 'Failed to execute command',
                exitCode: 1,
                isRunning: false,
              }
            : item
        )
      );
    } finally {
      setIsRunning(false);
    }
  };

  const handleTabCompletion = async (isShift: boolean) => {
    // If an autocomplete session is active, cycle through matches
    if (autocompleteSession && autocompleteSession.matches.length > 0) {
      const { prefix, suffix, matches, index, initialValue } = autocompleteSession;
      const nextIndex = isShift
        ? (index - 1 + matches.length) % matches.length
        : (index + 1) % matches.length;

      const nextMatch = matches[nextIndex];
      const newVal = prefix + nextMatch + suffix;
      setInputVal(newVal);
      setAutocompleteSession({
        prefix,
        suffix,
        matches,
        index: nextIndex,
        initialValue,
      });

      requestAnimationFrame(() => {
        const cursor = prefix.length + nextMatch.length;
        inputRef.current?.setSelectionRange(cursor, cursor);
      });
      return;
    }

    // New autocomplete attempt
    const inputEl = inputRef.current;
    const cursor = inputEl?.selectionStart ?? inputVal.length;
    const target = getAutocompleteTarget(inputVal, cursor);
    const { dirPart, nameQuery, sep, quoteChar } = parseToken(target.token);

    let rawCandidates: { name: string; isDirectory: boolean; isCommand?: boolean }[] = [];

    if (!dirPart) {
      // Current folder items
      rawCandidates = items.map((i) => ({ name: i.name, isDirectory: i.isDirectory }));

      // If at start of command line, also include common command names
      if (target.start === 0) {
        const commands = [
          'git', 'npm', 'cargo', 'dotnet', 'python', 'node', 'cd', 'dir', 'cls', 'clear',
          'ls', 'cat', 'type', 'mkdir', 'rm', 'del', 'cp', 'mv', 'code', 'explorer', 'exit',
        ];
        for (const cmd of commands) {
          if (!rawCandidates.some((c) => c.name.toLowerCase() === cmd.toLowerCase())) {
            rawCandidates.push({ name: cmd, isDirectory: false, isCommand: true });
          }
        }
      }
    } else {
      // Relative or absolute path
      rawCandidates = await getDirectoryCandidates(currentPath, dirPart, items);
    }

    // Sort: directories first, then alphabetically
    rawCandidates.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return naturalCompare(a.name, b.name);
    });

    // Filter by name query
    const q = nameQuery.toLowerCase();
    const prefixMatches = rawCandidates.filter((c) => c.name.toLowerCase().startsWith(q));
    const fallbackMatches =
      q.length > 1
        ? rawCandidates.filter(
            (c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q)
          )
        : [];
    const filtered = [...prefixMatches, ...fallbackMatches];

    if (filtered.length === 0) {
      return;
    }

    const prefix = inputVal.slice(0, target.start);
    const suffix = inputVal.slice(target.end);
    const formattedMatches = filtered.map((c) => formatCandidate(c, dirPart, sep, quoteChar));

    const initialIndex = isShift ? formattedMatches.length - 1 : 0;
    const chosenMatch = formattedMatches[initialIndex];
    const newVal = prefix + chosenMatch + suffix;

    setInputVal(newVal);
    setAutocompleteSession({
      prefix,
      suffix,
      matches: formattedMatches,
      index: initialIndex,
      initialValue: inputVal,
    });

    requestAnimationFrame(() => {
      const newCursor = prefix.length + chosenMatch.length;
      inputRef.current?.setSelectionRange(newCursor, newCursor);
    });
  };

  const selectMatchIndex = (idx: number) => {
    if (!autocompleteSession) return;
    const { prefix, suffix, matches, initialValue } = autocompleteSession;
    const match = matches[idx];
    const newVal = prefix + match + suffix;
    setInputVal(newVal);
    setAutocompleteSession({
      prefix,
      suffix,
      matches,
      index: idx,
      initialValue,
    });
    requestAnimationFrame(() => {
      const cursor = prefix.length + match.length;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(cursor, cursor);
    });
  };

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      if (!isRunning) {
        await handleTabCompletion(e.shiftKey);
      }
      return;
    }

    if (e.key === 'Escape' && autocompleteSession) {
      e.preventDefault();
      setInputVal(autocompleteSession.initialValue);
      setAutocompleteSession(null);
      return;
    }

    if (!['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) {
      if (autocompleteSession) {
        setAutocompleteSession(null);
      }
    }

    if (e.ctrlKey && e.key.toLowerCase() === 'c') {
      if (isRunning) {
        e.preventDefault();
        handleCancel();
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const nextIdx = Math.min(history.length - 1, historyIndex + 1);
      setHistoryIndex(nextIdx);
      setInputVal(history[nextIdx] || '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex <= 0) {
        setHistoryIndex(-1);
        setInputVal('');
      } else {
        const nextIdx = historyIndex - 1;
        setHistoryIndex(nextIdx);
        setInputVal(history[nextIdx] || '');
      }
    }
  };

  return (
    <div
      style={{ height: `${drawerHeight}px` }}
      className="border-t border-[var(--border)] bg-[#0d1017] p-2.5 font-mono text-xs flex flex-col justify-between shrink-0 relative select-text"
      onClick={(e) => {
        // Focus input if user clicks empty background
        if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'DIV') {
          inputRef.current?.focus();
        }
      }}
    >
      {/* Top Resize Handle */}
      <div
        onMouseDown={startResize}
        title="Drag up/down to resize console"
        className="absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize hover:bg-sky-400/50 transition-colors z-20"
      />

      {/* Header Bar */}
      <div className="flex items-center justify-between text-[var(--muted-foreground)] border-b border-[var(--border)]/70 pb-1.5 mb-1.5 select-none">
        <div className="flex items-center gap-2 truncate">
          <KenneyIcon name="cpu" size={14} className="text-emerald-400" />
          <span className="font-semibold text-xs text-[var(--foreground)] tracking-tight">
            INTEGRATED SHELL
          </span>
          <span className="text-[11px] text-[var(--muted-foreground)] truncate">
            {currentPath} {gitBranch && <span className="text-sky-400">({gitBranch})</span>}
          </span>
          {isRunning && (
            <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[10px] animate-pulse">
              Running...
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isRunning ? (
            <button
              type="button"
              onClick={handleCancel}
              className="h-7 px-2.5 rounded-md bg-red-600/30 hover:bg-red-600/50 text-red-200 border border-red-500/40 text-xs cursor-pointer flex items-center gap-1.5 transition-colors"
              title="Stop current command (Ctrl+C)"
            >
              <KenneyIcon name="cross" size={11} />
              <span>Stop</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleClear}
              className="h-7 px-2.5 rounded-md hover:bg-white/[0.08] text-[var(--muted-foreground)] hover:text-[var(--foreground)] text-xs cursor-pointer flex items-center justify-center transition-colors"
              title="Clear terminal output (cls)"
            >
              Clear
            </button>
          )}

          <button
            type="button"
            onClick={() => fsService.openPowershell(currentPath)}
            className="h-7 px-2.5 rounded-md hover:bg-white/[0.08] text-[var(--muted-foreground)] hover:text-[var(--foreground)] text-xs cursor-pointer flex items-center gap-1.5 transition-colors"
            title="Launch external PowerShell window in current path (Ctrl+T)"
          >
            <KenneyIcon name="campfire" size={13} />
            <span className="hidden sm:inline">External</span>
          </button>

          <button
            type="button"
            onClick={toggleTerminal}
            className="w-7 h-7 rounded-md hover:bg-white/[0.08] opacity-70 hover:opacity-100 cursor-pointer flex items-center justify-center text-[var(--foreground)] transition-colors"
            title="Close Terminal (`)"
          >
            <KenneyIcon name="cross" size={13} />
          </button>
        </div>
      </div>

      {/* Output Scroll Area */}
      <div ref={scrollRef} className="space-y-2 overflow-y-auto flex-1 pr-1 text-xs leading-relaxed">
        {entries.map((entry) => (
          <div key={entry.id} className="space-y-0.5">
            {entry.command && (
              <div className="flex items-start gap-1.5 text-slate-300">
                <span className="text-emerald-400 select-none">{entry.cwd}</span>
                {entry.gitBranch && (
                  <span className="text-sky-400 select-none">({entry.gitBranch})</span>
                )}
                <span className="text-slate-500 select-none">&gt;</span>
                <span className="font-semibold text-[var(--foreground)]/85">{entry.command}</span>
              </div>
            )}

            {entry.isRunning && (
              <div className="text-[var(--muted-foreground)] text-[11px] flex items-center gap-1.5 pl-2 animate-pulse">
                <span>Executing...</span>
              </div>
            )}

            {entry.output && (
              <pre className="font-mono text-[11px] text-slate-200 whitespace-pre-wrap pl-2 border-l border-slate-700/50 break-words leading-tight">
                {entry.output}
              </pre>
            )}

            {entry.error && (
              <pre className="font-mono text-[11px] text-rose-400 whitespace-pre-wrap pl-2 border-l border-rose-500/50 break-words leading-tight">
                {entry.error}
              </pre>
            )}

            {entry.cancelled && (
              <div className="text-amber-400 text-[10px] pl-2 font-sans">[Command cancelled by user]</div>
            )}
            {entry.timedOut && (
              <div className="text-amber-400 text-[10px] pl-2 font-sans">[Command timed out]</div>
            )}
            {entry.exitCode !== undefined && entry.exitCode !== 0 && !entry.cancelled && (
              <div className="text-rose-400 text-[10px] pl-2 font-mono">
                [Process exited with code {entry.exitCode}]
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Autocomplete Suggestions Pill Bar */}
      {autocompleteSession && autocompleteSession.matches.length > 1 && (
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1 text-[11px] bg-black/40 px-2 rounded-md border border-sky-500/30 shrink-0 mt-1 select-none">
          <span className="text-[10px] text-sky-400 font-mono shrink-0">
            {autocompleteSession.index + 1}/{autocompleteSession.matches.length}
          </span>
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
            {autocompleteSession.matches.map((m, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => selectMatchIndex(idx)}
                className={`px-1.5 py-0.5 rounded text-[11px] font-mono whitespace-nowrap cursor-pointer transition-colors ${
                  idx === autocompleteSession.index
                    ? 'bg-sky-500/30 text-sky-200 border border-sky-400/50 font-semibold shadow-sm'
                    : 'hover:bg-white/[0.08] text-slate-400'
                }`}
                title="Click to select this match"
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Active Command Input Line */}
      <form onSubmit={handleSubmit} className="flex items-center gap-1.5 pt-1.5 border-t border-[var(--border)]/40 mt-1 shrink-0">
        <span className="text-emerald-400 select-none text-[11px] truncate max-w-[220px]">
          {currentPath.split(/[\\/]/).filter(Boolean).pop() || currentPath}
        </span>
        <span className="text-slate-500 select-none">&gt;</span>
        <input
          ref={inputRef}
          type="text"
          value={inputVal}
          onChange={(e) => {
            setInputVal(e.target.value);
            if (autocompleteSession) {
              setAutocompleteSession(null);
            }
          }}
          onKeyDown={handleKeyDown}
          disabled={isRunning}
          placeholder={isRunning ? 'Command is running (Ctrl+C to cancel)...' : 'Type a command, e.g. dir, git status, cargo build... (Tab to autocomplete, cls to clear)'}
          className="flex-1 bg-transparent text-xs text-[var(--foreground)] font-mono outline-none placeholder:text-[var(--muted-foreground)]/50 disabled:opacity-50"
        />
        {isRunning && (
          <span className="w-2 h-3.5 bg-amber-400 animate-pulse inline-block shrink-0" />
        )}
      </form>
    </div>
  );
};

