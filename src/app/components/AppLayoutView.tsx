import React, { lazy, Suspense, type CSSProperties } from 'react';
import type { RootState } from '@react-three/fiber';

import { AppLayoutOverlays } from './AppLayoutOverlays';
import { FileDropOverlay } from './FileDropOverlay';
import { Header } from './Header';
import { IkToolPanel } from './IkToolPanel';
import { ImportPreparationOverlay } from './ImportPreparationOverlay';
import { LazyOverlayFallback } from './LazyOverlayFallback';
import { WorkspaceSidebars } from './workspace/WorkspaceSidebars';
import { WorkspaceViewerLayer } from './workspace/WorkspaceViewerLayer';
import type { SnapshotPreviewSession } from './snapshot-preview/types';
import type { AppLayoutProps } from '../appLayoutTypes';
import { resolveDocumentLoadingOverlayTargetFileName } from '../utils/documentLoadProgress';
import type { ToolMode } from '@/features/urdf-viewer/types';
import type {
  SnapshotCaptureAction,
  SnapshotCaptureOptions,
} from '@/shared/components/3d/scene/snapshotConfig';
import type { Language, TranslationKeys } from '@/shared/i18n';
import { ROBOT_IMPORT_ACCEPT_ATTRIBUTE } from '@/shared/utils';
import type { RobotFile } from '@/types';

const SnapshotDialog = lazy(() =>
  import('./SnapshotDialog').then((m) => ({ default: m.SnapshotDialog })),
);

type HeaderProps = React.ComponentProps<typeof Header>;
type IkToolPanelProps = React.ComponentProps<typeof IkToolPanel>;
type ImportPreparationOverlayProps = React.ComponentProps<typeof ImportPreparationOverlay>;
type WorkspaceViewerLayerProps = React.ComponentProps<typeof WorkspaceViewerLayer>;
type ViewerProps = WorkspaceViewerLayerProps['viewerProps'];
type WorkspaceSidebarsProps = React.ComponentProps<typeof WorkspaceSidebars>;
type TreeEditorProps = WorkspaceSidebarsProps['treeEditorProps'];
type FilePreviewWindowProps = WorkspaceSidebarsProps['filePreviewWindowProps'];
type PropertyEditorProps = WorkspaceSidebarsProps['propertyEditorProps'];
type AppLayoutOverlaysProps = React.ComponentProps<typeof AppLayoutOverlays>;

interface WorkspaceLayoutClassNames {
  root: string;
  viewerLayer: string;
  leftSidebarLayer: string;
  rightSidebarLayer: string;
}

interface PropertyEditorSelectionContextView {
  robot: PropertyEditorProps['robot'];
  selectedClosedLoopBridge: unknown;
}

interface AppLayoutDragHandlers {
  onDragEnter: React.DragEventHandler<HTMLDivElement>;
  onDragOver: React.DragEventHandler<HTMLDivElement>;
  onDragLeave: React.DragEventHandler<HTMLDivElement>;
  onDrop: React.DragEventHandler<HTMLDivElement>;
}

export interface AppLayoutViewProps {
  importInputRef: AppLayoutProps['importInputRef'];
  importFolderInputRef: AppLayoutProps['importFolderInputRef'];
  onOpenExport: AppLayoutProps['onOpenExport'];
  onExportProject: AppLayoutProps['onExportProject'];
  onOpenSettings: AppLayoutProps['onOpenSettings'];
  headerQuickAction: AppLayoutProps['headerQuickAction'];
  headerSecondaryAction: AppLayoutProps['headerSecondaryAction'];
  viewConfig: AppLayoutProps['viewConfig'];
  setViewConfig: AppLayoutProps['setViewConfig'];
  isCodeViewerOpen: boolean;
  setIsCodeViewerOpen: AppLayoutProps['setIsCodeViewerOpen'];
  dragHandlers: AppLayoutDragHandlers;
  isFileDragActive: boolean;
  t: TranslationKeys;
  lang: Language;
  theme: ViewerProps['theme'];
  toolboxItems: HeaderProps['toolboxItems'];
  handleOpenCodeViewer: HeaderProps['onOpenCodeViewer'];
  handlePrefetchCodeViewer: HeaderProps['onPrefetchCodeViewer'];
  handleSnapshot: HeaderProps['onSnapshot'];
  isIkToolPanelOpen: boolean;
  ikLinkOptions: IkToolPanelProps['linkOptions'];
  selectedIkLinkId: IkToolPanelProps['selectedLinkId'];
  selectedIkLinkLabel: IkToolPanelProps['selectedLinkLabel'];
  currentIkLinkLabel: IkToolPanelProps['currentLinkLabel'];
  ikToolSelectionStatus: IkToolPanelProps['selectionStatus'];
  onSelectIkLink: IkToolPanelProps['onSelectLink'];
  onIkToolClose: () => void;
  workspaceLayoutClassNames: WorkspaceLayoutClassNames;
  workspaceOverlaySafeAreaStyle: CSSProperties | undefined;
  workspaceOverlayGizmoMargin: ViewerProps['gizmoMargin'];
  viewerRobot: ViewerProps['robot'];
  editorRobot: ViewerProps['editorRobot'];
  mergedAppMode: ViewerProps['mode'];
  handleViewerSelectWithBridgePreview: ViewerProps['onSelect'];
  handleViewerMeshSelectWithAssemblyClear: ViewerProps['onMeshSelect'];
  handleHover: ViewerProps['onHover'] & PropertyEditorProps['onHover'];
  handleUpdate: ViewerProps['onUpdate'] & TreeEditorProps['onUpdate'] & PropertyEditorProps['onUpdate'];
  viewerAssets: ViewerProps['assets'];
  allFileContents: ViewerProps['allFileContents'];
  showVisual: TreeEditorProps['showVisual'];
  handleSetShowVisual: TreeEditorProps['setShowVisual'];
  handleSetDetailOptionsPanelVisibility: ViewerProps['setShowOptionsPanel'];
  snapshotActionRef: React.RefObject<SnapshotCaptureAction | null>;
  viewerCanvasStateRef: React.MutableRefObject<RootState | null>;
  availableFiles: ViewerProps['availableFiles'];
  urdfContentForViewer: ViewerProps['urdfContent'];
  viewerSourceFormat: ViewerProps['viewerSourceFormat'];
  viewerSourceFilePath: ViewerProps['sourceFilePath'];
  viewerSourceFile: ViewerProps['sourceFile'];
  viewerDocumentLifecycleCallbacks: Pick<
    ViewerProps,
    'onDocumentLoadEvent' | 'onRuntimeRobotLoaded' | 'onRuntimeSceneReadyForDisplay'
  >;
  jointAngleState: ViewerProps['jointAngleState'];
  jointMotionState: ViewerProps['jointMotionState'];
  handleJointChange: ViewerProps['onJointChange'];
  selection: AppLayoutOverlaysProps['selection'];
  focusTarget: ViewerProps['focusTarget'];
  selectedFile: RobotFile | null;
  handleWorkspaceTransformPendingChange: ViewerProps['onTransformPendingChange'];
  handleCollisionTransform: ViewerProps['onCollisionTransform'];
  normalizedAssemblyState: AppLayoutOverlaysProps['assemblyState'];
  shouldRenderAssembly: boolean;
  assemblySelection: ViewerProps['assemblySelection'];
  sourceSceneAssemblyComponentId: ViewerProps['sourceSceneAssemblyComponentId'];
  handleAssemblyTransform: ViewerProps['onAssemblyTransform'];
  handleComponentTransform: ViewerProps['onComponentTransform'];
  handleBridgeTransform: ViewerProps['onBridgeTransform'];
  ikDragActive: ViewerProps['ikDragActive'];
  pendingViewerToolMode: ToolMode | null;
  setPendingViewerToolMode: React.Dispatch<React.SetStateAction<ToolMode | null>>;
  viewerReloadKey: ViewerProps['viewerReloadKey'];
  documentLoadLifecycleState: ViewerProps['documentLoadState'];
  documentLoadState: FilePreviewWindowProps['documentLoadState'];
  importPreparationOverlay: WorkspaceViewerLayerProps['importPreparationOverlay'];
  assemblyComponentPreparationOverlay: ImportPreparationOverlayProps | null;
  previewContextRobot: TreeEditorProps['robot'];
  handleSelectWithAssemblyClear: TreeEditorProps['onSelect'] & PropertyEditorProps['onSelect'];
  handleSelectGeometryWithAssemblyClear: TreeEditorProps['onSelectGeometry'] &
    PropertyEditorProps['onSelectGeometry'];
  handleFocus: TreeEditorProps['onFocus'];
  handleAddChild: TreeEditorProps['onAddChild'];
  handleAddCollisionBody: TreeEditorProps['onAddCollisionBody'];
  handleDelete: TreeEditorProps['onDelete'];
  handleNameChange: TreeEditorProps['onNameChange'];
  leftSidebarCollapsed: boolean;
  rightSidebarCollapsed: boolean;
  onToggleLeftSidebar: () => void;
  onToggleRightSidebar: () => void;
  handlePreviewFileWithFeedback: TreeEditorProps['onLoadRobot'];
  handleRequestLoadRobot: TreeEditorProps['onRequestLoadRobot'];
  handleAddComponent: TreeEditorProps['onAddComponent'];
  handleDeleteLibraryFile: TreeEditorProps['onDeleteLibraryFile'];
  handleDeleteLibraryFolder: TreeEditorProps['onDeleteLibraryFolder'];
  handleRenameLibraryFolder: TreeEditorProps['onRenameLibraryFolder'];
  handleDeleteAllLibraryFiles: TreeEditorProps['onDeleteAllLibraryFiles'];
  handleExportLibraryFile: TreeEditorProps['onExportLibraryFile'];
  handleCreateBridge: TreeEditorProps['onCreateBridge'];
  removeComponent: TreeEditorProps['onRemoveComponent'];
  removeBridge: TreeEditorProps['onRemoveBridge'];
  handleRenameComponent: TreeEditorProps['onRenameComponent'];
  handleSwitchTreeEditorToProMode: TreeEditorProps['onSwitchToProMode'];
  handleRequestSwitchTreeEditorToStructure: TreeEditorProps['onRequestSwitchToStructure'];
  isPreviewingWorkspaceSource: boolean;
  handleJointPreview: TreeEditorProps['onJointAnglePreview'];
  previewFile: FilePreviewWindowProps['file'];
  previewRobot: FilePreviewWindowProps['previewRobot'];
  filePreview: FilePreviewWindowProps['previewState'];
  handleClosePreview: FilePreviewWindowProps['onClose'];
  propertyEditorSelectionContext: PropertyEditorSelectionContextView;
  handleUploadAsset: PropertyEditorProps['onUploadAsset'];
  motorLibrary: PropertyEditorProps['motorLibrary'];
  sourceCodeEditorDocuments: AppLayoutOverlaysProps['sourceCodeDocuments'];
  sourceCodeAutoApply: AppLayoutOverlaysProps['autoApplyEnabled'];
  isCollisionOptimizerOpen: boolean;
  setIsCollisionOptimizerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  collisionOptimizationSource: AppLayoutOverlaysProps['collisionOptimizationSource'];
  handlePreviewCollisionOptimizationTarget: AppLayoutOverlaysProps['onSelectCollisionTarget'];
  handleApplyCollisionOptimization: AppLayoutOverlaysProps['onApplyCollisionOptimization'];
  shouldRenderBridgeModal: AppLayoutOverlaysProps['shouldRenderBridgeModal'];
  isBridgeModalOpen: AppLayoutOverlaysProps['isBridgeModalOpen'];
  handleCloseBridgeModal: AppLayoutOverlaysProps['onCloseBridgeModal'];
  handleCreateBridgeCommit: AppLayoutOverlaysProps['onCreateBridge'];
  handleBridgePreviewChange: AppLayoutOverlaysProps['onPreviewBridgeChange'];
  isSnapshotDialogOpen: boolean;
  isSnapshotCapturing: boolean;
  snapshotPreviewSession: SnapshotPreviewSession | null;
  handleSnapshotPreviewCaptureActionChange: (action: SnapshotCaptureAction | null) => void;
  handleCloseSnapshotDialog: () => void;
  handleCaptureSnapshot: (options: SnapshotCaptureOptions) => Promise<void>;
}

export function AppLayoutView({
  importInputRef,
  importFolderInputRef,
  onOpenExport,
  onExportProject,
  onOpenSettings,
  headerQuickAction,
  headerSecondaryAction,
  viewConfig,
  setViewConfig,
  isCodeViewerOpen,
  setIsCodeViewerOpen,
  dragHandlers,
  isFileDragActive,
  t,
  lang,
  theme,
  toolboxItems,
  handleOpenCodeViewer,
  handlePrefetchCodeViewer,
  handleSnapshot,
  isIkToolPanelOpen,
  ikLinkOptions,
  selectedIkLinkId,
  selectedIkLinkLabel,
  currentIkLinkLabel,
  ikToolSelectionStatus,
  onSelectIkLink,
  onIkToolClose,
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
  assemblyComponentPreparationOverlay,
  previewContextRobot,
  handleSelectWithAssemblyClear,
  handleSelectGeometryWithAssemblyClear,
  handleFocus,
  handleAddChild,
  handleAddCollisionBody,
  handleDelete,
  handleNameChange,
  leftSidebarCollapsed,
  rightSidebarCollapsed,
  onToggleLeftSidebar,
  onToggleRightSidebar,
  handlePreviewFileWithFeedback,
  handleRequestLoadRobot,
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
  handleJointPreview,
  previewFile,
  previewRobot,
  filePreview,
  handleClosePreview,
  propertyEditorSelectionContext,
  handleUploadAsset,
  motorLibrary,
  sourceCodeEditorDocuments,
  sourceCodeAutoApply,
  isCollisionOptimizerOpen,
  setIsCollisionOptimizerOpen,
  collisionOptimizationSource,
  handlePreviewCollisionOptimizationTarget,
  handleApplyCollisionOptimization,
  shouldRenderBridgeModal,
  isBridgeModalOpen,
  handleCloseBridgeModal,
  handleCreateBridgeCommit,
  handleBridgePreviewChange,
  isSnapshotDialogOpen,
  isSnapshotCapturing,
  snapshotPreviewSession,
  handleSnapshotPreviewCaptureActionChange,
  handleCloseSnapshotDialog,
  handleCaptureSnapshot,
}: AppLayoutViewProps) {
  return (
    <div
      className="flex flex-col h-screen font-sans bg-google-light-bg dark:bg-app-bg text-slate-800 dark:text-slate-200"
      onDragEnter={dragHandlers.onDragEnter}
      onDragOver={dragHandlers.onDragOver}
      onDragLeave={dragHandlers.onDragLeave}
      onDrop={dragHandlers.onDrop}
    >
      <FileDropOverlay
        visible={isFileDragActive}
        title={t.dropFilesToImport}
        hint={t.dropFilesToImportHint}
      />

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

      <div className={workspaceLayoutClassNames.root}>
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
            suppressDocumentLoadingOverlay:
              shouldRenderAssembly || Boolean(assemblyComponentPreparationOverlay),
            documentLoadState,
          })}
          importPreparationOverlay={importPreparationOverlay}
        />

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
      </div>

      {isSnapshotDialogOpen ? (
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
      ) : null}

      {assemblyComponentPreparationOverlay ? (
        <ImportPreparationOverlay
          label={assemblyComponentPreparationOverlay.label}
          detail={assemblyComponentPreparationOverlay.detail}
          progress={assemblyComponentPreparationOverlay.progress}
          statusLabel={assemblyComponentPreparationOverlay.statusLabel}
          stageLabel={assemblyComponentPreparationOverlay.stageLabel}
        />
      ) : null}

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
    </div>
  );
}
