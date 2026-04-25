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
  store.setViewOption('showCollision', false);
  store.setPanelSection('property_editor_link_inertial', true);
  store.setPanelSection('property_editor_link_frame', true);
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

test('handleSelect enables collision visibility when selecting collision geometry', () => {
  resetSelectionStore();
  resetUiStore();
  assert.equal(useUIStore.getState().viewOptions.showCollision, false);

  const hook = renderHook({
    setSelection: () => {},
    pulseSelection: () => {},
    setHoveredSelection: () => {},
    focusOn: () => {},
    transformPendingRef: { current: false },
  });

  hook.handleSelect('link', 'arm_link', 'collision');

  assert.equal(useUIStore.getState().viewOptions.showCollision, true);
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

test('handleViewerSelect enables collision visibility when selecting collision geometry', () => {
  resetSelectionStore();
  resetUiStore();
  assert.equal(useUIStore.getState().viewOptions.showCollision, false);

  const hook = renderHook({
    setSelection: () => {},
    pulseSelection: () => {},
    setHoveredSelection: () => {},
    focusOn: () => {},
    transformPendingRef: { current: false },
  });

  hook.handleViewerSelect('link', 'arm_link', 'collision');

  assert.equal(useUIStore.getState().viewOptions.showCollision, true);
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

test('handleHover ignores redundant viewer hover updates for the currently selected link', () => {
  resetSelectionStore();
  resetUiStore();

  useSelectionStore.getState().setSelection({
    type: 'link',
    id: 'base_link',
    subType: 'visual',
  });
  useSelectionStore.getState().setHoveredSelection({
    type: 'link',
    id: 'base_link',
  });

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

  hook.handleHover('link', 'base_link', 'visual', 0);

  assert.equal(nextHoveredSelection, null);
});

test('handleHover still updates hover when the viewer moves to a different link', () => {
  resetSelectionStore();
  resetUiStore();

  useSelectionStore.getState().setSelection({
    type: 'link',
    id: 'base_link',
    subType: 'visual',
  });
  useSelectionStore.getState().setHoveredSelection({
    type: 'link',
    id: 'base_link',
  });

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

  hook.handleHover('link', 'arm_link', 'visual', 0);

  assert.deepEqual(nextHoveredSelection, {
    type: 'link',
    id: 'arm_link',
    subType: 'visual',
    objectIndex: 0,
    helperKind: undefined,
    highlightObjectId: undefined,
  });
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
  assert.equal(useUIStore.getState().viewOptions.showCollision, false);
});

test('handleSelectGeometry pulses the selected link geometry so the tree can relocate it', () => {
  resetSelectionStore();
  resetUiStore();

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

  hook.handleSelectGeometry('arm_link', 'collision', 2);

  assert.deepEqual(nextSelection, {
    type: 'link',
    id: 'arm_link',
    subType: 'collision',
    objectIndex: 2,
  });
  assert.deepEqual(pulsedSelection, nextSelection);
});

test('handleSelectGeometry enables collision visibility when selecting collision geometry', () => {
  resetSelectionStore();
  resetUiStore();
  assert.equal(useUIStore.getState().viewOptions.showCollision, false);

  const hook = renderHook({
    setSelection: () => {},
    pulseSelection: () => {},
    setHoveredSelection: () => {},
    focusOn: () => {},
    transformPendingRef: { current: false },
  });

  hook.handleSelectGeometry('arm_link', 'collision', 1);

  assert.equal(useUIStore.getState().viewOptions.showCollision, true);
});

test('handleSelectGeometry can skip auto-revealing collision visibility for property-panel edits', () => {
  resetSelectionStore();
  resetUiStore();
  assert.equal(useUIStore.getState().viewOptions.showCollision, false);

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

  hook.handleSelectGeometry('arm_link', 'collision', 1, true, true);

  assert.deepEqual(nextSelection, {
    type: 'link',
    id: 'arm_link',
    subType: 'collision',
    objectIndex: 1,
  });
  assert.equal(useUIStore.getState().viewOptions.showCollision, false);
});

test('handleSelectGeometry can skip relocation pulses for in-tree geometry clicks', () => {
  resetSelectionStore();
  resetUiStore();

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

  hook.handleSelectGeometry('arm_link', 'visual', 0, true);

  assert.deepEqual(nextSelection, {
    type: 'link',
    id: 'arm_link',
    subType: 'visual',
    objectIndex: 0,
  });
  assert.equal(pulsedSelection, null);
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

test('handleViewerMeshSelect preserves the active hover highlight target for the clicked mesh', () => {
  resetSelectionStore();
  resetUiStore();

  useSelectionStore.getState().setHoveredSelection({
    type: 'link',
    id: 'base_link',
    subType: 'visual',
    objectIndex: 0,
    highlightObjectId: 101,
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

  hook.handleViewerMeshSelect('base_link', null, 0, 'visual');

  assert.deepEqual(nextSelection, {
    type: 'link',
    id: 'base_link',
    subType: 'visual',
    objectIndex: 0,
    highlightObjectId: 101,
  });
});

test('handleViewerMeshSelect enables collision visibility for collision mesh picks', () => {
  resetSelectionStore();
  resetUiStore();
  assert.equal(useUIStore.getState().viewOptions.showCollision, false);

  const hook = renderHook({
    setSelection: () => {},
    pulseSelection: () => {},
    setHoveredSelection: () => {},
    focusOn: () => {},
    transformPendingRef: { current: false },
  });

  hook.handleViewerMeshSelect('arm_link', 'shoulder_joint', 0, 'collision');

  assert.equal(useUIStore.getState().viewOptions.showCollision, true);
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

test('handleViewerSelect routes origin helpers to the link visual tab and frame section', () => {
  resetSelectionStore();
  resetUiStore();

  const hook = renderHook({
    setSelection: () => {},
    pulseSelection: () => {},
    setHoveredSelection: () => {},
    focusOn: () => {},
    transformPendingRef: { current: false },
  });

  hook.handleViewerSelect('link', 'hip_link', undefined, 'origin-axes');

  assert.equal(useUIStore.getState().detailLinkTab, 'visual');
  assert.equal(useUIStore.getState().panelSections.property_editor_link_frame, false);
});

test('handleViewerSelect keeps joint-axis helpers on the joint kinematics section', () => {
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
  assert.equal(useUIStore.getState().detailLinkTab, 'visual');
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
    highlightObjectId: undefined,
  });
});
