import test from 'node:test';
import assert from 'node:assert/strict';

import { useSelectionStore, validateSelection } from './selectionStore.ts';

function resetSelectionStore() {
  const state = useSelectionStore.getState();
  state.setInteractionGuard(null);
  state.setHoverFrozen(false);
  while (useSelectionStore.getState().hoverBlockCount > 0) {
    useSelectionStore.getState().endHoverBlock();
  }
  state.clearHover();
  state.setSelection({ type: null, id: null });
  state.setHoveredSelection({ type: null, id: null });
  state.setAttentionSelection({ type: null, id: null });
  state.setFocusTarget(null);
}

test('setHoverFrozen clears the current hover and immediately restores the last hover intent on release', () => {
  resetSelectionStore();

  const state = useSelectionStore.getState();
  state.setHoveredSelection({ type: 'link', id: 'base_link', subType: 'visual', objectIndex: 0 });
  state.setHoverFrozen(true);

  let nextState = useSelectionStore.getState();
  assert.equal(nextState.hoverFrozen, true);
  assert.deepEqual(nextState.hoveredSelection, { type: null, id: null });

  nextState.setHoveredSelection({
    type: 'link',
    id: 'arm_link',
    subType: 'collision',
    objectIndex: 2,
  });
  nextState.hoverJoint('joint_1');
  nextState = useSelectionStore.getState();

  assert.deepEqual(nextState.hoveredSelection, { type: null, id: null });
  assert.deepEqual(nextState.deferredHoveredSelection, { type: 'joint', id: 'joint_1' });

  nextState.setHoverFrozen(false);
  nextState = useSelectionStore.getState();
  assert.deepEqual(nextState.hoveredSelection, { type: 'joint', id: 'joint_1' });
  assert.deepEqual(nextState.deferredHoveredSelection, { type: null, id: null });
});

test('clearHover during a frozen drag clears the deferred hover so release does not restore stale highlight', () => {
  resetSelectionStore();

  const state = useSelectionStore.getState();
  state.setHoveredSelection({ type: 'link', id: 'base_link' });
  state.setHoverFrozen(true);

  let nextState = useSelectionStore.getState();
  nextState.setHoveredSelection({
    type: 'link',
    id: 'arm_link',
    subType: 'collision',
    objectIndex: 1,
  });
  nextState.clearHover();

  nextState = useSelectionStore.getState();
  assert.deepEqual(nextState.hoveredSelection, { type: null, id: null });
  assert.deepEqual(nextState.deferredHoveredSelection, { type: null, id: null });

  nextState.setHoverFrozen(false);
  assert.deepEqual(useSelectionStore.getState().hoveredSelection, { type: null, id: null });
});

test('setHoverFrozen(false) preserves the current hover when hover is already unfrozen', () => {
  resetSelectionStore();

  const state = useSelectionStore.getState();
  state.setHoveredSelection({
    type: 'link',
    id: 'base_link',
    subType: 'visual',
    objectIndex: 0,
  });

  state.setHoverFrozen(false);

  const nextState = useSelectionStore.getState();
  assert.equal(nextState.hoverFrozen, false);
  assert.deepEqual(nextState.hoveredSelection, {
    type: 'link',
    id: 'base_link',
    subType: 'visual',
    objectIndex: 0,
  });
  assert.deepEqual(nextState.deferredHoveredSelection, { type: null, id: null });
});

test('hover blocks preserve the existing hover intent and do not let new hover updates replace it before release', () => {
  resetSelectionStore();

  const state = useSelectionStore.getState();
  state.setHoveredSelection({ type: 'link', id: 'base_link' });
  state.beginHoverBlock();

  let nextState = useSelectionStore.getState();
  assert.equal(nextState.hoverFrozen, true);
  assert.deepEqual(nextState.hoveredSelection, { type: null, id: null });
  assert.deepEqual(nextState.deferredHoveredSelection, { type: 'link', id: 'base_link' });

  nextState.setHoveredSelection({ type: 'link', id: 'arm_link' });

  nextState = useSelectionStore.getState();
  assert.equal(nextState.hoverFrozen, true);
  assert.deepEqual(nextState.deferredHoveredSelection, { type: 'link', id: 'base_link' });

  nextState.endHoverBlock();
  nextState = useSelectionStore.getState();
  assert.equal(nextState.hoverFrozen, false);
  assert.deepEqual(nextState.hoveredSelection, { type: 'link', id: 'base_link' });
});

test('beginHoverBlock preserves the current hover as deferred intent so quick blank clicks do not flash the highlight away', () => {
  resetSelectionStore();

  const state = useSelectionStore.getState();
  state.setHoveredSelection({
    type: 'link',
    id: 'base_link',
    subType: 'visual',
    objectIndex: 0,
  });

  state.beginHoverBlock();

  let nextState = useSelectionStore.getState();
  assert.equal(nextState.hoverFrozen, true);
  assert.deepEqual(nextState.hoveredSelection, { type: null, id: null });
  assert.deepEqual(nextState.deferredHoveredSelection, {
    type: 'link',
    id: 'base_link',
    subType: 'visual',
    objectIndex: 0,
  });

  nextState.endHoverBlock();
  nextState = useSelectionStore.getState();

  assert.equal(nextState.hoverFrozen, false);
  assert.deepEqual(nextState.hoveredSelection, {
    type: 'link',
    id: 'base_link',
    subType: 'visual',
    objectIndex: 0,
  });
  assert.deepEqual(nextState.deferredHoveredSelection, { type: null, id: null });
});

test('interaction guard blocks invalid selections without preventing clearing', () => {
  resetSelectionStore();

  const state = useSelectionStore.getState();
  state.setInteractionGuard((selection) => selection.id === 'allowed_link');

  state.setSelection({ type: 'link', id: 'blocked_link' });
  assert.deepEqual(useSelectionStore.getState().selection, { type: null, id: null });

  state.setSelection({ type: 'link', id: 'allowed_link' });
  assert.deepEqual(useSelectionStore.getState().selection, { type: 'link', id: 'allowed_link' });

  state.clearSelection();
  assert.deepEqual(useSelectionStore.getState().selection, { type: null, id: null });
});

test('interaction guard clears invalid hover targets instead of keeping the previous highlight', () => {
  resetSelectionStore();

  const state = useSelectionStore.getState();
  state.setInteractionGuard((selection) => selection.id === 'allowed_link');
  state.setHoveredSelection({ type: 'link', id: 'allowed_link' });
  assert.deepEqual(useSelectionStore.getState().hoveredSelection, {
    type: 'link',
    id: 'allowed_link',
  });

  state.setHoveredSelection({ type: 'link', id: 'blocked_link' });
  assert.deepEqual(useSelectionStore.getState().hoveredSelection, { type: null, id: null });
});

test('hover state updates when helper identity changes on the same link', () => {
  resetSelectionStore();

  const state = useSelectionStore.getState();
  state.setHoveredSelection({ type: 'link', id: 'base_link', helperKind: 'center-of-mass' });
  state.setHoveredSelection({ type: 'link', id: 'base_link', helperKind: 'inertia' });

  assert.deepEqual(useSelectionStore.getState().hoveredSelection, {
    type: 'link',
    id: 'base_link',
    helperKind: 'inertia',
  });
});

test('hover state updates when the highlighted object changes on the same link', () => {
  resetSelectionStore();

  const state = useSelectionStore.getState();
  state.setHoveredSelection({
    type: 'link',
    id: 'base_link',
    subType: 'visual',
    objectIndex: 0,
    highlightObjectId: 101,
  });
  state.setHoveredSelection({
    type: 'link',
    id: 'base_link',
    subType: 'visual',
    objectIndex: 0,
    highlightObjectId: 202,
  });

  assert.deepEqual(useSelectionStore.getState().hoveredSelection, {
    type: 'link',
    id: 'base_link',
    subType: 'visual',
    objectIndex: 0,
    highlightObjectId: 202,
  });
});

test('selection state preserves an explicit primary geometry objectIndex after a generic geometry select', () => {
  resetSelectionStore();

  const state = useSelectionStore.getState();
  state.setSelection({
    type: 'link',
    id: 'base_link',
    subType: 'visual',
  });
  state.setSelection({
    type: 'link',
    id: 'base_link',
    subType: 'visual',
    objectIndex: 0,
  });

  assert.deepEqual(useSelectionStore.getState().selection, {
    type: 'link',
    id: 'base_link',
    subType: 'visual',
    objectIndex: 0,
  });
});

test('empty string ids are normalized to the empty selection state', () => {
  resetSelectionStore();

  const state = useSelectionStore.getState();
  state.setSelection({ type: 'link', id: '' });
  assert.deepEqual(useSelectionStore.getState().selection, { type: null, id: null });

  state.setHoveredSelection({ type: 'link', id: '' });
  assert.deepEqual(useSelectionStore.getState().hoveredSelection, { type: null, id: null });
});

test('validateSelection accepts runtime names in addition to canonical link and joint keys', () => {
  assert.equal(
    validateSelection(
      { type: 'link', id: 'base_link' },
      {
        link_key: { name: 'base_link' },
      },
      {},
    ),
    true,
  );
  assert.equal(
    validateSelection(
      { type: 'joint', id: 'shoulder_joint' },
      {},
      {
        joint_key: { name: 'shoulder_joint' },
      },
    ),
    true,
  );
});

test('validateSelection keeps tendon selections when the MJCF tendon still exists', () => {
  assert.equal(
    validateSelection(
      { type: 'tendon', id: 'finger_tendon' },
      {},
      {},
      {
        mjcf: {
          tendons: [{ name: 'finger_tendon' }],
        },
      },
    ),
    true,
  );
});

test('focusOn re-arms the same target so repeated locate actions can retrigger camera focus', async () => {
  resetSelectionStore();

  const state = useSelectionStore.getState();
  state.focusOn('base_link');
  assert.equal(useSelectionStore.getState().focusTarget, 'base_link');

  state.focusOn('base_link');
  assert.equal(useSelectionStore.getState().focusTarget, null);

  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(useSelectionStore.getState().focusTarget, 'base_link');

  useSelectionStore.getState().setFocusTarget(null);
});
