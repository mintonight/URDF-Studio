import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repoRoot = process.cwd();
const sourceRoot = path.join(repoRoot, 'src');
const runtimeSourcePattern = /\.(ts|tsx)$/;
const testFilePattern = /\.(test|spec)\.(ts|tsx)$/;
const defaultRuntimeFileLineBudget = 1000;

const oversizedRuntimeFileLineBudgets: Record<string, number> = {
  'src/features/urdf-viewer/workers/usdOffscreenViewer.worker.ts': 3013,
  'src/shared/components/3d/unified-transform-controls/FusionTransformControls.tsx': 2849,
  'src/shared/debug/regressionBridge.ts': 2566,
  'src/features/urdf-viewer/hooks/useViewerController.ts': 2256,
  'src/core/parsers/mjcf/mjcfParser.ts': 2005,
  'src/core/parsers/mjcf/mjcfGenerator.ts': 1905,
  'src/app/utils/importPreparation.ts': 1803,
  'src/core/parsers/sdf/sdfParser.ts': 1828,
  'src/core/parsers/mjcf/mjcfMeshBackedPrimitiveResolver.ts': 1627,
  'src/core/robot/closedLoops.ts': 1609,
  'src/core/parsers/mjcf/mjcfModel.ts': 1573,
  'src/core/parsers/mjcf/mjcfHierarchyBuilder.ts': 1573,
  'src/app/hooks/workspaceSourceSyncUtils.ts': 1516,
  'src/features/code-editor/components/SourceCodeEditor.tsx': 1487,
  'src/features/property-editor/components/CollisionOptimizationDialog.tsx': 1499,
  'src/features/urdf-viewer/hooks/useMouseInteraction.ts': 1507,
  'src/core/loaders/meshLoader.ts': 1461,
  'src/features/file-io/utils/mjcfMeshExport.ts': 1367,
  'src/core/parsers/mjcf/mjcfSnapshot.ts': 1340,
  'src/features/assembly/components/bridge-create/BridgeCreateModal.tsx': 1272,
  'src/features/property-editor/components/CollisionOptimizationPlanarGraph.tsx': 1267,
  'src/features/urdf-viewer/utils/robotLoaderGeometryPatch.ts': 1269,
  'src/features/property-editor/components/LinkProperties.tsx': 1240,
  'src/core/parsers/meshPathUtils.ts': 1200,
  'src/features/file-io/utils/usdPackageLayers.ts': 1188,
  'src/features/robot-tree/components/tree-editor/TreeStructureGraphDialog.tsx': 1204,
  'src/core/parsers/urdf/loader/buildRuntimeRobotFromState.ts': 1156,
  'src/features/urdf-viewer/components/RobotModel.tsx': 1144,
  'src/core/robot/linkIk.ts': 1134,
  'src/core/parsers/mjcf/mjcfUtils.ts': 1132,
  'src/features/code-editor/utils/urdfSchema.generated.ts': 1126,
  'src/core/parsers/urdf/loader/URDFLoader.ts': 1121,
  'src/app/hooks/sourcePreservingExportUtils.ts': 1025,
  'src/app/utils/mjcfEditableSourcePatch.ts': 1403,
  'src/core/robot/canonicalWorkspace.ts': 1386,
  'src/features/ai-assistant/components/AIInspectionModal.tsx': 1271,
  'src/shared/components/Panel/OptionsPanel.tsx': 1039,
};

function collectRuntimeSourceFiles(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') {
      continue;
    }

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectRuntimeSourceFiles(entryPath, files);
      continue;
    }

    if (runtimeSourcePattern.test(entry.name) && !testFilePattern.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

function toRepoPath(filePath: string): string {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function countLines(filePath: string): number {
  return readFileSync(filePath, 'utf8').split('\n').length;
}

test('runtime source files stay within explicit line-count budgets', () => {
  const violations: string[] = [];
  const seenOversizedFiles = new Set<string>();

  collectRuntimeSourceFiles(sourceRoot).forEach((filePath) => {
    const repoPath = toRepoPath(filePath);
    const lineBudget = oversizedRuntimeFileLineBudgets[repoPath] ?? defaultRuntimeFileLineBudget;
    const lineCount = countLines(filePath);

    if (repoPath in oversizedRuntimeFileLineBudgets) {
      seenOversizedFiles.add(repoPath);
    }

    if (lineCount > lineBudget) {
      violations.push(`${repoPath} has ${lineCount} lines; budget is ${lineBudget}`);
    }
  });

  const staleBudgets = Object.keys(oversizedRuntimeFileLineBudgets).filter(
    (repoPath) => !seenOversizedFiles.has(repoPath),
  );

  assert.deepEqual(violations, []);
  assert.deepEqual(staleBudgets, []);
});
