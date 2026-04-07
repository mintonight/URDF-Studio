import React, { memo, useState, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Html, Line } from '@react-three/drei';
import { type AppMode, RobotState, UrdfJoint } from '@/types';
import type { ColladaRootNormalizationHints } from '@/core/loaders/colladaRootNormalization';
import { getJointMotionPose } from '@/core/robot';
import { useSelectionStore } from '@/store/selectionStore';
import { ThickerAxes, JointAxesVisual } from '@/shared/components/3d';
import { useSnapshotRenderActive } from '@/shared/components/3d/scene/SnapshotRenderContext';
import { Language } from '@/shared/i18n';
import {
  getMjcfJointDisplayName,
  getMjcfLinkDisplayName,
} from '@/shared/utils/robot/mjcfDisplayNames';
import { RobotNode } from './RobotNode';
import {
  createVisualizerHoverUserData,
  resolveVisualizerInteractionTargetFromHits,
  type VisualizerHoverTarget,
} from '../../utils/hoverPicking';
import type { VisualizerInteractiveLayer } from '../../utils/interactiveLayerPriority';
import { resolveMergedVisualizerJointPresentation } from '../../utils/mergedVisualizerSceneMode';

// Type definitions
interface CommonVisualizerProps {
  robot: RobotState;
  childJointsByParent: Record<string, UrdfJoint[]>;
  onSelect: (
    type: 'link' | 'joint',
    id: string,
    subType?: 'visual' | 'collision',
    helperKind?: VisualizerHoverTarget['helperKind'],
  ) => void;
  onUpdate: (type: 'link' | 'joint', id: string, data: any) => void;
  mode: AppMode;
  showGeometry: boolean;
  showVisual: boolean;
  showIkHandles: boolean;
  selectionTarget?: 'visual' | 'collision';
  showOrigin: boolean;
  showLabels: boolean;
  showJointAxes: boolean;
  jointAxisSize: number;
  frameSize: number;
  labelScale: number;
  showCollision: boolean;
  modelOpacity: number;
  showInertia: boolean;
  showCenterOfMass: boolean;
  interactionLayerPriority: readonly VisualizerInteractiveLayer[];
  transformMode: 'translate' | 'rotate';
  assets: Record<string, string>;
  lang: Language;
  colladaRootNormalizationHints?: ColladaRootNormalizationHints | null;
  collisionRevealComponentIdByLinkId?: ReadonlyMap<string, string>;
  collisionRevealComponentId?: string;
  revealedCollisionComponentIds?: ReadonlySet<string>;
  prewarmedCollisionMeshLoadKeys?: ReadonlySet<string>;
  readyCollisionMeshLoadKeys?: ReadonlySet<string>;
  onRegisterJointPivot?: (jointId: string, pivot: THREE.Group | null) => void;
  onRegisterJointMotion?: (jointId: string, motion: THREE.Group | null) => void;
  onRegisterCollisionRef?: (linkId: string, objectIndex: number, ref: THREE.Group | null) => void;
  onRegisterIkHandle?: (linkId: string, handle: THREE.Object3D | null) => void;
  onMeshResolved?: (meshLoadKey: string) => void;
  onPrewarmedMeshResolved?: (meshLoadKey: string) => void;
}

interface JointNodeProps extends CommonVisualizerProps {
  joint: UrdfJoint;
  depth: number;
  key?: React.Key;
  onRegisterJointPivot?: (jointId: string, pivot: THREE.Group | null) => void;
  onRegisterJointMotion?: (jointId: string, motion: THREE.Group | null) => void;
}

type JointNodeComponentProps = JointNodeProps & {
  onRegisterCollisionRef?: (linkId: string, objectIndex: number, ref: THREE.Group | null) => void;
};

/**
 * JointNode - Renders a joint in the robot hierarchy
 *
 * Features:
 * - Displays joint origin, axes, and labels
 * - Manages joint pivot for TransformControls
 * - Recursively renders child link via RobotNode
 * - Uses unified scene display toggles while runtime mode still drives
 *   interaction-specific branches such as transform behavior
 */
export const JointNode = memo<JointNodeComponentProps>(function JointNode({
  joint,
  robot,
  childJointsByParent,
  onSelect,
  onUpdate,
  mode,
  showGeometry,
  showVisual,
  showIkHandles,
  showOrigin,
  showLabels,
  showJointAxes,
  jointAxisSize,
  frameSize,
  labelScale,
  showCollision,
  modelOpacity,
  showInertia,
  showCenterOfMass,
  interactionLayerPriority,
  transformMode,
  depth,
  assets,
  lang,
  colladaRootNormalizationHints,
  collisionRevealComponentIdByLinkId,
  collisionRevealComponentId,
  revealedCollisionComponentIds,
  prewarmedCollisionMeshLoadKeys,
  readyCollisionMeshLoadKeys,
  onRegisterJointPivot,
  onRegisterJointMotion,
  onRegisterCollisionRef,
  onRegisterIkHandle,
  onMeshResolved,
  onPrewarmedMeshResolved,
}: JointNodeComponentProps) {
  if (depth > 50) return null;

  const isSelected = robot.selection.type === 'joint' && robot.selection.id === joint.id;

  const { x, y, z } = joint.origin.xyz;
  const { r, p, y: yaw } = joint.origin.rpy;
  const snapshotRenderActive = useSnapshotRenderActive();
  const sourceFormat = robot.inspectionContext?.sourceFormat;
  const parentLink = robot.links[joint.parentLinkId];
  const childLink = robot.links[joint.childLinkId];
  const parentLinkDisplayName =
    sourceFormat === 'mjcf'
      ? parentLink
        ? getMjcfLinkDisplayName(parentLink)
        : joint.parentLinkId
      : parentLink?.name || joint.parentLinkId;
  const childLinkDisplayName =
    sourceFormat === 'mjcf'
      ? childLink
        ? getMjcfLinkDisplayName(childLink)
        : joint.childLinkId
      : childLink?.name || joint.childLinkId;
  const jointDisplayName =
    sourceFormat === 'mjcf'
      ? getMjcfJointDisplayName(joint, parentLinkDisplayName, childLinkDisplayName)
      : joint.name || joint.id;

  // URDF stores roll/pitch/yaw values that should be composed in ZYX order.
  const jointRotation = new THREE.Euler(r, p, yaw, 'ZYX');
  const jointMotionPose = getJointMotionPose(joint);
  const effectiveShowOrigin = showOrigin && !snapshotRenderActive;
  const effectiveShowJointAxes = showJointAxes && !snapshotRenderActive;
  const showAxes = effectiveShowOrigin;
  const showJointLabel = showLabels;

  // Joint pivot: represents joint origin in parent-local space
  // TransformControls attaches to this, modifying its position in parent-local frame
  const [jointPivot, setJointPivot] = useState<THREE.Group | null>(null);
  const [jointMotionGroup, setJointMotionGroup] = useState<THREE.Group | null>(null);
  // Joint group: contains visualization, positioned at [0,0,0] relative to pivot
  const [, setJointGroup] = useState<THREE.Group | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const hoverFrozen = useSelectionStore((state) => state.hoverFrozen);
  const setHoveredSelection = useSelectionStore((state) => state.setHoveredSelection);
  const isStoreHovered = useSelectionStore(
    (state) => state.hoveredSelection.type === 'joint' && state.hoveredSelection.id === joint.id,
  );
  const isHelperHovered = useSelectionStore(
    (state) =>
      state.hoveredSelection.type === 'joint' &&
      state.hoveredSelection.id === joint.id &&
      state.hoveredSelection.subType === undefined &&
      state.hoveredSelection.objectIndex === undefined,
  );
  const jointHoverTarget = useMemo<VisualizerHoverTarget>(
    () => ({ type: 'joint', id: joint.id }),
    [joint.id],
  );
  const jointHelperLayer: VisualizerInteractiveLayer = effectiveShowJointAxes
    ? 'joint-axis'
    : 'origin-axes';
  const jointHelperHoverTarget = useMemo<VisualizerHoverTarget>(
    () => ({ type: 'joint', id: joint.id, helperKind: jointHelperLayer }),
    [joint.id, jointHelperLayer],
  );
  const jointHoverUserData = useMemo(
    () => createVisualizerHoverUserData(jointHelperHoverTarget, jointHelperLayer),
    [jointHelperHoverTarget, jointHelperLayer],
  );

  // Register pivot with parent Visualizer component
  useEffect(() => {
    if (onRegisterJointPivot) {
      onRegisterJointPivot(joint.id, jointPivot);
    }
    return () => {
      if (onRegisterJointPivot) {
        onRegisterJointPivot(joint.id, null);
      }
    };
  }, [jointPivot, joint.id, onRegisterJointPivot]);

  useEffect(() => {
    if (onRegisterJointMotion) {
      onRegisterJointMotion(joint.id, jointMotionGroup);
    }
    return () => {
      if (onRegisterJointMotion) {
        onRegisterJointMotion(joint.id, null);
      }
    };
  }, [joint.id, jointMotionGroup, onRegisterJointMotion]);

  useEffect(() => {
    if (hoverFrozen) {
      setIsHovered(false);
    }
  }, [hoverFrozen]);

  const clearJointHover = () => {
    const hovered = useSelectionStore.getState().hoveredSelection;
    if (
      hovered.type === 'joint' &&
      hovered.id === joint.id &&
      hovered.subType === undefined &&
      hovered.objectIndex === undefined
    ) {
      useSelectionStore.getState().clearHover();
    }
  };

  const handleJointClick = (event: any, resolvedTarget?: VisualizerHoverTarget | null) => {
    event.stopPropagation();
    if (resolvedTarget?.type === 'link') {
      onSelect('link', resolvedTarget.id, resolvedTarget.subType, resolvedTarget.helperKind);
      return;
    }
    onSelect('joint', resolvedTarget?.id ?? joint.id, undefined, resolvedTarget?.helperKind);
  };

  const handleHelperClick = (event: any) => {
    const resolvedTarget = resolveVisualizerInteractionTargetFromHits(
      event.object ?? null,
      event.intersections ?? [],
      {
        interactionLayerPriority,
      },
    );
    handleJointClick(event, resolvedTarget);
  };

  const handleHelperPointerDown = (event: any) => {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }
    handleHelperClick(event);
  };

  const handleHelperPointerOver = (event: any) => {
    if (hoverFrozen || event.buttons !== 0) {
      return;
    }
    event.stopPropagation();
    const resolvedTarget = resolveVisualizerInteractionTargetFromHits(
      event.object ?? null,
      event.intersections ?? [],
      {
        interactionLayerPriority,
      },
    );
    setHoveredSelection(resolvedTarget ?? jointHelperHoverTarget);
  };

  const handleHelperPointerOut = (event: any) => {
    event.stopPropagation();
    clearJointHover();
  };
  const jointPresentation = resolveMergedVisualizerJointPresentation({
    mode,
    showGeometry,
    showJointLabel,
    showOrigin: effectiveShowOrigin,
    showJointAxes: effectiveShowJointAxes,
  });

  const helperSphereOpacity = isSelected ? 0.96 : isHelperHovered || isStoreHovered ? 0.64 : 0.24;
  const helperSphereColor = isSelected
    ? '#f59e0b'
    : isHelperHovered || isStoreHovered
      ? '#fb923c'
      : '#fdba74';

  return (
    <group>
      {/* Connecting line follows the merged detail-style joint presentation. */}
      {(Math.abs(x) > 0.001 || Math.abs(y) > 0.001 || Math.abs(z) > 0.001) && (
        <>
          {jointPresentation.showConnectorLine && (
            <Line
              points={[
                [0, 0, 0],
                [x, y, z],
              ]}
              color={isSelected ? '#fbbf24' : '#64748b'}
              lineWidth={1}
              dashed={jointPresentation.connectorDashed}
              dashSize={jointPresentation.connectorDashed ? 0.02 : undefined}
              gapSize={jointPresentation.connectorDashed ? 0.01 : undefined}
            />
          )}
        </>
      )}

      {/* Joint pivot: represents joint origin in parent-local space */}
      {/* TransformControls attaches here, modifies position in parent-local frame */}
      <group ref={setJointPivot} position={[x, y, z]} rotation={jointRotation}>
        <group
          ref={setJointMotionGroup}
          position={jointMotionPose.position}
          quaternion={jointMotionPose.quaternion}
        >
          {/* Joint group: at origin relative to joint motion, contains visualization and child link */}
          <group ref={setJointGroup} position={[0, 0, 0]} rotation={[0, 0, 0]}>
            {showAxes && (
              <group
                userData={{ isHelper: true, ...jointHoverUserData }}
                onPointerDown={handleHelperPointerDown}
                onPointerOver={handleHelperPointerOver}
                onPointerOut={handleHelperPointerOut}
              >
                <ThickerAxes
                  size={frameSize}
                  interactive
                  hovered={isHelperHovered}
                  selected={isSelected}
                />
              </group>
            )}

            {(showJointLabel || (effectiveShowJointAxes && joint.type !== 'fixed')) && (
              <group>
                {showJointLabel && (
                  <Html
                    center
                    position={[0, 0, 0]}
                    distanceFactor={1.5}
                    className="pointer-events-none"
                    zIndexRange={[0, 0]}
                  >
                    <div
                      style={{
                        transform: `scale(${labelScale})`,
                        transformOrigin: 'center center',
                      }}
                      className="pointer-events-auto cursor-pointer select-none"
                      onMouseEnter={() => {
                        if (!hoverFrozen) {
                          setIsHovered(true);
                          setHoveredSelection(jointHoverTarget);
                        }
                      }}
                      onMouseLeave={() => {
                        setIsHovered(false);
                        clearJointHover();
                      }}
                      onClick={handleJointClick}
                    >
                      {isSelected || isHovered || isStoreHovered ? (
                        <div
                          className={`
                          px-1 py-px text-[8px] font-mono rounded border whitespace-nowrap shadow-xl transition-colors
                          ${
                            isSelected
                              ? 'bg-blue-600 text-white border-blue-400 z-50'
                              : 'bg-white/90 dark:bg-[#1C1C1E] text-orange-700 dark:text-orange-200 border-orange-200 dark:border-[#000000] hover:bg-orange-50 dark:hover:bg-[#3A3A3C]'
                          }
                        `}
                        >
                          {jointDisplayName}
                        </div>
                      ) : (
                        <div className="w-2 h-2 rounded-full bg-orange-400/80 hover:scale-150 transition-transform" />
                      )}
                    </div>
                  </Html>
                )}
                {effectiveShowJointAxes && joint.type !== 'fixed' && (
                  <group
                    userData={{ isHelper: true, ...jointHoverUserData }}
                    onPointerDown={handleHelperPointerDown}
                    onPointerOver={handleHelperPointerOver}
                    onPointerOut={handleHelperPointerOut}
                  >
                    <JointAxesVisual
                      joint={joint}
                      scale={jointAxisSize / 0.35}
                      hovered={isHelperHovered}
                      selected={isSelected}
                    />
                  </group>
                )}
              </group>
            )}

            {jointPresentation.showHelperSphere && (
              <group
                userData={{ isHelper: true, ...jointHoverUserData }}
                onPointerDown={handleHelperPointerDown}
                onPointerOver={handleHelperPointerOver}
                onPointerOut={handleHelperPointerOut}
              >
                <mesh renderOrder={10020}>
                  <sphereGeometry args={[0.014, 16, 16]} />
                  <meshBasicMaterial
                    color={helperSphereColor}
                    opacity={helperSphereOpacity}
                    transparent
                    depthWrite={false}
                    depthTest={false}
                  />
                </mesh>
              </group>
            )}

            <RobotNode
              linkId={joint.childLinkId}
              robot={robot}
              childJointsByParent={childJointsByParent}
              onSelect={onSelect}
              onUpdate={onUpdate}
              mode={mode}
              showGeometry={showGeometry}
              showVisual={showVisual}
              showIkHandles={showIkHandles}
              showOrigin={effectiveShowOrigin}
              showLabels={showLabels}
              showJointAxes={effectiveShowJointAxes}
              jointAxisSize={jointAxisSize}
              frameSize={frameSize}
              labelScale={labelScale}
              showCollision={showCollision}
              modelOpacity={modelOpacity}
              showInertia={showInertia}
              showCenterOfMass={showCenterOfMass}
              interactionLayerPriority={interactionLayerPriority}
              transformMode={transformMode}
              depth={depth + 1}
              assets={assets}
              lang={lang}
              colladaRootNormalizationHints={colladaRootNormalizationHints}
              collisionRevealComponentIdByLinkId={collisionRevealComponentIdByLinkId}
              collisionRevealComponentId={collisionRevealComponentId}
              revealedCollisionComponentIds={revealedCollisionComponentIds}
              prewarmedCollisionMeshLoadKeys={prewarmedCollisionMeshLoadKeys}
              readyCollisionMeshLoadKeys={readyCollisionMeshLoadKeys}
              onRegisterJointPivot={onRegisterJointPivot}
              onRegisterJointMotion={onRegisterJointMotion}
              onRegisterCollisionRef={onRegisterCollisionRef}
              onRegisterIkHandle={onRegisterIkHandle}
              onMeshResolved={onMeshResolved}
              onPrewarmedMeshResolved={onPrewarmedMeshResolved}
            />
          </group>
        </group>
      </group>
    </group>
  );
});
