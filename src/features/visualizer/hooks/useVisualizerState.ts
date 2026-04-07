import { useEffect, useMemo, useState } from 'react';
import { useUIStore } from '@/store';
import {
  DEFAULT_VISUALIZER_INTERACTION_ACTIVATION_ORDER,
  resolveVisualizerInteractiveLayerPriority,
  type VisualizerInteractiveLayer,
} from '../utils/interactiveLayerPriority';

const SHOW_GEOMETRY_STORAGE_KEY = 'urdf_visualizer_show_geometry';
const SHOW_ORIGIN_STORAGE_KEY = 'urdf_visualizer_show_origin';
const SHOW_LABELS_STORAGE_KEY = 'urdf_visualizer_show_labels';
const SHOW_JOINT_AXES_STORAGE_KEY = 'urdf_visualizer_show_joint_axes';
const JOINT_AXIS_SIZE_STORAGE_KEY = 'urdf_visualizer_joint_axis_size';
const FRAME_SIZE_STORAGE_KEY = 'urdf_viewer_origin_size';
const LABEL_SCALE_STORAGE_KEY = 'urdf_visualizer_label_scale';
const SHOW_COLLISION_STORAGE_KEY = 'urdf_visualizer_show_collision';
const SHOW_INERTIA_STORAGE_KEY = 'urdf_visualizer_show_inertia';
const SHOW_CENTER_OF_MASS_STORAGE_KEY = 'urdf_visualizer_show_center_of_mass';

const readStoredBoolean = (key: string, fallback: boolean): boolean => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const saved = localStorage.getItem(key);
  if (saved === null) {
    return fallback;
  }

  return saved === 'true';
};

const readStoredNumber = (
  key: string,
  fallback: number,
  clamp: (value: number) => number,
): number => {
  if (typeof window === 'undefined') {
    return fallback;
  }

  const saved = localStorage.getItem(key);
  if (!saved) {
    return fallback;
  }

  const parsed = Number.parseFloat(saved);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return clamp(parsed);
};

export interface VisualizerState {
  // Unified scene settings
  showGeometry: boolean;
  setShowGeometry: (show: boolean) => void;
  showOrigin: boolean;
  setShowOrigin: (show: boolean) => void;
  showLabels: boolean;
  setShowLabels: (show: boolean) => void;
  showJointAxes: boolean;
  setShowJointAxes: (show: boolean) => void;
  jointAxisSize: number;
  setJointAxisSize: (size: number) => void;
  frameSize: number;
  setFrameSize: (size: number) => void;
  labelScale: number;
  setLabelScale: (scale: number) => void;
  transformMode: 'translate' | 'rotate';
  setTransformMode: (mode: 'translate' | 'rotate') => void;

  // Geometry visibility settings
  showCollision: boolean;
  setShowCollision: (show: boolean) => void;
  showVisual: boolean;
  setShowVisual: (show: boolean) => void;
  showIkHandles: boolean;
  setShowIkHandles: (show: boolean) => void;
  modelOpacity: number;
  setModelOpacity: React.Dispatch<React.SetStateAction<number>>;

  // Inertia and center of mass settings
  showInertia: boolean;
  setShowInertia: (show: boolean) => void;
  showCenterOfMass: boolean;
  setShowCenterOfMass: (show: boolean) => void;
  interactionLayerPriority: VisualizerInteractiveLayer[];
}

interface UseVisualizerStateProps {
  propShowVisual?: boolean;
  propSetShowVisual?: (show: boolean) => void;
}

/**
 * Custom hook to manage all visualizer display states
 * Handles unified display state for the visualizer scene while the renderer
 * still uses runtime-specific interaction branches internally.
 */
export function useVisualizerState({
  propShowVisual,
  propSetShowVisual,
}: UseVisualizerStateProps = {}): VisualizerState {
  const viewOptions = useUIStore((state) => state.viewOptions);
  const setViewOption = useUIStore((state) => state.setViewOption);

  const {
    showIkHandles,
    showJointAxes,
    showInertia,
    showCenterOfMass,
    showCollision,
    modelOpacity,
  } = viewOptions;

  const [showGeometry, setShowGeometry] = useState(() =>
    readStoredBoolean(SHOW_GEOMETRY_STORAGE_KEY, false),
  );
  const [showOrigin, setShowOrigin] = useState(() =>
    readStoredBoolean(SHOW_ORIGIN_STORAGE_KEY, true),
  );
  const [showLabels, setShowLabels] = useState(() =>
    readStoredBoolean(SHOW_LABELS_STORAGE_KEY, false),
  );

  const [jointAxisSize, setJointAxisSize] = useState(() =>
    readStoredNumber(JOINT_AXIS_SIZE_STORAGE_KEY, 0.35, (value) =>
      Math.min(Math.max(value, 0.01), 2.0),
    ),
  );
  const [frameSize, setFrameSize] = useState(() => {
    return readStoredNumber(FRAME_SIZE_STORAGE_KEY, 0.15, (value) =>
      Math.min(Math.max(value, 0.01), 0.8),
    );
  });

  // Keep frame size aligned with the shared viewer preference.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(FRAME_SIZE_STORAGE_KEY, frameSize.toString());
    }
  }, [frameSize]);

  const [labelScale, setLabelScale] = useState(() =>
    readStoredNumber(LABEL_SCALE_STORAGE_KEY, 1.0, (value) => Math.min(Math.max(value, 0.1), 2.0)),
  );
  const [transformMode, setTransformMode] = useState<'translate' | 'rotate'>('translate');
  const [interactionActivationOrder, setInteractionActivationOrder] = useState<
    Record<VisualizerInteractiveLayer, number>
  >(DEFAULT_VISUALIZER_INTERACTION_ACTIVATION_ORDER);

  // Handle showVisual (controlled or uncontrolled)
  const [localShowVisual, setLocalShowVisual] = useState(true);
  const showVisual = propShowVisual !== undefined ? propShowVisual : localShowVisual;

  const bumpInteractionLayer = (layer: VisualizerInteractiveLayer) => {
    setInteractionActivationOrder((previous) => {
      const nextOrder = Math.max(...Object.values(previous)) + 1;
      if (previous[layer] === nextOrder) {
        return previous;
      }

      return {
        ...previous,
        [layer]: nextOrder,
      };
    });
  };
  const setShowVisual = (nextValue: boolean | ((current: boolean) => boolean)) => {
    const resolvedValue = typeof nextValue === 'function' ? nextValue(showVisual) : nextValue;

    if (propSetShowVisual) {
      propSetShowVisual(resolvedValue);
    } else {
      setLocalShowVisual(resolvedValue);
    }

    if (resolvedValue) {
      bumpInteractionLayer('visual');
    }
  };
  const setShowCollisionTracked = (nextValue: boolean | ((current: boolean) => boolean)) => {
    const resolvedValue = typeof nextValue === 'function' ? nextValue(showCollision) : nextValue;
    setViewOption('showCollision', resolvedValue);
    if (resolvedValue) {
      bumpInteractionLayer('collision');
    }
  };
  const setShowIkHandlesTracked = (nextValue: boolean | ((current: boolean) => boolean)) => {
    const resolvedValue = typeof nextValue === 'function' ? nextValue(showIkHandles) : nextValue;
    setViewOption('showIkHandles', resolvedValue);
    if (resolvedValue) {
      bumpInteractionLayer('ik-handle');
    }
  };
  const setShowOriginTracked = (nextValue: boolean | ((current: boolean) => boolean)) => {
    const resolvedValue = typeof nextValue === 'function' ? nextValue(showOrigin) : nextValue;
    setShowOrigin(resolvedValue);
    if (resolvedValue) {
      bumpInteractionLayer('origin-axes');
    }
  };
  const setShowJointAxesTracked = (nextValue: boolean | ((current: boolean) => boolean)) => {
    const resolvedValue = typeof nextValue === 'function' ? nextValue(showJointAxes) : nextValue;
    setViewOption('showJointAxes', resolvedValue);
    if (resolvedValue) {
      bumpInteractionLayer('joint-axis');
    }
  };
  const setShowInertiaTracked = (nextValue: boolean | ((current: boolean) => boolean)) => {
    const resolvedValue = typeof nextValue === 'function' ? nextValue(showInertia) : nextValue;
    setViewOption('showInertia', resolvedValue);
    if (resolvedValue) {
      bumpInteractionLayer('inertia');
    }
  };
  const setShowCenterOfMassTracked = (nextValue: boolean | ((current: boolean) => boolean)) => {
    const resolvedValue = typeof nextValue === 'function' ? nextValue(showCenterOfMass) : nextValue;
    setViewOption('showCenterOfMass', resolvedValue);
    if (resolvedValue) {
      bumpInteractionLayer('center-of-mass');
    }
  };
  const setModelOpacity: React.Dispatch<React.SetStateAction<number>> = (nextValue) => {
    const resolvedValue = typeof nextValue === 'function' ? nextValue(modelOpacity) : nextValue;
    const clampedValue = Number.isFinite(resolvedValue)
      ? Math.max(0.1, Math.min(1, resolvedValue))
      : 1;
    setViewOption('modelOpacity', clampedValue);
  };

  useEffect(() => {
    localStorage.setItem(SHOW_GEOMETRY_STORAGE_KEY, showGeometry.toString());
  }, [showGeometry]);

  useEffect(() => {
    localStorage.setItem(SHOW_ORIGIN_STORAGE_KEY, showOrigin.toString());
  }, [showOrigin]);

  useEffect(() => {
    localStorage.setItem(SHOW_LABELS_STORAGE_KEY, showLabels.toString());
  }, [showLabels]);

  useEffect(() => {
    localStorage.setItem(SHOW_JOINT_AXES_STORAGE_KEY, showJointAxes.toString());
  }, [showJointAxes]);

  useEffect(() => {
    localStorage.setItem(JOINT_AXIS_SIZE_STORAGE_KEY, jointAxisSize.toString());
  }, [jointAxisSize]);

  useEffect(() => {
    localStorage.setItem(LABEL_SCALE_STORAGE_KEY, labelScale.toString());
  }, [labelScale]);

  useEffect(() => {
    localStorage.setItem(SHOW_COLLISION_STORAGE_KEY, showCollision.toString());
  }, [showCollision]);

  useEffect(() => {
    localStorage.setItem(SHOW_INERTIA_STORAGE_KEY, showInertia.toString());
  }, [showInertia]);

  useEffect(() => {
    localStorage.setItem(SHOW_CENTER_OF_MASS_STORAGE_KEY, showCenterOfMass.toString());
  }, [showCenterOfMass]);

  const interactionLayerPriority = useMemo(
    () =>
      resolveVisualizerInteractiveLayerPriority({
        showVisual,
        showIkHandles,
        showCollision,
        showOrigins: showOrigin,
        showJointAxes,
        showCenterOfMass,
        showInertia,
        activationOrder: interactionActivationOrder,
      }),
    [
      interactionActivationOrder,
      showCenterOfMass,
      showCollision,
      showIkHandles,
      showInertia,
      showJointAxes,
      showOrigin,
      showVisual,
    ],
  );

  return {
    showGeometry,
    setShowGeometry,
    showOrigin,
    setShowOrigin: setShowOriginTracked,
    showLabels,
    setShowLabels,
    showJointAxes,
    setShowJointAxes: setShowJointAxesTracked,
    jointAxisSize,
    setJointAxisSize,
    frameSize,
    setFrameSize,
    labelScale,
    setLabelScale,
    transformMode,
    setTransformMode,

    showCollision,
    setShowCollision: setShowCollisionTracked,
    showVisual,
    setShowVisual,
    showIkHandles,
    setShowIkHandles: setShowIkHandlesTracked,
    modelOpacity,
    setModelOpacity,

    // Inertia and Center of Mass
    showInertia,
    setShowInertia: setShowInertiaTracked,
    showCenterOfMass,
    setShowCenterOfMass: setShowCenterOfMassTracked,
    interactionLayerPriority,
  };
}
