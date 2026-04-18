import test from 'node:test';
import assert from 'node:assert/strict';

import { GeometryType, JointType, type RobotState } from '@/types';
import {
  buildUsdLinkPathMaps,
  buildUsdPhysicsLayerContent,
  buildUsdRobotLayerContent,
  buildUsdRootLayerContent,
  buildUsdSensorLayerContent,
  createUsdArchivePackage,
} from './usdPackageLayers.ts';

const createLayeredRobot = (): RobotState => {
  return {
    name: 'demo_robot',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    joints: {
      child_joint: {
        id: 'child_joint',
        name: 'child_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'child_link',
        origin: { xyz: { x: 0.1, y: 0.2, z: 0.3 }, rpy: { r: 0, p: 0, y: Math.PI / 4 } },
        axis: { x: 0, y: 1, z: 0 },
        angle: 0,
        limit: { lower: -Math.PI / 6, upper: Math.PI / 3, effort: 10, velocity: 3 },
        dynamics: { damping: 0.2, friction: 0 },
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
          type: GeometryType.CYLINDER,
          dimensions: { x: 0.1, y: 0.5, z: 0 },
          color: '#00ff00',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.MESH,
          meshPath: 'meshes/collision.stl',
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1.5,
          origin: { xyz: { x: 0.01, y: 0.02, z: 0.03 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 0.4, ixy: 0, ixz: 0, iyy: 0.5, iyz: 0, izz: 0.6 },
        },
      },
    },
    materials: {},
  };
};

test('usd package layers serialize root and sensor configuration prims', () => {
  const rootLayer = buildUsdRootLayerContent('demo_robot_description', 'demo_robot_description');
  const sensorLayer = buildUsdSensorLayerContent('demo_robot_description');

  assert.match(rootLayer, /defaultPrim = "demo_robot_description"/);
  assert.match(rootLayer, /prepend references = @configuration\/demo_robot_description_base\.usd@/);
  assert.match(rootLayer, /prepend payload = @configuration\/demo_robot_description_physics\.usd@/);
  assert.match(rootLayer, /prepend payload = @configuration\/demo_robot_description_sensor\.usd@/);
  assert.match(sensorLayer, /def Xform "demo_robot_description"/);
});

test('isaacsim usd package layers add a Robot variant and robot sidecar references', () => {
  const robot = createLayeredRobot();
  const pathMaps = buildUsdLinkPathMaps(robot, 'demo_robot', {
    layoutProfile: 'isaacsim',
  });
  const robotLayer = buildUsdRobotLayerContent(robot, pathMaps, 'demo_robot', {
    layoutProfile: 'isaacsim',
  });
  const rootLayer = buildUsdRootLayerContent('demo_robot', 'demo_robot', {
    layoutProfile: 'isaacsim',
    fileFormat: 'usda',
  });

  assert.match(rootLayer, /string Robot = "Robot"/);
  assert.match(rootLayer, /prepend variantSets = \["Physics", "Sensor", "Robot"\]/);
  assert.match(rootLayer, /prepend payload = @configuration\/demo_robot_robot\.usda@/);
  assert.match(robotLayer, /prepend apiSchemas = \["IsaacRobotAPI"\]/);
  assert.match(robotLayer, /prepend rel isaac:physics:robotLinks = \[/);
  assert.match(robotLayer, /<\/demo_robot\/base_link>/);
  assert.match(robotLayer, /<\/demo_robot\/child_link>/);
  assert.doesNotMatch(robotLayer, /<\/demo_robot\/base_link\/child_link>/);
  assert.match(robotLayer, /prepend rel isaac:physics:robotJoints = \[/);
  assert.match(robotLayer, /prepend apiSchemas = \["IsaacLinkAPI"\]/);
  assert.match(robotLayer, /prepend apiSchemas = \["IsaacJointAPI"\]/);
});

test('usd package layers serialize articulation, joint paths, and mesh collision overrides', () => {
  const robot = createLayeredRobot();
  const pathMaps = buildUsdLinkPathMaps(robot, 'demo_robot_description');
  const physicsLayer = buildUsdPhysicsLayerContent(
    robot,
    pathMaps,
    'demo_robot_description',
    'demo_robot_description',
  );

  assert.match(physicsLayer, /subLayers = \[\n\s+@demo_robot_description_base\.usd@\n\s+\]/);
  assert.match(physicsLayer, /prepend apiSchemas = \["PhysicsArticulationRootAPI"\]/);
  assert.match(physicsLayer, /rel physics:body0 = <\/demo_robot_description\/base_link>/);
  assert.match(
    physicsLayer,
    /rel physics:body1 = <\/demo_robot_description\/base_link\/child_link>/,
  );
  assert.match(physicsLayer, /uniform token physics:axis = "Y"/);
  assert.match(physicsLayer, /custom float3 urdf:axisLocal = \(0, 1, 0\)/);
  assert.match(physicsLayer, /float physics:lowerLimit = -30/);
  assert.match(physicsLayer, /float physics:upperLimit = 60/);
  assert.match(physicsLayer, /prepend apiSchemas = \["PhysicsDriveAPI:angular"\]/);
  assert.match(physicsLayer, /uniform token drive:angular:physics:type = "force"/);
  assert.match(physicsLayer, /float drive:angular:physics:damping = 0\.2/);
  assert.match(physicsLayer, /float drive:angular:physics:maxForce = 10/);
  assert.match(
    physicsLayer,
    /over "collision_0" \(\n\s+prepend apiSchemas = \["PhysicsCollisionAPI", "PhysicsMeshCollisionAPI"\]\n\s*\)\n\s+\{/,
  );
  assert.match(physicsLayer, /uniform token physics:approximation = "convexHull"/);
});

test('isaacsim usd package layers flatten link prim paths for physics bodies', () => {
  const robot = createLayeredRobot();
  const pathMaps = buildUsdLinkPathMaps(robot, 'demo_robot', {
    layoutProfile: 'isaacsim',
  });
  const physicsLayer = buildUsdPhysicsLayerContent(robot, pathMaps, 'demo_robot', 'demo_robot', {
    layoutProfile: 'isaacsim',
    fileFormat: 'usda',
  });

  assert.match(physicsLayer, /rel physics:body0 = <\/demo_robot\/base_link>/);
  assert.match(physicsLayer, /rel physics:body1 = <\/demo_robot\/child_link>/);
  assert.doesNotMatch(physicsLayer, /rel physics:body1 = <\/demo_robot\/base_link\/child_link>/);
  assert.match(
    physicsLayer,
    /over "base_link" \(\n\s+prepend apiSchemas = \["PhysicsRigidBodyAPI", "PhysicsArticulationRootAPI"\]\n\s*\)\n\s+\{/,
  );
  assert.match(
    physicsLayer,
    /over "child_link" \(\n\s+prepend apiSchemas = \["PhysicsRigidBodyAPI", "PhysicsMassAPI"\]\n\s*\)\n\s+\{/,
  );
});

test('isaacsim usd package layers author the articulation root on the root link instead of the package root', () => {
  const robot = createLayeredRobot();
  robot.links.base_link.inertial = {
    mass: 4.2,
    origin: { xyz: { x: 0.01, y: -0.02, z: 0.03 }, rpy: { r: 0, p: 0, y: 0 } },
    inertia: { ixx: 0.8, ixy: 0, ixz: 0, iyy: 0.9, iyz: 0, izz: 1.1 },
  };

  const pathMaps = buildUsdLinkPathMaps(robot, 'demo_robot', {
    layoutProfile: 'isaacsim',
  });
  const physicsLayer = buildUsdPhysicsLayerContent(robot, pathMaps, 'demo_robot', 'demo_robot', {
    layoutProfile: 'isaacsim',
    fileFormat: 'usda',
  });

  assert.doesNotMatch(
    physicsLayer,
    /over "demo_robot" \(\n\s+prepend apiSchemas = \["PhysicsArticulationRootAPI"\]\n\s*\)\n\s+\{/,
  );
  assert.match(
    physicsLayer,
    /over "base_link" \(\n\s+prepend apiSchemas = \["PhysicsRigidBodyAPI", "PhysicsMassAPI", "PhysicsArticulationRootAPI"\]\n\s*\)\n\s+\{/,
  );
});

test('usd package layers omit centerOfMass when inertial origin is not authored', () => {
  const robot = createLayeredRobot();
  if (robot.links.child_link.inertial) {
    robot.links.child_link.inertial.origin = undefined;
  }

  const pathMaps = buildUsdLinkPathMaps(robot, 'demo_robot_description');
  const physicsLayer = buildUsdPhysicsLayerContent(
    robot,
    pathMaps,
    'demo_robot_description',
    'demo_robot_description',
  );

  assert.match(physicsLayer, /float physics:mass = 1\.5/);
  assert.doesNotMatch(physicsLayer, /float3 physics:centerOfMass =/);
  assert.match(physicsLayer, /float3 physics:diagonalInertia =/);
});

test('usd package layers package root and configuration files under stable usd paths', async () => {
  const archive = createUsdArchivePackage(
    'demo_robot',
    {
      rootLayerContent: 'root',
      baseLayerContent: 'base',
      physicsLayerContent: 'physics',
      sensorLayerContent: 'sensor',
    },
    new Map([['assets/checker.png', new Blob(['texture'], { type: 'image/png' })]]),
  );

  assert.equal(archive.archiveFileName, 'demo_robot_usd.zip');
  assert.equal(archive.rootLayerPath, 'demo_robot/usd/demo_robot.usd');
  assert.deepEqual(Array.from(archive.archiveFiles.keys()).sort(), [
    'demo_robot/usd/assets/checker.png',
    'demo_robot/usd/configuration/demo_robot_description_base.usd',
    'demo_robot/usd/configuration/demo_robot_description_physics.usd',
    'demo_robot/usd/configuration/demo_robot_description_sensor.usd',
    'demo_robot/usd/demo_robot.usd',
  ]);

  assert.equal(await archive.archiveFiles.get('demo_robot/usd/demo_robot.usd')?.text(), 'root');
  assert.equal(
    await archive.archiveFiles
      .get('demo_robot/usd/configuration/demo_robot_description_base.usd')
      ?.text(),
    'base',
  );
});

test('isaacsim usd package layers place the root file beside configuration sidecars', async () => {
  const archive = createUsdArchivePackage(
    'demo_robot',
    {
      rootLayerContent: 'root',
      baseLayerContent: 'base',
      physicsLayerContent: 'physics',
      sensorLayerContent: 'sensor',
      robotLayerContent: 'robot',
    },
    new Map([['assets/checker.png', new Blob(['texture'], { type: 'image/png' })]]),
    {
      layoutProfile: 'isaacsim',
      fileFormat: 'usda',
    },
  );

  assert.equal(archive.archiveFileName, 'demo_robot_usda.zip');
  assert.equal(archive.rootLayerPath, 'demo_robot/demo_robot.usda');
  assert.deepEqual(Array.from(archive.archiveFiles.keys()).sort(), [
    'demo_robot/assets/checker.png',
    'demo_robot/configuration/demo_robot_base.usda',
    'demo_robot/configuration/demo_robot_physics.usda',
    'demo_robot/configuration/demo_robot_robot.usda',
    'demo_robot/configuration/demo_robot_sensor.usda',
    'demo_robot/demo_robot.usda',
  ]);
  assert.equal(
    await archive.archiveFiles.get('demo_robot/configuration/demo_robot_robot.usda')?.text(),
    'robot',
  );
});
