import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createUsdRuntimeStartupPrewarmHandler,
  scheduleUsdRuntimeStartupIdlePrewarm,
  shouldSkipUsdRuntimeStartupIdlePrewarm,
} from './usdRuntimeStartupPrewarm.ts';

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

test('USD runtime startup prewarm warms both runtime lanes once', () => {
  let mainThreadRuntimePrewarmCalls = 0;
  let offscreenRuntimePrewarmCalls = 0;

  const prewarm = createUsdRuntimeStartupPrewarmHandler({
    prewarmMainThreadRuntime: () => {
      mainThreadRuntimePrewarmCalls += 1;
    },
    prewarmOffscreenRuntime: () => {
      offscreenRuntimePrewarmCalls += 1;
    },
  });

  prewarm();
  prewarm();

  assert.equal(mainThreadRuntimePrewarmCalls, 1);
  assert.equal(offscreenRuntimePrewarmCalls, 1);
});

test('scheduleUsdRuntimeStartupIdlePrewarm waits for delay and idle before prewarming', () => {
  const harness = createScheduler();
  let prewarmCalls = 0;

  scheduleUsdRuntimeStartupIdlePrewarm({
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
  assert.equal(prewarmCalls, 0);
  assert.deepEqual(harness.counts(), { timeouts: 0, idleCallbacks: 1 });
  assert.equal(harness.flushNextIdle(), true);
  assert.equal(prewarmCalls, 1);
});

test('scheduleUsdRuntimeStartupIdlePrewarm waits for page load before the background delay', () => {
  const harness = createScheduler();
  const loadHarness = createLoadTarget();
  let prewarmCalls = 0;

  scheduleUsdRuntimeStartupIdlePrewarm({
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

test('scheduleUsdRuntimeStartupIdlePrewarm also waits for load from interactive state', () => {
  const harness = createScheduler();
  const loadHarness = createLoadTarget();
  let prewarmCalls = 0;

  scheduleUsdRuntimeStartupIdlePrewarm({
    connection: null,
    document: { readyState: 'interactive', visibilityState: 'visible' },
    loadTarget: loadHarness.loadTarget,
    prewarm: () => {
      prewarmCalls += 1;
    },
    scheduler: harness.scheduler,
  });

  assert.deepEqual(harness.counts(), { timeouts: 0, idleCallbacks: 0 });
  assert.equal(loadHarness.fireLoad(), true);
  assert.equal(harness.flushNextTimeout(), true);
  assert.equal(harness.flushNextIdle(), true);
  assert.equal(prewarmCalls, 1);
});

test('scheduleUsdRuntimeStartupIdlePrewarm cancellation before page load prevents scheduling', () => {
  const harness = createScheduler();
  const loadHarness = createLoadTarget();
  let prewarmCalls = 0;

  const cancel = scheduleUsdRuntimeStartupIdlePrewarm({
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

test('scheduleUsdRuntimeStartupIdlePrewarm skips save-data and slow network connections', () => {
  assert.equal(shouldSkipUsdRuntimeStartupIdlePrewarm({ saveData: true }), true);
  assert.equal(shouldSkipUsdRuntimeStartupIdlePrewarm({ effectiveType: '2g' }), true);
  assert.equal(shouldSkipUsdRuntimeStartupIdlePrewarm({ effectiveType: 'slow-2g' }), true);
  assert.equal(shouldSkipUsdRuntimeStartupIdlePrewarm({ effectiveType: '4g' }), false);

  const harness = createScheduler();
  let prewarmCalls = 0;

  scheduleUsdRuntimeStartupIdlePrewarm({
    connection: { saveData: true },
    prewarm: () => {
      prewarmCalls += 1;
    },
    scheduler: harness.scheduler,
  });

  assert.deepEqual(harness.counts(), { timeouts: 0, idleCallbacks: 0 });
  assert.equal(prewarmCalls, 0);
});

test('scheduleUsdRuntimeStartupIdlePrewarm cancels pending background prewarm', () => {
  const harness = createScheduler();
  let prewarmCalls = 0;

  const cancel = scheduleUsdRuntimeStartupIdlePrewarm({
    connection: null,
    prewarm: () => {
      prewarmCalls += 1;
    },
    scheduler: harness.scheduler,
  });

  cancel();

  assert.equal(harness.flushNextTimeout(), false);
  assert.equal(harness.flushNextIdle(), false);
  assert.equal(prewarmCalls, 0);
});

test('scheduleUsdRuntimeStartupIdlePrewarm skips when the page is hidden before idle', () => {
  const harness = createScheduler();
  let prewarmCalls = 0;

  scheduleUsdRuntimeStartupIdlePrewarm({
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
