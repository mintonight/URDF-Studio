import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { MeasureToolProps, ViewerProps } from '../types';
import {
  applyMeasurePick,
  clearActiveMeasureGroup,
  getActiveMeasureGroup,
  getMeasurementMetrics,
  getMeasureStateMeasurements,
  setMeasureHoverTarget,
  undoMeasureState,
  type MeasureMeasurement,
} from '../utils/measurements';
import { resolveRobotMeasureTargetFromSelection } from '../utils/measureTargetResolvers';
import { useSelectionStore } from '@/store/selectionStore';

const MEASURE_LINE_COLOR = '#ef4444';
const MEASURE_AXIS_COLORS = {
  x: '#f97316',
  y: '#22c55e',
  z: '#3b82f6',
} as const;
const MEASURE_AXIS_EPSILON = 1e-6;
const MEASURE_RENDER_ORDER = 2400;
const MEASURE_LABEL_Z_INDEX_RANGE: [number, number] = [120, 0];
const MEASURE_TOTAL_LABEL_DISTANCE_FACTOR = 1.05;
const MEASURE_AXIS_LABEL_DISTANCE_FACTOR = 0.95;
const MEASURE_AXIS_DASH_SIZE = 0.03;
const MEASURE_AXIS_GAP_SIZE = 0.018;
const MEASURE_SELECTION_COLORS = {
  first: '#0ea5e9',
  second: '#10b981',
  hover: '#f59e0b',
} as const;
const MEASURE_MARKER_Z_INDEX_RANGE: [number, number] = [132, 0];
const MEASURE_PREVIEW_LINE_COLOR = '#f59e0b';
const MEASURE_PREVIEW_LABEL_DISTANCE_FACTOR = 0.95;
const SCENE_LABEL_DECIMALS = 2;
const LABEL_OFFSET_PATTERN = [
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(1, 0.45, 0),
  new THREE.Vector3(-1, 0.75, 0),
  new THREE.Vector3(0.85, -0.1, 0),
  new THREE.Vector3(-0.85, 0.15, 0),
  new THREE.Vector3(0, -0.55, 0),
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getSelectionSignature(selection?: ViewerProps['selection']): string {
  if (!selection?.type || !selection?.id) {
    return 'none';
  }

  return [
    selection.type,
    selection.id,
    selection.subType ?? 'none',
    selection.objectIndex ?? -1,
    selection.helperKind ?? 'none',
  ].join(':');
}

function buildDecompositionSegments(
  measurement: MeasureMeasurement,
): Array<{ axis: 'x' | 'y' | 'z'; points: [THREE.Vector3, THREE.Vector3] }> {
  const start = measurement.first.point;
  const end = measurement.second.point;
  const afterX = new THREE.Vector3(end.x, start.y, start.z);
  const afterY = new THREE.Vector3(end.x, end.y, start.z);

  const segments: Array<{ axis: 'x' | 'y' | 'z'; points: [THREE.Vector3, THREE.Vector3] }> = [];

  if (Math.abs(measurement.delta.x) > MEASURE_AXIS_EPSILON) {
    segments.push({ axis: 'x', points: [start, afterX] });
  }

  if (Math.abs(measurement.delta.y) > MEASURE_AXIS_EPSILON) {
    segments.push({ axis: 'y', points: [afterX, afterY] });
  }

  if (Math.abs(measurement.delta.z) > MEASURE_AXIS_EPSILON) {
    segments.push({ axis: 'z', points: [afterY, end] });
  }

  return segments;
}

function formatSegmentLength(value: number): string {
  return `${Math.abs(value).toFixed(SCENE_LABEL_DECIMALS)}m`;
}

function formatMeasurementDistance(value: number): string {
  return `${value.toFixed(SCENE_LABEL_DECIMALS)}m`;
}

const MeasurePreviewItem = memo(
  ({
    start,
    end,
    showDecomposition,
  }: {
    start: NonNullable<MeasureToolProps['measureState']['hoverTarget']>;
    end: NonNullable<MeasureToolProps['measureState']['hoverTarget']>;
    showDecomposition: boolean;
  }) => {
    const metrics = useMemo(
      () => ({
        ...getMeasurementMetrics(start.point, end.point),
        first: { point: start.point },
        second: { point: end.point },
      }),
      [end.point, start.point],
    );
    const decompositionSegments = useMemo(
      () => buildDecompositionSegments(metrics as MeasureMeasurement),
      [metrics],
    );
    const midpoint = useMemo(
      () => new THREE.Vector3().addVectors(start.point, end.point).multiplyScalar(0.5),
      [end.point, start.point],
    );
    const labelPosition = useMemo(
      () =>
        midpoint.clone().add(new THREE.Vector3(0, clamp(metrics.distance * 0.1, 0.04, 0.065), 0)),
      [metrics.distance, midpoint],
    );

    return (
      <group>
        <Line
          points={[start.point, end.point]}
          color={MEASURE_PREVIEW_LINE_COLOR}
          lineWidth={1.6}
          dashed
          dashSize={0.026}
          gapSize={0.015}
          depthTest={false}
          depthWrite={false}
          transparent
          opacity={0.86}
          renderOrder={MEASURE_RENDER_ORDER + 1}
        />
        {showDecomposition &&
          decompositionSegments.map((segment) => (
            <Line
              key={`preview:${segment.axis}`}
              points={segment.points}
              color={MEASURE_AXIS_COLORS[segment.axis]}
              lineWidth={1.15}
              dashed
              dashSize={MEASURE_AXIS_DASH_SIZE}
              gapSize={MEASURE_AXIS_GAP_SIZE}
              depthTest={false}
              depthWrite={false}
              transparent
              opacity={0.72}
              renderOrder={MEASURE_RENDER_ORDER + 1}
            />
          ))}
        <Html
          center
          position={labelPosition}
          transform
          sprite
          distanceFactor={MEASURE_PREVIEW_LABEL_DISTANCE_FACTOR}
          className="pointer-events-none select-none"
          zIndexRange={MEASURE_LABEL_Z_INDEX_RANGE}
        >
          <div className="rounded-[7px] bg-slate-950/66 px-1.5 py-[3px] font-mono text-[10px] leading-none font-semibold whitespace-nowrap text-amber-50 shadow-[0_1px_8px_rgba(2,6,23,0.28)] [text-rendering:geometricPrecision]">
            {formatMeasurementDistance(metrics.distance)}
          </div>
        </Html>
      </group>
    );
  },
);

function areSameTarget(
  left: MeasureToolProps['measureState']['hoverTarget'],
  right: MeasureToolProps['measureState']['hoverTarget'],
): boolean {
  if (!left || !right) {
    return false;
  }

  return (
    left.key === right.key &&
    left.objectType === right.objectType &&
    left.objectIndex === right.objectIndex &&
    left.point.distanceToSquared(right.point) <= 1e-12
  );
}

const MeasureTargetMarker = memo(
  ({
    target,
    tone,
    badge,
  }: {
    target: NonNullable<MeasureToolProps['measureState']['hoverTarget']>;
    tone: string;
    badge: string;
  }) => {
    const outerRadius = badge === '2' ? 0.0032 : badge === '1' ? 0.0026 : 0.0024;
    const innerRadius = outerRadius * 0.45;
    const ringOpacity = badge === '2' ? 0.24 : 0.18;

    return (
      <group>
        <mesh position={target.point} renderOrder={MEASURE_RENDER_ORDER + 4}>
          <sphereGeometry args={[outerRadius, 18, 18]} />
          <meshBasicMaterial
            color={tone}
            depthTest={false}
            depthWrite={false}
            transparent
            opacity={ringOpacity}
          />
        </mesh>
        <mesh position={target.point} renderOrder={MEASURE_RENDER_ORDER + 5}>
          <sphereGeometry args={[innerRadius, 18, 18]} />
          <meshBasicMaterial
            color={tone}
            depthTest={false}
            depthWrite={false}
            transparent
            opacity={0.96}
          />
        </mesh>
      </group>
    );
  },
);

const MeasurementItem = memo(
  ({
    measurement,
    measurementIndex,
    showDecomposition,
    isHovered,
    onHover,
    onLeave,
    onDelete,
    deleteTooltip,
  }: {
    measurement: MeasureMeasurement;
    measurementIndex: number;
    showDecomposition: boolean;
    isHovered: boolean;
    onHover: () => void;
    onLeave: () => void;
    onDelete: () => void;
    deleteTooltip: string;
  }) => {
    const midpoint = useMemo(
      () =>
        new THREE.Vector3()
          .addVectors(measurement.first.point, measurement.second.point)
          .multiplyScalar(0.5),
      [measurement.first.point, measurement.second.point],
    );
    const distance = useMemo(
      () => formatMeasurementDistance(measurement.distance),
      [measurement.distance],
    );
    const decompositionSegments = useMemo(
      () => buildDecompositionSegments(measurement),
      [measurement],
    );
    const endpointRadius = useMemo(
      () => clamp(measurement.distance * 0.0065, 0.0018, 0.0052),
      [measurement.distance],
    );
    const labelLift = useMemo(
      () => clamp(measurement.distance * 0.07, 0.028, 0.05),
      [measurement.distance],
    );
    const labelOffset = useMemo(
      () =>
        LABEL_OFFSET_PATTERN[measurementIndex % LABEL_OFFSET_PATTERN.length]
          .clone()
          .multiplyScalar(labelLift * 1.25),
      [labelLift, measurementIndex],
    );
    const totalLabelPosition = useMemo(
      () =>
        midpoint
          .clone()
          .add(labelOffset)
          .add(new THREE.Vector3(0, labelLift * 1.7, 0)),
      [labelLift, labelOffset, midpoint],
    );
    const decompositionLabels = useMemo(
      () =>
        decompositionSegments.map((segment, index) => ({
          axis: segment.axis,
          text: `${segment.axis.toUpperCase()} ${formatSegmentLength(measurement.delta[segment.axis])}`,
          position: new THREE.Vector3()
            .addVectors(segment.points[0], segment.points[1])
            .multiplyScalar(0.5)
            .add(labelOffset.clone().multiplyScalar(0.28))
            .add(new THREE.Vector3(0, labelLift * (0.55 + index * 0.42), 0)),
        })),
      [decompositionSegments, labelLift, labelOffset, measurement.delta],
    );

    return (
      <group>
        <mesh position={measurement.first.point} renderOrder={MEASURE_RENDER_ORDER + 2}>
          <sphereGeometry args={[endpointRadius, 16, 16]} />
          <meshBasicMaterial
            color={MEASURE_LINE_COLOR}
            depthTest={false}
            depthWrite={false}
            transparent
            opacity={0.92}
          />
        </mesh>
        <mesh position={measurement.second.point} renderOrder={MEASURE_RENDER_ORDER + 2}>
          <sphereGeometry args={[endpointRadius, 16, 16]} />
          <meshBasicMaterial
            color={MEASURE_LINE_COLOR}
            depthTest={false}
            depthWrite={false}
            transparent
            opacity={0.92}
          />
        </mesh>
        <Line
          points={[measurement.first.point, measurement.second.point]}
          color={MEASURE_LINE_COLOR}
          lineWidth={2}
          depthTest={false}
          depthWrite={false}
          transparent
          opacity={0.96}
          renderOrder={MEASURE_RENDER_ORDER}
        />
        {showDecomposition &&
          decompositionSegments.map((segment) => (
            <Line
              key={`${measurement.id}:${segment.axis}`}
              points={segment.points}
              color={MEASURE_AXIS_COLORS[segment.axis]}
              lineWidth={1.35}
              dashed
              dashSize={MEASURE_AXIS_DASH_SIZE}
              gapSize={MEASURE_AXIS_GAP_SIZE}
              depthTest={false}
              depthWrite={false}
              transparent
              opacity={0.92}
              renderOrder={MEASURE_RENDER_ORDER + 1}
            />
          ))}
        {showDecomposition &&
          decompositionLabels.map((segmentLabel) => (
            <Html
              key={`${measurement.id}:label:${segmentLabel.axis}`}
              center
              position={segmentLabel.position}
              transform
              sprite
              distanceFactor={MEASURE_AXIS_LABEL_DISTANCE_FACTOR}
              className="pointer-events-none select-none"
              zIndexRange={MEASURE_LABEL_Z_INDEX_RANGE}
            >
              <div
                className="rounded-[7px] bg-slate-950/62 px-1.5 py-[3px] font-mono text-[9px] leading-none font-semibold whitespace-nowrap shadow-[0_1px_6px_rgba(2,6,23,0.24)] [text-rendering:geometricPrecision]"
                style={{
                  color: `${MEASURE_AXIS_COLORS[segmentLabel.axis]}F2`,
                }}
              >
                {segmentLabel.text}
              </div>
            </Html>
          ))}
        <Html
          center
          position={totalLabelPosition}
          transform
          sprite
          distanceFactor={MEASURE_TOTAL_LABEL_DISTANCE_FACTOR}
          className="pointer-events-none select-none"
          zIndexRange={MEASURE_LABEL_Z_INDEX_RANGE}
        >
          <div
            className={`group pointer-events-auto flex cursor-pointer items-center gap-1 rounded-[7px] bg-slate-950/68 px-1.5 py-[3px] font-mono text-[10px] leading-none font-semibold whitespace-nowrap shadow-[0_1px_8px_rgba(2,6,23,0.28)] transition-colors [text-rendering:geometricPrecision] ${
              isHovered ? 'text-red-50' : 'text-red-100/96 hover:text-red-50'
            }`}
            onMouseEnter={onHover}
            onMouseLeave={onLeave}
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            title={deleteTooltip}
          >
            {distance}
            <svg
              className={`h-2.5 w-2.5 transition-opacity ${isHovered ? 'opacity-100' : 'opacity-0'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </div>
        </Html>
      </group>
    );
  },
);

export const MeasureTool: React.FC<MeasureToolProps> = ({
  active,
  robot,
  robotLinks,
  measureState,
  setMeasureState,
  measureAnchorMode,
  showDecomposition,
  deleteTooltip = 'Click to delete this measurement',
  measureTargetResolverRef,
}) => {
  const selection = useSelectionStore((state) => state.selection);
  const hoveredSelection = useSelectionStore((state) => state.hoveredSelection);
  const [hoveredMeasurementId, setHoveredMeasurementId] = useState<string | null>(null);
  const lastSelectionSignatureRef = useRef('none');
  const lastHoverSignatureRef = useRef('none');
  const wasActiveRef = useRef(active);
  const resolveMeasureTarget = useCallback(
    (nextSelection = selection, fallbackSelection = hoveredSelection) =>
      measureTargetResolverRef?.current?.(nextSelection, fallbackSelection, measureAnchorMode) ??
      resolveRobotMeasureTargetFromSelection(
        robot,
        robotLinks,
        nextSelection,
        fallbackSelection,
        measureAnchorMode,
      ),
    [hoveredSelection, measureAnchorMode, measureTargetResolverRef, robot, robotLinks, selection],
  );

  useEffect(() => {
    if (!active) {
      setHoveredMeasurementId(null);
      lastSelectionSignatureRef.current = getSelectionSignature(selection);
      lastHoverSignatureRef.current = getSelectionSignature(hoveredSelection);
      setMeasureState((prev) => {
        if (!prev.hoverTarget) {
          return prev;
        }

        return {
          ...prev,
          hoverTarget: null,
        };
      });
    }
  }, [active, hoveredSelection, selection, setMeasureState]);

  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = active;

    if (!active || wasActive) {
      return;
    }

    lastSelectionSignatureRef.current = getSelectionSignature(selection);
    lastHoverSignatureRef.current = getSelectionSignature(hoveredSelection);

    const target = resolveMeasureTarget(hoveredSelection, hoveredSelection);
    setMeasureState((prev) => {
      if (!target && !prev.hoverTarget) {
        return prev;
      }

      return setMeasureHoverTarget(prev, target);
    });
  }, [active, hoveredSelection, resolveMeasureTarget, selection, setMeasureState]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const currentSelectionSignature = getSelectionSignature(selection);
    if (currentSelectionSignature === lastSelectionSignatureRef.current) {
      return;
    }

    lastSelectionSignatureRef.current = currentSelectionSignature;

    const target = resolveMeasureTarget(selection, hoveredSelection);
    if (!target) {
      return;
    }

    setMeasureState((prev) => applyMeasurePick(prev, target));
  }, [
    active,
    robot,
    selection,
    selection?.id,
    selection?.objectIndex,
    selection?.subType,
    selection?.type,
    selection?.helperKind,
    hoveredSelection,
    hoveredSelection?.id,
    hoveredSelection?.objectIndex,
    hoveredSelection?.subType,
    hoveredSelection?.type,
    hoveredSelection?.helperKind,
    resolveMeasureTarget,
    setMeasureState,
  ]);

  useEffect(() => {
    if (!active) {
      return;
    }

    const currentHoverSignature = getSelectionSignature(hoveredSelection);
    if (currentHoverSignature === lastHoverSignatureRef.current) {
      return;
    }

    lastHoverSignatureRef.current = currentHoverSignature;
    const target = resolveMeasureTarget(hoveredSelection, hoveredSelection);

    setMeasureState((prev) => {
      if (!target && !prev.hoverTarget) {
        return prev;
      }

      return setMeasureHoverTarget(prev, target);
    });
  }, [
    active,
    hoveredSelection,
    hoveredSelection?.id,
    hoveredSelection?.objectIndex,
    hoveredSelection?.subType,
    hoveredSelection?.type,
    hoveredSelection?.helperKind,
    resolveMeasureTarget,
    setMeasureState,
  ]);

  useEffect(() => {
    if (!active) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMeasureState((prev) => clearActiveMeasureGroup(prev));
        return;
      }

      if (event.key === 'Backspace' || event.key === 'Delete') {
        setMeasureState((prev) => undoMeasureState(prev));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, setMeasureState]);

  const handleDeleteMeasurement = useCallback(
    (measurementId: string) => {
      setMeasureState((prev) => {
        const targetGroup = prev.groups.find((group) => group.id === measurementId);
        if (!targetGroup) {
          return prev;
        }

        return clearActiveMeasureGroup({
          ...prev,
          activeGroupId: targetGroup.id,
        });
      });
    },
    [setMeasureState],
  );

  const measurements = useMemo(() => getMeasureStateMeasurements(measureState), [measureState]);
  const activeGroup = useMemo(() => getActiveMeasureGroup(measureState), [measureState]);
  const hoverBadge = activeGroup.activeSlot === 'second' ? '2' : '1';
  const shouldShowHoverMarker = Boolean(
    active &&
    measureState.hoverTarget &&
    !areSameTarget(measureState.hoverTarget, activeGroup.first) &&
    !areSameTarget(measureState.hoverTarget, activeGroup.second),
  );
  const shouldShowFirstMarker = active && Boolean(activeGroup.first) && !activeGroup.second;
  const shouldShowSecondMarker = active && Boolean(activeGroup.second) && !activeGroup.first;
  const previewTargets = useMemo(() => {
    if (!active || !measureState.hoverTarget) {
      return null;
    }

    if (
      activeGroup.first &&
      !activeGroup.second &&
      !areSameTarget(activeGroup.first, measureState.hoverTarget)
    ) {
      return {
        start: activeGroup.first,
        end: measureState.hoverTarget,
      };
    }

    if (
      activeGroup.second &&
      !activeGroup.first &&
      !areSameTarget(activeGroup.second, measureState.hoverTarget)
    ) {
      return {
        start: measureState.hoverTarget,
        end: activeGroup.second,
      };
    }

    return null;
  }, [active, activeGroup.first, activeGroup.second, measureState.hoverTarget]);

  return (
    <group>
      {shouldShowFirstMarker && activeGroup.first ? (
        <MeasureTargetMarker
          target={activeGroup.first}
          tone={MEASURE_SELECTION_COLORS.first}
          badge="1"
        />
      ) : null}
      {shouldShowSecondMarker && activeGroup.second ? (
        <MeasureTargetMarker
          target={activeGroup.second}
          tone={MEASURE_SELECTION_COLORS.second}
          badge="2"
        />
      ) : null}
      {shouldShowHoverMarker && measureState.hoverTarget ? (
        <MeasureTargetMarker
          target={measureState.hoverTarget}
          tone={MEASURE_SELECTION_COLORS.hover}
          badge={hoverBadge}
        />
      ) : null}
      {previewTargets ? (
        <MeasurePreviewItem
          start={previewTargets.start}
          end={previewTargets.end}
          showDecomposition={showDecomposition}
        />
      ) : null}
      {active &&
        measurements.map((measurement, index) => (
          <MeasurementItem
            key={measurement.id}
            measurement={measurement}
            measurementIndex={index}
            showDecomposition={showDecomposition}
            isHovered={hoveredMeasurementId === measurement.id}
            onHover={() => setHoveredMeasurementId(measurement.id)}
            onLeave={() => setHoveredMeasurementId(null)}
            onDelete={() => handleDeleteMeasurement(measurement.id)}
            deleteTooltip={deleteTooltip}
          />
        ))}
    </group>
  );
};
