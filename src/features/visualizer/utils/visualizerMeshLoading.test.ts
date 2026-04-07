import assert from 'node:assert/strict';
import test from 'node:test';
import { GeometryType } from '../../../types/geometry.ts';
import type { RobotState, UrdfLink } from '../../../types/robot.ts';
import {
  collectVisualizerCollisionMeshPreloadSpecs,
  collectVisualizerMeshLoadKeys,
  resolveVisualizerCollisionMeshPrewarmConcurrency,
} from './visualizerMeshLoading.ts';
import { sortCollisionPreloadSpecs } from './collisionRevealScheduling.ts';

function createMeshGeometry(meshPath: string) {
  return {
    type: GeometryType.MESH,
    dimensions: { x: 1, y: 1, z: 1 },
    color: '#ffffff',
    meshPath,
    origin: {
      xyz: { x: 0, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    },
  };
}

function createPrimitiveGeometry() {
  return {
    type: GeometryType.BOX,
    dimensions: { x: 1, y: 1, z: 1 },
    color: '#ffffff',
    origin: {
      xyz: { x: 0, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    },
  };
}

function createRobotState(link: Partial<UrdfLink>): RobotState {
  return {
    name: 'test-robot',
    rootLinkId: 'base',
    links: {
      base: {
        id: 'base',
        name: 'base',
        visual: createPrimitiveGeometry(),
        collision: createPrimitiveGeometry(),
        ...link,
      },
    },
    joints: {},
    selection: { type: null, id: null },
  };
}

test('collectVisualizerMeshLoadKeys keeps mesh loads even when geometry is hidden', () => {
  const robot = createRobotState({
    visual: createMeshGeometry('meshes/base.stl'),
    visualBodies: [createMeshGeometry('meshes/extra.obj')],
  });

  const keys = collectVisualizerMeshLoadKeys({
    robot,
    mode: 'editor',
    showGeometry: false,
    showCollision: false,
    assets: {
      'meshes/base.stl': 'blob:base',
      'meshes/extra.obj': 'blob:extra',
    },
  });

  assert.deepEqual(keys, [
    'base|visual|primary|0|meshes/base.stl',
    'base|visual|extra-1|1|meshes/extra.obj',
  ]);
});

test('collectVisualizerMeshLoadKeys skips invisible visual links', () => {
  const robot = createRobotState({
    visible: false,
    visual: createMeshGeometry('meshes/base.stl'),
  });

  const keys = collectVisualizerMeshLoadKeys({
    robot,
    mode: 'editor',
    showGeometry: true,
    showCollision: false,
    assets: {
      'meshes/base.stl': 'blob:base',
    },
  });

  assert.deepEqual(keys, []);
});

test('collectVisualizerMeshLoadKeys skips collision meshes for hidden links', () => {
  const robot = createRobotState({
    visible: false,
    collision: createMeshGeometry('meshes/collision.obj'),
  });

  const keys = collectVisualizerMeshLoadKeys({
    robot,
    mode: 'editor',
    showGeometry: true,
    showCollision: true,
    assets: {
      'meshes/collision.obj': 'blob:collision',
    },
  });

  assert.deepEqual(keys, []);
});

test('collectVisualizerMeshLoadKeys skips hidden detail collisions until collision display is enabled', () => {
  const robot = createRobotState({
    collision: createMeshGeometry('meshes/collision.obj'),
  });

  const hiddenKeys = collectVisualizerMeshLoadKeys({
    robot,
    mode: 'editor',
    showGeometry: true,
    showCollision: false,
    assets: {
      'meshes/collision.obj': 'blob:collision',
    },
  });
  assert.deepEqual(hiddenKeys, []);

  const visibleKeys = collectVisualizerMeshLoadKeys({
    robot,
    mode: 'editor',
    showGeometry: true,
    showCollision: true,
    assets: {
      'meshes/collision.obj': 'blob:collision',
    },
  });
  assert.deepEqual(visibleKeys, ['base|collision|primary|0|meshes/collision.obj']);
});

test('collectVisualizerMeshLoadKeys includes gltf/glb assets in supported mesh preload tracking', () => {
  const robot = createRobotState({
    visual: createMeshGeometry('meshes/base.glb'),
    collisionBodies: [createMeshGeometry('meshes/extra.gltf')],
  });

  const keys = collectVisualizerMeshLoadKeys({
    robot,
    mode: 'editor',
    showGeometry: true,
    showCollision: true,
    assets: {
      'meshes/base.glb': 'blob:base',
      'meshes/extra.gltf': 'blob:extra',
    },
  });

  assert.deepEqual(keys, [
    'base|visual|primary|0|meshes/base.glb',
    'base|collision|extra-1|1|meshes/extra.gltf',
  ]);
});

test('collectVisualizerMeshLoadKeys ignores missing or unsupported mesh assets', () => {
  const robot = createRobotState({
    visual: createMeshGeometry('meshes/base.fbx'),
    collisionBodies: [createMeshGeometry('meshes/extra.dae')],
  });

  const keys = collectVisualizerMeshLoadKeys({
    robot,
    mode: 'editor',
    showGeometry: true,
    showCollision: true,
    assets: {
      'meshes/base.fbx': 'blob:other',
    },
  });

  assert.deepEqual(keys, []);
});

test('collectVisualizerCollisionMeshPreloadSpecs deduplicates visible collision mesh assets', () => {
  const sharedCollision = createMeshGeometry('meshes/shared_collision.dae');
  const robot: RobotState = {
    name: 'test-robot',
    rootLinkId: 'base',
    links: {
      base: {
        id: 'base',
        name: 'base',
        visual: createPrimitiveGeometry(),
        collision: sharedCollision,
        collisionBodies: [sharedCollision],
      },
      hidden: {
        id: 'hidden',
        name: 'hidden',
        visible: false,
        visual: createPrimitiveGeometry(),
        collision: createMeshGeometry('meshes/hidden_collision.obj'),
      },
    },
    joints: {},
    selection: { type: null, id: null },
  };

  const specs = collectVisualizerCollisionMeshPreloadSpecs({
    robot,
    assets: {
      'meshes/shared_collision.dae': 'blob:shared-collision',
      'meshes/hidden_collision.obj': 'blob:hidden-collision',
    },
  });

  assert.deepEqual(specs, [
    {
      assetBaseDir: 'meshes/',
      assetUrl: 'blob:shared-collision',
      extension: 'dae',
      meshLoadKeys: [
        'base|collision|primary|0|meshes/shared_collision.dae',
        'base|collision|extra-1|1|meshes/shared_collision.dae',
      ],
      meshPath: 'meshes/shared_collision.dae',
    },
  ]);
});

test('sortCollisionPreloadSpecs prioritizes selected and hovered links before background meshes', () => {
  const specs = [
    {
      assetBaseDir: 'meshes/',
      assetUrl: 'blob:background',
      extension: 'stl',
      meshLoadKeys: ['background|collision|primary|0|meshes/background.stl'],
      meshPath: 'meshes/background.stl',
    },
    {
      assetBaseDir: 'meshes/',
      assetUrl: 'blob:hovered',
      extension: 'stl',
      meshLoadKeys: ['hovered|collision|primary|0|meshes/hovered.stl'],
      meshPath: 'meshes/hovered.stl',
    },
    {
      assetBaseDir: 'meshes/',
      assetUrl: 'blob:selected',
      extension: 'stl',
      meshLoadKeys: ['selected|collision|primary|0|meshes/selected.stl'],
      meshPath: 'meshes/selected.stl',
    },
  ];

  const sortedSpecs = sortCollisionPreloadSpecs(specs, {
    hoveredLinkId: 'hovered',
    selectedLinkId: 'selected',
  });

  assert.deepEqual(
    sortedSpecs.map((spec) => spec.assetUrl),
    ['blob:selected', 'blob:hovered', 'blob:background'],
  );
});

test('sortCollisionPreloadSpecs prioritizes source and selected components using link ownership', () => {
  const specs = [
    {
      assetBaseDir: 'meshes/',
      assetUrl: 'blob:other',
      extension: 'dae',
      meshLoadKeys: ['other_link|collision|primary|0|meshes/other.dae'],
      meshPath: 'meshes/other.dae',
    },
    {
      assetBaseDir: 'meshes/',
      assetUrl: 'blob:source',
      extension: 'dae',
      meshLoadKeys: ['source_link|collision|primary|0|meshes/source.dae'],
      meshPath: 'meshes/source.dae',
    },
    {
      assetBaseDir: 'meshes/',
      assetUrl: 'blob:selected-component',
      extension: 'dae',
      meshLoadKeys: ['selected_link|collision|primary|0|meshes/selected.dae'],
      meshPath: 'meshes/selected.dae',
    },
  ];

  const sortedSpecs = sortCollisionPreloadSpecs(specs, {
    prioritizedComponentIds: ['selected-component', 'source-component'],
    visibleComponentIdByLinkId: new Map([
      ['selected_link', 'selected-component'],
      ['source_link', 'source-component'],
      ['other_link', 'other-component'],
    ]),
  });

  assert.deepEqual(
    sortedSpecs.map((spec) => spec.assetUrl),
    ['blob:source', 'blob:selected-component', 'blob:other'],
  );
});

test('resolveVisualizerCollisionMeshPrewarmConcurrency returns zero when no specs exist', () => {
  assert.equal(
    resolveVisualizerCollisionMeshPrewarmConcurrency({
      specCount: 0,
      hardwareConcurrency: 8,
    }),
    0,
  );
});

test('resolveVisualizerCollisionMeshPrewarmConcurrency stays bounded by available specs', () => {
  assert.equal(
    resolveVisualizerCollisionMeshPrewarmConcurrency({
      specCount: 2,
      hardwareConcurrency: 16,
    }),
    2,
  );
});

test('resolveVisualizerCollisionMeshPrewarmConcurrency scales background preload with cpu budget', () => {
  assert.equal(
    resolveVisualizerCollisionMeshPrewarmConcurrency({
      specCount: 10,
      hardwareConcurrency: 4,
    }),
    2,
  );
  assert.equal(
    resolveVisualizerCollisionMeshPrewarmConcurrency({
      specCount: 10,
      hardwareConcurrency: 8,
    }),
    3,
  );
  assert.equal(
    resolveVisualizerCollisionMeshPrewarmConcurrency({
      specCount: 10,
      hardwareConcurrency: 24,
    }),
    4,
  );
});
