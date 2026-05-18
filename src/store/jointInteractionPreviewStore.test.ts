import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EMPTY_JOINT_INTERACTION_PREVIEW,
  useJointInteractionPreviewStore,
} from './jointInteractionPreviewStore';

test('joint interaction preview store supports tree-panel previews and source-scoped clearing', () => {
  const store = useJointInteractionPreviewStore.getState();
  store.clearPreview();

  store.publishPreview({
    source: 'tree-panel',
    dragSessionId: 'tree-drag',
    activeJointId: 'joint_a',
    jointAngles: { joint_a: 0.5 },
    jointQuaternions: {},
    jointOrigins: {},
  });

  assert.equal(useJointInteractionPreviewStore.getState().preview.source, 'tree-panel');

  store.clearPreview({ source: 'viewer' });
  assert.equal(useJointInteractionPreviewStore.getState().preview.source, 'tree-panel');

  store.clearPreview({ source: 'tree-panel', dragSessionId: 'tree-drag' });
  assert.deepEqual(useJointInteractionPreviewStore.getState().preview, EMPTY_JOINT_INTERACTION_PREVIEW);
});
