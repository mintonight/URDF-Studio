import assert from 'node:assert/strict';
import test from 'node:test';

import { GeometryType, type AssemblyState } from '@/types';

import {
  isAssemblyTransformSelectionArmed,
  resolveAssemblyRootComponentSelection,
} from './transformSelection';

function createAssemblyState(): AssemblyState {
  return {
    name: 'test-assembly',
    components: {
      component_a: {
        id: 'component_a',
        name: 'Component A',
        sourceFile: 'component_a.urdf',
        robot: {
          name: 'robot_a',
          rootLinkId: 'component_a/base_link',
          links: {
            'component_a/base_link': {
              id: 'component_a/base_link',
              name: 'base_link',
              visual: {
                type: GeometryType.BOX,
                dimensions: { x: 1, y: 1, z: 1 },
                color: '#ffffff',
                origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
              },
              collision: {
                type: GeometryType.BOX,
                dimensions: { x: 1, y: 1, z: 1 },
                color: '#ffffff',
                origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
              },
            },
            'component_a/tool_link': {
              id: 'component_a/tool_link',
              name: 'tool_link',
              visual: {
                type: GeometryType.BOX,
                dimensions: { x: 1, y: 1, z: 1 },
                color: '#ffffff',
                origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
              },
              collision: {
                type: GeometryType.BOX,
                dimensions: { x: 1, y: 1, z: 1 },
                color: '#ffffff',
                origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
              },
            },
          },
          joints: {},
        },
      },
    },
    bridges: {},
  };
}

test('resolveAssemblyRootComponentSelection only accepts a component root link pick', () => {
  const assemblyState = createAssemblyState();

  assert.deepEqual(
    resolveAssemblyRootComponentSelection(assemblyState, {
      type: 'link',
      id: 'component_a/base_link',
    }),
    {
      componentId: 'component_a',
      rootLinkId: 'component_a/base_link',
    },
  );

  assert.deepEqual(
    resolveAssemblyRootComponentSelection(assemblyState, {
      type: 'link',
      id: 'base_link',
    }),
    {
      componentId: 'component_a',
      rootLinkId: 'component_a/base_link',
    },
  );

  assert.equal(
    resolveAssemblyRootComponentSelection(assemblyState, {
      type: 'link',
      id: 'component_a/tool_link',
    }),
    null,
  );
});

test('isAssemblyTransformSelectionArmed arms component transforms from component or root-link selection', () => {
  const assemblyState = createAssemblyState();

  assert.equal(
    isAssemblyTransformSelectionArmed(
      assemblyState,
      { type: 'component', id: 'component_a' },
      { type: 'link', id: 'component_a/base_link' },
    ),
    true,
  );

  assert.equal(
    isAssemblyTransformSelectionArmed(
      assemblyState,
      { type: 'component', id: 'component_a' },
      { type: 'link', id: 'component_a/tool_link' },
    ),
    false,
  );

  assert.equal(
    isAssemblyTransformSelectionArmed(
      assemblyState,
      { type: 'component', id: 'component_a' },
      { type: null, id: null },
    ),
    true,
  );

  assert.equal(
    isAssemblyTransformSelectionArmed(
      assemblyState,
      { type: 'assembly', id: '__assembly__' },
      { type: null, id: null },
    ),
    true,
  );
});

test('isAssemblyTransformSelectionArmed ignores root-link helper selections', () => {
  const assemblyState = createAssemblyState();

  assert.equal(
    isAssemblyTransformSelectionArmed(
      assemblyState,
      { type: 'component', id: 'component_a' },
      {
        type: 'link',
        id: 'component_a/base_link',
        helperKind: 'origin-axes',
      },
    ),
    false,
  );
});
