import test from 'node:test';
import assert from 'node:assert/strict';

import * as THREE from 'three';

import { disposeObject3D, disposeWebGLRenderer } from './dispose.ts';

test('disposeObject3D disposes shared skeletons once and clears the object tree', () => {
  const root = new THREE.Group();
  (
    root as THREE.Group & {
      links?: Record<string, THREE.Object3D>;
      joints?: Record<string, THREE.Object3D>;
    }
  ).links = {};
  (
    root as THREE.Group & {
      links?: Record<string, THREE.Object3D>;
      joints?: Record<string, THREE.Object3D>;
    }
  ).joints = {};
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.MeshBasicMaterial();
  const bone = new THREE.Bone();
  const skeleton = new THREE.Skeleton([bone]);
  let disposeCallCount = 0;
  const originalDispose = skeleton.dispose.bind(skeleton);
  skeleton.dispose = () => {
    disposeCallCount += 1;
    originalDispose();
  };

  const meshA = new THREE.SkinnedMesh(geometry, material);
  meshA.add(bone);
  meshA.bind(skeleton);
  root.add(meshA);
  (root as THREE.Group & { links?: Record<string, THREE.Object3D> }).links!.meshA = meshA;

  const meshB = new THREE.SkinnedMesh(geometry.clone(), material.clone());
  meshB.bind(skeleton);
  root.add(meshB);
  (root as THREE.Group & { joints?: Record<string, THREE.Object3D> }).joints!.meshB = meshB;

  disposeObject3D(root);

  assert.equal(disposeCallCount, 1);
  assert.equal(root.children.length, 0);
  assert.deepEqual((root as THREE.Group & { links?: Record<string, THREE.Object3D> }).links, {});
  assert.deepEqual((root as THREE.Group & { joints?: Record<string, THREE.Object3D> }).joints, {});
});

test('disposeWebGLRenderer releases renderer caches without forcing context loss by default', () => {
  const calls: string[] = [];
  const renderer = {
    renderLists: {
      dispose: () => {
        calls.push('render-lists');
      },
    },
    dispose: () => {
      calls.push('dispose');
    },
    forceContextLoss: () => {
      calls.push('force-context-loss');
    },
  } as any;

  disposeWebGLRenderer(renderer);

  assert.deepEqual(calls, ['render-lists', 'dispose']);
});

test('disposeWebGLRenderer tolerates teardown failures and keeps progressing', () => {
  const calls: string[] = [];
  const renderer = {
    renderLists: {
      dispose: () => {
        calls.push('render-lists');
        throw new Error('cache cleanup failed');
      },
    },
    dispose: () => {
      calls.push('dispose');
    },
  } as any;

  disposeWebGLRenderer(renderer);

  assert.deepEqual(calls, ['render-lists', 'dispose']);
});

test('disposeWebGLRenderer can explicitly force context loss during final teardown', () => {
  const calls: string[] = [];
  const renderer = {
    renderLists: {
      dispose: () => {
        calls.push('render-lists');
      },
    },
    dispose: () => {
      calls.push('dispose');
    },
    forceContextLoss: () => {
      calls.push('force-context-loss');
    },
  } as any;

  disposeWebGLRenderer(renderer, { forceContextLoss: true });

  assert.deepEqual(calls, ['render-lists', 'dispose', 'force-context-loss']);
});
