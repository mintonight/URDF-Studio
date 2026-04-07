import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { ignoreRaycast } from '@/shared/utils/three/ignoreRaycast';
import { narrowLineRaycast } from '@/shared/utils/three/narrowLineRaycast';
import { clearMaterialCache, getCachedMaterial } from './materialCache.ts';
import {
  createVisualizerHoverUserData,
  findNearestVisualizerHoverTarget,
  findNearestVisualizerTargetFromHits,
  getVisualizerHoverTarget,
  resolveVisualizerInteractionTargetFromHits,
  type VisualizerHoverTarget,
} from './hoverPicking.ts';
import {
  createGeometryHoverTargetSelection,
  resolveGeometryHoverTargetFromHits,
} from './geometryHover.ts';

const findNearestVisualizerHoverTargetWithOptions = findNearestVisualizerHoverTarget as unknown as (
  root: THREE.Object3D | null,
  raycaster: THREE.Raycaster,
  options?: unknown,
) => VisualizerHoverTarget | null;

const findNearestVisualizerTargetFromHitsWithOptions =
  findNearestVisualizerTargetFromHits as unknown as (
    hits: readonly THREE.Intersection<THREE.Object3D>[],
    options?: unknown,
  ) => VisualizerHoverTarget | null;

const resolveGeometryHoverTargetFromHitsWithOptions =
  resolveGeometryHoverTargetFromHits as unknown as (
    fallbackTarget: ReturnType<typeof createGeometryHoverTargetSelection>,
    hits: readonly THREE.Intersection<THREE.Object3D>[],
    options?: unknown,
  ) => ReturnType<typeof createGeometryHoverTargetSelection>;

const resolveVisualizerInteractionTargetFromHitsWithOptions =
  resolveVisualizerInteractionTargetFromHits as unknown as (
    object: THREE.Object3D | null,
    hits: readonly THREE.Intersection<THREE.Object3D>[],
    options?: unknown,
  ) => VisualizerHoverTarget | null;

function createTaggedMesh(
  target: VisualizerHoverTarget,
  z: number,
  options: {
    visible?: boolean;
    opacity?: number;
    colorWrite?: boolean;
    depthTest?: boolean;
    isHelper?: boolean;
    renderOrder?: number;
    interactionLayer?:
      | 'ik-handle'
      | 'visual'
      | 'collision'
      | 'origin-axes'
      | 'joint-axis'
      | 'center-of-mass'
      | 'inertia';
  } = {},
) {
  const wrapper = new THREE.Group();
  wrapper.userData = {
    ...wrapper.userData,
    ...createVisualizerHoverUserData(target, options.interactionLayer),
  };
  if (options.isHelper) {
    wrapper.userData.isHelper = true;
  }
  wrapper.visible = options.visible ?? true;
  wrapper.renderOrder = options.renderOrder ?? 0;

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    transparent: options.opacity !== undefined && options.opacity < 1,
    opacity: options.opacity ?? 1,
    colorWrite: options.colorWrite ?? true,
    depthTest: options.depthTest ?? true,
  });

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.position.set(0, 0, z);
  wrapper.add(mesh);

  return { wrapper, mesh };
}

function createTaggedSupportPlane(
  target: VisualizerHoverTarget,
  z: number,
  options: {
    interactionLayer?:
      | 'ik-handle'
      | 'visual'
      | 'collision'
      | 'origin-axes'
      | 'joint-axis'
      | 'center-of-mass'
      | 'inertia';
  } = {},
) {
  const wrapper = new THREE.Group();
  wrapper.name = 'floor';
  wrapper.userData = {
    ...wrapper.userData,
    ...createVisualizerHoverUserData(target, options.interactionLayer),
  };

  const material = new THREE.MeshStandardMaterial({ color: 0x666666 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), material);
  mesh.position.set(0, 0, z);
  wrapper.add(mesh);

  return { wrapper, mesh };
}

function createTaggedHelperOutline(
  target: VisualizerHoverTarget,
  options: {
    meshVisualOnly?: boolean;
    narrowOutlineRaycast?: boolean;
    interactionLayer?:
      | 'ik-handle'
      | 'visual'
      | 'collision'
      | 'origin-axes'
      | 'joint-axis'
      | 'center-of-mass'
      | 'inertia';
  } = {},
) {
  const wrapper = new THREE.Group();
  wrapper.userData = {
    ...wrapper.userData,
    ...createVisualizerHoverUserData(target, options.interactionLayer ?? 'inertia'),
    isHelper: true,
  };

  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.35 }),
  );
  if (options.meshVisualOnly) {
    mesh.raycast = ignoreRaycast;
  }
  wrapper.add(mesh);

  const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  const line = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x93c5fd }));
  if (options.narrowOutlineRaycast) {
    line.raycast = narrowLineRaycast;
  }
  wrapper.add(line);

  return { wrapper, mesh, line };
}

function createTaggedReversedWindingTriangle(
  target: VisualizerHoverTarget,
  material: THREE.Material,
  options: {
    interactionLayer?:
      | 'visual'
      | 'collision'
      | 'origin-axes'
      | 'joint-axis'
      | 'center-of-mass'
      | 'inertia';
  } = {},
) {
  const wrapper = new THREE.Group();
  wrapper.userData = {
    ...wrapper.userData,
    ...createVisualizerHoverUserData(target, options.interactionLayer),
  };

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([-1, -1, -5, 1, -1, -5, 0, 1, -5]), 3),
  );
  geometry.setIndex([0, 2, 1]);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, material);
  wrapper.add(mesh);

  return { wrapper, mesh };
}

test('getVisualizerHoverTarget resolves metadata through geometry ancestors', () => {
  const target: VisualizerHoverTarget = {
    type: 'link',
    id: 'forearm',
    subType: 'visual',
    objectIndex: 2,
  };

  const { wrapper, mesh } = createTaggedMesh(target, -2);
  wrapper.updateMatrixWorld(true);

  assert.deepEqual(getVisualizerHoverTarget(mesh), target);
});

test('getVisualizerHoverTarget preserves helper kinds for tagged helper objects', () => {
  const target: VisualizerHoverTarget = {
    type: 'link',
    id: 'forearm',
    helperKind: 'inertia',
  };

  const { wrapper, mesh } = createTaggedMesh(target, -2, {
    isHelper: true,
    interactionLayer: 'inertia',
  });
  wrapper.updateMatrixWorld(true);

  assert.deepEqual(getVisualizerHoverTarget(mesh), target);
});

test('findNearestVisualizerHoverTarget prefers the closest tagged link when hits overlap', () => {
  const root = new THREE.Group();

  const far = createTaggedMesh(
    {
      type: 'link',
      id: 'far_link',
      subType: 'visual',
      objectIndex: 0,
    },
    -5,
  );

  const near = createTaggedMesh(
    {
      type: 'link',
      id: 'near_link',
      subType: 'visual',
      objectIndex: 1,
    },
    -2,
  );

  root.add(far.wrapper);
  root.add(near.wrapper);
  root.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

  assert.deepEqual(findNearestVisualizerHoverTarget(root, raycaster), {
    type: 'link',
    id: 'near_link',
    subType: 'visual',
    objectIndex: 1,
  });
});

test('findNearestVisualizerHoverTarget ignores closer helper meshes without visualizer hover metadata', () => {
  const root = new THREE.Group();

  const helperMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xff0000 }),
  );
  helperMesh.position.set(0, 0, -1);

  const tagged = createTaggedMesh(
    {
      type: 'link',
      id: 'reachable_link',
      subType: 'collision',
      objectIndex: 0,
    },
    -3,
  );

  root.add(helperMesh);
  root.add(tagged.wrapper);
  root.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

  assert.deepEqual(findNearestVisualizerHoverTarget(root, raycaster), {
    type: 'link',
    id: 'reachable_link',
    subType: 'collision',
    objectIndex: 0,
  });
});

test('findNearestVisualizerHoverTarget ignores inertia fill hits away from the visible outline', () => {
  const root = new THREE.Group();
  const helper = createTaggedHelperOutline(
    {
      type: 'link',
      id: 'inertia_link',
      helperKind: 'inertia',
    },
    { meshVisualOnly: true, narrowOutlineRaycast: true, interactionLayer: 'inertia' },
  );

  root.add(helper.wrapper);
  root.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 2), new THREE.Vector3(0, 0, -1));

  assert.equal(findNearestVisualizerHoverTarget(root, raycaster), null);
});

test('findNearestVisualizerHoverTarget still allows inertia hits close to the visible outline', () => {
  const root = new THREE.Group();
  const helper = createTaggedHelperOutline(
    {
      type: 'link',
      id: 'inertia_link',
      helperKind: 'inertia',
    },
    { meshVisualOnly: true, narrowOutlineRaycast: true, interactionLayer: 'inertia' },
  );

  root.add(helper.wrapper);
  root.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0.52, 2), new THREE.Vector3(0, 0, -1));

  assert.deepEqual(findNearestVisualizerHoverTarget(root, raycaster), {
    type: 'link',
    id: 'inertia_link',
    helperKind: 'inertia',
  });
});

test('resolveVisualizerInteractionTargetFromHits does not force direct inertia mesh hits away from the outline', () => {
  const root = new THREE.Group();
  const helper = createTaggedHelperOutline(
    {
      type: 'link',
      id: 'inertia_link',
      helperKind: 'inertia',
    },
    { narrowOutlineRaycast: true, interactionLayer: 'inertia' },
  );

  root.add(helper.wrapper);
  root.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 2), new THREE.Vector3(0, 0, -1));
  const hits = raycaster.intersectObject(root, true);

  assert.equal(
    resolveVisualizerInteractionTargetFromHits(helper.mesh, hits, {
      interactionLayerPriority: ['inertia'],
    }),
    null,
  );
});

test('findNearestVisualizerHoverTarget skips hidden or fully transparent tagged geometry', () => {
  const root = new THREE.Group();

  const hidden = createTaggedMesh(
    {
      type: 'link',
      id: 'hidden_link',
      subType: 'visual',
      objectIndex: 0,
    },
    -1,
    { visible: false },
  );

  const transparent = createTaggedMesh(
    {
      type: 'link',
      id: 'transparent_link',
      subType: 'visual',
      objectIndex: 0,
    },
    -2,
    { opacity: 0 },
  );

  const fallback = createTaggedMesh(
    {
      type: 'link',
      id: 'fallback_link',
      subType: 'visual',
      objectIndex: 4,
    },
    -4,
  );

  root.add(hidden.wrapper);
  root.add(transparent.wrapper);
  root.add(fallback.wrapper);
  root.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

  assert.deepEqual(findNearestVisualizerHoverTarget(root, raycaster), {
    type: 'link',
    id: 'fallback_link',
    subType: 'visual',
    objectIndex: 4,
  });
});

test('findNearestVisualizerHoverTarget keeps non-rendering pick proxies raycastable', () => {
  const root = new THREE.Group();

  const pickProxy = createTaggedMesh(
    {
      type: 'link',
      id: 'helper_link',
    },
    -1,
    { colorWrite: false },
  );

  root.add(pickProxy.wrapper);
  root.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

  assert.deepEqual(findNearestVisualizerHoverTarget(root, raycaster), {
    type: 'link',
    id: 'helper_link',
  });
});

test('findNearestVisualizerHoverTarget prefers overlay helpers over nearer standard geometry', () => {
  const root = new THREE.Group();

  const geometry = createTaggedMesh(
    {
      type: 'link',
      id: 'front_geometry',
      subType: 'collision',
      objectIndex: 0,
    },
    -1,
  );

  const overlayHelper = createTaggedMesh(
    {
      type: 'link',
      id: 'overlay_helper',
    },
    -2,
    {
      depthTest: false,
      isHelper: true,
    },
  );

  root.add(geometry.wrapper);
  root.add(overlayHelper.wrapper);
  root.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

  assert.deepEqual(findNearestVisualizerHoverTarget(root, raycaster), {
    type: 'link',
    id: 'overlay_helper',
  });
});

test('findNearestVisualizerHoverTarget prefers collision targets over visual targets when layers overlap', () => {
  const root = new THREE.Group();

  const visual = createTaggedMesh(
    {
      type: 'link',
      id: 'shared_link',
      subType: 'visual',
      objectIndex: 0,
    },
    -2,
  );

  const collision = createTaggedMesh(
    {
      type: 'link',
      id: 'shared_link',
      subType: 'collision',
      objectIndex: 1,
    },
    -2.01,
  );

  root.add(visual.wrapper);
  root.add(collision.wrapper);
  root.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

  assert.deepEqual(findNearestVisualizerHoverTarget(root, raycaster), {
    type: 'link',
    id: 'shared_link',
    subType: 'collision',
    objectIndex: 1,
  });
});

test('findNearestVisualizerHoverTarget can hit reversed-winding collision meshes with the shared collision material', () => {
  clearMaterialCache();

  const root = new THREE.Group();
  const material = getCachedMaterial({
    finalColor: '#a855f7',
    matOpacity: 0.3,
    matWireframe: true,
    isCollision: true,
    emissiveColor: '#000000',
    emissiveIntensity: 0,
  });

  const collision = createTaggedReversedWindingTriangle(
    {
      type: 'link',
      id: 'torso_link',
      subType: 'collision',
      objectIndex: 0,
    },
    material,
    {
      interactionLayer: 'collision',
    },
  );

  root.add(collision.wrapper);
  root.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

  assert.deepEqual(findNearestVisualizerHoverTarget(root, raycaster), {
    type: 'link',
    id: 'torso_link',
    subType: 'collision',
    objectIndex: 0,
  });
});

test('findNearestVisualizerHoverTarget honors explicit layer priority over legacy collision bias', () => {
  const root = new THREE.Group();

  const visual = createTaggedMesh(
    {
      type: 'link',
      id: 'shared_link',
      subType: 'visual',
      objectIndex: 0,
    },
    -2,
  );

  const collision = createTaggedMesh(
    {
      type: 'link',
      id: 'shared_link',
      subType: 'collision',
      objectIndex: 1,
    },
    -2.01,
  );

  root.add(visual.wrapper);
  root.add(collision.wrapper);
  root.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

  assert.deepEqual(
    findNearestVisualizerHoverTargetWithOptions(root, raycaster, {
      interactionLayerPriority: ['visual', 'collision'],
    }),
    {
      type: 'link',
      id: 'shared_link',
      subType: 'visual',
      objectIndex: 0,
    },
  );
});

test('findNearestVisualizerHoverTarget deprioritizes floor-like support planes beneath foreground geometry', () => {
  const root = new THREE.Group();

  const floor = createTaggedSupportPlane(
    {
      type: 'link',
      id: 'floor_link',
      subType: 'collision',
      objectIndex: 0,
    },
    -2,
    {
      interactionLayer: 'collision',
    },
  );

  const foreground = createTaggedMesh(
    {
      type: 'link',
      id: 'upper_link',
      subType: 'visual',
      objectIndex: 0,
    },
    -1.5,
    {
      interactionLayer: 'visual',
    },
  );

  root.add(floor.wrapper);
  root.add(foreground.wrapper);
  root.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

  assert.deepEqual(
    findNearestVisualizerHoverTargetWithOptions(root, raycaster, {
      interactionLayerPriority: ['collision', 'visual'],
    }),
    {
      type: 'link',
      id: 'upper_link',
      subType: 'visual',
      objectIndex: 0,
    },
  );
});

test('findNearestVisualizerHoverTarget keeps floor-like support planes hoverable when no foreground target overlaps', () => {
  const root = new THREE.Group();

  const floor = createTaggedSupportPlane(
    {
      type: 'link',
      id: 'floor_link',
      subType: 'collision',
      objectIndex: 0,
    },
    -2,
    {
      interactionLayer: 'collision',
    },
  );

  root.add(floor.wrapper);
  root.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

  assert.deepEqual(
    findNearestVisualizerHoverTargetWithOptions(root, raycaster, {
      interactionLayerPriority: ['collision', 'visual'],
    }),
    {
      type: 'link',
      id: 'floor_link',
      subType: 'collision',
      objectIndex: 0,
    },
  );
});

test('resolveVisualizerInteractionTargetFromHits prefers the directly hit helper target over overlapping link layers', () => {
  const root = new THREE.Group();

  const helper = createTaggedMesh(
    {
      type: 'joint',
      id: 'joint_1',
    },
    -2,
    {
      isHelper: true,
      interactionLayer: 'origin-axes',
    },
  );

  const visual = createTaggedMesh(
    {
      type: 'link',
      id: 'shared_link',
      subType: 'visual',
      objectIndex: 0,
    },
    -1.5,
    {
      interactionLayer: 'visual',
    },
  );

  root.add(helper.wrapper);
  root.add(visual.wrapper);
  root.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));
  const hits = raycaster.intersectObject(root, true);

  assert.deepEqual(
    findNearestVisualizerTargetFromHitsWithOptions(hits, {
      interactionLayerPriority: ['visual', 'origin-axes'],
    }),
    {
      type: 'link',
      id: 'shared_link',
      subType: 'visual',
      objectIndex: 0,
    },
  );

  assert.deepEqual(
    resolveVisualizerInteractionTargetFromHitsWithOptions(helper.mesh, hits, {
      interactionLayerPriority: ['visual', 'origin-axes'],
    }),
    {
      type: 'joint',
      id: 'joint_1',
    },
  );
});

test('resolveVisualizerInteractionTargetFromHits resolves overlapping helpers through layer priority instead of trusting the direct hit blindly', () => {
  const root = new THREE.Group();

  const jointAxisHelper = createTaggedMesh(
    {
      type: 'joint',
      id: 'joint_1',
      helperKind: 'joint-axis',
    },
    -2,
    {
      isHelper: true,
      interactionLayer: 'joint-axis',
    },
  );

  const ikHandleHelper = createTaggedMesh(
    {
      type: 'link',
      id: 'tool_link',
      helperKind: 'ik-handle',
    },
    -1.5,
    {
      isHelper: true,
      interactionLayer: 'ik-handle',
    },
  );

  root.add(jointAxisHelper.wrapper);
  root.add(ikHandleHelper.wrapper);
  root.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));
  const hits = raycaster.intersectObject(root, true);

  assert.deepEqual(
    findNearestVisualizerTargetFromHitsWithOptions(hits, {
      interactionLayerPriority: ['joint-axis', 'ik-handle'],
    }),
    {
      type: 'joint',
      id: 'joint_1',
      helperKind: 'joint-axis',
    },
  );

  assert.deepEqual(
    resolveVisualizerInteractionTargetFromHitsWithOptions(ikHandleHelper.mesh, hits, {
      interactionLayerPriority: ['joint-axis', 'ik-handle'],
    }),
    {
      type: 'joint',
      id: 'joint_1',
      helperKind: 'joint-axis',
    },
  );
});

test('resolveVisualizerInteractionTargetFromHits prefers the joint axis when it overlaps the origin axes helper', () => {
  const root = new THREE.Group();

  const jointAxisHelper = createTaggedMesh(
    {
      type: 'joint',
      id: 'joint_1',
      helperKind: 'joint-axis',
    },
    -2,
    {
      isHelper: true,
      interactionLayer: 'joint-axis',
    },
  );

  const originAxesHelper = createTaggedMesh(
    {
      type: 'link',
      id: 'tool_link',
      helperKind: 'origin-axes',
    },
    -1.5,
    {
      isHelper: true,
      interactionLayer: 'origin-axes',
    },
  );

  root.add(jointAxisHelper.wrapper);
  root.add(originAxesHelper.wrapper);
  root.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));
  const hits = raycaster.intersectObject(root, true);

  assert.deepEqual(
    findNearestVisualizerTargetFromHitsWithOptions(hits, {
      interactionLayerPriority: ['joint-axis', 'origin-axes'],
    }),
    {
      type: 'joint',
      id: 'joint_1',
      helperKind: 'joint-axis',
    },
  );

  assert.deepEqual(
    resolveVisualizerInteractionTargetFromHitsWithOptions(originAxesHelper.mesh, hits, {
      interactionLayerPriority: ['joint-axis', 'origin-axes'],
    }),
    {
      type: 'joint',
      id: 'joint_1',
      helperKind: 'joint-axis',
    },
  );
});

test('findNearestVisualizerTargetFromHits reuses the same nearest-visible filtering for click intersections', () => {
  const root = new THREE.Group();

  const helperMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xff0000 }),
  );
  helperMesh.position.set(0, 0, -1);

  const transparent = createTaggedMesh(
    {
      type: 'link',
      id: 'transparent_link',
      subType: 'visual',
      objectIndex: 0,
    },
    -2,
    { opacity: 0 },
  );

  const near = createTaggedMesh(
    {
      type: 'link',
      id: 'near_link',
      subType: 'collision',
      objectIndex: 3,
    },
    -3,
  );

  const far = createTaggedMesh(
    {
      type: 'link',
      id: 'far_link',
      subType: 'visual',
      objectIndex: 1,
    },
    -5,
  );

  root.add(helperMesh);
  root.add(transparent.wrapper);
  root.add(near.wrapper);
  root.add(far.wrapper);
  root.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));
  const hits = raycaster.intersectObject(root, true);

  assert.deepEqual(findNearestVisualizerTargetFromHits(hits), {
    type: 'link',
    id: 'near_link',
    subType: 'collision',
    objectIndex: 3,
  });
});

test('findNearestVisualizerHoverTarget returns joint targets when the joint helper is visually on top', () => {
  const root = new THREE.Group();

  const jointHelper = createTaggedMesh(
    {
      type: 'joint',
      id: 'joint_1',
    },
    -1,
    {
      depthTest: false,
      isHelper: true,
      renderOrder: 10000,
    },
  );

  const collision = createTaggedMesh(
    {
      type: 'link',
      id: 'forearm_link',
      subType: 'collision',
      objectIndex: 0,
    },
    -3,
  );

  root.add(jointHelper.wrapper);
  root.add(collision.wrapper);
  root.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

  assert.deepEqual(findNearestVisualizerHoverTarget(root, raycaster), {
    type: 'joint',
    id: 'joint_1',
  });
});

test('findNearestVisualizerHoverTarget keeps a nearer origin helper above farther collision geometry even when collision has higher layer priority', () => {
  const root = new THREE.Group();

  const originHelper = createTaggedMesh(
    {
      type: 'link',
      id: 'base_link',
    },
    -1,
    {
      isHelper: true,
      interactionLayer: 'origin-axes',
    },
  );

  const collision = createTaggedMesh(
    {
      type: 'link',
      id: 'base_link',
      subType: 'collision',
      objectIndex: 0,
    },
    -3,
    {
      interactionLayer: 'collision',
    },
  );

  root.add(originHelper.wrapper);
  root.add(collision.wrapper);
  root.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

  assert.deepEqual(
    findNearestVisualizerHoverTargetWithOptions(root, raycaster, {
      interactionLayerPriority: ['collision', 'origin-axes'],
    }),
    {
      type: 'link',
      id: 'base_link',
    },
  );
});

test('findNearestVisualizerHoverTarget keeps an overlapping center-of-mass helper above same-link collision geometry', () => {
  const root = new THREE.Group();

  const centerOfMassHelper = createTaggedMesh(
    {
      type: 'link',
      id: 'base_link',
      helperKind: 'center-of-mass',
    },
    -3,
    {
      isHelper: true,
      interactionLayer: 'center-of-mass',
      renderOrder: 10000,
      depthTest: false,
    },
  );

  const collision = createTaggedMesh(
    {
      type: 'link',
      id: 'base_link',
      subType: 'collision',
      objectIndex: 0,
    },
    -1,
    {
      interactionLayer: 'collision',
    },
  );

  root.add(centerOfMassHelper.wrapper);
  root.add(collision.wrapper);
  root.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));

  assert.deepEqual(
    findNearestVisualizerHoverTargetWithOptions(root, raycaster, {
      interactionLayerPriority: ['collision', 'center-of-mass'],
    }),
    {
      type: 'link',
      id: 'base_link',
      helperKind: 'center-of-mass',
    },
  );
});

test('resolveGeometryHoverTargetFromHits promotes collision hover above overlapping visual geometry', () => {
  const root = new THREE.Group();

  const visual = createTaggedMesh(
    {
      type: 'link',
      id: 'shared_link',
      subType: 'visual',
      objectIndex: 0,
    },
    -2,
  );

  const collision = createTaggedMesh(
    {
      type: 'link',
      id: 'shared_link',
      subType: 'collision',
      objectIndex: 1,
    },
    -2.01,
  );

  root.add(visual.wrapper);
  root.add(collision.wrapper);
  root.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));
  const hits = raycaster.intersectObject(root, true);

  assert.deepEqual(
    resolveGeometryHoverTargetFromHits(
      createGeometryHoverTargetSelection('shared_link', 'visual', 0),
      hits,
    ),
    createGeometryHoverTargetSelection('shared_link', 'collision', 1),
  );
});

test('resolveGeometryHoverTargetFromHits honors explicit visual-first layer priority', () => {
  const root = new THREE.Group();

  const visual = createTaggedMesh(
    {
      type: 'link',
      id: 'shared_link',
      subType: 'visual',
      objectIndex: 0,
    },
    -2,
  );

  const collision = createTaggedMesh(
    {
      type: 'link',
      id: 'shared_link',
      subType: 'collision',
      objectIndex: 1,
    },
    -2.01,
  );

  root.add(visual.wrapper);
  root.add(collision.wrapper);
  root.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));
  const hits = raycaster.intersectObject(root, true);

  assert.deepEqual(
    resolveGeometryHoverTargetFromHitsWithOptions(
      createGeometryHoverTargetSelection('shared_link', 'collision', 1),
      hits,
      { interactionLayerPriority: ['visual', 'collision'] },
    ),
    createGeometryHoverTargetSelection('shared_link', 'visual', 0),
  );
});

test('resolveGeometryHoverTargetFromHits yields to a nearer link helper instead of forcing geometry hover', () => {
  const root = new THREE.Group();

  const helper = createTaggedMesh(
    {
      type: 'link',
      id: 'shared_link',
    },
    -1,
    {
      isHelper: true,
      interactionLayer: 'origin-axes',
    },
  );

  const collision = createTaggedMesh(
    {
      type: 'link',
      id: 'shared_link',
      subType: 'collision',
      objectIndex: 0,
    },
    -3,
    {
      interactionLayer: 'collision',
    },
  );

  root.add(helper.wrapper);
  root.add(collision.wrapper);
  root.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));
  const hits = raycaster.intersectObject(root, true);
  const fallbackTarget = createGeometryHoverTargetSelection('shared_link', 'collision', 0);

  assert.equal(
    resolveGeometryHoverTargetFromHitsWithOptions(fallbackTarget, hits, {
      interactionLayerPriority: ['collision', 'origin-axes'],
    }),
    null,
  );
});

test('resolveGeometryHoverTargetFromHits yields to a nearer joint helper instead of forcing geometry hover', () => {
  const root = new THREE.Group();

  const jointHelper = createTaggedMesh(
    {
      type: 'joint',
      id: 'joint_1',
    },
    -1,
    {
      depthTest: false,
      isHelper: true,
      renderOrder: 10000,
    },
  );

  root.add(jointHelper.wrapper);
  root.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1));
  const hits = raycaster.intersectObject(root, true);
  const fallbackTarget = createGeometryHoverTargetSelection('shared_link', 'visual', 0);

  assert.equal(resolveGeometryHoverTargetFromHits(fallbackTarget, hits), null);
});
