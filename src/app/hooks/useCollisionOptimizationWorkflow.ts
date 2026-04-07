import { useCallback, useMemo } from 'react';
import { GeometryType } from '@/types';
import type { TranslationKeys } from '@/shared/i18n';
import type { AssemblyState, RobotData } from '@/types';
import type {
  CollisionOptimizationOperation,
  CollisionOptimizationSource,
  CollisionTargetRef,
} from '@/features/property-editor';
import { applyCollisionOptimizationOperationsToLinks } from '@/features/property-editor';

interface SelectionPayload {
  type: 'link';
  id: string;
  subType: 'collision';
  objectIndex?: number;
}

interface UseCollisionOptimizationWorkflowParams {
  assemblyState: AssemblyState | null;
  sidebarTab: string;
  robotName: string;
  robotLinks: RobotData['links'];
  robotJoints: RobotData['joints'];
  rootLinkId: string;
  robotMaterials: RobotData['materials'];
  setRobot: (data: RobotData) => void;
  updateComponentRobot: (
    componentId: string,
    partialRobot: Partial<RobotData>,
    options?: { skipHistory?: boolean; label?: string },
  ) => void;
  focusOn: (id: string) => void;
  pulseSelection: (selection: SelectionPayload) => void;
  setSelection: (selection: SelectionPayload) => void;
  showToast: (message: string, type?: 'info' | 'success') => void;
  t: TranslationKeys;
}

export function useCollisionOptimizationWorkflow({
  assemblyState,
  sidebarTab,
  robotName,
  robotLinks,
  robotJoints,
  rootLinkId,
  robotMaterials,
  setRobot,
  updateComponentRobot,
  focusOn,
  pulseSelection,
  setSelection,
  showToast,
  t,
}: UseCollisionOptimizationWorkflowParams) {
  const collisionOptimizationSource = useMemo<CollisionOptimizationSource>(() => {
    if (assemblyState && sidebarTab === 'workspace') {
      return {
        kind: 'assembly',
        assembly: assemblyState,
      };
    }

    return {
      kind: 'robot',
      robot: {
        name: robotName,
        links: robotLinks,
        joints: robotJoints,
        rootLinkId,
        materials: robotMaterials,
      },
    };
  }, [assemblyState, robotJoints, robotLinks, robotMaterials, robotName, rootLinkId, sidebarTab]);

  const handlePreviewCollisionOptimizationTarget = useCallback(
    (target: CollisionTargetRef) => {
      const nextSelection = {
        type: 'link' as const,
        id: target.linkId,
        subType: 'collision' as const,
        objectIndex: target.objectIndex,
      };

      setSelection(nextSelection);
      pulseSelection(nextSelection);
      focusOn(target.linkId);
    },
    [focusOn, pulseSelection, setSelection],
  );

  const handleApplyCollisionOptimization = useCallback(
    (operations: CollisionOptimizationOperation[]) => {
      if (operations.length === 0) {
        showToast(t.noCollisionOptimizationApplied, 'info');
        return;
      }

      if (assemblyState && sidebarTab === 'workspace') {
        const operationsByComponent = new Map<string, CollisionOptimizationOperation[]>();
        operations.forEach((operation) => {
          if (!operation.componentId) return;
          const bucket = operationsByComponent.get(operation.componentId) ?? [];
          bucket.push(operation);
          operationsByComponent.set(operation.componentId, bucket);
        });

        operationsByComponent.forEach((componentOperations, componentId) => {
          const component = assemblyState.components[componentId];
          if (!component) return;

          updateComponentRobot(componentId, {
            links: applyCollisionOptimizationOperationsToLinks(
              component.robot.links,
              componentOperations,
            ),
          });
        });
      } else {
        setRobot({
          name: robotName,
          links: applyCollisionOptimizationOperationsToLinks(robotLinks, operations),
          joints: robotJoints,
          rootLinkId,
          materials: robotMaterials,
        });
      }

      const meshConvertedCount = operations.filter((operation) =>
        operation.fromTypes.includes(GeometryType.MESH),
      ).length;
      const primitiveConvertedCount = operations.length - meshConvertedCount;

      const message = t.collisionOptimizationApplied
        .replace('{count}', String(operations.length))
        .replace('{meshCount}', String(meshConvertedCount))
        .replace('{primitiveCount}', String(primitiveConvertedCount));

      showToast(message, 'success');
    },
    [
      assemblyState,
      robotJoints,
      robotMaterials,
      robotName,
      rootLinkId,
      setRobot,
      showToast,
      sidebarTab,
      robotLinks,
      updateComponentRobot,
      t,
    ],
  );

  return {
    collisionOptimizationSource,
    handlePreviewCollisionOptimizationTarget,
    handleApplyCollisionOptimization,
  };
}
