import { use, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { GENERATED_OBJ_MATERIAL_USER_DATA_KEY } from '@/core/loaders/objModelData';
import {
  createObjectFromSerializedObjData,
  loadSerializedObjModelData,
} from '@/core/loaders/objParseWorkerBridge';
import { disposeMaterial, disposeObject3D } from '@/shared/utils/three/dispose';
import { applyVisualMeshShadowPolicyToObject } from '@/core/utils/visualMeshShadowPolicy';

interface ScaleProps {
  x: number;
  y: number;
  z: number;
}

interface OBJRendererImplProps {
  url: string;
  material: THREE.Material;
  color: string;
  enableShadows?: boolean;
  assets: Record<string, string>;
  assetBaseDir?: string;
  scale?: ScaleProps;
  onResolved?: () => void;
}

function enableVertexColorMaterials(mesh: THREE.Mesh): void {
  if (!mesh.geometry?.getAttribute?.('color')) {
    return;
  }

  const currentMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  let didCloneMaterial = false;
  const nextMaterials = currentMaterials.map((entry) => {
    if (
      !entry ||
      !('vertexColors' in entry) ||
      (entry as THREE.MeshPhongMaterial).vertexColors === true
    ) {
      return entry;
    }

    const cloned = entry.clone();
    (cloned as THREE.MeshPhongMaterial).vertexColors = true;
    cloned.needsUpdate = true;
    didCloneMaterial = true;
    return cloned;
  });

  if (!didCloneMaterial) {
    return;
  }

  mesh.material = Array.isArray(mesh.material) ? nextMaterials : nextMaterials[0];
}

function disposeGeneratedObjMaterials(
  materialOrMaterials: THREE.Material | THREE.Material[],
): void {
  const materials = Array.isArray(materialOrMaterials)
    ? materialOrMaterials
    : [materialOrMaterials];
  materials.forEach((entry) => {
    if (entry?.userData?.[GENERATED_OBJ_MATERIAL_USER_DATA_KEY] === true) {
      disposeMaterial(entry, true);
    }
  });
}

export function replaceObjPreviewMeshMaterials(
  meshes: THREE.Mesh[],
  sharedMaterial: THREE.Material,
): void {
  meshes.forEach((mesh) => {
    const previousMaterial = mesh.material;
    if (previousMaterial === sharedMaterial) {
      return;
    }

    mesh.material = sharedMaterial;
    disposeGeneratedObjMaterials(previousMaterial);
  });
}

export function disposeObjPreviewClone(
  clone: THREE.Object3D,
  sharedMaterial: THREE.Material,
): void {
  disposeObject3D(clone, true, new Set([sharedMaterial]));
}

export function OBJRendererImpl({
  url,
  material,
  scale,
  enableShadows = true,
  onResolved,
}: OBJRendererImplProps) {
  const sharedMaterialRef = useRef(material);
  const serializedObject = use(useMemo(() => loadSerializedObjModelData(url), [url]));
  const { clone, overrideMeshes } = useMemo(() => {
    const nextClone = createObjectFromSerializedObjData(serializedObject);
    const meshes: THREE.Mesh[] = [];

    nextClone.traverse((child) => {
      if (!(child as THREE.Mesh).isMesh) return;

      const mesh = child as THREE.Mesh;
      enableVertexColorMaterials(mesh);
      const existingMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const hasTextureMap = existingMaterials.some((entry) =>
        Boolean(entry && 'map' in entry && (entry as THREE.MeshStandardMaterial).map),
      );
      const hasVertexColors = Boolean(mesh.geometry?.getAttribute?.('color'));

      if (!hasTextureMap && !hasVertexColors) {
        meshes.push(mesh);
      }
    });

    return { clone: nextClone, overrideMeshes: meshes };
  }, [serializedObject]);

  useLayoutEffect(() => {
    sharedMaterialRef.current = material;
    replaceObjPreviewMeshMaterials(overrideMeshes, material);
    if (enableShadows) {
      applyVisualMeshShadowPolicyToObject(clone);
    }
  }, [clone, enableShadows, material, overrideMeshes]);

  useEffect(() => {
    onResolved?.();
  }, [clone, onResolved]);

  useEffect(
    () => () => {
      disposeObjPreviewClone(clone, sharedMaterialRef.current);
    },
    [clone],
  );

  const scaleArr: [number, number, number] = scale ? [scale.x, scale.y, scale.z] : [1, 1, 1];

  return (
    <group rotation={[0, 0, 0]} scale={scaleArr}>
      <primitive object={clone} />
    </group>
  );
}

export default OBJRendererImpl;
