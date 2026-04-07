import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { JSDOM } from 'jsdom';

import { URDFLink, URDFVisual } from '@/core/parsers/urdf/loader/URDFClasses';
import { createMatteMaterial } from '@/core/utils/materialFactory';
import { DEFAULT_LINK, GeometryType } from '@/types';

import {
  COLLISION_OVERLAY_RENDER_ORDER,
  COLLISION_STANDARD_RENDER_ORDER,
  MATERIAL_CONFIG,
  collisionBaseMaterial,
} from './materials';
import { parseURDFMaterials } from './urdfMaterials';
import { syncLoadedRobotScene } from './loadedRobotSceneSync';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;

function toLinearTuple(r: number, g: number, b: number): number[] {
  return new THREE.Color()
    .setRGB(r, g, b, THREE.SRGBColorSpace)
    .toArray()
    .map((value) => Number(value.toFixed(4)));
}

test('syncLoadedRobotScene upgrades late URDF visual meshes to shared matte materials', () => {
  const urdfMaterials = parseURDFMaterials(`<?xml version="1.0"?>
<robot name="demo">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="package://demo/meshes/base.dae" />
      </geometry>
      <material name="Material">
        <color rgba="0.9 0.95 0.95 1" />
      </material>
      <material name="dark-rubber">
        <color rgba="0.05 0.05 0.05 1" />
      </material>
    </visual>
  </link>
</robot>`);

  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const visual = new URDFVisual();
  visual.name = 'base_visual';

  const colladaScene = new THREE.Group();
  colladaScene.name = 'Scene';

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), [
    new THREE.MeshLambertMaterial({ name: 'Material', color: new THREE.Color(1, 1, 1) }),
    new THREE.MeshLambertMaterial({ name: 'dark-rubber', color: new THREE.Color(0, 0, 0) }),
  ]);

  colladaScene.add(mesh);
  visual.add(colladaScene);
  link.add(visual);
  robot.add(link);
  (robot as any).links = { base_link: link };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'urdf',
    showCollision: false,
    showVisual: true,
    urdfMaterials,
  });

  if (!Array.isArray(mesh.material)) {
    assert.fail('expected upgraded URDF visual mesh to keep array material slots');
  }

  const nextMaterials = mesh.material;
  const [primaryMaterial, secondaryMaterial] = nextMaterials;
  assert.equal(result.changed, true);
  assert.equal(result.linkMeshMap.get('base_link:visual')?.includes(mesh), true);
  assert.equal(primaryMaterial instanceof THREE.MeshStandardMaterial, true);
  assert.equal(secondaryMaterial instanceof THREE.MeshStandardMaterial, true);
  if (
    !(primaryMaterial instanceof THREE.MeshStandardMaterial) ||
    !(secondaryMaterial instanceof THREE.MeshStandardMaterial)
  ) {
    assert.fail('expected URDF visual materials to upgrade to MeshStandardMaterial');
  }
  assert.equal(mesh.userData.parentLinkName, 'base_link');
  assert.equal(mesh.userData.isVisualMesh, true);
  assert.equal(mesh.userData.isCollisionMesh, false);
  assert.deepEqual(
    primaryMaterial.color.toArray().map((value) => Number(value.toFixed(4))),
    toLinearTuple(0.9, 0.95, 0.95),
  );
  assert.deepEqual(
    secondaryMaterial.color.toArray().map((value) => Number(value.toFixed(4))),
    toLinearTuple(0.05, 0.05, 0.05),
  );
  assert.equal(primaryMaterial.roughness, MATERIAL_CONFIG.roughness);
  assert.equal(primaryMaterial.metalness, MATERIAL_CONFIG.metalness);
  assert.equal(primaryMaterial.envMapIntensity, MATERIAL_CONFIG.envMapIntensity);
  assert.equal(primaryMaterial.toneMapped, false);
  assert.equal(secondaryMaterial.toneMapped, false);
});

test('syncLoadedRobotScene indexes visual meshes attached directly to a root link object', () => {
  const robot = new URDFLink();
  robot.name = 'base_link';

  const visual = new URDFVisual();
  visual.name = 'base_visual';

  const rootMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ name: 'root_visual', color: new THREE.Color('#7f7f7f') }),
  );

  visual.add(rootMesh);
  robot.add(visual);
  (robot as any).links = { base_link: robot };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'urdf',
    showCollision: false,
    showVisual: true,
    urdfMaterials: null,
  });

  assert.equal(result.linkMeshMap.get('base_link:visual')?.includes(rootMesh), true);
  assert.equal(rootMesh.userData.parentLinkName, 'base_link');
  assert.equal(rootMesh.userData.isVisualMesh, true);
  assert.equal(rootMesh.userData.isCollisionMesh, false);
});

test('syncLoadedRobotScene restores visual mesh shadow flags even when the material is already normalized', () => {
  const robot = new URDFLink();
  robot.name = 'base_link';

  const visual = new URDFVisual();
  visual.name = 'base_visual';

  const normalizedMaterial = createMatteMaterial({
    color: new THREE.Color('#7f7f7f'),
    name: 'root_visual',
  });
  const rootMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), normalizedMaterial);
  rootMesh.castShadow = false;
  rootMesh.receiveShadow = false;

  visual.add(rootMesh);
  robot.add(visual);
  (robot as any).links = { base_link: robot };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'urdf',
    showCollision: false,
    showVisual: true,
    urdfMaterials: null,
  });

  assert.equal(result.changed, true);
  assert.equal(rootMesh.material, normalizedMaterial);
  assert.equal(rootMesh.castShadow, true);
  assert.equal(rootMesh.receiveShadow, true);
  assert.equal(result.linkMeshMap.get('base_link:visual')?.includes(rootMesh), true);
});

test('syncLoadedRobotScene upgrades MJCF visual meshes to the shared matte viewer materials', () => {
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const visual = new URDFVisual();
  visual.name = 'base_visual';

  const mjcfMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ name: 'mjcf_body', color: new THREE.Color('#7f7f7f') }),
  );

  visual.add(mjcfMesh);
  link.add(visual);
  robot.add(link);
  (robot as any).links = { base_link: link };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'mjcf',
    showCollision: false,
    showVisual: true,
    urdfMaterials: null,
  });
  const expectedMaterial = createMatteMaterial({
    color: new THREE.Color('#7f7f7f'),
    name: 'mjcf_body',
  });

  assert.equal(result.linkMeshMap.get('base_link:visual')?.includes(mjcfMesh), true);
  assert.equal(mjcfMesh.material instanceof THREE.MeshStandardMaterial, true);
  if (!(mjcfMesh.material instanceof THREE.MeshStandardMaterial)) {
    assert.fail('expected MJCF visual material to upgrade to MeshStandardMaterial');
  }

  assert.equal(result.changed, true);
  assert.equal(mjcfMesh.userData.parentLinkName, 'base_link');
  assert.equal(mjcfMesh.userData.isVisualMesh, true);
  assert.equal(mjcfMesh.userData.isCollisionMesh, false);
  assert.equal(mjcfMesh.material.roughness, expectedMaterial.roughness);
  assert.equal(mjcfMesh.material.metalness, expectedMaterial.metalness);
  assert.equal(mjcfMesh.material.envMapIntensity, expectedMaterial.envMapIntensity);
});

test('syncLoadedRobotScene hides MJCF world runtime geometry when the world toggle is disabled', () => {
  const robot = new THREE.Group();
  const worldLink = new URDFLink();
  worldLink.name = 'world';

  const visual = new URDFVisual();
  visual.name = 'world_visual';
  const worldMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ name: 'world_ground', color: new THREE.Color('#7f7f7f') }),
  );
  visual.add(worldMesh);

  const collisionGroup = new THREE.Group();
  collisionGroup.name = 'world_collision';
  (collisionGroup as any).isURDFCollider = true;
  const collisionMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  collisionGroup.add(collisionMesh);

  worldLink.add(visual);
  worldLink.add(collisionGroup);
  robot.add(worldLink);
  (robot as any).links = { world: worldLink };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'mjcf',
    showCollision: true,
    showVisual: true,
    showMjcfWorldLink: false,
    urdfMaterials: null,
  });

  assert.equal(result.changed, true);
  assert.equal(worldMesh.visible, false);
  assert.equal(collisionGroup.visible, false);
  assert.equal(result.linkMeshMap.get('world:visual')?.includes(worldMesh), true);
});

test('syncLoadedRobotScene maps folded MJCF visual meshes onto semantic synthetic link ids', () => {
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const mainVisual = new URDFVisual();
  mainVisual.name = 'base_visual';
  const mainMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ name: 'base_main', color: new THREE.Color('#7f7f7f') }),
  );
  mainVisual.add(mainMesh);
  link.add(mainVisual);

  const foldedAttachmentVisual = new URDFVisual();
  foldedAttachmentVisual.name = 'base_attachment_visual';
  const attachmentMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ name: 'base_attachment', color: new THREE.Color('#999999') }),
  );
  foldedAttachmentVisual.add(attachmentMesh);
  link.add(foldedAttachmentVisual);

  robot.add(link);
  (robot as any).links = { base_link: link };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'mjcf',
    showCollision: false,
    showVisual: true,
    urdfMaterials: null,
    robotLinks: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
        },
      },
      base_link_geom_1: {
        ...DEFAULT_LINK,
        id: 'base_link_geom_1',
        name: 'base_link_geom_1',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
        },
      },
    },
  });

  assert.equal(result.linkMeshMap.get('base_link:visual')?.includes(mainMesh), true);
  assert.equal(result.linkMeshMap.get('base_link_geom_1:visual')?.includes(attachmentMesh), true);
  assert.equal(mainMesh.userData.parentLinkName, 'base_link');
  assert.equal(attachmentMesh.userData.parentLinkName, 'base_link_geom_1');
  assert.equal(attachmentMesh.userData.runtimeParentLinkName, 'base_link');
});

test('syncLoadedRobotScene keeps MJCF visual and collision ownership on the same semantic link id when assembly prefixes diverge from runtime names', () => {
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'left_hand_base_link';

  const visual = new URDFVisual();
  visual.name = 'base_visual';
  const visualMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ name: 'base_visual', color: new THREE.Color('#7f7f7f') }),
  );
  visual.add(visualMesh);
  link.add(visual);

  const collisionGroup = new THREE.Group();
  collisionGroup.name = 'base_collision';
  (collisionGroup as any).isURDFCollider = true;
  const collisionMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  collisionGroup.add(collisionMesh);
  link.add(collisionGroup);

  robot.add(link);
  (robot as any).links = { left_hand_base_link: link };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'mjcf',
    showCollision: true,
    showVisual: true,
    urdfMaterials: null,
    robotLinks: {
      comp_left_hand_base_link: {
        ...DEFAULT_LINK,
        id: 'comp_left_hand_base_link',
        name: 'left_hand_base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.SPHERE,
        },
      },
    },
  });

  assert.equal(
    result.linkMeshMap.get('comp_left_hand_base_link:visual')?.includes(visualMesh),
    true,
  );
  assert.equal(
    result.linkMeshMap.get('comp_left_hand_base_link:collision')?.includes(collisionMesh),
    true,
  );
  assert.equal(visualMesh.userData.parentLinkName, 'comp_left_hand_base_link');
  assert.equal(visualMesh.userData.runtimeParentLinkName, 'left_hand_base_link');
  assert.equal(collisionGroup.userData.parentLinkName, 'comp_left_hand_base_link');
  assert.equal(collisionGroup.userData.runtimeParentLinkName, 'left_hand_base_link');
  assert.equal(collisionMesh.userData.parentLinkName, 'comp_left_hand_base_link');
  assert.equal(collisionMesh.userData.runtimeParentLinkName, 'left_hand_base_link');
});

test('syncLoadedRobotScene keeps all meshes inside one folded MJCF visual body on the same semantic link id', () => {
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const mainVisual = new URDFVisual();
  mainVisual.name = 'base_visual';
  mainVisual.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshPhongMaterial({ name: 'base_main', color: new THREE.Color('#7f7f7f') }),
    ),
  );
  link.add(mainVisual);

  const foldedAttachmentVisual = new URDFVisual();
  foldedAttachmentVisual.name = 'base_attachment_visual';
  const attachmentMeshA = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ name: 'base_attachment_a', color: new THREE.Color('#999999') }),
  );
  const attachmentMeshB = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ name: 'base_attachment_b', color: new THREE.Color('#aaaaaa') }),
  );
  foldedAttachmentVisual.add(attachmentMeshA, attachmentMeshB);
  link.add(foldedAttachmentVisual);

  robot.add(link);
  (robot as any).links = { base_link: link };

  syncLoadedRobotScene({
    robot,
    sourceFormat: 'mjcf',
    showCollision: false,
    showVisual: true,
    urdfMaterials: null,
    robotLinks: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
        },
      },
      base_link_geom_1: {
        ...DEFAULT_LINK,
        id: 'base_link_geom_1',
        name: 'base_link_geom_1',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
        },
      },
    },
  });

  assert.equal(attachmentMeshA.userData.parentLinkName, 'base_link_geom_1');
  assert.equal(attachmentMeshB.userData.parentLinkName, 'base_link_geom_1');
});

test('syncLoadedRobotScene re-normalizes already-standard URDF visual materials that drifted away from viewer shading defaults', () => {
  const urdfMaterials = parseURDFMaterials(`<?xml version="1.0"?>
<robot name="demo">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="package://demo/meshes/base.dae" />
      </geometry>
      <material name="Material">
        <color rgba="0.85 0.2 0.1 1" />
      </material>
    </visual>
  </link>
</robot>`);

  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const visual = new URDFVisual();
  visual.name = 'base_visual';

  const standardMaterial = new THREE.MeshStandardMaterial({
    name: 'Material',
    color: new THREE.Color('#ffffff'),
    roughness: 0,
    metalness: 1,
    emissive: new THREE.Color('#ff8800'),
    emissiveIntensity: 1,
  });

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), standardMaterial);
  visual.add(mesh);
  link.add(visual);
  robot.add(link);
  (robot as any).links = { base_link: link };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'urdf',
    showCollision: false,
    showVisual: true,
    urdfMaterials,
  });

  assert.equal(result.changed, true);
  assert.equal(mesh.material instanceof THREE.MeshStandardMaterial, true);
  if (!(mesh.material instanceof THREE.MeshStandardMaterial)) {
    assert.fail('expected URDF visual material to stay MeshStandardMaterial after normalization');
  }

  assert.deepEqual(
    mesh.material.color.toArray().map((value) => Number(value.toFixed(4))),
    toLinearTuple(0.85, 0.2, 0.1),
  );
  assert.equal(mesh.material.roughness, MATERIAL_CONFIG.roughness);
  assert.equal(mesh.material.metalness, MATERIAL_CONFIG.metalness);
  assert.equal(mesh.material.emissive.getHex(), 0x000000);
  assert.equal(mesh.material.toneMapped, false);
});

test('syncLoadedRobotScene re-normalizes already-standard MJCF visual materials to the shared matte viewer shading', () => {
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const visual = new URDFVisual();
  visual.name = 'base_visual';

  const texture = new THREE.Texture();
  const driftedMaterial = createMatteMaterial({
    color: new THREE.Color('#7f7f7f'),
    map: texture,
    name: 'mjcf_body',
    preserveExactColor: true,
  });
  driftedMaterial.roughness = 0;
  driftedMaterial.metalness = 1;
  driftedMaterial.emissive = new THREE.Color('#ffaa33');
  driftedMaterial.emissiveIntensity = 1;
  driftedMaterial.roughnessMap = new THREE.Texture();

  const mjcfMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), driftedMaterial);

  visual.add(mjcfMesh);
  link.add(visual);
  robot.add(link);
  (robot as any).links = { base_link: link };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'mjcf',
    showCollision: false,
    showVisual: true,
    urdfMaterials: null,
  });
  const expectedMaterial = createMatteMaterial({
    color: new THREE.Color('#7f7f7f'),
    map: texture,
    name: 'mjcf_body',
    preserveExactColor: true,
  });

  assert.equal(result.changed, true);
  assert.equal(mjcfMesh.material instanceof THREE.MeshStandardMaterial, true);
  if (!(mjcfMesh.material instanceof THREE.MeshStandardMaterial)) {
    assert.fail('expected MJCF visual material to stay MeshStandardMaterial after normalization');
  }

  assert.equal(mjcfMesh.material.roughness, expectedMaterial.roughness);
  assert.equal(mjcfMesh.material.metalness, expectedMaterial.metalness);
  assert.equal(mjcfMesh.material.envMapIntensity, expectedMaterial.envMapIntensity);
  assert.equal(mjcfMesh.material.emissive.getHex(), 0x000000);
  assert.equal(mjcfMesh.material.roughnessMap, null);
  assert.equal(mjcfMesh.material.map, texture);
  assert.equal(mjcfMesh.material.toneMapped, false);
});

test('syncLoadedRobotScene keeps collision meshes as always-on-top overlays', () => {
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const collisionGroup = new THREE.Group();
  collisionGroup.name = 'base_collision';
  (collisionGroup as any).isURDFCollider = true;

  const collisionMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );

  collisionGroup.add(collisionMesh);
  link.add(collisionGroup);
  robot.add(link);
  (robot as any).links = { base_link: link };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'mjcf',
    showCollision: true,
    showVisual: true,
    urdfMaterials: null,
  });

  assert.equal(result.changed, true);
  assert.equal(result.linkMeshMap.get('base_link:collision')?.includes(collisionMesh), true);
  assert.equal(collisionMesh.material, collisionBaseMaterial);
  assert.equal(collisionMesh.userData.parentLinkName, 'base_link');
  assert.equal(collisionMesh.userData.isCollisionMesh, true);
  assert.equal(collisionMesh.userData.isVisualMesh, false);
  assert.equal(collisionMesh.visible, true);
  assert.equal(collisionMesh.renderOrder, COLLISION_OVERLAY_RENDER_ORDER);
  assert.equal(collisionBaseMaterial.depthTest, false);
  assert.equal(collisionBaseMaterial.depthWrite, false);
});

test('syncLoadedRobotScene can keep collision meshes in normal depth-tested order', () => {
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const collisionGroup = new THREE.Group();
  collisionGroup.name = 'base_collision';
  (collisionGroup as any).isURDFCollider = true;

  const collisionMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );

  collisionGroup.add(collisionMesh);
  link.add(collisionGroup);
  robot.add(link);
  (robot as any).links = { base_link: link };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'mjcf',
    showCollision: true,
    showVisual: true,
    showCollisionAlwaysOnTop: false,
    urdfMaterials: null,
  });

  assert.equal(result.changed, true);
  assert.equal(collisionMesh.material, collisionBaseMaterial);
  assert.equal(collisionMesh.renderOrder, COLLISION_STANDARD_RENDER_ORDER);
  assert.equal(collisionBaseMaterial.depthTest, true);
  assert.equal(collisionBaseMaterial.depthWrite, false);

  syncLoadedRobotScene({
    robot,
    sourceFormat: 'mjcf',
    showCollision: true,
    showVisual: true,
    showCollisionAlwaysOnTop: true,
    urdfMaterials: null,
  });

  assert.equal(collisionMesh.renderOrder, COLLISION_OVERLAY_RENDER_ORDER);
  assert.equal(collisionBaseMaterial.depthTest, false);
});

test('syncLoadedRobotScene traverses each collider subtree only once', () => {
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const collisionGroup = new THREE.Group();
  collisionGroup.name = 'base_collision';
  (collisionGroup as any).isURDFCollider = true;

  const nestedGroup = new THREE.Group();
  const collisionMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.1),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  nestedGroup.add(collisionMesh);
  collisionGroup.add(nestedGroup);
  link.add(collisionGroup);
  robot.add(link);
  (robot as any).links = { base_link: link };

  const originalTraverse = collisionGroup.traverse.bind(collisionGroup);
  let traverseCalls = 0;
  collisionGroup.traverse = ((callback: (object: THREE.Object3D) => void) => {
    traverseCalls += 1;
    return originalTraverse(callback);
  }) as typeof collisionGroup.traverse;

  syncLoadedRobotScene({
    robot,
    sourceFormat: 'mjcf',
    showCollision: true,
    showVisual: true,
    urdfMaterials: null,
  });

  assert.equal(traverseCalls, 0);
  assert.equal(collisionMesh.userData.parentLinkName, 'base_link');
});

test('syncLoadedRobotScene skips hidden collider subtree processing when collisions are disabled', () => {
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const collisionGroup = new THREE.Group();
  collisionGroup.name = 'base_collision';
  (collisionGroup as any).isURDFCollider = true;

  const collisionMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const collisionMesh = new THREE.Mesh(new THREE.SphereGeometry(0.1), collisionMaterial);
  collisionGroup.add(collisionMesh);
  link.add(collisionGroup);
  robot.add(link);
  (robot as any).links = { base_link: link };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'mjcf',
    showCollision: false,
    showVisual: true,
    urdfMaterials: null,
  });

  assert.equal(result.linkMeshMap.has('base_link:collision'), false);
  assert.equal(collisionGroup.visible, false);
  assert.equal(collisionGroup.userData.parentLinkName, 'base_link');
  assert.equal(collisionMesh.userData.isCollisionMesh, undefined);
  assert.equal(collisionMesh.userData.parentLinkName, undefined);
  assert.equal(collisionMesh.material, collisionMaterial);
});

test('syncLoadedRobotScene disposes replaced collision materials when normalizing collision meshes', () => {
  const robot = new THREE.Group();
  const link = new URDFLink();
  link.name = 'base_link';

  const collider = new THREE.Group();
  (collider as any).isURDFCollider = true;

  let materialDisposeCalls = 0;
  let textureDisposeCalls = 0;

  const previousTexture = new THREE.Texture();
  previousTexture.dispose = () => {
    textureDisposeCalls += 1;
  };

  const previousMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, map: previousTexture });
  previousMaterial.dispose = () => {
    materialDisposeCalls += 1;
  };

  const collisionMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), previousMaterial);

  collider.add(collisionMesh);
  link.add(collider);
  robot.add(link);
  (robot as any).links = { base_link: link };

  const result = syncLoadedRobotScene({
    robot,
    sourceFormat: 'urdf',
    showCollision: true,
    showVisual: true,
    urdfMaterials: null,
  });

  assert.equal(result.changed, true);
  assert.equal(collisionMesh.material, collisionBaseMaterial);
  assert.equal(materialDisposeCalls, 1);
  assert.equal(textureDisposeCalls, 1);
});
