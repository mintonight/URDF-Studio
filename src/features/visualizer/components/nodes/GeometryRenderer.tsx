import { Suspense, memo, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { type AppMode, GeometryType, UrdfLink, UrdfVisual } from '@/types';
import { MeshAssetNode } from '@/shared/components/3d';
import { useSnapshotRenderActive } from '@/shared/components/3d/scene/SnapshotRenderContext';
import { useSelectionStore } from '@/store/selectionStore';
import { DEFAULT_VISUAL_COLOR } from '@/core/robot/constants';
import {
  buildMaterialCacheKey,
  getCachedMaterial,
  releaseCachedMaterial,
  retainCachedMaterial,
} from '../../utils/materialCache';
import {
  createVisualizerHoverUserData,
  findNearestVisualizerTargetFromHits,
  type VisualizerHoverTarget,
} from '../../utils/hoverPicking';
import {
  createGeometryHoverTargetSelection,
  matchesGeometryHoverSelection,
  resolveGeometryHoverTargetFromHits,
} from '../../utils/geometryHover';
import {
  shouldNormalizeColladaGeometry,
  type ColladaRootNormalizationHints,
} from '@/core/loaders/colladaRootNormalization';
import { resolveGeometryVisibilityState } from './geometryVisibility';
import { resolveVisualizerMaterialOpacity } from '../../utils/materialOpacity';
import { buildVisualizerMeshLoadKey } from '../../utils/visualizerMeshLoading';
import type { VisualizerInteractiveLayer } from '../../utils/interactiveLayerPriority';

interface GeometryRendererProps {
  isCollision: boolean;
  link: UrdfLink;
  mode: AppMode;
  showGeometry: boolean;
  showCollision: boolean;
  modelOpacity: number;
  interactionLayerPriority: readonly VisualizerInteractiveLayer[];
  assets: Record<string, string>;
  isSelected: boolean;
  selectionSubType?: 'visual' | 'collision';
  onLinkClick: (event: ThreeEvent<MouseEvent>, target?: VisualizerHoverTarget | null) => void;
  setVisualRef?: (ref: THREE.Group | null) => void;
  setCollisionRef?: (ref: THREE.Group | null) => void;
  geometryData?: UrdfVisual;
  geometryId?: string;
  objectIndex?: number;
  colladaRootNormalizationHints?: ColladaRootNormalizationHints | null;
  collisionRevealComponentId?: string;
  revealedCollisionComponentIds?: ReadonlySet<string>;
  prewarmedCollisionMeshLoadKeys?: ReadonlySet<string>;
  readyCollisionMeshLoadKeys?: ReadonlySet<string>;
  onMeshResolved?: (meshLoadKey: string) => void;
  onPrewarmedMeshResolved?: (meshLoadKey: string) => void;
}

interface ActiveGeometryRendererProps extends GeometryRendererProps {
  data: UrdfVisual;
  isPrewarmedHiddenCollision: boolean;
  meshLoadKey: string | null;
  visibilityState: ReturnType<typeof resolveGeometryVisibilityState>;
}

export function shouldGeometryCastShadows(isCollision: boolean): boolean {
  return !isCollision;
}

/**
 * GeometryRenderer - Renders visual or collision geometry for a link
 * Handles different geometry types: Box, Cylinder, Sphere/Ellipsoid, Capsule,
 * and Mesh (STL/OBJ/DAE)
 */
export const GeometryRenderer = memo<GeometryRendererProps>(function GeometryRenderer({
  isCollision,
  link,
  mode,
  showGeometry,
  showCollision,
  modelOpacity,
  geometryData,
  geometryId,
  objectIndex,
  prewarmedCollisionMeshLoadKeys,
  readyCollisionMeshLoadKeys,
  ...props
}: GeometryRendererProps) {
  const data = geometryData || (isCollision ? link.collision : link.visual);
  const meshLoadKey =
    data?.type === GeometryType.MESH && data.meshPath
      ? buildVisualizerMeshLoadKey({
          linkId: link.id,
          geometryRole: isCollision ? 'collision' : 'visual',
          geometryId: geometryId || 'primary',
          objectIndex: objectIndex ?? 0,
          meshPath: data.meshPath,
        })
      : null;
  const isPrewarmedHiddenCollision = Boolean(
    isCollision &&
    !showCollision &&
    meshLoadKey &&
    prewarmedCollisionMeshLoadKeys?.has(meshLoadKey),
  );
  const isDeferredVisibleCollisionMesh = Boolean(
    isCollision &&
    showCollision &&
    meshLoadKey &&
    readyCollisionMeshLoadKeys &&
    !readyCollisionMeshLoadKeys.has(meshLoadKey),
  );
  const visibilityState = isPrewarmedHiddenCollision
    ? {
        shouldRender: true,
        visible: false,
        interactive: false,
      }
    : isDeferredVisibleCollisionMesh
      ? {
          shouldRender: false,
          visible: false,
          interactive: false,
        }
      : resolveGeometryVisibilityState({
          mode,
          isCollision,
          showGeometry,
          showCollision,
        });

  if (!data) return null;
  if (data.visible === false) return null;
  if (!visibilityState.shouldRender) return null;
  if (link.visible === false) {
    return null;
  }
  if (data.type === GeometryType.NONE) return null;

  return (
    <ActiveGeometryRenderer
      {...props}
      isCollision={isCollision}
      link={link}
      mode={mode}
      showGeometry={showGeometry}
      showCollision={showCollision}
      modelOpacity={modelOpacity}
      geometryData={geometryData}
      data={data}
      isPrewarmedHiddenCollision={isPrewarmedHiddenCollision}
      meshLoadKey={meshLoadKey}
      visibilityState={visibilityState}
    />
  );
});

const ActiveGeometryRenderer = memo<ActiveGeometryRendererProps>(function ActiveGeometryRenderer({
  isCollision,
  link,
  mode,
  showGeometry,
  showCollision,
  modelOpacity,
  interactionLayerPriority,
  assets,
  isSelected,
  selectionSubType,
  onLinkClick,
  setVisualRef,
  setCollisionRef,
  geometryData,
  geometryId,
  objectIndex,
  colladaRootNormalizationHints,
  onMeshResolved,
  onPrewarmedMeshResolved,
  data,
  isPrewarmedHiddenCollision,
  meshLoadKey,
  visibilityState,
}: ActiveGeometryRendererProps) {
  const { type, dimensions, color, origin, meshPath } = data;
  // Keep Visualizer origin handling aligned with URDF/Viewer quaternion conversion.
  const originRotation = origin
    ? new THREE.Euler(origin.rpy.r, origin.rpy.p, origin.rpy.y, 'ZYX')
    : undefined;

  // Material cache key: includes all visual properties. Dimensions are intentionally excluded
  // because they don't affect material appearance (they're applied to geometry args instead).
  const geometryKey = `${isCollision ? 'col' : 'vis'}-${geometryId || 'primary'}-${type}-${meshPath || 'none'}`;
  // Group key: only changes when geometry TYPE or MESH PATH changes (requiring full remount).
  // Dimension changes are handled in-place by R3F and must NOT change this key, otherwise
  // React unmounts/remounts the group on every +/- press causing a one-frame blank flicker.
  const groupKey = geometryKey;

  // The merged workspace now renders visualizer geometry with the same
  // material treatment across scenes instead of keeping a ghost skeleton look.
  const useLegacySkeletonVisualStyle = false;
  const geometrySubType = isCollision ? 'collision' : 'visual';
  const handleMeshResolved = useCallback(() => {
    if (!meshLoadKey) {
      return;
    }

    if (isPrewarmedHiddenCollision) {
      onPrewarmedMeshResolved?.(meshLoadKey);
    }
    onMeshResolved?.(meshLoadKey);
  }, [isPrewarmedHiddenCollision, meshLoadKey, onMeshResolved, onPrewarmedMeshResolved]);
  const snapshotRenderActive = useSnapshotRenderActive();
  const hoverTarget = useMemo(
    () => createGeometryHoverTargetSelection(link.id, geometrySubType, objectIndex),
    [geometrySubType, link.id, objectIndex],
  );
  const isHovered = useSelectionStore((state) => {
    return matchesGeometryHoverSelection(state.hoveredSelection, hoverTarget);
  });

  const setHoveredSelection = useSelectionStore((state) => state.setHoveredSelection);
  const clearGeometryHover = useCallback(() => {
    const hovered = useSelectionStore.getState().hoveredSelection;
    if (!matchesGeometryHoverSelection(hovered, hoverTarget, { allowLabelHoverFallback: false })) {
      return;
    }

    useSelectionStore.getState().clearHover();
  }, [hoverTarget]);

  // Interaction States
  const isVisualHighlight =
    !snapshotRenderActive &&
    !isCollision &&
    isSelected &&
    (selectionSubType === 'visual' || !selectionSubType);
  const isCollisionHighlight =
    !snapshotRenderActive && isCollision && isSelected && selectionSubType === 'collision';

  // Collision styling - Purple wireframe default
  const colColor = '#a855f7'; // Purple-500

  // Opacity: Higher if selected or hovered
  const effectiveHovered = snapshotRenderActive ? false : isHovered;

  const matOpacity = resolveVisualizerMaterialOpacity({
    isCollision,
    isHovered: effectiveHovered,
    isSelected: isCollision ? isCollisionHighlight : isVisualHighlight,
    modelOpacity,
  });

  // Wireframe: Fill if selected or hovered (for collision)
  const matWireframe = isCollision ? !isCollisionHighlight && !effectiveHovered : false;

  const baseColor = isCollision ? colColor : color || DEFAULT_VISUAL_COLOR;

  // Colors
  const selectionColorVisual = '#60a5fa'; // Blue-400
  const selectionColorCollision = '#d946ef'; // Fuchsia-500
  const hoverColorVisual = '#93c5fd'; // Blue-300 (Lighter)
  const hoverColorCollision = '#e879f9'; // Fuchsia-400 (Lighter)

  let finalColor = baseColor;
  if (isVisualHighlight) finalColor = selectionColorVisual;
  else if (isCollisionHighlight) finalColor = selectionColorCollision;
  else if (effectiveHovered) finalColor = isCollision ? hoverColorCollision : hoverColorVisual;

  // Emissive Logic
  let emissiveColor = '#000000';
  let emissiveIntensity = 0;

  if (isVisualHighlight) {
    emissiveColor = '#1e40af';
    emissiveIntensity = 0.5;
  } else if (isCollisionHighlight) {
    emissiveColor = '#86198f';
    emissiveIntensity = 0.5;
  } else if (effectiveHovered) {
    emissiveColor = isCollision ? '#d946ef' : '#3b82f6';
    emissiveIntensity = 0.3;
  }

  const materialOptions = useMemo(
    () => ({
      finalColor,
      matOpacity,
      matWireframe,
      isCollision,
      emissiveColor,
      emissiveIntensity,
    }),
    [emissiveColor, emissiveIntensity, finalColor, isCollision, matOpacity, matWireframe],
  );
  const materialKey = useMemo(() => buildMaterialCacheKey(materialOptions), [materialOptions]);
  const material = useMemo(() => getCachedMaterial(materialOptions), [materialOptions]);

  useEffect(() => {
    retainCachedMaterial(materialKey);
    return () => {
      releaseCachedMaterial(materialKey);
    };
  }, [materialKey]);

  // Use array format for position/rotation to avoid creating new objects
  const wrapperProps = {
    onClick: visibilityState.interactive
      ? (event: ThreeEvent<MouseEvent>) => {
          const nearestTarget = findNearestVisualizerTargetFromHits(event.intersections, {
            interactionLayerPriority,
          });
          onLinkClick(event, nearestTarget);
        }
      : undefined,
    // Keep direct geometry hover as a fallback when Html overlays intercept
    // canvas-level pointermove events after a link stays selected.
    onPointerOver: visibilityState.interactive
      ? (event: ThreeEvent<PointerEvent>) => {
          if (event.buttons !== 0) {
            return;
          }

          const resolvedHoverTarget = resolveGeometryHoverTargetFromHits(
            hoverTarget,
            event.intersections ?? [],
            {
              interactionLayerPriority,
            },
          );
          if (!resolvedHoverTarget) {
            return;
          }

          event.stopPropagation();
          setHoveredSelection(resolvedHoverTarget);
        }
      : undefined,
    onPointerOut: visibilityState.interactive
      ? (event: ThreeEvent<PointerEvent>) => {
          if (!isHovered) {
            return;
          }

          event.stopPropagation();
          clearGeometryHover();
        }
      : undefined,
    position: origin
      ? ([origin.xyz.x, origin.xyz.y, origin.xyz.z] as [number, number, number])
      : undefined,
    rotation: originRotation,
    ref: isPrewarmedHiddenCollision ? undefined : isCollision ? setCollisionRef : setVisualRef,
    visible: visibilityState.visible,
    userData: {
      geometryRole: isCollision ? 'collision' : 'visual',
      ...createVisualizerHoverUserData(
        {
          type: 'link',
          id: link.id,
          subType: geometrySubType,
          objectIndex: objectIndex ?? 0,
        },
        geometrySubType,
      ),
    },
  };
  const shadowEnabled = shouldGeometryCastShadows(isCollision);
  const shadowProps = { castShadow: shadowEnabled, receiveShadow: shadowEnabled };

  let geometryNode: ReactNode;
  const radialSegments = useLegacySkeletonVisualStyle ? 8 : 32;
  const boxSegments = useLegacySkeletonVisualStyle ? 1 : 2;
  // For cylinder, we need to rotate to align with Z-up
  let meshRotation: [number, number, number] = [0, 0, 0];

  // Three.js best practice (threejs-geometry skill): create geometry at unit size
  // and apply dimensions via mesh.scale. This avoids disposing + recreating
  // BufferGeometry objects on every dimension change, eliminating flicker when
  // the user continuously presses +/- to resize collision bodies.
  if (type === GeometryType.BOX) {
    // Unit box (1×1×1) scaled to target dimensions
    geometryNode = (
      <mesh scale={[dimensions.x, dimensions.y, dimensions.z]} {...shadowProps}>
        <boxGeometry args={[1, 1, 1, boxSegments, boxSegments, boxSegments]} />
        <primitive object={material} attach="material" />
      </mesh>
    );
  } else if (type === GeometryType.PLANE) {
    geometryNode = (
      <mesh scale={[dimensions.x || 1, dimensions.y || 1, 1]} {...shadowProps}>
        <planeGeometry args={[1, 1, boxSegments, boxSegments]} />
        <primitive object={material} attach="material" />
      </mesh>
    );
  } else if (type === GeometryType.CYLINDER) {
    // Unit cylinder (radius=1, height=1) scaled to target dimensions.
    // Rotated -90° around X to align with Z-up coordinate system.
    meshRotation = [-Math.PI / 2, 0, 0];
    // scale: X/Z = radius, Y = height
    geometryNode = (
      <mesh
        rotation={meshRotation}
        scale={[dimensions.x, dimensions.y, dimensions.z || dimensions.x]}
        {...shadowProps}
      >
        <cylinderGeometry args={[1, 1, 1, radialSegments, 1]} />
        <primitive object={material} attach="material" />
      </mesh>
    );
  } else if (type === GeometryType.SPHERE || type === GeometryType.ELLIPSOID) {
    // Unit sphere (radius=1) scaled per axis so sphere and MJCF ellipsoid
    // geometries can share the same render path.
    const sx = dimensions.x;
    const sy = dimensions.y || sx;
    const sz = dimensions.z || sx;
    geometryNode = (
      <mesh scale={[sx, sy, sz]} {...shadowProps}>
        <sphereGeometry args={[1, radialSegments, radialSegments]} />
        <primitive object={material} attach="material" />
      </mesh>
    );
  } else if (type === GeometryType.CAPSULE) {
    // Capsule shape depends on the radius-to-length ratio, so the geometry
    // topology changes with each resize — must recreate args. This is expected
    // for capsule but rare compared to box/sphere/cylinder.
    meshRotation = [-Math.PI / 2, 0, 0];
    const cylinderLength = Math.max(0, dimensions.y - 2 * dimensions.x);
    geometryNode = (
      <mesh rotation={meshRotation} {...shadowProps}>
        <capsuleGeometry
          args={[dimensions.x, cylinderLength, radialSegments / 2, radialSegments]}
        />
        <primitive object={material} attach="material" />
      </mesh>
    );
  } else if (type === GeometryType.MESH) {
    const preserveOriginalMaterial =
      !isCollision &&
      !useLegacySkeletonVisualStyle &&
      !isVisualHighlight &&
      !isCollisionHighlight &&
      !effectiveHovered &&
      !color &&
      modelOpacity >= 0.999;

    geometryNode = (
      <Suspense fallback={null}>
        <MeshAssetNode
          meshPath={meshPath}
          assets={assets}
          material={material}
          color={finalColor}
          enableShadows={!isCollision}
          scale={dimensions}
          normalizeRoot={shouldNormalizeColladaGeometry(
            meshPath,
            origin,
            colladaRootNormalizationHints,
          )}
          preserveOriginalMaterial={preserveOriginalMaterial}
          onResolved={handleMeshResolved}
          missingContent={
            <mesh {...shadowProps}>
              <boxGeometry args={[0.1, 0.1, 0.1]} />
              <meshStandardMaterial color={isCollision ? 'red' : 'gray'} wireframe />
            </mesh>
          }
          unknownContent={
            <mesh {...shadowProps}>
              <boxGeometry args={[0.1, 0.1, 0.1]} />
              <primitive object={material} attach="material" />
            </mesh>
          }
        />
      </Suspense>
    );
  }

  return (
    <group key={groupKey} {...wrapperProps}>
      {geometryNode}
    </group>
  );
});
