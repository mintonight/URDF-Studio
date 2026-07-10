import { useCallback } from 'react';

import {
  loadBridgeCreateModalModule,
  loadCollisionOptimizationDialogModule,
} from '@/app/utils/overlayLoaders';
import type {
  CommitResolvedRobotLoadOutcome,
  WorkspaceLoadIntent,
} from '@/app/utils/commitResolvedRobotLoad';
import type { BridgeJoint, RobotFile } from '@/types';

interface UseWorkspaceOverlayActionsTranslations {
  addedComponent: string;
  loadingRobot: string;
  preparingAssemblyComponent: string;
  addingAssemblyComponentToWorkspace: string;
  groundingAssemblyComponent: string;
}

interface UseWorkspaceOverlayActionsParams {
  onLoadRobot: (
    file: RobotFile,
    options?: { intent?: WorkspaceLoadIntent },
  ) => Promise<CommitResolvedRobotLoadOutcome | null> | CommitResolvedRobotLoadOutcome | null;
  showAssemblyComponentPreparationOverlay: (
    file: RobotFile,
    stage: 'prepare' | 'add' | 'ground',
  ) => void;
  clearAssemblyComponentPreparationOverlay: () => void;
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  t: UseWorkspaceOverlayActionsTranslations;
  setBridgePreview: (value: BridgeJoint | null) => void;
  setShouldRenderBridgeModal: (value: boolean) => void;
  setIsBridgeModalOpen: (value: boolean) => void;
  addBridge: (params: {
    name: string;
    parentComponentId: string;
    parentLinkId: string;
    childComponentId: string;
    childLinkId: string;
    joint: Partial<import('@/types').UrdfJoint>;
  }) => unknown;
  setIsCollisionOptimizerOpen: (value: boolean) => void;
}

export function useWorkspaceOverlayActions({
  onLoadRobot,
  showAssemblyComponentPreparationOverlay,
  clearAssemblyComponentPreparationOverlay,
  showToast,
  t,
  setBridgePreview,
  setShouldRenderBridgeModal,
  setIsBridgeModalOpen,
  addBridge,
  setIsCollisionOptimizerOpen,
}: UseWorkspaceOverlayActionsParams) {
  const handleAddComponent = useCallback(
    (file: RobotFile) => {
      showAssemblyComponentPreparationOverlay(file, 'prepare');
      void Promise.resolve(onLoadRobot(file, { intent: 'append' }))
        .then((outcome) => {
          if (outcome?.status === 'hydration-pending') {
            return;
          }
          clearAssemblyComponentPreparationOverlay();
          if (outcome?.status === 'committed') {
            showToast(
              t.addedComponent.replace('{name}', outcome.component.name),
              'success',
            );
          }
        })
        .catch(() => {
          clearAssemblyComponentPreparationOverlay();
          showToast(`Failed to add assembly component: ${file.name}`, 'info');
        });
    },
    [
      clearAssemblyComponentPreparationOverlay,
      onLoadRobot,
      showAssemblyComponentPreparationOverlay,
      showToast,
      t,
    ],
  );

  const handleCreateBridge = useCallback(() => {
    setBridgePreview(null);
    setShouldRenderBridgeModal(true);
    void loadBridgeCreateModalModule();
    setIsBridgeModalOpen(true);
  }, [setBridgePreview, setIsBridgeModalOpen, setShouldRenderBridgeModal]);

  const handleCloseBridgeModal = useCallback(() => {
    setBridgePreview(null);
    setIsBridgeModalOpen(false);
  }, [setBridgePreview, setIsBridgeModalOpen]);

  const handleBridgePreviewChange = useCallback(
    (nextPreview: BridgeJoint | null) => {
      setBridgePreview(nextPreview);
    },
    [setBridgePreview],
  );

  const handleCreateBridgeCommit = useCallback(
    (params: Parameters<typeof addBridge>[0]) => {
      setBridgePreview(null);
      return addBridge(params);
    },
    [addBridge, setBridgePreview],
  );

  const handleOpenCollisionOptimizer = useCallback(() => {
    void loadCollisionOptimizationDialogModule();
    setIsCollisionOptimizerOpen(true);
  }, [setIsCollisionOptimizerOpen]);

  return {
    handleAddComponent,
    handleCreateBridge,
    handleCloseBridgeModal,
    handleBridgePreviewChange,
    handleCreateBridgeCommit,
    handleOpenCollisionOptimizer,
  };
}
