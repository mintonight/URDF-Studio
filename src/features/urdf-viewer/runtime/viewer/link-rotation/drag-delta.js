const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function resolveRevoluteDragDelta({
    worldDeltaDeg,
    tangentDeltaDeg,
    planeFacingRatio,
    epsilon = 1e-5,
    maxDeltaDeg = 16,
    planeFacingThreshold = 0.2,
}) {
    const hasWorldDelta = Number.isFinite(worldDeltaDeg) && Math.abs(worldDeltaDeg) > epsilon;
    const hasTangentDelta = Number.isFinite(tangentDeltaDeg) && Math.abs(tangentDeltaDeg) > epsilon;
    if (hasTangentDelta
        && Number.isFinite(planeFacingRatio)
        && planeFacingRatio < planeFacingThreshold) {
        return clamp(tangentDeltaDeg, -maxDeltaDeg, maxDeltaDeg);
    }

    if (hasWorldDelta) {
        return clamp(worldDeltaDeg, -maxDeltaDeg, maxDeltaDeg);
    }

    if (hasTangentDelta) {
        return clamp(tangentDeltaDeg, -maxDeltaDeg, maxDeltaDeg);
    }

    return clamp(hasWorldDelta ? worldDeltaDeg : 0, -maxDeltaDeg, maxDeltaDeg);
}
