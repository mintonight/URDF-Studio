import type { InspectionReport } from '@/types';
import {
  INSPECTION_PROFILE_DEFINITIONS,
  getAllInspectionProfileItemCount,
} from '../config/inspectionProfiles';
import {
  createProfileScoreMetrics,
  type SelectedInspectionProfiles,
} from '../utils/inspectionProfileSelection';

export interface RetestingItemState {
  profileId: string;
  itemId: string;
}

export interface ReportScrollTarget {
  anchorId: string;
}

export interface SetupItemScrollTarget {
  profileId: string;
  itemId: string;
}

export interface InspectionRunPointerLayout {
  deltaX: number;
  deltaY: number;
  targetX: number;
  targetY: number;
}

export type InspectionSetupMode = 'normal' | 'advanced';

export const TOTAL_INSPECTION_ITEM_COUNT = getAllInspectionProfileItemCount();

export const RUN_INSPECTION_POINTER_DURATION_MS =
  typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent) ? 300 : 2400;

export function createInitialSelectedProfiles(): SelectedInspectionProfiles {
  const initial: SelectedInspectionProfiles = {};
  INSPECTION_PROFILE_DEFINITIONS.forEach((profile) => {
    initial[profile.id] = new Set(profile.items.map((item) => item.id));
  });
  return initial;
}

export function recalculateReportMetrics(
  issues: InspectionReport['issues'],
  fallbackMaxScore: number | undefined,
): Pick<InspectionReport, 'overallScore' | 'profileScores' | 'maxScore'> {
  const metrics = createProfileScoreMetrics(issues);
  return {
    ...metrics,
    maxScore: issues.some((issue) => issue.score !== undefined)
      ? metrics.maxScore
      : (fallbackMaxScore ?? metrics.maxScore),
  };
}
