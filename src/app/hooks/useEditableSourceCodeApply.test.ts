import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createComponentSourceDraft,
  createSingleComponentWorkspace,
  createSourceSemanticRobotHash,
  normalizeComponentRobot,
} from '@/core/robot';
import { useAssetsStore } from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { DEFAULT_LINK, type RobotData } from '@/types';
import { commitPreparedComponentSourceApply } from './useEditableSourceCodeApply.ts';

function robot(name: string): RobotData {
  return {
    name,
    rootLinkId: 'base',
    links: { base: { ...structuredClone(DEFAULT_LINK), id: 'base', name: 'base' } },
    joints: {},
  };
}

function reset() {
  const workspace = createSingleComponentWorkspace(robot('before'), {
    componentId: 'arm',
    sourceFile: 'library/arm.urdf',
  });
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  const initialDraft = createComponentSourceDraft({
    componentId: 'arm',
    format: 'urdf',
    content: '<robot name="before"/>',
    robot: workspace.components.arm.robot,
  });
  useAssetsStore.setState({
    availableFiles: [{
      name: 'library/arm.urdf',
      format: 'urdf',
      content: '<robot name="immutable-template"/>',
    }],
    componentSourceDrafts: { arm: initialDraft },
  });
  return { workspace, initialDraft, revision: useWorkspaceStore.getState().revision };
}

test('prepared full-source apply atomically replaces target robot and matching draft', () => {
  const { revision } = reset();
  const nextRobot = robot('after');
  const nextDraft = createComponentSourceDraft({
    componentId: 'arm',
    format: 'urdf',
    content: '<robot name="after"/>',
    robot: nextRobot,
  });

  assert.equal(commitPreparedComponentSourceApply({
    componentId: 'arm',
    expectedWorkspaceRevision: revision,
    robot: nextRobot,
    draft: nextDraft,
  }), true);
  assert.equal(useWorkspaceStore.getState().workspace.components.arm.robot.name, 'after');
  assert.deepEqual(useAssetsStore.getState().componentSourceDrafts.arm, nextDraft);
  assert.equal(
    useAssetsStore.getState().availableFiles[0].content,
    '<robot name="immutable-template"/>',
  );
});

test('invalid prepared result changes neither canonical workspace nor draft', () => {
  const { revision, initialDraft } = reset();
  const nextRobot = robot('invalid');
  const invalidDraft = {
    ...createComponentSourceDraft({
      componentId: 'arm',
      format: 'urdf',
      content: '<robot name="invalid"/>',
      robot: nextRobot,
    }),
    robotSnapshotHash: 'corrupt',
  };

  assert.equal(commitPreparedComponentSourceApply({
    componentId: 'arm',
    expectedWorkspaceRevision: revision,
    robot: nextRobot,
    draft: invalidDraft,
  }), false);
  assert.equal(useWorkspaceStore.getState().workspace.components.arm.robot.name, 'before');
  assert.deepEqual(useAssetsStore.getState().componentSourceDrafts.arm, initialDraft);
});

test('late revision loses CAS and cannot commit workspace or draft', () => {
  const { revision, initialDraft } = reset();
  const nextRobot = robot('late');
  const nextDraft = createComponentSourceDraft({
    componentId: 'arm',
    format: 'urdf',
    content: '<robot name="late"/>',
    robot: nextRobot,
  });
  useWorkspaceStore.getState().renameWorkspace('concurrent edit');

  assert.equal(commitPreparedComponentSourceApply({
    componentId: 'arm',
    expectedWorkspaceRevision: revision,
    robot: nextRobot,
    draft: nextDraft,
  }), false);
  assert.equal(useWorkspaceStore.getState().workspace.components.arm.robot.name, 'before');
  assert.deepEqual(useAssetsStore.getState().componentSourceDrafts.arm, initialDraft);
});

test('source-only text edit can refresh a matching draft without adding workspace history', () => {
  const { revision } = reset();
  const currentRobot = useWorkspaceStore.getState().workspace.components.arm.robot;
  const nextDraft = createComponentSourceDraft({
    componentId: 'arm',
    format: 'urdf',
    content: '<!-- comment --><robot name="before"/>',
    robot: currentRobot,
  });
  const historyCount = useWorkspaceStore.getState().history.past.length;

  assert.equal(commitPreparedComponentSourceApply({
    componentId: 'arm',
    expectedWorkspaceRevision: revision,
    robot: currentRobot,
    draft: nextDraft,
  }), true);
  assert.equal(useWorkspaceStore.getState().revision, revision);
  assert.equal(useWorkspaceStore.getState().history.past.length, historyCount);
  assert.deepEqual(useAssetsStore.getState().componentSourceDrafts.arm, nextDraft);
});

test('material source apply hashes the same normalized robot committed to the component', () => {
  const { revision } = reset();
  const parsedRobot = robot('material_robot');
  parsedRobot.links.base.visual = {
    ...parsedRobot.links.base.visual,
    color: '#ffffff',
  };
  parsedRobot.materials = { base: { color: '#123456' } };
  const normalizedRobot = normalizeComponentRobot(parsedRobot);
  const draft = createComponentSourceDraft({
    componentId: 'arm',
    format: 'urdf',
    content: '<robot name="material_robot"><material name="base" /></robot>',
    robot: normalizedRobot,
  });

  assert.equal(commitPreparedComponentSourceApply({
    componentId: 'arm',
    expectedWorkspaceRevision: revision,
    robot: parsedRobot,
    draft,
  }), true);
  const committedRobot = useWorkspaceStore.getState().workspace.components.arm.robot;
  const committedDraft = useAssetsStore.getState().componentSourceDrafts.arm;
  assert.equal(committedRobot.links.base.visual.color, '#123456');
  assert.equal(committedDraft.robotSnapshotHash, createSourceSemanticRobotHash(committedRobot));
});
