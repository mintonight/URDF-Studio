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

test('shared runtime code does not import store', () => {
  const violations: string[] = [];

  for (const filePath of collectSourceFiles(path.join(sourceRoot, 'shared'))) {
    const text = fs.readFileSync(filePath, 'utf8');
    let match: RegExpExecArray | null;
    while ((match = importPattern.exec(text))) {
      const specifier = match[1] ?? match[2] ?? '';
      const resolved = resolveLocalImport(filePath, specifier);
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
    const text = fs.readFileSync(filePath, 'utf8');
    let match: RegExpExecArray | null;

    while ((match = importPattern.exec(text))) {
      const specifier = match[1] ?? match[2] ?? '';
      const resolved = resolveLocalImport(filePath, specifier);
      const targetFeature = resolved ? getFeatureName(resolved) : null;
      if (!importerFeature || !targetFeature || importerFeature === targetFeature) {
        continue;
      }

      if (importerFeature === 'editor' && targetFeature === 'urdf-viewer') {
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
    const text = fs.readFileSync(filePath, 'utf8');
    let match: RegExpExecArray | null;
    while ((match = importPattern.exec(text))) {
      const specifier = match[1] ?? match[2] ?? '';
      const resolved = resolveLocalImport(filePath, specifier);
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
