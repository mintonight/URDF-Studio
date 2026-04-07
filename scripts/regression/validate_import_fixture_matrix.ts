import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';

import { resolveRobotFileData } from '@/core/parsers/importRobotFile';
import type { RobotFile } from '@/types';

type FixtureKind = 'mjcf' | 'sdf' | 'urdf';

type FixtureDefinition = {
  id: string;
  kind: FixtureKind;
  relativePath: string;
  supportRoot?: string;
  minLinks: number;
  minJoints: number;
};

type FixtureSummary = {
  id: string;
  kind: FixtureKind;
  relativePath: string;
  status: string;
  linkCount: number;
  jointCount: number;
  rootLinkId: string | null;
};

const DEFAULT_OUTPUT_PATH = path.resolve('tmp/regression/fixture-import-matrix.json');
const TEXT_FILE_EXTENSIONS = new Set([
  '.material',
  '.sdf',
  '.config',
  '.xml',
  '.mjcf',
  '.urdf',
  '.xacro',
]);

const FIXTURES: FixtureDefinition[] = [
  {
    id: 'mjcf-unitree-go2',
    kind: 'mjcf',
    relativePath: 'test/awesome_robot_descriptions_repos/mujoco_menagerie/unitree_go2/go2.xml',
    supportRoot: 'test/awesome_robot_descriptions_repos/mujoco_menagerie/unitree_go2',
    minLinks: 4,
    minJoints: 3,
  },
  {
    id: 'mjcf-unitree-h1',
    kind: 'mjcf',
    relativePath: 'test/awesome_robot_descriptions_repos/mujoco_menagerie/unitree_h1/h1.xml',
    supportRoot: 'test/awesome_robot_descriptions_repos/mujoco_menagerie/unitree_h1',
    minLinks: 4,
    minJoints: 3,
  },
  {
    id: 'mjcf-franka-panda',
    kind: 'mjcf',
    relativePath:
      'test/awesome_robot_descriptions_repos/mujoco_menagerie/franka_emika_panda/panda.xml',
    supportRoot: 'test/awesome_robot_descriptions_repos/mujoco_menagerie/franka_emika_panda',
    minLinks: 4,
    minJoints: 3,
  },
  {
    id: 'gazebo-camera',
    kind: 'sdf',
    relativePath: 'test/gazebo_models/camera/model.sdf',
    supportRoot: 'test/gazebo_models/camera',
    minLinks: 1,
    minJoints: 0,
  },
  {
    id: 'gazebo-cordless-drill',
    kind: 'sdf',
    relativePath: 'test/gazebo_models/cordless_drill/model.sdf',
    supportRoot: 'test/gazebo_models/cordless_drill',
    minLinks: 1,
    minJoints: 0,
  },
  {
    id: 'gazebo-bus-stop',
    kind: 'sdf',
    relativePath: 'test/gazebo_models/bus_stop/model.sdf',
    supportRoot: 'test/gazebo_models/bus_stop',
    minLinks: 1,
    minJoints: 0,
  },
  {
    id: 'unitree-urdf-go2',
    kind: 'urdf',
    relativePath:
      'test/awesome_robot_descriptions_repos/unitree_ros/robots/go2_description/urdf/go2_description.urdf',
    minLinks: 4,
    minJoints: 3,
  },
  {
    id: 'unitree-urdf-b2',
    kind: 'urdf',
    relativePath:
      'test/awesome_robot_descriptions_repos/unitree_ros/robots/b2_description/urdf/b2_description.urdf',
    minLinks: 4,
    minJoints: 3,
  },
  {
    id: 'unitree-urdf-h1_2',
    kind: 'urdf',
    relativePath:
      'test/awesome_robot_descriptions_repos/unitree_ros/robots/h1_2_description/h1_2.urdf',
    minLinks: 4,
    minJoints: 3,
  },
];

function installDomGlobals() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { contentType: 'text/html' });

  globalThis.window = dom.window as typeof globalThis.window;
  globalThis.document = dom.window.document as typeof globalThis.document;
  globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
  globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;
  globalThis.Node = dom.window.Node as typeof Node;
  globalThis.Element = dom.window.Element as typeof Element;
  globalThis.Document = dom.window.Document as typeof Document;
  globalThis.self = globalThis;
}

function parseArgs(argv: string[]) {
  const options = {
    outputPath: DEFAULT_OUTPUT_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('Missing value for --output');
      }
      options.outputPath = path.resolve(value);
      index += 1;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      console.log(`Usage: node validate_import_fixture_matrix.js [--output <path>]`);
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function collectFiles(
  rootDir: string,
  predicate: (absolutePath: string) => boolean,
): Promise<string[]> {
  const result: string[] = [];

  async function visit(currentDir: string) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (predicate(absolutePath)) {
        result.push(absolutePath);
      }
    }
  }

  await visit(rootDir);
  return result.sort((left, right) => left.localeCompare(right));
}

async function buildMjcfAvailableFiles(rootDir: string): Promise<RobotFile[]> {
  const sourceFiles = await collectFiles(rootDir, (absolutePath) => {
    const extension = path.extname(absolutePath).toLowerCase();
    return extension === '.xml' || extension === '.mjcf';
  });

  return Promise.all(
    sourceFiles.map(async (absolutePath) => ({
      name: absolutePath,
      content: await readFile(absolutePath, 'utf8'),
      format: 'mjcf' as const,
    })),
  );
}

async function buildSdfFileContents(rootDir: string): Promise<Record<string, string>> {
  const textFiles = await collectFiles(rootDir, (absolutePath) =>
    TEXT_FILE_EXTENSIONS.has(path.extname(absolutePath).toLowerCase()),
  );

  const entries = await Promise.all(
    textFiles.map(
      async (absolutePath) => [absolutePath, await readFile(absolutePath, 'utf8')] as const,
    ),
  );

  return Object.fromEntries(entries);
}

async function loadFixture(definition: FixtureDefinition): Promise<FixtureSummary> {
  const absolutePath = path.resolve(definition.relativePath);
  const file: RobotFile = {
    name: absolutePath,
    content: await readFile(absolutePath, 'utf8'),
    format: definition.kind,
  };

  const result =
    definition.kind === 'mjcf'
      ? resolveRobotFileData(file, {
          availableFiles: await buildMjcfAvailableFiles(
            path.resolve(definition.supportRoot ?? path.dirname(definition.relativePath)),
          ),
        })
      : definition.kind === 'sdf'
        ? resolveRobotFileData(file, {
            allFileContents: await buildSdfFileContents(
              path.resolve(definition.supportRoot ?? path.dirname(definition.relativePath)),
            ),
          })
        : resolveRobotFileData(file);

  assert.equal(
    result.status,
    'ready',
    `${definition.id} should parse successfully (got ${result.status})`,
  );

  assert.ok(result.robotData.rootLinkId, `${definition.id} should produce a root link`);
  assert.ok(
    Object.keys(result.robotData.links).length >= definition.minLinks,
    `${definition.id} should produce at least ${definition.minLinks} links`,
  );
  assert.ok(
    Object.keys(result.robotData.joints).length >= definition.minJoints,
    `${definition.id} should produce at least ${definition.minJoints} joints`,
  );

  return {
    id: definition.id,
    kind: definition.kind,
    relativePath: definition.relativePath,
    status: result.status,
    linkCount: Object.keys(result.robotData.links).length,
    jointCount: Object.keys(result.robotData.joints).length,
    rootLinkId: result.robotData.rootLinkId,
  };
}

async function main() {
  installDomGlobals();
  const { outputPath } = parseArgs(process.argv.slice(2));
  const summaries = [] as FixtureSummary[];

  for (const fixture of FIXTURES) {
    summaries.push(await loadFixture(fixture));
  }

  const report = {
    validatedAt: new Date().toISOString(),
    sampleCount: summaries.length,
    summaries,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
