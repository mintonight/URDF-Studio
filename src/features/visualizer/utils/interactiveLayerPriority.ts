export type VisualizerInteractiveLayer =
  | 'ik-handle'
  | 'visual'
  | 'collision'
  | 'origin-axes'
  | 'joint-axis'
  | 'center-of-mass'
  | 'inertia';

export const DEFAULT_VISUALIZER_INTERACTION_ACTIVATION_ORDER: Record<
  VisualizerInteractiveLayer,
  number
> = {
  'ik-handle': 0,
  visual: 1,
  collision: 0,
  'origin-axes': 0,
  'joint-axis': 0,
  'center-of-mass': 0,
  inertia: 0,
};

const BASE_LAYER_PRIORITY: Record<VisualizerInteractiveLayer, number> = {
  'joint-axis': 7,
  'origin-axes': 6,
  'ik-handle': 5,
  visual: 4,
  collision: 3,
  'center-of-mass': 2,
  inertia: 1,
};

export interface ResolveVisualizerInteractiveLayerPriorityOptions {
  showVisual: boolean;
  showIkHandles: boolean;
  showCollision: boolean;
  showOrigins: boolean;
  showJointAxes: boolean;
  showCenterOfMass: boolean;
  showInertia: boolean;
  activationOrder: Record<VisualizerInteractiveLayer, number>;
}

function getVisibleLayers({
  showVisual,
  showIkHandles,
  showCollision,
  showOrigins,
  showJointAxes,
  showCenterOfMass,
  showInertia,
}: ResolveVisualizerInteractiveLayerPriorityOptions): VisualizerInteractiveLayer[] {
  const layers: VisualizerInteractiveLayer[] = [];

  if (showVisual) layers.push('visual');
  if (showIkHandles) layers.push('ik-handle');
  if (showCollision) layers.push('collision');
  if (showOrigins) layers.push('origin-axes');
  if (showJointAxes) layers.push('joint-axis');
  if (showCenterOfMass) layers.push('center-of-mass');
  if (showInertia) layers.push('inertia');

  return layers;
}

export function resolveVisualizerInteractiveLayerPriority(
  options: ResolveVisualizerInteractiveLayerPriorityOptions,
): VisualizerInteractiveLayer[] {
  return getVisibleLayers(options).sort((left, right) => {
    const activationDelta =
      (options.activationOrder[right] ?? 0) - (options.activationOrder[left] ?? 0);
    if (activationDelta !== 0) {
      return activationDelta;
    }

    return BASE_LAYER_PRIORITY[right] - BASE_LAYER_PRIORITY[left];
  });
}
