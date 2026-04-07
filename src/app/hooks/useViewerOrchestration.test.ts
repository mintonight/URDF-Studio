import test from 'node:test';
import assert from 'node:assert/strict';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { useViewerOrchestration } from './useViewerOrchestration.ts';
import { useSelectionStore, useUIStore } from '@/store';
import type { InteractionSelection, RobotState } from '@/types';

function resetSelectionStore() {
  const store = useSelectionStore.getState();
  store.setHoverFrozen(false);
  store.setSelection({ type: null, id: null });
  store.setHoveredSelection({ type: null, id: null });
  store.setAttentionSelection({ type: null, id: null });
  store.setFocusTarget(null);
}

function resetUiStore() {
  const store = useUIStore.getState();
  store.setAppMode('editor');
  store.setDetailLinkTab('visual');
  store.setPanelSection('property_editor_link_inertial', true);
  store.setPanelSection('kinematics', true);
}

function renderHook(options: {
  setSelection: (selection: RobotState['selection']) => void;
  pulseSelection: (selection: RobotState['selection'], durationMs?: number) => void;
  setHoveredSelection: (selection: InteractionSelection) => void;
  focusOn: (id: string) => void;
  transformPendingRef: { current: boolean };
}) {
  let hookValue: ReturnType<typeof useViewerOrchestration> | null = null;

  function Probe() {
    hookValue = useViewerOrchestration(options);
    return null;
  }

  renderToStaticMarkup(React.createElement(Probe));
  assert.ok(hookValue, 'hook should render');
  return hookValue;
}

test('handleSelect preserves the selected collision body index for the same link', () => {
  resetSelectionStore();
  resetUiStore();
  useSelectionStore.getState().setSelection({
    type: 'link',
    id: 'arm_link',
    subType: 'collision',
    objectIndex: 2,
  });

  let nextSelection: RobotState['selection'] | null = null;
  const hook = renderHook({
    setSelection: (selection) => {
      nextSelection = selection;
    },
    pulseSelection: () => {},
    setHoveredSelection: () => {},
    focusOn: () => {},
    transformPendingRef: { current: false },
  });

  hook.handleSelect('link', 'arm_link', 'collision');

  assert.deepEqual(nextSelection, {
    type: 'link',
    id: 'arm_link',
    subType: 'collision',
    objectIndex: 2,
  });
});

test('handleViewerSelect preserves collision objectIndex when re-selecting the same link', () => {
  resetSelectionStore();
  resetUiStore();
  useSelectionStore.getState().setSelection({
    type: 'link',
    id: 'arm_link',
    subType: 'collision',
    objectIndex: 1,
  });

  let nextSelection: RobotState['selection'] | null = null;
  let pulsedSelection: RobotState['selection'] | null = null;
  const hook = renderHook({
    setSelection: (selection) => {
      nextSelection = selection;
    },
    pulseSelection: (selection) => {
      pulsedSelection = selection;
    },
    setHoveredSelection: () => {},
    focusOn: () => {},
    transformPendingRef: { current: false },
  });

  hook.handleViewerSelect('link', 'arm_link', 'collision');

  assert.deepEqual(nextSelection, {
    type: 'link',
    id: 'arm_link',
    subType: 'collision',
    objectIndex: 1,
  });
  assert.deepEqual(pulsedSelection, nextSelection);
});

test('handleViewerSelect does not pin hover for regular selection clicks', () => {
  resetSelectionStore();
  resetUiStore();

  let nextHoveredSelection: InteractionSelection | null = null;
  const hook = renderHook({
    setSelection: () => {},
    pulseSelection: () => {},
    setHoveredSelection: (selection) => {
      nextHoveredSelection = selection;
    },
    focusOn: () => {},
    transformPendingRef: { current: false },
  });

  hook.handleViewerSelect('link', 'arm_link', 'visual');

  assert.equal(nextHoveredSelection, null);
});

test('handleSelect does not carry collision objectIndex across different links', () => {
  resetSelectionStore();
  resetUiStore();
  useSelectionStore.getState().setSelection({
    type: 'link',
    id: 'arm_link',
    subType: 'collision',
    objectIndex: 2,
  });

  let nextSelection: RobotState['selection'] | null = null;
  const hook = renderHook({
    setSelection: (selection) => {
      nextSelection = selection;
    },
    pulseSelection: () => {},
    setHoveredSelection: () => {},
    focusOn: () => {},
    transformPendingRef: { current: false },
  });

  hook.handleSelect('link', 'forearm_link', 'collision');

  assert.deepEqual(nextSelection, {
    type: 'link',
    id: 'forearm_link',
    subType: 'collision',
  });
});

test('handleViewerMeshSelect seeds the detail tab from visual mesh clicks while in editor mode', () => {
  resetSelectionStore();
  resetUiStore();
  useUIStore.getState().setAppMode('editor');
  useUIStore.getState().setDetailLinkTab('collision');

  const hook = renderHook({
    setSelection: () => {},
    pulseSelection: () => {},
    setHoveredSelection: () => {},
    focusOn: () => {},
    transformPendingRef: { current: false },
  });

  hook.handleViewerMeshSelect('arm_link', 'shoulder_joint', 0, 'visual');

  assert.equal(useUIStore.getState().detailLinkTab, 'visual');
});

test('handleViewerMeshSelect does not pin hover while selecting a body', () => {
  resetSelectionStore();
  resetUiStore();

  let nextHoveredSelection: InteractionSelection | null = null;
  const hook = renderHook({
    setSelection: () => {},
    pulseSelection: () => {},
    setHoveredSelection: (selection) => {
      nextHoveredSelection = selection;
    },
    focusOn: () => {},
    transformPendingRef: { current: false },
  });

  hook.handleViewerMeshSelect('arm_link', 'shoulder_joint', 0, 'collision');

  assert.equal(nextHoveredSelection, null);
});

test('handleViewerSelect routes inertial helpers to the physics tab without pinning hover', () => {
  resetSelectionStore();
  resetUiStore();

  let nextSelection: RobotState['selection'] | null = null;
  let nextHoveredSelection: RobotState['selection'] | null = null;
  const hook = renderHook({
    setSelection: (selection) => {
      nextSelection = selection;
    },
    pulseSelection: () => {},
    setHoveredSelection: (selection) => {
      nextHoveredSelection = selection;
    },
    focusOn: () => {},
    transformPendingRef: { current: false },
  });

  hook.handleViewerSelect('link', 'base_link', undefined, 'center-of-mass');

  assert.deepEqual(nextSelection, {
    type: 'link',
    id: 'base_link',
    subType: undefined,
    helperKind: 'center-of-mass',
  });
  assert.deepEqual(nextHoveredSelection, { type: null, id: null });
  assert.equal(useUIStore.getState().detailLinkTab, 'physics');
  assert.equal(useUIStore.getState().panelSections.property_editor_link_inertial, false);
});

test('handleViewerSelect opens joint kinematics for axis helpers', () => {
  resetSelectionStore();
  resetUiStore();

  const hook = renderHook({
    setSelection: () => {},
    pulseSelection: () => {},
    setHoveredSelection: () => {},
    focusOn: () => {},
    transformPendingRef: { current: false },
  });

  hook.handleViewerSelect('joint', 'hip_joint', undefined, 'joint-axis');

  assert.equal(useUIStore.getState().panelSections.kinematics, false);
});

test('handleHover preserves helper identity so helper-only hover changes are not collapsed', () => {
  resetSelectionStore();
  resetUiStore();

  let nextHoveredSelection: InteractionSelection | null = null;
  const hook = renderHook({
    setSelection: () => {},
    pulseSelection: () => {},
    setHoveredSelection: (selection) => {
      nextHoveredSelection = selection;
    },
    focusOn: () => {},
    transformPendingRef: { current: false },
  });

  hook.handleHover('link', 'base_link', undefined, undefined, 'center-of-mass');

  assert.deepEqual(nextHoveredSelection, {
    type: 'link',
    id: 'base_link',
    subType: undefined,
    objectIndex: undefined,
    helperKind: 'center-of-mass',
  });
});
