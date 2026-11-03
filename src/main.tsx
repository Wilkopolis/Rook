import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installInstrumentation } from './services/instrumentation';
import { logger } from './services/logger';
import { useExplorerStore } from './store/useExplorerStore';
import './index.css';

installInstrumentation(useExplorerStore);

ReactDOM.createRoot(document.getElementById('root')!, {
  onUncaughtError: (error, info) => {
    logger.fatal('react-uncaught', `Uncaught React error: ${(error as Error)?.message ?? error}`, {
      error,
      componentStack: info.componentStack,
    });
  },
  onRecoverableError: (error, info) => {
    logger.warn('react-recoverable', `Recoverable React error: ${(error as Error)?.message ?? error}`, {
      componentStack: info.componentStack,
    });
  },
}).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
