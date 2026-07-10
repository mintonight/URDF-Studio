import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { createDefaultWorkspace } from '@/core/robot';
import { useWorkspaceStore } from '@/store/workspaceStore';
import type { RobotFile } from '@/types';

import { useWorkspaceOverlayActions } from './useWorkspaceOverlayActions.ts';

function renderHook(
  onLoadRobot: Parameters<typeof useWorkspaceOverlayActions>[0]['onLoadRobot'],
  events: string[],
) {
  let hook: ReturnType<typeof useWorkspaceOverlayActions> | null = null;
  function Probe() {
    hook = useWorkspaceOverlayActions({
      onLoadRobot,
      showAssemblyComponentPreparationOverlay: () => events.push('overlay:show'),
      clearAssemblyComponentPreparationOverlay: () => events.push('overlay:clear'),
      showToast: (message, type) => events.push(`toast:${type}:${message}`),
      t: {
        addedComponent: 'Added {name}',
        loadingRobot: 'loading',
        preparingAssemblyComponent: 'preparing',
        addingAssemblyComponentToWorkspace: 'adding',
        groundingAssemblyComponent: 'grounding',
      },
      setBridgePreview: () => {},
      setShouldRenderBridgeModal: () => {},
      setIsBridgeModalOpen: () => {},
      addBridge: () => null,
      setIsCollisionOptimizerOpen: () => {},
    });
    return null;
  }
  renderToStaticMarkup(React.createElement(Probe));
  assert.ok(hook);
  return hook as unknown as ReturnType<typeof useWorkspaceOverlayActions>;
}

test('failed Add clears preparation without success toast or workspace mutation', async () => {
  const workspace = createDefaultWorkspace('before');
  useWorkspaceStore.getState().replaceWorkspace(workspace, { resetHistory: true });
  const before = structuredClone(useWorkspaceStore.getState().workspace);
  const events: string[] = [];
  const hook = renderHook(async () => null, events);
  const file: RobotFile = { name: 'broken.urdf', format: 'urdf', content: '<broken>' };

  hook.handleAddComponent(file);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(events, ['overlay:show', 'overlay:clear']);
  assert.deepEqual(useWorkspaceStore.getState().workspace, before);
});
