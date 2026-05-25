/**
 * Robot Core Module
 * Provides robot data manipulation utilities
 */

// Constants
export * from './constants';

// Builders - Factory functions for creating robot components
export {
  generateId,
  generateLinkId,
  generateJointId,
  createLink,
  createAttachedChildLink,
  createJoint,
  createEmptyRobot,
  addChildToRobot,
  resolveDefaultChildJointOrigin,
  cloneLink,
  cloneJoint,
} from './builders';

// Validators - Data validation functions
export {
  validateLink,
  validateJoint,
  validateRobot,
  hasLinks,
  hasJoints,
  isRootLink,
  hasChildren,
  getParentJoint,
  getChildJoints,
} from './validators';

export type { ValidationError, ValidationResult } from './validators';

export {
  getPrimaryTreeRenderRootLinkId,
  getPrimaryTreeDisplayRootLinkId,
  getTreeRenderRootLinkIds,
  getTreeDisplayRootLinkIds,
  isTransparentDisplayLink,
  isSyntheticJointStageLink,
  isSyntheticWorldRoot,
} from './treeRoots';

// Collision body manipulation
export {
  appendCollisionBody,
  getCollisionGeometryByObjectIndex,
  getCollisionGeometryEntries,
  optimizeCylinderCollisionsToCapsules,
  removeCollisionGeometryByObjectIndex,
  updateCollisionGeometryByObjectIndex,
} from './collisionBodies';

export {
  getVisualGeometryEntries,
  getVisualGeometryByObjectIndex,
  removeVisualGeometryByObjectIndex,
  updateVisualGeometryByObjectIndex,
} from './visualBodies';
export {
  BOX_FACE_MATERIAL_ORDER,
  canEditGeometryBaseTexture,
  collectGeometryTexturePaths,
  getEffectiveGeometryAuthoredMaterials,
  getBoxFaceMaterialPalette,
  getGeometryAuthoredMaterials,
  getPreferredSingleMaterialFromBoxFacePalette,
  hasBoxFaceMaterialPalette,
  hasMultipleAuthoredMaterials,
  resolveVisualMaterialOverride,
  updateVisualAuthoredMaterialByObjectIndex,
  updateVisualBaseTextureByObjectIndex,
} from './visualMaterials';
export type { BoxFaceMaterialEntry, BoxFaceMaterialName } from './visualMaterials';
export {
  applyMeshMaterialPaintEdit,
  getGeometryMeshMaterialGroups,
  getGeometryMeshMaterialGroupsForMesh,
  hasGeometryMeshMaterialGroups,
  normalizeGeometryAuthoredMaterials,
} from './visualMeshMaterialGroups';

export { resolveJointKey, resolveLinkKey } from './identity';

export {
  computeLinkWorldMatrices,
  extractJointActualAngleFromQuaternion,
  extractJointMotionAngleFromQuaternion,
  extractSignedAngleAroundAxis,
  getJointActualAngleFromMotionAngle,
  getJointMotionPose,
  getJointMotionAngleFromActualAngle,
  getJointReferencePosition,
  getNormalizedJointAxis,
  getChildJointsByParentLink,
  getParentJointByChildLink,
} from './kinematics';

export { resolveMimicJointAngleTargets } from './mimic';
export {
  clampJointInteractionValue,
  normalizeJointInteractionLimits,
} from './jointInteractionLimits.js';
export {
  HARD_PASSIVE_SPRING_STIFFNESS_THRESHOLD,
  PASSIVE_SPRING_EFFORT_EPSILON,
  isHardPassiveSpringJoint,
  isPassiveSpringJoint,
  isUnactuatedJoint,
  resolveMjcfPassiveSpringJointMetadata,
} from './passiveSpringJoints';

export {
  createRobotClosedLoopConstraint,
  createRobotDistanceClosedLoopConstraint,
  solveClosedLoopMotionCompensation,
  resolveClosedLoopDrivenJointMotion,
  resolveClosedLoopJointMotionCompensation,
  resolveClosedLoopJointAngleCompensation,
  resolveClosedLoopJointOriginCompensation,
  resolveClosedLoopJointOriginCompensationDetailed,
} from './closedLoops';

// Assembly Merger - Merge AssemblyState to RobotData
export { mergeAssembly } from './assemblyMerger';
export { analyzeAssemblyConnectivity } from './assemblyConnectivity';
export {
  buildAssemblyComponentIdentity,
  createUniqueAssemblyComponentName,
  namespaceAssemblyRobotData,
  prepareAssemblyRobotData,
  sanitizeAssemblyComponentId,
} from './assemblyComponentPreparation';
export {
  buildDefaultAssemblyComponentPlacementTransform,
  estimateLinkCollisionBounds,
  estimateLinkRenderableBounds,
  estimateLinkVisualBounds,
  estimateRobotGroundOffset,
  resolveLinkRenderableBounds,
} from './assemblyPlacement';

export {
  resolveDirectManipulableLinkIkDescriptor,
  resolveDirectManipulableLinkIkJointIds,
  resolveLinkIkHandleDescriptor,
  resolveLinkIkHandleDescriptors,
  resolveSelectableIkHandleLinkId,
  solveLinkIkPositionTarget,
} from './linkIk';
export type {
  LinkIkHandleDescriptor,
  LinkIkHandleAnchorSource,
  LinkIkPositionSolveRequest,
  LinkIkPositionSolveResult,
  LinkIkSolveFailureReason,
} from './linkIk';

// Transforms - Coordinate transformation utilities
export {
  zeroVector,
  zeroEuler,
  addVectors,
  subtractVectors,
  scaleVector,
  vectorMagnitude,
  normalizeVector,
  dotProduct,
  crossProduct,
  distance,
  degToRad,
  radToDeg,
  clamp,
  lerp,
  lerpVector,
  vectorsEqual,
  eulersEqual,
  eulerToRotationMatrix,
  rotateVector,
  rotateVectorAroundAxis,
  transformPoint,
  inverseTransformPoint,
  formatNumber,
  formatVector,
  formatEuler,
} from './transforms';

export { buildDeletionPlan, applyDeletionPlan, type DeletionPlan } from './treeOperations';
