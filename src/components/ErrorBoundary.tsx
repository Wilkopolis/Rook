import React from 'react';
import { logger } from '../services/logger';
import { fsService } from '../services/fsService';

interface State {
  error: Error | null;
}

/** Catches render/lifecycle crashes so the window shows a recovery screen (and logs it) instead of going blank. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    logger.fatal('react-crash', `UI crashed while rendering: ${error.message}`, {
      error,
      componentStack: info.componentStack,
    });
  }

  private reset = () => {
    logger.action('crash screen: try again');
    this.setState({ error: null });
  };

  private reload = () => {
    logger.action('crash screen: reload');
    void logger.flush(true).finally(() => window.location.reload());
  };

  private openLogs = () => {
    void fsService.openLogFolder().catch(() => {});
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[var(--background)] text-[var(--foreground)] p-6">
        <div className="max-w-lg w-full space-y-4 rounded-xl border border-red-500/40 bg-red-950/20 p-5 text-xs">
          <h1 className="text-sm font-semibold text-red-300">Rook hit an unexpected error</h1>
          <p className="opacity-80">
            The error has been written to the Rook log. You can try to continue, or reload the window.
          </p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 font-mono text-[11px] text-red-200">
            {error.message}
          </pre>
          <div className="flex gap-2 justify-end">
            <button onClick={this.openLogs} className="h-8 px-3 rounded-md border border-[var(--foreground)]/20 hover:bg-[var(--foreground)]/10 cursor-pointer">
              Open log folder
            </button>
            <button onClick={this.reset} className="h-8 px-3 rounded-md border border-[var(--foreground)]/20 hover:bg-[var(--foreground)]/10 cursor-pointer">
              Try again
            </button>
            <button onClick={this.reload} className="h-8 px-3 rounded-md bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90 cursor-pointer">
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
