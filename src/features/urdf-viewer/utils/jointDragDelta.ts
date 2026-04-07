interface ResolveRevoluteDragDeltaOptions {
  worldDelta: number;
  tangentDelta: number;
  planeFacingRatio: number;
  epsilon?: number;
  maxDelta?: number;
  planeFacingThreshold?: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function resolveRevoluteDragDelta({
  worldDelta,
  tangentDelta,
  planeFacingRatio,
  epsilon = 1e-5,
  maxDelta = Math.PI / 8,
  planeFacingThreshold = 0.2,
}: ResolveRevoluteDragDeltaOptions): number {
  const hasWorldDelta = Number.isFinite(worldDelta) && Math.abs(worldDelta) > epsilon;
  const hasTangentDelta = Number.isFinite(tangentDelta) && Math.abs(tangentDelta) > epsilon;

  if (
    hasTangentDelta &&
    Number.isFinite(planeFacingRatio) &&
    planeFacingRatio < planeFacingThreshold
  ) {
    return clamp(tangentDelta, -maxDelta, maxDelta);
  }

  if (hasWorldDelta) {
    return clamp(worldDelta, -maxDelta, maxDelta);
  }

  if (hasTangentDelta) {
    return clamp(tangentDelta, -maxDelta, maxDelta);
  }

  return clamp(hasWorldDelta ? worldDelta : 0, -maxDelta, maxDelta);
}
