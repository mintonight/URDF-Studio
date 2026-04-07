import type { VisualizerMeshPreloadSpec } from './visualizerMeshLoading';

export interface CollisionPreloadPriorityContext {
  hoveredLinkId?: string | null;
  prioritizedComponentIds?: readonly (string | null | undefined)[];
  rootLinkId?: string | null;
  selectedLinkId?: string | null;
  visibleComponentIdByLinkId?: ReadonlyMap<string, string>;
}

function collectUniqueLinkIds(meshLoadKeys: readonly string[]): string[] {
  const linkIds = new Set<string>();

  meshLoadKeys.forEach((meshLoadKey) => {
    const [linkId] = meshLoadKey.split('|');
    if (linkId) {
      linkIds.add(linkId);
    }
  });

  return Array.from(linkIds);
}

function scoreCollisionPreloadSpec(
  spec: VisualizerMeshPreloadSpec,
  {
    hoveredLinkId = null,
    prioritizedComponentIds = [],
    rootLinkId = null,
    selectedLinkId = null,
    visibleComponentIdByLinkId,
  }: CollisionPreloadPriorityContext,
): number {
  const prioritizedComponentIdSet = new Set(
    prioritizedComponentIds.filter((componentId): componentId is string => Boolean(componentId)),
  );
  const linkIds = collectUniqueLinkIds(spec.meshLoadKeys);

  let score = 0;
  linkIds.forEach((linkId) => {
    if (selectedLinkId && linkId === selectedLinkId) {
      score += 1000;
    }
    if (hoveredLinkId && linkId === hoveredLinkId) {
      score += 800;
    }
    if (rootLinkId && linkId === rootLinkId) {
      score += 120;
    }

    const componentId = visibleComponentIdByLinkId?.get(linkId);
    if (componentId && prioritizedComponentIdSet.has(componentId)) {
      score += 500;
    }
  });

  return score;
}

export function sortCollisionPreloadSpecs(
  specs: readonly VisualizerMeshPreloadSpec[],
  context: CollisionPreloadPriorityContext,
): VisualizerMeshPreloadSpec[] {
  return specs
    .map((spec, index) => ({
      index,
      score: scoreCollisionPreloadSpec(spec, context),
      spec,
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.index - right.index;
    })
    .map(({ spec }) => spec);
}
