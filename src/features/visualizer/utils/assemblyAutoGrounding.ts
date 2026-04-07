import { cloneAssemblyTransform } from '@/core/robot/assemblyTransforms';
import { getLowestMeshZ } from '@/shared/utils';
import type { AssemblyState, AssemblyTransform, RobotData } from '@/types';
import type * as THREE from 'three';
import { resolveAssemblyComponentTransformTarget } from './assemblyTransformControlsShared';
import {
  buildAssemblyComponentMeshLoadKeyMap,
  resolveReadyAssemblyMeshComponentIds,
} from './assemblyMeshLoadState';

export interface AssemblyAutoGroundAdjustment {
  componentId: string;
  transform: AssemblyTransform;
}

export interface AssemblyAutoGroundResolution {
  adjustments: AssemblyAutoGroundAdjustment[];
  measuredComponentIds: string[];
}

export interface AssemblyAutoGroundTrackingState {
  initialized: boolean;
  knownComponentIds: Set<string>;
  pendingComponentIds: Set<string>;
  settledMeshSignatureByComponentId: Map<string, string>;
}

interface ResolveAssemblyAutoGroundingOptions {
  robot: Pick<RobotData, 'joints'>;
  assemblyState: AssemblyState | null | undefined;
  jointPivots: Record<string, THREE.Group | null>;
  groundPlaneOffset: number;
  tolerance?: number;
  componentIds?: readonly string[] | null;
}

interface ResolveReadyAssemblyAutoGroundComponentIdsOptions {
  assemblyState: AssemblyState | null | undefined;
  pendingComponentIds: Iterable<string>;
  expectedMeshLoadKeys: readonly string[];
  resolvedMeshLoadKeys: ReadonlySet<string>;
}

function buildLiveAssemblyComponentIdSet(
  assemblyState: AssemblyState | null | undefined,
): Set<string> {
  return new Set(Object.keys(assemblyState?.components ?? {}));
}

export function createInitialAssemblyAutoGroundTrackingState(): AssemblyAutoGroundTrackingState {
  return {
    initialized: false,
    knownComponentIds: new Set<string>(),
    pendingComponentIds: new Set<string>(),
    settledMeshSignatureByComponentId: new Map<string, string>(),
  };
}

export function buildAssemblyAutoGroundMeshSignatureMap({
  assemblyState,
  meshLoadKeys,
}: {
  assemblyState: AssemblyState | null | undefined;
  meshLoadKeys: readonly string[];
}): Map<string, string> {
  const componentMeshSignatureMap = new Map<string, string>();

  if (!assemblyState) {
    return componentMeshSignatureMap;
  }

  const componentMeshLoadKeyMap = buildAssemblyComponentMeshLoadKeyMap({
    assemblyState,
    meshLoadKeys,
  });

  Object.values(assemblyState.components).forEach((component) => {
    if (component.visible === false) {
      return;
    }

    const componentMeshLoadKeys = componentMeshLoadKeyMap.get(component.id);
    if (!componentMeshLoadKeys || componentMeshLoadKeys.size === 0) {
      componentMeshSignatureMap.set(component.id, '');
      return;
    }

    componentMeshSignatureMap.set(
      component.id,
      Array.from(componentMeshLoadKeys).sort().join('\u0000'),
    );
  });

  return componentMeshSignatureMap;
}

export function resolveNextAssemblyAutoGroundTrackingState({
  previousState,
  assemblyState,
}: {
  previousState: AssemblyAutoGroundTrackingState;
  assemblyState: AssemblyState | null | undefined;
}): AssemblyAutoGroundTrackingState {
  if (!assemblyState) {
    return createInitialAssemblyAutoGroundTrackingState();
  }

  const liveComponentIds = buildLiveAssemblyComponentIdSet(assemblyState);

  if (!previousState.initialized) {
    return {
      initialized: true,
      knownComponentIds: liveComponentIds,
      pendingComponentIds: new Set<string>(),
      settledMeshSignatureByComponentId: new Map<string, string>(),
    };
  }

  const nextKnownComponentIds = new Set<string>();
  const nextPendingComponentIds = new Set<string>();
  const nextSettledMeshSignatureByComponentId = new Map<string, string>();

  previousState.knownComponentIds.forEach((componentId) => {
    if (liveComponentIds.has(componentId)) {
      nextKnownComponentIds.add(componentId);
    }
  });
  previousState.pendingComponentIds.forEach((componentId) => {
    if (liveComponentIds.has(componentId)) {
      nextPendingComponentIds.add(componentId);
    }
  });
  previousState.settledMeshSignatureByComponentId.forEach((meshSignature, componentId) => {
    if (liveComponentIds.has(componentId)) {
      nextSettledMeshSignatureByComponentId.set(componentId, meshSignature);
    }
  });

  liveComponentIds.forEach((componentId) => {
    if (!nextKnownComponentIds.has(componentId)) {
      nextKnownComponentIds.add(componentId);
      nextPendingComponentIds.add(componentId);
    }
  });

  return {
    initialized: true,
    knownComponentIds: nextKnownComponentIds,
    pendingComponentIds: nextPendingComponentIds,
    settledMeshSignatureByComponentId: nextSettledMeshSignatureByComponentId,
  };
}

export function resolveReadyAssemblyAutoGroundComponentIds({
  assemblyState,
  pendingComponentIds,
  expectedMeshLoadKeys,
  resolvedMeshLoadKeys,
}: ResolveReadyAssemblyAutoGroundComponentIdsOptions): string[] {
  if (!assemblyState) {
    return [];
  }

  const readyComponentIds = new Set(
    resolveReadyAssemblyMeshComponentIds({
      assemblyState,
      componentMeshLoadKeyMap: buildAssemblyComponentMeshLoadKeyMap({
        assemblyState,
        meshLoadKeys: expectedMeshLoadKeys,
      }),
      resolvedMeshLoadKeys,
    }),
  );

  return [...pendingComponentIds].filter((componentId) => readyComponentIds.has(componentId));
}

function measureComponentLowestPoint(target: THREE.Group): number | null {
  return (
    getLowestMeshZ(target, {
      includeInvisible: false,
      includeVisual: true,
      includeCollision: false,
    }) ??
    getLowestMeshZ(target, {
      includeInvisible: true,
      includeVisual: true,
      includeCollision: false,
    })
  );
}

export function resolveAssemblyAutoGrounding({
  robot,
  assemblyState,
  jointPivots,
  groundPlaneOffset,
  tolerance = 1e-3,
  componentIds = null,
}: ResolveAssemblyAutoGroundingOptions): AssemblyAutoGroundResolution {
  if (!assemblyState) {
    return {
      adjustments: [],
      measuredComponentIds: [],
    };
  }

  const requestedComponentIds = componentIds ? new Set(componentIds) : null;
  const adjustments: AssemblyAutoGroundAdjustment[] = [];
  const measuredComponentIds: string[] = [];

  Object.values(assemblyState.components).forEach((component) => {
    if (!component.visible) {
      return;
    }

    if (requestedComponentIds && !requestedComponentIds.has(component.id)) {
      return;
    }

    const target = resolveAssemblyComponentTransformTarget({
      robot,
      assemblyState,
      componentId: component.id,
      jointPivots,
    });

    if (!target || target.kind !== 'component' || !target.object) {
      return;
    }

    const lowestPoint = measureComponentLowestPoint(target.object);
    if (!Number.isFinite(lowestPoint)) {
      return;
    }

    measuredComponentIds.push(component.id);
    const deltaZ = groundPlaneOffset - Number(lowestPoint);
    if (Math.abs(deltaZ) <= tolerance) {
      return;
    }

    const nextTransform = cloneAssemblyTransform(component.transform);
    nextTransform.position.z += deltaZ;
    adjustments.push({
      componentId: component.id,
      transform: nextTransform,
    });
  });

  return {
    adjustments,
    measuredComponentIds,
  };
}
