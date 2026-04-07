import * as THREE from 'three';
import { stackCoincidentVisualRoots } from '@/core/loaders/visualMeshStacking';
import { isImageAssetPath } from '@/core/utils/assetFileTypes';
import { getCollisionGeometryEntries, getVisualGeometryEntries } from '@/core/robot';
import { parseThreeColorWithOpacity } from '@/core/utils/color.ts';
import { createMatteMaterial } from '@/core/utils/materialFactory';
import { createMainThreadYieldController } from '@/core/utils/yieldToMainThread';
import {
  GeometryType,
  JointType,
  type UrdfJoint as RobotJoint,
  type UrdfLink as RobotLink,
} from '@/types';
import {
  URDFCollider,
  URDFJoint,
  URDFLink,
  URDFMimicJoint,
  URDFRobot,
  URDFVisual,
} from './URDFClasses';
import type { MeshLoadFunc } from './URDFLoader';

const DEFAULT_COLOR = '#808080';
const DEFAULT_ORIGIN = {
  xyz: { x: 0, y: 0, z: 0 },
  rpy: { r: 0, p: 0, y: 0 },
} as const;

const tempQuaternion = new THREE.Quaternion();
const tempEuler = new THREE.Euler();

function applyRotation(
  object: THREE.Object3D,
  rpy: [number, number, number],
  additive = false,
): void {
  if (!additive) {
    object.rotation.set(0, 0, 0);
  }

  tempEuler.set(rpy[0], rpy[1], rpy[2], 'ZYX');
  tempQuaternion.setFromEuler(tempEuler);
  tempQuaternion.multiply(object.quaternion);
  object.quaternion.copy(tempQuaternion);
}

function applyOrigin(
  object: THREE.Object3D,
  origin: RobotLink['visual']['origin'] | RobotJoint['origin'] | undefined,
): void {
  const xyz = origin?.xyz ?? DEFAULT_ORIGIN.xyz;
  const rpy = origin?.rpy ?? DEFAULT_ORIGIN.rpy;

  object.position.set(xyz.x, xyz.y, xyz.z);
  object.rotation.set(0, 0, 0);
  applyRotation(object, [rpy.r, rpy.p, rpy.y]);
}

function loadedObjectShouldPreserveEmbeddedMaterials(object: THREE.Object3D): boolean {
  const materialNames = new Set<string>();
  let hasMaterialTexture = false;
  let hasMultiMaterialMesh = false;

  object.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) {
      return;
    }

    const material = (child as THREE.Mesh).material;
    const materials = Array.isArray(material) ? material : [material];
    if (materials.length > 1) {
      hasMultiMaterialMesh = true;
    }

    materials.forEach((entry) => {
      const materialName = entry?.name?.trim();
      if (materialName) {
        materialNames.add(materialName);
      }

      if ('map' in (entry || {}) && (entry as THREE.MeshPhongMaterial).map) {
        hasMaterialTexture = true;
      }
    });
  });

  return hasMaterialTexture || hasMultiMaterialMesh || materialNames.size > 1;
}

function shouldAttachLoadedMeshObject(object: THREE.Object3D, isCollisionNode: boolean): boolean {
  if (isCollisionNode && object.userData?.isPlaceholder === true) {
    return false;
  }

  return true;
}

function restackLinkVisualRoots(linkTarget: THREE.Object3D): void {
  const visualRoots = linkTarget.children
    .filter((child: any) => child?.isURDFVisual)
    .map((child, index) => ({
      root: child,
      stableId: child.name || child.userData?.runtimeKey || index,
    }));

  if (visualRoots.length < 2) {
    return;
  }

  stackCoincidentVisualRoots(visualRoots);
}

function findVisualRestackRoot(object: THREE.Object3D): THREE.Object3D {
  let current: THREE.Object3D | null = object;
  let highest: THREE.Object3D = object;

  while (current) {
    highest = current;
    if ((current as any).isURDFRobot) {
      return current;
    }
    current = current.parent;
  }

  return highest;
}

function restackRobotVisualRoots(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);

  const visualRoots: Array<{ root: THREE.Object3D; stableId: number }> = [];
  let visualIndex = 0;
  root.traverse((child: any) => {
    if (!child?.isURDFVisual) {
      return;
    }

    visualRoots.push({
      root: child,
      stableId: (visualIndex += 1),
    });
  });

  if (visualRoots.length < 2) {
    return;
  }

  stackCoincidentVisualRoots(visualRoots, { space: 'world' });
}

function createPrimitiveMaterial(color?: string): THREE.MeshStandardMaterial {
  return createMatteMaterial({
    color: color || DEFAULT_COLOR,
    preserveExactColor: Boolean(color),
  });
}

function applyVisualColorOverrideToLoadedObject(object: THREE.Object3D, color?: string): void {
  const parsedColor = parseThreeColorWithOpacity(color);
  if (!parsedColor) {
    return;
  }

  object.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) {
      return;
    }

    const mesh = child as THREE.Mesh;
    const replace = (material: THREE.Material) =>
      createMatteMaterial({
        color: parsedColor.color,
        opacity: parsedColor.opacity ?? material.opacity ?? 1,
        transparent: material.transparent || (parsedColor.opacity ?? 1) < 1,
        side: material.side,
        map: (material as any).map || null,
        name: material.name,
        preserveExactColor: true,
      });

    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((material) => replace(material));
      return;
    }

    if (mesh.material) {
      mesh.material = replace(mesh.material);
    }
  });
}

function applyMeshScale(group: THREE.Object3D, geometry: RobotLink['visual']): void {
  if (geometry.type !== GeometryType.MESH) {
    return;
  }

  const scale = geometry.dimensions;
  group.scale.set(
    Number.isFinite(scale?.x) ? scale.x : 1,
    Number.isFinite(scale?.y) ? scale.y : 1,
    Number.isFinite(scale?.z) ? scale.z : 1,
  );
}

function createImagePreviewMesh(
  geometry: RobotLink['visual'],
  manager: THREE.LoadingManager,
  isCollision: boolean,
): THREE.Mesh {
  const material = createPrimitiveMaterial(isCollision ? undefined : geometry.color);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  const width = geometry.dimensions.x || 1;
  const fallbackHeight = geometry.dimensions.y || 1;
  mesh.scale.set(width, fallbackHeight, 1);
  material.side = THREE.DoubleSide;

  new THREE.TextureLoader(manager).load(
    geometry.meshPath || '',
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      material.map = texture;
      material.transparent = true;
      material.alphaTest = 0.001;
      material.needsUpdate = true;

      const image = texture.image as { width?: number; height?: number } | undefined;
      if (!image?.width || !image?.height) {
        return;
      }

      const aspectHeight = width * (image.height / image.width);
      const height = fallbackHeight === 1 ? aspectHeight : fallbackHeight;
      mesh.scale.set(width, height, 1);
    },
    undefined,
    (error) => {
      console.error('[URDFViewer] Failed to load image asset preview texture:', error);
    },
  );

  return mesh;
}

function createPrimitiveMesh(
  geometry: RobotLink['visual'],
  isCollision: boolean,
): THREE.Mesh | null {
  const dimensions = geometry.dimensions;
  const material = createPrimitiveMaterial(isCollision ? undefined : geometry.color);

  if (geometry.type === GeometryType.BOX) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    mesh.scale.set(dimensions.x || 0.1, dimensions.y || 0.1, dimensions.z || 0.1);
    return mesh;
  }

  if (geometry.type === GeometryType.PLANE) {
    material.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    mesh.scale.set(dimensions.x || 1, dimensions.y || 1, 1);
    return mesh;
  }

  if (geometry.type === GeometryType.SPHERE || geometry.type === GeometryType.ELLIPSOID) {
    const radius = dimensions.x || 0.1;
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 30, 30), material);
    mesh.scale.set(radius, dimensions.y || radius, dimensions.z || radius);
    return mesh;
  }

  if (geometry.type === GeometryType.CYLINDER) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 30), material);
    mesh.scale.set(dimensions.x || 0.05, dimensions.y || 0.5, dimensions.z || dimensions.x || 0.05);
    mesh.rotation.set(Math.PI / 2, 0, 0);
    return mesh;
  }

  if (geometry.type === GeometryType.CAPSULE) {
    const radius = Math.max(dimensions.x || 0.05, 1e-5);
    const totalLength = Math.max(dimensions.y || 0.5, radius * 2);
    const bodyLength = Math.max(totalLength - 2 * radius, 0);
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, bodyLength, 8, 16), material);
    mesh.rotation.set(Math.PI / 2, 0, 0);
    return mesh;
  }

  return null;
}

function resolveRuntimeJointType(type: JointType): URDFJoint['jointType'] {
  switch (type) {
    case JointType.REVOLUTE:
      return 'revolute';
    case JointType.CONTINUOUS:
      return 'continuous';
    case JointType.PRISMATIC:
      return 'prismatic';
    case JointType.PLANAR:
      return 'planar';
    case JointType.FLOATING:
      return 'floating';
    case JointType.FIXED:
      return 'fixed';
    case JointType.BALL:
      return 'floating';
    default:
      return 'fixed';
  }
}

export interface BuildRuntimeRobotFromStateOptions {
  robotName?: string;
  links: Record<string, RobotLink>;
  joints: Record<string, RobotJoint>;
  manager: THREE.LoadingManager;
  loadMeshCb: MeshLoadFunc;
  parseVisual?: boolean;
  parseCollision?: boolean;
  rootLinkId?: string;
  yieldIfNeeded?: () => Promise<void>;
}

export async function buildRuntimeRobotFromState({
  robotName,
  links,
  joints,
  manager,
  loadMeshCb,
  parseVisual = true,
  parseCollision = true,
  rootLinkId,
  yieldIfNeeded = createMainThreadYieldController(),
}: BuildRuntimeRobotFromStateOptions): Promise<URDFRobot> {
  const robot = new URDFRobot();
  const linkMap: Record<string, URDFLink> = {};
  const jointMap: Record<string, URDFJoint> = {};
  const colliderMap: Record<string, URDFCollider> = {};
  const visualMap: Record<string, URDFVisual> = {};

  robot.robotName = robotName ?? null;
  robot.name = robotName || '';
  robot.urdfName = robot.name;
  robot.userData.displayName = robotName || '';

  const addGeometryGroup = (
    linkKey: string,
    linkTarget: URDFLink,
    geometry: RobotLink['visual'],
    runtimeKey: string,
    isCollision: boolean,
  ) => {
    const group = isCollision ? new URDFCollider() : new URDFVisual();
    group.name = runtimeKey;
    group.urdfName = runtimeKey;
    group.userData.runtimeKey = runtimeKey;
    group.userData.parentLinkId = linkKey;
    group.userData.displayName = runtimeKey;

    applyOrigin(group, geometry.origin);
    applyMeshScale(group, geometry);

    if (geometry.type === GeometryType.MESH && geometry.meshPath) {
      if (isImageAssetPath(geometry.meshPath)) {
        group.add(createImagePreviewMesh(geometry, manager, isCollision));
      } else {
        loadMeshCb(geometry.meshPath, manager, (object, error) => {
          if (error) {
            console.error('[URDFViewer] Failed to load mesh from robot state:', error);
          }

          if (!object || !shouldAttachLoadedMeshObject(object, isCollision)) {
            return;
          }

          if (
            !isCollision &&
            geometry.color &&
            !loadedObjectShouldPreserveEmbeddedMaterials(object)
          ) {
            applyVisualColorOverrideToLoadedObject(object, geometry.color);
          }

          group.add(object);
          if (group.parent && !isCollision) {
            restackLinkVisualRoots(group.parent);
            restackRobotVisualRoots(findVisualRestackRoot(group.parent));
          }
        });
      }
    } else {
      const primitiveMesh = createPrimitiveMesh(geometry, isCollision);
      if (primitiveMesh) {
        group.add(primitiveMesh);
      }
    }

    linkTarget.add(group);

    if (isCollision) {
      colliderMap[runtimeKey] = group as URDFCollider;
    } else {
      visualMap[runtimeKey] = group as URDFVisual;
    }
  };

  for (const [linkId, linkData] of Object.entries(links)) {
    const linkKey = linkData.id || linkId;
    const linkTarget = new URDFLink();
    linkTarget.name = linkKey;
    linkTarget.urdfName = linkKey;
    linkTarget.userData.displayName = linkData.name || linkKey;
    linkTarget.userData.linkId = linkKey;
    linkMap[linkKey] = linkTarget;

    if (parseVisual) {
      const visualEntries = getVisualGeometryEntries(linkData);
      visualEntries.forEach((entry) => {
        addGeometryGroup(
          linkKey,
          linkTarget,
          entry.geometry,
          `${linkKey}::visual::${entry.objectIndex}`,
          false,
        );
      });

      if (visualEntries.length > 0) {
        restackLinkVisualRoots(linkTarget);
      }
    }

    if (parseCollision) {
      const collisionEntries = getCollisionGeometryEntries(linkData);
      collisionEntries.forEach((entry) => {
        addGeometryGroup(
          linkKey,
          linkTarget,
          entry.geometry,
          `${linkKey}::collision::${entry.objectIndex}`,
          true,
        );
      });
    }

    await yieldIfNeeded();
  }

  for (const [jointId, jointData] of Object.entries(joints)) {
    const jointKey = jointData.id || jointId;
    const joint = jointData.mimic ? new URDFMimicJoint() : new URDFJoint();
    joint.name = jointKey;
    joint.urdfName = jointKey;
    joint.userData.displayName = jointData.name || jointKey;
    joint.userData.jointId = jointKey;
    joint.userData.originalJointType = jointData.type;
    joint.jointType = resolveRuntimeJointType(jointData.type);

    if (jointData.axis) {
      joint.axis = new THREE.Vector3(jointData.axis.x, jointData.axis.y, jointData.axis.z);
      if (joint.axis.lengthSq() > 0) {
        joint.axis.normalize();
      }
    }

    if (jointData.limit) {
      joint.limit.lower = jointData.limit.lower;
      joint.limit.upper = jointData.limit.upper;
      joint.limit.effort = jointData.limit.effort;
      joint.limit.velocity = jointData.limit.velocity;
    }

    if (joint instanceof URDFMimicJoint && jointData.mimic) {
      joint.mimicJoint = jointData.mimic.joint;
      joint.multiplier = jointData.mimic.multiplier ?? 1;
      joint.offset = jointData.mimic.offset ?? 0;
    }

    applyOrigin(joint, jointData.origin);
    jointMap[jointKey] = joint;
    await yieldIfNeeded();
  }

  for (const jointData of Object.values(joints)) {
    const jointKey = jointData.id || jointData.name;
    const joint = jointMap[jointKey];
    const parentLink = linkMap[jointData.parentLinkId];
    const childLink = linkMap[jointData.childLinkId];
    if (!joint || !parentLink || !childLink) {
      continue;
    }

    parentLink.add(joint);
    joint.add(childLink);
    (joint as URDFJoint & { child?: URDFLink; parentLink?: URDFLink }).child = childLink;
    (joint as URDFJoint & { child?: URDFLink; parentLink?: URDFLink }).parentLink = parentLink;
    await yieldIfNeeded();
  }

  const childLinkIds = new Set(Object.values(joints).map((joint) => joint.childLinkId));
  const rootCandidates: string[] = [];
  if (rootLinkId && linkMap[rootLinkId]) {
    rootCandidates.push(rootLinkId);
  }

  Object.keys(linkMap).forEach((linkKey) => {
    if (!childLinkIds.has(linkKey) && !rootCandidates.includes(linkKey)) {
      rootCandidates.push(linkKey);
    }
  });

  rootCandidates.forEach((linkKey) => {
    const link = linkMap[linkKey];
    if (link && link.parent !== robot) {
      robot.add(link);
    }
  });

  Object.values(jointMap).forEach((joint) => {
    if (joint instanceof URDFMimicJoint && joint.mimicJoint) {
      const mimickedJoint = jointMap[joint.mimicJoint];
      if (mimickedJoint) {
        mimickedJoint.mimicJoints.push(joint);
      }
    }
  });

  Object.values(jointMap).forEach((joint) => {
    const uniqueJoints = new Set<URDFJoint>();
    const walk = (currentJoint: URDFJoint) => {
      if (uniqueJoints.has(currentJoint)) {
        throw new Error('URDFLoader: Detected an infinite loop of mimic joints.');
      }

      uniqueJoints.add(currentJoint);
      currentJoint.mimicJoints.forEach((mimicJoint) => walk(mimicJoint));
    };

    walk(joint);
  });

  robot.links = linkMap;
  robot.joints = jointMap;
  robot.colliders = colliderMap;
  robot.visual = visualMap;
  robot.visuals = visualMap;
  robot.frames = {
    ...colliderMap,
    ...visualMap,
    ...linkMap,
    ...jointMap,
  };

  restackRobotVisualRoots(robot);
  return robot;
}
