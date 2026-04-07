import * as THREE from 'three';
import type {
  SnapshotBackgroundStyle,
  SnapshotDetailLevel,
  SnapshotEnvironmentPreset,
  SnapshotGroundStyle,
  SnapshotShadowStyle,
} from './snapshotConfig';
import { SNAPSHOT_DETAIL_SHADOW_MAP_SIZE } from './snapshotConfig';

const SNAPSHOT_GRID_OBJECT_NAME = 'ReferenceGrid';
const SNAPSHOT_KEEP_HELPER_OBJECT_NAMES = new Set([
  'GroundShadowPlane',
  'SnapshotContactShadows',
  'SnapshotReflectiveFloor',
]);

const SNAPSHOT_EXCLUDED_HELPER_OBJECT_NAMES = new Set([
  '__origin_axes__',
  '__joint_axis__',
  '__joint_axis_helper__',
  '__com_visual__',
  '__inertia_box__',
  '__inertia_visual__',
  '__link_axes_helper__',
  '__debug_joint_axes__',
  'Link Axes',
  'USD Joint Axes',
]);

type Cleanup = () => void;

type ThemeKey = 'light' | 'dark';

export interface SnapshotBackgroundFill {
  kind: 'transparent' | 'solid' | 'linear-gradient';
  colors?: readonly [string, string];
}

export interface SnapshotEnvironmentPresetSettings {
  kind: 'inherit' | 'studio' | 'hdri';
  environmentIntensity: Record<ThemeKey, number>;
  environmentRotationZ: number;
}

export interface SnapshotGroundStyleSettings {
  contactShadowOpacity: number;
  contactShadowBlur: number;
  contactShadowResolution: number;
  contactShadowFar: number;
  reflectorStrength: number;
  reflectorBlur: [number, number];
  reflectorRoughness: number;
  reflectorMirror: number;
}

export interface SnapshotShadowStyleSettings {
  radius: number;
  bias: number;
  normalBias: number;
}

export const SNAPSHOT_ENVIRONMENT_PRESET_SETTINGS: Record<
  SnapshotEnvironmentPreset,
  SnapshotEnvironmentPresetSettings
> = {
  viewport: {
    kind: 'inherit',
    environmentIntensity: { light: 1, dark: 1 },
    environmentRotationZ: 0,
  },
  studio: {
    kind: 'studio',
    environmentIntensity: { light: 0.5, dark: 0.46 },
    environmentRotationZ: 0,
  },
  city: {
    kind: 'hdri',
    environmentIntensity: { light: 0.95, dark: 1.08 },
    environmentRotationZ: 0,
  },
  contrast: {
    kind: 'hdri',
    environmentIntensity: { light: 1.18, dark: 1.26 },
    environmentRotationZ: 0.7,
  },
};

export const SNAPSHOT_GROUND_STYLE_SETTINGS: Record<
  SnapshotGroundStyle,
  SnapshotGroundStyleSettings
> = {
  shadow: {
    contactShadowOpacity: 0,
    contactShadowBlur: 1.4,
    contactShadowResolution: 512,
    contactShadowFar: 10,
    reflectorStrength: 0,
    reflectorBlur: [320, 96],
    reflectorRoughness: 0.44,
    reflectorMirror: 0.18,
  },
  contact: {
    contactShadowOpacity: 0.72,
    contactShadowBlur: 2.1,
    contactShadowResolution: 768,
    contactShadowFar: 12,
    reflectorStrength: 0,
    reflectorBlur: [360, 108],
    reflectorRoughness: 0.5,
    reflectorMirror: 0.22,
  },
  reflective: {
    contactShadowOpacity: 0.56,
    contactShadowBlur: 1.6,
    contactShadowResolution: 768,
    contactShadowFar: 12,
    reflectorStrength: 0.86,
    reflectorBlur: [520, 160],
    reflectorRoughness: 0.36,
    reflectorMirror: 0.42,
  },
};

export const SNAPSHOT_SHADOW_STYLE_SETTINGS: Record<
  SnapshotShadowStyle,
  SnapshotShadowStyleSettings
> = {
  soft: {
    radius: 6,
    bias: -0.00016,
    normalBias: 0.03,
  },
  balanced: {
    radius: 3.2,
    bias: -0.00012,
    normalBias: 0.02,
  },
  crisp: {
    radius: 1.25,
    bias: -0.00008,
    normalBias: 0.012,
  },
};

const SNAPSHOT_BACKGROUND_PRESET_FILL: Record<
  Exclude<SnapshotBackgroundStyle, 'viewport' | 'transparent'>,
  SnapshotBackgroundFill
> = {
  studio: {
    kind: 'linear-gradient',
    colors: ['#f7f9fc', '#dfe7f1'],
  },
  sky: {
    kind: 'linear-gradient',
    colors: ['#d8ecff', '#f6fbff'],
  },
  dark: {
    kind: 'linear-gradient',
    colors: ['#202733', '#0c1118'],
  },
};

function getObjectMaterials(object: THREE.Object3D) {
  const mesh = object as THREE.Mesh;
  if (!('material' in mesh) || !mesh.material) {
    return [] as THREE.Material[];
  }

  return Array.isArray(mesh.material) ? mesh.material.filter(Boolean) : [mesh.material];
}

function collectMaterialTextures(material: THREE.Material) {
  const textures = new Set<THREE.Texture>();

  Object.values(material).forEach((value) => {
    if (value instanceof THREE.Texture) {
      textures.add(value);
    }
  });

  return Array.from(textures);
}

function shouldHideSnapshotSceneObject(object: THREE.Object3D, options: { hideGrid: boolean }) {
  if (object.name === SNAPSHOT_GRID_OBJECT_NAME) {
    return options.hideGrid;
  }

  if (SNAPSHOT_KEEP_HELPER_OBJECT_NAMES.has(object.name)) {
    return false;
  }

  if (
    SNAPSHOT_EXCLUDED_HELPER_OBJECT_NAMES.has(object.name) ||
    typeof object.userData?.viewerHelperKind === 'string'
  ) {
    return true;
  }

  if (
    object.userData?.isCollision === true ||
    object.userData?.isCollisionMesh === true ||
    object.userData?.isCollisionGroup === true ||
    object.userData?.geometryRole === 'collision' ||
    (object as any).isURDFCollider === true
  ) {
    return true;
  }

  if (
    object.userData?.isSelectableHelper === true ||
    object.userData?.isGizmo === true ||
    object.userData?.isHelper === true
  ) {
    return true;
  }

  return false;
}

export function applySnapshotSceneVisibility(
  scene: THREE.Scene,
  options: { hideGrid: boolean },
): Cleanup {
  const hiddenObjects: Array<{ object: THREE.Object3D; visible: boolean }> = [];

  scene.traverse((object) => {
    if (!shouldHideSnapshotSceneObject(object, options)) {
      return;
    }

    hiddenObjects.push({ object, visible: object.visible });
    object.visible = false;
  });

  return () => {
    hiddenObjects.forEach(({ object, visible }) => {
      object.visible = visible;
    });
  };
}

export function applySnapshotBackgroundStyle(
  scene: THREE.Scene,
  gl: THREE.WebGLRenderer,
  backgroundStyle: SnapshotBackgroundStyle,
): { restore: Cleanup; fill: SnapshotBackgroundFill } {
  const previousBackground = scene.background;
  const previousClearColor = gl.getClearColor(new THREE.Color()).clone();
  const previousClearAlpha = gl.getClearAlpha();

  let fill: SnapshotBackgroundFill;
  if (backgroundStyle === 'viewport') {
    fill =
      scene.background instanceof THREE.Color
        ? {
            kind: 'solid',
            colors: [`#${scene.background.getHexString()}`, `#${scene.background.getHexString()}`],
          }
        : { kind: 'transparent' };
  } else if (backgroundStyle === 'transparent') {
    fill = { kind: 'transparent' };
  } else {
    fill = SNAPSHOT_BACKGROUND_PRESET_FILL[backgroundStyle];
  }

  scene.background = null;
  gl.setClearColor(0x000000, 0);

  return {
    fill,
    restore: () => {
      scene.background = previousBackground;
      gl.setClearColor(previousClearColor, previousClearAlpha);
    },
  };
}

export function applySnapshotTextureQuality(
  scene: THREE.Scene,
  gl: THREE.WebGLRenderer,
  detailLevel: SnapshotDetailLevel,
): Cleanup {
  if (detailLevel === 'viewport') {
    return () => {};
  }

  const maxAnisotropy = gl.capabilities.getMaxAnisotropy();
  if (!Number.isFinite(maxAnisotropy) || maxAnisotropy <= 1) {
    return () => {};
  }

  const originalAnisotropy = new Map<THREE.Texture, number>();

  scene.traverse((object) => {
    getObjectMaterials(object).forEach((material) => {
      collectMaterialTextures(material).forEach((texture) => {
        if (originalAnisotropy.has(texture)) {
          return;
        }

        originalAnisotropy.set(texture, texture.anisotropy);
        texture.anisotropy = maxAnisotropy;
        texture.needsUpdate = true;
      });
    });
  });

  return () => {
    originalAnisotropy.forEach((anisotropy, texture) => {
      texture.anisotropy = anisotropy;
      texture.needsUpdate = true;
    });
  };
}

export function applySnapshotShadowQuality(
  scene: THREE.Scene,
  gl: THREE.WebGLRenderer,
  detailLevel: SnapshotDetailLevel,
  shadowStyle: SnapshotShadowStyle,
): Cleanup {
  const requestedShadowMapSize = SNAPSHOT_DETAIL_SHADOW_MAP_SIZE[detailLevel];
  if (!requestedShadowMapSize || !gl.shadowMap.enabled) {
    return () => {};
  }
  const maxShadowMapSize = Number.isFinite(gl.capabilities.maxTextureSize)
    ? Math.max(256, Math.floor(gl.capabilities.maxTextureSize))
    : requestedShadowMapSize;
  const targetShadowMapSize = Math.min(requestedShadowMapSize, maxShadowMapSize);

  const trackedLights: Array<{
    light: THREE.DirectionalLight;
    previousMapSize: THREE.Vector2;
    previousRadius: number;
    previousBias: number;
    previousNormalBias: number;
  }> = [];
  const shadowStyleSettings = SNAPSHOT_SHADOW_STYLE_SETTINGS[shadowStyle];

  scene.traverse((object) => {
    if (!(object instanceof THREE.DirectionalLight) || !object.castShadow) {
      return;
    }

    trackedLights.push({
      light: object,
      previousMapSize: object.shadow.mapSize.clone(),
      previousRadius: object.shadow.radius,
      previousBias: object.shadow.bias,
      previousNormalBias: object.shadow.normalBias,
    });

    if (
      object.shadow.mapSize.x === targetShadowMapSize &&
      object.shadow.mapSize.y === targetShadowMapSize
    ) {
      object.shadow.radius = shadowStyleSettings.radius;
      object.shadow.bias = shadowStyleSettings.bias;
      object.shadow.normalBias = shadowStyleSettings.normalBias;
      object.shadow.needsUpdate = true;
      return;
    }

    object.shadow.map?.dispose();
    object.shadow.map = null;
    object.shadow.mapSize.set(targetShadowMapSize, targetShadowMapSize);
    object.shadow.radius = shadowStyleSettings.radius;
    object.shadow.bias = shadowStyleSettings.bias;
    object.shadow.normalBias = shadowStyleSettings.normalBias;
    object.shadow.needsUpdate = true;
  });

  if (trackedLights.length === 0) {
    return () => {};
  }

  const previousAutoUpdate = gl.shadowMap.autoUpdate;
  gl.shadowMap.autoUpdate = true;
  gl.shadowMap.needsUpdate = true;

  return () => {
    trackedLights.forEach(
      ({ light, previousMapSize, previousRadius, previousBias, previousNormalBias }) => {
        light.shadow.map?.dispose();
        light.shadow.map = null;
        light.shadow.mapSize.copy(previousMapSize);
        light.shadow.radius = previousRadius;
        light.shadow.bias = previousBias;
        light.shadow.normalBias = previousNormalBias;
        light.shadow.needsUpdate = true;
      },
    );

    gl.shadowMap.autoUpdate = previousAutoUpdate;
    gl.shadowMap.needsUpdate = true;
  };
}
