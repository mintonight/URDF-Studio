import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const sourceRoot = path.join(repoRoot, 'src');
const sourceFilePattern = /\.(ts|tsx|js|jsx)$/;
const testFilePattern = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
const importPattern =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"`]*?\s+from\s*)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function collectSourceFiles(directory: string, files: string[] = []): string[] {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(entryPath, files);
      continue;
    }

    if (sourceFilePattern.test(entry.name) && !testFilePattern.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

function toRepoPath(filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function resolveLocalImport(importerPath: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) {
    return `src/${specifier.slice(2)}`;
  }

  if (!specifier.startsWith('.')) {
    return null;
  }

  return toRepoPath(path.resolve(path.dirname(importerPath), specifier));
}

function getFeatureName(repoPath: string): string | null {
  const match = /^src\/features\/([^/]+)/.exec(repoPath);
  return match?.[1] ?? null;
}

const layerRanks = new Map([
  ['types', 0],
  ['core', 1],
  ['shared', 2],
  ['store', 3],
  ['features', 4],
  ['app', 5],
]);

const siblingFeatureImportAllowlist = new Set([
  'src/features/editor/index.ts -> ../urdf-viewer',
  'src/features/editor/ik_selection.ts -> ../urdf-viewer/utils/selectedIkDragLink',
  'src/features/editor/panels.ts -> ../urdf-viewer/components/ViewerPanels',
  'src/features/editor/panels.ts -> ../urdf-viewer/hooks/useResponsivePanelLayout',
  'src/features/editor/panels.ts -> ../urdf-viewer/hooks/useViewerController',
  'src/features/editor/usd_bindings.ts -> ../urdf-viewer/utils/usdBindingsAssetPaths',
  'src/features/editor/usd_documents.ts -> ../urdf-viewer/utils/usdPreloadSources',
  'src/features/editor/usd_export.ts -> ../urdf-viewer/utils/usdExportBundle',
  'src/features/editor/usd_hydration.ts -> ../urdf-viewer/utils/usdOffscreenViewerProtocol',
  'src/features/editor/usd_hydration.ts -> ../urdf-viewer/utils/usdPreparedExportCacheWorkerBridge',
  'src/features/editor/usd_hydration.ts -> ../urdf-viewer/utils/usdPreparedExportCacheWorkerTransfer',
  'src/features/editor/usd_hydration.ts -> ../urdf-viewer/utils/viewerRobotData',
  'src/features/editor/usd_offscreen_runtime.ts -> ../urdf-viewer/utils/usdOffscreenViewerWorkerClient',
  'src/features/editor/usd_prewarm.ts -> ../urdf-viewer/utils/preparedUsdStageOpenCache',
  'src/features/editor/usd_prewarm.ts -> ../urdf-viewer/utils/usdBlobBackedUsda',
  'src/features/editor/usd_runtime.ts -> ../urdf-viewer/utils/usdWasmRuntime',
]);

function getLayerName(repoPath: string): string | null {
  const match = /^src\/([^/]+)/.exec(repoPath);
  const layerName = match?.[1] ?? null;
  return layerName && layerRanks.has(layerName) ? layerName : null;
}

function collectLocalImports(filePath: string): Array<{ specifier: string; resolved: string }> {
  const imports: Array<{ specifier: string; resolved: string }> = [];
  const text = fs.readFileSync(filePath, 'utf8');
  let match: RegExpExecArray | null;

  while ((match = importPattern.exec(text))) {
    const specifier = match[1] ?? match[2] ?? '';
    const resolved = resolveLocalImport(filePath, specifier);
    if (resolved) {
      imports.push({ specifier, resolved });
    }
  }

  return imports;
}

test('runtime layer dependencies only point downward', () => {
  const violations: string[] = [];

  for (const filePath of collectSourceFiles(sourceRoot)) {
    const importer = toRepoPath(filePath);
    const importerLayer = getLayerName(importer);
    if (!importerLayer) {
      continue;
    }

    const importerRank = layerRanks.get(importerLayer);
    if (importerRank === undefined) {
      continue;
    }

    for (const { specifier, resolved } of collectLocalImports(filePath)) {
      const targetLayer = getLayerName(resolved);
      const targetRank = targetLayer ? layerRanks.get(targetLayer) : undefined;
      if (!targetLayer || targetRank === undefined || targetRank <= importerRank) {
        continue;
      }

      violations.push(`${importer} -> ${specifier}`);
    }
  }

  assert.deepEqual(violations, []);
});

test('shared runtime code does not import store', () => {
  const violations: string[] = [];

  for (const filePath of collectSourceFiles(path.join(sourceRoot, 'shared'))) {
    for (const { specifier, resolved } of collectLocalImports(filePath)) {
      if (resolved?.startsWith('src/store')) {
        violations.push(`${toRepoPath(filePath)} -> ${specifier}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test('features do not import sibling feature internals', () => {
  const violations: string[] = [];

  for (const filePath of collectSourceFiles(path.join(sourceRoot, 'features'))) {
    const importer = toRepoPath(filePath);
    const importerFeature = getFeatureName(importer);

    for (const { specifier, resolved } of collectLocalImports(filePath)) {
      const targetFeature = resolved ? getFeatureName(resolved) : null;
      if (!importerFeature || !targetFeature || importerFeature === targetFeature) {
        continue;
      }

      if (siblingFeatureImportAllowlist.has(`${importer} -> ${specifier}`)) {
        continue;
      }

      violations.push(`${importer} -> ${specifier}`);
    }
  }

  assert.deepEqual(violations, []);
});

test('public lib feature imports stay limited to the current RobotCanvas bridge exception', () => {
  const libRoot = path.join(sourceRoot, 'lib');
  if (!fs.existsSync(libRoot)) {
    return;
  }

  const violations: string[] = [];
  for (const filePath of collectSourceFiles(libRoot)) {
    for (const { specifier, resolved } of collectLocalImports(filePath)) {
      if (resolved?.startsWith('src/features/')) {
        violations.push(`${toRepoPath(filePath)} -> ${specifier}`);
      }
    }
  }

  assert.deepEqual(violations, [
    'src/lib/components/RobotCanvas.tsx -> ../../features/urdf-viewer/components/ViewerCanvas',
    'src/lib/components/RobotCanvas.tsx -> ../../features/urdf-viewer/components/JointInteraction',
    'src/lib/components/RobotCanvas.tsx -> ../../features/urdf-viewer/components/RobotModel',
  ]);
});

test('urdf-viewer root entrypoint does not expose internal utility barrels', () => {
  const entrypoint = fs.readFileSync(path.join(sourceRoot, 'features/urdf-viewer/index.ts'), 'utf8');

  assert.doesNotMatch(entrypoint, /export\s+\*\s+from\s+['"]\.\/utils['"]/);
  assert.doesNotMatch(entrypoint, /export\s+\*\s+from\s+['"]\.\/hooks['"]/);
});
