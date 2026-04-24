import * as THREE from 'three';
import { createThreeColorFromSRGB } from '@/core/utils/color.ts';
import { getVisualGeometryEntries } from '@/core/robot';
import type { UrdfLink, UrdfVisual, UrdfVisualMaterial } from '@/types';
import { isProtectedMaterial } from '@/core/utils/three/materialProtection';
import { disposeMaterial } from './dispose';

// ============================================================
// URDF Material Parser - Extract rgba colors from URDF XML
// Supports multiple materials per visual (for DAE files with named materials)
// ============================================================
export interface URDFMaterialInfo {
  name?: string;
  rgba?: [number, number, number, number];
}

function toMaterialRgba(
  colorValue?: string,
  textureValue?: string,
  colorRgbaValue?: [number, number, number, number],
): [number, number, number, number] | null {
  if (
    Array.isArray(colorRgbaValue) &&
    colorRgbaValue.length === 4 &&
    colorRgbaValue.every((v) => Number.isFinite(v))
  ) {
    return colorRgbaValue;
  }

  const raw = String(colorValue || '').trim();
  if (!raw) {
    return textureValue ? [1, 1, 1, 1] : null;
  }

  const color = new THREE.Color(raw).convertLinearToSRGB();
  return [color.r, color.g, color.b, 1];
}

function collectAuthoredMaterials(
  geometry: Pick<UrdfVisual, 'authoredMaterials'> | null | undefined,
): UrdfVisualMaterial[] {
  return geometry?.authoredMaterials ?? [];
}

export function collectURDFMaterialsFromVisualGeometry(
  geometry: Pick<UrdfVisual, 'authoredMaterials'> | null | undefined,
): Map<string, URDFMaterialInfo> {
  const namedMaterials = new Map<string, URDFMaterialInfo>();

  for (const material of collectAuthoredMaterials(geometry)) {
    const name = material.name?.trim();
    const rgba = toMaterialRgba(material.color, material.texture, material.colorRgba);
    if (!name || !rgba) {
      continue;
    }

    namedMaterials.set(name, { name, rgba });
  }

  return namedMaterials;
}

export function collectURDFMaterialsFromLinks(
  links?: Record<string, UrdfLink> | null,
): Map<string, URDFMaterialInfo> {
  const namedMaterials = new Map<string, URDFMaterialInfo>();

  if (!links) {
    return namedMaterials;
  }

  for (const link of Object.values(links)) {
    for (const entry of getVisualGeometryEntries(link)) {
      for (const [name, material] of collectURDFMaterialsFromVisualGeometry(entry.geometry)) {
        namedMaterials.set(name, material);
      }
    }
  }

  return namedMaterials;
}

export function normalizeURDFMaterialName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/-effect$/i, '')
    .replace(/[._\-\s]+/g, '');
}

function findURDFMaterialByName(
  materials: Map<string, URDFMaterialInfo>,
  materialName: string,
): URDFMaterialInfo | undefined {
  const exactMatch = materials.get(materialName);
  if (exactMatch) {
    return exactMatch;
  }

  const normalizedMaterialName = normalizeURDFMaterialName(materialName);
  if (!normalizedMaterialName) {
    return undefined;
  }

  for (const [candidateName, candidateMaterial] of materials) {
    if (normalizeURDFMaterialName(candidateName) === normalizedMaterialName) {
      return candidateMaterial;
    }
  }

  return undefined;
}

function disposeTransientViewerMaterial(material: THREE.Material): void {
  if (isProtectedMaterial(material)) {
    return;
  }

  disposeMaterial(material, false);
}

export function applyURDFMaterialInfoToMaterial(
  material: THREE.Material,
  materials: Map<string, URDFMaterialInfo>,
): THREE.Material {
  const materialName = material.name;
  const urdfMaterial = findURDFMaterialByName(materials, materialName);

  if (!urdfMaterial?.rgba) {
    return material;
  }

  const [r, g, b, a] = urdfMaterial.rgba;
  const color = createThreeColorFromSRGB(r, g, b);
  const cloned = material.clone();

  if ((cloned as any).color?.copy) {
    (cloned as any).color.copy(color);
  } else {
    (cloned as any).color = color;
  }

  cloned.name = materialName || urdfMaterial.name || cloned.name;
  cloned.userData.urdfColorApplied = true;
  cloned.userData.urdfColor = color.clone();
  if (urdfMaterial.name) {
    cloned.userData.urdfMaterialName = urdfMaterial.name;
  }
  if (a < 1) {
    cloned.transparent = true;
    cloned.opacity = a;
  }
  cloned.needsUpdate = true;

  return cloned;
}

/**
 * Parse URDF materials - returns a Map keyed by material NAME (not link name)
 * This allows matching materials in DAE files by their name
 */
export function parseURDFMaterials(urdfContent: string): Map<string, URDFMaterialInfo> {
  const namedMaterials = new Map<string, URDFMaterialInfo>();

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(urdfContent, 'text/xml');
    const parserError = doc.querySelector('parsererror');
    if (parserError) {
      throw new Error(parserError.textContent?.trim() || 'Invalid URDF XML (parsererror)');
    }

    // First pass: collect global materials (defined at robot level)
    const robotMaterials = doc.querySelectorAll('robot > material');
    robotMaterials.forEach((matEl) => {
      const name = matEl.getAttribute('name');
      if (name) {
        const colorEl = matEl.querySelector('color');
        if (colorEl) {
          const rgbaStr = colorEl.getAttribute('rgba');
          if (rgbaStr) {
            const parts = rgbaStr.trim().split(/\s+/).map(Number);
            if (parts.length >= 3) {
              namedMaterials.set(name, {
                name,
                rgba: [parts[0], parts[1], parts[2], parts[3] ?? 1],
              });
            }
          }
        }
      }
    });

    // Second pass: get ALL materials from each link's visual elements
    // This handles DAE files where each visual can have multiple named materials
    const links = doc.querySelectorAll('link');
    links.forEach((linkEl) => {
      const linkName = linkEl.getAttribute('name');
      if (!linkName) return;

      // Get ALL visual elements (not just first)
      const visualEls = linkEl.querySelectorAll('visual');
      visualEls.forEach((visualEl) => {
        // Get ALL material elements in this visual (not just first)
        const matEls = visualEl.querySelectorAll('material');
        matEls.forEach((matEl) => {
          const matName = matEl.getAttribute('name');
          if (!matName) return;

          const colorEl = matEl.querySelector('color');
          if (colorEl) {
            const rgbaStr = colorEl.getAttribute('rgba');
            if (rgbaStr) {
              const parts = rgbaStr.trim().split(/\s+/).map(Number);
              if (parts.length >= 3) {
                const rgba: [number, number, number, number] = [
                  parts[0],
                  parts[1],
                  parts[2],
                  parts[3] ?? 1,
                ];
                namedMaterials.set(matName, {
                  name: matName,
                  rgba,
                });
              }
            }
          }
        });
      });
    });
  } catch (error) {
    const context = {
      contentLength: urdfContent.length,
      hasRobotTag: urdfContent.includes('<robot'),
    };
    console.error('[URDFMaterials] Failed to parse URDF material definitions.', context, error);
    throw new Error(
      `[URDFMaterials] Failed to parse URDF material definitions (length=${context.contentLength}, hasRobotTag=${context.hasRobotTag}).`,
      { cause: error },
    );
  }

  return namedMaterials;
}

export function resolveURDFMaterialsForScene(
  urdfContent: string,
  robotLinks?: Record<string, UrdfLink> | null,
): Map<string, URDFMaterialInfo> {
  const materialsFromLinks = collectURDFMaterialsFromLinks(robotLinks);
  if (materialsFromLinks.size > 0) {
    return materialsFromLinks;
  }

  return parseURDFMaterials(urdfContent);
}

/**
 * Apply URDF materials to robot model by matching material NAMES
 * This works with DAE files where materials have specific names like "深色橡胶_005-effect"
 */
export function applyURDFMaterials(
  robot: THREE.Object3D,
  materials: Map<string, URDFMaterialInfo>,
) {
  if (materials.size === 0) return;

  robot.traverse((child: any) => {
    if (!child.isMesh) return;

    const previousMaterial = child.material as THREE.Material | THREE.Material[] | undefined;
    const previousMaterials = Array.isArray(previousMaterial)
      ? previousMaterial
      : previousMaterial
        ? [previousMaterial]
        : [];
    const nextMaterials = previousMaterials.map((material) =>
      applyURDFMaterialInfoToMaterial(material, materials),
    );
    const hasReplacement = nextMaterials.some(
      (material, index) => material !== previousMaterials[index],
    );
    if (!hasReplacement) {
      return;
    }

    child.material = Array.isArray(previousMaterial) ? nextMaterials : nextMaterials[0];
    previousMaterials.forEach((material, index) => {
      if (nextMaterials[index] !== material) {
        disposeTransientViewerMaterial(material);
      }
    });
  });
}
