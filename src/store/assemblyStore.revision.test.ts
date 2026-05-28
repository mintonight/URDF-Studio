import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_LINK, type RobotData, type RobotFile } from '@/types';
import { useRobotStore } from './robotStore.ts';

function resetAssemblyStore() {
  const state = useRobotStore.getState();
  state.clearHistory();
  state.exitAssembly();
  state.setAssembly(null);
}

test('assemblyRevision increments for assembly mutations and undo/redo', () => {
  resetAssemblyStore();

  const store = useRobotStore.getState();
  const initialRevision = store.assemblyRevision;

  store.initAssembly('revision-bench');
  const afterInitRevision = useRobotStore.getState().assemblyRevision;
  assert.ok(afterInitRevision > initialRevision);

  const file: RobotFile = {
    name: 'robots/demo/revision.usd',
    content: '',
    format: 'usd',
  };

  const robotData: RobotData = {
    name: 'revision_demo',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
    },
    joints: {},
  };

  const component = useRobotStore.getState().addComponent(file, {
    preResolvedRobotData: robotData,
  });

  assert.ok(component);
  const afterAddRevision = useRobotStore.getState().assemblyRevision;
  assert.ok(afterAddRevision > afterInitRevision);

  useRobotStore.getState().updateComponentName(component!.id, 'renamed_component');
  const afterRenameRevision = useRobotStore.getState().assemblyRevision;
  assert.ok(afterRenameRevision > afterAddRevision);

  useRobotStore.getState().undo();
  const afterUndoRevision = useRobotStore.getState().assemblyRevision;
  assert.ok(afterUndoRevision > afterRenameRevision);

  useRobotStore.getState().redo();
  const afterRedoRevision = useRobotStore.getState().assemblyRevision;
  assert.ok(afterRedoRevision > afterUndoRevision);
});
