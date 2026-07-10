import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createComponentSourceDraft, createSingleComponentWorkspace } from '@/core/robot';
import { translations } from '@/shared/i18n';
import { useAssetsStore } from '@/store/assetsStore';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { DEFAULT_LINK, type RobotData, type RobotFile } from '@/types';
import { registerPendingHistoryFlusher } from '@/app/utils/pendingHistory';
import { useLibraryFileActions } from './useLibraryFileActions';

function robot(name: string): RobotData {
  return {
    name,
    rootLinkId: 'base',
    links: { base: { ...structuredClone(DEFAULT_LINK), id: 'base', name: 'base' } },
    joints: {},
  };
}

function renderLibraryActions(
  overrides: Partial<Parameters<typeof useLibraryFileActions>[0]> = {},
): ReturnType<typeof useLibraryFileActions> {
  let actions: ReturnType<typeof useLibraryFileActions> | null = null;
  function Probe() {
    const assets = useAssetsStore.getState();
    actions = useLibraryFileActions({
      availableFiles: assets.availableFiles,
      selectedFile: assets.selectedFile,
      assemblyState: useWorkspaceStore.getState().workspace,
      removeRobotFile: assets.removeRobotFile,
      removeRobotFolder: assets.removeRobotFolder,
      renameRobotFolder: assets.renameRobotFolder,
      clearRobotLibrary: assets.clearRobotLibrary,
      clearSelection: () => {},
      uploadAsset: () => {},
      openLibraryExportDialog: () => {},
      showToast: () => {},
      t: translations.en,
      ...overrides,
    });
    return null;
  }
  renderToStaticMarkup(React.createElement(Probe));
  assert.ok(actions);
  return actions as unknown as ReturnType<typeof useLibraryFileActions>;
}

test('deleting a shared library file batches component removal and clears only owned drafts', () => {
  const target: RobotFile = {
    name: 'library/shared.urdf',
    format: 'urdf',
    content: '<robot name="shared" />',
  };
  const survivorFile: RobotFile = {
    name: 'library/survivor.urdf',
    format: 'urdf',
    content: '<robot name="survivor" />',
  };
  const workspace = createSingleComponentWorkspace(robot('first'), {
    componentId: 'first',
    sourceFile: target.name,
  });
  workspace.components.second = createSingleComponentWorkspace(robot('second'), {
    componentId: 'second',
    sourceFile: target.name,
  }).components.second;
  workspace.components.survivor = createSingleComponentWorkspace(robot('survivor'), {
    componentId: 'survivor',
    sourceFile: survivorFile.name,
  }).components.survivor;
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  useWorkspaceStore.setState({ history: { past: [], future: [], activity: [] } });
  useAssetsStore.setState({
    availableFiles: [target, survivorFile],
    componentSourceDrafts: Object.fromEntries(
      Object.values(workspace.components).map((component) => [
        component.id,
        createComponentSourceDraft({
          componentId: component.id,
          format: 'urdf',
          content: `<robot name="${component.id}" />`,
          robot: component.robot,
        }),
      ]),
    ),
  });

  const renderedActions = renderLibraryActions();
  renderedActions.handleDeleteLibraryFile(target);

  assert.deepEqual(Object.keys(useWorkspaceStore.getState().workspace.components), ['survivor']);
  assert.equal(useWorkspaceStore.getState().history.past.length, 1);
  assert.deepEqual(Object.keys(useAssetsStore.getState().componentSourceDrafts), ['survivor']);
  assert.deepEqual(
    useAssetsStore.getState().availableFiles.map((file) => file.name),
    [survivorFile.name],
  );
});

test('library deletion flushes a pending edit before its discrete asset mutation', () => {
  const target: RobotFile = {
    name: 'library/unowned.urdf',
    format: 'urdf',
    content: '<robot name="unowned" />',
  };
  const workspace = createSingleComponentWorkspace(robot('workspace'), {
    componentId: 'workspace',
    sourceFile: null,
  });
  const store = useWorkspaceStore.getState();
  store.replaceWorkspace(workspace, { resetHistory: true });
  useWorkspaceStore.setState({ history: { past: [], future: [], activity: [] } });
  useAssetsStore.setState({ availableFiles: [target], selectedFile: null });
  const pendingId = store.beginWorkspaceTransaction('Pending property edit');
  store.renameWorkspace('pending name', { operationId: pendingId });
  const unregister = registerPendingHistoryFlusher(() => {
    useWorkspaceStore.getState().commitWorkspaceTransaction(pendingId);
  });

  try {
    renderLibraryActions().handleDeleteLibraryFile(target);
  } finally {
    unregister();
  }

  assert.equal(useWorkspaceStore.getState().transaction, null);
  assert.equal(useWorkspaceStore.getState().workspace.name, 'pending name');
  assert.equal(useWorkspaceStore.getState().history.past.length, 1);
  assert.deepEqual(useAssetsStore.getState().availableFiles, []);
});

test('exclusive workspace work rejects library deletion before the asset store changes', () => {
  const target: RobotFile = {
    name: 'library/unowned.urdf',
    format: 'urdf',
    content: '<robot name="unowned" />',
  };
  const workspace = createSingleComponentWorkspace(robot('workspace'), {
    componentId: 'workspace',
    sourceFile: null,
  });
  const store = useWorkspaceStore.getState();
  store.replaceWorkspace(workspace, { resetHistory: true });
  useAssetsStore.setState({ availableFiles: [target], selectedFile: null });
  const exclusiveId = store.beginWorkspaceTransaction('USD hydration', { exclusive: true });

  assert.throws(
    () => renderLibraryActions().handleDeleteLibraryFile(target),
    /busy with an exclusive operation/i,
  );
  assert.deepEqual(useAssetsStore.getState().availableFiles, [target]);
  assert.equal(useWorkspaceStore.getState().transaction?.id, exclusiveId);
  useWorkspaceStore.getState().cancelWorkspaceTransaction(exclusiveId);
});

test('folder rename updates asset paths and component sources as one non-historical operation', () => {
  const target: RobotFile = {
    name: 'library/old/robot.urdf',
    format: 'urdf',
    content: '<robot name="robot" />',
  };
  const workspace = createSingleComponentWorkspace(robot('robot'), {
    componentId: 'robot',
    sourceFile: target.name,
  });
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  useWorkspaceStore.setState({ history: { past: [], future: [], activity: [] } });
  useAssetsStore.setState({
    availableFiles: [target],
    selectedFile: target,
    allFileContents: { [target.name]: target.content },
  });

  const result = renderLibraryActions().handleRenameLibraryFolder('library/old', 'new');

  assert.deepEqual(result, { ok: true, nextPath: 'library/new' });
  assert.equal(
    useWorkspaceStore.getState().workspace.components.robot?.sourceFile,
    'library/new/robot.urdf',
  );
  assert.equal(useWorkspaceStore.getState().history.past.length, 0);
  assert.deepEqual(
    useAssetsStore.getState().availableFiles.map((file) => file.name),
    ['library/new/robot.urdf'],
  );
  assert.deepEqual(Object.keys(useAssetsStore.getState().allFileContents), [
    'library/new/robot.urdf',
  ]);
});

test('folder rename rolls workspace source paths back when the asset rename fails', () => {
  const target: RobotFile = {
    name: 'library/old/robot.urdf',
    format: 'urdf',
    content: '<robot name="robot" />',
  };
  const workspace = createSingleComponentWorkspace(robot('robot'), {
    componentId: 'robot',
    sourceFile: target.name,
  });
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  useWorkspaceStore.setState({ history: { past: [], future: [], activity: [] } });
  useAssetsStore.setState({ availableFiles: [target], selectedFile: target });

  const result = renderLibraryActions({
    renameRobotFolder: () => ({ ok: false, reason: 'conflict' }),
  }).handleRenameLibraryFolder('library/old', 'new');

  assert.deepEqual(result, { ok: false, reason: 'conflict' });
  assert.equal(
    useWorkspaceStore.getState().workspace.components.robot?.sourceFile,
    target.name,
  );
  assert.equal(useWorkspaceStore.getState().transaction, null);
  assert.equal(useWorkspaceStore.getState().history.past.length, 0);
  assert.deepEqual(useAssetsStore.getState().availableFiles, [target]);
});

test('folder rename rolls the asset store back when workspace commit is rejected', () => {
  const target: RobotFile = {
    name: 'library/old/robot.urdf',
    format: 'urdf',
    content: '<robot name="robot" />',
  };
  const workspace = createSingleComponentWorkspace(robot('robot'), {
    componentId: 'robot',
    sourceFile: target.name,
  });
  const store = useWorkspaceStore.getState();
  store.replaceWorkspace(workspace, { resetHistory: true });
  useWorkspaceStore.setState({ history: { past: [], future: [], activity: [] } });
  useAssetsStore.setState({
    availableFiles: [target],
    selectedFile: target,
    allFileContents: { [target.name]: target.content },
  });
  const originalCommit = store.commitWorkspaceTransaction;
  useWorkspaceStore.setState({ commitWorkspaceTransaction: () => false });

  try {
    assert.throws(
      () => renderLibraryActions().handleRenameLibraryFolder('library/old', 'new'),
      /Failed to commit library folder rename/,
    );
  } finally {
    useWorkspaceStore.setState({ commitWorkspaceTransaction: originalCommit });
  }

  assert.equal(
    useWorkspaceStore.getState().workspace.components.robot?.sourceFile,
    target.name,
  );
  assert.equal(useWorkspaceStore.getState().transaction, null);
  assert.deepEqual(
    useAssetsStore.getState().availableFiles.map((file) => file.name),
    [target.name],
  );
  assert.deepEqual(Object.keys(useAssetsStore.getState().allFileContents), [target.name]);
});
