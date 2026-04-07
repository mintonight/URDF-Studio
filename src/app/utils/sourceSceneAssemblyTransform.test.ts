import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_LINK,
  GeometryType,
  type AssemblyComponent,
  type AssemblyTransform,
} from '@/types';
import {
  denormalizeSourceSceneAssemblyComponentTransform,
  normalizeSourceSceneAssemblyComponentTransform,
} from './sourceSceneAssemblyTransform';

function createComponent(transform?: AssemblyTransform): AssemblyComponent {
  return {
    id: 'comp_demo',
    name: 'demo',
    sourceFile: 'robots/demo/demo.urdf',
    robot: {
      name: 'demo',
      rootLinkId: 'comp_demo_base_link',
      links: {
        comp_demo_base_link: {
          ...DEFAULT_LINK,
          id: 'comp_demo_base_link',
          name: 'comp_demo_base_link',
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.BOX,
            dimensions: { x: 0.4, y: 0.3, z: 0.5 },
            origin: {
              xyz: { x: 0, y: 0, z: 0 },
              rpy: { r: 0, p: 0, y: 0 },
            },
          },
        },
      },
      joints: {},
    },
    transform,
    visible: true,
  };
}

test('normalizeSourceSceneAssemblyComponentTransform removes the seeded ground lift from source-scene reuse', () => {
  const normalized = normalizeSourceSceneAssemblyComponentTransform(
    createComponent({
      position: { x: 0.15, y: -0.05, z: 0.25 },
      rotation: { r: 0, p: 0, y: 0.35 },
    }),
  );

  assert.deepEqual(normalized, {
    position: { x: 0.15, y: -0.05, z: 0 },
    rotation: { r: 0, p: 0, y: 0.35 },
  });
});

test('denormalizeSourceSceneAssemblyComponentTransform restores the assembly-space ground lift on commit', () => {
  const denormalized = denormalizeSourceSceneAssemblyComponentTransform(
    createComponent({
      position: { x: 0, y: 0, z: 0.25 },
      rotation: { r: 0, p: 0, y: 0 },
    }),
    {
      position: { x: 0.15, y: -0.05, z: 0 },
      rotation: { r: 0, p: 0, y: 0.35 },
    },
  );

  assert.deepEqual(denormalized, {
    position: { x: 0.15, y: -0.05, z: 0.25 },
    rotation: { r: 0, p: 0, y: 0.35 },
  });
});

test('normalizeSourceSceneAssemblyComponentTransform keeps legacy missing transforms neutral', () => {
  const normalized = normalizeSourceSceneAssemblyComponentTransform(createComponent(undefined));

  assert.deepEqual(normalized, {
    position: { x: 0, y: 0, z: 0 },
    rotation: { r: 0, p: 0, y: 0 },
  });
});
