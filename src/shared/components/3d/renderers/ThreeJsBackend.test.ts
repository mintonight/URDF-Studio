import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { ThreeJsBackend, resolveThreeJsBackendSourceFileDirectory } from './ThreeJsBackend';

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
  });

  const visualMeshes = sceneGraph.linkMeshMap.get('base_link:visual') ?? [];
  assert.equal(visualMeshes.length, 1);
  assert.equal(visualMeshes[0].userData.parentLinkName, 'base_link');
  assert.equal(visualMeshes[0].userData.isVisualMesh, true);
});
