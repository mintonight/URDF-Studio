/**
 * File I/O Feature Module
 * Handles file import/export operations for URDF, MJCF, USD, Xacro formats
 */

// Types
export type {
  FileFormat,
  AssetFile,
  LibraryFile,
  ImportResult,
  ExportOptions,
  PdfExportOptions,
  ExportProgressState,
} from './types';
export type {
  ExportDialogConfig,
  ExportFormat,
  MjcfExportConfig,
  SdfExportConfig,
  UrdfExportConfig,
  XacroExportConfig,
  UsdExportConfig,
} from './components/ExportDialog';
export type {
  ExportRobotToUsdOptions,
  ExportRobotToUsdPayload,
  ExportRobotToUsdPhase,
  ExportRobotToUsdProgress,
  ProjectExportProgress,
  ProjectExportProgressPhase,
  ProjectImportResult,
  ImportedProjectArchiveData,
  ImportedProjectLibraryFile,
  UsdMeshCompressionOptions,
  ExportProjectParams,
} from './utils';

// Utilities
export {
  detectFormat,
  isRobotDefinitionFile,
  isAssetFile,
  isMotorLibraryFile,
  isMeshFile,
  shouldSkipPath,
  generateBOM,
  createAssetUrls,
  collectReferencedMeshes,
  fetchMeshBlobs,
  downloadBlob,
  prepareMjcfMeshExportAssets,
  assertUsdExportWorkerSupport,
  disposeUsdExportWorker,
  exportRobotToUsd,
  exportRobotToUsdWithWorker,
  getUsdExportWorkerUnsupportedMeshPaths,
  exportLibraryRobotFile,
  getDroppedFiles,
  isUsdExportWorkerSupportedMeshPath,
  createImportPathCollisionMap,
  remapImportedPath,
  exportProject,
  exportProjectWithWorker,
  importProject,
  importProjectWithWorker,
  disposeProjectImportWorker,
  USD_EXPORT_WORKER_SUPPORTED_MESH_EXTENSIONS,
} from './utils';

// Hooks
export { useSnapshot, usePdfExport } from './hooks';

export { ExportDialog } from './components/ExportDialog';
export { ExportProgressDialog } from './components/ExportProgressDialog';
export { DisconnectedWorkspaceUrdfExportDialog } from './components/DisconnectedWorkspaceUrdfExportDialog';
