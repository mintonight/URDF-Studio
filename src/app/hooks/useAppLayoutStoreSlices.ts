import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import {
  useAssetsStore,
  useAssemblySelectionStore,
  useCollisionTransformStore,
  useRobotStore,
  useSelectionStore,
  useUIStore,
} from '@/store';
import { toDocumentLoadLifecycleState } from '@/store/assetsStore';

export function useAppLayoutStoreSlices() {
  const uiStore = useUIStore(
    useShallow((state) => ({
      appMode: state.appMode,
      lang: state.lang,
      theme: state.theme,
      sidebar: state.sidebar,
      panelLayout: state.panelLayout,
      toggleSidebar: state.toggleSidebar,
      setSidebar: state.setSidebar,
      sourceCodeAutoApply: state.sourceCodeAutoApply,
      setViewOption: state.setViewOption,
      groundPlaneOffset: state.groundPlaneOffset,
    })),
  );

  const selectionStore = useSelectionStore(
    useShallow((state) => ({
      selection: state.selection,
      setSelection: state.setSelection,
      setHoveredSelection: state.setHoveredSelection,
      focusTarget: state.focusTarget,
      focusOn: state.focusOn,
      pulseSelection: state.pulseSelection,
    })),
  );

  const assemblySelectionStore = useAssemblySelectionStore(
    useShallow((state) => ({
      assemblySelection: state.selection,
      clearSelection: state.clearSelection,
      selectComponent: state.selectComponent,
    })),
  );

  const assetsStore = useAssetsStore(
    useShallow((state) => ({
      assets: state.assets,
      motorLibrary: state.motorLibrary,
      availableFiles: state.availableFiles,
      selectedFile: state.selectedFile,
      documentLoadState: state.documentLoadState,
      allFileContents: state.allFileContents,
      setAvailableFiles: state.setAvailableFiles,
      setSelectedFile: state.setSelectedFile,
      setAllFileContents: state.setAllFileContents,
      originalUrdfContent: state.originalUrdfContent,
      setOriginalUrdfContent: state.setOriginalUrdfContent,
      uploadAsset: state.uploadAsset,
      removeRobotFile: state.removeRobotFile,
      removeRobotFolder: state.removeRobotFolder,
      renameRobotFolder: state.renameRobotFolder,
      clearRobotLibrary: state.clearRobotLibrary,
      getUsdPreparedExportCache: state.getUsdPreparedExportCache,
      usdPreparedExportCaches: state.usdPreparedExportCaches,
      setDocumentLoadState: state.setDocumentLoadState,
    })),
  );
  const documentLoadLifecycleState = useMemo(
    () => toDocumentLoadLifecycleState(assetsStore.documentLoadState),
    [assetsStore.documentLoadState],
  );

  const robotStore = useRobotStore(
    useShallow((state) => ({
      robotName: state.name,
      robotLinks: state.links,
      robotJoints: state.joints,
      rootLinkId: state.rootLinkId,
      robotMaterials: state.materials,
      closedLoopConstraints: state.closedLoopConstraints,
      setName: state.setName,
      setRobot: state.setRobot,
      resetRobot: state.resetRobot,
      addChild: state.addChild,
      deleteSubtree: state.deleteSubtree,
      updateLink: state.updateLink,
      updateJoint: state.updateJoint,
      updateMjcfTendon: state.updateMjcfTendon,
      setAllLinksVisibility: state.setAllLinksVisibility,
      setJointAngle: state.setJointAngle,
      applyJointKinematicOverrides: state.applyJointKinematicOverrides,
    })),
  );

  const assemblyStore = useRobotStore(
    useShallow((state) => ({
      assemblyState: state.assemblyState,
      assemblyRevision: state.assemblyRevision,
      addComponent: state.addComponent,
      initAssembly: state.initAssembly,
      removeComponent: state.removeComponent,
      addBridge: state.addBridge,
      removeBridge: state.removeBridge,
      updateComponentName: state.updateComponentName,
      updateComponentTransform: state.updateComponentTransform,
      updateComponentRobot: state.updateComponentRobot,
      updateAssemblyTransform: state.updateAssemblyTransform,
      renameComponentSourceFolder: state.renameComponentSourceFolder,
    })),
  );

  const collisionTransformStore = useCollisionTransformStore(
    useShallow((state) => ({
      setPendingCollisionTransform: state.setPendingCollisionTransform,
      clearPendingCollisionTransform: state.clearPendingCollisionTransform,
    })),
  );

  return {
    uiStore,
    selectionStore,
    assemblySelectionStore,
    assetsStore: {
      ...assetsStore,
      documentLoadLifecycleState,
    },
    robotStore,
    assemblyStore,
    collisionTransformStore,
  };
}
