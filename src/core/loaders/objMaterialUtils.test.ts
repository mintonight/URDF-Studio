import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';

import { createLoadingManager } from './meshLoader.ts';
import {
  createTextAssetContentLookup,
  deriveObjAuthoredMaterialsFromLookup,
  loadObjScene,
  parseObjMaterialLibraries,
  rewriteMtlTextureReferencesForManager,
} from './objMaterialUtils.ts';

test('rewriteMtlTextureReferencesForManager resolves relative and model texture references through the loading manager', () => {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => `resolved:${url}`);

  const materialText = [
    'newmtl Ambulance',
    '\tmap_Kd ambulance.png',
    '\tmap_Ka model://suv/materials/textures/wheels_01.png',
  ].join('\n');

  const rewritten = rewriteMtlTextureReferencesForManager(
    materialText,
    'test/gazebo_models/ambulance/meshes/ambulance.mtl',
    manager,
  );

  assert.match(rewritten, /resolved:test\/gazebo_models\/ambulance\/meshes\/ambulance\.png/);
  assert.match(rewritten, /resolved:suv\/materials\/textures\/wheels_01\.png/);
});

test('rewriteMtlTextureReferencesForManager preserves texture directive options when rewriting the final path token', () => {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => `resolved:${url}`);

  const rewritten = rewriteMtlTextureReferencesForManager(
    'map_Kd -s 1 1 1 -o 0 0 0 ambulance.png',
    'test/gazebo_models/ambulance/meshes/ambulance.mtl',
    manager,
  );

  assert.match(
    rewritten,
    /^map_Kd -s 1 1 1 -o 0 0 0 resolved:test\/gazebo_models\/ambulance\/meshes\/ambulance\.png$/,
  );
});

test('parseObjMaterialLibraries splits multi-library directives in declaration order', () => {
  const materialLibraries = parseObjMaterialLibraries(
    ['mtllib first.mtl second.mtl', 'mtllib third.mtl'].join('\n'),
  );

  assert.deepEqual(materialLibraries, ['first.mtl', 'second.mtl', 'third.mtl']);
});

test('deriveObjAuthoredMaterialsFromLookup keeps authored materials from every referenced MTL', () => {
  const lookup = createTextAssetContentLookup({
    'robot/model.obj': 'mtllib first.mtl second.mtl',
    'robot/first.mtl': ['newmtl First', 'Kd 1 0 0'].join('\n'),
    'robot/second.mtl': ['newmtl Second', 'map_Kd textures/second.png'].join('\n'),
    'robot/textures/second.png': 'placeholder-texture-bytes',
  });

  const authoredMaterials = deriveObjAuthoredMaterialsFromLookup('robot/model.obj', lookup);

  assert.equal(authoredMaterials.length, 2);
  assert.deepEqual(
    authoredMaterials.map((material) => material.name),
    ['First', 'Second'],
  );
  assert.equal(authoredMaterials[0]?.color, '#ff0000');
  assert.equal(authoredMaterials[1]?.texture, 'robot/textures/second.png');
});

test('loadObjScene merges every reachable material library before parsing MTL content', async () => {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => `resolved:${url}`);

  const originalFetch = globalThis.fetch;
  const originalParse = MTLLoader.prototype.parse;
  const materialTextsSeen: string[] = [];
  const assetTexts = new Map<string, string>([
    [
      'resolved:robot/model.obj',
      [
        'mtllib first.mtl second.mtl',
        'o Mesh',
        'v 0 0 0',
        'v 1 0 0',
        'v 0 1 0',
        'usemtl First',
        'f 1 2 3',
      ].join('\n'),
    ],
    ['resolved:robot/first.mtl', 'newmtl First\nKd 1 0 0'],
    ['resolved:robot/second.mtl', 'newmtl Second\nKd 0 1 0'],
  ]);

  globalThis.fetch = async (input) => {
    const body = assetTexts.get(String(input));
    if (!body) {
      return new Response('', { status: 404, statusText: 'Not Found' });
    }

    return new Response(body, { status: 200, statusText: 'OK' });
  };

  MTLLoader.prototype.parse = function patchedParse(text, path) {
    materialTextsSeen.push(text);
    return originalParse.call(this, text, path);
  };

  try {
    await loadObjScene('robot/model.obj', manager, 'robot/model.obj');
  } finally {
    globalThis.fetch = originalFetch;
    MTLLoader.prototype.parse = originalParse;
  }

  assert.equal(materialTextsSeen.length, 1);
  assert.match(materialTextsSeen[0] ?? '', /newmtl First/);
  assert.match(materialTextsSeen[0] ?? '', /newmtl Second/);
});

test('loadObjScene tolerates missing mtllib files and still parses bare OBJ geometry', async () => {
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => `resolved:${url}`);

  const originalFetch = globalThis.fetch;
  const assetTexts = new Map<string, string>([
    [
      'resolved:robot/model.obj',
      ['mtllib material.mtl', 'o Mesh', 'v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 3'].join('\n'),
    ],
  ]);

  globalThis.fetch = async (input) => {
    const body = assetTexts.get(String(input));
    if (!body) {
      return new Response('', { status: 404, statusText: 'Not Found' });
    }

    return new Response(body, { status: 200, statusText: 'OK' });
  };

  try {
    const scene = await loadObjScene('robot/model.obj', manager, 'robot/model.obj');
    assert.ok(scene.children.length > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('loadObjScene tolerates missing mtllib files under strict asset managers', async () => {
  const manager = createLoadingManager(
    {
      'robot/model.obj': `data:text/plain;charset=utf-8,${encodeURIComponent(
        ['mtllib material.mtl', 'o Mesh', 'v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'f 1 2 3'].join('\n'),
      )}`,
    },
    'robot/',
  );

  const scene = await loadObjScene('robot/model.obj', manager, 'robot/model.obj');
  assert.ok(scene.children.length > 0);
});
