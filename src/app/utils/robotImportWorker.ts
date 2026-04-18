import type {
  ResolveRobotFileDataOptions,
  RobotImportProgress,
  RobotImportResult,
} from '@/core/parsers/importRobotFile';
import type { RobotFile } from '@/types';
import type { GenerateEditableRobotSourceOptions } from './generateEditableRobotSource';
import type { ParseEditableRobotSourceOptions } from './parseEditableRobotSource';
import type { AssemblyTransform, RenderableBounds, RobotData, RobotState } from '@/types';

export interface RobotImportWorkerContextSnapshot {
  availableFiles?: RobotFile[];
  assets?: Record<string, string>;
  allFileContents?: Record<string, string>;
}

export interface SyncRobotImportWorkerContextRequest {
  type: 'sync-context';
  contextId: string;
  context: RobotImportWorkerContextSnapshot;
}

export interface ResolveRobotImportWorkerRequest {
  type: 'resolve-robot-file';
  requestId: number;
  file: RobotFile;
  options: ResolveRobotFileDataOptions;
  contextId?: string;
}

export interface ParseEditableRobotSourceWorkerRequest {
  type: 'parse-editable-robot-source';
  requestId: number;
  options: ParseEditableRobotSourceOptions;
  contextId?: string;
}

export interface GenerateEditableRobotSourceWorkerRequest {
  type: 'generate-editable-robot-source';
  requestId: number;
  options: GenerateEditableRobotSourceOptions;
}

export interface AssemblyPlacementWorkerComponent {
  renderableBounds?: RenderableBounds | null;
  transform?: AssemblyTransform | null;
  robotData?: RobotData | null;
}

export interface PrepareAssemblyComponentWorkerOptions extends ResolveRobotFileDataOptions {
  existingPlacementComponents?: AssemblyPlacementWorkerComponent[];
}

export interface PrepareAssemblyComponentWorkerRequest {
  type: 'prepare-assembly-component';
  requestId: number;
  file: RobotFile;
  options: PrepareAssemblyComponentWorkerOptions;
  componentId: string;
  rootName: string;
  contextId?: string;
}

export interface PreparedAssemblyComponentResult {
  componentId: string;
  displayName: string;
  robotData: RobotData;
  renderableBounds?: RenderableBounds | null;
  suggestedTransform?: AssemblyTransform;
  resolvedUrdfContent: string | null;
  resolvedUrdfSourceFilePath: string | null;
}

export interface ResolveRobotImportWorkerResponse {
  type: 'resolve-robot-file-result' | 'resolve-robot-file-error';
  requestId: number;
  result?: RobotImportResult;
  error?: string;
}

export interface ResolveRobotImportProgressWorkerResponse {
  type: 'resolve-robot-file-progress';
  requestId: number;
  progress: RobotImportProgress;
}

export interface ParseEditableRobotSourceWorkerResponse {
  type: 'parse-editable-robot-source-result' | 'parse-editable-robot-source-error';
  requestId: number;
  result?: RobotState | null;
  error?: string;
}

export interface GenerateEditableRobotSourceWorkerResponse {
  type: 'generate-editable-robot-source-result' | 'generate-editable-robot-source-error';
  requestId: number;
  result?: string;
  error?: string;
}

export interface PrepareAssemblyComponentWorkerResponse {
  type: 'prepare-assembly-component-result' | 'prepare-assembly-component-error';
  requestId: number;
  result?: PreparedAssemblyComponentResult;
  error?: string;
}

export type RobotImportWorkerRequest =
  | SyncRobotImportWorkerContextRequest
  | ResolveRobotImportWorkerRequest
  | ParseEditableRobotSourceWorkerRequest
  | GenerateEditableRobotSourceWorkerRequest
  | PrepareAssemblyComponentWorkerRequest;

export type RobotImportWorkerResponse =
  | ResolveRobotImportWorkerResponse
  | ResolveRobotImportProgressWorkerResponse
  | ParseEditableRobotSourceWorkerResponse
  | GenerateEditableRobotSourceWorkerResponse
  | PrepareAssemblyComponentWorkerResponse;
