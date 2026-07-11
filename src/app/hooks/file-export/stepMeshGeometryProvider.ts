/**
 * Mesh geometry provider for STEP export.
 *
 * Loads each mesh visual via `createMeshLoader`, applies the per-visual mesh
 * scale, and flattens the result into triangle vertex triples that the STEP
 * generator can consume.
 */

import * as THREE from 'three';

import { createLoadingManager, createMeshLoader } from '@/core/loaders/meshLoader';
import type { StepGeometryProvider, StepGeometryPayload } from '@/core/parsers';
import type { UrdfVisual } from '@/types';

/** Wrap the loaded object in a scale group matching `visual.dimensions`. */
function applyVisualMeshScale(object: THREE.Object3D, visual: UrdfVisual): THREE.Object3D {
  const sx = Math.max(Number.isFinite(visual.dimensions.x) ? visual.dimensions.x : 1, 1e-6);
  const sy = Math.max(Number.isFinite(visual.dimensions.y) ? visual.dimensions.y : 1, 1e-6);
  const sz = Math.max(Number.isFinite(visual.dimensions.z) ? visual.dimensions.z : 1, 1e-6);
  if (sx === 1 && sy === 1 && sz === 1) return object;
  const wrapper = new THREE.Group();
  wrapper.scale.set(sx, sy, sz);
  wrapper.add(object);
  return wrapper;
}

/** Bake world matrices and collect every triangle as flat world-space vertices. */
function extractFlattenedTriangles(root: THREE.Object3D): number[] {
  root.updateMatrixWorld(true);
  const positions: number[] = [];
  const v = new THREE.Vector3();

  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;

    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const attr = geometry.getAttribute('position');
    if (!attr) {
      if (geometry !== mesh.geometry) geometry.dispose();
      return;
    }

    const matrix = mesh.matrixWorld;
    for (let i = 0; i < attr.count; i++) {
      v.fromBufferAttribute(attr, i).applyMatrix4(matrix);
      positions.push(v.x, v.y, v.z);
    }

    if (geometry !== mesh.geometry) geometry.dispose();
  });

  return positions;
}

/** Promise wrapper around the callback-based mesh loader. */
function loadMeshAsPromise(
  meshPath: string,
  manager: THREE.LoadingManager,
  meshLoader: ReturnType<typeof createMeshLoader>,
): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => {
    meshLoader(meshPath, manager, (object, error) => {
      if (error) {
        reject(error);
        return;
      }
      const obj = object as THREE.Object3D & { userData?: { isPlaceholder?: boolean } };
      if (!object || obj.userData?.isPlaceholder) {
        reject(new Error(`Mesh not available: ${meshPath}`));
        return;
      }
      resolve(object);
    });
  });
}

export interface CreateStepMeshGeometryProviderParams {
  assets: Record<string, string>;
  urdfDir?: string;
}

/**
 * Build a StepGeometryProvider that loads meshes through the shared mesh loader
 * and returns flat triangle vertices in mesh-local space.
 */
export function createStepMeshGeometryProvider(
  params: CreateStepMeshGeometryProviderParams,
): StepGeometryProvider {
  const urdfDir = params.urdfDir ?? '';
  const manager = createLoadingManager(params.assets, urdfDir);
  const meshLoader = createMeshLoader(params.assets, manager, urdfDir, {
    allowPlaceholderMeshes: false,
  });

  /** Cache the loaded Object3D per mesh path so each unique asset loads once. */
  const objectCache = new Map<string, Promise<THREE.Object3D>>();

  const loadObject = (meshPath: string): Promise<THREE.Object3D> => {
    let pending = objectCache.get(meshPath);
    if (!pending) {
      pending = loadMeshAsPromise(meshPath, manager, meshLoader).catch((error) => {
        console.error(`[STEP export] Failed to load mesh: ${meshPath}`, error);
        throw error;
      });
      objectCache.set(meshPath, pending);
    }
    return pending;
  };

  return {
    async loadMeshGeometry(
      visual: UrdfVisual,
      _linkId: string,
    ): Promise<StepGeometryPayload | null> {
      const meshPath = String(visual.meshPath ?? '').trim();
      if (!meshPath) return null;

      try {
        const object = await loadObject(meshPath);
        // Clone so per-visual scale doesn't mutate the cached object.
        const scaled = applyVisualMeshScale(object.clone(true), visual);
        const positions = extractFlattenedTriangles(scaled);
        return positions.length >= 9 ? { positions } : null;
      } catch {
        return null;
      }
    },
  };
}
