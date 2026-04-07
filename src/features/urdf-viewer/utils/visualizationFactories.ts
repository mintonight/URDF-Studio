import * as THREE from 'three';
import { createThreeColorFromSRGB } from '@/core/utils/color.ts';
import { createMatteMaterial } from '@/core/utils/materialFactory';
import { ignoreRaycast } from '@/shared/utils/three/ignoreRaycast';
import { narrowLineRaycast } from '@/shared/utils/three/narrowLineRaycast';

export interface MjcfSiteVisualizationData {
  name: string;
  sourceName?: string;
  type: string;
  size?: number[];
  rgba?: [number, number, number, number];
  pos?: [number, number, number];
  quat?: [number, number, number, number];
}

export interface MjcfTendonVisualizationData {
  name: string;
  rgba?: [number, number, number, number];
  attachmentRefs: string[];
  width?: number;
}

function createSelectableHelperUserData(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    isGizmo: true,
    isSelectableHelper: true,
    ...extra,
  };
}

function createNonInteractiveHelperUserData(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    isGizmo: true,
    isSelectableHelper: false,
    ...extra,
  };
}

function createMjcfTendonUserData(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    isMjcfTendon: true,
    ...extra,
  };
}

function clampSiteChannel(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return THREE.MathUtils.clamp(value as number, 0, 1);
}

function mjcfQuatToThreeQuat(quat: [number, number, number, number]): THREE.Quaternion {
  return new THREE.Quaternion(quat[1], quat[2], quat[3], quat[0]);
}

function createMjcfSitePrimitive(site: MjcfSiteVisualizationData): THREE.Object3D {
  const type = site.type?.trim().toLowerCase() || 'sphere';

  switch (type) {
    case 'box': {
      const sx = (site.size?.[0] ?? 0.01) * 2;
      const sy = (site.size?.[1] ?? site.size?.[0] ?? 0.01) * 2;
      const sz = (site.size?.[2] ?? site.size?.[0] ?? 0.01) * 2;
      return new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshBasicMaterial());
    }
    case 'cylinder': {
      const radius = site.size?.[0] ?? 0.01;
      const halfHeight = site.size?.[1] ?? 0.02;
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, halfHeight * 2, 20),
        new THREE.MeshBasicMaterial(),
      );
      mesh.rotation.x = Math.PI / 2;
      return mesh;
    }
    case 'capsule': {
      const radius = site.size?.[0] ?? 0.01;
      const halfHeight = site.size?.[1] ?? 0.02;
      const group = new THREE.Group();

      const cylinder = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, halfHeight * 2, 20),
        new THREE.MeshBasicMaterial(),
      );
      group.add(cylinder);

      const topSphere = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 20, 12),
        new THREE.MeshBasicMaterial(),
      );
      topSphere.position.y = halfHeight;
      group.add(topSphere);

      const bottomSphere = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 20, 12),
        new THREE.MeshBasicMaterial(),
      );
      bottomSphere.position.y = -halfHeight;
      group.add(bottomSphere);

      group.rotation.x = Math.PI / 2;
      return group;
    }
    case 'ellipsoid': {
      const sx = site.size?.[0] ?? 0.01;
      const sy = site.size?.[1] ?? sx;
      const sz = site.size?.[2] ?? sx;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(1, 20, 12),
        new THREE.MeshBasicMaterial(),
      );
      mesh.scale.set(sx, sy, sz);
      return mesh;
    }
    case 'sphere':
    default: {
      return new THREE.Mesh(
        new THREE.SphereGeometry(site.size?.[0] ?? 0.01, 20, 12),
        new THREE.MeshBasicMaterial(),
      );
    }
  }
}

function applyMjcfSiteMaterial(
  root: THREE.Object3D,
  siteName: string,
  rgba?: [number, number, number, number],
): void {
  const r = clampSiteChannel(rgba?.[0], 1);
  const g = clampSiteChannel(rgba?.[1], 0.67);
  const b = clampSiteChannel(rgba?.[2], 0.26);
  const alpha = clampSiteChannel(rgba?.[3], 1);
  const fillOpacity = THREE.MathUtils.clamp(alpha * 0.18, 0.08, 0.22);
  const lineOpacity = THREE.MathUtils.clamp(alpha, 0.45, 1);
  const helperUserData = createNonInteractiveHelperUserData({
    isMjcfSite: true,
    mjcfSiteName: siteName,
  });

  root.traverse((child: any) => {
    if (!child?.isMesh) {
      return;
    }

    const fillMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(r, g, b),
      transparent: true,
      opacity: fillOpacity,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    fillMaterial.userData = { isSharedMaterial: true };

    child.material = fillMaterial;
    child.renderOrder = 10002;
    child.raycast = ignoreRaycast;
    child.userData = { ...helperUserData };

    if (child.geometry) {
      const wireframe = new THREE.LineSegments(
        new THREE.WireframeGeometry(child.geometry),
        new THREE.LineBasicMaterial({
          color: new THREE.Color(r, g, b),
          transparent: true,
          opacity: lineOpacity,
          depthTest: false,
          depthWrite: false,
        }),
      );
      (wireframe.material as THREE.LineBasicMaterial).userData = { isSharedMaterial: true };
      wireframe.renderOrder = 10003;
      wireframe.raycast = ignoreRaycast;
      wireframe.userData = { ...helperUserData };
      child.add(wireframe);
    }
  });
}

export function createMjcfSiteVisualization(site: MjcfSiteVisualizationData): THREE.Group {
  const siteGroup = new THREE.Group();
  siteGroup.name = `__mjcf_site__:${site.name}`;
  siteGroup.userData = createNonInteractiveHelperUserData({
    isMjcfSite: true,
    mjcfSiteName: site.name,
  });

  if (site.pos) {
    siteGroup.position.set(site.pos[0], site.pos[1], site.pos[2]);
  }

  if (site.quat) {
    siteGroup.quaternion.copy(mjcfQuatToThreeQuat(site.quat));
  }

  const primitive = createMjcfSitePrimitive(site);
  applyMjcfSiteMaterial(primitive, site.name, site.rgba);
  siteGroup.add(primitive);

  return siteGroup;
}

export function createMjcfTendonVisualization(tendon: MjcfTendonVisualizationData): THREE.Group {
  const r = clampSiteChannel(tendon.rgba?.[0], 1);
  const g = clampSiteChannel(tendon.rgba?.[1], 0);
  const b = clampSiteChannel(tendon.rgba?.[2], 0);
  const alpha = clampSiteChannel(tendon.rgba?.[3], 1);
  const tendonColor = createThreeColorFromSRGB(r, g, b);
  const tendonGroup = new THREE.Group();
  tendonGroup.name = `__mjcf_tendon__:${tendon.name}`;
  tendonGroup.userData = createMjcfTendonUserData({
    mjcfTendonName: tendon.name,
    mjcfTendonAttachmentRefs: [...tendon.attachmentRefs],
    mjcfTendonWidth: tendon.width ?? null,
  });

  const material = createMatteMaterial({
    color: tendonColor,
    opacity: alpha,
    transparent: alpha < 1,
    name: `${tendon.name}_tendon`,
  });
  material.roughness = 0.76;
  material.metalness = 0.02;
  material.envMapIntensity = Math.min(material.envMapIntensity, 0.16);
  material.emissive.copy(tendonColor).multiplyScalar(alpha < 1 ? 0.09 : 0.05);
  material.userData = {
    ...material.userData,
    isSharedMaterial: true,
    isMjcfTendonMaterial: true,
    mjcfTendonName: tendon.name,
    originalRoughness: material.roughness,
    originalMetalness: material.metalness,
    originalEnvMapIntensity: material.envMapIntensity,
  };
  material.needsUpdate = true;

  const segmentCount = Math.max(tendon.attachmentRefs.length - 1, 1);
  for (let index = 0; index < segmentCount; index += 1) {
    const segment = new THREE.Group();
    segment.name = `__mjcf_tendon_segment__:${index}`;
    segment.userData = createMjcfTendonUserData({
      mjcfTendonName: tendon.name,
      mjcfTendonSegmentIndex: index,
    });

    const shaftGeometry = new THREE.CylinderGeometry(1, 1, 1, 16, 1, false);
    const shaft = new THREE.Mesh(shaftGeometry, material);
    shaft.name = '__mjcf_tendon_shaft__';
    shaft.userData = createMjcfTendonUserData({
      mjcfTendonName: tendon.name,
      mjcfTendonSegmentIndex: index,
    });
    segment.add(shaft);

    tendonGroup.add(segment);
  }

  const anchorCount = Math.max(tendon.attachmentRefs.length, 2);
  for (let index = 0; index < anchorCount; index += 1) {
    const anchor = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), material);
    anchor.name = `__mjcf_tendon_anchor__:${index}`;
    anchor.userData = createMjcfTendonUserData({
      mjcfTendonName: tendon.name,
      mjcfTendonAnchorIndex: index,
    });
    tendonGroup.add(anchor);
  }

  return tendonGroup;
}

/**
 * Create a visual arrow indicator for joint axis (used for both URDF and MJCF joints).
 * Color: Red for X, Green for Y, Blue for Z dominant component.
 */
export function createJointAxisVisualization(
  axis: THREE.Vector3,
  size: number = 1.0,
): THREE.Object3D {
  const length = 0.15 * size;
  const group = new THREE.Group();
  group.name = '__joint_axis_helper__';
  group.userData = createSelectableHelperUserData();

  // Determine color based on dominant axis
  const absAxis = new THREE.Vector3(Math.abs(axis.x), Math.abs(axis.y), Math.abs(axis.z));
  let color: number;
  if (absAxis.x >= absAxis.y && absAxis.x >= absAxis.z) {
    color = 0xff4444; // Red for X
  } else if (absAxis.y >= absAxis.x && absAxis.y >= absAxis.z) {
    color = 0x44ff44; // Green for Y
  } else {
    color = 0x4444ff; // Blue for Z
  }

  // Create arrow shaft (cylinder)
  const shaftGeom = new THREE.CylinderGeometry(0.005, 0.005, length * 0.8, 8);
  const shaftMat = new THREE.MeshBasicMaterial({
    color,
    depthTest: false,
    transparent: true,
    opacity: 0.9,
  });
  const shaft = new THREE.Mesh(shaftGeom, shaftMat);
  shaft.position.y = length * 0.4;
  shaft.userData = createSelectableHelperUserData();
  shaft.renderOrder = 1001;
  group.add(shaft);

  // Create arrow head (cone)
  const headGeom = new THREE.ConeGeometry(0.015, length * 0.2, 8);
  const headMat = new THREE.MeshBasicMaterial({
    color,
    depthTest: false,
    transparent: true,
    opacity: 0.9,
  });
  const head = new THREE.Mesh(headGeom, headMat);
  head.position.y = length * 0.9;
  head.userData = createSelectableHelperUserData();
  head.renderOrder = 1001;
  group.add(head);

  // Align the arrow (default points +Y) to the axis direction
  const targetDir = axis.clone().normalize();
  const upDir = new THREE.Vector3(0, 1, 0);
  if (Math.abs(targetDir.dot(upDir)) < 0.999) {
    const quaternion = new THREE.Quaternion().setFromUnitVectors(upDir, targetDir);
    group.quaternion.copy(quaternion);
  }

  return group;
}

/**
 * Create origin axes visualization (RGB = XYZ) for a link
 */
export function createOriginAxes(size: number): THREE.Group {
  const originAxes = new THREE.Group();
  originAxes.name = '__origin_axes__';
  originAxes.userData = createSelectableHelperUserData();

  const thickness = size * 0.04;
  const headSize = size * 0.2;
  const headRadius = thickness * 2.5;

  // X Axis - Red
  const xAxisGeom = new THREE.CylinderGeometry(thickness, thickness, size, 12);
  const xAxisMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  const xAxis = new THREE.Mesh(xAxisGeom, xAxisMat);
  xAxis.rotation.set(0, 0, -Math.PI / 2);
  xAxis.position.set(size / 2, 0, 0);
  xAxis.userData = createSelectableHelperUserData();
  xAxis.renderOrder = 999;
  originAxes.add(xAxis);

  const xConeGeom = new THREE.ConeGeometry(headRadius, headSize, 12);
  const xCone = new THREE.Mesh(xConeGeom, xAxisMat);
  xCone.rotation.set(0, 0, -Math.PI / 2);
  xCone.position.set(size, 0, 0);
  xCone.userData = createSelectableHelperUserData();
  xCone.renderOrder = 999;
  originAxes.add(xCone);

  // Y Axis - Green
  const yAxisGeom = new THREE.CylinderGeometry(thickness, thickness, size, 12);
  const yAxisMat = new THREE.MeshBasicMaterial({ color: 0x22c55e });
  const yAxis = new THREE.Mesh(yAxisGeom, yAxisMat);
  yAxis.position.set(0, size / 2, 0);
  yAxis.userData = createSelectableHelperUserData();
  yAxis.renderOrder = 999;
  originAxes.add(yAxis);

  const yConeGeom = new THREE.ConeGeometry(headRadius, headSize, 12);
  const yCone = new THREE.Mesh(yConeGeom, yAxisMat);
  yCone.position.set(0, size, 0);
  yCone.userData = createSelectableHelperUserData();
  yCone.renderOrder = 999;
  originAxes.add(yCone);

  // Z Axis - Blue
  const zAxisGeom = new THREE.CylinderGeometry(thickness, thickness, size, 12);
  const zAxisMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6 });
  const zAxis = new THREE.Mesh(zAxisGeom, zAxisMat);
  zAxis.rotation.set(Math.PI / 2, 0, 0);
  zAxis.position.set(0, 0, size / 2);
  zAxis.userData = createSelectableHelperUserData();
  zAxis.renderOrder = 999;
  originAxes.add(zAxis);

  const zConeGeom = new THREE.ConeGeometry(headRadius, headSize, 12);
  const zCone = new THREE.Mesh(zConeGeom, zAxisMat);
  zCone.rotation.set(Math.PI / 2, 0, 0);
  zCone.position.set(0, 0, size);
  zCone.userData = createSelectableHelperUserData();
  zCone.renderOrder = 999;
  originAxes.add(zCone);

  return originAxes;
}

/**
 * Create joint axis visualization with rotation/translation indicators
 */
export function createJointAxisViz(
  jointType: string,
  axis: THREE.Vector3,
  scale: number,
): THREE.Group {
  const jointAxisViz = new THREE.Group();
  jointAxisViz.name = '__joint_axis__';
  jointAxisViz.userData = createSelectableHelperUserData({ originalScale: scale });

  const axisVec = new THREE.Vector3(axis.x, axis.y, axis.z).normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axisVec);

  const color = 0xd946ef; // Purple/magenta

  // Arrow for axis direction
  const arrowLength = 0.35 * scale;
  const arrowHeadLength = 0.08 * scale;
  const arrowHeadWidth = 0.05 * scale;

  // Arrow shaft
  const shaftGeom = new THREE.CylinderGeometry(
    0.008 * scale,
    0.008 * scale,
    arrowLength - arrowHeadLength,
    8,
  );
  const shaftMat = new THREE.MeshBasicMaterial({ color, depthTest: false });
  const shaft = new THREE.Mesh(shaftGeom, shaftMat);
  shaft.rotation.set(Math.PI / 2, 0, 0);
  shaft.position.set(0, 0, (arrowLength - arrowHeadLength) / 2);
  shaft.userData = createSelectableHelperUserData();
  shaft.renderOrder = 999;
  jointAxisViz.add(shaft);

  // Arrow head
  const headGeom = new THREE.ConeGeometry(arrowHeadWidth, arrowHeadLength, 8);
  const head = new THREE.Mesh(headGeom, shaftMat);
  head.rotation.set(Math.PI / 2, 0, 0);
  head.position.set(0, 0, arrowLength - arrowHeadLength / 2);
  head.userData = createSelectableHelperUserData();
  head.renderOrder = 999;
  jointAxisViz.add(head);

  // For revolute/continuous joints, add rotation indicator (torus)
  if (jointType === 'revolute' || jointType === 'continuous') {
    const torusRadius = 0.15 * scale;
    const tubeRadius = 0.005 * scale;
    const torusArc = jointType === 'revolute' ? Math.PI * 1.5 : Math.PI * 2;
    const torusGeom = new THREE.TorusGeometry(torusRadius, tubeRadius, 8, 32, torusArc);
    const torus = new THREE.Mesh(torusGeom, shaftMat);
    torus.userData = createSelectableHelperUserData();
    torus.renderOrder = 999;
    jointAxisViz.add(torus);

    // Small arrow on torus to indicate rotation direction
    const miniConeGeom = new THREE.ConeGeometry(0.015 * scale, 0.04 * scale, 8);
    const miniCone = new THREE.Mesh(miniConeGeom, shaftMat);
    miniCone.position.set(torusRadius, 0, 0);
    miniCone.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
    miniCone.userData = createSelectableHelperUserData();
    miniCone.renderOrder = 999;
    jointAxisViz.add(miniCone);
  }

  // For prismatic joints, add bidirectional arrow
  if (jointType === 'prismatic') {
    // Second arrow in opposite direction
    const shaft2Geom = new THREE.CylinderGeometry(
      0.008 * scale,
      0.008 * scale,
      arrowLength - arrowHeadLength,
      8,
    );
    const shaft2 = new THREE.Mesh(shaft2Geom, shaftMat);
    shaft2.rotation.set(-Math.PI / 2, 0, 0);
    shaft2.position.set(0, 0, -(arrowLength - arrowHeadLength) / 2);
    shaft2.userData = createSelectableHelperUserData();
    shaft2.renderOrder = 999;
    jointAxisViz.add(shaft2);

    const head2Geom = new THREE.ConeGeometry(arrowHeadWidth, arrowHeadLength, 8);
    const head2 = new THREE.Mesh(head2Geom, shaftMat);
    head2.rotation.set(-Math.PI / 2, 0, 0);
    head2.position.set(0, 0, -(arrowLength - arrowHeadLength / 2));
    head2.userData = createSelectableHelperUserData();
    head2.renderOrder = 999;
    jointAxisViz.add(head2);
  }

  // Apply axis rotation
  jointAxisViz.quaternion.copy(quaternion);

  return jointAxisViz;
}

/**
 * Create Center of Mass (CoM) visualization - checkered sphere
 */
export function createCoMVisual(): THREE.Group {
  const comVisual = new THREE.Group();
  comVisual.name = '__com_visual__';
  comVisual.userData = createSelectableHelperUserData();

  // Fixed radius for CoM sphere (0.01m = 1cm)
  const radius = 0.01;
  const geometry = new THREE.SphereGeometry(radius, 16, 16, 0, Math.PI / 2, 0, Math.PI / 2);
  const matBlack = new THREE.MeshBasicMaterial({
    color: 0x000000,
    depthTest: false,
    transparent: true,
    opacity: 0.8,
  });
  matBlack.userData = { isSharedMaterial: true }; // Prevent opacity modification
  const matWhite = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    depthTest: false,
    transparent: true,
    opacity: 0.8,
  });
  matWhite.userData = { isSharedMaterial: true }; // Prevent opacity modification

  const positions = [
    [0, 0, 0],
    [0, Math.PI / 2, 0],
    [0, Math.PI, 0],
    [0, -Math.PI / 2, 0],
    [Math.PI, 0, 0],
    [Math.PI, Math.PI / 2, 0],
    [Math.PI, Math.PI, 0],
    [Math.PI, -Math.PI / 2, 0],
  ];

  positions.forEach((rot, i) => {
    const mesh = new THREE.Mesh(geometry, i % 2 === 0 ? matBlack : matWhite);
    mesh.rotation.set(rot[0], rot[1], rot[2]);
    mesh.renderOrder = 10001;
    mesh.userData = createSelectableHelperUserData();
    comVisual.add(mesh);
  });

  return comVisual;
}

/**
 * Create inertia box visualization
 */
export function createInertiaBox(
  width: number,
  height: number,
  depth: number,
  rotation: THREE.Quaternion,
): THREE.Group {
  const inertiaBox = new THREE.Group();
  inertiaBox.name = '__inertia_box__';
  inertiaBox.userData = createSelectableHelperUserData();

  const geom = new THREE.BoxGeometry(width, height, depth);

  const mat = new THREE.MeshBasicMaterial({
    color: 0x00d4ff,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
    depthTest: false,
  });
  mat.userData = { isSharedMaterial: true }; // Prevent opacity modification
  const mesh = new THREE.Mesh(geom, mat);
  mesh.quaternion.copy(rotation);
  mesh.userData = createSelectableHelperUserData();
  mesh.renderOrder = 9999;
  mesh.raycast = ignoreRaycast;
  inertiaBox.add(mesh);

  const edges = new THREE.EdgesGeometry(geom);
  const lineMat = new THREE.LineBasicMaterial({
    color: 0x00d4ff,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    depthTest: false,
  });
  lineMat.userData = { isSharedMaterial: true }; // Prevent opacity modification
  const line = new THREE.LineSegments(edges, lineMat);
  line.quaternion.copy(rotation);
  line.userData = createSelectableHelperUserData();
  line.renderOrder = 10000;
  // Let the visible outline own picking with a narrow threshold so hover/click
  // stays close to the 2D silhouette users actually see on screen.
  line.raycast = narrowLineRaycast;
  inertiaBox.add(line);

  return inertiaBox;
}

/**
 * Create a link IK handle visualization.
 */
export function createLinkIkHandle(radius: number): THREE.Group {
  const ikHandle = new THREE.Group();
  ikHandle.name = '__ik_handle__';
  ikHandle.userData = createSelectableHelperUserData({
    viewerHelperKind: 'ik-handle',
    ikHandleStyleVersion: 2,
  });

  const material = new THREE.MeshBasicMaterial({
    color: 0x16a34a,
    transparent: true,
    opacity: 0.68,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 18, 18), material);
  mesh.userData = createSelectableHelperUserData({
    viewerHelperKind: 'ik-handle',
    ikHandleStyleVersion: 2,
  });
  mesh.renderOrder = 10030;
  ikHandle.add(mesh);

  return ikHandle;
}
