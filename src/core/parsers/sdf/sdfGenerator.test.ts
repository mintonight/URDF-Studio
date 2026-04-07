import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type RobotClosedLoopConstraint,
  type RobotState,
} from '@/types';
import { parseMJCF } from '@/core/parsers/mjcf/mjcfParser.ts';
import { generateSDF, generateSdfModelConfig } from './sdfGenerator.ts';
import { parseSDF } from './sdfParser.ts';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;

const CLOSED_LOOP_ROUNDTRIP_FIXTURES = [
  {
    name: 'agility_cassie',
    path: 'test/mujoco_menagerie-main/agility_cassie/cassie.xml',
    expectedClosedLoopCount: 4,
  },
  {
    name: 'robotiq_2f85',
    path: 'test/mujoco_menagerie-main/robotiq_2f85/2f85.xml',
    expectedClosedLoopCount: 2,
  },
] as const;

function assertVectorAlmostEqual(
  actual: { x: number; y: number; z: number },
  expected: { x: number; y: number; z: number },
  message: string,
): void {
  assert.ok(Math.abs(actual.x - expected.x) <= 1e-6, `${message} (x)`);
  assert.ok(Math.abs(actual.y - expected.y) <= 1e-6, `${message} (y)`);
  assert.ok(Math.abs(actual.z - expected.z) <= 1e-6, `${message} (z)`);
}

function assertClosedLoopConstraintsMatch(
  actualConstraints: RobotClosedLoopConstraint[] | undefined,
  expectedConstraints: RobotClosedLoopConstraint[] | undefined,
  fixtureName: string,
): void {
  const actualEntries = [...(actualConstraints || [])].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const expectedEntries = [...(expectedConstraints || [])].sort((left, right) =>
    left.id.localeCompare(right.id),
  );

  assert.equal(
    actualEntries.length,
    expectedEntries.length,
    `expected ${fixtureName} to preserve closed-loop constraint count`,
  );

  const actualById = new Map(actualEntries.map((constraint) => [constraint.id, constraint]));
  for (const expectedConstraint of expectedEntries) {
    const actualConstraint = actualById.get(expectedConstraint.id);
    assert.ok(
      actualConstraint,
      `expected ${fixtureName} to preserve closed-loop id ${expectedConstraint.id}`,
    );
    if (!actualConstraint) {
      continue;
    }

    assert.equal(actualConstraint.type, expectedConstraint.type);
    assert.equal(actualConstraint.linkAId, expectedConstraint.linkAId);
    assert.equal(actualConstraint.linkBId, expectedConstraint.linkBId);
    assertVectorAlmostEqual(
      actualConstraint.anchorLocalA,
      expectedConstraint.anchorLocalA,
      `${fixtureName} ${expectedConstraint.id} anchorLocalA`,
    );
    assertVectorAlmostEqual(
      actualConstraint.anchorLocalB,
      expectedConstraint.anchorLocalB,
      `${fixtureName} ${expectedConstraint.id} anchorLocalB`,
    );
    assertVectorAlmostEqual(
      actualConstraint.anchorWorld,
      expectedConstraint.anchorWorld,
      `${fixtureName} ${expectedConstraint.id} anchorWorld`,
    );
  }
}

test('generateSDF produces a roundtrippable model package for RobotState data', () => {
  const robot: RobotState = {
    name: 'roundtrip_demo',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 2, z: 3 },
          color: '#336699',
        },
        visualBodies: [
          {
            ...DEFAULT_LINK.visual,
            type: GeometryType.MESH,
            dimensions: { x: 0.5, y: 0.5, z: 0.5 },
            meshPath: 'package://demo_pkg/meshes/sign.dae',
            color: '#ffffff',
            origin: {
              xyz: { x: 0.5, y: 0, z: 0 },
              rpy: { r: 0, p: 0, y: 0 },
            },
          },
        ],
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 2, z: 3 },
        },
        collisionBodies: [
          {
            ...DEFAULT_LINK.collision,
            type: GeometryType.SPHERE,
            dimensions: { x: 0.25, y: 0.25, z: 0.25 },
            origin: {
              xyz: { x: 0, y: 1, z: 0 },
              rpy: { r: 0, p: 0, y: 0 },
            },
          },
        ],
        inertial: {
          mass: 2.5,
          origin: {
            xyz: { x: 0.05, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
          inertia: {
            ixx: 1,
            ixy: 0,
            ixz: 0,
            iyy: 2,
            iyz: 0,
            izz: 3,
          },
        },
      },
      tip_link: {
        ...DEFAULT_LINK,
        id: 'tip_link',
        name: 'tip_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.CYLINDER,
          dimensions: { x: 0.1, y: 0.4, z: 0.1 },
          color: '#ff8800',
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.CYLINDER,
          dimensions: { x: 0.1, y: 0.4, z: 0.1 },
        },
      },
    },
    joints: {
      tip_joint: {
        ...DEFAULT_JOINT,
        id: 'tip_joint',
        name: 'tip_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'tip_link',
        origin: {
          xyz: { x: 0.1, y: 0.2, z: 0.3 },
          rpy: { r: 0.1, p: -0.2, y: 0.3 },
        },
        axis: { x: 0, y: 0, z: 1 },
        limit: {
          lower: -1.57,
          upper: 1.57,
          effort: 10,
          velocity: 2,
        },
        dynamics: {
          damping: 0.2,
          friction: 0.05,
        },
      },
    },
    selection: { type: null, id: null },
  };

  const xml = generateSDF(robot, { packageName: 'roundtrip_pkg' });
  const reparsed = parseSDF(xml, { sourcePath: 'roundtrip_pkg/model.sdf' });

  assert.match(xml, /<model name="roundtrip_demo">/);
  assert.match(xml, /model:\/\/roundtrip_pkg\/meshes\/sign\.dae/);
  assert.ok(reparsed);
  assert.equal(reparsed?.name, 'roundtrip_demo');
  assert.equal(reparsed?.links.base_link.visual.type, GeometryType.BOX);
  assert.equal(reparsed?.links.base_link.visualBodies?.[0]?.type, GeometryType.MESH);
  assert.equal(
    reparsed?.links.base_link.visualBodies?.[0]?.meshPath,
    'model://roundtrip_pkg/meshes/sign.dae',
  );
  assert.equal(reparsed?.links.base_link.collisionBodies?.[0]?.type, GeometryType.SPHERE);
  assert.deepEqual(reparsed?.joints.tip_joint.origin.xyz, { x: 0.1, y: 0.2, z: 0.3 });
  assert.ok(Math.abs((reparsed?.joints.tip_joint.origin.rpy.r ?? 0) - 0.1) < 1e-6);
  assert.ok(Math.abs((reparsed?.joints.tip_joint.origin.rpy.p ?? 0) + 0.2) < 1e-6);
  assert.ok(Math.abs((reparsed?.joints.tip_joint.origin.rpy.y ?? 0) - 0.3) < 1e-6);
});

test('generateSdfModelConfig points Gazebo-style packages at model.sdf', () => {
  const config = generateSdfModelConfig('roundtrip_demo');

  assert.match(config, /<name>roundtrip_demo<\/name>/);
  assert.match(config, /<sdf version="1\.7">model\.sdf<\/sdf>/);
});

for (const fixture of CLOSED_LOOP_ROUNDTRIP_FIXTURES) {
  test(`generateSDF preserves closed-loop constraints for ${fixture.name}`, () => {
    const xml = fs.readFileSync(fixture.path, 'utf8');
    const robot = parseMJCF(xml);

    assert.ok(robot, `expected ${fixture.name} MJCF fixture to parse`);
    assert.equal(
      robot?.closedLoopConstraints?.length,
      fixture.expectedClosedLoopCount,
      `expected ${fixture.name} MJCF fixture to expose closed loops before SDF export`,
    );

    if (!robot) {
      return;
    }

    const sdf = generateSDF(robot, { packageName: fixture.name });
    const reparsed = parseSDF(sdf, { sourcePath: `${fixture.name}/model.sdf` });

    assert.ok(reparsed, `expected ${fixture.name} SDF roundtrip to parse`);
    assert.equal(
      reparsed?.closedLoopConstraints?.length,
      fixture.expectedClosedLoopCount,
      `expected ${fixture.name} SDF roundtrip to preserve closed-loop count`,
    );
    assertClosedLoopConstraintsMatch(
      reparsed?.closedLoopConstraints,
      robot.closedLoopConstraints,
      fixture.name,
    );
  });
}
