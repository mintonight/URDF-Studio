import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';

import { createLoadingManager } from './index';
import {
  createSceneFromSerializedColladaData,
  parseColladaSceneData,
} from './colladaWorkerSceneData.ts';

type WorkerImageGlobalSnapshot = {
  DOMParser: typeof globalThis.DOMParser;
  Image: typeof globalThis.Image;
  HTMLImageElement: typeof globalThis.HTMLImageElement;
  XMLSerializer: typeof globalThis.XMLSerializer;
  document: typeof globalThis.document;
};

function captureWorkerImageGlobals(): WorkerImageGlobalSnapshot {
  return {
    DOMParser: globalThis.DOMParser,
    Image: globalThis.Image,
    HTMLImageElement: globalThis.HTMLImageElement,
    XMLSerializer: globalThis.XMLSerializer,
    document: globalThis.document,
  };
}

function restoreWorkerImageGlobals(snapshot: WorkerImageGlobalSnapshot): void {
  if (snapshot.DOMParser) {
    globalThis.DOMParser = snapshot.DOMParser;
  } else {
    delete (globalThis as typeof globalThis & { DOMParser?: typeof DOMParser }).DOMParser;
  }

  if (snapshot.document) {
    globalThis.document = snapshot.document;
  } else {
    delete (globalThis as typeof globalThis & { document?: Document }).document;
  }

  if (snapshot.HTMLImageElement) {
    globalThis.HTMLImageElement = snapshot.HTMLImageElement;
  } else {
    delete (globalThis as typeof globalThis & { HTMLImageElement?: typeof HTMLImageElement })
      .HTMLImageElement;
  }

  if (snapshot.Image) {
    globalThis.Image = snapshot.Image;
  } else {
    delete (globalThis as typeof globalThis & { Image?: typeof Image }).Image;
  }

  if (snapshot.XMLSerializer) {
    globalThis.XMLSerializer = snapshot.XMLSerializer;
  } else {
    delete (globalThis as typeof globalThis & { XMLSerializer?: typeof XMLSerializer })
      .XMLSerializer;
  }
}

function getFirstMesh(root: THREE.Object3D): THREE.Mesh {
  let foundMesh: THREE.Mesh | null = null;

  root.traverse((child) => {
    if (!foundMesh && (child as THREE.Mesh).isMesh) {
      foundMesh = child as THREE.Mesh;
    }
  });

  assert.ok(foundMesh, 'expected Collada scene to contain a mesh');
  return foundMesh;
}

test('textured Collada worker scene data restores image-backed textures without DOM globals', () => {
  const meshPath = 'test/gazebo_models/checkerboard_plane/meshes/checkerboard_plane.dae';
  const colladaText = fs.readFileSync(meshPath, 'utf8');
  const snapshot = captureWorkerImageGlobals();

  delete (globalThis as typeof globalThis & { DOMParser?: typeof DOMParser }).DOMParser;
  delete (globalThis as typeof globalThis & { document?: Document }).document;
  delete (globalThis as typeof globalThis & { HTMLImageElement?: typeof HTMLImageElement })
    .HTMLImageElement;
  delete (globalThis as typeof globalThis & { Image?: typeof Image }).Image;
  delete (globalThis as typeof globalThis & { XMLSerializer?: typeof XMLSerializer }).XMLSerializer;

  try {
    const serializedScene = parseColladaSceneData(colladaText, meshPath);
    const restoredScene = createSceneFromSerializedColladaData(serializedScene);
    const restoredMesh = getFirstMesh(restoredScene);
    const restoredMaterial = restoredMesh.material as THREE.MeshPhongMaterial;

    assert.ok(restoredMaterial.map, 'expected textured Collada scene to restore material.map');
    assert.equal(typeof globalThis.HTMLImageElement, 'function');
    assert.ok(
      restoredMaterial.map.source.data instanceof globalThis.HTMLImageElement,
      'expected textured Collada scene to restore an image-backed source in worker mode',
    );
    assert.match(String(restoredMaterial.map.source.data.src), /checker\.png$/);
  } finally {
    restoreWorkerImageGlobals(snapshot);
  }
});

test('createSceneFromSerializedColladaData resolves blob-relative Collada textures through the loading manager', () => {
  const daePath = 'test/unitree_ros/robots/aliengo_description/meshes/trunk.dae';
  const pngPath = 'test/unitree_ros/robots/aliengo_description/meshes/trunk_uv_base_final.png';
  const colladaText = fs.readFileSync(daePath, 'utf8');
  const textureDataUrl = `data:image/png;base64,${fs.readFileSync(pngPath).toString('base64')}`;
  const serializedScene = parseColladaSceneData(
    colladaText,
    'blob:http://127.0.0.1:4204/fake-trunk-dae',
  );
  const manager = createLoadingManager(
    {
      'aliengo_description/meshes/trunk_uv_base_final.png': textureDataUrl,
    },
    'aliengo_description/urdf/',
  );
  const restoredScene = createSceneFromSerializedColladaData(serializedScene, { manager });
  const restoredMesh = getFirstMesh(restoredScene);
  const restoredMaterial = restoredMesh.material as THREE.MeshPhongMaterial;

  assert.ok(restoredMaterial.map, 'expected Aliengo trunk Collada scene to restore material.map');
  assert.equal(
    (restoredMaterial.map.source.data as { src?: string }).src,
    textureDataUrl,
    'expected blob-relative Collada texture URL to be remapped through the asset manager',
  );
});

test('createSceneFromSerializedColladaData applies Collada unit meter scaling for Aliengo calf truth', () => {
  const daePath = 'test/unitree_ros/robots/aliengo_description/meshes/calf.dae';
  const colladaText = fs.readFileSync(daePath, 'utf8');
  const serializedScene = parseColladaSceneData(colladaText, daePath);
  const restoredScene = createSceneFromSerializedColladaData(serializedScene);
  const bounds = new THREE.Box3().setFromObject(restoredScene);
  const size = new THREE.Vector3();
  bounds.getSize(size);

  assert.equal(serializedScene.unitScale, 0.0254);
  assert.ok(
    size.z < 0.5,
    `expected Aliengo calf mesh to stay near URDF truth scale after applying unit meter, got z=${size.z}`,
  );
});
