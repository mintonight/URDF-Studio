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
  const { drag, workspaceChrome } = props;

  return (
    <div
      className="flex flex-col h-screen font-sans bg-google-light-bg dark:bg-app-bg text-slate-800 dark:text-slate-200"
      onDragEnter={drag.handlers.onDragEnter}
      onDragOver={drag.handlers.onDragOver}
      onDragLeave={drag.handlers.onDragLeave}
      onDrop={drag.handlers.onDrop}
    >
      <AppLayoutDropOverlay drag={props.drag} />
      <AppLayoutImportInputs importInputs={props.importInputs} />
      <AppLayoutHeaderSection importInputs={props.importInputs} header={props.header} />
      <AppLayoutIkPanelSection ikPanel={props.ikPanel} />

      <div className={workspaceChrome.classNames.root}>
        <WorkspaceViewerSection
          workspaceChrome={props.workspaceChrome}
          viewer={props.viewer}
          shouldSuppressDocumentLoadingOverlay={props.shouldSuppressDocumentLoadingOverlay}
        />
        <WorkspaceSidebarsSection
          workspaceChrome={props.workspaceChrome}
          sidebars={props.sidebars}
        />
      </div>

      <SnapshotDialogSection snapshot={props.snapshot} />
      <AssemblyPreparationOverlaySection assemblyPreparation={props.assemblyPreparation} />
      <AppLayoutOverlaysSection overlays={props.overlays} />
    </div>
  );
}

function AppLayoutDropOverlay({ drag }: Pick<AppLayoutViewProps, 'drag'>) {
  return (
    <FileDropOverlay
      visible={drag.isFileDragActive}
      title={drag.t.dropFilesToImport}
      hint={drag.t.dropFilesToImportHint}
    />
  );
}

function AppLayoutImportInputs({
  importInputs,
}: Pick<AppLayoutViewProps, 'importInputs'>) {
  return (
    <>
      <input
        type="file"
        accept={ROBOT_IMPORT_ACCEPT_ATTRIBUTE}
        ref={importInputs.importInputRef}
        className="hidden"
      />
      <input
        type="file"
        ref={importInputs.importFolderInputRef}
        className="hidden"
        {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
      />
    </>
  );
}

function AppLayoutHeaderSection({
  importInputs,
  header,
}: Pick<AppLayoutViewProps, 'importInputs' | 'header'>) {
  return (
    <Header
      onImportFile={() => importInputs.importInputRef.current?.click()}
      onImportFolder={() => importInputs.importFolderInputRef.current?.click()}
      onOpenExport={header.onOpenExport}
      onExportProject={header.onExportProject}
      isExportingProject={header.isExportingProject}
      toolboxItems={header.toolboxItems}
      onOpenCodeViewer={header.handleOpenCodeViewer}
      onPrefetchCodeViewer={header.handlePrefetchCodeViewer}
      onOpenSettings={header.onOpenSettings}
      quickAction={header.headerQuickAction}
      secondaryAction={header.headerSecondaryAction}
      onSnapshot={header.handleSnapshot}
      viewConfig={header.viewConfig}
      viewAvailability={{ jointPanel: true }}
      setViewConfig={header.setViewConfig}
    />
  );
}

function AppLayoutIkPanelSection({ ikPanel }: Pick<AppLayoutViewProps, 'ikPanel'>) {
  return (
    <IkToolPanel
      show={ikPanel.isOpen}
      t={ikPanel.t}
      linkOptions={ikPanel.ikLinkOptions}
      selectedLinkId={ikPanel.selectedIkLinkId}
      selectedLinkLabel={ikPanel.selectedIkLinkLabel}
      currentLinkLabel={ikPanel.currentIkLinkLabel}
      selectionStatus={ikPanel.ikToolSelectionStatus}
      onSelectLink={ikPanel.onSelectIkLink}
      onClose={ikPanel.onClose}
    />
  );
}

function WorkspaceViewerSection({
  workspaceChrome,
  viewer,
  shouldSuppressDocumentLoadingOverlay,
}: Pick<AppLayoutViewContentProps, 'workspaceChrome' | 'viewer' | 'shouldSuppressDocumentLoadingOverlay'>) {
  return (
    <WorkspaceViewerLayer
      className={workspaceChrome.classNames.viewerLayer}
      style={workspaceChrome.overlaySafeAreaStyle}
      viewerProps={{
        robot: viewer.viewerRobot,
        editorRobot: viewer.editorRobot,
        mode: viewer.mergedAppMode,
        onSelect: viewer.handleViewerSelectWithBridgePreview,
        onMeshSelect: viewer.handleViewerMeshSelectWithAssemblyClear,
        onHover: viewer.handleHover,
        onUpdate: viewer.handleUpdate,
        assets: viewer.viewerAssets,
        allFileContents: viewer.allFileContents,
        lang: viewer.lang,
        theme: viewer.theme,
        showVisual: viewer.showVisual,
        setShowVisual: viewer.handleSetShowVisual,
        snapshotAction: viewer.snapshotActionRef,
        onCanvasCreated: (state) => {
          viewer.viewerCanvasStateRef.current = state;
        },
        showOptionsPanel: viewer.viewConfig.showOptionsPanel,
        setShowOptionsPanel: viewer.handleSetDetailOptionsPanelVisibility,
        showJointPanel: false,
        availableFiles: viewer.availableFiles,
        urdfContent: viewer.urdfContentForViewer,
        viewerSourceFormat: viewer.viewerSourceFormat,
        sourceFilePath: viewer.viewerSourceFilePath,
        sourceFile: viewer.viewerSourceFile,
        onDocumentLoadEvent: viewer.viewerDocumentLifecycleCallbacks.onDocumentLoadEvent,
        onRuntimeRobotLoaded: viewer.viewerDocumentLifecycleCallbacks.onRuntimeRobotLoaded,
        onRuntimeSceneReadyForDisplay:
          viewer.viewerDocumentLifecycleCallbacks.onRuntimeSceneReadyForDisplay,
        jointAngleState: viewer.jointAngleState,
        jointMotionState: viewer.jointMotionState,
        onJointChange: viewer.handleJointChange,
        syncJointChangesToApp: true,
        selection: viewer.selection,
        focusTarget: viewer.focusTarget,
        isMeshPreview: viewer.selectedFile?.format === 'mesh',
        onTransformPendingChange: viewer.handleWorkspaceTransformPendingChange,
        onCollisionTransformPreview: viewer.handleCollisionTransformPreview,
        onCollisionTransform: viewer.handleCollisionTransform,
        assemblyState: viewer.normalizedAssemblyState,
        assemblyWorkspaceActive: viewer.shouldRenderAssembly,
        assemblySelection: viewer.assemblySelection,
        sourceSceneAssemblyComponentId: viewer.sourceSceneAssemblyComponentId,
        onAssemblyTransform: viewer.handleAssemblyTransform,
        onComponentTransform: viewer.handleComponentTransform,
        onBridgeTransform: viewer.handleBridgeTransform,
        ikDragActive: viewer.ikDragActive,
        pendingViewerToolMode: viewer.pendingViewerToolMode,
        onConsumePendingViewerToolMode: () => viewer.setPendingViewerToolMode(null),
        viewerReloadKey: viewer.viewerReloadKey,
        documentLoadState: viewer.documentLoadLifecycleState,
        gizmoMargin: workspaceChrome.overlayGizmoMargin,
      }}
      documentLoadingOverlayLang={viewer.lang}
      documentLoadingOverlayTargetFileName={resolveDocumentLoadingOverlayTargetFileName({
        previewFileName: null,
        selectedFileName: viewer.selectedFile?.name ?? null,
        suppressDocumentLoadingOverlay: shouldSuppressDocumentLoadingOverlay,
        documentLoadState: viewer.documentLoadState,
      })}
      importPreparationOverlay={viewer.importPreparationOverlay}
    />
  );
}

function WorkspaceSidebarsSection({
  workspaceChrome,
  sidebars,
}: Pick<AppLayoutViewProps, 'workspaceChrome' | 'sidebars'>) {
  return (
    <WorkspaceSidebars
      leftSidebarClassName={workspaceChrome.classNames.leftSidebarLayer}
      rightSidebarClassName={workspaceChrome.classNames.rightSidebarLayer}
      treeEditorProps={{
        robot: sidebars.previewContextRobot,
        onSelect: sidebars.handleSelectWithAssemblyClear,
        onSelectGeometry: sidebars.handleSelectGeometryWithAssemblyClear,
        onFocus: sidebars.handleFocus,
        onAddChild: sidebars.handleAddChild,
        onAddCollisionBody: sidebars.handleAddCollisionBody,
        onDelete: sidebars.handleDelete,
        onNameChange: sidebars.handleNameChange,
        onUpdate: sidebars.handleUpdate,
        showVisual: sidebars.showVisual,
        setShowVisual: sidebars.handleSetShowVisual,
        mode: sidebars.mergedAppMode,
        lang: sidebars.lang,
        theme: sidebars.theme,
        collapsed: sidebars.leftSidebarCollapsed,
        onToggle: sidebars.onToggleLeftSidebar,
        availableFiles: sidebars.availableFiles,
        onLoadRobot: sidebars.handlePreviewFileWithFeedback,
        onRequestLoadRobot: sidebars.handleRequestLoadRobot,
        currentFileName: sidebars.selectedFile?.name,
        sourceFilePath: sidebars.viewerSourceFilePath,
        assemblyState: sidebars.normalizedAssemblyState,
        onAddComponent: sidebars.handleAddComponent,
        onDeleteLibraryFile: sidebars.handleDeleteLibraryFile,
        onDeleteLibraryFolder: sidebars.handleDeleteLibraryFolder,
        onRenameLibraryFolder: sidebars.handleRenameLibraryFolder,
        onDeleteAllLibraryFiles: sidebars.handleDeleteAllLibraryFiles,
        onExportLibraryFile: sidebars.handleExportLibraryFile,
        onCreateBridge: sidebars.handleCreateBridge,
        onRemoveComponent: sidebars.removeComponent,
        onRemoveBridge: sidebars.removeBridge,
        onRenameComponent: sidebars.handleRenameComponent,
        onSwitchToProMode: sidebars.handleSwitchTreeEditorToProMode,
        onRequestSwitchToStructure: sidebars.handleRequestSwitchTreeEditorToStructure,
        isReadOnly: sidebars.isPreviewingWorkspaceSource,
        showJointPanel: sidebars.viewConfig.showJointPanel,
        showStructureGraph: sidebars.viewConfig.showStructureGraph,
        onCloseStructureGraph: () =>
          sidebars.setViewConfig((prev) => ({ ...prev, showStructureGraph: false })),
        onJointAnglePreview: sidebars.handleJointPreview,
        onJointAngleChange: sidebars.handleJointChange,
      }}
      filePreviewWindowProps={{
        file: sidebars.previewFile,
        previewRobot: sidebars.previewRobot,
        previewState: sidebars.filePreview,
        assets: sidebars.viewerAssets,
        allFileContents: sidebars.allFileContents,
        availableFiles: sidebars.availableFiles,
        documentLoadState: sidebars.documentLoadState,
        lang: sidebars.lang,
        theme: sidebars.theme,
        showVisual: sidebars.showVisual,
        onClose: sidebars.handleClosePreview,
        onAddComponent: sidebars.handleAddComponent,
      }}
      propertyEditorProps={{
        robot: sidebars.propertyEditorSelectionContext.robot,
        onUpdate: sidebars.handleUpdate,
        onSelect: sidebars.handleSelectWithAssemblyClear,
        onSelectGeometry: sidebars.handleSelectGeometryWithAssemblyClear,
        onAddCollisionBody: sidebars.handleAddCollisionBody,
        onHover: sidebars.handleHover,
        mode: sidebars.mergedAppMode,
        assets: sidebars.viewerAssets,
        onUploadAsset: sidebars.handleUploadAsset,
        motorLibrary: sidebars.motorLibrary,
        lang: sidebars.lang,
        theme: sidebars.theme,
        collapsed: sidebars.rightSidebarCollapsed,
        onToggle: sidebars.onToggleRightSidebar,
        readOnlyMessage: sidebars.isPreviewingWorkspaceSource
          ? sidebars.t.previewReadOnlyHint
          : undefined,
        jointTypeLocked: Boolean(sidebars.propertyEditorSelectionContext.selectedClosedLoopBridge),
        sourceFilePath: sidebars.viewerSourceFilePath,
      }}
    />
  );
}

function SnapshotDialogSection({ snapshot }: Pick<AppLayoutViewProps, 'snapshot'>) {
  if (!snapshot.isOpen) {
    return null;
  }

  return (
    <Suspense fallback={<LazyOverlayFallback label={snapshot.loadingLabel} />}>
      <SnapshotDialog
        isOpen={snapshot.isOpen}
        isCapturing={snapshot.isCapturing}
        lang={snapshot.lang}
        previewSession={snapshot.previewSession}
        onPreviewCaptureActionChange={snapshot.onPreviewCaptureActionChange}
        onClose={snapshot.onClose}
        onCapture={snapshot.onCapture}
      />
    </Suspense>
  );
}

function AssemblyPreparationOverlaySection({
  assemblyPreparation,
}: Pick<AppLayoutViewProps, 'assemblyPreparation'>) {
  const { overlay } = assemblyPreparation;
  if (!overlay) {
    return null;
  }

  return (
    <ImportPreparationOverlay
      label={overlay.label}
      detail={overlay.detail}
      progress={overlay.progress}
      statusLabel={overlay.statusLabel}
      stageLabel={overlay.stageLabel}
    />
  );
}

function AppLayoutOverlaysSection({ overlays }: Pick<AppLayoutViewProps, 'overlays'>) {
  return (
    <AppLayoutOverlays
      isCodeViewerOpen={overlays.isCodeViewerOpen}
      sourceCodeDocuments={overlays.sourceCodeEditorDocuments}
      autoApplyEnabled={overlays.sourceCodeAutoApply}
      onCloseCodeViewer={() => overlays.setIsCodeViewerOpen(false)}
      theme={overlays.theme}
      lang={overlays.lang}
      loadingEditorLabel={overlays.labels.loadingEditor}
      isCollisionOptimizerOpen={overlays.isCollisionOptimizerOpen}
      loadingOptimizerLabel={overlays.labels.loadingOptimizer}
      collisionOptimizationSource={overlays.collisionOptimizationSource}
      assets={overlays.viewerAssets}
      sourceFilePath={overlays.viewerSourceFilePath}
      selection={overlays.selection}
      onCloseCollisionOptimizer={() => overlays.setIsCollisionOptimizerOpen(false)}
      onSelectCollisionTarget={overlays.handlePreviewCollisionOptimizationTarget}
      onApplyCollisionOptimization={overlays.handleApplyCollisionOptimization}
      assemblyState={overlays.normalizedAssemblyState}
      shouldRenderBridgeModal={overlays.shouldRenderBridgeModal}
      loadingBridgeDialogLabel={overlays.labels.loadingBridgeDialog}
      isBridgeModalOpen={overlays.isBridgeModalOpen}
      onCloseBridgeModal={overlays.handleCloseBridgeModal}
      onCreateBridge={overlays.handleCreateBridgeCommit}
      onPreviewBridgeChange={overlays.handleBridgePreviewChange}
    />
  );
}
