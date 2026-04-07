import * as THREE from 'three';
import { disposeMaterial } from './dispose';
export { disposeMaterial } from './dispose';
import { applyVisualMeshShadowPolicy } from '@/core/utils/visualMeshShadowPolicy';

// Re-export shared material factory so existing consumers keep working
export { MATERIAL_CONFIG, createMatteMaterial } from '@/shared/utils/materialFactory';
export type { CreateMaterialOptions } from '@/shared/utils/materialFactory';
import { MATERIAL_CONFIG, createMatteMaterial } from '@/shared/utils/materialFactory';
import {
  COLLISION_OVERLAY_RENDER_ORDER,
  collisionBaseMaterial,
  configureCollisionOverlayMaterial,
  createCollisionOverlayMaterial,
} from '@/core/utils/three/collisionOverlayMaterial';
export {
  COLLISION_OVERLAY_RENDER_ORDER,
  collisionBaseMaterial,
  configureCollisionOverlayMaterial,
  createCollisionOverlayMaterial,
} from '@/core/utils/three/collisionOverlayMaterial';

export const COLLISION_STANDARD_RENDER_ORDER = 0;

export function resolveCollisionRenderOrder(alwaysOnTop: boolean): number {
  return alwaysOnTop ? COLLISION_OVERLAY_RENDER_ORDER : COLLISION_STANDARD_RENDER_ORDER;
}

export function syncCollisionBaseMaterialPriority(alwaysOnTop: boolean): void {
  const nextDepthTest = !alwaysOnTop;
  const nextDepthWrite = false;

  if (
    collisionBaseMaterial.depthTest !== nextDepthTest ||
    collisionBaseMaterial.depthWrite !== nextDepthWrite
  ) {
    collisionBaseMaterial.depthTest = nextDepthTest;
    collisionBaseMaterial.depthWrite = nextDepthWrite;
    collisionBaseMaterial.needsUpdate = true;
  }
}

/**
 * Applies unified material properties to an existing mesh's materials.
 * Converts any material type to MeshStandardMaterial for PBR rendering.
 *
 * @param mesh - The mesh to apply materials to
 * @param color - Optional color override (uses existing color if not provided)
 * @param opacity - Optional opacity (1.0 = fully opaque)
 */
export function applyMatteMaterialToMesh(
  mesh: THREE.Mesh,
  color?: THREE.ColorRepresentation,
  opacity: number = 1.0,
): void {
  const processMaterial = (oldMat: THREE.Material): THREE.MeshStandardMaterial => {
    const usesVertexColors = Boolean((oldMat as any).vertexColors);
    // Extract existing color if not overridden
    let matColor: THREE.Color;
    if (color !== undefined) {
      matColor = new THREE.Color(color);
    } else if ((oldMat as any).color) {
      matColor = (oldMat as any).color.clone();
    } else {
      matColor = new THREE.Color(0x888888);
    }

    // Extract existing texture if any
    const existingMap = (oldMat as any).map || null;

    return createMatteMaterial({
      color: matColor,
      opacity,
      transparent: opacity < 1.0 || oldMat.transparent,
      side: oldMat.side,
      map: existingMap,
      name: oldMat.name,
      preserveExactColor: usesVertexColors,
    });
  };

  const originalMaterial = mesh.material as THREE.Material | THREE.Material[] | undefined;
  if (Array.isArray(mesh.material)) {
    mesh.material = mesh.material.map(processMaterial);
  } else if (mesh.material) {
    mesh.material = processMaterial(mesh.material);
  }

  if (originalMaterial) {
    // New materials reuse texture references; dispose only material programs/state.
    // Skip shared singleton materials for safety.
    const mats = Array.isArray(originalMaterial) ? originalMaterial : [originalMaterial];
    mats.forEach((mat) => {
      if (!mat) return;
      if ((mat as any).userData?.isSharedMaterial || (mat as any).userData?.isCollisionMaterial)
        return;
      disposeMaterial(mat, false);
    });
  }
}

// ============================================================
// HIGHLIGHT MATERIALS (for selection/hover)
// ============================================================
export const highlightMaterial = new THREE.MeshStandardMaterial({
  color: 0x60a5fa, // Blue-400
  roughness: 0.5,
  metalness: 0.0,
  emissive: 0x60a5fa,
  emissiveIntensity: 0.3,
  side: THREE.DoubleSide,
});

export const highlightFaceMaterial = new THREE.MeshBasicMaterial({
  color: 0xff0000,
  transparent: true,
  opacity: 0.5,
  side: THREE.DoubleSide,
  depthTest: false,
  depthWrite: false,
});

export const collisionHighlightMaterial = new THREE.MeshStandardMaterial({
  color: 0xfacc15, // Yellow-400
  roughness: 0.5,
  metalness: 0.0,
  emissive: 0xfacc15,
  emissiveIntensity: 0.4,
  side: THREE.DoubleSide,
  transparent: true,
  depthTest: false,
  depthWrite: false,
});
export const measureFirstHighlightMaterial = new THREE.MeshStandardMaterial({
  color: 0x60a5fa, // Blue-400
  roughness: 0.45,
  metalness: 0.0,
  emissive: 0x60a5fa,
  emissiveIntensity: 0.35,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.42,
  depthTest: false,
  depthWrite: false,
});

export const measureSecondHighlightMaterial = new THREE.MeshStandardMaterial({
  color: 0xfbbf24, // Amber-400
  roughness: 0.45,
  metalness: 0.0,
  emissive: 0xf59e0b,
  emissiveIntensity: 0.38,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.42,
  depthTest: false,
  depthWrite: false,
});

export const measureHoverHighlightMaterial = new THREE.MeshStandardMaterial({
  color: 0xe2e8f0, // Slate-200
  roughness: 0.5,
  metalness: 0.0,
  emissive: 0x93c5fd,
  emissiveIntensity: 0.22,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.18,
  depthTest: false,
  depthWrite: false,
});

export type HighlightMaterialRole = 'visual' | 'collision';

const VISUAL_HIGHLIGHT_TINT_COLOR = new THREE.Color(0x93c5fd); // Blue-300
const VISUAL_HIGHLIGHT_EMISSIVE_COLOR = new THREE.Color(0x60a5fa); // Blue-400
const COLLISION_HIGHLIGHT_TINT_COLOR = new THREE.Color(0xfde047); // Yellow-300
const COLLISION_HIGHLIGHT_EMISSIVE_COLOR = new THREE.Color(0xfacc15); // Yellow-400
const MJCF_TENDON_HIGHLIGHT_TINT_COLOR = new THREE.Color(0xffffff);
const MJCF_TENDON_HIGHLIGHT_EMISSIVE_COLOR = new THREE.Color(0xfef08a); // Amber-200

function getHighlightTintConfig(role: HighlightMaterialRole, sourceMaterial?: THREE.Material) {
  if (role === 'visual' && sourceMaterial?.userData?.isMjcfTendonMaterial === true) {
    return {
      tintColor: MJCF_TENDON_HIGHLIGHT_TINT_COLOR,
      tintStrength: 0.72,
      emissiveColor: MJCF_TENDON_HIGHLIGHT_EMISSIVE_COLOR,
      emissiveStrength: 0.82,
      emissiveIntensityFloor: 0.9,
      forceOverlay: true,
      minOpacity: 0.98,
    };
  }

  if (role === 'collision') {
    return {
      tintColor: COLLISION_HIGHLIGHT_TINT_COLOR,
      tintStrength: 0.42,
      emissiveColor: COLLISION_HIGHLIGHT_EMISSIVE_COLOR,
      emissiveStrength: 0.58,
      emissiveIntensityFloor: 0.45,
      forceOverlay: true,
      minOpacity: 0.94,
    };
  }

  return {
    tintColor: VISUAL_HIGHLIGHT_TINT_COLOR,
    tintStrength: 0.38,
    emissiveColor: VISUAL_HIGHLIGHT_EMISSIVE_COLOR,
    emissiveStrength: 0.55,
    emissiveIntensityFloor: 0.38,
    forceOverlay: false,
    minOpacity: 0,
  };
}

export function createHighlightOverrideMaterial(
  sourceMaterial: THREE.Material,
  role: HighlightMaterialRole,
): THREE.Material {
  const highlightMaterialOverride = sourceMaterial.clone();
  const tintConfig = getHighlightTintConfig(role, sourceMaterial);
  const materialWithLighting = highlightMaterialOverride as THREE.Material & {
    color?: THREE.Color;
    emissive?: THREE.Color;
    emissiveIntensity?: number;
  };

  if (materialWithLighting.color?.isColor) {
    materialWithLighting.color = materialWithLighting.color.clone();
    materialWithLighting.color.lerp(tintConfig.tintColor, tintConfig.tintStrength);
  }

  if (materialWithLighting.emissive?.isColor) {
    materialWithLighting.emissive = materialWithLighting.emissive.clone();
    materialWithLighting.emissive.lerp(tintConfig.emissiveColor, tintConfig.emissiveStrength);
    const currentEmissiveIntensity = Number(materialWithLighting.emissiveIntensity ?? 0);
    materialWithLighting.emissiveIntensity = Number.isFinite(currentEmissiveIntensity)
      ? Math.max(currentEmissiveIntensity, tintConfig.emissiveIntensityFloor)
      : tintConfig.emissiveIntensityFloor;
  }

  if (tintConfig.forceOverlay) {
    highlightMaterialOverride.transparent = true;
    highlightMaterialOverride.opacity = Math.max(
      Math.min(highlightMaterialOverride.opacity ?? 1, 1),
      tintConfig.minOpacity,
    );
    highlightMaterialOverride.depthTest = false;
    highlightMaterialOverride.depthWrite = false;
  }

  highlightMaterialOverride.userData = {
    ...highlightMaterialOverride.userData,
    isHighlightOverrideMaterial: true,
    highlightRole: role,
  };
  highlightMaterialOverride.needsUpdate = true;
  return highlightMaterialOverride;
}
highlightMaterial.userData.isSharedMaterial = true;
highlightMaterial.userData.isHighlightMaterial = true;
highlightFaceMaterial.userData.isSharedMaterial = true;
highlightFaceMaterial.userData.isHighlightMaterial = true;
collisionHighlightMaterial.userData.isSharedMaterial = true;
collisionHighlightMaterial.userData.isHighlightMaterial = true;
measureFirstHighlightMaterial.userData.isSharedMaterial = true;
measureFirstHighlightMaterial.userData.isHighlightMaterial = true;
measureSecondHighlightMaterial.userData.isSharedMaterial = true;
measureSecondHighlightMaterial.userData.isHighlightMaterial = true;
measureHoverHighlightMaterial.userData.isSharedMaterial = true;
measureHoverHighlightMaterial.userData.isHighlightMaterial = true;

// Empty raycast function to disable raycast on collision meshes
export const emptyRaycast = () => {};

// ============================================================
// MATERIAL ENHANCEMENT
// Converts all materials to unified MeshStandardMaterial for PBR
// ============================================================

/**
 * Enhances all materials in a robot model with unified PBR finish.
 * Converts all material types to MeshStandardMaterial for IBL support.
 * Preserves original colors while applying consistent PBR properties.
 *
 * @param robotObject - The robot Object3D to enhance
 * @param envMap - Optional environment map (used for realistic reflections)
 */
export const enhanceMaterials = (robotObject: THREE.Object3D, envMap?: THREE.Texture | null) => {
  let enhancedCount = 0;
  let totalMeshes = 0;
  const disposedMaterials = new Set<THREE.Material>();

  robotObject.traverse((child: any) => {
    if (child.isMesh && child.material) {
      totalMeshes++;

      const originalMaterial = child.material as THREE.Material | THREE.Material[] | undefined;
      const shouldSkipEnhance = (mat: THREE.Material): boolean =>
        Boolean((mat as any).userData?.isSharedMaterial) ||
        Boolean((mat as any).userData?.isCollisionMaterial);

      if (Array.isArray(child.material)) {
        child.material = child.material.map((mat: THREE.Material) => {
          if (shouldSkipEnhance(mat)) return mat;
          const enhanced = enhanceSingleMaterial(mat, envMap);
          if (enhanced !== mat) enhancedCount++;
          return enhanced;
        });
      } else {
        if (!shouldSkipEnhance(child.material)) {
          const enhanced = enhanceSingleMaterial(child.material, envMap);
          if (enhanced !== child.material) enhancedCount++;
          child.material = enhanced;
        }
      }

      if (originalMaterial) {
        const mats = Array.isArray(originalMaterial) ? originalMaterial : [originalMaterial];
        for (const mat of mats) {
          if (!mat || disposedMaterials.has(mat)) continue;
          if (shouldSkipEnhance(mat)) continue;
          // Preserve textures because enhanced materials may share same maps.
          disposeMaterial(mat, false);
          disposedMaterials.add(mat);
        }
      }
      applyVisualMeshShadowPolicy(child as THREE.Mesh);
    }
  });
};

/**
 * Enhances a single material with unified PBR properties.
 * Converts any material type to MeshStandardMaterial for IBL support.
 *
 * @param material - The material to enhance
 * @param envMap - Optional environment map (for realistic reflections)
 * @returns Enhanced MeshStandardMaterial
 */
export const enhanceSingleMaterial = (
  material: THREE.Material,
  envMap?: THREE.Texture | null,
): THREE.Material => {
  const usesVertexColors = Boolean((material as any).vertexColors);

  // Extract color from existing material
  // Priority: URDF color > existing material color > default gray
  let color: THREE.Color;
  if (material.userData.urdfColorApplied && material.userData.urdfColor) {
    // Preserve URDF-defined color (from applyURDFMaterials)
    color = (material.userData.urdfColor as THREE.Color).clone();
  } else if ((material as any).color) {
    color = (material as any).color.clone();
  } else {
    color = new THREE.Color(0x888888);
  }

  // Extract existing properties
  const existingMap = (material as any).map || null;
  const existingOpacity = material.opacity !== undefined ? material.opacity : 1.0;
  const existingTransparent = material.transparent || existingOpacity < 1.0;
  const existingSide = material.side !== undefined ? material.side : THREE.DoubleSide;
  const existingDepthTest = material.depthTest;
  const existingDepthWrite = material.depthWrite;
  const existingAlphaTest = material.alphaTest ?? 0;
  const existingPolygonOffset = material.polygonOffset === true;
  const existingPolygonOffsetFactor = material.polygonOffsetFactor ?? 0;
  const existingPolygonOffsetUnits = material.polygonOffsetUnits ?? 0;

  const preserveExactColor =
    Boolean(material.userData.urdfColorApplied) || usesVertexColors || Boolean(existingMap);

  // Route all final visual materials through the shared matte material factory so
  // USD and URDF/MJCF land on the same shading defaults and color normalization.
  const newMat = createMatteMaterial({
    color,
    opacity: existingOpacity,
    transparent: existingTransparent,
    side: existingSide,
    map: existingMap,
    name: material.name,
    preserveExactColor,
  });

  newMat.userData = {
    ...(material.userData ?? {}),
    ...(newMat.userData ?? {}),
  };
  newMat.depthTest = existingDepthTest;
  newMat.depthWrite = existingDepthWrite;
  newMat.alphaTest = existingAlphaTest;
  newMat.polygonOffset = existingPolygonOffset;
  newMat.polygonOffsetFactor = existingPolygonOffsetFactor;
  newMat.polygonOffsetUnits = existingPolygonOffsetUnits;

  if (usesVertexColors) {
    newMat.vertexColors = true;
    newMat.toneMapped = false;
    newMat.userData.usesVertexColors = true;
  }

  // Apply environment map if provided
  if (envMap) {
    newMat.envMap = envMap;
  }

  // Ensure textures use sRGB color space for proper gamma
  if (newMat.map && newMat.map.colorSpace !== THREE.SRGBColorSpace) {
    newMat.map.colorSpace = THREE.SRGBColorSpace;
    newMat.map.needsUpdate = true;
  }

  // Preserve URDF color flag for future material operations
  if (material.userData.urdfColorApplied) {
    newMat.userData.urdfColorApplied = true;
    newMat.userData.urdfColor = color.clone();
  }

  newMat.needsUpdate = true;
  return newMat;
};

/**
 * Toggle material enhancement on a robot model.
 * When enabled, applies PBR finish. When disabled, restores original values.
 *
 * @param robotObject - The robot Object3D
 * @param enabled - Whether to enable material enhancement
 * @param envMap - Optional environment map
 */
export const toggleEnhancedLighting = (
  robotObject: THREE.Object3D,
  enabled: boolean,
  envMap?: THREE.Texture | null,
) => {
  let toggledCount = 0;

  robotObject.traverse((child: any) => {
    if (child.isMesh && child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];

      materials.forEach((mat: THREE.Material) => {
        if ((mat as any).isMeshStandardMaterial) {
          const stdMat = mat as THREE.MeshStandardMaterial;

          if (enabled) {
            // Apply PBR finish
            stdMat.roughness = MATERIAL_CONFIG.roughness;
            stdMat.metalness = MATERIAL_CONFIG.metalness;
            stdMat.envMapIntensity = MATERIAL_CONFIG.envMapIntensity;

            if (envMap && !stdMat.envMap) {
              stdMat.envMap = envMap;
            }
          } else {
            // Restore original properties
            stdMat.roughness = stdMat.userData.originalRoughness ?? 0.7;
            stdMat.metalness = stdMat.userData.originalMetalness ?? 0.1;
            stdMat.envMapIntensity = stdMat.userData.originalEnvMapIntensity ?? 0.8;
          }

          stdMat.needsUpdate = true;
          toggledCount++;
        }
      });
    }
  });
};
