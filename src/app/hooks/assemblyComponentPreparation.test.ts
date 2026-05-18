import assert from 'node:assert/strict';
import test from 'node:test';

import type { AssemblyComponent } from '@/types';

import {
  activateAssemblyComponentSelection,
  buildAssemblyComponentPreparationOverlayState,
} from './assemblyComponentPreparation.ts';

const t = {
  addingAssemblyComponentToWorkspace: 'Adding component',
  groundingAssemblyComponent: 'Grounding component',
  loadingRobot: 'Loading robot',
  preparingAssemblyComponent: 'Preparing component',
};

function createComponent(rootLinkId = 'comp_demo/base_link'): AssemblyComponent {
  return {
    id: 'comp_demo',
    name: 'Demo',
    sourceFile: 'demo.urdf',
    robot: {
      name: 'demo',
      rootLinkId,
      links: {},
      joints: {},
    },
    visible: true,
  };
}

test('buildAssemblyComponentPreparationOverlayState returns prepare stage state', () => {
  const state = buildAssemblyComponentPreparationOverlayState(
    { name: 'robots/demo/model.usd', format: 'usd', content: '' },
    'prepare',
    t,
  );

  assert.deepEqual(state, {
    label: 'Loading robot',
    detail: 'model.usd',
    progress: 0.36,
    statusLabel: '1/3',
    stageLabel: 'Preparing component',
  });
});

test('buildAssemblyComponentPreparationOverlayState returns ground stage state', () => {
  const state = buildAssemblyComponentPreparationOverlayState(
    { name: 'demo.urdf', format: 'urdf', content: '' },
    'ground',
    t,
  );

  assert.deepEqual(state, {
    label: 'Loading robot',
    detail: 'demo.urdf',
    progress: 0.92,
    statusLabel: '3/3',
    stageLabel: 'Grounding component',
  });
});

test('activateAssemblyComponentSelection selects the inserted component before deferred focus', () => {
  const calls: string[] = [];
  const deferredCallbacks: Array<() => void> = [];

  activateAssemblyComponentSelection(createComponent(), {
    setSelection: () => calls.push('clear-selection'),
    selectComponent: (id) => calls.push(`select:${id}`),
    focusOn: (id) => calls.push(`focus:${id}`),
    deferFocus: (callback) => deferredCallbacks.push(callback),
  });

  assert.deepEqual(calls, ['clear-selection', 'select:comp_demo']);
  assert.equal(deferredCallbacks.length, 1);

  deferredCallbacks[0]!();

  assert.deepEqual(calls, ['clear-selection', 'select:comp_demo', 'focus:comp_demo/base_link']);
});
