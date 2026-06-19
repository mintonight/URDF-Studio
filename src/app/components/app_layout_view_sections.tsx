import React, { lazy, Suspense } from 'react';

import { AppLayoutOverlays } from './AppLayoutOverlays';
import { FileDropOverlay } from './FileDropOverlay';
import { Header } from './Header';
import { IkToolPanel } from './IkToolPanel';
import { ImportPreparationOverlay } from './ImportPreparationOverlay';
import { LazyOverlayFallback } from './LazyOverlayFallback';
import type { AppLayoutViewProps } from './app_layout_view_types';
import { WorkspaceSidebars } from './workspace/WorkspaceSidebars';
import { WorkspaceViewerLayer } from './workspace/WorkspaceViewerLayer';
import { resolveDocumentLoadingOverlayTargetFileName } from '../utils/documentLoadProgress';
import { ROBOT_IMPORT_ACCEPT_ATTRIBUTE } from '@/shared/utils';

const SnapshotDialog = lazy(() =>
  import('./SnapshotDialog').then((m) => ({ default: m.SnapshotDialog })),
);

interface AppLayoutViewContentProps extends AppLayoutViewProps {
  shouldSuppressDocumentLoadingOverlay: boolean;
}

export function AppLayoutViewContent(props: AppLayoutViewContentProps) {
  const { dragHandlers, workspaceLayoutClassNames } = props;

  return (
    <div
      className="flex flex-col h-screen font-sans bg-google-light-bg dark:bg-app-bg text-slate-800 dark:text-slate-200"
      onDragEnter={dragHandlers.onDragEnter}
      onDragOver={dragHandlers.onDragOver}
      onDragLeave={dragHandlers.onDragLeave}
      onDrop={dragHandlers.onDrop}
    >
      <AppLayoutDropOverlay {...props} />
      <AppLayoutImportInputs {...props} />
      <AppLayoutHeaderSection {...props} />
      <AppLayoutIkPanelSection {...props} />

      <div className={workspaceLayoutClassNames.root}>
        <WorkspaceViewerSection {...props} />
        <WorkspaceSidebarsSection {...props} />
      </div>

      <SnapshotDialogSection {...props} />
      <AssemblyPreparationOverlaySection {...props} />
      <AppLayoutOverlaysSection {...props} />
    </div>
  );
}

function AppLayoutDropOverlay({ isFileDragActive, t }: AppLayoutViewProps) {
  return (
    <FileDropOverlay
      visible={isFileDragActive}
      title={t.dropFilesToImport}
      hint={t.dropFilesToImportHint}
    />
  );
}

function AppLayoutImportInputs({
  importInputRef,
  importFolderInputRef,
}: AppLayoutViewProps) {
  return (
    <>
      <input
        type="file"
        accept={ROBOT_IMPORT_ACCEPT_ATTRIBUTE}
        ref={importInputRef}
        className="hidden"
      />
      <input
        type="file"
        ref={importFolderInputRef}
        className="hidden"
        {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
      />
    </>
  );
}

function AppLayoutHeaderSection({
  importInputRef,
  importFolderInputRef,
  onOpenExport,
  onExportProject,
  onOpenSettings,
  headerQuickAction,
  headerSecondaryAction,
  viewConfig,
  setViewConfig,
  toolboxItems,
  handleOpenCodeViewer,
  handlePrefetchCodeViewer,
  handleSnapshot,
}: AppLayoutViewProps) {
  return (
    <Header
      onImportFile={() => importInputRef.current?.click()}
      onImportFolder={() => importFolderInputRef.current?.click()}
      onOpenExport={onOpenExport}
      onExportProject={onExportProject}
      toolboxItems={toolboxItems}
      onOpenCodeViewer={handleOpenCodeViewer}
      onPrefetchCodeViewer={handlePrefetchCodeViewer}
      onOpenSettings={onOpenSettings}
      quickAction={headerQuickAction}
      secondaryAction={headerSecondaryAction}
      onSnapshot={handleSnapshot}
      viewConfig={viewConfig}
      viewAvailability={{ jointPanel: true }}
      setViewConfig={setViewConfig}
    />
  );
}

function AppLayoutIkPanelSection({
  isIkToolPanelOpen,
  t,
  ikLinkOptions,
  selectedIkLinkId,
  selectedIkLinkLabel,
  currentIkLinkLabel,
  ikToolSelectionStatus,
  onSelectIkLink,
  onIkToolClose,
}: AppLayoutViewProps) {
  return (
    <IkToolPanel
      show={isIkToolPanelOpen}
      t={t}
      linkOptions={ikLinkOptions}
      selectedLinkId={selectedIkLinkId}
      selectedLinkLabel={selectedIkLinkLabel}
      currentLinkLabel={currentIkLinkLabel}
      selectionStatus={ikToolSelectionStatus}
      onSelectLink={onSelectIkLink}
      onClose={onIkToolClose}
    />
  );
}

function WorkspaceViewerSection({
  workspaceLayoutClassNames,
  workspaceOverlaySafeAreaStyle,
  workspaceOverlayGizmoMargin,
  viewerRobot,
  editorRobot,
  mergedAppMode,
  handleViewerSelectWithBridgePreview,
  handleViewerMeshSelectWithAssemblyClear,
  handleHover,
  handleUpdate,
  viewerAssets,
  allFileContents,
  showVisual,
  handleSetShowVisual,
  handleSetDetailOptionsPanelVisibility,
  snapshotActionRef,
  viewerCanvasStateRef,
  availableFiles,
  urdfContentForViewer,
  viewerSourceFormat,
  viewerSourceFilePath,
  viewerSourceFile,
  viewerDocumentLifecycleCallbacks,
  jointAngleState,
  jointMotionState,
  handleJointChange,
  selection,
  focusTarget,
  selectedFile,
  handleWorkspaceTransformPendingChange,
  handleCollisionTransform,
  normalizedAssemblyState,
  shouldRenderAssembly,
  assemblySelection,
  sourceSceneAssemblyComponentId,
  handleAssemblyTransform,
  handleComponentTransform,
  handleBridgeTransform,
  ikDragActive,
  pendingViewerToolMode,
  setPendingViewerToolMode,
  viewerReloadKey,
  documentLoadLifecycleState,
  documentLoadState,
  importPreparationOverlay,
  lang,
  theme,
  viewConfig,
  shouldSuppressDocumentLoadingOverlay,
}: AppLayoutViewContentProps) {
  return (
    <WorkspaceViewerLayer
      className={workspaceLayoutClassNames.viewerLayer}
      style={workspaceOverlaySafeAreaStyle}
      viewerProps={{
        robot: viewerRobot,
        editorRobot,
        mode: mergedAppMode,
        onSelect: handleViewerSelectWithBridgePreview,
        onMeshSelect: handleViewerMeshSelectWithAssemblyClear,
        onHover: handleHover,
        onUpdate: handleUpdate,
        assets: viewerAssets,
        allFileContents,
        lang,
        theme,
        showVisual,
        setShowVisual: handleSetShowVisual,
        snapshotAction: snapshotActionRef,
        onCanvasCreated: (state) => {
          viewerCanvasStateRef.current = state;
        },
        showOptionsPanel: viewConfig.showOptionsPanel,
        setShowOptionsPanel: handleSetDetailOptionsPanelVisibility,
        showJointPanel: false,
        availableFiles,
        urdfContent: urdfContentForViewer,
        viewerSourceFormat,
        sourceFilePath: viewerSourceFilePath,
        sourceFile: viewerSourceFile,
        onDocumentLoadEvent: viewerDocumentLifecycleCallbacks.onDocumentLoadEvent,
        onRuntimeRobotLoaded: viewerDocumentLifecycleCallbacks.onRuntimeRobotLoaded,
        onRuntimeSceneReadyForDisplay:
          viewerDocumentLifecycleCallbacks.onRuntimeSceneReadyForDisplay,
        jointAngleState,
        jointMotionState,
        onJointChange: handleJointChange,
        syncJointChangesToApp: true,
        selection,
        focusTarget,
        isMeshPreview: selectedFile?.format === 'mesh',
        onTransformPendingChange: handleWorkspaceTransformPendingChange,
        onCollisionTransform: handleCollisionTransform,
        assemblyState: normalizedAssemblyState,
        assemblyWorkspaceActive: shouldRenderAssembly,
        assemblySelection,
        sourceSceneAssemblyComponentId,
        onAssemblyTransform: handleAssemblyTransform,
        onComponentTransform: handleComponentTransform,
        onBridgeTransform: handleBridgeTransform,
        ikDragActive,
        pendingViewerToolMode,
        onConsumePendingViewerToolMode: () => setPendingViewerToolMode(null),
        viewerReloadKey,
        documentLoadState: documentLoadLifecycleState,
        gizmoMargin: workspaceOverlayGizmoMargin,
      }}
      documentLoadingOverlayLang={lang}
      documentLoadingOverlayTargetFileName={resolveDocumentLoadingOverlayTargetFileName({
        previewFileName: null,
        selectedFileName: selectedFile?.name ?? null,
        suppressDocumentLoadingOverlay: shouldSuppressDocumentLoadingOverlay,
        documentLoadState,
      })}
      importPreparationOverlay={importPreparationOverlay}
    />
  );
}

function WorkspaceSidebarsSection({
  workspaceLayoutClassNames,
  previewContextRobot,
  handleSelectWithAssemblyClear,
  handleSelectGeometryWithAssemblyClear,
  handleFocus,
  handleAddChild,
  handleAddCollisionBody,
  handleDelete,
  handleNameChange,
  handleUpdate,
  showVisual,
  handleSetShowVisual,
  mergedAppMode,
  lang,
  theme,
  leftSidebarCollapsed,
  rightSidebarCollapsed,
  onToggleLeftSidebar,
  onToggleRightSidebar,
  availableFiles,
  handlePreviewFileWithFeedback,
  handleRequestLoadRobot,
  selectedFile,
  viewerSourceFilePath,
  normalizedAssemblyState,
  handleAddComponent,
  handleDeleteLibraryFile,
  handleDeleteLibraryFolder,
  handleRenameLibraryFolder,
  handleDeleteAllLibraryFiles,
  handleExportLibraryFile,
  handleCreateBridge,
  removeComponent,
  removeBridge,
  handleRenameComponent,
  handleSwitchTreeEditorToProMode,
  handleRequestSwitchTreeEditorToStructure,
  isPreviewingWorkspaceSource,
  viewConfig,
  handleJointPreview,
  handleJointChange,
  previewFile,
  previewRobot,
  filePreview,
  viewerAssets,
  allFileContents,
  documentLoadState,
  handleClosePreview,
  propertyEditorSelectionContext,
  handleHover,
  handleUploadAsset,
  motorLibrary,
  t,
}: AppLayoutViewProps) {
  return (
    <WorkspaceSidebars
      leftSidebarClassName={workspaceLayoutClassNames.leftSidebarLayer}
      rightSidebarClassName={workspaceLayoutClassNames.rightSidebarLayer}
      treeEditorProps={{
        robot: previewContextRobot,
        onSelect: handleSelectWithAssemblyClear,
        onSelectGeometry: handleSelectGeometryWithAssemblyClear,
        onFocus: handleFocus,
        onAddChild: handleAddChild,
        onAddCollisionBody: handleAddCollisionBody,
        onDelete: handleDelete,
        onNameChange: handleNameChange,
        onUpdate: handleUpdate,
        showVisual,
        setShowVisual: handleSetShowVisual,
        mode: mergedAppMode,
        lang,
        theme,
        collapsed: leftSidebarCollapsed,
        onToggle: onToggleLeftSidebar,
        availableFiles,
        onLoadRobot: handlePreviewFileWithFeedback,
        onRequestLoadRobot: handleRequestLoadRobot,
        currentFileName: selectedFile?.name,
        sourceFilePath: viewerSourceFilePath,
        assemblyState: normalizedAssemblyState,
        onAddComponent: handleAddComponent,
        onDeleteLibraryFile: handleDeleteLibraryFile,
        onDeleteLibraryFolder: handleDeleteLibraryFolder,
        onRenameLibraryFolder: handleRenameLibraryFolder,
        onDeleteAllLibraryFiles: handleDeleteAllLibraryFiles,
        onExportLibraryFile: handleExportLibraryFile,
        onCreateBridge: handleCreateBridge,
        onRemoveComponent: removeComponent,
        onRemoveBridge: removeBridge,
        onRenameComponent: handleRenameComponent,
        onSwitchToProMode: handleSwitchTreeEditorToProMode,
        onRequestSwitchToStructure: handleRequestSwitchTreeEditorToStructure,
        isReadOnly: isPreviewingWorkspaceSource,
        showJointPanel: viewConfig.showJointPanel,
        onJointAnglePreview: handleJointPreview,
        onJointAngleChange: handleJointChange,
      }}
      filePreviewWindowProps={{
        file: previewFile,
        previewRobot,
        previewState: filePreview,
        assets: viewerAssets,
        allFileContents,
        availableFiles,
        documentLoadState,
        lang,
        theme,
        showVisual,
        onClose: handleClosePreview,
        onAddComponent: handleAddComponent,
      }}
      propertyEditorProps={{
        robot: propertyEditorSelectionContext.robot,
        onUpdate: handleUpdate,
        onSelect: handleSelectWithAssemblyClear,
        onSelectGeometry: handleSelectGeometryWithAssemblyClear,
        onAddCollisionBody: handleAddCollisionBody,
        onHover: handleHover,
        mode: mergedAppMode,
        assets: viewerAssets,
        onUploadAsset: handleUploadAsset,
        motorLibrary,
        lang,
        theme,
        collapsed: rightSidebarCollapsed,
        onToggle: onToggleRightSidebar,
        readOnlyMessage: isPreviewingWorkspaceSource ? t.previewReadOnlyHint : undefined,
        jointTypeLocked: Boolean(propertyEditorSelectionContext.selectedClosedLoopBridge),
        sourceFilePath: viewerSourceFilePath,
      }}
    />
  );
}

function SnapshotDialogSection({
  isSnapshotDialogOpen,
  isSnapshotCapturing,
  lang,
  snapshotPreviewSession,
  handleSnapshotPreviewCaptureActionChange,
  handleCloseSnapshotDialog,
  handleCaptureSnapshot,
  t,
}: AppLayoutViewProps) {
  if (!isSnapshotDialogOpen) {
    return null;
  }

  return (
    <Suspense fallback={<LazyOverlayFallback label={t.loadingPanel} />}>
      <SnapshotDialog
        isOpen={isSnapshotDialogOpen}
        isCapturing={isSnapshotCapturing}
        lang={lang}
        previewSession={snapshotPreviewSession}
        onPreviewCaptureActionChange={handleSnapshotPreviewCaptureActionChange}
        onClose={handleCloseSnapshotDialog}
        onCapture={handleCaptureSnapshot}
      />
    </Suspense>
  );
}

function AssemblyPreparationOverlaySection({
  assemblyComponentPreparationOverlay,
}: AppLayoutViewProps) {
  if (!assemblyComponentPreparationOverlay) {
    return null;
  }

  return (
    <ImportPreparationOverlay
      label={assemblyComponentPreparationOverlay.label}
      detail={assemblyComponentPreparationOverlay.detail}
      progress={assemblyComponentPreparationOverlay.progress}
      statusLabel={assemblyComponentPreparationOverlay.statusLabel}
      stageLabel={assemblyComponentPreparationOverlay.stageLabel}
    />
  );
}

function AppLayoutOverlaysSection({
  isCodeViewerOpen,
  sourceCodeEditorDocuments,
  sourceCodeAutoApply,
  setIsCodeViewerOpen,
  theme,
  lang,
  t,
  isCollisionOptimizerOpen,
  setIsCollisionOptimizerOpen,
  collisionOptimizationSource,
  viewerAssets,
  viewerSourceFilePath,
  selection,
  handlePreviewCollisionOptimizationTarget,
  handleApplyCollisionOptimization,
  normalizedAssemblyState,
  shouldRenderBridgeModal,
  isBridgeModalOpen,
  handleCloseBridgeModal,
  handleCreateBridgeCommit,
  handleBridgePreviewChange,
}: AppLayoutViewProps) {
  return (
    <AppLayoutOverlays
      isCodeViewerOpen={isCodeViewerOpen}
      sourceCodeDocuments={sourceCodeEditorDocuments}
      autoApplyEnabled={sourceCodeAutoApply}
      onCloseCodeViewer={() => setIsCodeViewerOpen(false)}
      theme={theme}
      lang={lang}
      loadingEditorLabel={t.loadingEditor}
      isCollisionOptimizerOpen={isCollisionOptimizerOpen}
      loadingOptimizerLabel={t.loadingOptimizer}
      collisionOptimizationSource={collisionOptimizationSource}
      assets={viewerAssets}
      sourceFilePath={viewerSourceFilePath}
      selection={selection}
      onCloseCollisionOptimizer={() => setIsCollisionOptimizerOpen(false)}
      onSelectCollisionTarget={handlePreviewCollisionOptimizationTarget}
      onApplyCollisionOptimization={handleApplyCollisionOptimization}
      assemblyState={normalizedAssemblyState}
      shouldRenderBridgeModal={shouldRenderBridgeModal}
      loadingBridgeDialogLabel={t.loadingBridgeDialog}
      isBridgeModalOpen={isBridgeModalOpen}
      onCloseBridgeModal={handleCloseBridgeModal}
      onCreateBridge={handleCreateBridgeCommit}
      onPreviewBridgeChange={handleBridgePreviewChange}
    />
  );
}
