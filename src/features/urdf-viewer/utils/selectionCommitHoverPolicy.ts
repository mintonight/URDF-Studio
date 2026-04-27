import type { InteractionSelection } from '@/types';

import type { ResolvedInteractionSelectionHit } from './selectionTargets';

export type SelectionCommitHoverAction =
  | {
      mode: 'preserve';
      hoveredSelection: InteractionSelection;
    }
  | {
      mode: 'clear';
    };

export function resolveSelectionCommitHoverAction(
  resolvedHit: Pick<
    ResolvedInteractionSelectionHit,
    'type' | 'id' | 'subType' | 'targetKind' | 'linkId' | 'objectIndex' | 'highlightTarget'
  >,
): SelectionCommitHoverAction {
  if (
    resolvedHit.targetKind !== 'geometry' ||
    resolvedHit.type !== 'link' ||
    resolvedHit.subType === undefined
  ) {
    return { mode: 'clear' };
  }

  return {
    mode: 'preserve',
    hoveredSelection: {
      type: 'link',
      id: resolvedHit.linkId ?? resolvedHit.id,
      subType: resolvedHit.subType,
      objectIndex: resolvedHit.objectIndex ?? 0,
      highlightObjectId: resolvedHit.highlightTarget?.id,
    },
  };
}
