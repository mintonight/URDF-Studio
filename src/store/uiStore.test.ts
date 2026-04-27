import test from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';

type UIStoreModule = typeof import('./uiStore.ts');
const UI_STORE_PERSIST_VERSION = 17;

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });

  (globalThis as { window?: Window }).window = dom.window as unknown as Window;
  (globalThis as { document?: Document }).document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: dom.window.localStorage,
    configurable: true,
  });

  Object.defineProperty(dom.window, 'matchMedia', {
    value: () => ({
      matches: false,
      media: '',
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
    configurable: true,
  });

  return dom;
}

async function loadUIStore(
  seedState?: Record<string, unknown>,
  seedVersion = UI_STORE_PERSIST_VERSION,
) {
  const dom = installDom();

  if (seedState) {
    dom.window.localStorage.setItem(
      'urdf-studio-ui',
      JSON.stringify({
        state: seedState,
        version: seedVersion,
      }),
    );
  }

  const moduleUrl = new URL(`./uiStore.ts?test=${Date.now()}-${Math.random()}`, import.meta.url);
  const uiStoreModule = (await import(moduleUrl.href)) as UIStoreModule;

  await uiStoreModule.useUIStore.persist.rehydrate();

  return {
    dom,
    useUIStore: uiStoreModule.useUIStore,
  };
}

test('view options restore persisted world-origin axes and usage-guide preferences', async () => {
  const { dom, useUIStore } = await loadUIStore({
    viewOptions: {
      showGrid: true,
      showAxes: false,
      showMjcfWorldLink: true,
      showJointAxes: false,
      showInertia: false,
      showCenterOfMass: false,
      showCollision: false,
      showUsageGuide: false,
      modelOpacity: 0.42,
    },
  });

  const state = useUIStore.getState();
  assert.equal(state.viewOptions.showAxes, false);
  assert.equal(state.viewOptions.showMjcfWorldLink, true);
  assert.equal(state.viewOptions.showUsageGuide, false);
  assert.equal(state.viewOptions.modelOpacity, 0.42);

  dom.window.close();
});

test('MJCF world visibility defaults to visible for fresh sessions', async () => {
  const { dom, useUIStore } = await loadUIStore();

  const state = useUIStore.getState();
  assert.equal(state.viewOptions.showMjcfWorldLink, true);
  assert.equal(state.viewOptions.showIkHandles, false);

  dom.window.close();
});

test('setViewOption persists world-origin axes and usage-guide preferences', async () => {
  const { dom, useUIStore } = await loadUIStore();

  const state = useUIStore.getState();
  state.setViewOption('showAxes', false);
  state.setViewOption('showMjcfWorldLink', true);
  state.setViewOption('showUsageGuide', false);
  state.setViewOption('modelOpacity', 0.42);

  const raw = dom.window.localStorage.getItem('urdf-studio-ui');
  assert.ok(raw, 'persisted ui store payload should be written');

  const persisted = JSON.parse(raw) as {
    state?: {
      viewOptions?: {
        showAxes?: boolean;
        showMjcfWorldLink?: boolean;
        showUsageGuide?: boolean;
        modelOpacity?: number;
      };
    };
  };

  assert.equal(persisted.state?.viewOptions?.showAxes, false);
  assert.equal(persisted.state?.viewOptions?.showMjcfWorldLink, true);
  assert.equal(persisted.state?.viewOptions?.showUsageGuide, false);
  assert.equal(persisted.state?.viewOptions?.modelOpacity, 0.42);

  dom.window.close();
});

test('migration resets legacy MJCF world-link visibility to visible default', async () => {
  const { dom, useUIStore } = await loadUIStore(
    {
      viewOptions: {
        showGrid: true,
        showAxes: true,
        showUsageGuide: true,
        showMjcfWorldLink: true,
        showJointAxes: false,
        showInertia: false,
        showCenterOfMass: false,
        showCollision: false,
        modelOpacity: 1,
      },
    },
    13,
  );

  const state = useUIStore.getState();
  assert.equal(state.viewOptions.showMjcfWorldLink, true);

  const raw = dom.window.localStorage.getItem('urdf-studio-ui');
  assert.ok(raw, 'persisted ui store payload should be written');
  const persisted = JSON.parse(raw) as {
    state?: {
      viewOptions?: {
        showMjcfWorldLink?: boolean;
      };
    };
    version?: number;
  };

  assert.equal(persisted.version, UI_STORE_PERSIST_VERSION);
  assert.equal(persisted.state?.viewOptions?.showMjcfWorldLink, true);

  dom.window.close();
});

test('migration resets legacy IK handle visibility to the hidden default', async () => {
  const { dom, useUIStore } = await loadUIStore(
    {
      viewOptions: {
        showGrid: true,
        showAxes: true,
        showUsageGuide: true,
        showMjcfWorldLink: false,
        showIkHandles: true,
        showJointAxes: false,
        showInertia: false,
        showCenterOfMass: false,
        showCollision: false,
        modelOpacity: 1,
      },
    },
    14,
  );

  const state = useUIStore.getState();
  assert.equal(state.viewOptions.showIkHandles, false);

  const raw = dom.window.localStorage.getItem('urdf-studio-ui');
  assert.ok(raw, 'persisted ui store payload should be written');
  const persisted = JSON.parse(raw) as {
    state?: {
      viewOptions?: {
        showIkHandles?: boolean;
      };
    };
    version?: number;
  };

  assert.equal(persisted.version, UI_STORE_PERSIST_VERSION);
  assert.equal(persisted.state?.viewOptions?.showIkHandles, false);

  dom.window.close();
});

test('source code auto-apply restores from persisted settings and writes updates back', async () => {
  const { dom, useUIStore } = await loadUIStore({
    sourceCodeAutoApply: false,
  });

  assert.equal(useUIStore.getState().sourceCodeAutoApply, false);

  useUIStore.getState().setSourceCodeAutoApply(true);

  const raw = dom.window.localStorage.getItem('urdf-studio-ui');
  assert.ok(raw, 'persisted ui store payload should be written');

  const persisted = JSON.parse(raw) as {
    state?: {
      sourceCodeAutoApply?: boolean;
    };
  };

  assert.equal(persisted.state?.sourceCodeAutoApply, true);

  dom.window.close();
});
