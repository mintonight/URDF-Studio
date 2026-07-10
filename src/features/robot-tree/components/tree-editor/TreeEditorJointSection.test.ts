import assert from 'node:assert/strict';
import test from 'node:test';

import type { JointInteractionPreviewSnapshot } from '@/store/jointInteractionPreviewStore';
import {
  createTreeJointPanelScopeKey,
  resolveComponentViewerJointPreview,
} from './TreeEditorJointSection.tsx';

test('viewer joint preview isolates duplicate source-local IDs by component', () => {
  const preview: JointInteractionPreviewSnapshot = {
    source: 'viewer',
    dragSessionId: 'drag-1',
    activeJointId: 'right__shared_joint',
    jointAngles: { right__shared_joint: 99 },
    jointQuaternions: {},
    jointOrigins: {},
    workspaceByComponent: {
      left: {
        activeJointId: 'shared_joint',
        jointAngles: { shared_joint: 0.25 },
        jointQuaternions: {},
        jointOrigins: {},
      },
      right: {
        activeJointId: 'shared_joint',
        jointAngles: { shared_joint: 0.75 },
        jointQuaternions: {},
        jointOrigins: {},
      },
    },
  };

  assert.deepEqual(resolveComponentViewerJointPreview(preview, 'left')?.jointAngles, {
    shared_joint: 0.25,
  });
  assert.deepEqual(resolveComponentViewerJointPreview(preview, 'right')?.jointAngles, {
    shared_joint: 0.75,
  });
  assert.equal(resolveComponentViewerJointPreview(preview, 'missing'), null);
});

test('tree ignores renderer-global and non-viewer preview payloads', () => {
  const preview: JointInteractionPreviewSnapshot = {
    source: 'tree-panel',
    dragSessionId: 'tree-drag',
    activeJointId: 'left__shared_joint',
    jointAngles: { left__shared_joint: 1.5 },
    jointQuaternions: {},
    jointOrigins: {},
    workspaceByComponent: {
      left: {
        activeJointId: 'shared_joint',
        jointAngles: { shared_joint: 0.5 },
        jointQuaternions: {},
        jointOrigins: {},
      },
    },
  };

  assert.equal(resolveComponentViewerJointPreview(preview, 'left'), null);
});

test('joint panel scope isolates components sharing source and local topology names', () => {
  const robot = { name: 'shared_robot', rootLinkId: 'base' };
  const left = createTreeJointPanelScopeKey({
    componentId: 'left',
    sourceFilePath: 'library/shared.xml',
    robot,
  });
  const right = createTreeJointPanelScopeKey({
    componentId: 'right',
    sourceFilePath: 'library/shared.xml',
    robot,
  });

  assert.notEqual(left, right);
  assert.equal(left, 'left:library/shared.xml');
  assert.equal(right, 'right:library/shared.xml');
});
