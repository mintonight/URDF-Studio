import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as THREE from 'three';
import { resolveMJCFSource } from '../../src/core/parsers/mjcf/mjcfSourceResolver';
import {
  fitPrimitiveFromObject3D,
  resolveMJCFMeshBackedPrimitiveGeoms,
} from '../../src/core/parsers/mjcf/mjcfMeshBackedPrimitiveResolver';
import {
  applyMeshAssetTransform,
  resolveMJCFAssetUrl,
} from '../../src/core/parsers/mjcf/mjcfGeometry';
import { parseMJCF } from '../../src/core/parsers/mjcf/mjcfParser';
import { parseMJCFModel } from '../../src/core/parsers/mjcf/mjcfModel';
import {
  createCanonicalSnapshotFromOracleExport,
  createCanonicalSnapshotFromParsedModel,
  diffCanonicalSnapshots,
} from '../../src/core/parsers/mjcf/mjcfSnapshot';
import type { RobotFile } from '../../src/types';

interface CompareCliOptions {
  casePath: string;
  outputPath?: string;
  oracleJsonPath?: string;
  smokeLoad: boolean;
}

interface CompareProjectContext {
  rootDir: string;
  projectFiles: RobotFile[];
  projectAssets: Record<string, string>;
  selectedFile: RobotFile;
}

const SCAN_SCOPE_DEPENDENT_ISSUES = new Set([
  'missing_include',
  'missing_attached_model_asset',
  'missing_attached_model_file',
]);

function resolveUvCommand(): string {
  return process.platform === 'win32' ? 'uv.exe' : 'uv';
}

function installDomGlobals(): void {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { contentType: 'text/html' });
  globalThis.window = dom.window as any;
  globalThis.document = dom.window.document as any;
  globalThis.DOMParser = dom.window.DOMParser as any;
  globalThis.XMLSerializer = dom.window.XMLSerializer as any;
  globalThis.Node = dom.window.Node as any;
  globalThis.Element = dom.window.Element as any;
  globalThis.Document = dom.window.Document as any;
}

function parseArgs(argv: string[]): CompareCliOptions {
  const args = [...argv];
  const casePath = args.shift();
  if (!casePath) {
    throw new Error('Usage: node mjcf_compare.mjs <mjcf-file> [--output path] [--smoke-load]');
  }

  let outputPath: string | undefined;
  let smokeLoad = false;
  let oracleJsonPath: string | undefined;

  while (args.length > 0) {
    const token = args.shift();
    if (token === '--output') {
      outputPath = args.shift();
      continue;
    }
    if (token === '--oracle-json') {
      const value = args.shift();
      oracleJsonPath = value ? path.resolve(value) : undefined;
      continue;
    }
    if (token === '--smoke-load') {
      smokeLoad = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return {
    casePath: path.resolve(casePath),
    outputPath: outputPath ? path.resolve(outputPath) : undefined,
    oracleJsonPath,
    smokeLoad,
  };
}

function collectProjectFiles(rootDir: string): RobotFile[] {
  const files: RobotFile[] = [];

  const visit = (currentDir: string): void => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (ext !== '.xml' && ext !== '.mjcf') {
        continue;
      }

      files.push({
        name: fullPath,
        content: fs.readFileSync(fullPath, 'utf8'),
        format: 'mjcf',
      });
    }
  };

  visit(rootDir);
  return files;
}

function collectProjectAssets(rootDir: string): Record<string, string> {
  const assets: Record<string, string> = {};

  const visit = (currentDir: string): void => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (ext === '.xml' || ext === '.mjcf') {
        continue;
      }

      const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
      assets[relativePath] = fullPath;
    }
  };

  visit(rootDir);
  return assets;
}

function collectAncestorDirectories(startDir: string, stopDir?: string): string[] {
  const directories: string[] = [];
  const normalizedStopDir = stopDir ? path.resolve(stopDir) : null;
  let currentDir = path.resolve(startDir);

  while (true) {
    directories.push(currentDir);
    if (normalizedStopDir && currentDir === normalizedStopDir) {
      break;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return directories;
}

function issuesDependOnScanScope(issues: ReturnType<typeof resolveMJCFSource>['issues']): boolean {
  return issues.some((issue) => SCAN_SCOPE_DEPENDENT_ISSUES.has(issue.kind));
}

function withSuppressedConsoleError<T>(callback: () => T): T {
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    return callback();
  } finally {
    console.error = originalConsoleError;
  }
}

function buildProjectContext(casePath: string): CompareProjectContext {
  const searchRoots = collectAncestorDirectories(path.dirname(casePath), process.cwd());
  let bestMatch: CompareProjectContext | null = null;

  for (const rootDir of searchRoots) {
    const projectFiles = collectProjectFiles(rootDir);
    const selectedFile = projectFiles.find((file) => path.resolve(file.name) === casePath);
    if (!selectedFile) {
      continue;
    }

    bestMatch = {
      rootDir,
      projectFiles,
      projectAssets: collectProjectAssets(rootDir),
      selectedFile,
    };

    const resolvedSource = withSuppressedConsoleError(() =>
      resolveMJCFSource(selectedFile, projectFiles),
    );
    if (!issuesDependOnScanScope(resolvedSource.issues)) {
      return bestMatch;
    }
  }

  if (bestMatch) {
    return bestMatch;
  }

  throw new Error(`MJCF file not found in project scan: ${casePath}`);
}

async function loadLocalMeshObject(
  assetPath: string,
  filePath: string,
): Promise<THREE.Object3D | null> {
  const extension = filePath.split('.').pop()?.toLowerCase() || '';

  if (extension === 'obj') {
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
    return new OBJLoader().parse(fs.readFileSync(assetPath, 'utf8'));
  }

  if (extension === 'stl') {
    const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
    const buffer = fs.readFileSync(assetPath);
    const arrayBuffer = Uint8Array.from(buffer).buffer;
    const geometry = new STLLoader().parse(arrayBuffer);
    return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  }

  if (extension === 'dae') {
    const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
    const loader = new ColladaLoader();
    const result = loader.parse(fs.readFileSync(assetPath, 'utf8'), `${path.dirname(assetPath)}/`);
    return result.scene;
  }

  return null;
}

function buildOracleOutputFilename(casePath: string): string {
  const relativePath = path.relative(process.cwd(), casePath) || path.basename(casePath);
  return relativePath.replace(/[\\/]+/g, '__').replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function createOracleTempDir(): { tempDir: string; uvCacheDir: string } {
  const tempDir = path.resolve('.tmp', 'mjcf-compare');
  const uvCacheDir = path.resolve('.tmp', 'uv-cache');
  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(uvCacheDir, { recursive: true });
  return { tempDir, uvCacheDir };
}

function runOracleJson(casePath: string): any {
  const { tempDir, uvCacheDir } = createOracleTempDir();
  const outputPath = path.join(tempDir, `${buildOracleOutputFilename(casePath)}.oracle.full.json`);

  const result = spawnSync(
    resolveUvCommand(),
    [
      'run',
      '--with',
      'mujoco',
      '--script',
      'scripts/mujoco/read_mjcf.py',
      casePath,
      '--full-json',
      '--output',
      outputPath,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: 'pipe',
      env: {
        ...process.env,
        UV_CACHE_DIR: uvCacheDir,
      },
    },
  );

  if (result.status !== 0) {
    const errorMessage =
      result.error instanceof Error
        ? `${result.error.name}: ${result.error.message}`
        : result.stderr || result.stdout || 'unknown error';
    throw new Error(`Oracle failed with exit code ${result.status}: ${errorMessage}`);
  }

  return parseOracleJsonFile(outputPath);
}

function runOracleResolvedXml(casePath: string): string {
  const { tempDir, uvCacheDir } = createOracleTempDir();
  const outputPath = path.join(
    tempDir,
    `${buildOracleOutputFilename(casePath)}.oracle.resolved.xml`,
  );

  const result = spawnSync(
    resolveUvCommand(),
    [
      'run',
      '--with',
      'mujoco',
      '--script',
      'scripts/mujoco/read_mjcf.py',
      casePath,
      '--dump-xml',
      outputPath,
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: 'pipe',
      env: {
        ...process.env,
        UV_CACHE_DIR: uvCacheDir,
      },
    },
  );

  if (result.status !== 0) {
    const errorMessage =
      result.error instanceof Error
        ? `${result.error.name}: ${result.error.message}`
        : result.stderr || result.stdout || 'unknown error';
    throw new Error(`Oracle failed with exit code ${result.status}: ${errorMessage}`);
  }

  return fs.readFileSync(outputPath, 'utf8');
}

function parseOracleJsonFile(filePath: string): any {
  const text = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(text.replace(/\bNaN\b/g, 'null'));
}

function summarizeRobotState(robotState: ReturnType<typeof parseMJCF>) {
  if (!robotState) {
    return null;
  }

  return {
    name: robotState.name,
    linkCount: Object.keys(robotState.links).length,
    jointCount: Object.keys(robotState.joints).length,
    rootLinkId: robotState.rootLinkId,
  };
}

async function main(): Promise<void> {
  installDomGlobals();
  const options = parseArgs(process.argv.slice(2));
  const projectContext = buildProjectContext(options.casePath);
  const { projectFiles, projectAssets, selectedFile } = projectContext;

  const resolvedSource = resolveMJCFSource(selectedFile, projectFiles);
  const robotState = parseMJCF(resolvedSource.content);
  const parsedModel = parseMJCFModel(resolvedSource.content);
  if (!parsedModel) {
    throw new Error('TS MJCF model parsing failed');
  }

  const resolvedMeshBackedPrimitiveCount = await resolveMJCFMeshBackedPrimitiveGeoms(parsedModel, {
    assets: projectAssets,
    sourceFileDir: resolvedSource.basePath,
    fitPrimitiveFromMeshAsset: async ({ geomType, fitStrategy, meshDef }) => {
      const assetPath = resolveMJCFAssetUrl(meshDef.file, projectAssets, resolvedSource.basePath);
      if (!assetPath) {
        return null;
      }

      const object = await loadLocalMeshObject(assetPath, meshDef.file);
      if (!object) {
        return null;
      }

      const transformed = applyMeshAssetTransform(object, meshDef);
      return fitPrimitiveFromObject3D(transformed, geomType, {
        fitaabb: fitStrategy === 'aabb',
        inertia: meshDef.inertia,
      });
    },
  });

  if (options.smokeLoad) {
    const { loadMJCFToThreeJS } = await import('../../src/core/parsers/mjcf/mjcfLoader');
    await loadMJCFToThreeJS(resolvedSource.content, projectAssets, resolvedSource.basePath);
  }

  const tsSnapshot = createCanonicalSnapshotFromParsedModel(parsedModel, {
    sourceFile: resolvedSource.sourceFile.name,
    effectiveFile: resolvedSource.effectiveFile.name,
  });
  const oracleSnapshot = options.oracleJsonPath
    ? createCanonicalSnapshotFromOracleExport(parseOracleJsonFile(options.oracleJsonPath), {
        sourceFile: resolvedSource.sourceFile.name,
        effectiveFile: resolvedSource.effectiveFile.name,
        angleUnit: parsedModel.compilerSettings.angleUnit,
      })
    : (() => {
        const oracleResolvedXml = runOracleResolvedXml(options.casePath);
        const oracleParsedModel = parseMJCFModel(oracleResolvedXml);
        if (!oracleParsedModel) {
          throw new Error('MuJoCo resolved XML parsing failed');
        }

        return createCanonicalSnapshotFromParsedModel(oracleParsedModel, {
          sourceFile: resolvedSource.sourceFile.name,
          effectiveFile: resolvedSource.effectiveFile.name,
        });
      })();
  const diffs = diffCanonicalSnapshots(oracleSnapshot, tsSnapshot);

  const diffSummary = diffs.reduce<Record<string, number>>((summary, diff) => {
    summary[diff.type] = (summary[diff.type] || 0) + 1;
    return summary;
  }, {});

  const payload = {
    schema: 'urdf-studio.mjcf-compare/v1',
    casePath: options.casePath,
    scanRoot: projectContext.rootDir,
    oracleMode: options.oracleJsonPath ? 'full-json' : 'resolved-xml',
    resolvedSource: {
      sourceFile: resolvedSource.sourceFile.name,
      effectiveFile: resolvedSource.effectiveFile.name,
      basePath: resolvedSource.basePath,
    },
    robotState: summarizeRobotState(robotState),
    resolvedMeshBackedPrimitiveCount: resolvedMeshBackedPrimitiveCount ?? 0,
    oracleCounts: oracleSnapshot.counts,
    tsCounts: tsSnapshot.counts,
    diffSummary,
    diffCount: diffs.length,
    diffs,
  };

  const rendered = `${JSON.stringify(payload, null, 2)}\n`;
  if (options.outputPath) {
    fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
    fs.writeFileSync(options.outputPath, rendered, 'utf8');
    console.log(`MJCF compare written to: ${options.outputPath}`);
    return;
  }

  process.stdout.write(rendered);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
