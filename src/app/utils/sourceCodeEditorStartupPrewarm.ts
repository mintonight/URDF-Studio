import { logRuntimeFailure } from '@/core/utils/runtimeDiagnostics';

import {
  schedulePostReadyBackgroundTask,
  type PostReadyBackgroundTaskScheduler,
} from './postReadyBackgroundTask';
import { loadSourceCodeEditorRuntime } from './sourceCodeEditorLoader';

interface NetworkInformationLike {
  effectiveType?: string;
  saveData?: boolean;
}

interface DocumentVisibilityLike {
  readyState?: DocumentReadyState;
  visibilityState?: DocumentVisibilityState;
}

interface WindowLoadTargetLike {
  addEventListener: (type: 'load', listener: () => void, options?: { once?: boolean }) => void;
  removeEventListener: (type: 'load', listener: () => void) => void;
}

interface SourceCodeEditorStartupIdlePrewarmOptions {
  connection?: NetworkInformationLike | null;
  delayMs?: number;
  document?: DocumentVisibilityLike | null;
  idleTimeoutMs?: number;
  loadTarget?: WindowLoadTargetLike | null;
  prewarm?: () => void;
  scheduler?: PostReadyBackgroundTaskScheduler;
}

interface SourceCodeEditorRuntimeModule {
  preloadMonacoEditorWorker: () => Promise<void>;
}

interface SourceCodeEditorBackgroundPrewarmDependencies {
  loadRuntime: () => Promise<readonly [unknown, SourceCodeEditorRuntimeModule]>;
  logFailure?: typeof logRuntimeFailure;
}

// Give the heavier startup work (3D scene, USD runtime prewarm, initial robot
// load) a head start before we pull the multi-megabyte Monaco chunk, so the
// prewarm never competes with first paint — including on browsers without
// requestIdleCallback, where the post-ready task falls back to a plain timeout.
export const SOURCE_CODE_EDITOR_PREWARM_DELAY_MS = 1_500;

/**
 * Build a background prewarm that downloads the Monaco chunks and initializes the
 * Monaco instance ahead of the first "view source" click. Opening the editor is
 * otherwise a cold load of a multi-megabyte chunk plus a `loader.init()`
 * round-trip — a multi-second wait the first time per page load. A rejected
 * runtime import resets the cached promise so a transient idle-prewarm failure
 * can be retried by a later call (and never poisons a user-initiated open).
 */
export function createSourceCodeEditorBackgroundPrewarm({
  loadRuntime,
  logFailure = logRuntimeFailure,
}: SourceCodeEditorBackgroundPrewarmDependencies): () => void {
  let prewarmPromise: Promise<void> | null = null;

  return () => {
    if (prewarmPromise) {
      return;
    }

    prewarmPromise = loadRuntime()
      .then(([, codeEditorModule]) => codeEditorModule.preloadMonacoEditorWorker())
      .then(() => undefined)
      .catch((error) => {
        prewarmPromise = null;
        logFailure('prewarmSourceCodeEditorRuntimeInBackground', error, 'warn');
      });
  };
}

const prewarmSourceCodeEditorRuntimeInBackgroundImpl = createSourceCodeEditorBackgroundPrewarm({
  loadRuntime: loadSourceCodeEditorRuntime,
});

export function prewarmSourceCodeEditorRuntimeInBackground(): void {
  prewarmSourceCodeEditorRuntimeInBackgroundImpl();
}

function getNavigatorConnection(): NetworkInformationLike | null {
  if (typeof navigator === 'undefined') {
    return null;
  }

  return (navigator as Navigator & { connection?: NetworkInformationLike }).connection ?? null;
}

function getDocumentVisibility(): DocumentVisibilityLike | null {
  if (typeof document === 'undefined') {
    return null;
  }

  return document;
}

function getWindowLoadTarget(): WindowLoadTargetLike | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return {
    addEventListener: (type, listener, options) => {
      window.addEventListener(type, listener, options);
    },
    removeEventListener: (type, listener) => {
      window.removeEventListener(type, listener);
    },
  };
}

export function shouldSkipSourceCodeEditorStartupIdlePrewarm(
  connection: NetworkInformationLike | null | undefined,
): boolean {
  if (connection?.saveData) {
    return true;
  }

  return connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g';
}

export function scheduleSourceCodeEditorStartupIdlePrewarm({
  connection = getNavigatorConnection(),
  delayMs = SOURCE_CODE_EDITOR_PREWARM_DELAY_MS,
  document: visibilityDocument = getDocumentVisibility(),
  idleTimeoutMs,
  loadTarget = getWindowLoadTarget(),
  prewarm = prewarmSourceCodeEditorRuntimeInBackground,
  scheduler,
}: SourceCodeEditorStartupIdlePrewarmOptions = {}): () => void {
  if (shouldSkipSourceCodeEditorStartupIdlePrewarm(connection)) {
    return () => {};
  }

  const schedulePrewarm = () =>
    schedulePostReadyBackgroundTask(
      () => {
        if (visibilityDocument?.visibilityState === 'hidden') {
          return;
        }

        prewarm();
      },
      {
        delayMs,
        idleTimeoutMs,
        scheduler,
      },
    );

  if (
    visibilityDocument?.readyState &&
    visibilityDocument.readyState !== 'complete' &&
    loadTarget
  ) {
    let cancelScheduledPrewarm: (() => void) | null = null;
    const handleLoad = () => {
      cancelScheduledPrewarm = schedulePrewarm();
    };

    loadTarget.addEventListener('load', handleLoad, { once: true });

    return () => {
      loadTarget.removeEventListener('load', handleLoad);
      cancelScheduledPrewarm?.();
    };
  }

  return schedulePrewarm();
}
