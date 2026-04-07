import * as THREE from 'three';

import type { RobotState, UrdfJoint, UrdfLink, UrdfVisual } from '../../../types/index.ts';
import { getVisualGeometryEntries, resolveVisualMaterialOverride } from '@/core/robot';
import {
  buildColladaRootNormalizationHints,
  type ColladaRootNormalizationHints,
} from '../../../core/loaders/colladaRootNormalization.ts';
import {
  USD_GEOMETRY_TYPES as GEOMETRY_TYPES,
  buildUsdVisualSceneNode,
  getUsdGeometryType as getGeometryType,
  type UsdMaterialMetadata,
  type UsdMeshCompressionOptions,
} from './usdSceneNodeFactory.ts';
import { type UsdAssetRegistry } from './usdAssetRegistry.ts';
import { applyUsdMaterialMetadata } from './usdSceneSerialization.ts';
import { sanitizeUsdIdentifier } from './usdTextFormatting.ts';

export type BuildUsdLinkSceneRootOptions = {
  robot: RobotState;
  registry: UsdAssetRegistry;
  meshCompression?: UsdMeshCompressionOptions;
  colladaRootNormalizationHints?: ColladaRootNormalizationHints | null;
  onLinkVisit?: (link: UrdfLink) => void | Promise<void>;
};

const resolveLinkMaterialEntry = (
  robot: RobotState,
  link: UrdfLink,
  visual: UrdfVisual,
  options: { isPrimaryVisual: boolean },
): UsdMaterialMetadata => {
  const resolvedMaterial = resolveVisualMaterialOverride(robot, link, visual, {
    isPrimaryVisual: options.isPrimaryVisual,
  });

  if (resolvedMaterial.source === 'authored') {
    return {
      color: resolvedMaterial.color || undefined,
      texture: resolvedMaterial.texture || undefined,
    };
  }

  if (resolvedMaterial.source === 'legacy-link') {
    return {
      color:
        resolvedMaterial.color ||
        (resolvedMaterial.texture ? '#ffffff' : undefined) ||
        visual.color ||
        undefined,
      texture: resolvedMaterial.texture || undefined,
    };
  }

  return {
    color: visual.color || undefined,
  };
};

const rpyToQuaternion = (r: number, p: number, y: number): THREE.Quaternion => {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(r, p, y, 'ZYX'));
};

const createJointLocalMatrix = (joint: UrdfJoint): THREE.Matrix4 => {
  const originPosition = new THREE.Vector3(
    joint.origin?.xyz?.x ?? 0,
    joint.origin?.xyz?.y ?? 0,
    joint.origin?.xyz?.z ?? 0,
  );
  const originQuaternion = rpyToQuaternion(
    joint.origin?.rpy?.r ?? 0,
    joint.origin?.rpy?.p ?? 0,
    joint.origin?.rpy?.y ?? 0,
  );

  const originMatrix = new THREE.Matrix4().compose(
    originPosition,
    originQuaternion,
    new THREE.Vector3(1, 1, 1),
  );

  const motionMatrix = new THREE.Matrix4();
  const axis = new THREE.Vector3(joint.axis?.x ?? 1, joint.axis?.y ?? 0, joint.axis?.z ?? 0);
  if (axis.lengthSq() <= 1e-12) {
    axis.set(1, 0, 0);
  } else {
    axis.normalize();
  }

  const jointType = String(joint.type || '').toLowerCase();
  if (jointType === 'revolute' || jointType === 'continuous') {
    motionMatrix.makeRotationAxis(axis, typeof joint.angle === 'number' ? joint.angle : 0);
  } else if (jointType === 'prismatic') {
    motionMatrix.makeTranslation(
      axis.x * (typeof joint.angle === 'number' ? joint.angle : 0),
      axis.y * (typeof joint.angle === 'number' ? joint.angle : 0),
      axis.z * (typeof joint.angle === 'number' ? joint.angle : 0),
    );
  } else if ((jointType === 'ball' || jointType === 'floating') && joint.quaternion) {
    motionMatrix.makeRotationFromQuaternion(
      new THREE.Quaternion(
        joint.quaternion.x,
        joint.quaternion.y,
        joint.quaternion.z,
        joint.quaternion.w,
      ),
    );
  } else {
    motionMatrix.identity();
  }

  return originMatrix.multiply(motionMatrix);
};

const getCollisionVisuals = (link: UrdfLink): UrdfVisual[] => {
  return [
    ...(getGeometryType(link.collision?.type) === GEOMETRY_TYPES.NONE ? [] : [link.collision]),
    ...(link.collisionBodies || []).filter(
      (body) => getGeometryType(body.type) !== GEOMETRY_TYPES.NONE,
    ),
  ];
};

const buildChildIdsByParent = (robot: RobotState): Map<string, string[]> => {
  const childIdsByParent = new Map<string, string[]>();
  Object.values(robot.joints).forEach((joint) => {
    const children = childIdsByParent.get(joint.parentLinkId) || [];
    children.push(joint.childLinkId);
    childIdsByParent.set(joint.parentLinkId, children);
  });
  return childIdsByParent;
};

const buildJointsByChild = (robot: RobotState): Map<string, UrdfJoint> => {
  const jointsByChild = new Map<string, UrdfJoint>();
  Object.values(robot.joints).forEach((joint) => {
    jointsByChild.set(joint.childLinkId, joint);
  });
  return jointsByChild;
};

const buildLinkSceneNode = async (
  robot: RobotState,
  linkId: string,
  childIdsByParent: Map<string, string[]>,
  jointsByChild: Map<string, UrdfJoint>,
  registry: UsdAssetRegistry,
  meshCompression?: UsdMeshCompressionOptions,
  colladaRootNormalizationHints?: ColladaRootNormalizationHints | null,
  onLinkVisit?: (link: UrdfLink) => void | Promise<void>,
): Promise<THREE.Group> => {
  const link = robot.links[linkId];
  const group = new THREE.Group();
  group.name = sanitizeUsdIdentifier(linkId);

  if (!link) {
    return group;
  }

  group.userData.usdLink = {
    id: link.id,
    name: link.name,
  };
  await onLinkVisit?.(link);

  const visuals = getVisualGeometryEntries(link);
  if (visuals.length > 0) {
    const visualsScope = new THREE.Group();
    visualsScope.name = 'visuals';

    for (const [index, visualEntry] of visuals.entries()) {
      const visual = visualEntry.geometry;
      const materialState = resolveLinkMaterialEntry(robot, link, visual, {
        isPrimaryVisual: visualEntry.bodyIndex === null,
      });
      const visualNode = await buildUsdVisualSceneNode({
        visual,
        role: 'visual',
        registry,
        materialState,
        meshCompression,
        colladaRootNormalizationHints,
      });
      if (!visualNode) continue;
      visualNode.name = `visual_${index}`;
      if (materialState.color || materialState.texture) {
        applyUsdMaterialMetadata(visualNode, materialState);
      }
      visualsScope.add(visualNode);
    }

    if (visualsScope.children.length > 0) {
      group.add(visualsScope);
    }
  }

  const collisions = getCollisionVisuals(link);
  if (collisions.length > 0) {
    const collidersScope = new THREE.Group();
    collidersScope.name = 'collisions';

    for (const [index, collision] of collisions.entries()) {
      const collisionNode = await buildUsdVisualSceneNode({
        visual: collision,
        role: 'collision',
        registry,
        meshCompression,
        colladaRootNormalizationHints,
      });
      if (!collisionNode) continue;
      collisionNode.name = `collision_${index}`;
      collisionNode.userData.usdPurpose = 'guide';
      collisionNode.userData.usdCollision = true;
      if (getGeometryType(collision.type) === GEOMETRY_TYPES.MESH) {
        collisionNode.userData.usdMeshCollision = true;
      }
      collidersScope.add(collisionNode);
    }

    if (collidersScope.children.length > 0) {
      group.add(collidersScope);
    }
  }

  for (const childLinkId of childIdsByParent.get(linkId) || []) {
    const childNode = await buildLinkSceneNode(
      robot,
      childLinkId,
      childIdsByParent,
      jointsByChild,
      registry,
      meshCompression,
      colladaRootNormalizationHints,
      onLinkVisit,
    );

    const joint = jointsByChild.get(childLinkId);
    if (joint) {
      const jointMatrix = createJointLocalMatrix(joint);
      jointMatrix.decompose(childNode.position, childNode.quaternion, childNode.scale);
    }

    group.add(childNode);
  }

  return group;
};

export const buildUsdLinkSceneRoot = async ({
  robot,
  registry,
  meshCompression,
  colladaRootNormalizationHints,
  onLinkVisit,
}: BuildUsdLinkSceneRootOptions): Promise<THREE.Group> => {
  const resolvedHints =
    colladaRootNormalizationHints ?? buildColladaRootNormalizationHints(robot.links);
  return buildLinkSceneNode(
    robot,
    robot.rootLinkId,
    buildChildIdsByParent(robot),
    buildJointsByChild(robot),
    registry,
    meshCompression,
    resolvedHints,
    onLinkVisit,
  );
};
