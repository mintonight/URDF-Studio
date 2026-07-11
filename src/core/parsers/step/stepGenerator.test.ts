import test from 'node:test';
import assert from 'node:assert/strict';

import type { RobotData } from '@/types';
import { GeometryType } from '@/types';
import { generateSTEP } from './stepGenerator';

function makeBoxRobot(): RobotData {
  return {
    name: 'test-box',
    rootLinkId: 'base',
    links: {
      base: {
        id: 'base',
        name: 'base',
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 0.1, y: 0.2, z: 0.3 },
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          color: '#cccccc',
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          color: '#cccccc',
        },
      },
    },
    joints: {},
  } as unknown as RobotData;
}

function makeMultiLinkRobot(): RobotData {
  return {
    name: 'two-link',
    rootLinkId: 'base',
    links: {
      base: {
        id: 'base',
        name: 'base',
        visual: {
          type: GeometryType.CYLINDER,
          dimensions: { x: 0.05, y: 0.2, z: 0.05 },
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          color: '#cccccc',
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          color: '#cccccc',
        },
      },
      arm: {
        id: 'arm',
        name: 'arm',
        visual: {
          type: GeometryType.SPHERE,
          dimensions: { x: 0.04, y: 0.04, z: 0.04 },
          origin: { xyz: { x: 0, y: 0, z: 0.2 }, rpy: { r: 0, p: 0, y: 0 } },
          color: '#cccccc',
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          color: '#cccccc',
        },
      },
    },
    joints: {
      j1: {
        id: 'j1',
        name: 'j1',
        type: 'fixed',
        parentLinkId: 'base',
        childLinkId: 'arm',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      } as never,
    },
  } as unknown as RobotData;
}

test('generateSTEP emits a valid ISO 10303-21 structure for a box robot', async () => {
  const result = await generateSTEP(makeBoxRobot());

  assert.match(result.content, /^ISO-10303-21;/);
  assert.match(result.content, /HEADER;/);
  assert.match(result.content, /FILE_SCHEMA\(\('AUTOMOTIVE_DESIGN/);
  assert.match(result.content, /DATA;/);
  assert.match(result.content, /ENDSEC;/);
  assert.match(result.content, /END-ISO-10303-21;/);
  assert.equal(result.linkCount, 1);
  assert.equal(result.shapeCount, 1);
});

test('generateSTEP writes analytic surface entities for primitives', async () => {
  const result = await generateSTEP(makeMultiLinkRobot());

  // Cylinder link should produce a CYLINDRICAL_SURFACE.
  assert.match(result.content, /CYLINDRICAL_SURFACE/);
  // Sphere link should produce a SPHERICAL_SURFACE.
  assert.match(result.content, /SPHERICAL_SURFACE/);
  // Each link becomes its own PRODUCT.
  const productCount = (result.content.match(/= PRODUCT\(/g) ?? []).length;
  assert.ok(productCount >= 2, `expected at least 2 products, got ${productCount}`);
  assert.equal(result.linkCount, 2);
  assert.equal(result.shapeCount, 2);
});

test('generateSTEP skips MESH visuals when includeMeshes is false', async () => {
  const robot = makeBoxRobot();
  robot.links.base.visual = {
    type: GeometryType.MESH,
    dimensions: { x: 1, y: 1, z: 1 },
    origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    color: '#cccccc',
    meshPath: 'meshes/base.stl',
  };
  const result = await generateSTEP(robot, { includeMeshes: false });
  assert.equal(result.shapeCount, 0, 'expected mesh to be skipped');
  assert.equal(result.linkCount, 0);
});

test('generateSTEP writes tessellated shell for mesh geometry', async () => {
  const robot = makeBoxRobot();
  robot.links.base.visual = {
    type: GeometryType.MESH,
    dimensions: { x: 1, y: 1, z: 1 },
    origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
    color: '#cccccc',
    meshPath: 'meshes/base.stl',
  };
  const result = await generateSTEP(robot, {
    provider: {
      async loadMeshGeometry() {
        // Single triangle.
        return {
          positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        };
      },
    },
  });
  assert.equal(result.shapeCount, 1);
  assert.match(result.content, /ADVANCED_FACE/);
  assert.match(result.content, /CLOSED_SHELL/);
});

test('generateSTEP builds assembly hierarchy with NEXT_ASSEMBLY_USAGE_OCCURRENCE', async () => {
  const result = await generateSTEP(makeMultiLinkRobot());
  const nauoCount = (result.content.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE/g) ?? []).length;
  assert.ok(
    nauoCount >= 2,
    `expected at least 2 assembly usage occurrences (one per link), got ${nauoCount}`,
  );
});
