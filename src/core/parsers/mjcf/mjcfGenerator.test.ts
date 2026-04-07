import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { JSDOM } from 'jsdom';

import { GeometryType, JointType, type RobotState } from '../../../types';
import { computeLinkWorldMatrices } from '@/core/robot/kinematics';

import { generateMujocoXML } from './mjcfGenerator.ts';
import { classifyMJCFGeom } from './mjcfGeomClassification.ts';
import { parseMJCFModel } from './mjcfModel.ts';
import { parseMJCF } from './mjcfParser.ts';
import { parseURDF } from '../urdf/parser/index.ts';

const GO2_MJCF_PATH = path.resolve('test/mujoco_menagerie-main/unitree_go2/go2.xml');

function installDomParser(): void {
  if (typeof DOMParser !== 'undefined') {
    return;
  }

  const dom = new JSDOM('<!doctype html><html><body></body></html>', { contentType: 'text/html' });
  globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
}

function findBodyByName(body: { name: string; children: any[] }, name: string): any | null {
  if (body.name === name) {
    return body;
  }

  for (const child of body.children) {
    const match = findBodyByName(child, name);
    if (match) {
      return match;
    }
  }

  return null;
}

function assertMatricesClose(
  source: RobotState,
  roundtrip: RobotState,
  linkIds: string[],
  tolerance = 1e-6,
): void {
  const sourceMatrices = computeLinkWorldMatrices(source);
  const roundtripMatrices = computeLinkWorldMatrices(roundtrip);

  linkIds.forEach((linkId) => {
    const sourceMatrix = sourceMatrices[linkId];
    const roundtripMatrix = roundtripMatrices[linkId];

    assert.ok(sourceMatrix, `expected source world matrix for ${linkId}`);
    assert.ok(roundtripMatrix, `expected roundtrip world matrix for ${linkId}`);

    sourceMatrix.elements.forEach((value, index) => {
      const delta = Math.abs(value - roundtripMatrix.elements[index]!);
      assert.ok(
        delta <= tolerance,
        `expected ${linkId} world matrix element ${index} to roundtrip (delta=${delta})`,
      );
    });
  });
}

test('generated MJCF marks collision meshes as collision-only geoms', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'aloha-like',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#262626',
          meshPath: 'assets/base.stl',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ff0000',
          meshPath: 'assets/base.stl',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot, { meshdir: 'meshes/' });
  const parsed = parseMJCFModel(generated);
  const baseLinkBody = findBodyByName(parsed.worldBody as any, 'base_link');
  const geoms = baseLinkBody?.geoms ?? [];
  const collisionGeom = geoms[1];

  assert.ok(collisionGeom);
  assert.equal(collisionGeom.group, 3);
  assert.equal(collisionGeom.contype, 1);
  assert.equal(collisionGeom.conaffinity, 1);
  assert.deepEqual(classifyMJCFGeom(collisionGeom), { isVisual: false, isCollision: true });
});

test('generated MJCF omits preview scene helpers by default', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'plain-export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot);

  assert.doesNotMatch(generated, /<light pos="0 0 10" dir="0 0 -1" diffuse="1 1 1"\/>/);
  assert.doesNotMatch(generated, /<geom type="plane" size="5 5 0\.1" rgba="\.9 \.9 \.9 1"\/>/);
});

test('generated MJCF keeps visual meshes in the visual-only group', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'single-visual',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 2, z: 3 },
          color: '#262626',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {} as Record<string, never>,
    materials: {},
  };

  const generated = generateMujocoXML(robot);
  const parsed = parseMJCFModel(generated);
  const baseLinkBody = findBodyByName(parsed.worldBody as any, 'base_link');
  const visualGeom = baseLinkBody?.geoms?.[0];

  assert.ok(visualGeom);
  assert.equal(visualGeom.group, 1);
  assert.deepEqual(classifyMJCFGeom(visualGeom), { isVisual: true, isCollision: false });
});

test('generated MJCF carries USD snapshot material PBR fields into material assets', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'pbr-export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#d6d9e4',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#000000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {
      base_link: {
        color: '#d6d9e4',
        texture: 'textures/body_basecolor.png',
        usdMaterial: {
          roughness: 0.25,
          metalness: 0.6,
          emissive: [0.4, 0.1, 0],
          emissiveIntensity: 0.5,
        },
      },
    },
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
    texturedir: 'textures/',
  });

  assert.match(generated, /<material name="base_link_mat"[^>]*texture="base_link_tex"/);
  assert.match(generated, /specular="0"/);
  assert.match(generated, /shininess="0\.75"/);
  assert.match(generated, /reflectance="0\.6"/);
  assert.match(generated, /emission="0\.2"/);
});

test('generated MJCF skips emission when USD snapshot material disables emissive output', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'disabled-emissive-export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#bfc4d2',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#000000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {
      base_link: {
        color: '#bfc4d2',
        usdMaterial: {
          roughness: 0.4,
          emissive: [1, 1, 1],
          emissiveEnabled: false,
          emissiveIntensity: 10000,
        },
      },
    },
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
  });

  assert.match(generated, /<material name="base_link_mat"/);
  assert.match(generated, /specular="0"/);
  assert.match(generated, /shininess="0\.6"/);
  assert.doesNotMatch(generated, /emission="/);
});

test('generated MJCF keeps the root body at the world origin', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'root-origin',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.SPHERE,
          dimensions: { x: 0.2, y: 0, z: 0 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
  });
  const parsed = parseMJCFModel(generated);
  const baseLinkBody = findBodyByName(parsed.worldBody as any, 'base_link');

  assert.ok(baseLinkBody);
  assert.deepEqual(baseLinkBody.pos, [0, 0, 0]);
  assert.doesNotMatch(generated, /<light /);
  assert.doesNotMatch(generated, /type="plane"/);
});

test('generated MJCF exports plane geoms as first-class plane types', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'plane-export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.PLANE,
          dimensions: { x: 6, y: 4, z: 0 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot, { includeSceneHelpers: false });
  assert.match(generated, /type="plane" size="3 2 0\.1"/);
});

test('generated MJCF exports signed distance field geoms without collapsing them into mesh types', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'sdf-export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.SDF,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#808080',
          meshPath: 'assets/distance_field.obj',
          assetRef: 'distance_field_source',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot, { includeSceneHelpers: false, meshdir: 'meshes/' });
  assert.match(
    generated,
    /<mesh name="distance_field_source" file="assets\/distance_field\.obj"\s*\/>/,
  );
  assert.match(generated, /type="sdf" mesh="distance_field_source"/);
  assert.doesNotMatch(generated, /type="mesh" mesh="assets_distance_field"/);
});

test('generated MJCF exports hfield geoms with dedicated asset definitions', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'hfield-export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.HFIELD,
          dimensions: { x: 4, y: 6, z: 0.5 },
          color: '#808080',
          assetRef: 'terrain_patch',
          mjcfHfield: {
            name: 'terrain_patch',
            file: 'terrain.png',
            contentType: 'image/png',
            size: {
              radiusX: 2,
              radiusY: 3,
              elevationZ: 0.4,
              baseZ: 0.1,
            },
          },
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot, { includeSceneHelpers: false, meshdir: 'meshes/' });
  assert.match(
    generated,
    /<hfield name="terrain_patch" file="terrain\.png" content_type="image\/png" size="2 3 0\.4 0\.1" \/>/,
  );
  assert.match(generated, /type="hfield" hfield="terrain_patch"/);
});

test('generated MJCF preserves collision-only hfield metadata after MJCF import', () => {
  installDomParser();

  const robot = parseMJCF(`
        <mujoco model="collision-hfield-roundtrip">
          <asset>
            <hfield name="terrain_patch" file="terrain.png" size="2 3 0.4 0.1" />
          </asset>
          <worldbody>
            <body name="base_link">
              <geom
                name="terrain_collision"
                type="hfield"
                hfield="terrain_patch"
                group="3"
                contype="1"
                conaffinity="1"
                rgba="0.3 0.5 0.3 1"
              />
            </body>
          </worldbody>
        </mujoco>
    `);

  assert.ok(robot);
  assert.equal(robot.links.base_link.visual.type, GeometryType.NONE);
  assert.equal(robot.links.base_link.collision.type, GeometryType.HFIELD);
  assert.equal(robot.links.base_link.collision.assetRef, 'terrain_patch');
  assert.deepEqual(robot.links.base_link.collision.mjcfHfield, {
    name: 'terrain_patch',
    file: 'terrain.png',
    contentType: undefined,
    nrow: undefined,
    ncol: undefined,
    size: {
      radiusX: 2,
      radiusY: 3,
      elevationZ: 0.4,
      baseZ: 0.1,
    },
    elevation: undefined,
  });

  const generated = generateMujocoXML(robot, { includeSceneHelpers: false, meshdir: 'meshes/' });
  assert.match(
    generated,
    /<hfield name="terrain_patch" file="terrain\.png" size="2 3 0\.4 0\.1" \/>/,
  );
  assert.match(generated, /type="hfield" hfield="terrain_patch"/);
});

test('generated MJCF preserves inline-only mesh assets that have vertex data', () => {
  installDomParser();

  const robot = parseMJCF(`
        <mujoco model="inline-mesh-export">
          <asset>
            <mesh
              name="pyramid"
              vertex="0 6 0  0 -6 0  0.5 6 0  0.5 -6 0  0.5 6 0.5  0.5 -6 0.5"
            />
          </asset>
          <worldbody>
            <body name="base_link">
              <geom type="mesh" mesh="pyramid" />
            </body>
          </worldbody>
        </mujoco>
    `);

  const generated = generateMujocoXML(robot, { includeSceneHelpers: false, meshdir: 'meshes/' });

  assert.match(
    generated,
    /<mesh name="pyramid" vertex="0 6 0 0 -6 0 0\.5 6 0 0\.5 -6 0 0\.5 6 0\.5 0\.5 -6 0\.5" \/>/,
  );
  assert.match(generated, /<material name="base_link_mat" rgba="[^"]+" specular="0" \/>/);
  assert.match(
    generated,
    /<geom pos="0 0 0" group="1" contype="0" conaffinity="0" material="base_link_mat" type="mesh" mesh="pyramid" \/>/,
  );
  assert.match(
    generated,
    /<geom pos="0 0 0" rgba="[^"]+" group="3" contype="1" conaffinity="1" type="mesh" mesh="pyramid" \/>/,
  );
});

test('generated MJCF exports floating root joints as freejoints while preserving root pose', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'floating-root-export',
    rootLinkId: 'world',
    selection: { type: null, id: null },
    links: {
      world: {
        id: 'world',
        name: 'world',
        visible: true,
        visual: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 0,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
        },
      },
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {
      floating_base_joint: {
        id: 'floating_base_joint',
        name: 'floating_base_joint',
        type: 'floating',
        parentLinkId: 'world',
        childLinkId: 'base_link',
        origin: {
          xyz: { x: 0, y: 0, z: 0.5 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        axis: { x: 0, y: 0, z: 1 },
        dynamics: { damping: 0, friction: 0 },
      } as RobotState['joints'][string],
    },
    materials: {},
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
  });
  const parsed = parseMJCFModel(generated);
  const baseLinkBody = findBodyByName(parsed.worldBody as any, 'base_link');
  const roundtrip = parseMJCF(generated);

  assert.match(
    generated,
    /<body name="base_link" pos="0 0 0\.5">[\s\S]*?<freejoint name="floating_base_joint"\/>/,
  );
  assert.doesNotMatch(generated, /<joint name="floating_base_joint" type="hinge"/);
  assert.ok(baseLinkBody);
  assert.deepEqual(baseLinkBody.pos, [0, 0, 0.5]);
  assert.ok(roundtrip);
  assert.equal(roundtrip?.joints.floating_base_joint?.type, 'floating');
  assert.deepEqual(roundtrip?.joints.floating_base_joint?.origin?.xyz, { x: 0, y: 0, z: 0.5 });
});

test('generated MJCF preserves fixed synthetic world root transforms through parser roundtrip', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'fixed-world-root-roundtrip',
    rootLinkId: 'world',
    selection: { type: null, id: null },
    links: {
      world: {
        id: 'world',
        name: 'world',
        visible: true,
        visual: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 0,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
        },
      },
      base: {
        id: 'base',
        name: 'base',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 0.4, y: 0.2, z: 0.1 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
      FR_thigh: {
        id: 'FR_thigh',
        name: 'FR_thigh',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 0.1, y: 0.3, z: 0.08 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: Math.PI / 2, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {
      world_to_base: {
        id: 'world_to_base',
        name: 'world_to_base',
        type: JointType.FIXED,
        parentLinkId: 'world',
        childLinkId: 'base',
        origin: {
          xyz: { x: 0.12, y: -0.08, z: 0.445 },
          rpy: { r: 0.25, p: -0.1, y: 0.4 },
        },
        axis: { x: 0, y: 0, z: 1 },
        dynamics: { damping: 0, friction: 0 },
        hardware: { armature: 0, motorType: '', motorId: '', motorDirection: 1 },
      },
      FR_thigh_joint: {
        id: 'FR_thigh_joint',
        name: 'FR_thigh_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base',
        childLinkId: 'FR_thigh',
        origin: {
          xyz: { x: 0.1934, y: -0.0465, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        axis: { x: 0, y: 1, z: 0 },
        limit: { lower: -1, upper: 1, effort: 10, velocity: 10 },
        dynamics: { damping: 0, friction: 0 },
        hardware: { armature: 0, motorType: '', motorId: '', motorDirection: 1 },
      },
    },
    materials: {},
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
  });
  const roundtrip = parseMJCF(generated);

  assert.ok(roundtrip, 'expected generated MJCF to parse');
  assert.equal(roundtrip?.rootLinkId, 'world');
  assert.deepEqual(roundtrip?.joints.world_to_base?.origin?.xyz, { x: 0.12, y: -0.08, z: 0.445 });
  assertMatricesClose(robot, roundtrip!, ['world', 'base', 'FR_thigh']);
});

test('generated MJCF does not inject a duplicate freejoint when the root is already floating', () => {
  installDomParser();

  const robot = parseMJCF(`
        <mujoco model="floating-root">
          <worldbody>
            <body name="base_link" pos="0 0 0.5">
              <joint name="floating_base_joint" type="free" limited="false" />
            </body>
          </worldbody>
        </mujoco>
    `);

  assert.ok(robot);

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
    addFloatBase: true,
  });

  const freejointMatches = generated.match(/<freejoint\b/g) || [];
  assert.equal(freejointMatches.length, 1);
  assert.doesNotMatch(generated, /__joint_stage_0/);
});

test('unitree_go2 MJCF roundtrip preserves the floating root joint and base pose', () => {
  installDomParser();

  const source = fs.readFileSync(GO2_MJCF_PATH, 'utf8');
  const imported = parseMJCF(source);
  assert.ok(imported, 'expected unitree_go2 MJCF to parse');

  const importedRootJoint = imported?.joints.joint_0;
  assert.ok(importedRootJoint, 'expected unitree_go2 to expose joint_0 as the floating root');
  assert.equal(importedRootJoint?.type, 'floating');
  assert.deepEqual(importedRootJoint?.origin?.xyz, { x: 0, y: 0, z: 0.445 });

  const exported = generateMujocoXML(imported!, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
  });
  const reparsed = parseMJCF(exported);

  assert.ok(reparsed, 'expected exported unitree_go2 MJCF to parse');
  assert.equal(reparsed?.joints.joint_0?.type, 'floating');
  assert.deepEqual(reparsed?.joints.joint_0?.origin?.xyz, { x: 0, y: 0, z: 0.445 });
  assert.match(exported, /<body name="base" pos="0 0 0\.445">[\s\S]*?<freejoint name="joint_0"\/>/);
});

test('generated MJCF preserves missing URDF inertial without crashing', () => {
  installDomParser();

  const robot = parseURDF(`<?xml version="1.0"?>
<robot name="missing_inertial">
  <link name="base_link">
    <visual>
      <geometry>
        <box size="1 1 1" />
      </geometry>
    </visual>
  </link>
</robot>`);

  assert.ok(robot);
  assert.equal(robot.links.base_link?.inertial, undefined);

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
  });

  assert.match(generated, /<body name="base_link"/);
  assert.doesNotMatch(generated, /<inertial\b/);
});

test('generated MJCF writes visual materials from robot state and binds them on geoms', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'material-export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#262626',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {
      base_link: {
        color: '#123456',
      },
    },
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
  });
  const parsed = parseMJCFModel(generated);
  const baseLinkBody = findBodyByName(parsed.worldBody as any, 'base_link');
  const visualGeom = baseLinkBody?.geoms?.[0];
  const visualMaterial = parsed.materialMap.get('base_link_mat');

  assert.ok(visualGeom);
  assert.equal(visualGeom.material, 'base_link_mat');
  assert.doesNotMatch(generated, /<default>\s*<geom\s+rgba=/s);
  assert.ok(visualMaterial);
  assert.deepEqual(
    visualMaterial?.rgba?.map((value) => Number(value.toFixed(4))),
    [0.0706, 0.2039, 0.3373, 1],
  );
});

test('generated MJCF exports texture assets and binds them through material definitions', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'texture-export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#262626',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {
      base_link: {
        color: '#123456',
        texture: 'textures/coat.png',
      },
    },
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
  });
  const parsed = parseMJCFModel(generated);
  const baseLinkBody = findBodyByName(parsed.worldBody as any, 'base_link');
  const visualGeom = baseLinkBody?.geoms?.[0];
  const visualMaterial = parsed.materialMap.get('base_link_mat');
  const visualTexture = parsed.textureMap.get('base_link_tex');

  assert.ok(visualGeom);
  assert.equal(parsed.compilerSettings.texturedir, 'textures/');
  assert.equal(visualGeom.material, 'base_link_mat');
  assert.equal(visualMaterial?.texture, 'base_link_tex');
  assert.equal(visualTexture?.file, 'textures/coat.png');
  assert.match(generated, /<texture name="base_link_tex" type="2d" file="coat\.png" \/>/);
});

test('generated MJCF uses a neutral white rgba for texture-only materials', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'texture-only-export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#3b82f6',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {
      base_link: {
        texture: 'textures/coat.png',
      },
    },
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
  });

  assert.match(
    generated,
    /<material name="base_link_mat" rgba="1 1 1 1" texture="base_link_tex" specular="0" \/>/,
  );
  assert.doesNotMatch(
    generated,
    /<material name="base_link_mat" rgba="0\.2314 0\.5098 0\.9647 1" texture="base_link_tex" specular="0" \/>/,
  );
});

test('generated MJCF scopes texture-backed materials per visual object', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'per-visual-texture-export',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#123456',
          authoredMaterials: [{ texture: 'textures/primary.png' }],
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        visualBodies: [
          {
            type: GeometryType.BOX,
            dimensions: { x: 0.5, y: 0.5, z: 0.5 },
            color: '#abcdef',
            authoredMaterials: [{ texture: 'textures/secondary.png' }],
            origin: { xyz: { x: 1, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          },
        ],
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {
      base_link: {
        texture: 'textures/legacy.png',
      },
    },
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
  });
  const parsed = parseMJCFModel(generated);
  const baseLinkBody = findBodyByName(parsed.worldBody as any, 'base_link');
  const primaryGeom = baseLinkBody?.geoms?.[0];
  const secondaryGeom = baseLinkBody?.geoms?.[1];

  assert.ok(primaryGeom);
  assert.ok(secondaryGeom);
  assert.equal(primaryGeom.material, 'base_link_mat');
  assert.equal(secondaryGeom.material, 'base_link_mat_2');
  assert.equal(parsed.materialMap.get('base_link_mat')?.texture, 'base_link_tex');
  assert.equal(parsed.materialMap.get('base_link_mat_2')?.texture, 'base_link_tex_2');
  assert.equal(parsed.textureMap.get('base_link_tex')?.file, 'textures/primary.png');
  assert.equal(parsed.textureMap.get('base_link_tex_2')?.file, 'textures/secondary.png');
  assert.doesNotMatch(generated, /legacy\.png/);
});

test('generated MJCF honors mesh export path overrides for converted assets', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'mesh-override',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#808080',
          meshPath: 'package://go2_description/dae/hip.dae',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
    meshPathOverrides: new Map([['package://go2_description/dae/hip.dae', 'dae/hip.dae.obj']]),
  });

  assert.match(generated, /<mesh name="dae_hip_dae" file="dae\/hip\.dae\.obj"/);
  assert.doesNotMatch(generated, /file="dae\/hip\.dae"/);
});

test('generated MJCF emits separate visual geoms for extracted mesh material variants', () => {
  installDomParser();

  const robot: RobotState = {
    name: 'mesh-visual-variants',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#808080',
          meshPath: 'package://go2_description/dae/base.dae',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot, {
    includeSceneHelpers: false,
    meshdir: 'meshes/',
    meshPathOverrides: new Map([['package://go2_description/dae/base.dae', 'dae/base.dae.obj']]),
    visualMeshVariants: new Map([
      [
        'package://go2_description/dae/base.dae',
        [
          { meshPath: 'dae/base.dae.black.obj', color: '#000000' },
          { meshPath: 'dae/base.dae.white.obj', color: '#ffffff' },
          { meshPath: 'dae/base.dae.gray.obj', color: '#abb1c5' },
        ],
      ],
    ]),
  });

  const parsed = parseMJCFModel(generated);
  const baseLinkBody = findBodyByName(parsed.worldBody as any, 'base_link');
  const visualGeoms = (baseLinkBody?.geoms || []).filter((geom: any) => geom.group === 1);

  assert.equal(visualGeoms.length, 3);
  assert.deepEqual(
    visualGeoms.map((geom: any) => geom.material),
    ['base_link_mat_1', 'base_link_mat_2', 'base_link_mat_3'],
  );
  assert.deepEqual(
    parsed.materialMap.get('base_link_mat_1')?.rgba?.map((value) => Number(value.toFixed(4))),
    [0, 0, 0, 1],
  );
  assert.equal(parsed.materialMap.get('base_link_mat_1')?.specular, 0);
  assert.deepEqual(
    parsed.materialMap.get('base_link_mat_2')?.rgba?.map((value) => Number(value.toFixed(4))),
    [1, 1, 1, 1],
  );
  assert.equal(parsed.materialMap.get('base_link_mat_2')?.specular, 0);
  assert.match(generated, /<mesh name="dae_base_dae_black" file="dae\/base\.dae\.black\.obj" \/>/);
  assert.match(generated, /<mesh name="dae_base_dae_white" file="dae\/base\.dae\.white\.obj" \/>/);
  assert.match(generated, /<mesh name="dae_base_dae_gray" file="dae\/base\.dae\.gray\.obj" \/>/);
});

test('generated MJCF preserves collision colors and alpha through parser roundtrip', async () => {
  installDomParser();

  const { parseMJCF } = await import('./mjcfParser.ts');

  const robot: RobotState = {
    name: 'collision-color-roundtrip',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#262626',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 2, z: 3 },
          color: '#12345680',
          origin: { xyz: { x: 0.4, y: 0.5, z: 0.6 }, rpy: { r: 0.1, p: 0.2, y: 0.3 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    materials: {},
  };

  const generated = generateMujocoXML(robot, { includeSceneHelpers: false });
  assert.match(generated, /rgba="0\.0706 0\.2039 0\.3373 0\.502"/);

  const parsed = parseMJCF(generated);
  assert.ok(parsed);
  assert.equal(parsed.links.base_link.collision.color, '#12345680');
});
