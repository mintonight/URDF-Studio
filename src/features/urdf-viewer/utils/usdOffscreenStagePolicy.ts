import type { RobotFile } from '@/types';
import type { ToolMode, URDFViewerProps } from '../types';
import { supportsUsdWorkerRenderer } from './usdWorkerRendererSupport.ts';
import { collectUsdStageOpenRelevantVirtualPaths, toVirtualUsdPath } from './usdPreloadSources.ts';
import { hasBlobBackedLargeUsdaInStageScope } from './usdBlobBackedUsda.ts';

type OffscreenUsdFileLike = Pick<RobotFile, 'name' | 'content' | 'format' | 'blobUrl'>;

interface ShouldUseUsdOffscreenStageOptions {
  toolMode: ToolMode;
  selection?: URDFViewerProps['selection'];
  hoveredSelection?: URDFViewerProps['hoveredSelection'];
  focusTarget?: string | null;
  sourceFile?: OffscreenUsdFileLike | null;
  availableFiles?: OffscreenUsdFileLike[];
  showOrigins?: boolean;
  showJointAxes?: boolean;
  showCenterOfMass?: boolean;
  showInertia?: boolean;
  workerRendererSupported?: boolean;
}

const HAND_ARTICULATION_TOKEN_PATTERN =
  /\b(?:[LR]_(?:thumb|index|middle|ring|pinky)(?:_|\b)|(?:left|right)_(?:thumb|index|middle|ring|pinky)(?:_|\b))/i;
const KNOWN_UNSUPPORTED_OFFSCREEN_BUNDLE_PATTERNS = [/(?:^|\/)h1_2(?:\/|$)/i];
const EMPTY_OFFSCREEN_USD_FILES: OffscreenUsdFileLike[] = [];
const handArticulationSupportCache = new WeakMap<
  OffscreenUsdFileLike,
  WeakMap<OffscreenUsdFileLike[], boolean>
>();

function normalizeUsdFileName(name: string | null | undefined): string {
  return String(name || '')
    .trim()
    .replace(/\\/g, '/');
}

function isUsdFileLike(file: OffscreenUsdFileLike | null | undefined): boolean {
  return Boolean(file && (file.format === 'usd' || /\.usd[a-z]?$/i.test(file.name)));
}

function isPureUsdRootFile(file: OffscreenUsdFileLike | null | undefined): boolean {
  if (!isUsdFileLike(file)) {
    return false;
  }

  return /\.usd$/i.test(normalizeUsdFileName(file.name));
}

function hasUnsupportedHandArticulation({
  sourceFile,
  availableFiles,
}: Pick<ShouldUseUsdOffscreenStageOptions, 'sourceFile' | 'availableFiles'>): boolean {
  if (!isUsdFileLike(sourceFile)) {
    return false;
  }

  const scopedAvailableFiles = availableFiles ?? EMPTY_OFFSCREEN_USD_FILES;
  const cachedResultsBySource = handArticulationSupportCache.get(sourceFile);
  const cachedResult = cachedResultsBySource?.get(scopedAvailableFiles);
  if (cachedResult !== undefined) {
    return cachedResult;
  }

  const relevantPathSet = new Set(
    collectUsdStageOpenRelevantVirtualPaths(sourceFile, scopedAvailableFiles),
  );
  const candidateFiles = [
    sourceFile,
    ...scopedAvailableFiles.filter(
      (file) =>
        isUsdFileLike(file) &&
        file.name !== sourceFile.name &&
        relevantPathSet.has(toVirtualUsdPath(file.name)),
    ),
  ];

  const candidateFileNames = candidateFiles
    .map((file) => normalizeUsdFileName(file?.name))
    .filter((name) => name.length > 0);
  const hasUnsupportedBundlePattern = candidateFileNames.some((name) =>
    KNOWN_UNSUPPORTED_OFFSCREEN_BUNDLE_PATTERNS.some((pattern) => pattern.test(name)),
  );
  const hasUnsupportedToken =
    !hasUnsupportedBundlePattern &&
    candidateFiles.some((file) => {
      if (typeof file.content !== 'string' || file.content.length === 0) {
        return false;
      }
      return HAND_ARTICULATION_TOKEN_PATTERN.test(file.content);
    });
  const nextResult = hasUnsupportedBundlePattern || hasUnsupportedToken;

  const nextCachedResultsBySource =
    cachedResultsBySource ?? new WeakMap<OffscreenUsdFileLike[], boolean>();
  nextCachedResultsBySource.set(scopedAvailableFiles, nextResult);
  if (!cachedResultsBySource) {
    handArticulationSupportCache.set(sourceFile, nextCachedResultsBySource);
  }

  return nextResult;
}

export function shouldUseUsdOffscreenStage({
  toolMode,
  selection,
  hoveredSelection,
  focusTarget,
  sourceFile,
  availableFiles,
  showOrigins = false,
  showJointAxes = false,
  showCenterOfMass = false,
  showInertia = false,
  workerRendererSupported = supportsUsdWorkerRenderer(),
}: ShouldUseUsdOffscreenStageOptions): boolean {
  void selection;
  void hoveredSelection;

  if (!workerRendererSupported) {
    return false;
  }

  if (toolMode !== 'view' && toolMode !== 'select') {
    return false;
  }

  if (showOrigins || showJointAxes || showCenterOfMass || showInertia) {
    return false;
  }

  if (hasUnsupportedHandArticulation({ sourceFile, availableFiles })) {
    return false;
  }

  // Imported Unitree ROS USDA bundles keep very large base/configuration sidecars
  // as blob-backed text placeholders. The current offscreen worker stage-open
  // path can resolve metadata for those bundles, but stage composition still
  // fails to materialize the renderable scene. Keep those imports on the proven
  // main-thread USD stage until the offscreen loader can reliably compose them.
  if (hasBlobBackedLargeUsdaInStageScope(sourceFile, availableFiles)) {
    return false;
  }

  // The current offscreen worker renderer lives in a fullscreen overlay canvas
  // outside the shared WorkspaceCanvas R3F scene. Pure `.usd` robot bundles
  // therefore orbit against a different presentation stack than the workspace
  // ground/grid, which makes models like Unitree B2 feel screen-locked while
  // navigating. Keep `.usd` roots on the proven main-thread stage until the
  // offscreen path participates in the same scene camera/ground presentation.
  if (isPureUsdRootFile(sourceFile)) {
    return false;
  }

  if (typeof focusTarget === 'string' && focusTarget.trim() !== '') {
    return false;
  }

  return true;
}

export function shouldBootstrapUsdOffscreenStage({
  toolMode,
  selection,
  hoveredSelection,
  focusTarget,
  workerRendererSupported = supportsUsdWorkerRenderer(),
}: ShouldUseUsdOffscreenStageOptions): boolean {
  void toolMode;
  void selection;
  void hoveredSelection;
  void focusTarget;
  void workerRendererSupported;

  // The offscreen bootstrap path opens the same USD stage twice during the
  // default interactive load: once in the worker bootstrap renderer and again
  // in the main-thread interactive renderer. That duplicate stage-open work
  // increases USDA load time and can expose transient scene swaps. Keep select
  // mode on the single proven interactive path until the bootstrap handoff is
  // reworked around shared stage-open data and a stable first-frame policy.
  return false;
}
