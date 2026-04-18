import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { GeometryType, JointType, type RobotState } from '@/types';
import { computeUsdInertiaProperties } from '@/shared/utils/inertiaUsd.ts';
import { exportRobotToUsd } from './usdExport.ts';

const BASE_COLOR_TEXTURE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==';

if (typeof globalThis.ProgressEvent === 'undefined') {
  class ProgressEventPolyfill extends Event {
    loaded: number;
    total: number;
    lengthComputable: boolean;

    constructor(
      type: string,
      init: { loaded?: number; total?: number; lengthComputable?: boolean } = {},
    ) {
      super(type);
      this.loaded = init.loaded ?? 0;
      this.total = init.total ?? 0;
      this.lengthComputable = init.lengthComputable ?? false;
    }
  }

  globalThis.ProgressEvent = ProgressEventPolyfill as typeof ProgressEvent;
}

function createTwoLinkAssets(): Record<string, string> {
  return {
    'textures/base_color.png': BASE_COLOR_TEXTURE_DATA_URL,
  };
}

function createTwoLinkRobot(): RobotState {
  return {
    name: 'two_link_robot',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    joints: {
      joint_link1: {
        id: 'joint_link1',
        name: 'joint_link1',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'link1',
        origin: { xyz: { x: 1, y: 2, z: 3 }, rpy: { r: 0, p: 0, y: Math.PI / 2 } },
        axis: { x: 0, y: 0, z: 1 },
        angle: 0,
        limit: { lower: -Math.PI / 2, upper: Math.PI / 3, effort: 12, velocity: 4 },
        dynamics: { damping: 0.1, friction: 0.2 },
        hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
      },
    },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 0.4, y: 0.2, z: 0.1 },
          color: '#4f46e5',
          origin: { xyz: { x: 0.25, y: 0.5, z: 0.75 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.BOX,
          dimensions: { x: 0.5, y: 0.3, z: 0.2 },
          color: '#ef4444',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 2,
          origin: { xyz: { x: 0.01, y: 0.02, z: 0.03 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 0.1, ixy: 0, ixz: 0, iyy: 0.2, iyz: 0, izz: 0.3 },
        },
      },
      link1: {
        id: 'link1',
        name: 'link1',
        visible: true,
        visual: {
          type: GeometryType.CYLINDER,
          dimensions: { x: 0.08, y: 0.6, z: 0 },
          color: '#22c55e',
          origin: { xyz: { x: 0, y: 0, z: 0.3 }, rpy: { r: 0, p: Math.PI / 2, y: 0 } },
        },
        collision: {
          type: GeometryType.SPHERE,
          dimensions: { x: 0.12, y: 0, z: 0 },
          color: '#f59e0b',
          origin: { xyz: { x: 0, y: 0, z: 0.6 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1.25,
          origin: { xyz: { x: 0.1, y: 0.2, z: 0.3 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 2, iyz: 0, izz: 3 },
        },
      },
    },
    materials: {
      base_link: {
        color: '#12ab34',
        texture: 'textures/base_color.png',
      },
    },
  };
}

async function readArchiveText(
  payload: Awaited<ReturnType<typeof exportRobotToUsd>>,
  path: string,
) {
  const entry = payload.archiveFiles.get(path);
  assert.ok(entry, `missing archive entry: ${path}`);
  return entry.text();
}

function createGridStlBlob(cellCount = 8) {
  const lines = ['solid grid'];

  for (let y = 0; y < cellCount; y += 1) {
    for (let x = 0; x < cellCount; x += 1) {
      const x0 = x;
      const x1 = x + 1;
      const y0 = y;
      const y1 = y + 1;

      lines.push('facet normal 0 0 1');
      lines.push('outer loop');
      lines.push(`vertex ${x0} ${y0} 0`);
      lines.push(`vertex ${x1} ${y0} 0`);
      lines.push(`vertex ${x1} ${y1} 0`);
      lines.push('endloop');
      lines.push('endfacet');

      lines.push('facet normal 0 0 1');
      lines.push('outer loop');
      lines.push(`vertex ${x0} ${y0} 0`);
      lines.push(`vertex ${x1} ${y1} 0`);
      lines.push(`vertex ${x0} ${y1} 0`);
      lines.push('endloop');
      lines.push('endfacet');
    }
  }

  lines.push('endsolid grid');
  return new Blob([lines.join('\n')], { type: 'model/stl' });
}

function createUvObjBlob() {
  return new Blob(
    [
      [
        'o textured_triangle',
        'v 0 0 0',
        'v 1 0 0',
        'v 0 1 0',
        'vt 0 0',
        'vt 1 0',
        'vt 0 1',
        'f 1/1 2/2 3/3',
      ].join('\n'),
    ],
    { type: 'text/plain;charset=utf-8' },
  );
}

function createNormalObjBlob() {
  return new Blob(
    [
      [
        'o shaded_triangle',
        'v 0 0 0',
        'v 1 0 0',
        'v 0 1 0',
        'vn 0 0 1',
        'vn 0 0 1',
        'vn 0 0 1',
        'f 1//1 2//2 3//3',
      ].join('\n'),
    ],
    { type: 'text/plain;charset=utf-8' },
  );
}

function createMeshRobot(meshPath: string): RobotState {
  return {
    name: 'mesh_robot',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    joints: {},
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          meshPath,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#6699ff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#000000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
      },
    },
    materials: {},
  };
}

function createSharedMeshRobot(meshPath: string): RobotState {
  return {
    name: 'shared_mesh_robot',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    joints: {
      child_joint: {
        id: 'child_joint',
        name: 'child_joint',
        type: JointType.FIXED,
        parentLinkId: 'base_link',
        childLinkId: 'child_link',
        origin: { xyz: { x: 0.5, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 1, y: 0, z: 0 },
        angle: 0,
        dynamics: { damping: 0, friction: 0 },
        hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
      },
    },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          meshPath,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ffffff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#000000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
      },
      child_link: {
        id: 'child_link',
        name: 'child_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          meshPath,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ffffff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#000000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
      },
    },
    materials: {},
  };
}

function createTexturedMeshRobot(meshPath: string, texturePath: string): RobotState {
  const robot = createMeshRobot(meshPath);
  robot.links.base_link.visual.color = '#ffffff';
  robot.materials = {
    base_link: {
      color: '#ffffff',
      texture: texturePath,
    },
  };
  return robot;
}

function createBoxFaceTextureRobot(): RobotState {
  return {
    name: 'box_face_robot',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    joints: {},
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 0.4, y: 0.3, z: 0.2 },
          color: '#ffffff',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          authoredMaterials: [
            { texture: 'textures/right.png' },
            { texture: 'textures/left.png' },
            { texture: 'textures/up.png' },
            { texture: 'textures/down.png' },
            { texture: 'textures/front.png' },
            { texture: 'textures/back.png' },
          ],
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#000000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
      },
    },
    materials: {},
  };
}

function extractTriangleCount(baseLayer: string) {
  const match = baseLayer.match(/int\[] faceVertexCounts = \[([^\]]*)\]/);
  assert.ok(match, 'expected serialized mesh faceVertexCounts');
  return match[1]
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0).length;
}

function extractTuples(text: string, attributeName: string): number[][] {
  const escapedName = attributeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Array.from(text.matchAll(new RegExp(`${escapedName} = \\(([^)]+)\\)`, 'g'))).map((match) =>
    match[1].split(',').map((value) => Number(value.trim())),
  );
}

function assertQuaternionClose(
  actualWxyz: number[],
  expected: THREE.Quaternion,
  epsilon = 1e-5,
): void {
  const actual = new THREE.Quaternion(
    actualWxyz[1] ?? 0,
    actualWxyz[2] ?? 0,
    actualWxyz[3] ?? 0,
    actualWxyz[0] ?? 1,
  ).normalize();
  const target = expected.clone().normalize();
  const negatedTarget = new THREE.Quaternion(-target.x, -target.y, -target.z, -target.w);
  const delta = Math.min(actual.angleTo(target), actual.angleTo(negatedTarget));
  assert.ok(delta <= epsilon, `expected quaternions to match within ${epsilon}, got ${delta}`);
}

function includesQuaternionClose(
  actualWxyzTuples: number[][],
  expected: THREE.Quaternion,
  epsilon = 1e-5,
): boolean {
  return actualWxyzTuples.some((tuple) => {
    try {
      assertQuaternionClose(tuple, expected, epsilon);
      return true;
    } catch {
      return false;
    }
  });
}

test('exports robot state into a layered USD package', async () => {
  const payload = await exportRobotToUsd({
    robot: createTwoLinkRobot(),
    exportName: 'two_link_robot',
    assets: createTwoLinkAssets(),
  });

  assert.equal(payload.downloadFileName, 'two_link_robot.usd');
  assert.equal(payload.archiveFileName, 'two_link_robot_usd.zip');
  assert.equal(payload.rootLayerPath, 'two_link_robot/usd/two_link_robot.usd');
  assert.deepEqual(Array.from(payload.archiveFiles.keys()).sort(), [
    'two_link_robot/usd/assets/base_color.png',
    'two_link_robot/usd/configuration/two_link_robot_description_base.usd',
    'two_link_robot/usd/configuration/two_link_robot_description_physics.usd',
    'two_link_robot/usd/configuration/two_link_robot_description_sensor.usd',
    'two_link_robot/usd/two_link_robot.usd',
  ]);

  assert.match(payload.content, /^#usda 1.0/);
  assert.match(payload.content, /defaultPrim = "two_link_robot_description"/);
  assert.match(payload.content, /prepend variantSets = \["Physics", "Sensor"\]/);
  assert.match(
    payload.content,
    /prepend references = @configuration\/two_link_robot_description_base\.usd@/,
  );
  assert.match(
    payload.content,
    /prepend payload = @configuration\/two_link_robot_description_physics\.usd@/,
  );
  assert.match(
    payload.content,
    /prepend payload = @configuration\/two_link_robot_description_sensor\.usd@/,
  );
});

test('isaacsim USDA export keeps root stem without forcing _description sidecar names', async () => {
  const payload = await exportRobotToUsd({
    robot: createTwoLinkRobot(),
    exportName: 'go1',
    assets: createTwoLinkAssets(),
    fileFormat: 'usda',
    layoutProfile: 'isaacsim',
  });

  assert.equal(payload.downloadFileName, 'go1.usda');
  assert.equal(payload.archiveFileName, 'go1_usda.zip');
  assert.equal(payload.rootLayerPath, 'go1/go1.usda');
  assert.deepEqual(Array.from(payload.archiveFiles.keys()).sort(), [
    'go1/assets/base_color.png',
    'go1/configuration/go1_base.usda',
    'go1/configuration/go1_physics.usda',
    'go1/configuration/go1_robot.usda',
    'go1/configuration/go1_sensor.usda',
    'go1/go1.usda',
  ]);

  assert.match(payload.content, /defaultPrim = "go1"/);
  assert.match(payload.content, /prepend variantSets = \["Physics", "Sensor", "Robot"\]/);
  assert.match(payload.content, /prepend references = @configuration\/go1_base\.usda@/);
  assert.match(payload.content, /prepend payload = @configuration\/go1_physics\.usda@/);
  assert.match(payload.content, /prepend payload = @configuration\/go1_sensor\.usda@/);
  assert.match(payload.content, /prepend payload = @configuration\/go1_robot\.usda@/);
});

test('isaacsim USDA export flattens link prim hierarchy for external articulation consumers', async () => {
  const payload = await exportRobotToUsd({
    robot: createTwoLinkRobot(),
    exportName: 'go1',
    assets: createTwoLinkAssets(),
    fileFormat: 'usda',
    layoutProfile: 'isaacsim',
  });

  const baseLayer = await readArchiveText(payload, 'go1/configuration/go1_base.usda');
  const physicsLayer = await readArchiveText(payload, 'go1/configuration/go1_physics.usda');
  const robotLayer = await readArchiveText(payload, 'go1/configuration/go1_robot.usda');

  assert.match(baseLayer, /def Xform "base_link"/);
  assert.match(baseLayer, /def Xform "link1"/);
  assert.match(baseLayer, /def Scope "joints"/);
  assert.doesNotMatch(baseLayer, /\n        def Xform "link1"/);
  assert.match(baseLayer, /def Xform "link1"\n\s+\{\n\s+double3 xformOp:translate = \(1, 2, 3\)/);

  assert.match(physicsLayer, /rel physics:body0 = <\/go1\/base_link>/);
  assert.match(physicsLayer, /rel physics:body1 = <\/go1\/link1>/);
  assert.doesNotMatch(physicsLayer, /rel physics:body1 = <\/go1\/base_link\/link1>/);

  assert.match(robotLayer, /<\/go1\/base_link>/);
  assert.match(robotLayer, /<\/go1\/link1>/);
  assert.doesNotMatch(robotLayer, /<\/go1\/base_link\/link1>/);
});

test('isaacsim USDA export hides mesh library prototypes and collision guide scopes from renderers', async () => {
  const meshPayload = await exportRobotToUsd({
    robot: createSharedMeshRobot('meshes/shared_triangle.obj'),
    exportName: 'go1',
    assets: {},
    extraMeshFiles: new Map([['meshes/shared_triangle.obj', createUvObjBlob()]]),
    fileFormat: 'usda',
    layoutProfile: 'isaacsim',
  });
  const collisionPayload = await exportRobotToUsd({
    robot: createTwoLinkRobot(),
    exportName: 'go1_collisions',
    assets: createTwoLinkAssets(),
    fileFormat: 'usda',
    layoutProfile: 'isaacsim',
  });

  const meshBaseLayer = await readArchiveText(meshPayload, 'go1/configuration/go1_base.usda');
  const collisionBaseLayer = await readArchiveText(
    collisionPayload,
    'go1_collisions/configuration/go1_collisions_base.usda',
  );

  assert.match(
    meshBaseLayer,
    /def Scope "__MeshLibrary"\n\s+\{\n\s+token visibility = "invisible"/,
  );
  assert.match(
    collisionBaseLayer,
    /def Xform "collisions"\n\s+\{\n\s+token visibility = "invisible"/,
  );
});

test('genesis USDA export aliases to the isaacsim-compatible layered layout', async () => {
  const payload = await exportRobotToUsd({
    robot: createTwoLinkRobot(),
    exportName: 'go1',
    assets: createTwoLinkAssets(),
    fileFormat: 'usda',
    layoutProfile: 'genesis',
  });

  assert.equal(payload.rootLayerPath, 'go1/go1.usda');

  const physicsLayer = await readArchiveText(payload, 'go1/configuration/go1_physics.usda');
  assert.match(physicsLayer, /rel physics:body0 = <\/go1\/base_link>/);
  assert.match(physicsLayer, /rel physics:body1 = <\/go1\/link1>/);
  assert.doesNotMatch(physicsLayer, /rel physics:body1 = <\/go1\/base_link\/link1>/);
});

test('preserves link transforms and writes physics joints into separate USD layers', async () => {
  const payload = await exportRobotToUsd({
    robot: createTwoLinkRobot(),
    exportName: 'two_link_robot',
    assets: createTwoLinkAssets(),
  });

  const baseLayer = await readArchiveText(
    payload,
    'two_link_robot/usd/configuration/two_link_robot_description_base.usd',
  );
  const physicsLayer = await readArchiveText(
    payload,
    'two_link_robot/usd/configuration/two_link_robot_description_physics.usd',
  );
  const sensorLayer = await readArchiveText(
    payload,
    'two_link_robot/usd/configuration/two_link_robot_description_sensor.usd',
  );

  assert.match(baseLayer, /def Xform "two_link_robot_description"/);
  assert.match(baseLayer, /def Xform "base_link"/);
  assert.match(baseLayer, /def Xform "link1"/);
  assert.match(baseLayer, /double3 xformOp:translate = \(1, 2, 3\)/);
  assert.match(baseLayer, /quatf xformOp:orient = \(0\.707107, 0, 0, 0\.707107\)/);
  assert.match(baseLayer, /double3 xformOp:translate = \(0\.25, 0\.5, 0\.75\)/);
  assert.match(baseLayer, /double3 xformOp:scale = \(0\.4, 0\.2, 0\.1\)/);
  assert.match(baseLayer, /def Cube "box"/);
  assert.match(baseLayer, /def Cylinder "cylinder"/);
  assert.match(baseLayer, /def Sphere "sphere"/);
  assert.match(baseLayer, /def Xform "collisions"/);
  assert.doesNotMatch(baseLayer, /def Xform "colliders"/);

  assert.match(physicsLayer, /over "two_link_robot_description"/);
  assert.match(physicsLayer, /subLayers = \[\n\s+@two_link_robot_description_base\.usd@\n\s+\]/);
  assert.match(physicsLayer, /def PhysicsScene "physicsScene"/);
  assert.match(physicsLayer, /prepend apiSchemas = \["PhysicsArticulationRootAPI"\]/);
  assert.match(physicsLayer, /prepend apiSchemas = \["PhysicsRigidBodyAPI", "PhysicsMassAPI"\]/);
  assert.match(
    physicsLayer,
    /over "two_link_robot_description" \(\n\s+prepend apiSchemas = \["PhysicsArticulationRootAPI"\]\n\s*\)\n\{/,
  );
  assert.match(
    physicsLayer,
    /over "base_link" \(\n\s+prepend apiSchemas = \["PhysicsRigidBodyAPI", "PhysicsMassAPI"\]\n\s*\)\n\s+\{/,
  );
  assert.match(
    physicsLayer,
    /over "collision_0" \(\n\s+prepend apiSchemas = \["PhysicsCollisionAPI"\]\n\s*\)\n\s+\{/,
  );
  assert.match(physicsLayer, /over "collisions"/);
  assert.doesNotMatch(physicsLayer, /over "colliders"/);
  assert.match(physicsLayer, /float physics:mass = 1\.25/);
  assert.match(physicsLayer, /float3 physics:centerOfMass = \(0\.1, 0\.2, 0\.3\)/);
  assert.match(physicsLayer, /over "joints"/);
  assert.match(physicsLayer, /def PhysicsRevoluteJoint "joint_link1"/);
  assert.match(physicsLayer, /rel physics:body0 = <\/two_link_robot_description\/base_link>/);
  assert.match(
    physicsLayer,
    /rel physics:body1 = <\/two_link_robot_description\/base_link\/link1>/,
  );
  assert.match(physicsLayer, /uniform token physics:axis = "Z"/);
  assert.match(physicsLayer, /float physics:lowerLimit = -90/);
  assert.match(physicsLayer, /float physics:upperLimit = 60/);
  assert.match(physicsLayer, /prepend apiSchemas = \["PhysicsDriveAPI:angular"\]/);
  assert.match(physicsLayer, /uniform token drive:angular:physics:type = "force"/);
  assert.match(physicsLayer, /float drive:angular:physics:damping = 0\.1/);
  assert.match(physicsLayer, /float drive:angular:physics:maxForce = 12/);
  assert.match(physicsLayer, /point3f physics:localPos0 = \(1, 2, 3\)/);
  assert.match(physicsLayer, /custom point3f urdf:originXyz = \(1, 2, 3\)/);
  assert.match(physicsLayer, /custom float3 urdf:axisLocal = \(0, 0, 1\)/);

  assert.match(sensorLayer, /def Xform "two_link_robot_description"/);
});

test('serializes joint origin quaternions using URDF ZYX rpy semantics', async () => {
  const robot = createTwoLinkRobot();
  robot.joints.joint_link1.origin.rpy = {
    r: 0.31,
    p: -0.47,
    y: 0.83,
  };
  robot.joints.joint_link1.axis = { x: 0, y: 0, z: -1 };

  const payload = await exportRobotToUsd({
    robot,
    exportName: 'two_link_robot',
    assets: createTwoLinkAssets(),
  });

  const physicsLayer = await readArchiveText(
    payload,
    'two_link_robot/usd/configuration/two_link_robot_description_physics.usd',
  );

  const exportedOriginQuat = extractTuples(physicsLayer, 'urdf:originQuatWxyz').at(0);
  assert.ok(exportedOriginQuat, 'expected joint origin quaternion metadata');
  assertQuaternionClose(
    exportedOriginQuat,
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.31, -0.47, 0.83, 'ZYX')),
  );

  const exportedPhysicsQuat = extractTuples(physicsLayer, 'physics:localRot0').at(0);
  assert.ok(exportedPhysicsQuat, 'expected physics:localRot0 on the exported joint');
  assertQuaternionClose(
    exportedPhysicsQuat,
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0.31, -0.47, 0.83, 'ZYX')),
  );
  assert.match(physicsLayer, /custom float3 urdf:axisLocal = \(0, 0, -1\)/);
});

test('serializes visual and collision origins using URDF ZYX rpy semantics', async () => {
  const robot = createTwoLinkRobot();
  robot.links.base_link.visual.origin = {
    xyz: { x: 0.12, y: -0.34, z: 0.56 },
    rpy: { r: 0.37, p: -0.52, y: 0.91 },
  };
  robot.links.base_link.collision = {
    ...robot.links.base_link.collision,
    origin: {
      xyz: { x: -0.22, y: 0.18, z: -0.14 },
      rpy: { r: -0.41, p: 0.63, y: -0.27 },
    },
  };

  const payload = await exportRobotToUsd({
    robot,
    exportName: 'two_link_robot',
    assets: createTwoLinkAssets(),
  });

  const baseLayer = await readArchiveText(
    payload,
    'two_link_robot/usd/configuration/two_link_robot_description_base.usd',
  );
  const exportedOrientations = extractTuples(baseLayer, 'quatf xformOp:orient');

  const expectedVisualQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(0.37, -0.52, 0.91, 'ZYX'),
  );
  const expectedCollisionQuaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-0.41, 0.63, -0.27, 'ZYX'),
  );

  assert.ok(
    includesQuaternionClose(exportedOrientations, expectedVisualQuaternion),
    'expected exported visual origin quaternion to use URDF ZYX rpy semantics',
  );
  assert.ok(
    includesQuaternionClose(exportedOrientations, expectedCollisionQuaternion),
    'expected exported collision origin quaternion to use URDF ZYX rpy semantics',
  );
});

test('exports USD links in the authored rest pose instead of the current manipulated joint pose', async () => {
  const robot = createTwoLinkRobot();
  robot.joints.joint_link1.referencePosition = Math.PI / 4;
  robot.joints.joint_link1.angle = robot.joints.joint_link1.referencePosition + Math.PI / 6;

  const payload = await exportRobotToUsd({
    robot,
    exportName: 'two_link_robot_rest_pose',
    assets: createTwoLinkAssets(),
  });

  const baseLayer = await readArchiveText(
    payload,
    'two_link_robot_rest_pose/usd/configuration/two_link_robot_rest_pose_description_base.usd',
  );
  const link1OrientMatch = baseLayer.match(
    /def Xform "link1"[\s\S]*?quatf xformOp:orient = \(([^)]+)\)/,
  );
  assert.ok(link1OrientMatch, 'expected link1 orient op in the exported base layer');

  const exportedLinkQuat = link1OrientMatch[1].split(',').map((value) => Number(value.trim()));
  assertQuaternionClose(
    exportedLinkQuat,
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2, 'ZYX')),
  );
});

test('serializes internal material metadata and display colors into the base layer', async () => {
  const payload = await exportRobotToUsd({
    robot: createTwoLinkRobot(),
    exportName: 'two_link_robot',
    assets: createTwoLinkAssets(),
  });

  const baseLayer = await readArchiveText(
    payload,
    'two_link_robot/usd/configuration/two_link_robot_description_base.usd',
  );

  assert.match(baseLayer, /custom string urdf:materialColor = "#12ab34"/);
  assert.match(baseLayer, /custom string urdf:materialTexture = "textures\/base_color\.png"/);
  assert.match(baseLayer, /primvars:displayColor = \[\(0\.070593, 0\.670593, 0\.203927\)\]/);
  assert.match(baseLayer, /def Scope "Looks"/);
  assert.match(baseLayer, /def Material "Material_0"/);
  assert.match(baseLayer, /uniform token info:id = "UsdPreviewSurface"/);
  assert.match(baseLayer, /color3f inputs:diffuseColor = \(0\.070593, 0\.670593, 0\.203927\)/);
  assert.match(
    baseLayer,
    /rel material:binding = <\/two_link_robot_description\/Looks\/Material_0>/,
  );
});

test('exports explicit mesh material colors into USD preview materials instead of loader defaults', async () => {
  const meshPath = 'meshes/colored_triangle.obj';
  const robot = createMeshRobot(meshPath);
  robot.links.base_link.visual.color = '#ffffff';
  robot.materials = {
    base_link: {
      color: '#12ab34',
    },
  };

  const payload = await exportRobotToUsd({
    robot,
    exportName: 'mesh_robot_colored',
    assets: {},
    extraMeshFiles: new Map([[meshPath, createUvObjBlob()]]),
  });

  const baseLayer = await readArchiveText(
    payload,
    'mesh_robot_colored/usd/configuration/mesh_robot_colored_description_base.usd',
  );

  assert.match(baseLayer, /custom string urdf:materialColor = "#12ab34"/);
  assert.match(baseLayer, /primvars:displayColor = \[\(0\.070593, 0\.670593, 0\.203927\)\]/);
  assert.match(baseLayer, /color3f inputs:diffuseColor = \(0\.070593, 0\.670593, 0\.203927\)/);
  assert.doesNotMatch(baseLayer, /color3f inputs:diffuseColor = \(1, 1, 1\)/);
});

test('deduplicates repeated mesh geometry into a shared USD mesh library', async () => {
  const meshPath = 'meshes/shared_triangle.obj';
  const payload = await exportRobotToUsd({
    robot: createSharedMeshRobot(meshPath),
    exportName: 'shared_mesh_robot',
    assets: {},
    extraMeshFiles: new Map([[meshPath, createUvObjBlob()]]),
  });

  const baseLayer = await readArchiveText(
    payload,
    'shared_mesh_robot/usd/configuration/shared_mesh_robot_description_base.usd',
  );

  assert.match(baseLayer, /def Scope "__MeshLibrary"/);
  assert.equal(
    Array.from(baseLayer.matchAll(/point3f\[] points = \[/g)).length,
    1,
    'expected shared mesh geometry to be serialized once',
  );
  assert.match(
    baseLayer,
    /prepend references = <\/shared_mesh_robot_description\/__MeshLibrary\/Geometry_0>/,
  );
  assert.equal(
    Array.from(
      baseLayer.matchAll(
        /prepend references = <\/shared_mesh_robot_description\/__MeshLibrary\/Geometry_0>/g,
      ),
    ).length,
    2,
    'expected both mesh instances to reference the shared geometry prototype',
  );
});

test('diagonalizes off-diagonal inertial tensors before writing USD mass properties', async () => {
  const robot = createTwoLinkRobot();
  robot.links.link1.inertial = {
    mass: 1.25,
    origin: { xyz: { x: 0.1, y: 0.2, z: 0.3 }, rpy: { r: 0.15, p: -0.25, y: 0.35 } },
    inertia: {
      ixx: 1.1,
      ixy: 0.12,
      ixz: -0.18,
      iyy: 2.3,
      iyz: 0.09,
      izz: 3.4,
    },
  };

  const payload = await exportRobotToUsd({
    robot,
    exportName: 'two_link_robot',
    assets: createTwoLinkAssets(),
  });

  const physicsLayer = await readArchiveText(
    payload,
    'two_link_robot/usd/configuration/two_link_robot_description_physics.usd',
  );
  const expected = computeUsdInertiaProperties(robot.links.link1.inertial);
  assert.ok(expected, 'expected diagonalized inertia values');

  const diagonalInertia = extractTuples(physicsLayer, 'physics:diagonalInertia').at(-1);
  assert.ok(diagonalInertia, 'expected link1 diagonal inertia');
  expected.diagonalInertia.forEach((value, index) => {
    assert.ok(
      Math.abs(diagonalInertia[index]! - value) <= 1e-5,
      `expected inertia[${index}] to match`,
    );
  });

  const principalAxes = extractTuples(physicsLayer, 'physics:principalAxes').at(-1);
  assert.ok(principalAxes, 'expected link1 principal axes');
  assertQuaternionClose(principalAxes, expected.principalAxesLocal);

  assert.notDeepEqual(
    diagonalInertia.map((value) => Number(value.toFixed(6))),
    [1.1, 2.3, 3.4],
    'expected exported inertia to differ from the raw diagonal entries when off-diagonal terms exist',
  );
});

test('preserves tiny explicit inertial values when writing USD mass properties', async () => {
  const robot = createTwoLinkRobot();
  robot.links.link1.inertial = {
    mass: 4.19e-15,
    origin: { xyz: { x: 1e-27, y: -2e-27, z: -1.3078606502004276e-11 }, rpy: { r: 0, p: 0, y: 0 } },
    inertia: {
      ixx: 1.1e-28,
      ixy: 1.2e-29,
      ixz: -1.8e-29,
      iyy: 2.3e-28,
      iyz: 0.9e-29,
      izz: 3.4e-28,
    },
  };

  const payload = await exportRobotToUsd({
    robot,
    exportName: 'two_link_robot_tiny_inertia',
    assets: createTwoLinkAssets(),
  });

  const physicsLayer = await readArchiveText(
    payload,
    'two_link_robot_tiny_inertia/usd/configuration/two_link_robot_tiny_inertia_description_physics.usd',
  );
  const expected = computeUsdInertiaProperties(robot.links.link1.inertial);
  assert.ok(expected, 'expected tiny inertia to remain representable');

  const masses = Array.from(physicsLayer.matchAll(/float physics:mass = ([^\n]+)/g)).map((match) =>
    Number(match[1].trim()),
  );
  assert.equal(masses.at(-1), 4.19e-15);

  const centerOfMass = extractTuples(physicsLayer, 'physics:centerOfMass').at(-1);
  assert.ok(centerOfMass, 'expected link1 center of mass');
  [1e-27, -2e-27, -1.3078606502004276e-11].forEach((value, index) => {
    assert.ok(
      Math.abs(centerOfMass[index]! - value) <= Math.max(Math.abs(value) * 1e-6, 1e-33),
      `expected centerOfMass[${index}] to preserve tiny authored values`,
    );
  });

  const diagonalInertia = extractTuples(physicsLayer, 'physics:diagonalInertia').at(-1);
  assert.ok(diagonalInertia, 'expected link1 diagonal inertia');
  expected.diagonalInertia.forEach((value, index) => {
    assert.ok(
      Math.abs(diagonalInertia[index]! - value) <= Math.max(Math.abs(value) * 1e-6, 1e-33),
      `expected tiny inertia[${index}] to survive USD export`,
    );
  });

  const principalAxes = extractTuples(physicsLayer, 'physics:principalAxes').at(-1);
  assert.ok(principalAxes, 'expected link1 principal axes');
  assertQuaternionClose(principalAxes, expected.principalAxesLocal, 1e-6);
});

test('can simplify mesh geometry before serializing USD mesh prims', async () => {
  const meshPath = 'meshes/grid.stl';
  const extraMeshFiles = new Map([[meshPath, createGridStlBlob()]]);

  const originalPayload = await exportRobotToUsd({
    robot: createMeshRobot(meshPath),
    exportName: 'mesh_robot_original',
    assets: {},
    extraMeshFiles,
  });

  const compressedPayload = await exportRobotToUsd({
    robot: createMeshRobot(meshPath),
    exportName: 'mesh_robot_compressed',
    assets: {},
    extraMeshFiles,
    meshCompression: {
      enabled: true,
      quality: 25,
    },
  });

  const originalBaseLayer = await readArchiveText(
    originalPayload,
    'mesh_robot_original/usd/configuration/mesh_robot_original_description_base.usd',
  );
  const compressedBaseLayer = await readArchiveText(
    compressedPayload,
    'mesh_robot_compressed/usd/configuration/mesh_robot_compressed_description_base.usd',
  );

  const originalTriangles = extractTriangleCount(originalBaseLayer);
  const compressedTriangles = extractTriangleCount(compressedBaseLayer);

  assert.ok(
    compressedTriangles < originalTriangles,
    `expected compressed mesh triangle count to decrease: ${compressedTriangles} < ${originalTriangles}`,
  );
});

test('exports textured mesh materials with UV primvars and archived texture assets', async () => {
  const meshPath = 'meshes/textured_triangle.obj';
  const texturePath = 'textures/checker.png';
  const textureDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==';

  const payload = await exportRobotToUsd({
    robot: createTexturedMeshRobot(meshPath, texturePath),
    exportName: 'mesh_robot_textured',
    assets: {
      [texturePath]: textureDataUrl,
    },
    extraMeshFiles: new Map([[meshPath, createUvObjBlob()]]),
  });

  const baseLayer = await readArchiveText(
    payload,
    'mesh_robot_textured/usd/configuration/mesh_robot_textured_description_base.usd',
  );

  assert.ok(
    payload.archiveFiles.has('mesh_robot_textured/usd/assets/checker.png'),
    'expected exported USD archive to include the referenced texture asset',
  );
  assert.match(baseLayer, /def Material "Material_0"/);
  assert.match(baseLayer, /def Shader "PrimvarReader_st"/);
  assert.match(baseLayer, /uniform token info:id = "UsdPrimvarReader_float2"/);
  assert.match(baseLayer, /token inputs:varname = "st"/);
  assert.match(baseLayer, /def Shader "DiffuseTexture"/);
  assert.match(baseLayer, /uniform token info:id = "UsdUVTexture"/);
  assert.match(baseLayer, /asset inputs:file = @\.\.\/assets\/checker\.png@/);
  assert.match(
    baseLayer,
    /float2 inputs:st\.connect = <\/mesh_robot_textured_description\/Looks\/Material_0\/PrimvarReader_st\.outputs:result>/,
  );
  assert.match(
    baseLayer,
    /color3f inputs:diffuseColor\.connect = <\/mesh_robot_textured_description\/Looks\/Material_0\/DiffuseTexture\.outputs:rgb>/,
  );
  assert.match(baseLayer, /texCoord2f\[] primvars:st = \[/);
  assert.match(baseLayer, /uniform token primvars:st:interpolation = "faceVarying"/);
});

test('exports mesh normals into USD mesh prims so shaded surfaces keep their authored smoothing', async () => {
  const meshPath = 'meshes/shaded_triangle.obj';

  const payload = await exportRobotToUsd({
    robot: createMeshRobot(meshPath),
    exportName: 'mesh_robot_normals',
    assets: {},
    extraMeshFiles: new Map([[meshPath, createNormalObjBlob()]]),
  });

  const baseLayer = await readArchiveText(
    payload,
    'mesh_robot_normals/usd/configuration/mesh_robot_normals_description_base.usd',
  );

  assert.match(baseLayer, /normal3f\[] normals = \[/);
  assert.match(baseLayer, /\(0, 0, 1\)/);
  assert.match(baseLayer, /interpolation = "vertex"/);
});

test('exports texture-only mesh materials with a neutral white USD preview color instead of the default visual blue', async () => {
  const meshPath = 'meshes/textured_triangle.obj';
  const texturePath = 'textures/checker.png';
  const textureDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==';
  const robot = createMeshRobot(meshPath);
  robot.materials = {
    base_link: {
      texture: texturePath,
    },
  };

  const payload = await exportRobotToUsd({
    robot,
    exportName: 'mesh_robot_texture_only',
    assets: {
      [texturePath]: textureDataUrl,
    },
    extraMeshFiles: new Map([[meshPath, createUvObjBlob()]]),
  });

  const baseLayer = await readArchiveText(
    payload,
    'mesh_robot_texture_only/usd/configuration/mesh_robot_texture_only_description_base.usd',
  );

  assert.match(baseLayer, /custom string urdf:materialColor = "#ffffff"/);
  assert.match(baseLayer, /custom string urdf:materialTexture = "textures\/checker\.png"/);
  assert.match(baseLayer, /asset inputs:file = @\.\.\/assets\/checker\.png@/);
  assert.doesNotMatch(baseLayer, /custom string urdf:materialColor = "#6699ff"/);
  assert.doesNotMatch(baseLayer, /color3f inputs:diffuseColor = \(0\.133209, 0\.318547, 1\)/);
});

test('exports six-face box textures into separate USDA mesh prims and packaged assets', async () => {
  const textureDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==';
  const payload = await exportRobotToUsd({
    robot: createBoxFaceTextureRobot(),
    exportName: 'box_face_robot',
    assets: {
      'textures/right.png': textureDataUrl,
      'textures/left.png': textureDataUrl,
      'textures/up.png': textureDataUrl,
      'textures/down.png': textureDataUrl,
      'textures/front.png': textureDataUrl,
      'textures/back.png': textureDataUrl,
    },
    fileFormat: 'usda',
  });

  const baseLayer = await readArchiveText(
    payload,
    'box_face_robot/usd/configuration/box_face_robot_description_base.usda',
  );

  assert.equal(payload.downloadFileName, 'box_face_robot.usda');
  assert.equal((baseLayer.match(/def Mesh "Geometry_/g) ?? []).length, 6);
  assert.match(baseLayer, /custom string urdf:materialTexture = "textures\/right\.png"/);
  assert.match(baseLayer, /custom string urdf:materialTexture = "textures\/left\.png"/);
  assert.match(baseLayer, /custom string urdf:materialTexture = "textures\/up\.png"/);
  assert.match(baseLayer, /custom string urdf:materialTexture = "textures\/down\.png"/);
  assert.match(baseLayer, /custom string urdf:materialTexture = "textures\/front\.png"/);
  assert.match(baseLayer, /custom string urdf:materialTexture = "textures\/back\.png"/);
  assert.ok(payload.archiveFiles.has('box_face_robot/usd/assets/right.png'));
  assert.ok(payload.archiveFiles.has('box_face_robot/usd/assets/left.png'));
  assert.ok(payload.archiveFiles.has('box_face_robot/usd/assets/up.png'));
  assert.ok(payload.archiveFiles.has('box_face_robot/usd/assets/down.png'));
  assert.ok(payload.archiveFiles.has('box_face_robot/usd/assets/front.png'));
  assert.ok(payload.archiveFiles.has('box_face_robot/usd/assets/back.png'));
});

test('archives texture assets for mesh metadata even when the mesh has no UV coordinates', async () => {
  const meshPath = 'meshes/grid.stl';
  const texturePath = 'textures/checker.png';
  const textureDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==';
  const robot = createTexturedMeshRobot(meshPath, texturePath);

  const payload = await exportRobotToUsd({
    robot,
    exportName: 'mesh_robot_textured_stl',
    assets: {
      [texturePath]: textureDataUrl,
    },
    extraMeshFiles: new Map([[meshPath, createGridStlBlob()]]),
  });

  const baseLayer = await readArchiveText(
    payload,
    'mesh_robot_textured_stl/usd/configuration/mesh_robot_textured_stl_description_base.usd',
  );

  assert.match(baseLayer, /custom string urdf:materialColor = "#ffffff"/);
  assert.match(baseLayer, /custom string urdf:materialTexture = "textures\/checker\.png"/);
  assert.ok(
    payload.archiveFiles.has('mesh_robot_textured_stl/usd/assets/checker.png'),
    'expected exported USD archive to include texture assets referenced by material metadata even without UVs',
  );
});

test('exports 8-digit hex display colors without emitting Three.js invalid color warnings', async () => {
  const robot = createTwoLinkRobot();
  robot.links.base_link.visual.color = '#00000000';
  robot.materials = {};

  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((value) => String(value)).join(' '));
  };

  try {
    const payload = await exportRobotToUsd({
      robot,
      exportName: 'two_link_robot_alpha_color',
      assets: createTwoLinkAssets(),
    });

    const baseLayer = await readArchiveText(
      payload,
      'two_link_robot_alpha_color/usd/configuration/two_link_robot_alpha_color_description_base.usd',
    );

    assert.match(baseLayer, /custom string urdf:materialColor = "#00000000"/);
    assert.match(baseLayer, /float inputs:opacity = 0/);
    assert.equal(
      warnings.some((warning) => warning.includes('Invalid hex color')),
      false,
      `expected no invalid color warnings, got: ${warnings.join(' | ')}`,
    );
  } finally {
    console.warn = originalWarn;
  }
});

test('reports phased USD export progress for links, geometry, scene serialization, and assets', async () => {
  const progressUpdates: Array<{
    phase: string;
    completed: number;
    total: number;
    label?: string;
  }> = [];

  await exportRobotToUsd({
    robot: createTwoLinkRobot(),
    exportName: 'two_link_robot_progress',
    assets: createTwoLinkAssets(),
    onProgress: (progress) => {
      progressUpdates.push({ ...progress });
    },
  });

  const phaseOrder = ['links', 'geometry', 'scene', 'assets'];
  let previousPhaseIndex = -1;

  phaseOrder.forEach((phase) => {
    const firstIndex = progressUpdates.findIndex((progress) => progress.phase === phase);
    assert.ok(firstIndex >= 0, `expected progress updates for phase ${phase}`);
    assert.ok(
      firstIndex > previousPhaseIndex,
      `expected phase ${phase} to start after the previous phase`,
    );
    previousPhaseIndex = firstIndex;

    const phaseUpdates = progressUpdates.filter((progress) => progress.phase === phase);
    const finalUpdate = phaseUpdates.at(-1);
    assert.ok(finalUpdate, `expected final progress update for phase ${phase}`);
    assert.equal(
      finalUpdate.completed,
      finalUpdate.total,
      `expected phase ${phase} to finish at total progress`,
    );
  });

  assert.ok(
    progressUpdates.some(
      (progress) => progress.phase === 'links' && progress.label === 'base_link',
    ),
    'expected link progress labels to include the current link name',
  );
});
