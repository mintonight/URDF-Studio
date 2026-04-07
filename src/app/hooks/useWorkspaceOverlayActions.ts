import { useCallback } from 'react';

import {
  loadBridgeCreateModalModule,
  loadCollisionOptimizationDialogModule,
} from '@/app/utils/overlayLoaders';
import { scheduleFailFastInDev } from '@/core/utils/runtimeDiagnostics';
import type { BridgeJoint, RobotData, RobotFile } from '@/types';

import type { ImportPreparationOverlayState } from './useFileImport';

type ToolMode = 'measure';

interface UseWorkspaceOverlayActionsTranslations {
  addedComponent: string;
  loadingRobot: string;
  preparingAssemblyComponent: string;
  addingAssemblyComponentToWorkspace: string;
  groundingAssemblyComponent: string;
}

interface UseWorkspaceOverlayActionsParams {
  getUsdPreparedExportCache: (
    fileName: string,
  ) => { robotData?: RobotData | null } | null | undefined;
  onLoadRobot: (file: RobotFile) => void;
  setPendingUsdAssemblyFile: (file: RobotFile | null) => void;
  insertAssemblyComponentIntoWorkspace: (
    file: RobotFile,
    options?: { preResolvedRobotData?: RobotData | null },
  ) => Promise<{ name: string }>;
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
  setViewConfig: React.Dispatch<
    React.SetStateAction<
      {
        showToolbar: boolean;
      } & Record<string, unknown>
    >
  >;
  setPendingViewerToolMode: (value: ToolMode | null) => void;
}

export function useWorkspaceOverlayActions({
  getUsdPreparedExportCache,
  onLoadRobot,
  setPendingUsdAssemblyFile,
  insertAssemblyComponentIntoWorkspace,
  showAssemblyComponentPreparationOverlay,
  clearAssemblyComponentPreparationOverlay,
  showToast,
  t,
  setBridgePreview,
  setShouldRenderBridgeModal,
  setIsBridgeModalOpen,
  addBridge,
  setIsCollisionOptimizerOpen,
  setViewConfig,
  setPendingViewerToolMode,
}: UseWorkspaceOverlayActionsParams) {
  const handleAddComponent = useCallback(
    (file: RobotFile) => {
      const preResolvedRobotData =
        file.format === 'usd' ? (getUsdPreparedExportCache(file.name)?.robotData ?? null) : null;

      if (file.format === 'usd' && !preResolvedRobotData) {
        showAssemblyComponentPreparationOverlay(file, 'prepare');
        setPendingUsdAssemblyFile(file);
        onLoadRobot(file);
        return;
      }

      void insertAssemblyComponentIntoWorkspace(file, {
        preResolvedRobotData,
      })
        .then((component) => {
          showToast(t.addedComponent.replace('{name}', component.name), 'success');
        })
        .catch((error) => {
          scheduleFailFastInDev(
            'AppLayout:handleAddComponent',
            error instanceof Error
              ? error
              : new Error(`Failed to resolve assembly component "${file.name}".`),
          );
          showToast(`Failed to add assembly component: ${file.name}`, 'info');
        })
        .finally(() => {
          clearAssemblyComponentPreparationOverlay();
        });
    },
    [
      clearAssemblyComponentPreparationOverlay,
      getUsdPreparedExportCache,
      insertAssemblyComponentIntoWorkspace,
      onLoadRobot,
      setPendingUsdAssemblyFile,
      setPendingUsdAssemblyFile,
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

  const handleOpenMeasureTool = useCallback(() => {
    setViewConfig((prev) => ({ ...prev, showToolbar: true }));
    setPendingViewerToolMode('measure');
  }, [setPendingViewerToolMode, setViewConfig]);

  return {
    handleAddComponent,
    handleCreateBridge,
    handleCloseBridgeModal,
    handleBridgePreviewChange,
    handleCreateBridgeCommit,
    handleOpenCollisionOptimizer,
    handleOpenMeasureTool,
  };
}
