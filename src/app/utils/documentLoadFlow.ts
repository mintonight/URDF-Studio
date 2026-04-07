import type { LoadingProgressMode, RobotFile } from '@/types';

type DocumentLoadStatus = 'idle' | 'loading' | 'hydrating' | 'ready' | 'error';

interface DocumentLoadStateLike {
  status: DocumentLoadStatus;
  fileName: string | null;
  format?: string | null;
  phase?: string | null;
  message?: string | null;
  progressMode?: LoadingProgressMode | null;
  progressPercent?: number | null;
  loadedCount?: number | null;
  totalCount?: number | null;
}

interface RobotImportResultLike {
  status: 'ready' | 'needs_hydration' | 'error';
  reason?: string;
}

interface RobotLoadSupportContextKeyInput {
  availableFiles: Array<Pick<RobotFile, 'name' | 'format'>>;
  assets: Record<string, string>;
  allFileContents: Record<string, string>;
}

interface ShouldSkipRedundantRobotReloadInput {
  forceReload?: boolean;
  currentSelectedFile: Pick<RobotFile, 'name' | 'format' | 'content' | 'blobUrl'> | null;
  currentDocumentLoadState: DocumentLoadStateLike;
  nextFile: Pick<RobotFile, 'name' | 'format' | 'content' | 'blobUrl'>;
  previousLoadSupportContextKey: string | null;
  nextLoadSupportContextKey: string;
}

interface StaleViewerDocumentLoadEventInput {
  isPreviewing: boolean;
  activeDocumentFileName: string | null;
  documentLoadState: DocumentLoadStateLike;
}

interface PreserveDocumentLoadProgressInput<TDocumentLoadState extends DocumentLoadStateLike> {
  currentState: TDocumentLoadState;
  nextState: TDocumentLoadState;
}

interface ViewerLoadRegressionAfterReadyInput<TDocumentLoadState extends DocumentLoadStateLike> {
  currentState: TDocumentLoadState;
  nextState: TDocumentLoadState;
}

function hashStringList(values: string[]): string {
  let hash = 0x811c9dc5;

  for (const value of values) {
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }

    hash ^= 0x1f;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

export function buildRobotLoadSupportContextKey({
  availableFiles,
  assets,
  allFileContents,
}: RobotLoadSupportContextKeyInput): string {
  const fileEntries = availableFiles
    .map((file) => `${file.format}:${file.name}`)
    .sort((left, right) => left.localeCompare(right));
  const assetKeys = Object.keys(assets).sort((left, right) => left.localeCompare(right));
  const textKeys = Object.keys(allFileContents).sort((left, right) => left.localeCompare(right));

  return [
    `files:${fileEntries.length}:${hashStringList(fileEntries)}`,
    `assets:${assetKeys.length}:${hashStringList(assetKeys)}`,
    `text:${textKeys.length}:${hashStringList(textKeys)}`,
  ].join('|');
}

export function shouldSkipRedundantRobotReload({
  forceReload = false,
  currentSelectedFile,
  currentDocumentLoadState,
  nextFile,
  previousLoadSupportContextKey,
  nextLoadSupportContextKey,
}: ShouldSkipRedundantRobotReloadInput): boolean {
  if (forceReload || !currentSelectedFile) {
    return false;
  }

  const sameFile =
    currentSelectedFile.name === nextFile.name &&
    currentSelectedFile.format === nextFile.format &&
    currentSelectedFile.content === nextFile.content &&
    currentSelectedFile.blobUrl === nextFile.blobUrl;

  if (!sameFile) {
    return false;
  }

  const currentFileLoadErrored =
    currentDocumentLoadState.status === 'error' &&
    currentDocumentLoadState.fileName === currentSelectedFile.name &&
    (currentDocumentLoadState.format ?? null) === (currentSelectedFile.format ?? null);

  if (currentFileLoadErrored) {
    return false;
  }

  return previousLoadSupportContextKey === nextLoadSupportContextKey;
}

export function shouldCommitResolvedRobotSelection(importResult: RobotImportResultLike): boolean {
  // Source-only fragments can be inspected, but they must not replace the
  // active viewer document or the runtime will try to load a non-entrypoint.
  return importResult.status === 'ready' || importResult.status === 'needs_hydration';
}

export function shouldIgnoreStaleViewerDocumentLoadEvent({
  isPreviewing,
  activeDocumentFileName,
  documentLoadState,
}: StaleViewerDocumentLoadEventInput): boolean {
  if (isPreviewing || !activeDocumentFileName) {
    return false;
  }

  return (
    (documentLoadState.status === 'loading' || documentLoadState.status === 'hydrating') &&
    Boolean(documentLoadState.fileName) &&
    documentLoadState.fileName !== activeDocumentFileName
  );
}

export function preserveDocumentLoadProgressForSameFile<
  TDocumentLoadState extends DocumentLoadStateLike,
>({
  currentState,
  nextState,
}: PreserveDocumentLoadProgressInput<TDocumentLoadState>): TDocumentLoadState {
  const currentStateIsActive =
    currentState.status === 'loading' || currentState.status === 'hydrating';
  const nextStateIsActive = nextState.status === 'loading' || nextState.status === 'hydrating';
  const sameFile =
    Boolean(currentState.fileName) &&
    currentState.fileName === nextState.fileName &&
    (currentState.format ?? null) === (nextState.format ?? null);
  const currentHasAdvancedProgress =
    (currentState.phase ?? null) !== 'checking-path' ||
    Number(currentState.progressPercent ?? 0) > 0 ||
    Number(currentState.loadedCount ?? 0) > 0;
  const nextStateWouldResetBootstrapProgress =
    (nextState.phase ?? null) === 'checking-path' &&
    !nextState.message &&
    !Number.isFinite(nextState.progressPercent) &&
    !Number.isFinite(nextState.loadedCount) &&
    !Number.isFinite(nextState.totalCount);

  if (
    !sameFile ||
    !currentStateIsActive ||
    !nextStateIsActive ||
    !currentHasAdvancedProgress ||
    !nextStateWouldResetBootstrapProgress
  ) {
    return nextState;
  }

  return {
    ...nextState,
    phase: currentState.phase ?? nextState.phase ?? null,
    message: currentState.message ?? nextState.message ?? null,
    progressMode: currentState.progressMode ?? nextState.progressMode ?? null,
    progressPercent: currentState.progressPercent ?? nextState.progressPercent ?? null,
    loadedCount: currentState.loadedCount ?? nextState.loadedCount ?? null,
    totalCount: currentState.totalCount ?? nextState.totalCount ?? null,
  };
}

export function shouldIgnoreViewerLoadRegressionAfterReadySameFile<
  TDocumentLoadState extends DocumentLoadStateLike,
>({ currentState, nextState }: ViewerLoadRegressionAfterReadyInput<TDocumentLoadState>): boolean {
  const sameFile =
    Boolean(currentState.fileName) &&
    currentState.fileName === nextState.fileName &&
    (currentState.format ?? null) === (nextState.format ?? null);

  return sameFile && currentState.status === 'ready' && nextState.status === 'loading';
}
