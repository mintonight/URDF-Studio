import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSourceCodeEditorBackgroundPrewarm,
  scheduleSourceCodeEditorStartupIdlePrewarm,
  shouldSkipSourceCodeEditorStartupIdlePrewarm,
} from './sourceCodeEditorStartupPrewarm.ts';

async function flushAsyncCatchHandlers(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createScheduler() {
  let nextHandle = 1;
  const timeouts = new Map<number, () => void>();
  const idleCallbacks = new Map<number, () => void>();

  return {
    scheduler: {
      setTimeout(callback: () => void) {
        const handle = nextHandle++;
        timeouts.set(handle, callback);
        return handle;
      },
      clearTimeout(handle: number) {
        timeouts.delete(handle);
      },
      requestIdleCallback(callback: () => void) {
        const handle = nextHandle++;
        idleCallbacks.set(handle, callback);
        return handle;
      },
      cancelIdleCallback(handle: number) {
        idleCallbacks.delete(handle);
      },
    },
    flushNextTimeout() {
      const [handle, callback] = timeouts.entries().next().value ?? [];
      if (!handle || !callback) return false;
      timeouts.delete(handle);
      callback();
      return true;
    },
    flushNextIdle() {
      const [handle, callback] = idleCallbacks.entries().next().value ?? [];
      if (!handle || !callback) return false;
      idleCallbacks.delete(handle);
      callback();
      return true;
    },
    counts() {
      return {
        timeouts: timeouts.size,
        idleCallbacks: idleCallbacks.size,
      };
    },
  };
}

function createLoadTarget() {
  let loadListener: (() => void) | null = null;

  return {
    loadTarget: {
      addEventListener(type: 'load', listener: () => void) {
        assert.equal(type, 'load');
        loadListener = listener;
      },
      removeEventListener(type: 'load', listener: () => void) {
        assert.equal(type, 'load');
        if (loadListener === listener) {
          loadListener = null;
        }
      },
    },
    fireLoad() {
      if (!loadListener) return false;
      const listener = loadListener;
      loadListener = null;
      listener();
      return true;
    },
    listenerCount() {
      return loadListener ? 1 : 0;
    },
  };
}

test('source code editor startup prewarm waits for delay and idle before prewarming', () => {
  const harness = createScheduler();
  let prewarmCalls = 0;

  scheduleSourceCodeEditorStartupIdlePrewarm({
    connection: null,
    document: { visibilityState: 'visible' },
    prewarm: () => {
      prewarmCalls += 1;
    },
    scheduler: harness.scheduler,
  });

  assert.equal(prewarmCalls, 0);
  assert.deepEqual(harness.counts(), { timeouts: 1, idleCallbacks: 0 });
  assert.equal(harness.flushNextTimeout(), true);
  assert.deepEqual(harness.counts(), { timeouts: 0, idleCallbacks: 1 });
  assert.equal(harness.flushNextIdle(), true);
  assert.equal(prewarmCalls, 1);
});

test('source code editor startup prewarm waits for page load before the background delay', () => {
  const harness = createScheduler();
  const loadHarness = createLoadTarget();
  let prewarmCalls = 0;

  scheduleSourceCodeEditorStartupIdlePrewarm({
    connection: null,
    document: { readyState: 'loading', visibilityState: 'visible' },
    loadTarget: loadHarness.loadTarget,
    prewarm: () => {
      prewarmCalls += 1;
    },
    scheduler: harness.scheduler,
  });

  assert.equal(loadHarness.listenerCount(), 1);
  assert.deepEqual(harness.counts(), { timeouts: 0, idleCallbacks: 0 });
  assert.equal(loadHarness.fireLoad(), true);
  assert.equal(loadHarness.listenerCount(), 0);
  assert.deepEqual(harness.counts(), { timeouts: 1, idleCallbacks: 0 });
  assert.equal(harness.flushNextTimeout(), true);
  assert.equal(harness.flushNextIdle(), true);
  assert.equal(prewarmCalls, 1);
});

test('source code editor startup prewarm cancellation before page load prevents scheduling', () => {
  const harness = createScheduler();
  const loadHarness = createLoadTarget();
  let prewarmCalls = 0;

  const cancel = scheduleSourceCodeEditorStartupIdlePrewarm({
    connection: null,
    document: { readyState: 'loading', visibilityState: 'visible' },
    loadTarget: loadHarness.loadTarget,
    prewarm: () => {
      prewarmCalls += 1;
    },
    scheduler: harness.scheduler,
  });

  cancel();

  assert.equal(loadHarness.listenerCount(), 0);
  assert.equal(loadHarness.fireLoad(), false);
  assert.deepEqual(harness.counts(), { timeouts: 0, idleCallbacks: 0 });
  assert.equal(prewarmCalls, 0);
});

test('source code editor startup prewarm skips save-data and slow network connections', () => {
  assert.equal(shouldSkipSourceCodeEditorStartupIdlePrewarm({ saveData: true }), true);
  assert.equal(shouldSkipSourceCodeEditorStartupIdlePrewarm({ effectiveType: '2g' }), true);
  assert.equal(shouldSkipSourceCodeEditorStartupIdlePrewarm({ effectiveType: 'slow-2g' }), true);
  assert.equal(shouldSkipSourceCodeEditorStartupIdlePrewarm({ effectiveType: '4g' }), false);

  const harness = createScheduler();
  let prewarmCalls = 0;

  scheduleSourceCodeEditorStartupIdlePrewarm({
    connection: { saveData: true },
    prewarm: () => {
      prewarmCalls += 1;
    },
    scheduler: harness.scheduler,
  });

  assert.deepEqual(harness.counts(), { timeouts: 0, idleCallbacks: 0 });
  assert.equal(prewarmCalls, 0);
});

test('source code editor startup prewarm skips when the page is hidden before idle', () => {
  const harness = createScheduler();
  let prewarmCalls = 0;

  scheduleSourceCodeEditorStartupIdlePrewarm({
    connection: null,
    document: { visibilityState: 'hidden' },
    prewarm: () => {
      prewarmCalls += 1;
    },
    scheduler: harness.scheduler,
  });

  assert.equal(harness.flushNextTimeout(), true);
  assert.equal(harness.flushNextIdle(), true);
  assert.equal(prewarmCalls, 0);
});

test('source code editor startup prewarm cancels a queued background task', () => {
  const harness = createScheduler();
  let prewarmCalls = 0;

  const cancel = scheduleSourceCodeEditorStartupIdlePrewarm({
    connection: null,
    document: { visibilityState: 'visible' },
    prewarm: () => {
      prewarmCalls += 1;
    },
    scheduler: harness.scheduler,
  });

  // The delay timeout is queued but not yet flushed; cancelling must drop it.
  assert.deepEqual(harness.counts(), { timeouts: 1, idleCallbacks: 0 });
  cancel();
  assert.deepEqual(harness.counts(), { timeouts: 0, idleCallbacks: 0 });
  assert.equal(harness.flushNextTimeout(), false);
  assert.equal(harness.flushNextIdle(), false);
  assert.equal(prewarmCalls, 0);
});

test('source code editor background prewarm warms the runtime once', async () => {
  let loadAttempts = 0;
  let workerWarmups = 0;

  const prewarm = createSourceCodeEditorBackgroundPrewarm({
    loadRuntime: async () => {
      loadAttempts += 1;
      return [
        {},
        {
          preloadMonacoEditorWorker: async () => {
            workerWarmups += 1;
          },
        },
      ] as const;
    },
  });

  prewarm();
  prewarm();
  await flushAsyncCatchHandlers();

  assert.equal(loadAttempts, 1);
  assert.equal(workerWarmups, 1);
});

test('source code editor background prewarm resets and retries after a failed import', async () => {
  const error = new Error('chunk load failed');
  const failures: unknown[] = [];
  let loadAttempts = 0;

  const prewarm = createSourceCodeEditorBackgroundPrewarm({
    loadRuntime: async () => {
      loadAttempts += 1;
      if (loadAttempts === 1) {
        throw error;
      }
      return [{}, { preloadMonacoEditorWorker: async () => {} }] as const;
    },
    logFailure: (_scope, failure) => {
      failures.push(failure);
      return failure instanceof Error ? failure : new Error(String(failure));
    },
  });

  prewarm();
  await flushAsyncCatchHandlers();
  // First attempt rejected and reset the cached promise; a later call retries.
  prewarm();
  await flushAsyncCatchHandlers();

  assert.equal(loadAttempts, 2);
  assert.deepEqual(failures, [error]);
});
