import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_JOINT, DEFAULT_LINK, JointType, type RobotData, type RobotFile } from '@/types';
import {
  createMemoizedRendererBackendLoadScopeKey,
  createRendererBackendLoadScopeKey,
  type RendererBackendLoadScopeKeyMemo,
} from './rendererBackendLoadScope.ts';

type DraggableFormat = RobotFile['format'] | 'usda';

function createRobotData(angle: number): RobotData {
  return {
    name: 'demo',
    rootLinkId: 'base',
    links: {
      base: {
        ...structuredClone(DEFAULT_LINK),
        id: 'base',
        name: 'base',
      },
      arm: {
        ...structuredClone(DEFAULT_LINK),
        id: 'arm',
        name: 'arm',
      },
    },
    joints: {
      shoulder: {
        ...structuredClone(DEFAULT_JOINT),
        id: 'shoulder',
        name: 'shoulder',
        type: JointType.REVOLUTE,
        parentLinkId: 'base',
        childLinkId: 'arm',
        angle,
      },
    },
    materials: {},
  };
}

const sourceFile: RobotFile = {
  name: 'demo.urdf',
  format: 'urdf',
  content: '<robot name="demo" />',
};

function createSourceFile(format: DraggableFormat): RobotFile {
  const isUsdLike = format === 'usd' || format === 'usda';
  return {
    name: `demo.${format}`,
    format: format as RobotFile['format'],
    content: isUsdLike ? '#usda 1.0' : '<robot name="demo" />',
  };
}

test('createRendererBackendLoadScopeKey ignores transient joint motion changes', () => {
  const firstKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    robotData: createRobotData(0),
  });
  const secondKey = createRendererBackendLoadScopeKey({
    sourceFile: { ...sourceFile },
    assets: {},
    reloadToken: 0,
    robotData: createRobotData(1),
  });

  assert.equal(secondKey, firstKey);
});

test('createRendererBackendLoadScopeKey ignores transient joint motion changes for draggable formats', () => {
  const formats: DraggableFormat[] = ['urdf', 'sdf', 'mjcf', 'usd', 'usda'];

  formats.forEach((format) => {
    const formatSourceFile = createSourceFile(format);
    const firstKey = createRendererBackendLoadScopeKey({
      sourceFile: formatSourceFile,
      assets: {},
      reloadToken: 0,
      robotData: createRobotData(0),
    });
    const secondKey = createRendererBackendLoadScopeKey({
      sourceFile: { ...formatSourceFile },
      assets: {},
      reloadToken: 0,
      robotData: createRobotData(1),
    });

    assert.equal(secondKey, firstKey, `${format} motion changes should not trigger a reload`);
  });
});

test('createMemoizedRendererBackendLoadScopeKey reuses the key for transient joint motion only', () => {
  const memo: RendererBackendLoadScopeKeyMemo = {};
  const robotData = createRobotData(0);
  const firstKey = createMemoizedRendererBackendLoadScopeKey(
    {
      sourceFile,
      assets: {},
      reloadToken: 0,
      robotData,
    },
    memo,
  );
  const movedRobotData = {
    ...robotData,
    joints: {
      ...robotData.joints,
      shoulder: {
        ...robotData.joints.shoulder,
        angle: 1,
      },
    },
  };
  const secondKey = createMemoizedRendererBackendLoadScopeKey(
    {
      sourceFile,
      assets: {},
      reloadToken: 0,
      robotData: movedRobotData,
    },
    memo,
  );

  assert.equal(secondKey, firstKey);
});

test('createMemoizedRendererBackendLoadScopeKey reuses the key for patchable joint origin edits', () => {
  const memo: RendererBackendLoadScopeKeyMemo = {};
  const robotData = createRobotData(0);
  const assets: Record<string, string> = {};
  const firstKey = createMemoizedRendererBackendLoadScopeKey(
    {
      sourceFile,
      assets,
      reloadToken: 0,
      robotData,
    },
    memo,
  );
  const editedRobotData = {
    ...robotData,
    joints: {
      ...robotData.joints,
      shoulder: {
        ...robotData.joints.shoulder,
        origin: {
          ...robotData.joints.shoulder.origin,
          xyz: {
            ...robotData.joints.shoulder.origin.xyz,
            z: 0.4,
          },
        },
      },
    },
  };
  const secondKey = createMemoizedRendererBackendLoadScopeKey(
    {
      sourceFile,
      assets,
      reloadToken: 0,
      robotData: editedRobotData,
    },
    memo,
  );

  assert.equal(secondKey, firstKey);
});

test('createMemoizedRendererBackendLoadScopeKey reuses keys for transient motion across draggable formats', () => {
  const formats: DraggableFormat[] = ['urdf', 'sdf', 'mjcf', 'usd', 'usda'];

  formats.forEach((format) => {
    const memo: RendererBackendLoadScopeKeyMemo = {};
    const robotData = createRobotData(0);
    const formatSourceFile = createSourceFile(format);
    const firstKey = createMemoizedRendererBackendLoadScopeKey(
      {
        sourceFile: formatSourceFile,
        assets: {},
        reloadToken: 0,
        robotData,
      },
      memo,
    );
    const movedRobotData = {
      ...robotData,
      joints: {
        ...robotData.joints,
        shoulder: {
          ...robotData.joints.shoulder,
          angle: 1,
        },
      },
    };
    const secondKey = createMemoizedRendererBackendLoadScopeKey(
      {
        sourceFile: { ...formatSourceFile },
        assets: {},
        reloadToken: 0,
        robotData: movedRobotData,
      },
      memo,
    );

    assert.equal(secondKey, firstKey, `${format} motion changes should reuse the load scope`);
  });
});

test('createMemoizedRendererBackendLoadScopeKey recomputes for structural joint edits', () => {
  const memo: RendererBackendLoadScopeKeyMemo = {};
  const robotData = createRobotData(0);
  const firstKey = createMemoizedRendererBackendLoadScopeKey(
    {
      sourceFile,
      assets: {},
      reloadToken: 0,
      robotData,
    },
    memo,
  );
  const editedRobotData = {
    ...robotData,
    joints: {
      ...robotData.joints,
      shoulder: {
        ...robotData.joints.shoulder,
        childLinkId: 'missing_child_link',
      },
    },
  };
  const secondKey = createMemoizedRendererBackendLoadScopeKey(
    {
      sourceFile,
      assets: {},
      reloadToken: 0,
      robotData: editedRobotData,
    },
    memo,
  );

  assert.notEqual(secondKey, firstKey);
});

test('createRendererBackendLoadScopeKey stays stable for joint type edits', () => {
  const baselineRobotData = createRobotData(0);
  const editedRobotData = createRobotData(0);
  editedRobotData.joints.shoulder.type = JointType.PRISMATIC;

  const firstKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    robotData: baselineRobotData,
  });
  const secondKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    robotData: editedRobotData,
  });

  assert.equal(secondKey, firstKey);
});

test('createRendererBackendLoadScopeKey changes for structural robot edits', () => {
  const baselineRobotData = createRobotData(0);
  const editedRobotData = createRobotData(0);
  editedRobotData.joints.shoulder.childLinkId = 'missing_child_link';

  const firstKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    robotData: baselineRobotData,
  });
  const secondKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    robotData: editedRobotData,
  });

  assert.notEqual(secondKey, firstKey);
});

test('createRendererBackendLoadScopeKey stays stable for joint origin edits', () => {
  // A joint origin change is patchable runtime state (the joint analog of the
  // visual-color edit below): it is applied in place by the joint-patch path,
  // so it must NOT churn the load scope key and trigger a full rebuild — that
  // was the multi-model link/component drag snap-back.
  const baselineRobotData = createRobotData(0);
  const editedRobotData = createRobotData(0);
  editedRobotData.joints.shoulder.origin.xyz.x = 0.25;
  editedRobotData.joints.shoulder.origin.rpy.y = 0.4;

  const firstKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    robotData: baselineRobotData,
  });
  const secondKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    robotData: editedRobotData,
  });

  assert.equal(secondKey, firstKey);
});

test('createRendererBackendLoadScopeKey stays stable for primary visual color edits', () => {
  const baselineRobotData = createRobotData(0);
  const editedRobotData = createRobotData(0);
  baselineRobotData.links.base.visual.color = '#808080';
  editedRobotData.links.base.visual.color = '#12ab34';

  const firstKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    robotData: baselineRobotData,
  });
  const secondKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    robotData: editedRobotData,
  });

  assert.equal(secondKey, firstKey);
});

test('createRendererBackendLoadScopeKey stays stable for authored material color edits', () => {
  const baselineRobotData = createRobotData(0);
  const editedRobotData = createRobotData(0);
  baselineRobotData.links.base.visual.authoredMaterials = [
    { name: 'body', color: '#808080' },
    { name: 'trim', color: '#101010' },
  ];
  editedRobotData.links.base.visual.authoredMaterials = [
    { name: 'body', color: '#12ab34' },
    { name: 'trim', color: '#101010' },
  ];

  const firstKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    robotData: baselineRobotData,
  });
  const secondKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    robotData: editedRobotData,
  });

  assert.equal(secondKey, firstKey);
});

test('createRendererBackendLoadScopeKey stays stable for link visibility edits', () => {
  const baselineRobotData = createRobotData(0);
  const editedRobotData = createRobotData(0);
  editedRobotData.links.arm.visible = false;

  const firstKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    robotData: baselineRobotData,
  });
  const secondKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    robotData: editedRobotData,
  });

  assert.equal(secondKey, firstKey);
});

test('createRendererBackendLoadScopeKey stays stable for geometry visibility edits', () => {
  const baselineRobotData = createRobotData(0);
  const editedRobotData = createRobotData(0);
  editedRobotData.links.arm.visual.visible = false;
  editedRobotData.links.arm.collision.visible = false;

  const firstKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    robotData: baselineRobotData,
  });
  const secondKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    robotData: editedRobotData,
  });

  assert.equal(secondKey, firstKey);
});

test('createMemoizedRendererBackendLoadScopeKey reuses key for MJCF collision origin source patches', () => {
  const memo: RendererBackendLoadScopeKeyMemo = {};
  const assets: Record<string, string> = {};
  const baselineRobotData = createRobotData(0);
  baselineRobotData.links.base.collision.origin.xyz.x = 0.1;
  const mjcfSource: RobotFile = {
    name: 'robot.xml',
    format: 'mjcf',
    content: '<mujoco><worldbody><body name="base"><geom pos="0.1 0 0" /></body></worldbody></mujoco>',
  };

  const firstKey = createMemoizedRendererBackendLoadScopeKey(
    {
      sourceFile: mjcfSource,
      availableFiles: [mjcfSource],
      assets,
      reloadToken: 0,
      robotData: baselineRobotData,
    },
    memo,
  );

  const editedRobotData = structuredClone(baselineRobotData);
  editedRobotData.links.base.collision.origin.xyz.x = 0.2;
  const patchedMjcfSource: RobotFile = {
    ...mjcfSource,
    content: '<mujoco><worldbody><body name="base"><geom pos="0.2 0 0" /></body></worldbody></mujoco>',
  };
  const secondKey = createMemoizedRendererBackendLoadScopeKey(
    {
      sourceFile: patchedMjcfSource,
      availableFiles: [patchedMjcfSource],
      assets,
      reloadToken: 0,
      robotData: editedRobotData,
    },
    memo,
  );

  assert.equal(secondKey, firstKey);
});

test('createMemoizedRendererBackendLoadScopeKey reuses key for MJCF visual dimension source patches', () => {
  const memo: RendererBackendLoadScopeKeyMemo = {};
  const assets: Record<string, string> = {};
  const baselineRobotData = createRobotData(0);
  baselineRobotData.links.base.visual.dimensions = { x: 1, y: 1, z: 1 };
  const mjcfSource: RobotFile = {
    name: 'robot.xml',
    format: 'mjcf',
    content: '<mujoco><worldbody><body name="base"><geom type="box" size="0.5 0.5 0.5" /></body></worldbody></mujoco>',
  };

  const firstKey = createMemoizedRendererBackendLoadScopeKey(
    {
      sourceFile: mjcfSource,
      availableFiles: [mjcfSource],
      assets,
      reloadToken: 0,
      robotData: baselineRobotData,
    },
    memo,
  );

  const editedRobotData = structuredClone(baselineRobotData);
  editedRobotData.links.base.visual.dimensions = { x: 2, y: 1, z: 1 };
  const patchedMjcfSource: RobotFile = {
    ...mjcfSource,
    content: '<mujoco><worldbody><body name="base"><geom type="box" size="1 0.5 0.5" /></body></worldbody></mujoco>',
  };
  const secondKey = createMemoizedRendererBackendLoadScopeKey(
    {
      sourceFile: patchedMjcfSource,
      availableFiles: [patchedMjcfSource],
      assets,
      reloadToken: 0,
      robotData: editedRobotData,
    },
    memo,
  );

  assert.equal(secondKey, firstKey);
});

test('createMemoizedRendererBackendLoadScopeKey recomputes for multiple geometry edits', () => {
  const memo: RendererBackendLoadScopeKeyMemo = {};
  const assets: Record<string, string> = {};
  const baselineRobotData = createRobotData(0);
  const mjcfSource: RobotFile = {
    name: 'robot.xml',
    format: 'mjcf',
    content: '<mujoco model="demo" />',
  };

  const firstKey = createMemoizedRendererBackendLoadScopeKey(
    {
      sourceFile: mjcfSource,
      availableFiles: [mjcfSource],
      assets,
      reloadToken: 0,
      robotData: baselineRobotData,
    },
    memo,
  );

  const editedRobotData = structuredClone(baselineRobotData);
  editedRobotData.links.base.collision.origin.xyz.x = 0.2;
  editedRobotData.links.arm.collision.origin.xyz.x = 0.3;
  const patchedMjcfSource: RobotFile = {
    ...mjcfSource,
    content: '<mujoco model="demo_patched" />',
  };
  const secondKey = createMemoizedRendererBackendLoadScopeKey(
    {
      sourceFile: patchedMjcfSource,
      availableFiles: [patchedMjcfSource],
      assets,
      reloadToken: 0,
      robotData: editedRobotData,
    },
    memo,
  );

  assert.notEqual(secondKey, firstKey);
});

test('createMemoizedRendererBackendLoadScopeKey recomputes when non-source file content changes with a geometry edit', () => {
  const memo: RendererBackendLoadScopeKeyMemo = {};
  const assets: Record<string, string> = {};
  const baselineRobotData = createRobotData(0);
  baselineRobotData.links.base.collision.origin.xyz.x = 0.1;
  const mjcfSource: RobotFile = {
    name: 'robot.xml',
    format: 'mjcf',
    content: '<mujoco><worldbody><body name="base"><geom pos="0.1 0 0" /></body></worldbody></mujoco>',
  };
  const meshSource: RobotFile = {
    name: 'meshes/part.obj',
    format: 'mesh',
    content: 'v 0 0 0',
  };

  const firstKey = createMemoizedRendererBackendLoadScopeKey(
    {
      sourceFile: mjcfSource,
      availableFiles: [mjcfSource, meshSource],
      assets,
      reloadToken: 0,
      robotData: baselineRobotData,
    },
    memo,
  );

  const editedRobotData = structuredClone(baselineRobotData);
  editedRobotData.links.base.collision.origin.xyz.x = 0.2;
  const patchedMjcfSource: RobotFile = {
    ...mjcfSource,
    content: '<mujoco><worldbody><body name="base"><geom pos="0.2 0 0" /></body></worldbody></mujoco>',
  };
  const patchedMeshSource: RobotFile = {
    ...meshSource,
    content: 'v 1 0 0',
  };
  const secondKey = createMemoizedRendererBackendLoadScopeKey(
    {
      sourceFile: patchedMjcfSource,
      availableFiles: [patchedMjcfSource, patchedMeshSource],
      assets,
      reloadToken: 0,
      robotData: editedRobotData,
    },
    memo,
  );

  assert.notEqual(secondKey, firstKey);
});

test('createMemoizedRendererBackendLoadScopeKey reuses key for MJCF joint limit source patches', () => {
  const memo: RendererBackendLoadScopeKeyMemo = {};
  const assets: Record<string, string> = {};
  const baselineRobotData = createRobotData(0);
  baselineRobotData.joints.shoulder.limit = {
    lower: -1,
    upper: 1,
    effort: 10,
    velocity: 5,
  };
  const mjcfSource: RobotFile = {
    name: 'robot.xml',
    format: 'mjcf',
    content: '<mujoco><worldbody><body name="base"><joint name="shoulder" range="-1 1" /></body></worldbody></mujoco>',
  };

  const firstKey = createMemoizedRendererBackendLoadScopeKey(
    {
      sourceFile: mjcfSource,
      availableFiles: [mjcfSource],
      assets,
      reloadToken: 0,
      robotData: baselineRobotData,
    },
    memo,
  );

  const editedRobotData = structuredClone(baselineRobotData);
  editedRobotData.joints.shoulder.limit = {
    lower: -2,
    upper: 2,
    effort: 10,
    velocity: 5,
  };
  const patchedMjcfSource: RobotFile = {
    ...mjcfSource,
    content: '<mujoco><worldbody><body name="base"><joint name="shoulder" range="-2 2" /></body></worldbody></mujoco>',
  };
  const secondKey = createMemoizedRendererBackendLoadScopeKey(
    {
      sourceFile: patchedMjcfSource,
      availableFiles: [patchedMjcfSource],
      assets,
      reloadToken: 0,
      robotData: editedRobotData,
    },
    memo,
  );

  assert.equal(secondKey, firstKey);
});

test('createMemoizedRendererBackendLoadScopeKey reuses key for MJCF joint type source patches', () => {
  const memo: RendererBackendLoadScopeKeyMemo = {};
  const assets: Record<string, string> = {};
  const baselineRobotData = createRobotData(0);
  baselineRobotData.joints.shoulder.type = JointType.REVOLUTE;
  const mjcfSource: RobotFile = {
    name: 'robot.xml',
    format: 'mjcf',
    content: '<mujoco><worldbody><body name="base"><joint name="shoulder" type="hinge" /></body></worldbody></mujoco>',
  };

  const firstKey = createMemoizedRendererBackendLoadScopeKey(
    {
      sourceFile: mjcfSource,
      availableFiles: [mjcfSource],
      assets,
      reloadToken: 0,
      robotData: baselineRobotData,
    },
    memo,
  );

  const editedRobotData = structuredClone(baselineRobotData);
  editedRobotData.joints.shoulder.type = JointType.PRISMATIC;
  editedRobotData.joints.shoulder.axis = { x: 1, y: 0, z: 0 };
  const patchedMjcfSource: RobotFile = {
    ...mjcfSource,
    content: '<mujoco><worldbody><body name="base"><joint name="shoulder" type="slide" /></body></worldbody></mujoco>',
  };
  const secondKey = createMemoizedRendererBackendLoadScopeKey(
    {
      sourceFile: patchedMjcfSource,
      availableFiles: [patchedMjcfSource],
      assets,
      reloadToken: 0,
      robotData: editedRobotData,
    },
    memo,
  );

  assert.equal(secondKey, firstKey);
});

test('createMemoizedRendererBackendLoadScopeKey reuses key for inertial edits with source patches', () => {
  const memo: RendererBackendLoadScopeKeyMemo = {};
  const assets: Record<string, string> = {};
  const baselineRobotData = createRobotData(0);
  baselineRobotData.links.base.inertial!.mass = 1;
  const mjcfSource: RobotFile = {
    name: 'robot.xml',
    format: 'mjcf',
    content: '<mujoco><worldbody><body name="base" mass="1" /></worldbody></mujoco>',
  };

  const firstKey = createMemoizedRendererBackendLoadScopeKey(
    {
      sourceFile: mjcfSource,
      availableFiles: [mjcfSource],
      assets,
      reloadToken: 0,
      robotData: baselineRobotData,
    },
    memo,
  );

  const editedRobotData = structuredClone(baselineRobotData);
  editedRobotData.links.base.inertial!.mass = 2;
  const patchedMjcfSource: RobotFile = {
    ...mjcfSource,
    content: '<mujoco><worldbody><body name="base" mass="2" /></worldbody></mujoco>',
  };
  const secondKey = createMemoizedRendererBackendLoadScopeKey(
    {
      sourceFile: patchedMjcfSource,
      availableFiles: [patchedMjcfSource],
      assets,
      reloadToken: 0,
      robotData: editedRobotData,
    },
    memo,
  );

  assert.equal(secondKey, firstKey);
});

test('createRendererBackendLoadScopeKey keeps USD hydration data from triggering reloads', () => {
  const usdSourceFile: RobotFile = {
    name: 'demo.usd',
    format: 'usd',
    content: '#usda 1.0',
  };

  const loadingKey = createRendererBackendLoadScopeKey({
    sourceFile: usdSourceFile,
    assets: {},
    availableFiles: [],
    reloadToken: 0,
    robotData: null,
  });
  const hydratedKey = createRendererBackendLoadScopeKey({
    sourceFile: { ...usdSourceFile },
    assets: {},
    availableFiles: [],
    reloadToken: 0,
    robotData: createRobotData(0),
  });

  assert.equal(hydratedKey, loadingKey);
});

test('createRendererBackendLoadScopeKey treats USDA aliases like USD for hydration reloads', () => {
  const usdaSourceFile: RobotFile = {
    name: 'demo.usda',
    format: 'usda' as RobotFile['format'],
    content: '#usda 1.0',
  };

  const loadingKey = createRendererBackendLoadScopeKey({
    sourceFile: usdaSourceFile,
    assets: {},
    availableFiles: [],
    reloadToken: 0,
    robotData: null,
  });
  const hydratedKey = createRendererBackendLoadScopeKey({
    sourceFile: { ...usdaSourceFile },
    assets: {},
    availableFiles: [],
    reloadToken: 0,
    robotData: createRobotData(0),
  });

  assert.equal(hydratedKey, loadingKey);
});

test('createRendererBackendLoadScopeKey changes when reload token changes', () => {
  const firstKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    robotData: createRobotData(0),
  });
  const secondKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 1,
    robotData: createRobotData(0),
  });

  assert.notEqual(secondKey, firstKey);
});

test('createRendererBackendLoadScopeKey changes when XML fallback policy changes', () => {
  const firstKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    allowUrdfXmlFallback: false,
  });
  const secondKey = createRendererBackendLoadScopeKey({
    sourceFile,
    assets: {},
    reloadToken: 0,
    allowUrdfXmlFallback: true,
  });

  assert.notEqual(secondKey, firstKey);
});
