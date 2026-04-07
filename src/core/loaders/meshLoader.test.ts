import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { JSDOM } from 'jsdom';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';

import { parseURDF } from '@/core/parsers/urdf/parser';

import {
  buildColladaRootNormalizationHints,
  buildAssetIndex,
  createMeshLoader,
  findAssetByIndex,
  findAssetByPath,
  isCoplanarOffsetMaterial,
  resolveManagedAssetUrl,
} from './index';
import { normalizeColladaUpAxis } from './colladaUpAxis';
import {
  canSerializeColladaInWorker,
  disposeColladaParseWorkerPoolClient,
} from './colladaParseWorkerBridge';
import {
  createSceneFromSerializedColladaData,
  parseColladaSceneData,
} from './colladaWorkerSceneData';
import { postProcessColladaScene } from './meshLoader';
import { disposeObjParseWorkerPoolClient } from './objParseWorkerBridge';
import { disposeStlParseWorkerPoolClient } from './stlParseWorkerBridge';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.document = dom.window.document;
globalThis.HTMLImageElement = dom.window.HTMLImageElement as typeof HTMLImageElement;
globalThis.HTMLElement = dom.window.HTMLElement as typeof HTMLElement;
globalThis.Image = dom.window.Image as typeof Image;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;
globalThis.ProgressEvent = dom.window.ProgressEvent as typeof ProgressEvent;

function getFirstRenderable(object: THREE.Object3D): THREE.Object3D {
  const first = object.children[0];
  assert.ok(first, 'expected Collada scene to contain a child object');
  return first;
}

function getFirstMesh(object: THREE.Object3D): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  object.traverse((child) => {
    if (!found && (child as THREE.Mesh).isMesh) {
      found = child as THREE.Mesh;
    }
  });
  assert.ok(found, 'expected Collada scene to contain a mesh');
  return found;
}

function getAllMeshes(object: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  object.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      meshes.push(child as THREE.Mesh);
    }
  });
  return meshes;
}

function getWorldBox(object: THREE.Object3D): THREE.Box3 {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object);
}

function createLegacyMshBuffer({
  positions,
  normals,
  uvs,
  indices,
}: {
  positions: number[];
  normals?: number[];
  uvs?: number[];
  indices?: number[];
}): ArrayBuffer {
  assert.equal(positions.length % 3, 0, 'positions must contain xyz triplets');
  const nvertex = positions.length / 3;
  const nnormal = normals ? normals.length / 3 : 0;
  const ntexcoord = uvs ? uvs.length / 2 : 0;
  const nface = indices ? indices.length / 3 : 0;

  if (normals) {
    assert.equal(normals.length % 3, 0, 'normals must contain xyz triplets');
    assert.equal(nnormal, nvertex, 'legacy msh normals must match vertex count');
  }

  if (uvs) {
    assert.equal(uvs.length % 2, 0, 'uvs must contain uv pairs');
    assert.equal(ntexcoord, nvertex, 'legacy msh uvs must match vertex count');
  }

  if (indices) {
    assert.equal(indices.length % 3, 0, 'indices must contain triangle triplets');
  }

  const byteLength =
    16 +
    positions.length * Float32Array.BYTES_PER_ELEMENT +
    (normals?.length ?? 0) * Float32Array.BYTES_PER_ELEMENT +
    (uvs?.length ?? 0) * Float32Array.BYTES_PER_ELEMENT +
    (indices?.length ?? 0) * Int32Array.BYTES_PER_ELEMENT;
  const buffer = new ArrayBuffer(byteLength);
  const view = new DataView(buffer);
  view.setInt32(0, nvertex, true);
  view.setInt32(4, nnormal, true);
  view.setInt32(8, ntexcoord, true);
  view.setInt32(12, nface, true);

  let byteOffset = 16;
  new Float32Array(buffer, byteOffset, positions.length).set(positions);
  byteOffset += positions.length * Float32Array.BYTES_PER_ELEMENT;

  if (normals) {
    new Float32Array(buffer, byteOffset, normals.length).set(normals);
    byteOffset += normals.length * Float32Array.BYTES_PER_ELEMENT;
  }

  if (uvs) {
    new Float32Array(buffer, byteOffset, uvs.length).set(uvs);
    byteOffset += uvs.length * Float32Array.BYTES_PER_ELEMENT;
  }

  if (indices) {
    new Int32Array(buffer, byteOffset, indices.length).set(indices);
  }

  return buffer;
}

test('createMeshLoader loads legacy MuJoCo msh assets', async () => {
  const mshBuffer = createLegacyMshBuffer({
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
    uvs: [0, 0, 1, 0, 0, 1, 1, 1],
    indices: [0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3],
  });
  const mshDataUrl = `data:application/octet-stream;base64,${Buffer.from(mshBuffer).toString('base64')}`;
  const manager = new THREE.LoadingManager();
  const loadMesh = createMeshLoader(
    {
      'simhive/myo_sim/scene/myosuite_logo.msh': mshDataUrl,
    },
    manager,
    '',
  );

  const loadedObject = await new Promise<THREE.Object3D>((resolve, reject) => {
    loadMesh('simhive/myo_sim/scene/myosuite_logo.msh', manager, (result, err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(result);
    });
  });

  assert.ok(loadedObject instanceof THREE.Mesh);
  const mesh = loadedObject as THREE.Mesh;
  const geometry = mesh.geometry;
  const positions = geometry.getAttribute('position');
  const uvs = geometry.getAttribute('uv');
  const index = geometry.getIndex();

  assert.equal(positions.count, 4);
  assert.deepEqual(Array.from(positions.array), [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
  assert.ok(uvs);
  assert.deepEqual(Array.from(uvs.array), [0, 0, 1, 0, 0, 1, 1, 1]);
  assert.ok(index);
  assert.deepEqual(Array.from(index.array), [0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3]);
});

test('createMeshLoader reuses parsed STL assets for concurrent duplicate requests', async () => {
  const stlContent = [
    'solid triangle',
    'facet normal 0 0 1',
    ' outer loop',
    '  vertex 0 0 0',
    '  vertex 1 0 0',
    '  vertex 0 1 0',
    ' endloop',
    'endfacet',
    'endsolid triangle',
  ].join('\n');
  const stlDataUrl = `data:model/stl;base64,${Buffer.from(stlContent).toString('base64')}`;
  const manager = new THREE.LoadingManager();
  const originalWorker = (globalThis as { Worker?: typeof Worker }).Worker;
  const loadMesh = createMeshLoader(
    {
      'meshes/triangle.stl': stlDataUrl,
      'package://robot_description/meshes/triangle.stl': stlDataUrl,
    },
    manager,
    '',
  );

  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  disposeStlParseWorkerPoolClient();
  delete (globalThis as { Worker?: typeof Worker }).Worker;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    fetchCount += 1;
    return await originalFetch(...args);
  }) as typeof fetch;

  const loadMeshPath = (meshPath: string) =>
    new Promise<THREE.Object3D>((resolve, reject) => {
      loadMesh(meshPath, manager, (result, err) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(result);
      });
    });

  try {
    const [first, second] = await Promise.all([
      loadMeshPath('meshes/triangle.stl'),
      loadMeshPath('package://robot_description/meshes/triangle.stl'),
    ]);

    assert.notEqual(first, second);
    assert.ok(first instanceof THREE.Mesh);
    assert.ok(second instanceof THREE.Mesh);
    assert.equal((first as THREE.Mesh).geometry, (second as THREE.Mesh).geometry);
    assert.equal(fetchCount, 1);
  } finally {
    disposeStlParseWorkerPoolClient();
    if (originalWorker) {
      (globalThis as { Worker?: typeof Worker }).Worker = originalWorker;
    }
    globalThis.fetch = originalFetch;
  }
});

test('createMeshLoader honors a custom yield controller without forcing animation-frame yields', async () => {
  const stlContent = [
    'solid triangle',
    'facet normal 0 0 1',
    ' outer loop',
    '  vertex 0 0 0',
    '  vertex 1 0 0',
    '  vertex 0 1 0',
    ' endloop',
    'endfacet',
    'endsolid triangle',
  ].join('\n');
  const stlDataUrl = `data:model/stl;base64,${Buffer.from(stlContent).toString('base64')}`;
  const manager = new THREE.LoadingManager();
  let customYieldCount = 0;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  let animationFrameYieldCount = 0;

  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    animationFrameYieldCount += 1;
    callback(0);
    return animationFrameYieldCount;
  }) as typeof requestAnimationFrame;

  const loadMesh = createMeshLoader(
    {
      'meshes/triangle.stl': stlDataUrl,
    },
    manager,
    '',
    {
      yieldIfNeeded: async () => {
        customYieldCount += 1;
      },
    },
  );

  try {
    const loadedObject = await new Promise<THREE.Object3D>((resolve, reject) => {
      loadMesh('meshes/triangle.stl', manager, (result, err) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(result);
      });
    });

    assert.ok(loadedObject instanceof THREE.Mesh);
    assert.ok(customYieldCount >= 1);
    assert.equal(animationFrameYieldCount, 0);
  } finally {
    if (originalRequestAnimationFrame) {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    } else {
      delete (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame })
        .requestAnimationFrame;
    }
  }
});

test('createMeshLoader reuses parsed OBJ assets for concurrent duplicate requests', async () => {
  const objContent = [
    'o triangle',
    'v 0 0 0',
    'v 1 0 0',
    'v 0 1 0',
    'vn 0 0 1',
    'usemtl default',
    'f 1//1 2//1 3//1',
  ].join('\n');
  const objDataUrl = `data:text/plain;base64,${Buffer.from(objContent).toString('base64')}`;
  const manager = new THREE.LoadingManager();
  const originalWorker = (globalThis as { Worker?: typeof Worker }).Worker;
  const loadMesh = createMeshLoader(
    {
      'meshes/triangle.obj': objDataUrl,
      'package://robot_description/meshes/triangle.obj': objDataUrl,
    },
    manager,
    '',
  );

  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  disposeObjParseWorkerPoolClient();
  delete (globalThis as { Worker?: typeof Worker }).Worker;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    fetchCount += 1;
    return await originalFetch(...args);
  }) as typeof fetch;

  const loadMeshPath = (meshPath: string) =>
    new Promise<THREE.Object3D>((resolve, reject) => {
      loadMesh(meshPath, manager, (result, err) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(result);
      });
    });

  try {
    const [first, second] = await Promise.all([
      loadMeshPath('meshes/triangle.obj'),
      loadMeshPath('package://robot_description/meshes/triangle.obj'),
    ]);

    assert.notEqual(first, second);
    assert.ok(first instanceof THREE.Group);
    assert.ok(second instanceof THREE.Group);

    const firstMesh = getFirstMesh(first);
    const secondMesh = getFirstMesh(second);
    const firstMaterial = Array.isArray(firstMesh.material)
      ? firstMesh.material[0]
      : firstMesh.material;
    const secondMaterial = Array.isArray(secondMesh.material)
      ? secondMesh.material[0]
      : secondMesh.material;
    assert.equal(firstMesh.geometry, secondMesh.geometry);
    assert.equal(firstMaterial.name, secondMaterial.name);
    assert.equal(fetchCount, 1);
  } finally {
    disposeObjParseWorkerPoolClient();
    if (originalWorker) {
      (globalThis as { Worker?: typeof Worker }).Worker = originalWorker;
    }
    globalThis.fetch = originalFetch;
  }
});

test('parseColladaSceneData round-trips textureless Collada scenes through ObjectLoader JSON serialization', () => {
  const meshPath = 'test/unitree_ros/robots/b2w_description/meshes/base_link.dae';
  const colladaText = fs.readFileSync(meshPath, 'utf8');
  const serializedScene = parseColladaSceneData(colladaText, meshPath);
  const restoredScene = createSceneFromSerializedColladaData(serializedScene);

  assert.ok(restoredScene instanceof THREE.Group);
  assert.equal(restoredScene.children.length > 0, true);

  const referenceLoader = new ColladaLoader();
  const referenceScene = referenceLoader.parse(
    normalizeColladaUpAxis(colladaText).content,
    THREE.LoaderUtils.extractUrlBase(meshPath),
  ).scene;

  const restoredBox = getWorldBox(restoredScene);
  const referenceBox = getWorldBox(referenceScene);

  assert.ok(restoredBox.min.distanceTo(referenceBox.min) < 1e-6);
  assert.ok(restoredBox.max.distanceTo(referenceBox.max) < 1e-6);
});

test('canSerializeColladaInWorker accepts textured and controller-backed Collada assets', () => {
  assert.equal(
    canSerializeColladaInWorker(
      '<COLLADA><library_images><image id="diffuse" /></library_images></COLLADA>',
    ),
    true,
  );
  assert.equal(
    canSerializeColladaInWorker(
      '<COLLADA><library_controllers><controller id="skin" /></library_controllers></COLLADA>',
    ),
    true,
  );
  assert.equal(
    canSerializeColladaInWorker(
      '<COLLADA><library_effects></library_effects><library_images/></COLLADA>',
    ),
    true,
  );
});

test('parseColladaSceneData preserves textured image urls for worker transport', () => {
  const meshPath = 'test/gazebo_models/checkerboard_plane/meshes/checkerboard_plane.dae';
  const colladaText = fs.readFileSync(meshPath, 'utf8');
  const serializedScene = parseColladaSceneData(colladaText, meshPath);
  const sceneJson = serializedScene.sceneJson as {
    images?: Array<{ url?: string | string[]; uuid?: string }>;
    materials?: Array<Record<string, unknown>>;
    textures?: Array<Record<string, unknown>>;
  };

  const serializedImages = sceneJson.images ?? [];
  const checkerImage = serializedImages.find((entry) =>
    String(entry.url || '').includes('checker.png'),
  );
  assert.ok(checkerImage, 'expected textured Collada export to preserve checker.png image url');

  assert.ok(
    (sceneJson.textures?.length ?? 0) > 0,
    'expected textured Collada export to include texture records',
  );
  assert.ok(
    (sceneJson.materials ?? []).some((entry) => 'map' in entry),
    'expected textured Collada export to preserve material map references',
  );
});

test('createSceneFromSerializedColladaData round-trips textured Collada scenes with image sources intact', () => {
  const meshPath = 'test/gazebo_models/checkerboard_plane/meshes/checkerboard_plane.dae';
  const colladaText = fs.readFileSync(meshPath, 'utf8');
  const serializedScene = parseColladaSceneData(colladaText, meshPath);
  const restoredScene = createSceneFromSerializedColladaData(serializedScene);
  const restoredMesh = getFirstMesh(restoredScene);
  const restoredMaterial = restoredMesh.material as THREE.MeshPhongMaterial;

  assert.ok(restoredMaterial.map, 'expected textured Collada scene to restore material.map');
  assert.ok(
    restoredMaterial.map.source.data instanceof dom.window.HTMLImageElement,
    'expected textured Collada scene to restore an HTML image source',
  );
  assert.match(restoredMaterial.map.source.data.src, /checker\.png$/);
});

test('createMeshLoader normalizes go2 Collada scene roots for unitree DAE assets', async () => {
  const meshPath = 'test/unitree_ros/robots/go2_description/dae/hip.dae';
  const urdfContent = fs.readFileSync(
    'test/unitree_ros/robots/go2_description/urdf/go2_description.urdf',
    'utf8',
  );
  const colladaRootNormalizationHints = buildColladaRootNormalizationHints(
    parseURDF(urdfContent).links,
  );
  const meshDataUrl = `data:text/xml;base64,${Buffer.from(fs.readFileSync(meshPath, 'utf8')).toString('base64')}`;
  const manager = new THREE.LoadingManager();
  const loadMesh = createMeshLoader(
    {
      [meshPath]: meshDataUrl,
      'package://go2_description/dae/hip.dae': meshDataUrl,
      'hip.dae': meshDataUrl,
    },
    manager,
    '',
    { colladaRootNormalizationHints },
  );

  disposeColladaParseWorkerPoolClient();
  const loadedObject = await new Promise<THREE.Object3D>((resolve, reject) => {
    loadMesh('package://go2_description/dae/hip.dae', manager, (result, err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(result);
    });
  });

  assert.ok(Math.abs(loadedObject.rotation.x) < 1e-6);
  assert.ok(Math.abs(loadedObject.rotation.y) < 1e-6);
  assert.ok(Math.abs(loadedObject.rotation.z) < 1e-6);
  assert.ok(Math.abs(loadedObject.quaternion.x) < 1e-6);
  assert.ok(Math.abs(loadedObject.quaternion.y) < 1e-6);
  assert.ok(Math.abs(loadedObject.quaternion.z) < 1e-6);
  assert.ok(Math.abs(loadedObject.quaternion.w - 1) < 1e-6);
});

test('createMeshLoader normalizes go2 Collada scene roots for exported zip mesh paths', async () => {
  const meshPath = 'test/unitree_ros/robots/go2_description/dae/hip.dae';
  const urdfContent = fs.readFileSync(
    'test/unitree_ros/robots/go2_description/urdf/go2_description.urdf',
    'utf8',
  );
  const colladaRootNormalizationHints = buildColladaRootNormalizationHints(
    parseURDF(urdfContent).links,
  );
  const meshDataUrl = `data:text/xml;base64,${Buffer.from(fs.readFileSync(meshPath, 'utf8')).toString('base64')}`;
  const manager = new THREE.LoadingManager();
  const loadMesh = createMeshLoader(
    {
      [meshPath]: meshDataUrl,
      'meshes/dae/hip.dae': meshDataUrl,
      'package://go2_description/meshes/dae/hip.dae': meshDataUrl,
      'hip.dae': meshDataUrl,
    },
    manager,
    '',
    { colladaRootNormalizationHints },
  );

  const loadedObject = await new Promise<THREE.Object3D>((resolve, reject) => {
    loadMesh('package://go2_description/meshes/dae/hip.dae', manager, (result, err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(result);
    });
  });

  assert.ok(Math.abs(loadedObject.rotation.x) < 1e-6);
  assert.ok(Math.abs(loadedObject.rotation.y) < 1e-6);
  assert.ok(Math.abs(loadedObject.rotation.z) < 1e-6);
  assert.ok(Math.abs(loadedObject.quaternion.x) < 1e-6);
  assert.ok(Math.abs(loadedObject.quaternion.y) < 1e-6);
  assert.ok(Math.abs(loadedObject.quaternion.z) < 1e-6);
  assert.ok(Math.abs(loadedObject.quaternion.w - 1) < 1e-6);
});

test('createMeshLoader keeps b2w Collada package meshes in Z-up robot space', async () => {
  const meshPath = 'test/unitree_ros/robots/b2w_description/meshes/RL_thigh.dae';
  const urdfContent = fs.readFileSync(
    'test/unitree_ros/robots/b2w_description/urdf/b2w_description.urdf',
    'utf8',
  );
  const colladaRootNormalizationHints = buildColladaRootNormalizationHints(
    parseURDF(urdfContent).links,
  );
  const meshDataUrl = `data:text/xml;base64,${Buffer.from(fs.readFileSync(meshPath, 'utf8')).toString('base64')}`;
  const manager = new THREE.LoadingManager();
  const loadMesh = createMeshLoader(
    {
      [meshPath]: meshDataUrl,
      'package://b2w_description/meshes/RL_thigh.dae': meshDataUrl,
      'RL_thigh.dae': meshDataUrl,
    },
    manager,
    '',
    { colladaRootNormalizationHints },
  );

  const loadedObject = await new Promise<THREE.Object3D>((resolve, reject) => {
    loadMesh('package://b2w_description/meshes/RL_thigh.dae', manager, (result, err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(result);
    });
  });

  assert.ok(Math.abs(loadedObject.rotation.x) < 1e-6);
  assert.ok(Math.abs(loadedObject.rotation.y) < 1e-6);
  assert.ok(Math.abs(loadedObject.rotation.z) < 1e-6);
  assert.ok(Math.abs(loadedObject.quaternion.x) < 1e-6);
  assert.ok(Math.abs(loadedObject.quaternion.y) < 1e-6);
  assert.ok(Math.abs(loadedObject.quaternion.z) < 1e-6);
  assert.ok(Math.abs(loadedObject.quaternion.w - 1) < 1e-6);
});

test('createMeshLoader keeps b2 Collada package meshes in Z-up robot space', async () => {
  const meshPath = 'test/unitree_ros/robots/b2_description/meshes/RL_thigh.dae';
  const urdfContent = fs.readFileSync(
    'test/unitree_ros/robots/b2_description/urdf/b2_description.urdf',
    'utf8',
  );
  const colladaRootNormalizationHints = buildColladaRootNormalizationHints(
    parseURDF(urdfContent).links,
  );
  const meshDataUrl = `data:text/xml;base64,${Buffer.from(fs.readFileSync(meshPath, 'utf8')).toString('base64')}`;
  const manager = new THREE.LoadingManager();
  const loadMesh = createMeshLoader(
    {
      [meshPath]: meshDataUrl,
      'package://b2_description/meshes/RL_thigh.dae': meshDataUrl,
      'RL_thigh.dae': meshDataUrl,
    },
    manager,
    '',
    { colladaRootNormalizationHints },
  );

  const loadedObject = await new Promise<THREE.Object3D>((resolve, reject) => {
    loadMesh('package://b2_description/meshes/RL_thigh.dae', manager, (result, err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(result);
    });
  });

  assert.ok(Math.abs(loadedObject.rotation.x) < 1e-6);
  assert.ok(Math.abs(loadedObject.rotation.y) < 1e-6);
  assert.ok(Math.abs(loadedObject.rotation.z) < 1e-6);
  assert.ok(Math.abs(loadedObject.quaternion.x) < 1e-6);
  assert.ok(Math.abs(loadedObject.quaternion.y) < 1e-6);
  assert.ok(Math.abs(loadedObject.quaternion.z) < 1e-6);
  assert.ok(Math.abs(loadedObject.quaternion.w - 1) < 1e-6);
});

test('createMeshLoader offsets duplicated coplanar material subsets in b2 base_link.dae', async () => {
  const meshPath = 'test/unitree_ros/robots/b2_description/meshes/base_link.dae';
  const urdfContent = fs.readFileSync(
    'test/unitree_ros/robots/b2_description/urdf/b2_description.urdf',
    'utf8',
  );
  const colladaRootNormalizationHints = buildColladaRootNormalizationHints(
    parseURDF(urdfContent).links,
  );
  const meshDataUrl = `data:text/xml;base64,${Buffer.from(fs.readFileSync(meshPath, 'utf8')).toString('base64')}`;
  const manager = new THREE.LoadingManager();
  const loadMesh = createMeshLoader(
    {
      [meshPath]: meshDataUrl,
      'package://b2_description/meshes/base_link.dae': meshDataUrl,
      'base_link.dae': meshDataUrl,
    },
    manager,
    '',
    { colladaRootNormalizationHints },
  );

  const loadedObject = await new Promise<THREE.Object3D>((resolve, reject) => {
    loadMesh('package://b2_description/meshes/base_link.dae', manager, (result, err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(result);
    });
  });

  const mesh = getFirstMesh(loadedObject);
  assert.ok(
    Array.isArray(mesh.material),
    'expected b2 base_link to keep multi-material Collada materials',
  );

  const materials = mesh.material as THREE.Material[];
  assert.equal(materials[0]?.name, '磨砂铝合金.011');
  assert.equal(materials[1]?.name, 'logo.001');
  assert.equal(materials[2]?.name, '材质.023');
  assert.equal(materials[3]?.name, '材质.024');
  assert.equal(materials[4]?.name, '材质.023');
  assert.equal(materials[5]?.name, '材质.023');
  assert.equal(isCoplanarOffsetMaterial(materials[0]), false);
  assert.equal(isCoplanarOffsetMaterial(materials[1]), true);
  assert.equal(isCoplanarOffsetMaterial(materials[2]), false);
  assert.equal(isCoplanarOffsetMaterial(materials[3]), true);
  assert.equal(isCoplanarOffsetMaterial(materials[4]), true);
  assert.equal(isCoplanarOffsetMaterial(materials[5]), true);
  assert.equal(materials[1].polygonOffsetFactor, -3);
  assert.equal(materials[1].polygonOffsetUnits, -4);
  assert.equal(materials[4].polygonOffsetFactor, -2);
  assert.equal(materials[4].polygonOffsetUnits, -2);
  assert.equal(materials[5].polygonOffsetFactor, -4);
  assert.equal(materials[5].polygonOffsetUnits, -6);
});

test('createMeshLoader offsets near-coplanar shell materials in b2 calf.dae', async () => {
  const meshPath = 'test/unitree_ros/robots/b2_description/meshes/calf.dae';
  const urdfContent = fs.readFileSync(
    'test/unitree_ros/robots/b2_description/urdf/b2_description.urdf',
    'utf8',
  );
  const colladaRootNormalizationHints = buildColladaRootNormalizationHints(
    parseURDF(urdfContent).links,
  );
  const meshDataUrl = `data:text/xml;base64,${Buffer.from(fs.readFileSync(meshPath, 'utf8')).toString('base64')}`;
  const manager = new THREE.LoadingManager();
  const loadMesh = createMeshLoader(
    {
      [meshPath]: meshDataUrl,
      'package://b2_description/meshes/calf.dae': meshDataUrl,
      'calf.dae': meshDataUrl,
    },
    manager,
    '',
    { colladaRootNormalizationHints },
  );

  const loadedObject = await new Promise<THREE.Object3D>((resolve, reject) => {
    loadMesh('package://b2_description/meshes/calf.dae', manager, (result, err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(result);
    });
  });

  const meshes = getAllMeshes(loadedObject);
  const adjustedMaterials = meshes.flatMap((mesh) => {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    return materials.filter((material) => isCoplanarOffsetMaterial(material));
  });

  assert.ok(adjustedMaterials.length > 0, 'expected b2 calf to receive coplanar material offsets');
  adjustedMaterials.forEach((material) => {
    assert.equal(material.polygonOffset, true);
    assert.equal(material.polygonOffsetFactor, -2);
    assert.equal(material.polygonOffsetUnits, -2);
  });
});

test('postProcessColladaScene removes embedded Collada lights without touching mesh content', () => {
  const root = new THREE.Group();
  const light = new THREE.PointLight(0xffffff, 1);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x999999 }),
  );

  root.add(light);
  root.add(mesh);

  const maxDimension = postProcessColladaScene(root);

  const lightsAfterProcess: THREE.Light[] = [];
  root.traverse((child) => {
    if ((child as THREE.Light).isLight) {
      lightsAfterProcess.push(child as THREE.Light);
    }
  });

  assert.equal(lightsAfterProcess.length, 0);
  assert.equal(root.children.includes(mesh), true);
  assert.equal(maxDimension, 1);
});

test('createMeshLoader keeps the b2 RR_thigh silicone shell ahead of the aluminum insert', async () => {
  const meshPath = 'test/unitree_ros/robots/b2_description/meshes/RR_thigh.dae';
  const urdfContent = fs.readFileSync(
    'test/unitree_ros/robots/b2_description/urdf/b2_description.urdf',
    'utf8',
  );
  const colladaRootNormalizationHints = buildColladaRootNormalizationHints(
    parseURDF(urdfContent).links,
  );
  const meshDataUrl = `data:text/xml;base64,${Buffer.from(fs.readFileSync(meshPath, 'utf8')).toString('base64')}`;
  const manager = new THREE.LoadingManager();
  const loadMesh = createMeshLoader(
    {
      [meshPath]: meshDataUrl,
      'package://b2_description/meshes/RR_thigh.dae': meshDataUrl,
      'RR_thigh.dae': meshDataUrl,
    },
    manager,
    '',
    { colladaRootNormalizationHints },
  );

  const loadedObject = await new Promise<THREE.Object3D>((resolve, reject) => {
    loadMesh('package://b2_description/meshes/RR_thigh.dae', manager, (result, err) => {
      if (err) {
        reject(err);
        return;
      }

      resolve(result);
    });
  });

  const mesh = getFirstMesh(loadedObject);
  assert.ok(
    Array.isArray(mesh.material),
    'expected b2 RR_thigh to keep multi-material Collada materials',
  );

  const materials = mesh.material as THREE.Material[];
  assert.equal(materials[0]?.name, '磨砂铝合金.008');
  assert.equal(materials[1]?.name, '灰色硅胶.009');
  assert.equal(isCoplanarOffsetMaterial(materials[0]), false);
  assert.equal(isCoplanarOffsetMaterial(materials[1]), true);
});

test('findAssetByPath resolves package-prefixed b2w mesh paths against imported zip assets', () => {
  const assets = {
    'meshes/RR_thigh.dae': 'blob:rr-thigh',
  };

  assert.equal(findAssetByPath('/b2w_description/meshes/RR_thigh.dae', assets), 'blob:rr-thigh');
  assert.equal(findAssetByPath('b2w_description/meshes/RR_thigh.dae', assets), 'blob:rr-thigh');
});

test('findAssetByPath resolves deep myosuite MJCF relative asset paths against imported zip assets', () => {
  const assets = {
    'myosuite-main/myosuite/simhive/myo_sim/meshes/humerus.stl': 'blob:humerus',
    'myosuite-main/myosuite/simhive/myo_sim/scene/myosuite_scene_noFloor.msh': 'blob:scene-msh',
  };

  assert.equal(
    findAssetByPath(
      '../../../../simhive/myo_sim/../myo_sim/meshes/humerus.stl',
      assets,
      'myosuite-main/myosuite/envs/myo/assets/hand/',
    ),
    'blob:humerus',
  );
  assert.equal(
    findAssetByPath(
      '../../../../simhive/myo_sim/../myo_sim/scene/myosuite_scene_noFloor.msh',
      assets,
      'myosuite-main/myosuite/envs/myo/assets/hand/',
    ),
    'blob:scene-msh',
  );
});

test('findAssetByPath prefers exact b2w rear hip assets over generic hip aliases', () => {
  const assets = {
    'robots/b2w_description/meshes/hip.dae': 'blob:generic-hip',
    'robots/b2w_description/meshes/FL_hip.dae': 'blob:fl-hip',
    'robots/b2w_description/meshes/RL_hip.dae': 'blob:rl-hip',
    'robots/b2w_description/meshes/RR_hip.dae': 'blob:rr-hip',
  };

  assert.equal(
    findAssetByPath('/b2w_description/meshes/RL_hip.dae', assets, 'robots/b2w_description/urdf/'),
    'blob:rl-hip',
  );
  assert.equal(
    findAssetByPath('/b2w_description/meshes/RR_hip.dae', assets, 'robots/b2w_description/urdf/'),
    'blob:rr-hip',
  );
});

test('findAssetByIndex resolves package-prefixed b2w mesh paths against imported zip assets', () => {
  const assets = {
    'meshes/RR_thigh.dae': 'blob:rr-thigh',
  };
  const index = buildAssetIndex(assets);

  assert.equal(findAssetByIndex('/b2w_description/meshes/RR_thigh.dae', index), 'blob:rr-thigh');
  assert.equal(findAssetByIndex('b2w_description/meshes/RR_thigh.dae', index), 'blob:rr-thigh');
});

test('findAssetByIndex resolves deep myosuite MJCF relative asset paths against imported zip assets', () => {
  const assets = {
    'myosuite-main/myosuite/simhive/myo_sim/meshes/humerus.stl': 'blob:humerus',
    'myosuite-main/myosuite/simhive/myo_sim/scene/myosuite_scene_noFloor.msh': 'blob:scene-msh',
  };
  const index = buildAssetIndex(assets, 'myosuite-main/myosuite/envs/myo/assets/hand/');

  assert.equal(
    findAssetByIndex(
      '../../../../simhive/myo_sim/../myo_sim/meshes/humerus.stl',
      index,
      'myosuite-main/myosuite/envs/myo/assets/hand/',
    ),
    'blob:humerus',
  );
  assert.equal(
    findAssetByIndex(
      '../../../../simhive/myo_sim/../myo_sim/scene/myosuite_scene_noFloor.msh',
      index,
      'myosuite-main/myosuite/envs/myo/assets/hand/',
    ),
    'blob:scene-msh',
  );
});

test('findAssetByIndex prefers package-relative folder import matches over same-filename fallbacks', () => {
  const assets = {
    'ros_kortex/kortex_description/arms/gen3/6dof/meshes/base_link.STL': 'blob:gen3-base',
    'ros_kortex/kortex_description/arms/gen3_lite/6dof/meshes/base_link.STL': 'blob:gen3-lite-base',
  };
  const index = buildAssetIndex(assets, 'ros_kortex/kortex_description/robots/');

  assert.equal(
    findAssetByIndex(
      'package://kortex_description/arms/gen3/6dof/meshes/base_link.STL',
      index,
      'ros_kortex/kortex_description/robots/',
    ),
    'blob:gen3-base',
  );
});

test('findAssetByIndex resolves package paths against folder import roots even when the package name is absent from urdfDir', () => {
  const assets = {
    'onshape-to-robot-examples/sigmaban2019_urdf/assets/merged/tronc_visual.stl':
      'blob:tronc-visual',
  };
  const index = buildAssetIndex(assets, 'onshape-to-robot-examples/sigmaban2019_urdf/');

  assert.equal(
    findAssetByIndex(
      'package://assets/merged/tronc_visual.stl',
      index,
      'onshape-to-robot-examples/sigmaban2019_urdf/',
    ),
    'blob:tronc-visual',
  );
});

test('findAssetByIndex prefers the closest folder-import match when package name differs from repo folder name', () => {
  const assets = {
    'robot-description/pointfoot/PF_P441A/meshes/base_Link.STL': 'blob:pf-p441a-base',
    'robot-description/pointfoot/WF_TRON1B/meshes/base_Link.STL': 'blob:wf-tron1b-base',
  };
  const index = buildAssetIndex(assets, 'robot-description/pointfoot/PF_P441A/urdf/');

  assert.equal(
    findAssetByIndex(
      'package://robot_description/pointfoot/PF_P441A/meshes/base_Link.STL',
      index,
      'robot-description/pointfoot/PF_P441A/urdf/',
    ),
    'blob:pf-p441a-base',
  );
});

test('findAssetByIndex resolves absolute urdf-loader package paths when the repo folder name differs from the package name', () => {
  const assets = {
    'talos-data/meshes/arm/arm_1_collision.STL': 'blob:talos-arm-1-collision',
  };
  const index = buildAssetIndex(assets, 'talos-data/robots/');

  assert.equal(
    findAssetByIndex('/talos_data/meshes/arm/arm_1_collision.STL', index, 'talos-data/robots/'),
    'blob:talos-arm-1-collision',
  );
});

test('findAssetByIndex ranks filename-only package fallbacks by the closest urdf neighborhood', () => {
  const assets = {
    'onshape-to-robot-examples/dog_urdf/assets/mounting_cube_25_30.stl': 'blob:dog-cube',
    'onshape-to-robot-examples/field_urdf/assets/mounting_cube_25_30.stl': 'blob:field-cube',
  };
  const index = buildAssetIndex(assets, 'onshape-to-robot-examples/dog_mujoco/');

  assert.equal(
    findAssetByIndex(
      'package://mounting_cube_25_30.stl',
      index,
      'onshape-to-robot-examples/dog_mujoco/',
    ),
    'blob:dog-cube',
  );
});

test('findAssetByIndex preserves visual versus collision mesh selection for same-filename folder-import assets', () => {
  const assets = {
    'halodi-robot-models/robotiq_2f_85_gripper_visualization/meshes/visual/robotiq_arg2f_85_inner_knuckle.dae':
      'blob:visual',
    'halodi-robot-models/robotiq_2f_85_gripper_visualization/meshes/collision/robotiq_arg2f_85_inner_knuckle.dae':
      'blob:collision',
  };
  const index = buildAssetIndex(assets, 'halodi-robot-models/robotiq_2f_85_gripper_visualization/');

  assert.equal(
    findAssetByIndex(
      'package://robotiq_2f_85_gripper_visualization/meshes/visual/robotiq_arg2f_85_inner_knuckle.dae',
      index,
      'halodi-robot-models/robotiq_2f_85_gripper_visualization/',
    ),
    'blob:visual',
  );
  assert.equal(
    findAssetByIndex(
      'package://robotiq_2f_85_gripper_visualization/meshes/collision/robotiq_arg2f_85_inner_knuckle.dae',
      index,
      'halodi-robot-models/robotiq_2f_85_gripper_visualization/',
    ),
    'blob:collision',
  );
});

test('findAssetByIndex approximates legacy filename stems when the repo only contains suffixed link meshes', () => {
  const assets = {
    'ros_kortex/kortex_description/arms/gen3_lite/6dof/meshes/base_link.STL': 'blob:base-link',
    'ros_kortex/kortex_description/grippers/gen3_lite_2f/meshes/gripper_base_link.STL':
      'blob:gripper-base-link',
  };
  const index = buildAssetIndex(assets, 'ros_kortex/kortex_description/arms/gen3_lite/6dof/urdf/');

  assert.equal(
    findAssetByIndex(
      'package://kortex_description/gen3_lite/meshes/BASE.STL',
      index,
      'ros_kortex/kortex_description/arms/gen3_lite/6dof/urdf/',
    ),
    'blob:base-link',
  );
});

test('findAssetByIndex strips visual and collision filename suffix aliases when the canonical mesh exists', () => {
  const assets = {
    'onshape-to-robot-examples/quadruped_sdf/doubleu.stl': 'blob:doubleu',
    'onshape-to-robot-examples/quadruped_sdf/doubleu_2.stl': 'blob:doubleu-2',
  };
  const index = buildAssetIndex(assets, 'onshape-to-robot-examples/quadruped_sdf/');

  assert.equal(
    findAssetByIndex(
      'package:///doubleu_visual.stl',
      index,
      'onshape-to-robot-examples/quadruped_sdf/',
    ),
    'blob:doubleu',
  );
});

test('findAssetByIndex resolves Romeo local .mesh references to imported visual DAE assets', () => {
  const assets = {
    'example-robot-data/robots/romeo_description/meshes/V1/visual/LHipPitch.dae':
      'blob:lhip-visual',
    'example-robot-data/robots/romeo_description/meshes/V1/collision/LHipPitch.dae':
      'blob:lhip-collision',
  };
  const index = buildAssetIndex(assets, 'example-robot-data/robots/romeo_description/urdf/');

  assert.equal(
    findAssetByIndex(
      'file:///usr/Romeo/naoqi-sdk-2.3.0.14-linux64/share/alrobotmodel/meshes/romeo/LHipPitch.mesh',
      index,
      'example-robot-data/robots/romeo_description/urdf/',
    ),
    'blob:lhip-visual',
  );
});

test('findAssetByIndex leaves ambiguous approximate filename matches unresolved', () => {
  const assets = {
    'ros_kortex/kortex_description/arms/gen3/6dof/meshes/bracelet_no_vision_link.STL':
      'blob:no-vision',
    'ros_kortex/kortex_description/arms/gen3/6dof/meshes/bracelet_with_vision_link.STL':
      'blob:with-vision',
  };
  const index = buildAssetIndex(assets, 'ros_kortex/kortex_description/arms/gen3/6dof/urdf/');

  assert.equal(
    findAssetByIndex(
      'package://kortex_description/arms/gen3/6dof/meshes/bracelet_link.STL',
      index,
      'ros_kortex/kortex_description/arms/gen3/6dof/urdf/',
    ),
    null,
  );
});

test('createMeshLoader loads Romeo local .mesh references through imported visual DAE aliases', async () => {
  const meshPath =
    'test/awesome_robot_descriptions_repos/example-robot-data/robots/romeo_description/meshes/V1/visual/LHipPitch.dae';
  const meshDataUrl = `data:text/xml;base64,${Buffer.from(fs.readFileSync(meshPath, 'utf8')).toString('base64')}`;
  const manager = new THREE.LoadingManager();
  const loadMesh = createMeshLoader(
    {
      'example-robot-data/robots/romeo_description/meshes/V1/visual/LHipPitch.dae': meshDataUrl,
      'example-robot-data/robots/romeo_description/meshes/V1/collision/LHipPitch.dae': meshDataUrl,
    },
    manager,
    'example-robot-data/robots/romeo_description/urdf/',
  );

  const loadedObject = await new Promise<THREE.Object3D>((resolve, reject) => {
    loadMesh(
      'file:///usr/Romeo/naoqi-sdk-2.3.0.14-linux64/share/alrobotmodel/meshes/romeo/LHipPitch.mesh',
      manager,
      (result, err) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(result);
      },
    );
  });

  const meshes = getAllMeshes(loadedObject);
  assert.ok(meshes.length > 0, 'expected Romeo alias lookup to load a real mesh');
  assert.equal(
    meshes.some((mesh) => mesh.userData.isPlaceholder === true),
    false,
  );
});

test('resolveManagedAssetUrl remaps malformed Collada blob-relative texture URLs to imported asset blobs', () => {
  const index = buildAssetIndex(
    {
      'apartment/materials/textures/apartment_diffuse.jpg': 'blob:apartment-diffuse',
    },
    'apartment/meshes/',
  );

  assert.equal(
    resolveManagedAssetUrl(
      'blob:http://127.0.0.1:4173/apartment_diffuse.jpg',
      index,
      'apartment/meshes/',
    ),
    'blob:apartment-diffuse',
  );
});

test('resolveManagedAssetUrl remaps malformed GLTF blob-relative buffer URLs to imported asset blobs', () => {
  const index = buildAssetIndex(
    {
      'perseverance/meshes/CHASSIS.bin': 'blob:perseverance-chassis-bin',
    },
    'perseverance/',
  );

  assert.equal(
    resolveManagedAssetUrl('blob:http://127.0.0.1:4179/CHASSIS.bin', index, 'perseverance/'),
    'blob:perseverance-chassis-bin',
  );
});

test('createMeshLoader keeps b2w rear hip mesh selection stable when generic hip assets are present', async () => {
  const urdfContent = fs.readFileSync(
    'test/unitree_ros/robots/b2w_description/urdf/b2w_description.urdf',
    'utf8',
  );
  const colladaRootNormalizationHints = buildColladaRootNormalizationHints(
    parseURDF(urdfContent).links,
  );
  const flHip = fs.readFileSync(
    'test/unitree_ros/robots/b2w_description/meshes/FL_hip.dae',
    'utf8',
  );
  const rlHip = fs.readFileSync(
    'test/unitree_ros/robots/b2w_description/meshes/RL_hip.dae',
    'utf8',
  );
  const rrHip = fs.readFileSync(
    'test/unitree_ros/robots/b2w_description/meshes/RR_hip.dae',
    'utf8',
  );
  const genericHip = fs.readFileSync(
    'test/unitree_ros/robots/b2w_description/meshes/hip.dae',
    'utf8',
  );
  const manager = new THREE.LoadingManager();
  const loadMesh = createMeshLoader(
    {
      'robots/b2w_description/meshes/hip.dae': `data:text/xml;base64,${Buffer.from(genericHip).toString('base64')}`,
      'robots/b2w_description/meshes/FL_hip.dae': `data:text/xml;base64,${Buffer.from(flHip).toString('base64')}`,
      'robots/b2w_description/meshes/RL_hip.dae': `data:text/xml;base64,${Buffer.from(rlHip).toString('base64')}`,
      'robots/b2w_description/meshes/RR_hip.dae': `data:text/xml;base64,${Buffer.from(rrHip).toString('base64')}`,
    },
    manager,
    'robots/b2w_description/urdf/',
    { colladaRootNormalizationHints },
  );

  const loadMeshPath = (meshPath: string) =>
    new Promise<THREE.Object3D>((resolve, reject) => {
      loadMesh(meshPath, manager, (result, err) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(result);
      });
    });

  const loadedRlHip = await loadMeshPath('/b2w_description/meshes/RL_hip.dae');
  const loadedRrHip = await loadMeshPath('/b2w_description/meshes/RR_hip.dae');

  assert.equal(getFirstMesh(loadedRlHip).name, 'object23.022');
  assert.equal(getFirstMesh(loadedRrHip).name, 'object23.021');
});
