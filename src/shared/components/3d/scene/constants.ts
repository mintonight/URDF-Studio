export const LIGHTING_CONFIG = {
  ambientIntensity: 0.72,
  hemisphereIntensity: 0.58,
  hemisphereSky: '#f7fbff',
  hemisphereGround: '#d7dde5',
  mainLightIntensity: 0.42,
  mainLightPosition: [4.8, 5.6, 6.4] as [number, number, number],
  leftFillIntensity: 0.36,
  leftFillPosition: [-5.2, 4.8, 4.6] as [number, number, number],
  leftSideIntensity: 0.2,
  leftSidePosition: [-5.8, 2.8, 0.8] as [number, number, number],
  rightFillIntensity: 0.36,
  rightFillPosition: [5.2, 4.8, 4.6] as [number, number, number],
  rimLightIntensity: 0.14,
  rimLightPosition: [0, 5.4, -5.8] as [number, number, number],
  cameraKeyIntensityLight: 0.44,
  cameraKeyIntensityDark: 0.34,
  cameraKeyPriorityIntensityLight: 0.58,
  cameraKeyPriorityIntensityDark: 0.48,
  cameraFillIntensityLight: 0.32,
  cameraFillIntensityDark: 0.24,
  cameraSoftFrontIntensityLight: 0.38,
  cameraSoftFrontIntensityDark: 0.3,
} as const;

export const GROUND_SHADOW_STYLE = {
  light: {
    color: '#000000',
    opacity: 0.08,
  },
  dark: {
    color: '#000000',
    opacity: 0.2,
  },
} as const;

export const GROUND_SHADOW_RENDER_ORDER = -110;
export const GROUND_SHADOW_Z_OFFSET = -0.0015;

export function resolveCameraFollowLightingStyle(theme: 'light' | 'dark') {
  return {
    ambientIntensity: theme === 'light' ? 0.37 : 0.34,
    hemisphereIntensity: theme === 'light' ? 0.43 : 0.4,
    staticDirectionalScale: theme === 'light' ? 0.76 : 0.8,
    rimDirectionalScale: 0.38,
    mainLightIntensity:
      (theme === 'light' ? 0.5 : LIGHTING_CONFIG.mainLightIntensity) *
      (theme === 'light' ? 0.76 : 0.8),
    cameraKeyIntensity:
      theme === 'light'
        ? LIGHTING_CONFIG.cameraKeyPriorityIntensityLight
        : LIGHTING_CONFIG.cameraKeyPriorityIntensityDark,
    cameraFillIntensity:
      theme === 'light'
        ? LIGHTING_CONFIG.cameraFillIntensityLight
        : LIGHTING_CONFIG.cameraFillIntensityDark,
    cameraSoftFrontIntensity:
      theme === 'light'
        ? LIGHTING_CONFIG.cameraSoftFrontIntensityLight
        : LIGHTING_CONFIG.cameraSoftFrontIntensityDark,
    toneMappingExposure: theme === 'light' ? 0.98 : 1.0,
  } as const;
}

export const STUDIO_ENVIRONMENT_INTENSITY = {
  viewer: {
    light: 0.3,
    dark: 0.29,
  },
  workspace: {
    light: 0.42,
    dark: 0.4,
  },
} as const;

export const WORKSPACE_CANVAS_BACKGROUND = {
  light: '#f3f4f6',
  dark: '#1f1f1f',
} as const;

// Match robot_viewer's +Z presentation while preserving URDF Studio's internal Z-up world.
export const WORKSPACE_DEFAULT_CAMERA_POSITION: [number, number, number] = [2.6, -2.6, 4.6];
export const WORKSPACE_DEFAULT_CAMERA_UP: [number, number, number] = [0, 0, 1];
export const WORKSPACE_DEFAULT_CAMERA_FOV = 68;
