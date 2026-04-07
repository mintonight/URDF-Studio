import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_JOINT, DEFAULT_LINK, GeometryType, JointType, type RobotFile } from '@/types';
import type { RobotImportResult } from '@/core/parsers/importRobotFile';
import { useAssemblyStore } from './assemblyStore.ts';

function assertNearlyEqual(actual: number, expected: number, message: string) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${message}: expected ${expected}, received ${actual}`,
  );
}

function resetAssemblyStore() {
  const state = useAssemblyStore.getState();
  state.clearHistory();
  state.exitAssembly();
  state.setAssembly(null);
}

function createReadyImportResult(): RobotImportResult {
  return {
    status: 'ready',
    format: 'urdf',
    robotData: {
      name: 'resolved_demo',
      rootLinkId: 'base_link',
      links: {
        base_link: {
          ...DEFAULT_LINK,
          id: 'base_link',
          name: 'base_link',
          visible: true,
        },
      },
      joints: {},
    },
    resolvedUrdfContent: `<?xml version="1.0"?>
<robot name="resolved_demo">
  <link name="base_link" />
</robot>`,
    resolvedUrdfSourceFilePath: 'robots/demo/broken.urdf',
  };
}

function createReadyMeshImportResult(): RobotImportResult {
  return {
    status: 'ready',
    format: 'urdf',
    robotData: {
      name: 'resolved_mesh_demo',
      rootLinkId: 'base_link',
      links: {
        base_link: {
          ...DEFAULT_LINK,
          id: 'base_link',
          name: 'base_link',
          visible: true,
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.MESH,
            dimensions: { x: 1, y: 1, z: 1 },
            meshPath: 'robots/demo/mesh.stl',
          },
          collision: {
            ...DEFAULT_LINK.collision,
            type: GeometryType.NONE,
            dimensions: { x: 0, y: 0, z: 0 },
          },
        },
      },
      joints: {},
    },
    resolvedUrdfContent: `<?xml version="1.0"?>
<robot name="resolved_mesh_demo">
  <link name="base_link" />
</robot>`,
    resolvedUrdfSourceFilePath: 'robots/demo/mesh.urdf',
  };
}

function createReadyMeshCollisionFallbackImportResult(): RobotImportResult {
  return {
    status: 'ready',
    format: 'urdf',
    robotData: {
      name: 'resolved_mesh_fallback_demo',
      rootLinkId: 'base_link',
      links: {
        base_link: {
          ...DEFAULT_LINK,
          id: 'base_link',
          name: 'base_link',
          visible: true,
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.BOX,
            dimensions: { x: 0.2, y: 0.2, z: 0.2 },
            origin: {
              xyz: { x: 0, y: 0, z: 0.05 },
              rpy: { r: 0, p: 0, y: 0 },
            },
          },
          collision: {
            ...DEFAULT_LINK.collision,
            type: GeometryType.NONE,
            dimensions: { x: 0, y: 0, z: 0 },
          },
        },
        foot_link: {
          ...DEFAULT_LINK,
          id: 'foot_link',
          name: 'foot_link',
          visible: true,
          visual: {
            ...DEFAULT_LINK.visual,
            type: GeometryType.MESH,
            dimensions: { x: 1, y: 1, z: 1 },
            meshPath: 'robots/demo/missing-foot.stl',
          },
          collision: {
            ...DEFAULT_LINK.collision,
            type: GeometryType.BOX,
            dimensions: { x: 0.2, y: 0.2, z: 0.2 },
            origin: {
              xyz: { x: 0, y: 0, z: 0 },
              rpy: { r: 0, p: 0, y: 0 },
            },
          },
        },
      },
      joints: {
        foot_joint: {
          ...DEFAULT_JOINT,
          id: 'foot_joint',
          name: 'foot_joint',
          type: JointType.FIXED,
          parentLinkId: 'base_link',
          childLinkId: 'foot_link',
          origin: {
            xyz: { x: 0, y: 0, z: -0.8 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
      },
    },
    resolvedUrdfContent: `<?xml version="1.0"?>
<robot name="resolved_mesh_fallback_demo">
  <link name="base_link" />
  <link name="foot_link" />
  <joint name="foot_joint" type="fixed">
    <parent link="base_link" />
    <child link="foot_link" />
  </joint>
</robot>`,
    resolvedUrdfSourceFilePath: 'robots/demo/missing-foot.urdf',
  };
}

test('addComponent reuses a pre-resolved ready import result for non-USD files', () => {
  resetAssemblyStore();

  useAssemblyStore.getState().initAssembly('pre-resolved-import');

  const invalidUrdfFile: RobotFile = {
    name: 'robots/demo/broken.urdf',
    content: '<robot name="broken">',
    format: 'urdf',
  };

  const preResolvedImportResult = createReadyImportResult();

  const component = useAssemblyStore.getState().addComponent(invalidUrdfFile, {
    preResolvedImportResult,
  });

  assert.ok(component, 'component should be created from the pre-resolved import result');
  assert.equal(component?.name, 'broken');
  assert.equal(component?.sourceFile, 'robots/demo/broken.urdf');
  assert.equal(component?.robot.name, 'resolved_demo');
  assert.ok(component?.robot.links.comp_broken_base_link);
  assert.equal(component?.robot.rootLinkId, 'comp_broken_base_link');
});

test('addComponent records patch-based undo history for incremental assembly updates', () => {
  resetAssemblyStore();

  const store = useAssemblyStore.getState();
  store.initAssembly('patch-history');
  store.clearHistory();

  const component = store.addComponent(
    {
      name: 'robots/demo/patchy.urdf',
      format: 'urdf',
      content: '<robot name="patchy" />',
    },
    {
      preResolvedImportResult: createReadyImportResult(),
    },
  );

  assert.ok(component, 'component should be created before checking patch history');

  const historyEntry = useAssemblyStore.getState()._history.past[0] as
    | { kind?: string }
    | undefined;
  assert.equal(historyEntry?.kind, 'patch');

  store.undo();
  assert.equal(
    useAssemblyStore.getState().assemblyState?.components[component.id],
    undefined,
    'undo should remove the incrementally-added component',
  );

  store.redo();
  assert.ok(
    useAssemblyStore.getState().assemblyState?.components[component.id],
    'redo should restore the incrementally-added component',
  );
});

test('updateComponentTransform clones the transform and tracks undo redo history', () => {
  resetAssemblyStore();

  const store = useAssemblyStore.getState();
  store.initAssembly('transform-history');

  const component = store.addComponent(
    {
      name: 'robots/demo/component.urdf',
      format: 'urdf',
      content: '<robot name="component" />',
    },
    {
      preResolvedImportResult: createReadyImportResult(),
    },
  );

  assert.ok(component, 'component should be created before updating transform');
  store.clearHistory();

  const nextTransform = {
    position: { x: 0.5, y: -1.25, z: 2 },
    rotation: { r: 0.1, p: -0.2, y: 0.3 },
  };

  store.updateComponentTransform(component.id, nextTransform);
  nextTransform.position.x = 999;

  assert.deepEqual(useAssemblyStore.getState().assemblyState?.components[component.id]?.transform, {
    position: { x: 0.5, y: -1.25, z: 2 },
    rotation: { r: 0.1, p: -0.2, y: 0.3 },
  });
  assert.equal(store.canUndo(), true);

  store.undo();
  assert.deepEqual(useAssemblyStore.getState().assemblyState?.components[component.id]?.transform, {
    position: { x: 0, y: 0, z: 0.25 },
    rotation: { r: 0, p: 0, y: 0 },
  });

  store.redo();
  assert.deepEqual(useAssemblyStore.getState().assemblyState?.components[component.id]?.transform, {
    position: { x: 0.5, y: -1.25, z: 2 },
    rotation: { r: 0.1, p: -0.2, y: 0.3 },
  });
});

test('updateAssemblyTransform clones the transform and tracks undo redo history', () => {
  resetAssemblyStore();

  const store = useAssemblyStore.getState();
  store.initAssembly('assembly-transform-history');
  store.clearHistory();

  const nextTransform = {
    position: { x: 3, y: 4, z: -2 },
    rotation: { r: -0.15, p: 0.25, y: 0.5 },
  };

  store.updateAssemblyTransform(nextTransform);
  nextTransform.rotation.y = 999;

  assert.deepEqual(useAssemblyStore.getState().assemblyState?.transform, {
    position: { x: 3, y: 4, z: -2 },
    rotation: { r: -0.15, p: 0.25, y: 0.5 },
  });
  assert.equal(store.canUndo(), true);

  store.undo();
  assert.deepEqual(useAssemblyStore.getState().assemblyState?.transform, {
    position: { x: 0, y: 0, z: 0 },
    rotation: { r: 0, p: 0, y: 0 },
  });

  store.redo();
  assert.deepEqual(useAssemblyStore.getState().assemblyState?.transform, {
    position: { x: 3, y: 4, z: -2 },
    rotation: { r: -0.15, p: 0.25, y: 0.5 },
  });
});

test('addComponent falls back to a fresh identity when a prepared component becomes stale', () => {
  resetAssemblyStore();

  const store = useAssemblyStore.getState();
  store.initAssembly('prepared-component-fallback');

  const file: RobotFile = {
    name: 'robots/demo/component.urdf',
    format: 'urdf',
    content: '<robot name="component" />',
  };

  const existingComponent = store.addComponent(file, {
    preResolvedImportResult: createReadyImportResult(),
  });

  assert.ok(existingComponent, 'existing component should be created first');

  const component = store.addComponent(file, {
    preResolvedImportResult: createReadyImportResult(),
    preparedComponent: {
      componentId: 'comp_component',
      displayName: 'component',
      robotData: {
        name: 'stale_component',
        rootLinkId: 'comp_component_base_link',
        links: {
          comp_component_base_link: {
            ...DEFAULT_LINK,
            id: 'comp_component_base_link',
            name: 'component',
            visible: true,
          },
        },
        joints: {},
      },
    },
  });

  assert.ok(component, 'component should still be added when stale prepared data collides');
  assert.equal(component?.id, 'comp_component_1');
  assert.equal(component?.name, 'component_1');
  assert.ok(component?.robot.links.comp_component_1_base_link);
  assert.equal(component?.robot.rootLinkId, 'comp_component_1_base_link');
});

test('addComponent grounds the first component and places later components beside it on the ground', () => {
  resetAssemblyStore();

  const store = useAssemblyStore.getState();
  store.initAssembly('default-placement');

  const first = store.addComponent(
    {
      name: 'robots/demo/anchor.urdf',
      format: 'urdf',
      content: '<robot name="anchor" />',
    },
    {
      preResolvedImportResult: createReadyImportResult(),
    },
  );

  const second = store.addComponent(
    {
      name: 'robots/demo/follower.urdf',
      format: 'urdf',
      content: '<robot name="follower" />',
    },
    {
      preResolvedImportResult: createReadyImportResult(),
    },
  );

  assert.ok(first, 'first component should be created');
  assert.ok(second, 'second component should be created');
  assert.deepEqual(first?.transform, {
    position: { x: 0, y: 0, z: 0.25 },
    rotation: { r: 0, p: 0, y: 0 },
  });
  assert.ok(second?.transform, 'second component should receive an explicit initial transform');
  assertNearlyEqual(
    second.transform.position.x,
    0.22,
    'later component x placement should be offset from the anchor',
  );
  assertNearlyEqual(
    second.transform.position.y,
    0,
    'later component y placement should stay level with the anchor',
  );
  assertNearlyEqual(
    second.transform.position.z,
    0.25,
    'later component should be lifted so its lowest point rests on the ground',
  );
  assert.deepEqual(second.transform.rotation, { r: 0, p: 0, y: 0 });
});

test('addComponent queues newly inserted components for visual auto-ground by default', () => {
  resetAssemblyStore();

  const store = useAssemblyStore.getState();
  store.initAssembly('pending-auto-ground');

  const component = store.addComponent(
    {
      name: 'robots/demo/floating.urdf',
      format: 'urdf',
      content: '<robot name="floating" />',
    },
    {
      preResolvedImportResult: createReadyImportResult(),
    },
  );

  assert.ok(component, 'component should be created before checking the auto-ground queue');
  assert.deepEqual(useAssemblyStore.getState().pendingAutoGroundComponentIds, [component.id]);

  store.consumePendingAutoGroundComponentIds([component.id]);
  assert.deepEqual(useAssemblyStore.getState().pendingAutoGroundComponentIds, []);
});

test('addComponent can skip visual auto-ground queue for seed workspace components', () => {
  resetAssemblyStore();

  const store = useAssemblyStore.getState();
  store.initAssembly('seed-component');

  const component = store.addComponent(
    {
      name: 'robots/demo/seed.urdf',
      format: 'urdf',
      content: '<robot name="seed" />',
    },
    {
      preResolvedImportResult: createReadyImportResult(),
      queueAutoGround: false,
    },
  );

  assert.ok(component, 'seed component should still be created');
  assert.deepEqual(
    useAssemblyStore.getState().pendingAutoGroundComponentIds,
    [],
    'seed components should preserve their authored transform without delayed auto-ground replay',
  );
});

test('updateComponentTransform consumes pending visual auto-ground for authored component moves', () => {
  resetAssemblyStore();

  const store = useAssemblyStore.getState();
  store.initAssembly('pending-authored-transform');

  const component = store.addComponent(
    {
      name: 'robots/demo/authored.urdf',
      format: 'urdf',
      content: '<robot name="authored" />',
    },
    {
      preResolvedImportResult: createReadyImportResult(),
    },
  );

  assert.ok(component, 'component should be created before moving it');
  assert.deepEqual(useAssemblyStore.getState().pendingAutoGroundComponentIds, [component.id]);

  store.updateComponentTransform(component.id, {
    position: { x: 1, y: 2, z: 3 },
    rotation: { r: 0, p: 0, y: 0.5 },
  });

  assert.deepEqual(
    useAssemblyStore.getState().pendingAutoGroundComponentIds,
    [],
    'authoring a component transform should cancel any deferred visual auto-ground',
  );
});

test('addBridge consumes pending visual auto-ground for the aligned child component', () => {
  resetAssemblyStore();

  const store = useAssemblyStore.getState();
  store.initAssembly('pending-bridge-alignment');

  const parent = store.addComponent(
    {
      name: 'robots/demo/parent.urdf',
      format: 'urdf',
      content: '<robot name="parent" />',
    },
    {
      preResolvedImportResult: createReadyImportResult(),
    },
  );
  const child = store.addComponent(
    {
      name: 'robots/demo/child.urdf',
      format: 'urdf',
      content: '<robot name="child" />',
    },
    {
      preResolvedImportResult: createReadyImportResult(),
    },
  );

  assert.ok(parent, 'parent component should be created');
  assert.ok(child, 'child component should be created');

  store.consumePendingAutoGroundComponentIds([parent.id]);
  assert.deepEqual(useAssemblyStore.getState().pendingAutoGroundComponentIds, [child.id]);

  store.addBridge({
    name: 'parent_child_bridge',
    parentComponentId: parent.id,
    parentLinkId: parent.robot.rootLinkId,
    childComponentId: child.id,
    childLinkId: child.robot.rootLinkId,
    joint: {
      type: JointType.FIXED,
      origin: {
        xyz: { x: 0, y: 0, z: 0 },
        rpy: { r: 0, p: 0, y: 0 },
      },
    },
  });

  assert.deepEqual(
    useAssemblyStore.getState().pendingAutoGroundComponentIds,
    [],
    'bridge-aligned child components should not be re-grounded after their authored bridge transform is applied',
  );
});

test('addComponent uses prepared renderable bounds for mesh component grounding', () => {
  resetAssemblyStore();

  const store = useAssemblyStore.getState();
  store.initAssembly('prepared-mesh-grounding');

  const first = store.addComponent(
    {
      name: 'robots/demo/anchor.urdf',
      format: 'urdf',
      content: '<robot name="anchor" />',
    },
    {
      preResolvedImportResult: createReadyImportResult(),
    },
  );

  const second = store.addComponent(
    {
      name: 'robots/demo/follower.urdf',
      format: 'urdf',
      content: '<robot name="follower" />',
    },
    {
      preparedComponent: {
        componentId: 'comp_follower',
        displayName: 'follower',
        robotData: {
          name: 'resolved_mesh_demo',
          rootLinkId: 'comp_follower_base_link',
          links: {
            comp_follower_base_link: {
              ...DEFAULT_LINK,
              id: 'comp_follower_base_link',
              name: 'comp_follower_base_link',
              visible: true,
              visual: {
                ...DEFAULT_LINK.visual,
                type: GeometryType.MESH,
                dimensions: { x: 1, y: 1, z: 1 },
                meshPath: 'robots/demo/mesh.stl',
              },
              collision: {
                ...DEFAULT_LINK.collision,
                type: GeometryType.NONE,
                dimensions: { x: 0, y: 0, z: 0 },
              },
            },
          },
          joints: {},
        },
        renderableBounds: {
          min: { x: -0.4, y: -0.25, z: -1.1 },
          max: { x: 0.4, y: 0.25, z: 0.3 },
        },
      } as any,
    },
  );

  assert.ok(first, 'anchor component should be created');
  assert.ok(second, 'prepared mesh component should be created');
  assertNearlyEqual(
    second.transform?.position.z ?? Number.NaN,
    1.1,
    'prepared mesh component should use the provided renderable bounds instead of placeholder mesh extents',
  );
});

test('addComponent does not use placeholder mesh bounds when no real renderable bounds are available', () => {
  resetAssemblyStore();

  const store = useAssemblyStore.getState();
  store.initAssembly('mesh-grounding-without-bounds');

  const first = store.addComponent(
    {
      name: 'robots/demo/anchor.urdf',
      format: 'urdf',
      content: '<robot name="anchor" />',
    },
    {
      preResolvedImportResult: createReadyImportResult(),
    },
  );

  const second = store.addComponent(
    {
      name: 'robots/demo/mesh.urdf',
      format: 'urdf',
      content: '<robot name="mesh" />',
    },
    {
      preResolvedImportResult: createReadyMeshImportResult(),
    },
  );

  assert.ok(first, 'anchor component should be created');
  assert.ok(second, 'mesh component should be created');
  assertNearlyEqual(
    second.transform?.position.z ?? Number.NaN,
    0,
    'mesh component should preserve its authored height until real renderable bounds are available',
  );
});

test('addComponent falls back to collision grounding for mesh-only links when prepared bounds are unavailable', () => {
  resetAssemblyStore();

  const store = useAssemblyStore.getState();
  store.initAssembly('mesh-grounding-link-fallback');

  const first = store.addComponent(
    {
      name: 'robots/demo/anchor.urdf',
      format: 'urdf',
      content: '<robot name="anchor" />',
    },
    {
      preResolvedImportResult: createReadyImportResult(),
    },
  );

  const second = store.addComponent(
    {
      name: 'robots/demo/missing-foot.urdf',
      format: 'urdf',
      content: '<robot name="missing-foot" />',
    },
    {
      preResolvedImportResult: createReadyMeshCollisionFallbackImportResult(),
    },
  );

  assert.ok(first, 'anchor component should be created');
  assert.ok(second, 'mesh fallback component should be created');
  assertNearlyEqual(
    second.transform?.position.z ?? Number.NaN,
    0.9,
    'mesh-only links should still ground from authored collision geometry when renderable bounds are unavailable',
  );
});

test('addComponent reuses a worker-suggested transform from the prepared component payload', () => {
  resetAssemblyStore();

  const store = useAssemblyStore.getState();
  store.initAssembly('prepared-transform');

  const anchor = store.addComponent(
    {
      name: 'robots/demo/anchor.urdf',
      format: 'urdf',
      content: '<robot name="anchor" />',
    },
    {
      preResolvedImportResult: createReadyImportResult(),
    },
  );

  const suggestedTransform = {
    position: { x: 3.5, y: -0.75, z: 1.25 },
    rotation: { r: 0, p: 0, y: 0.4 },
  };

  const preparedRobotData = {
    name: 'worker_demo',
    rootLinkId: 'comp_worker_demo_base_link',
    links: {
      comp_worker_demo_base_link: {
        ...DEFAULT_LINK,
        id: 'comp_worker_demo_base_link',
        name: 'worker_demo',
        visible: true,
      },
    },
    joints: {},
  };

  const inserted = store.addComponent(
    {
      name: 'robots/demo/worker.urdf',
      format: 'urdf',
      content: '<robot name="worker" />',
    },
    {
      preparedComponent: {
        componentId: 'comp_worker_demo',
        displayName: 'worker_demo',
        robotData: preparedRobotData,
        renderableBounds: {
          min: { x: -0.2, y: -0.2, z: 0 },
          max: { x: 0.2, y: 0.2, z: 0.8 },
        },
        suggestedTransform,
      },
    },
  );

  assert.ok(anchor, 'anchor component should be created');
  assert.ok(inserted, 'prepared component should be created');
  assert.deepEqual(
    inserted?.transform,
    suggestedTransform,
    'prepared component should reuse the worker-suggested transform instead of recomputing placement on the main thread',
  );
});
