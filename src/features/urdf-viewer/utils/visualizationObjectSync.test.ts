import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createThreeColorFromSRGB } from '@/core/utils/color.ts';
import { DEFAULT_LINK, GeometryType } from '@/types';
import {
  syncInertiaVisualizationForLinks,
  syncIkHandleVisualizationForLinks,
  syncJointHelperInteractionStateForJoints,
  syncJointAxesVisualizationForJoints,
  syncLinkHelperInteractionStateForLinks,
  syncMjcfSiteVisualizationForLinks,
  syncMjcfTendonVisualizationForRobot,
  syncOriginAxesVisualizationForLinks,
} from './visualizationObjectSync.ts';

test('syncOriginAxesVisualizationForLinks is a no-op on the second identical pass', () => {
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'base_link';

  const firstChanged = syncOriginAxesVisualizationForLinks({
    links: [link],
    showOrigins: true,
    showOriginsOverlay: false,
    originSize: 0.2,
  });
  const secondChanged = syncOriginAxesVisualizationForLinks({
    links: [link],
    showOrigins: true,
    showOriginsOverlay: false,
    originSize: 0.2,
  });

  assert.equal(firstChanged, true);
  assert.equal(secondChanged, false);
  assert.equal(link.userData.__originAxes.visible, true);
});

test('syncJointAxesVisualizationForJoints is a no-op on the second identical pass', () => {
  const joint = new THREE.Group() as THREE.Group & {
    isURDFJoint?: boolean;
    jointType?: string;
    axis?: THREE.Vector3;
  };
  joint.isURDFJoint = true;
  joint.jointType = 'revolute';
  joint.axis = new THREE.Vector3(0, 0, 1);

  const firstChanged = syncJointAxesVisualizationForJoints({
    joints: [joint],
    showJointAxes: true,
    showJointAxesOverlay: true,
    jointAxisSize: 0.5,
  });
  const secondChanged = syncJointAxesVisualizationForJoints({
    joints: [joint],
    showJointAxes: true,
    showJointAxesOverlay: true,
    jointAxisSize: 0.5,
  });

  assert.equal(firstChanged, true);
  assert.equal(secondChanged, false);
  assert.equal(joint.userData.__jointAxisViz.visible, true);
});

test('syncInertiaVisualizationForLinks is a no-op on the second identical pass', () => {
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'base_link';
  link.userData.__cachedMaxLinkSize = 1;
  link.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));

  const robotLinks = {
    base_link: {
      inertial: {
        mass: 1,
        inertia: {
          ixx: 1,
          ixy: 0,
          ixz: 0,
          iyy: 1,
          iyz: 0,
          izz: 1,
        },
        origin: {
          xyz: { x: 0, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
      },
    },
  } as any;

  const firstChanged = syncInertiaVisualizationForLinks({
    links: [link],
    robotLinks,
    showInertia: true,
    showInertiaOverlay: true,
    showCenterOfMass: true,
    showCoMOverlay: true,
    centerOfMassSize: 0.01,
  });
  const secondChanged = syncInertiaVisualizationForLinks({
    links: [link],
    robotLinks,
    showInertia: true,
    showInertiaOverlay: true,
    showCenterOfMass: true,
    showCoMOverlay: true,
    centerOfMassSize: 0.01,
  });

  assert.equal(firstChanged, true);
  assert.equal(secondChanged, false);
  assert.equal(link.userData.__inertiaVisualGroup.visible, true);
});

test('syncIkHandleVisualizationForLinks toggles IK handle top-most rendering and keeps the darker base green', () => {
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'base_link';

  const robotLinks = {
    base_link: {
      ...DEFAULT_LINK,
      id: 'base_link',
      name: 'base_link',
      visual: {
        ...DEFAULT_LINK.visual,
        type: GeometryType.BOX,
        dimensions: { x: 0.4, y: 0.2, z: 0.2 },
        origin: {
          xyz: { x: 0.2, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
      },
      visualBodies: [],
      collision: {
        ...DEFAULT_LINK.collision,
        type: GeometryType.NONE,
        dimensions: { x: 0, y: 0, z: 0 },
        origin: {
          xyz: { x: 0, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
      },
      collisionBodies: [],
    },
  } as any;
  const robotJoints = {};

  const firstChanged = syncIkHandleVisualizationForLinks({
    links: [link],
    robotLinks,
    robotJoints,
    showIkHandles: true,
    showIkHandlesAlwaysOnTop: false,
  });

  assert.equal(firstChanged, true);
  const ikHandle = link.userData.__ikHandle as THREE.Group | undefined;
  assert.ok(ikHandle, 'ik handle should be created');
  const ikMesh = ikHandle.children[0] as THREE.Mesh;
  const ikMaterial = ikMesh.material as THREE.MeshBasicMaterial;

  assert.equal(ikMaterial.color.getHex(), 0x16a34a);
  assert.equal(ikMaterial.depthTest, true);
  assert.equal(ikMesh.renderOrder, 0);

  const secondChanged = syncIkHandleVisualizationForLinks({
    links: [link],
    robotLinks,
    robotJoints,
    showIkHandles: true,
    showIkHandlesAlwaysOnTop: true,
  });

  assert.equal(secondChanged, true);
  assert.equal(ikMaterial.depthTest, false);
  assert.equal(ikMesh.renderOrder, 10030);
});

test('syncMjcfSiteVisualizationForLinks creates MJCF site helpers lazily and hides them when disabled', () => {
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'base_link';
  link.userData.__mjcfSitesData = [
    {
      name: 'tool_center',
      type: 'sphere',
      size: [0.02],
      pos: [0, 0, 0.1],
      rgba: [1, 0.4, 0, 1],
    },
  ];

  const firstChanged = syncMjcfSiteVisualizationForLinks({
    links: [link],
    sourceFormat: 'mjcf',
    showMjcfSites: true,
    showMjcfWorldLink: true,
  });
  const secondChanged = syncMjcfSiteVisualizationForLinks({
    links: [link],
    sourceFormat: 'mjcf',
    showMjcfSites: true,
    showMjcfWorldLink: true,
  });

  assert.equal(firstChanged, true);
  assert.equal(secondChanged, false);
  assert.equal(link.userData.__mjcfSites.visible, true);

  const hiddenChanged = syncMjcfSiteVisualizationForLinks({
    links: [link],
    sourceFormat: 'mjcf',
    showMjcfSites: false,
    showMjcfWorldLink: true,
  });

  assert.equal(hiddenChanged, true);
  assert.equal(link.userData.__mjcfSites.visible, false);
});

test('syncMjcfSiteVisualizationForLinks respects the MJCF world visibility toggle', () => {
  const worldLink = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  worldLink.isURDFLink = true;
  worldLink.name = 'world';
  worldLink.userData.__mjcfSitesData = [
    {
      name: 'ground_marker',
      type: 'box',
      size: [0.1, 0.1, 0.001],
      pos: [0, 0, 0],
    },
  ];

  syncMjcfSiteVisualizationForLinks({
    links: [worldLink],
    sourceFormat: 'mjcf',
    showMjcfSites: true,
    showMjcfWorldLink: false,
  });

  assert.equal(worldLink.userData.__mjcfSites.visible, false);

  const changed = syncMjcfSiteVisualizationForLinks({
    links: [worldLink],
    sourceFormat: 'mjcf',
    showMjcfSites: true,
    showMjcfWorldLink: true,
  });

  assert.equal(changed, true);
  assert.equal(worldLink.userData.__mjcfSites.visible, true);
});

test('syncMjcfTendonVisualizationForRobot creates hover-pickable tendon meshes with endpoint anchors', () => {
  const robot = new THREE.Group();
  robot.userData.__mjcfTendonsData = [
    {
      name: 'ankle_bar',
      rgba: [1, 0, 0, 1],
      attachmentRefs: ['site_a', 'site_b'],
    },
  ];

  const linkA = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  linkA.isURDFLink = true;
  linkA.name = 'link_a';
  linkA.userData.__mjcfSitesData = [{ name: 'site_a', pos: [1, 2, 3], size: [0.005] }];
  robot.add(linkA);

  const linkB = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  linkB.isURDFLink = true;
  linkB.name = 'link_b';
  linkB.userData.__mjcfSitesData = [{ name: 'site_b', pos: [4, 5, 6], size: [0.005] }];
  robot.add(linkB);
  robot.updateMatrixWorld(true);

  const firstChanged = syncMjcfTendonVisualizationForRobot({
    robot,
    sourceFormat: 'mjcf',
    showMjcfTendons: true,
  });
  const secondChanged = syncMjcfTendonVisualizationForRobot({
    robot,
    sourceFormat: 'mjcf',
    showMjcfTendons: true,
  });

  assert.equal(firstChanged, true);
  assert.equal(secondChanged, false);
  assert.equal(robot.userData.__mjcfTendons.visible, true);

  const tendonObject = robot.userData.__mjcfTendons.children[0] as THREE.Group;
  assert.equal(tendonObject.userData.isVisual, true);
  assert.equal(tendonObject.userData.geometryRole, 'visual');
  const segment = tendonObject.getObjectByName('__mjcf_tendon_segment__:0') as
    | THREE.Group
    | undefined;
  assert.ok(segment);
  assert.deepEqual(segment.position.toArray(), [2.5, 3.5, 4.5]);
  assert.equal(segment.userData.isVisual, true);
  assert.equal(segment.userData.geometryRole, 'visual');

  const shaft = segment.getObjectByName('__mjcf_tendon_shaft__') as THREE.Mesh | undefined;
  assert.ok(shaft);
  assert.equal(shaft.material instanceof THREE.MeshStandardMaterial, true);
  assert.equal((shaft.material as THREE.MeshStandardMaterial).depthTest, true);
  assert.equal((shaft.material as THREE.MeshStandardMaterial).depthWrite, true);
  assert.equal(typeof shaft.raycast, 'function');
  assert.deepEqual(shaft.scale.toArray(), [0.0025, Math.sqrt(27), 0.0025]);
  assert.equal(shaft.userData.parentLinkName, 'link_a');
  assert.equal(shaft.userData.isVisual, true);
  assert.equal(shaft.userData.isVisualMesh, true);
  assert.equal(shaft.userData.isCollision, false);
  assert.equal(shaft.userData.isCollisionMesh, false);
  assert.equal(shaft.userData.geometryRole, 'visual');

  const anchorA = tendonObject.getObjectByName('__mjcf_tendon_anchor__:0') as
    | THREE.Mesh
    | undefined;
  const anchorB = tendonObject.getObjectByName('__mjcf_tendon_anchor__:1') as
    | THREE.Mesh
    | undefined;
  assert.ok(anchorA);
  assert.ok(anchorB);
  assert.deepEqual(anchorA.position.toArray(), [1, 2, 3]);
  assert.deepEqual(anchorB.position.toArray(), [4, 5, 6]);
  assert.equal(typeof anchorA.raycast, 'function');
  assert.equal(anchorA.userData.parentLinkName, 'link_a');
  assert.equal(anchorB.userData.parentLinkName, 'link_b');
  assert.equal(anchorA.userData.isVisualMesh, true);
  assert.equal(anchorB.userData.isVisualMesh, true);
  assert.equal(anchorA.userData.geometryRole, 'visual');
  assert.equal(anchorB.userData.geometryRole, 'visual');
  assert.ok(anchorA.scale.x > shaft.scale.x);

  linkB.userData.__mjcfSitesData = [{ name: 'site_b', pos: [7, 8, 9], size: [0.005] }];
  linkB.updateMatrixWorld(true);
  robot.updateMatrixWorld(true);

  const movedChanged = syncMjcfTendonVisualizationForRobot({
    robot,
    sourceFormat: 'mjcf',
    showMjcfTendons: true,
  });
  assert.equal(movedChanged, true);
  assert.deepEqual(segment.position.toArray(), [4, 5, 6]);
  assert.deepEqual(anchorB.position.toArray(), [7, 8, 9]);

  const hiddenChanged = syncMjcfTendonVisualizationForRobot({
    robot,
    sourceFormat: 'mjcf',
    showMjcfTendons: false,
  });
  assert.equal(hiddenChanged, true);
  assert.equal(robot.userData.__mjcfTendons.visible, false);
});

test('syncMjcfTendonVisualizationForRobot softens near-white tendon colors for better contrast', () => {
  const robot = new THREE.Group();
  robot.userData.__mjcfTendonsData = [
    {
      name: 'finger_cable',
      rgba: [1, 1, 1, 1],
      attachmentRefs: ['site_a', 'site_b'],
    },
  ];

  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'finger_link';
  link.userData.__mjcfSitesData = [
    { name: 'site_a', pos: [0, 0, 0], size: [0.005] },
    { name: 'site_b', pos: [0, 0.1, 0], size: [0.005] },
  ];
  robot.add(link);
  robot.updateMatrixWorld(true);

  const changed = syncMjcfTendonVisualizationForRobot({
    robot,
    sourceFormat: 'mjcf',
    showMjcfTendons: true,
  });

  assert.equal(changed, true);

  const tendonObject = robot.userData.__mjcfTendons.children[0] as THREE.Group;
  const shaft = tendonObject.getObjectByName('__mjcf_tendon_shaft__') as THREE.Mesh | undefined;
  assert.ok(shaft);
  assert.equal(shaft.material instanceof THREE.MeshStandardMaterial, true);
  if (!(shaft.material instanceof THREE.MeshStandardMaterial)) {
    assert.fail('expected MJCF tendon shaft to use MeshStandardMaterial');
  }

  const expectedSoftenedWhite = createThreeColorFromSRGB(1, 1, 1).multiplyScalar(0.93);
  assert.ok(Math.abs(shaft.material.color.r - expectedSoftenedWhite.r) <= 1e-6);
  assert.ok(Math.abs(shaft.material.color.g - expectedSoftenedWhite.g) <= 1e-6);
  assert.ok(Math.abs(shaft.material.color.b - expectedSoftenedWhite.b) <= 1e-6);
  assert.equal(shaft.material.toneMapped, true);
  assert.equal(shaft.material.roughness, 0.76);
  assert.equal(shaft.material.metalness, 0.02);
  assert.equal(shaft.material.envMapIntensity, 0.16);
  assert.ok(shaft.material.emissive.r > 0);
});

test('syncMjcfTendonVisualizationForRobot handles multi-attachment tendons generically', () => {
  const robot = new THREE.Group();
  robot.userData.__mjcfTendonsData = [
    {
      name: 'routing_path',
      rgba: [1, 0, 0, 1],
      attachmentRefs: ['site_a', 'site_b', 'site_c'],
    },
  ];

  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'link';
  link.userData.__mjcfSitesData = [
    { name: 'site_a', pos: [0, 0, 0], size: [0.005] },
    { name: 'site_b', pos: [1, 0, 0], size: [0.005] },
    { name: 'site_c', pos: [1, 1, 0], size: [0.005] },
  ];
  robot.add(link);
  robot.updateMatrixWorld(true);

  const changed = syncMjcfTendonVisualizationForRobot({
    robot,
    sourceFormat: 'mjcf',
    showMjcfTendons: true,
  });
  assert.equal(changed, true);

  const tendonObject = robot.userData.__mjcfTendons.children[0] as THREE.Group;
  assert.ok(tendonObject.getObjectByName('__mjcf_tendon_segment__:0'));
  assert.ok(tendonObject.getObjectByName('__mjcf_tendon_segment__:1'));
  assert.ok(tendonObject.getObjectByName('__mjcf_tendon_anchor__:0'));
  assert.ok(tendonObject.getObjectByName('__mjcf_tendon_anchor__:1'));
  assert.ok(tendonObject.getObjectByName('__mjcf_tendon_anchor__:2'));
});

test('syncJointHelperInteractionStateForJoints promotes hovered joint-axis helpers', () => {
  const joint = new THREE.Group() as THREE.Group & {
    isURDFJoint?: boolean;
    jointType?: string;
    axis?: THREE.Vector3;
  };
  joint.isURDFJoint = true;
  joint.name = 'hip_joint';
  joint.jointType = 'revolute';
  joint.axis = new THREE.Vector3(0, 0, 1);

  syncJointAxesVisualizationForJoints({
    joints: [joint],
    showJointAxes: true,
    showJointAxesOverlay: true,
    jointAxisSize: 0.5,
  });

  const helper = joint.userData.__jointAxisViz as THREE.Object3D;
  const mesh = helper.children.find((child: any) => child.isMesh) as THREE.Mesh;
  const baseRenderOrder = mesh.renderOrder;

  const changed = syncJointHelperInteractionStateForJoints({
    joints: [joint],
    hoveredJointId: 'hip_joint',
  });

  assert.equal(changed, true);
  assert.equal(helper.scale.x, 1);
  assert.equal(helper.scale.y, 1);
  assert.equal(helper.scale.z, 1);
  assert.ok(mesh.renderOrder > baseRenderOrder);
  assert.equal((mesh.material as THREE.MeshBasicMaterial).color.getHex(), 0xfbbf24);
});

test('syncLinkHelperInteractionStateForLinks keeps hovered origin axes at a stable scale', () => {
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'base_link';

  syncOriginAxesVisualizationForLinks({
    links: [link],
    showOrigins: true,
    showOriginsOverlay: true,
    originSize: 0.2,
  });

  const originAxes = link.userData.__originAxes as THREE.Object3D;
  const originMesh = originAxes.children.find((child: any) => child.isMesh) as THREE.Mesh;
  const baseRenderOrder = originMesh.renderOrder;

  const changed = syncLinkHelperInteractionStateForLinks({
    links: [link],
    hoveredLinkId: 'base_link',
    hoveredHelperKind: 'origin-axes',
  });

  assert.equal(changed, true);
  assert.equal(originAxes.scale.x, 1);
  assert.equal(originAxes.scale.y, 1);
  assert.equal(originAxes.scale.z, 1);
  assert.ok(originMesh.renderOrder > baseRenderOrder);
});

test('syncLinkHelperInteractionStateForLinks boosts hovered inertia helpers', () => {
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'base_link';
  link.userData.__cachedMaxLinkSize = 1;
  link.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));

  const robotLinks = {
    base_link: {
      inertial: {
        mass: 1,
        inertia: {
          ixx: 1,
          ixy: 0,
          ixz: 0,
          iyy: 1,
          iyz: 0,
          izz: 1,
        },
        origin: {
          xyz: { x: 0, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
      },
    },
  } as any;

  syncInertiaVisualizationForLinks({
    links: [link],
    robotLinks,
    showInertia: true,
    showInertiaOverlay: true,
    showCenterOfMass: true,
    showCoMOverlay: true,
    centerOfMassSize: 0.01,
  });

  const comVisual = link.userData.__comVisual as THREE.Object3D;
  const comMesh = comVisual.children[0] as THREE.Mesh;
  const baseOpacity = (comMesh.material as THREE.MeshBasicMaterial).opacity;
  const baseRenderOrder = comMesh.renderOrder;

  const changed = syncLinkHelperInteractionStateForLinks({
    links: [link],
    hoveredLinkId: 'base_link',
  });

  assert.equal(changed, true);
  assert.ok(comVisual.scale.x > 1);
  assert.ok((comMesh.material as THREE.MeshBasicMaterial).opacity >= baseOpacity);
  assert.ok(comMesh.renderOrder > baseRenderOrder);
});

test('syncLinkHelperInteractionStateForLinks scopes hover to the active helper kind', () => {
  const link = new THREE.Group() as THREE.Group & { isURDFLink?: boolean };
  link.isURDFLink = true;
  link.name = 'base_link';
  link.userData.__cachedMaxLinkSize = 1;
  link.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));

  const robotLinks = {
    base_link: {
      inertial: {
        mass: 1,
        inertia: {
          ixx: 1,
          ixy: 0,
          ixz: 0,
          iyy: 1,
          iyz: 0,
          izz: 1,
        },
        origin: {
          xyz: { x: 0, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
      },
    },
  } as any;

  syncInertiaVisualizationForLinks({
    links: [link],
    robotLinks,
    showInertia: true,
    showInertiaOverlay: true,
    showCenterOfMass: true,
    showCoMOverlay: true,
    centerOfMassSize: 0.01,
  });

  const comVisual = link.userData.__comVisual as THREE.Object3D;
  const inertiaGroup = link.userData.__inertiaVisualGroup as THREE.Object3D;
  const inertiaBox = inertiaGroup.children.find(
    (child) => child.name === '__inertia_box__',
  ) as THREE.Object3D;

  const changed = syncLinkHelperInteractionStateForLinks({
    links: [link],
    hoveredLinkId: 'base_link',
    hoveredHelperKind: 'center-of-mass',
  });

  assert.equal(changed, true);
  assert.ok(comVisual.scale.x > 1);
  assert.equal(inertiaBox.scale.x, 1);
});
