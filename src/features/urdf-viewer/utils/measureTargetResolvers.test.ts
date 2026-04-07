import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DEFAULT_LINK } from '@/types';

import {
  resolveRobotMeasureTargetFromSelection,
  resolveUsdMeasureTargetFromSelection,
} from './measureTargetResolvers.ts';

test('reuses hovered mesh subtype and objectIndex when selection only stores link identity', () => {
  const robot = new THREE.Group();
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'base_link';

  const firstVisual = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  firstVisual.position.set(-3, 0, 0);
  const secondVisual = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
  );
  secondVisual.position.set(4, 0, 0);
  link.add(firstVisual, secondVisual);
  robot.add(link);
  robot.updateMatrixWorld(true);

  const target = resolveRobotMeasureTargetFromSelection(
    robot,
    { type: 'link', id: 'base_link' },
    { type: 'link', id: 'base_link', subType: 'visual', objectIndex: 1 },
    'frame',
  );

  assert.ok(target);
  assert.equal(target.objectIndex, 1);
  assert.equal(target.objectType, 'visual');
  assert.deepEqual(target.point.toArray(), [0, 0, 0]);
});

test('resolves robot measure targets from the link frame origin even when inertial data is available', () => {
  const robot = new THREE.Group();
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'base_link';
  link.position.set(10, 2, -1);

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  mesh.position.set(5, 0, 0);
  link.add(mesh);
  robot.add(link);
  robot.updateMatrixWorld(true);

  const target = resolveRobotMeasureTargetFromSelection(
    robot,
    {
      base_link_id: {
        ...DEFAULT_LINK,
        id: 'base_link_id',
        name: 'base_link',
        inertial: {
          ...DEFAULT_LINK.inertial,
          origin: {
            xyz: { x: 0.25, y: -0.5, z: 1.5 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
      },
    },
    { type: 'link', id: 'base_link_id', subType: 'visual', objectIndex: 0 },
    'frame',
  );

  assert.ok(target);
  assert.deepEqual(target.point.toArray(), [10, 2, -1]);
});

test('resolves robot measure targets from the center of mass when anchor mode is centerOfMass', () => {
  const robot = new THREE.Group();
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'base_link';
  link.position.set(10, 2, -1);

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  mesh.position.set(5, 0, 0);
  link.add(mesh);
  robot.add(link);
  robot.updateMatrixWorld(true);

  const target = resolveRobotMeasureTargetFromSelection(
    robot,
    {
      base_link_id: {
        ...DEFAULT_LINK,
        id: 'base_link_id',
        name: 'base_link',
        inertial: {
          ...DEFAULT_LINK.inertial,
          origin: {
            xyz: { x: 0.25, y: -0.5, z: 1.5 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
      },
    },
    { type: 'link', id: 'base_link_id', subType: 'visual', objectIndex: 0 },
    'centerOfMass',
  );

  assert.ok(target);
  assert.deepEqual(target.point.toArray(), [10.25, 1.5, 0.5]);
});

test('resolves robot measure targets from center-of-mass helpers even when the panel anchor mode is frame', () => {
  const robot = new THREE.Group();
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'base_link';
  link.position.set(10, 2, -1);
  robot.add(link);
  robot.updateMatrixWorld(true);

  const target = resolveRobotMeasureTargetFromSelection(
    robot,
    {
      base_link_id: {
        ...DEFAULT_LINK,
        id: 'base_link_id',
        name: 'base_link',
        inertial: {
          ...DEFAULT_LINK.inertial,
          origin: {
            xyz: { x: 0.25, y: -0.5, z: 1.5 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
      },
    },
    { type: 'link', id: 'base_link_id', helperKind: 'center-of-mass' },
    'frame',
  );

  assert.ok(target);
  assert.deepEqual(target.point.toArray(), [10.25, 1.5, 0.5]);
});

test('reuses hovered helper identity when selection only stores the link identity', () => {
  const robot = new THREE.Group();
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'base_link';
  link.position.set(10, 2, -1);
  robot.add(link);
  robot.updateMatrixWorld(true);

  const target = resolveRobotMeasureTargetFromSelection(
    robot,
    {
      base_link_id: {
        ...DEFAULT_LINK,
        id: 'base_link_id',
        name: 'base_link',
        inertial: {
          ...DEFAULT_LINK.inertial,
          origin: {
            xyz: { x: 0.25, y: -0.5, z: 1.5 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
      },
    },
    { type: 'link', id: 'base_link_id' },
    { type: 'link', id: 'base_link_id', helperKind: 'center-of-mass' },
    'geometry',
  );

  assert.ok(target);
  assert.deepEqual(target.point.toArray(), [10.25, 1.5, 0.5]);
});

test('resolves robot measure targets from ik-handle helpers even when the panel anchor mode is frame', () => {
  const robot = new THREE.Group();
  const link = new THREE.Group() as THREE.Group & {
    isURDFLink?: boolean;
    userData?: { __ikHandle?: THREE.Object3D };
  };
  link.isURDFLink = true;
  link.name = 'base_link';
  link.position.set(10, 2, -1);

  const ikHandle = new THREE.Group();
  ikHandle.position.set(0.25, -0.5, 1.5);
  link.add(ikHandle);
  link.userData = { __ikHandle: ikHandle };
  robot.add(link);
  robot.updateMatrixWorld(true);

  const target = resolveRobotMeasureTargetFromSelection(
    robot,
    {
      base_link_id: {
        ...DEFAULT_LINK,
        id: 'base_link_id',
        name: 'base_link',
      },
    },
    { type: 'link', id: 'base_link_id', helperKind: 'ik-handle' },
    'frame',
  );

  assert.ok(target);
  assert.deepEqual(target.point.toArray(), [10.25, 1.5, 0.5]);
});

test('resolves robot measure targets from the geometry center when anchor mode is geometry', () => {
  const robot = new THREE.Group();
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'base_link';
  link.position.set(10, 2, -1);

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
  mesh.position.set(5, 0, 0);
  link.add(mesh);
  robot.add(link);
  robot.updateMatrixWorld(true);

  const target = resolveRobotMeasureTargetFromSelection(
    robot,
    {
      base_link_id: {
        ...DEFAULT_LINK,
        id: 'base_link_id',
        name: 'base_link',
      },
    },
    { type: 'link', id: 'base_link_id', subType: 'visual', objectIndex: 0 },
    'geometry',
  );

  assert.ok(target);
  assert.deepEqual(target.point.toArray(), [15, 2, -1]);
});

test('resolves robot measure targets for folded MJCF synthetic links through the runtime parent link', () => {
  const robot = new THREE.Group();
  const runtimeParentLink = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  runtimeParentLink.isURDFLink = true;
  runtimeParentLink.name = 'base_link';
  runtimeParentLink.position.set(10, 2, -1);

  const mainVisual = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  mainVisual.position.set(-3, 0, 0);
  const attachmentVisual = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 2),
    new THREE.MeshBasicMaterial(),
  );
  attachmentVisual.position.set(5, 0, 0);
  runtimeParentLink.add(mainVisual, attachmentVisual);
  robot.add(runtimeParentLink);
  robot.updateMatrixWorld(true);

  const target = resolveRobotMeasureTargetFromSelection(
    robot,
    {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
      base_link_geom_1: {
        ...DEFAULT_LINK,
        id: 'base_link_geom_1',
        name: 'base_link_geom_1',
      },
    },
    { type: 'link', id: 'base_link_geom_1', subType: 'visual', objectIndex: 1 },
    'geometry',
  );

  assert.ok(target);
  assert.equal(target.linkName, 'base_link_geom_1');
  assert.deepEqual(target.point.toArray(), [15, 2, -1]);
});

test('resolves usd measure targets through the shared selection contract', () => {
  const firstMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  firstMesh.position.set(1, 0, 0);
  firstMesh.userData.usdObjectIndex = 0;

  const secondMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  secondMesh.position.set(6, 2, 0);
  secondMesh.userData.usdObjectIndex = 1;

  const visualMeshes = new Map<string, THREE.Mesh[]>();
  visualMeshes.set('/Robot/base_link:visual', [firstMesh, secondMesh]);

  const target = resolveUsdMeasureTargetFromSelection(
    {
      resolution: {
        robotData: {
          name: 'Robot',
          rootLinkId: 'base_link',
          links: {},
          joints: {},
        },
        stageSourcePath: '/Robot/base_link.usdz',
        linkIdByPath: {
          '/Robot/base_link': 'base_link',
        },
        linkPathById: {
          base_link: '/Robot/base_link',
        },
        jointPathById: {},
        childLinkPathByJointId: {},
        parentLinkPathByJointId: {},
      },
      meshesByLinkKey: visualMeshes,
    },
    {
      type: 'link',
      id: 'base_link',
    },
    {
      type: 'link',
      id: 'base_link',
      subType: 'visual',
      objectIndex: 1,
    },
    'geometry',
  );

  assert.ok(target);
  assert.equal(target.linkName, 'base_link');
  assert.equal(target.objectType, 'visual');
  assert.equal(target.objectIndex, 1);
  assert.deepEqual(target.point.toArray(), [6, 2, 0]);
});

test('resolves usd measure targets from the link frame origin when runtime link transforms are available', () => {
  const firstMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  firstMesh.position.set(1, 0, 0);
  firstMesh.userData.usdObjectIndex = 0;

  const visualMeshes = new Map<string, THREE.Mesh[]>();
  visualMeshes.set('/Robot/base_link:visual', [firstMesh]);

  const target = resolveUsdMeasureTargetFromSelection(
    {
      resolution: {
        robotData: {
          name: 'Robot',
          rootLinkId: 'base_link',
          links: {
            base_link: {
              ...DEFAULT_LINK,
              id: 'base_link',
              name: 'base_link',
              inertial: {
                ...DEFAULT_LINK.inertial,
                origin: {
                  xyz: { x: 0.4, y: 0.5, z: -0.6 },
                  rpy: { r: 0, p: 0, y: 0 },
                },
              },
            },
          },
          joints: {},
        },
        stageSourcePath: '/Robot/base_link.usdz',
        linkIdByPath: {
          '/Robot/base_link': 'base_link',
        },
        linkPathById: {
          base_link: '/Robot/base_link',
        },
        jointPathById: {},
        childLinkPathByJointId: {},
        parentLinkPathByJointId: {},
      },
      meshesByLinkKey: visualMeshes,
      linkWorldTransformResolver: () => new THREE.Matrix4().makeTranslation(3, 4, 5),
    },
    {
      type: 'link',
      id: 'base_link',
      subType: 'visual',
      objectIndex: 0,
    },
    undefined,
    'frame',
  );

  assert.ok(target);
  assert.deepEqual(target.point.toArray(), [3, 4, 5]);
});

test('resolves usd measure targets from the transformed center of mass when anchor mode is centerOfMass', () => {
  const firstMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  firstMesh.position.set(1, 0, 0);
  firstMesh.userData.usdObjectIndex = 0;

  const visualMeshes = new Map<string, THREE.Mesh[]>();
  visualMeshes.set('/Robot/base_link:visual', [firstMesh]);

  const target = resolveUsdMeasureTargetFromSelection(
    {
      resolution: {
        robotData: {
          name: 'Robot',
          rootLinkId: 'base_link',
          links: {
            base_link: {
              ...DEFAULT_LINK,
              id: 'base_link',
              name: 'base_link',
              inertial: {
                ...DEFAULT_LINK.inertial,
                origin: {
                  xyz: { x: 0.4, y: 0.5, z: -0.6 },
                  rpy: { r: 0, p: 0, y: 0 },
                },
              },
            },
          },
          joints: {},
        },
        stageSourcePath: '/Robot/base_link.usdz',
        linkIdByPath: {
          '/Robot/base_link': 'base_link',
        },
        linkPathById: {
          base_link: '/Robot/base_link',
        },
        jointPathById: {},
        childLinkPathByJointId: {},
        parentLinkPathByJointId: {},
      },
      meshesByLinkKey: visualMeshes,
      linkWorldTransformResolver: () => new THREE.Matrix4().makeTranslation(3, 4, 5),
    },
    {
      type: 'link',
      id: 'base_link',
      subType: 'visual',
      objectIndex: 0,
    },
    undefined,
    'centerOfMass',
  );

  assert.ok(target);
  assert.deepEqual(target.point.toArray(), [3.4, 4.5, 4.4]);
});

test('resolves usd measure targets from center-of-mass helpers even when the panel anchor mode is frame', () => {
  const target = resolveUsdMeasureTargetFromSelection(
    {
      resolution: {
        robotData: {
          name: 'Robot',
          rootLinkId: 'base_link',
          links: {
            base_link: {
              ...DEFAULT_LINK,
              id: 'base_link',
              name: 'base_link',
              inertial: {
                ...DEFAULT_LINK.inertial,
                origin: {
                  xyz: { x: 0.4, y: 0.5, z: -0.6 },
                  rpy: { r: 0, p: 0, y: 0 },
                },
              },
            },
          },
          joints: {},
        },
        stageSourcePath: '/Robot/base_link.usdz',
        linkIdByPath: {
          '/Robot/base_link': 'base_link',
        },
        linkPathById: {
          base_link: '/Robot/base_link',
        },
        jointPathById: {},
        childLinkPathByJointId: {},
        parentLinkPathByJointId: {},
      },
      meshesByLinkKey: new Map(),
      linkWorldTransformResolver: () => new THREE.Matrix4().makeTranslation(3, 4, 5),
    },
    {
      type: 'link',
      id: 'base_link',
      helperKind: 'center-of-mass',
    },
    undefined,
    'frame',
  );

  assert.ok(target);
  assert.deepEqual(target.point.toArray(), [3.4, 4.5, 4.4]);
});
