import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

import { ThreeJsBackend, resolveThreeJsBackendSourceFileDirectory } from './ThreeJsBackend';

const rendererSourceDirUrl = new URL('./', import.meta.url);

async function listRendererSourceFiles(dirUrl: URL): Promise<URL[]> {
  const entries = await readdir(dirUrl, { withFileTypes: true });
  const files: URL[] = [];

  for (const entry of entries) {
    const entryUrl = new URL(entry.name, dirUrl);
    if (entry.isDirectory()) {
      const childFiles = await listRendererSourceFiles(new URL(`${entry.name}/`, dirUrl));
      files.push(...childFiles);
      continue;
    }

    if (
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.test.tsx')
    ) {
      files.push(entryUrl);
    }
  }

  return files;
}

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.Document = dom.window.Document as typeof Document;
globalThis.Element = dom.window.Element as typeof Element;

test('resolveThreeJsBackendSourceFileDirectory falls back to RobotFile name for virtual sources', () => {
  assert.equal(
    resolveThreeJsBackendSourceFileDirectory({
      name: 'robots/demo/demo.usd',
      content: '',
      format: 'urdf',
    }),
    'robots/demo/',
  );
});

test('resolveThreeJsBackendSourceFileDirectory prefers explicit path when present', () => {
  assert.equal(
    resolveThreeJsBackendSourceFileDirectory({
      name: 'demo.usd',
      path: 'packages/robot/demo.usd',
    }),
    'packages/robot/',
  );
});

test('ThreeJsBackend normalizes USD ASCII format to the USD backend', () => {
  const backend = new ThreeJsBackend(
    {
      name: 'demo.usda',
      content: '#usda 1.0',
      format: 'usda',
    },
    {},
  );

  assert.equal(backend.format, 'usd');
});

test('shared renderer sources do not import feature urdf-viewer modules', async () => {
  const rendererSourceFiles = await listRendererSourceFiles(rendererSourceDirUrl);

  for (const fileUrl of rendererSourceFiles) {
    const source = await readFile(fileUrl, 'utf8');
    assert.doesNotMatch(
      source,
      /(?:@\/features\/urdf-viewer|features\/urdf-viewer\/)/,
      fileUrl.pathname,
    );
  }
});

test('ThreeJsBackend waits for external URDF meshes before returning the pick map', async () => {
  const urdfContent = `<?xml version="1.0"?>
<robot name="async_mesh_robot">
  <link name="base_link">
    <visual>
      <geometry>
        <mesh filename="meshes/base.obj" />
      </geometry>
    </visual>
  </link>
</robot>`;
  const objContent = [
    'v -0.5 -0.5 0',
    'v 0.5 -0.5 0',
    'v 0 0.5 0',
    'f 1 2 3',
  ].join('\n');
  const assets = {
    'meshes/base.obj': `data:text/plain;charset=utf-8,${encodeURIComponent(objContent)}`,
  };
  const sourceFile = {
    id: 'async-mesh.urdf',
    name: 'async-mesh.urdf',
    content: urdfContent,
    format: 'urdf' as const,
  };

  const backend = new ThreeJsBackend(sourceFile, assets);
  const sceneGraph = await backend.load({
    sourceFile,
    assets,
    showVisual: true,
    showCollision: false,
    showCollisionAlwaysOnTop: true,
    allowUrdfXmlFallback: true,
  });

  const visualMeshes = sceneGraph.linkMeshMap.get('base_link:visual') ?? [];
  assert.equal(visualMeshes.length, 1);
  assert.equal(visualMeshes[0].userData.parentLinkName, 'base_link');
  assert.equal(visualMeshes[0].userData.isVisualMesh, true);
});

test('ThreeJsBackend respects disabled URDF XML fallback when structured state is missing', async () => {
  const urdfContent = `<?xml version="1.0"?>
<robot name="pending_structured_state">
  <link name="base_link" />
</robot>`;
  const sourceFile = {
    id: 'pending-structured-state.urdf',
    name: 'pending-structured-state.urdf',
    content: urdfContent,
    format: 'urdf' as const,
  };

  const backend = new ThreeJsBackend(sourceFile, {});
  const loadProps = {
    sourceFile,
    assets: {},
    showVisual: true,
    showCollision: false,
    showCollisionAlwaysOnTop: true,
    allowUrdfXmlFallback: false,
  } satisfies Parameters<ThreeJsBackend['load']>[0];

  await assert.rejects(() => backend.load(loadProps), {
    message: 'Waiting for structured robot state',
  });
});
