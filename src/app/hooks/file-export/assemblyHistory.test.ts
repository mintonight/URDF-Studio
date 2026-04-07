import assert from 'node:assert/strict';
import test from 'node:test';

import { enablePatches, produceWithPatches } from 'immer';

import type { AssemblyState } from '@/types';

import { materializeAssemblyHistorySnapshots } from './assemblyHistory.ts';

enablePatches();

function createAssemblyState(name: string): AssemblyState {
  return {
    name,
    components: {},
    bridges: {},
  };
}

test('materializeAssemblyHistorySnapshots resolves mixed patch and snapshot history', () => {
  const initial = createAssemblyState('initial');
  const [present, redoPatches, undoPatches] = produceWithPatches(initial, (draft) => {
    draft.name = 'present';
  });
  const futureSnapshot = createAssemblyState('future');

  const history = {
    past: [{ kind: 'patch' as const, redoPatches, undoPatches }],
    future: [{ kind: 'snapshot' as const, snapshot: futureSnapshot }],
  };

  const snapshots = materializeAssemblyHistorySnapshots(history, present);

  assert.deepEqual(snapshots.past, [initial]);
  assert.deepEqual(snapshots.future, [futureSnapshot]);
  assert.notEqual(snapshots.past[0], initial);
  assert.notEqual(snapshots.future[0], futureSnapshot);
});
