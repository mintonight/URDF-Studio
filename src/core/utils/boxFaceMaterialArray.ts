import * as THREE from 'three';

import { createMatteMaterial } from './materialFactory';
import { colorRgbaTupleToOpacity } from './color.ts';
import type { UrdfVisualMaterial } from '@/types';

export interface BoxFaceMaterialDescriptor extends Pick<
  UrdfVisualMaterial,
  | 'color'
  | 'colorRgba'
  | 'name'
  | 'texture'
  | 'opacity'
  | 'roughness'
  | 'metalness'
  | 'emissive'
  | 'emissiveIntensity'
> {}

export interface CreateBoxFaceMaterialArrayOptions {
  fallbackColor?: string;
  opacity?: number;
  side?: THREE.Side;
  manager?: THREE.LoadingManager;
  label?: string;
}

function normalizeMaterialValue(value?: string | null): string | undefined {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed : undefined;
}

function normalizeUnitIntervalValue(value?: number | null): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return Math.min(1, Math.max(0, Number(value)));
}

function normalizeNonNegativeValue(value?: number | null): number | undefined {
  if (!Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(0, Number(value));
}

export function createBoxFaceMaterialArray(
  descriptors: readonly BoxFaceMaterialDescriptor[],
  {
    fallbackColor = '#808080',
    opacity = 1,
    side = THREE.DoubleSide,
    manager,
    label = 'box-face-material',
  }: CreateBoxFaceMaterialArrayOptions = {},
): THREE.MeshStandardMaterial[] {
  const textureLoader = manager ? new THREE.TextureLoader(manager) : null;
  const materialByTexturePath = new Map<string, THREE.MeshStandardMaterial[]>();

  const materials = descriptors.map((descriptor, index) => {
    const texturePath = normalizeMaterialValue(descriptor.texture);
    const authoredColor = normalizeMaterialValue(descriptor.color);
    const authoredOpacity =
      normalizeUnitIntervalValue(descriptor.opacity) ??
      colorRgbaTupleToOpacity(descriptor.colorRgba);
    const baseColor = authoredColor || (texturePath ? '#ffffff' : fallbackColor);
    const effectiveOpacity = authoredOpacity ?? opacity;
    const material = createMatteMaterial({
      color: baseColor,
      opacity: effectiveOpacity,
      roughness: normalizeUnitIntervalValue(descriptor.roughness),
      metalness: normalizeUnitIntervalValue(descriptor.metalness),
      emissive: normalizeMaterialValue(descriptor.emissive),
      emissiveIntensity: normalizeNonNegativeValue(descriptor.emissiveIntensity),
      transparent: effectiveOpacity < 1,
      side,
      preserveExactColor: true,
      name: descriptor.name || `${label}_${index + 1}`,
    });

    if (texturePath) {
      const textureUsers = materialByTexturePath.get(texturePath);
      if (textureUsers) {
        textureUsers.push(material);
      } else {
        materialByTexturePath.set(texturePath, [material]);
      }
    }

    return material;
  });

  if (!textureLoader || materialByTexturePath.size === 0) {
    return materials;
  }

  materialByTexturePath.forEach((materialUsers, texturePath) => {
    textureLoader.load(
      texturePath,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        materialUsers.forEach((material) => {
          material.map = texture;
          material.needsUpdate = true;
        });
      },
      undefined,
      (error) => {
        console.error(`[${label}] Failed to load face texture "${texturePath}".`, error);
      },
    );
  });

  return materials;
}
