import type { RobotData, UrdfLink, UrdfVisual, UrdfVisualMaterial } from '@/types';
import { getVisualGeometryByObjectIndex, updateVisualGeometryByObjectIndex } from './visualBodies';

type RobotMaterials = RobotData['materials'];

export interface ResolvedVisualMaterialOverride {
  authoredMaterials?: UrdfVisualMaterial[];
  color?: string;
  texture?: string;
  source: 'authored' | 'legacy-link' | 'none';
  isMultiMaterial: boolean;
}

function normalizeMaterialValue(value?: string | null): string | undefined {
  const trimmed = String(value || '').trim();
  return trimmed ? trimmed : undefined;
}

function normalizeAuthoredMaterialEntry(
  material: UrdfVisualMaterial | null | undefined,
): UrdfVisualMaterial | null {
  if (!material) {
    return null;
  }

  const name = normalizeMaterialValue(material.name);
  const color = normalizeMaterialValue(material.color);
  const texture = normalizeMaterialValue(material.texture);

  if (!name && !color && !texture) {
    return null;
  }

  return {
    ...(name ? { name } : {}),
    ...(color ? { color } : {}),
    ...(texture ? { texture } : {}),
  };
}

function resolveLegacyLinkMaterial(
  materials: RobotMaterials | undefined,
  link: Pick<UrdfLink, 'id' | 'name'>,
): UrdfVisualMaterial | null {
  const material = materials?.[link.id] || materials?.[link.name];
  if (!material) {
    return null;
  }

  return normalizeAuthoredMaterialEntry({
    color: material.color,
    texture: material.texture,
  });
}

export function getGeometryAuthoredMaterials(
  geometry: Pick<UrdfVisual, 'authoredMaterials'> | null | undefined,
): UrdfVisualMaterial[] {
  if (!Array.isArray(geometry?.authoredMaterials)) {
    return [];
  }

  return geometry.authoredMaterials
    .map((material) => normalizeAuthoredMaterialEntry(material))
    .filter((material): material is UrdfVisualMaterial => Boolean(material));
}

export function getEffectiveGeometryAuthoredMaterials(
  geometry: Pick<UrdfVisual, 'authoredMaterials' | 'color'> | null | undefined,
): UrdfVisualMaterial[] {
  const authoredMaterials = getGeometryAuthoredMaterials(geometry);
  if (authoredMaterials.length !== 1) {
    return authoredMaterials;
  }

  const inlineColor = normalizeMaterialValue(geometry?.color);
  if (!inlineColor || authoredMaterials[0]?.color) {
    return authoredMaterials;
  }

  return [
    {
      ...authoredMaterials[0],
      color: inlineColor,
    },
  ];
}

export function hasMultipleAuthoredMaterials(
  geometry: Pick<UrdfVisual, 'authoredMaterials'> | null | undefined,
): boolean {
  return getGeometryAuthoredMaterials(geometry).length > 1;
}

export function canEditGeometryBaseTexture(
  geometry: Pick<UrdfVisual, 'authoredMaterials'> | null | undefined,
): boolean {
  return !hasMultipleAuthoredMaterials(geometry);
}

export function resolveVisualMaterialOverride(
  robot: Pick<RobotData, 'materials'>,
  link: Pick<UrdfLink, 'id' | 'name'>,
  geometry: Pick<UrdfVisual, 'authoredMaterials' | 'color'>,
  options: {
    isPrimaryVisual?: boolean;
  } = {},
): ResolvedVisualMaterialOverride {
  const authoredMaterials = getEffectiveGeometryAuthoredMaterials(geometry);
  if (authoredMaterials.length > 0) {
    const [primaryMaterial] = authoredMaterials;
    return {
      authoredMaterials,
      color: primaryMaterial?.color,
      texture: primaryMaterial?.texture,
      source: 'authored',
      isMultiMaterial: authoredMaterials.length > 1,
    };
  }

  if (options.isPrimaryVisual !== false) {
    const legacyLinkMaterial = resolveLegacyLinkMaterial(robot.materials, link);
    if (legacyLinkMaterial) {
      return {
        color: legacyLinkMaterial.color,
        texture: legacyLinkMaterial.texture,
        source: 'legacy-link',
        isMultiMaterial: false,
      };
    }
  }

  return {
    source: 'none',
    isMultiMaterial: false,
  };
}

export function updateVisualBaseTextureByObjectIndex(
  link: UrdfLink,
  objectIndex: number,
  texture: string | null | undefined,
): UrdfLink {
  const targetGeometry = getVisualGeometryByObjectIndex(link, objectIndex)?.geometry;
  if (!targetGeometry) {
    return link;
  }

  const authoredMaterials = getGeometryAuthoredMaterials(targetGeometry);
  if (authoredMaterials.length > 1) {
    return link;
  }

  const nextTexture = normalizeMaterialValue(texture);
  const nextMaterial = normalizeAuthoredMaterialEntry({
    ...(authoredMaterials[0] || {}),
    ...(nextTexture ? { texture: nextTexture } : { texture: undefined }),
  });

  return updateVisualGeometryByObjectIndex(link, objectIndex, {
    authoredMaterials: nextMaterial ? [nextMaterial] : undefined,
  });
}

export function collectGeometryTexturePaths(
  geometry: Pick<UrdfVisual, 'authoredMaterials'> | null | undefined,
): string[] {
  return getGeometryAuthoredMaterials(geometry)
    .map((material) => material.texture)
    .filter((texture): texture is string => Boolean(texture));
}
