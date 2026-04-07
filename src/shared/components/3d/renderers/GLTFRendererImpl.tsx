import { useEffect, useLayoutEffect, useMemo } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { useLoadingManager } from '../meshLoadingManager';
import { applyVisualMeshShadowPolicyToObject } from '@/core/utils/visualMeshShadowPolicy';

interface ScaleProps {
  x: number;
  y: number;
  z: number;
}

interface GLTFRendererImplProps {
  url: string;
  material: THREE.Material;
  enableShadows?: boolean;
  assets: Record<string, string>;
  assetBaseDir?: string;
  preserveOriginalMaterial?: boolean;
  scale?: ScaleProps;
  onResolved?: () => void;
}

export function GLTFRendererImpl({
  url,
  material,
  enableShadows = true,
  assets,
  assetBaseDir,
  preserveOriginalMaterial = false,
  scale,
  onResolved,
}: GLTFRendererImplProps) {
  const manager = useLoadingManager(assets, assetBaseDir);
  const gltf = useLoader(GLTFLoader, url, (loader) => {
    loader.manager = manager;
  });

  const { clone, overrideMeshes } = useMemo(() => {
    const nextClone = cloneSkeleton(gltf.scene);
    const meshes: THREE.Mesh[] = [];

    nextClone.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) {
        return;
      }

      if (!preserveOriginalMaterial) {
        meshes.push(child as THREE.Mesh);
      }
    });

    return { clone: nextClone, overrideMeshes: meshes };
  }, [gltf.scene, preserveOriginalMaterial]);

  useLayoutEffect(() => {
    overrideMeshes.forEach((mesh) => {
      mesh.material = material;
    });
    if (enableShadows) {
      applyVisualMeshShadowPolicyToObject(clone);
    }
  }, [clone, enableShadows, material, overrideMeshes]);

  useEffect(() => {
    onResolved?.();
  }, [clone, onResolved]);

  const scaleArr: [number, number, number] = scale ? [scale.x, scale.y, scale.z] : [1, 1, 1];

  return (
    <group scale={scaleArr}>
      <primitive object={clone} />
    </group>
  );
}

export default GLTFRendererImpl;
