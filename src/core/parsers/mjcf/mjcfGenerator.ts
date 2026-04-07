/**
 * MuJoCo XML Generator
 * Generates MuJoCo MJCF format from RobotState
 */

import * as THREE from 'three';
import { DEFAULT_LINK, RobotState, GeometryType, JointType, UrdfLink } from '@/types';
import {
  MAX_GEOMETRY_DIMENSION_DECIMALS,
  MAX_PROPERTY_DECIMALS,
  formatNumberWithMaxDecimals,
} from '@/core/utils/numberPrecision';
import { getVisualGeometryEntries, resolveVisualMaterialOverride } from '@/core/robot';
import { normalizeMeshPathForExport, normalizeTexturePathForExport } from '../meshPathUtils';

export type MjcfActuatorType = 'position' | 'velocity' | 'motor';

export interface MjcfVisualMeshVariant {
  meshPath: string;
  color?: string;
  sourceMaterialName?: string;
}

export interface MujocoExportOptions {
  meshdir?: string;
  texturedir?: string;
  addFloatBase?: boolean;
  includeActuators?: boolean;
  actuatorType?: MjcfActuatorType;
  includeSceneHelpers?: boolean;
  meshPathOverrides?: ReadonlyMap<string, string>;
  visualMeshVariants?: ReadonlyMap<string, readonly MjcfVisualMeshVariant[]>;
}

export const generateMujocoXML = (robot: RobotState, options: MujocoExportOptions = {}): string => {
  const { name, links, joints, rootLinkId } = robot;
  const meshdir = options.meshdir ?? '../meshes/';
  const texturedir =
    options.texturedir ??
    (meshdir.includes('meshes') ? meshdir.replace(/meshes\/?$/, 'textures/') : '../textures/');
  const addFloatBase = options.addFloatBase ?? false;
  const includeActuators = options.includeActuators ?? true;
  const actuatorType = options.actuatorType ?? 'position';
  const includeSceneHelpers = options.includeSceneHelpers ?? false;
  const meshPathOverrides = options.meshPathOverrides;
  const visualMeshVariants = options.visualMeshVariants;

  // Helper to format numbers
  const formatScalar = (n: number) => formatNumberWithMaxDecimals(n, MAX_PROPERTY_DECIMALS);
  const formatShape = (n: number) =>
    formatNumberWithMaxDecimals(n, MAX_GEOMETRY_DIMENSION_DECIMALS);
  const vecStr = (v: { x: number; y: number; z: number }) =>
    `${formatScalar(v.x)} ${formatScalar(v.y)} ${formatScalar(v.z)}`;
  const quatStr = (v: { r: number; p: number; y: number }) => {
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(v.r, v.p, v.y, 'ZYX'));
    return `${formatScalar(quaternion.w)} ${formatScalar(quaternion.x)} ${formatScalar(quaternion.y)} ${formatScalar(quaternion.z)}`;
  };
  const hasRotation = (v: { r: number; p: number; y: number } | undefined) =>
    Boolean(v && (Math.abs(v.r) > 1e-9 || Math.abs(v.p) > 1e-9 || Math.abs(v.y) > 1e-9));
  const quatAttr = (v: { r: number; p: number; y: number } | undefined) =>
    hasRotation(v) ? ` quat="${quatStr(v!)}"` : '';
  const hasFiniteJointRange = (joint: RobotState['joints'][string] | undefined): boolean =>
    Boolean(
      joint?.limit && Number.isFinite(joint.limit.lower) && Number.isFinite(joint.limit.upper),
    );

  // Helper to convert hex color to rgba string
  const hexToRgba = (hex: string) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})?$/i.exec(
      String(hex || '').trim(),
    );
    if (!result) return '0.8 0.8 0.8 1.0';
    const r = parseInt(result[1], 16) / 255;
    const g = parseInt(result[2], 16) / 255;
    const b = parseInt(result[3], 16) / 255;
    const a = result[4] ? parseInt(result[4], 16) / 255 : 1;
    return `${formatNumberWithMaxDecimals(r, 4)} ${formatNumberWithMaxDecimals(g, 4)} ${formatNumberWithMaxDecimals(b, 4)} ${formatNumberWithMaxDecimals(a, 4)}`;
  };

  type MeshScaleTuple = [number, number, number];
  type MeshRefPosTuple = [number, number, number];
  type MeshRefQuatTuple = [number, number, number, number];
  interface MeshAssetEntry {
    key: string;
    path: string | null;
    sourceAssetName: string | null;
    vertices: number[] | null;
    scale: MeshScaleTuple;
    refpos: MeshRefPosTuple | null;
    refquat: MeshRefQuatTuple | null;
  }

  const normalizeMeshScale = (dimensions?: { x: number; y: number; z: number }): MeshScaleTuple => {
    const normalize = (value: number | undefined) => {
      if (Number.isFinite(value) && Math.abs(value as number) > 1e-9) {
        return Math.abs(value as number);
      }
      return 1;
    };

    return [normalize(dimensions?.x), normalize(dimensions?.y), normalize(dimensions?.z)];
  };

  const meshScaleKey = (scale: MeshScaleTuple) =>
    `${formatShape(scale[0])} ${formatShape(scale[1])} ${formatShape(scale[2])}`;

  const normalizeMeshRefpos = (refpos?: readonly number[] | null): MeshRefPosTuple | null => {
    if (!refpos || refpos.length < 3) {
      return null;
    }

    return [Number(refpos[0] ?? 0), Number(refpos[1] ?? 0), Number(refpos[2] ?? 0)];
  };

  const normalizeMeshRefquat = (refquat?: readonly number[] | null): MeshRefQuatTuple | null => {
    if (!refquat || refquat.length < 4) {
      return null;
    }

    return [
      Number(refquat[0] ?? 1),
      Number(refquat[1] ?? 0),
      Number(refquat[2] ?? 0),
      Number(refquat[3] ?? 0),
    ];
  };

  const normalizeMjcfMeshScale = (
    mjcfMesh?: UrdfLink['visual']['mjcfMesh'],
    dimensions?: { x: number; y: number; z: number },
  ): MeshScaleTuple => {
    if (mjcfMesh?.scale && mjcfMesh.scale.length >= 3) {
      return [
        Number(mjcfMesh.scale[0] ?? 1) || 1,
        Number(mjcfMesh.scale[1] ?? 1) || 1,
        Number(mjcfMesh.scale[2] ?? 1) || 1,
      ];
    }

    return normalizeMeshScale(dimensions);
  };

  const buildMeshAssetKey = (entry: Omit<MeshAssetEntry, 'key'>) =>
    JSON.stringify({
      path: entry.path,
      sourceAssetName: entry.sourceAssetName,
      vertices: entry.vertices || [],
      scale: entry.scale,
      refpos: entry.refpos,
      refquat: entry.refquat,
    });

  const resolveVisualMeshVariants = (
    meshPath?: string,
  ): readonly MjcfVisualMeshVariant[] | undefined => {
    const normalizedPath = normalizeMeshPathForExport(meshPath);
    if (!normalizedPath) {
      return undefined;
    }

    const variants =
      visualMeshVariants?.get(meshPath || '') || visualMeshVariants?.get(normalizedPath);
    return variants && variants.length > 0 ? variants : undefined;
  };

  const resolveExportMeshPath = (meshPath?: string): string => {
    const normalizedPath = normalizeMeshPathForExport(meshPath);
    if (!normalizedPath) {
      return '';
    }

    const overridePath =
      meshPathOverrides?.get(meshPath || '') || meshPathOverrides?.get(normalizedPath);
    if (!overridePath) {
      return normalizedPath;
    }

    return normalizeMeshPathForExport(overridePath) || overridePath;
  };

  const meshAssets = new Map<string, MeshAssetEntry>();
  const registerMeshAsset = (geometry: UrdfLink['visual']) => {
    const mjcfMesh = geometry.mjcfMesh;
    const normalizedPath = resolveExportMeshPath(mjcfMesh?.file || geometry.meshPath);
    const inlineVertices =
      !mjcfMesh?.file && mjcfMesh?.vertices?.length ? [...mjcfMesh.vertices] : null;
    if (!normalizedPath && !inlineVertices) {
      return;
    }

    const entryWithoutKey: Omit<MeshAssetEntry, 'key'> = {
      path: normalizedPath || null,
      sourceAssetName: mjcfMesh?.name || geometry.assetRef || null,
      vertices: inlineVertices,
      scale: normalizeMjcfMeshScale(mjcfMesh, geometry.dimensions),
      refpos: normalizeMeshRefpos(mjcfMesh?.refpos),
      refquat: normalizeMeshRefquat(mjcfMesh?.refquat),
    };
    const key = buildMeshAssetKey(entryWithoutKey);
    if (!meshAssets.has(key)) {
      meshAssets.set(key, {
        key,
        ...entryWithoutKey,
      });
    }
  };

  Object.values(links).forEach((link) => {
    getVisualGeometryEntries(link).forEach((entry) => {
      if (entry.geometry.type !== GeometryType.MESH && entry.geometry.type !== GeometryType.SDF) {
        return;
      }

      const variants = resolveVisualMeshVariants(entry.geometry.meshPath);
      if (variants) {
        variants.forEach((variant) => {
          registerMeshAsset({
            ...entry.geometry,
            meshPath: variant.meshPath,
            mjcfMesh: entry.geometry.mjcfMesh
              ? {
                  ...entry.geometry.mjcfMesh,
                  file: variant.meshPath,
                  vertices: undefined,
                }
              : undefined,
          });
        });
      } else {
        registerMeshAsset(entry.geometry);
      }
    });
    if (
      link.collision &&
      (link.collision.type === GeometryType.MESH || link.collision.type === GeometryType.SDF)
    ) {
      registerMeshAsset(link.collision);
    }
    (link.collisionBodies || []).forEach((body) => {
      if (body.type === GeometryType.MESH || body.type === GeometryType.SDF) {
        registerMeshAsset(body);
      }
    });
  });

  const meshAssetNameMap = new Map<string, string>();
  const usedAssetNames = new Set<string>();
  const buildMeshAssetName = (entry: MeshAssetEntry): string => {
    const base =
      (entry.sourceAssetName || entry.path || 'mesh')
        .replace(/\.[^/.]+$/, '')
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/^_+|_+$/g, '') || 'mesh';

    let candidate = base;
    let i = 2;
    while (usedAssetNames.has(candidate)) {
      candidate = `${base}_${i}`;
      i += 1;
    }
    usedAssetNames.add(candidate);
    return candidate;
  };

  Array.from(meshAssets.values()).forEach((entry) => {
    meshAssetNameMap.set(entry.key, buildMeshAssetName(entry));
  });

  const resolveMeshAssetName = (
    meshPath?: string,
    dimensions?: { x: number; y: number; z: number },
    mjcfMesh?: UrdfLink['visual']['mjcfMesh'],
  ): string | null => {
    const normalizedPath = resolveExportMeshPath(mjcfMesh?.file || meshPath);
    const inlineVertices =
      !mjcfMesh?.file && mjcfMesh?.vertices?.length ? [...mjcfMesh.vertices] : null;
    if (!normalizedPath && !inlineVertices) {
      return null;
    }

    const key = buildMeshAssetKey({
      path: normalizedPath || null,
      sourceAssetName: mjcfMesh?.name || null,
      vertices: inlineVertices,
      scale: normalizeMjcfMeshScale(mjcfMesh, dimensions),
      refpos: normalizeMeshRefpos(mjcfMesh?.refpos),
      refquat: normalizeMeshRefquat(mjcfMesh?.refquat),
    });
    return meshAssetNameMap.get(key) || null;
  };

  type HfieldSizeTuple = [number, number, number, number];
  interface HfieldAssetEntry {
    key: string;
    name: string;
    file?: string;
    contentType?: string;
    nrow?: number;
    ncol?: number;
    size: HfieldSizeTuple;
    elevation?: number[];
  }

  const normalizeHfieldSize = (geometry: UrdfLink['visual']): HfieldSizeTuple | null => {
    const size = geometry.mjcfHfield?.size;
    if (!size) {
      return null;
    }

    return [size.radiusX, size.radiusY, size.elevationZ, size.baseZ];
  };

  const buildHfieldAssetKey = (geometry: UrdfLink['visual']): string | null => {
    const size = normalizeHfieldSize(geometry);
    if (!size) {
      return null;
    }

    return JSON.stringify({
      assetRef: geometry.assetRef || geometry.mjcfHfield?.name || '',
      file: geometry.mjcfHfield?.file || '',
      contentType: geometry.mjcfHfield?.contentType || '',
      nrow: geometry.mjcfHfield?.nrow ?? null,
      ncol: geometry.mjcfHfield?.ncol ?? null,
      size,
      elevation: geometry.mjcfHfield?.elevation || [],
    });
  };

  const hfieldAssets = new Map<string, HfieldAssetEntry>();
  const hfieldAssetNameMap = new Map<string, string>();
  const usedHfieldAssetNames = new Set<string>();
  const buildHfieldAssetName = (link: UrdfLink, geometry: UrdfLink['visual']): string => {
    const base =
      (geometry.assetRef || geometry.mjcfHfield?.name || `${link.name || link.id}_hfield`)
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/^_+|_+$/g, '') || 'hfield';

    let candidate = base;
    let suffix = 2;
    while (usedHfieldAssetNames.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    usedHfieldAssetNames.add(candidate);
    return candidate;
  };

  const registerHfieldAsset = (link: UrdfLink, geometry: UrdfLink['visual']) => {
    if (geometry.type !== GeometryType.HFIELD) {
      return;
    }

    const key = buildHfieldAssetKey(geometry);
    const size = normalizeHfieldSize(geometry);
    if (!key || !size || hfieldAssets.has(key)) {
      return;
    }

    const assetName = buildHfieldAssetName(link, geometry);
    hfieldAssets.set(key, {
      key,
      name: assetName,
      file: geometry.mjcfHfield?.file,
      contentType: geometry.mjcfHfield?.contentType,
      nrow: geometry.mjcfHfield?.nrow,
      ncol: geometry.mjcfHfield?.ncol,
      size,
      elevation: geometry.mjcfHfield?.elevation ? [...geometry.mjcfHfield.elevation] : undefined,
    });
    hfieldAssetNameMap.set(key, assetName);
  };

  Object.values(links).forEach((link) => {
    getVisualGeometryEntries(link).forEach((entry) => {
      registerHfieldAsset(link, entry.geometry);
    });
    registerHfieldAsset(link, link.collision);
    (link.collisionBodies || []).forEach((body) => {
      registerHfieldAsset(link, body);
    });
  });

  const resolveHfieldAssetName = (geometry: UrdfLink['visual']): string | null => {
    const key = buildHfieldAssetKey(geometry);
    if (!key) {
      return null;
    }

    return hfieldAssetNameMap.get(key) || null;
  };

  interface VisualMaterialAssetEntry {
    visualKey: string;
    linkId: string;
    objectIndex: number;
    color: string;
    texture?: string;
    specular?: number;
    shininess?: number;
    reflectance?: number;
    emission?: number;
  }

  interface VisualVariantMaterialAssetEntry {
    key: string;
    color: string;
    specular?: number;
  }

  const clampUnitScalar = (value: number | null | undefined): number | undefined => {
    if (!Number.isFinite(value)) {
      return undefined;
    }

    return Math.max(0, Math.min(1, Number(value)));
  };

  const resolveLinkMaterialPbr = (
    link: UrdfLink,
  ): Pick<VisualMaterialAssetEntry, 'specular' | 'shininess' | 'reflectance' | 'emission'> => {
    const material = robot.materials?.[link.id] || robot.materials?.[link.name];
    const usdMaterial = material?.usdMaterial;
    if (!usdMaterial || typeof usdMaterial !== 'object') {
      return {
        specular: 0,
      };
    }

    const roughness = clampUnitScalar(usdMaterial.roughness);
    const reflectance = clampUnitScalar(usdMaterial.metalness);
    const emissive =
      usdMaterial.emissive && typeof usdMaterial.emissive.length === 'number'
        ? Array.from(usdMaterial.emissive)
            .slice(0, 3)
            .map((channel) => Number(channel))
            .filter((channel) => Number.isFinite(channel))
        : [];
    const emissivePeak =
      emissive.length >= 3 ? Math.max(emissive[0] || 0, emissive[1] || 0, emissive[2] || 0) : null;
    const emissiveIntensity = Number.isFinite(usdMaterial.emissiveIntensity)
      ? Math.max(0, Number(usdMaterial.emissiveIntensity))
      : null;
    const emission =
      usdMaterial.emissiveEnabled === false
        ? undefined
        : clampUnitScalar(
            emissivePeak !== null ? emissivePeak * (emissiveIntensity ?? 1) : emissiveIntensity,
          );

    return {
      specular: 0,
      ...(roughness !== undefined ? { shininess: clampUnitScalar(1 - roughness) } : {}),
      ...(reflectance !== undefined ? { reflectance } : {}),
      ...(emission !== undefined ? { emission } : {}),
    };
  };

  const sanitizeMaterialAssetName = (value: string): string =>
    value.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, '') || 'material';

  const resolveVisualEntryKey = (linkId: string, objectIndex: number): string =>
    `${linkId}@@${objectIndex}`;
  const resolveVisualVariantKey = (visualKey: string, variantIndex: number): string =>
    `${visualKey}@@variant_${variantIndex}`;
  const resolveVisualMaterialState = (
    link: UrdfLink,
    visual: UrdfLink['visual'],
    options: { isPrimaryVisual: boolean },
  ): {
    color: string;
    texture?: string;
    source: 'authored' | 'legacy-link' | 'inline';
  } => {
    const resolvedMaterial = resolveVisualMaterialOverride(robot, link, visual, {
      isPrimaryVisual: options.isPrimaryVisual,
    });

    if (resolvedMaterial.source === 'authored') {
      return {
        color: resolvedMaterial.color || visual.color || '#808080',
        texture: resolvedMaterial.texture,
        source: 'authored',
      };
    }

    if (resolvedMaterial.source === 'legacy-link') {
      return {
        color:
          resolvedMaterial.color ||
          (resolvedMaterial.texture ? '#ffffff' : undefined) ||
          visual.color ||
          '#808080',
        texture: resolvedMaterial.texture,
        source: 'legacy-link',
      };
    }

    return {
      color: visual.color || '#808080',
      source: 'inline',
    };
  };

  const visualMaterialAssets = new Map<string, VisualMaterialAssetEntry>();
  const visualMaterialNameMap = new Map<string, string>();
  const visualVariantMaterialAssets = new Map<string, VisualVariantMaterialAssetEntry>();
  const visualVariantMaterialNameMap = new Map<string, string>();
  const visualInlineColorMap = new Map<string, string>();
  const usedMaterialNames = new Set<string>();
  const buildVisualMaterialAssetName = (link: UrdfLink, objectIndex: number): string => {
    const base = sanitizeMaterialAssetName(
      objectIndex === 0
        ? `${link.name || link.id}_mat`
        : `${link.name || link.id}_mat_${objectIndex + 1}`,
    );
    let candidate = base;
    let suffix = 2;
    while (usedMaterialNames.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    usedMaterialNames.add(candidate);
    return candidate;
  };

  const buildVisualVariantMaterialAssetName = (
    link: UrdfLink,
    objectIndex: number,
    variantIndex: number,
  ): string => {
    const suffix =
      objectIndex === 0 ? `${variantIndex + 1}` : `${objectIndex + 1}_${variantIndex + 1}`;
    const base = sanitizeMaterialAssetName(`${link.name || link.id}_mat_${suffix}`);
    let candidate = base;
    let duplicateIndex = 2;
    while (usedMaterialNames.has(candidate)) {
      candidate = `${base}_${duplicateIndex}`;
      duplicateIndex += 1;
    }
    usedMaterialNames.add(candidate);
    return candidate;
  };

  Object.entries(links).forEach(([linkId, link]) => {
    getVisualGeometryEntries(link).forEach((entry) => {
      if (entry.geometry.type === GeometryType.NONE) {
        return;
      }

      const visualKey = resolveVisualEntryKey(linkId, entry.objectIndex);
      const materialState = resolveVisualMaterialState(link, entry.geometry, {
        isPrimaryVisual: entry.bodyIndex === null,
      });
      visualInlineColorMap.set(visualKey, materialState.color);

      const variants =
        entry.geometry.type === GeometryType.MESH
          ? resolveVisualMeshVariants(entry.geometry.meshPath)
          : undefined;
      if (variants) {
        variants.forEach((variant, variantIndex) => {
          const key = resolveVisualVariantKey(visualKey, variantIndex);
          const materialName = buildVisualVariantMaterialAssetName(
            link,
            entry.objectIndex,
            variantIndex,
          );
          visualVariantMaterialAssets.set(key, {
            key,
            color: variant.color || materialState.color,
            specular: 0,
          });
          visualVariantMaterialNameMap.set(key, materialName);
        });
        return;
      }

      const pbr = entry.bodyIndex === null ? resolveLinkMaterialPbr(link) : {};
      const shouldCreateMaterialAsset =
        materialState.source !== 'inline' ||
        Object.values(pbr).some((value) => Number.isFinite(value as number));
      if (!shouldCreateMaterialAsset) {
        return;
      }

      const materialName = buildVisualMaterialAssetName(link, entry.objectIndex);
      visualMaterialAssets.set(visualKey, {
        visualKey,
        linkId,
        objectIndex: entry.objectIndex,
        color: materialState.color,
        texture: materialState.texture,
        ...pbr,
      });
      visualMaterialNameMap.set(visualKey, materialName);
    });
  });

  interface TextureAssetEntry {
    path: string;
    owningLinkId: string;
    owningObjectIndex: number;
  }

  const textureAssets = new Map<string, TextureAssetEntry>();
  const registerTextureAsset = (linkId: string, objectIndex: number, texturePath?: string) => {
    const normalizedPath = normalizeTexturePathForExport(texturePath || '');
    if (!normalizedPath) {
      return;
    }

    if (!textureAssets.has(normalizedPath)) {
      textureAssets.set(normalizedPath, {
        path: normalizedPath,
        owningLinkId: linkId,
        owningObjectIndex: objectIndex,
      });
    }
  };

  visualMaterialAssets.forEach(({ linkId, objectIndex, texture }) => {
    registerTextureAsset(linkId, objectIndex, texture);
  });

  const textureAssetNameMap = new Map<string, string>();
  const usedTextureNames = new Set<string>();
  const buildTextureAssetName = (link: UrdfLink, objectIndex: number): string => {
    const base = sanitizeMaterialAssetName(
      objectIndex === 0
        ? `${link.name || link.id}_tex`
        : `${link.name || link.id}_tex_${objectIndex + 1}`,
    );
    let candidate = base;
    let suffix = 2;
    while (usedTextureNames.has(candidate)) {
      candidate = `${base}_${suffix}`;
      suffix += 1;
    }
    usedTextureNames.add(candidate);
    return candidate;
  };

  Array.from(textureAssets.values()).forEach(({ path, owningLinkId, owningObjectIndex }) => {
    const owningLink = links[owningLinkId];
    textureAssetNameMap.set(
      path,
      buildTextureAssetName(
        owningLink || {
          ...DEFAULT_LINK,
          id: owningLinkId,
          name: owningLinkId,
        },
        owningObjectIndex,
      ),
    );
  });

  const resolveTextureAssetName = (texturePath?: string): string | null => {
    const normalizedPath = normalizeTexturePathForExport(texturePath || '');
    if (!normalizedPath) {
      return null;
    }

    return textureAssetNameMap.get(normalizedPath) || null;
  };

  const hasGeometry = (link: UrdfLink | undefined): boolean => {
    if (!link) return false;

    const hasVisual = getVisualGeometryEntries(link).length > 0;
    const hasCollision = link.collision.type !== GeometryType.NONE;
    const hasExtraCollisions = (link.collisionBodies || []).some(
      (body) => body.type !== GeometryType.NONE,
    );

    return hasVisual || hasCollision || hasExtraCollisions;
  };

  const isSyntheticWorldRoot = (linkId: string): boolean => {
    const link = links[linkId];
    if (!link) return false;

    const normalizedName = (link.name || '').trim().toLowerCase();
    if (normalizedName !== 'world') return false;

    const hasMass = (link.inertial?.mass || 0) > 0;
    return !hasMass && !hasGeometry(link);
  };

  let xml = `<mujoco model="${name}">\n`;
  xml +=
    textureAssets.size > 0
      ? `  <compiler angle="radian" meshdir="${meshdir}" texturedir="${texturedir}" />\n`
      : `  <compiler angle="radian" meshdir="${meshdir}" />\n`;

  // Assets Section
  xml += `  <asset>\n`;
  meshAssets.forEach(({ key, path, vertices, scale, refpos, refquat }) => {
    const meshName = meshAssetNameMap.get(key) || 'mesh';
    const scaleAttr = meshScaleKey(scale) === '1 1 1' ? '' : ` scale="${meshScaleKey(scale)}"`;
    const refposAttr = refpos
      ? ` refpos="${refpos.map((value) => formatScalar(value)).join(' ')}"`
      : '';
    const refquatAttr = refquat
      ? ` refquat="${refquat.map((value) => formatScalar(value)).join(' ')}"`
      : '';
    if (path) {
      xml += `    <mesh name="${meshName}" file="${path}"${scaleAttr}${refposAttr}${refquatAttr} />\n`;
      return;
    }

    if (vertices?.length) {
      xml += `    <mesh name="${meshName}" vertex="${vertices.map((value) => formatShape(value)).join(' ')}"${scaleAttr}${refposAttr}${refquatAttr} />\n`;
    }
  });
  hfieldAssets.forEach(({ name: hfieldName, file, contentType, nrow, ncol, size, elevation }) => {
    const attrs = [
      `name="${hfieldName}"`,
      file ? `file="${file}"` : '',
      contentType ? `content_type="${contentType}"` : '',
      !file && Number.isFinite(nrow) ? `nrow="${nrow}"` : '',
      !file && Number.isFinite(ncol) ? `ncol="${ncol}"` : '',
      `size="${formatShape(size[0])} ${formatShape(size[1])} ${formatShape(size[2])} ${formatShape(size[3])}"`,
      !file && elevation && elevation.length > 0
        ? `elevation="${elevation.map((value) => formatShape(value)).join(' ')}"`
        : '',
    ].filter(Boolean);
    xml += `    <hfield ${attrs.join(' ')} />\n`;
  });
  textureAssets.forEach(({ path }) => {
    const textureName = textureAssetNameMap.get(path);
    if (!textureName) {
      return;
    }
    xml += `    <texture name="${textureName}" type="2d" file="${path}" />\n`;
  });
  visualMaterialAssets.forEach(
    ({ visualKey, color, texture, specular, shininess, reflectance, emission }) => {
      const materialName = visualMaterialNameMap.get(visualKey);
      if (!materialName) {
        return;
      }
      const textureAssetName = resolveTextureAssetName(texture);
      const pbrAttrs = [
        Number.isFinite(specular) ? ` specular="${formatNumberWithMaxDecimals(specular!, 4)}"` : '',
        Number.isFinite(shininess)
          ? ` shininess="${formatNumberWithMaxDecimals(shininess!, 4)}"`
          : '',
        Number.isFinite(reflectance)
          ? ` reflectance="${formatNumberWithMaxDecimals(reflectance!, 4)}"`
          : '',
        Number.isFinite(emission) ? ` emission="${formatNumberWithMaxDecimals(emission!, 4)}"` : '',
      ].join('');
      xml += textureAssetName
        ? `    <material name="${materialName}" rgba="${hexToRgba(color)}" texture="${textureAssetName}"${pbrAttrs} />\n`
        : `    <material name="${materialName}" rgba="${hexToRgba(color)}"${pbrAttrs} />\n`;
    },
  );
  visualVariantMaterialAssets.forEach(({ key, color, specular }) => {
    const materialName = visualVariantMaterialNameMap.get(key);
    if (!materialName) {
      return;
    }

    const specularAttr = Number.isFinite(specular)
      ? ` specular="${formatNumberWithMaxDecimals(specular!, 4)}"`
      : '';
    xml += `    <material name="${materialName}" rgba="${hexToRgba(color)}"${specularAttr} />\n`;
  });
  xml += `  </asset>\n\n`;

  xml += `  <worldbody>\n`;
  if (includeSceneHelpers) {
    xml += `    <light pos="0 0 10" dir="0 0 -1" diffuse="1 1 1"/>\n`;
    xml += `    <geom type="plane" size="5 5 0.1" rgba=".9 .9 .9 1"/>\n`;
  }

  // Recursive Body Builder
  const buildBody = (linkId: string, indent: string, path = new Set<string>()) => {
    const link = links[linkId];
    if (!link) return '';

    if (path.has(linkId)) {
      console.error(`[MJCFGenerator] Skipping cyclic link reference at "${linkId}"`);
      return '';
    }

    const nextPath = new Set(path);
    nextPath.add(linkId);

    // Find the joint that connects to this link (if not root)
    const parentJoint = Object.values(joints).find((j) => j.childLinkId === linkId);

    // Body transforms should preserve the imported chain exactly. Root bodies
    // stay at the world origin unless the source state encodes an explicit
    // parent joint offset.
    let pos = '0 0 0';
    let bodyRotation: { r: number; p: number; y: number } | undefined;

    if (parentJoint) {
      pos = vecStr(parentJoint.origin.xyz);
      bodyRotation = parentJoint.origin.rpy;
    }

    let bodyXml = `${indent}<body name="${link.name}" pos="${pos}"${quatAttr(bodyRotation)}>\n`;

    // 1. Joint Definition (inside the body it belongs to)
    if (parentJoint && parentJoint.type !== JointType.FIXED) {
      if (parentJoint.type === JointType.FLOATING) {
        bodyXml += `${indent}  <freejoint name="${parentJoint.name}"/>\n`;
      } else {
        let jType = 'hinge';
        if (parentJoint.type === JointType.PRISMATIC) {
          jType = 'slide';
        } else if (parentJoint.type === JointType.BALL) {
          jType = 'ball';
        }

        const shouldEmitRange =
          parentJoint.type !== JointType.CONTINUOUS &&
          parentJoint.type !== JointType.BALL &&
          hasFiniteJointRange(parentJoint);
        const limitStr = shouldEmitRange
          ? ` range="${formatScalar(parentJoint.limit!.lower)} ${formatScalar(parentJoint.limit!.upper)}"`
          : '';
        const axisStr =
          parentJoint.type === JointType.BALL ? '' : ` axis="${vecStr(parentJoint.axis)}"`;

        bodyXml += `${indent}  <joint name="${parentJoint.name}" type="${jType}"${axisStr}${limitStr} damping="${formatScalar(parentJoint.dynamics.damping)}" frictionloss="${formatScalar(parentJoint.dynamics.friction)}"/>\n`;
      }
    }

    // 2. Inertial
    // Preserve URDF semantics: links may legitimately omit inertial data.
    // In that case, do not synthesize arbitrary mass/inertia on MJCF export.
    if (link.inertial) {
      const inertialOrigin = link.inertial.origin || {
        xyz: { x: 0, y: 0, z: 0 },
        rpy: { r: 0, p: 0, y: 0 },
      };
      const inertialRPY = inertialOrigin.rpy || { r: 0, p: 0, y: 0 };
      const hasInertialRotation =
        Math.abs(inertialRPY.r) > 1e-9 ||
        Math.abs(inertialRPY.p) > 1e-9 ||
        Math.abs(inertialRPY.y) > 1e-9;
      const inertia = link.inertial.inertia;
      const hasOffDiagonalInertia =
        Math.abs(inertia.ixy) > 1e-12 ||
        Math.abs(inertia.ixz) > 1e-12 ||
        Math.abs(inertia.iyz) > 1e-12;
      const inertialTensorAttr = hasOffDiagonalInertia
        ? `fullinertia="${formatScalar(inertia.ixx)} ${formatScalar(inertia.iyy)} ${formatScalar(inertia.izz)} ${formatScalar(inertia.ixy)} ${formatScalar(inertia.ixz)} ${formatScalar(inertia.iyz)}"`
        : `diaginertia="${formatScalar(inertia.ixx)} ${formatScalar(inertia.iyy)} ${formatScalar(inertia.izz)}"`;
      const inertialQuatAttr = hasInertialRotation ? ` quat="${quatStr(inertialRPY)}"` : '';
      bodyXml += `${indent}  <inertial pos="${vecStr(inertialOrigin.xyz || { x: 0, y: 0, z: 0 })}" mass="${formatScalar(link.inertial.mass)}"${inertialQuatAttr} ${inertialTensorAttr}/>\n`;
    }

    // 3. Visual Geom
    // Offset visual geom by its origin
    getVisualGeometryEntries(link).forEach((visualEntry) => {
      const v = visualEntry.geometry;
      const visualKey = resolveVisualEntryKey(linkId, visualEntry.objectIndex);
      const defaultVisualRgba = hexToRgba(
        visualInlineColorMap.get(visualKey) || v.color || '#808080',
      );
      let vPos = '0 0 0';
      if (v.origin) {
        vPos = vecStr(v.origin.xyz);
      }

      const meshVariants =
        v.type === GeometryType.MESH ? resolveVisualMeshVariants(v.meshPath) : undefined;

      const buildVisualGeomAttrs = (
        meshPathOverride?: string,
        materialNameOverride?: string,
        rgbaOverride: string = defaultVisualRgba,
      ) => {
        let vGeomAttrs = `pos="${vPos}"${quatAttr(v.origin?.rpy)} group="1" contype="0" conaffinity="0"`;
        if (materialNameOverride) {
          vGeomAttrs += ` material="${materialNameOverride}"`;
        } else {
          vGeomAttrs += ` rgba="${rgbaOverride}"`;
        }

        if (v.type === GeometryType.BOX) {
          vGeomAttrs += ` type="box" size="${formatScalar(v.dimensions.x / 2)} ${formatScalar(v.dimensions.y / 2)} ${formatScalar(v.dimensions.z / 2)}"`;
        } else if (v.type === GeometryType.PLANE) {
          vGeomAttrs += ` type="plane" size="${formatShape(v.dimensions.x / 2)} ${formatShape(v.dimensions.y / 2)} 0.1"`;
        } else if (v.type === GeometryType.CYLINDER) {
          vGeomAttrs += ` type="cylinder" size="${formatShape(v.dimensions.x)} ${formatShape(v.dimensions.y / 2)}"`;
        } else if (v.type === GeometryType.SPHERE) {
          vGeomAttrs += ` type="sphere" size="${formatShape(v.dimensions.x)}"`;
        } else if (v.type === GeometryType.ELLIPSOID) {
          vGeomAttrs += ` type="ellipsoid" size="${formatShape(v.dimensions.x)} ${formatShape(v.dimensions.y)} ${formatShape(v.dimensions.z)}"`;
        } else if (v.type === GeometryType.CAPSULE) {
          vGeomAttrs += ` type="capsule" size="${formatShape(v.dimensions.x)} ${formatShape(v.dimensions.y / 2)}"`;
        } else if (v.type === GeometryType.HFIELD) {
          const hfieldAssetName = resolveHfieldAssetName(v);
          if (!hfieldAssetName) {
            throw new Error(
              `[MJCF export] Height field geometry on link "${link.name}" is missing MJCF hfield asset metadata.`,
            );
          }
          vGeomAttrs += ` type="hfield" hfield="${hfieldAssetName}"`;
        } else if (v.type === GeometryType.SDF) {
          const meshAssetName = resolveMeshAssetName(v.meshPath, v.dimensions, v.mjcfMesh);
          const fallbackMeshRef = v.assetRef || resolveExportMeshPath(v.meshPath);
          if (!meshAssetName && !fallbackMeshRef) {
            throw new Error(
              `[MJCF export] Signed distance field geometry on link "${link.name}" is missing a mesh asset reference.`,
            );
          }
          vGeomAttrs += ` type="sdf" mesh="${meshAssetName || fallbackMeshRef}"`;
        } else if (v.type === GeometryType.MESH) {
          if (!meshPathOverride && !v.meshPath && !v.mjcfMesh?.vertices?.length) {
            throw new Error(
              `[MJCF export] Mesh geometry on link "${link.name}" is missing an exportable mesh path${v.assetRef ? ` (asset "${v.assetRef}" is inline-only today)` : ''}.`,
            );
          }
          const meshAssetName = resolveMeshAssetName(
            meshPathOverride || v.meshPath,
            v.dimensions,
            meshPathOverride && v.mjcfMesh
              ? {
                  ...v.mjcfMesh,
                  file: meshPathOverride,
                  vertices: undefined,
                }
              : v.mjcfMesh,
          );
          if (meshAssetName) {
            vGeomAttrs += ` type="mesh" mesh="${meshAssetName}"`;
          } else {
            const fallback = resolveExportMeshPath(meshPathOverride || v.meshPath);
            if (fallback) vGeomAttrs += ` type="mesh" mesh="${fallback}"`;
          }
        }

        return vGeomAttrs;
      };

      if (meshVariants && meshVariants.length > 0) {
        meshVariants.forEach((variant, variantIndex) => {
          const variantMaterialName = visualVariantMaterialNameMap.get(
            resolveVisualVariantKey(visualKey, variantIndex),
          );
          bodyXml += `${indent}  <geom ${buildVisualGeomAttrs(
            variant.meshPath,
            variantMaterialName,
            variant.color ? hexToRgba(variant.color) : defaultVisualRgba,
          )} />\n`;
        });
      } else {
        const visualMaterialName = visualMaterialNameMap.get(visualKey);
        bodyXml += `${indent}  <geom ${buildVisualGeomAttrs(
          v.meshPath,
          visualMaterialName,
          defaultVisualRgba,
        )} />\n`;
      }
    });

    // 4. Collision geoms use a dedicated visualization group so the runtime
    // loader can classify them as collision-only and keep them hidden unless
    // collision display is explicitly enabled.
    const collisionGeoms = [link.collision, ...(link.collisionBodies || [])].filter(
      (c) => c && c.type !== GeometryType.NONE,
    );

    collisionGeoms.forEach((c) => {
      let cPos = '0 0 0';
      if (c.origin) {
        cPos = vecStr(c.origin.xyz);
      }
      let cGeomAttrs = `pos="${cPos}"${quatAttr(c.origin?.rpy)} rgba="${hexToRgba(c.color || DEFAULT_LINK.collision.color)}" group="3" contype="1" conaffinity="1"`;

      if (c.type === GeometryType.BOX) {
        cGeomAttrs += ` type="box" size="${formatScalar(c.dimensions.x / 2)} ${formatScalar(c.dimensions.y / 2)} ${formatScalar(c.dimensions.z / 2)}"`;
      } else if (c.type === GeometryType.PLANE) {
        cGeomAttrs += ` type="plane" size="${formatShape(c.dimensions.x / 2)} ${formatShape(c.dimensions.y / 2)} 0.1"`;
      } else if (c.type === GeometryType.CYLINDER) {
        cGeomAttrs += ` type="cylinder" size="${formatShape(c.dimensions.x)} ${formatShape(c.dimensions.y / 2)}"`;
      } else if (c.type === GeometryType.SPHERE) {
        cGeomAttrs += ` type="sphere" size="${formatShape(c.dimensions.x)}"`;
      } else if (c.type === GeometryType.ELLIPSOID) {
        cGeomAttrs += ` type="ellipsoid" size="${formatShape(c.dimensions.x)} ${formatShape(c.dimensions.y)} ${formatShape(c.dimensions.z)}"`;
      } else if (c.type === GeometryType.CAPSULE) {
        cGeomAttrs += ` type="capsule" size="${formatShape(c.dimensions.x)} ${formatShape(c.dimensions.y / 2)}"`;
      } else if (c.type === GeometryType.HFIELD) {
        const hfieldAssetName = resolveHfieldAssetName(c);
        if (!hfieldAssetName) {
          throw new Error(
            `[MJCF export] Height field collision geometry on link "${link.name}" is missing MJCF hfield asset metadata.`,
          );
        }
        cGeomAttrs += ` type="hfield" hfield="${hfieldAssetName}"`;
      } else if (c.type === GeometryType.SDF) {
        const meshAssetName = resolveMeshAssetName(c.meshPath, c.dimensions, c.mjcfMesh);
        const fallbackMeshRef = c.assetRef || resolveExportMeshPath(c.meshPath);
        if (!meshAssetName && !fallbackMeshRef) {
          throw new Error(
            `[MJCF export] Signed distance field collision geometry on link "${link.name}" is missing a mesh asset reference.`,
          );
        }
        cGeomAttrs += ` type="sdf" mesh="${meshAssetName || fallbackMeshRef}"`;
      } else if (c.type === GeometryType.MESH) {
        if (!c.meshPath && !c.mjcfMesh?.vertices?.length) {
          throw new Error(
            `[MJCF export] Collision mesh geometry on link "${link.name}" is missing an exportable mesh path${c.assetRef ? ` (asset "${c.assetRef}" is inline-only today)` : ''}.`,
          );
        }

        const meshAssetName = resolveMeshAssetName(c.meshPath, c.dimensions, c.mjcfMesh);
        if (meshAssetName) {
          cGeomAttrs += ` type="mesh" mesh="${meshAssetName}"`;
        } else {
          const fallback = resolveExportMeshPath(c.meshPath);
          if (fallback) cGeomAttrs += ` type="mesh" mesh="${fallback}"`;
        }
      }

      bodyXml += `${indent}  <geom ${cGeomAttrs} />\n`;
    });

    // 5. Recursively add children
    const childJoints = Object.values(joints).filter((j) => j.parentLinkId === linkId);
    childJoints.forEach((childJoint) => {
      bodyXml += buildBody(childJoint.childLinkId, indent + '  ', nextPath);
    });

    bodyXml += `${indent}</body>\n`;
    return bodyXml;
  };

  const emitRootBodies = (): string => {
    if (!isSyntheticWorldRoot(rootLinkId)) {
      return buildBody(rootLinkId, '    ');
    }

    const rootChildren = Object.values(joints).filter((joint) => joint.parentLinkId === rootLinkId);
    return rootChildren.map((joint) => buildBody(joint.childLinkId, '    ')).join('');
  };

  const injectFreeJoint = (bodyXml: string): string => {
    const firstNewline = bodyXml.indexOf('\n');
    if (firstNewline === -1) {
      return bodyXml;
    }

    return (
      bodyXml.slice(0, firstNewline + 1) + '      <freejoint/>\n' + bodyXml.slice(firstNewline + 1)
    );
  };

  const rootBodyXml = emitRootBodies();
  const rootBodyAlreadyHasFreeJoint = /<freejoint\b/.test(rootBodyXml);
  if (addFloatBase && !rootBodyAlreadyHasFreeJoint) {
    xml += injectFreeJoint(rootBodyXml);
  } else {
    xml += rootBodyXml;
  }

  xml += `  </worldbody>\n`;

  // Actuators (conditional)
  if (includeActuators && actuatorType !== 'motor') {
    xml += `  <actuator>\n`;
    Object.values(joints).forEach((j) => {
      if (
        j.type !== JointType.FIXED &&
        j.type !== JointType.FLOATING &&
        j.type !== JointType.BALL
      ) {
        // Use joint dynamics for actuator gains
        const kv = j.dynamics?.damping ?? 1.0;
        const kp = j.limit?.effort ? j.limit.effort * 0.5 : 100.0;

        if (actuatorType === 'position') {
          xml += `    <position name="${j.name}_servo" joint="${j.name}" kp="${formatScalar(kp)}" />\n`;
        } else if (actuatorType === 'velocity') {
          xml += `    <velocity name="${j.name}_vel" joint="${j.name}" kv="${formatScalar(kv)}" />\n`;
        }
      }
    });
    xml += `  </actuator>\n`;
  } else if (includeActuators && actuatorType === 'motor') {
    xml += `  <actuator>\n`;
    Object.values(joints).forEach((j) => {
      if (
        j.type !== JointType.FIXED &&
        j.type !== JointType.FLOATING &&
        j.type !== JointType.BALL
      ) {
        xml += `    <motor name="${j.name}_motor" joint="${j.name}" gear="1" />\n`;
      }
    });
    xml += `  </actuator>\n`;
  }

  xml += `</mujoco>`;
  return xml;
};
