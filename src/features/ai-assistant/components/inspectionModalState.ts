import type { InspectionReport } from '@/types';
import { calculateOverallScore, INSPECTION_CRITERIA } from '../utils/inspectionCriteria';
import type { SelectedInspectionItems } from './InspectionSidebar';

export interface RetestingItemState {
  categoryId: string;
  itemId: string;
}

export interface ReportScrollTarget {
  anchorId: string;
}

export interface InspectionRunPointerLayout {
  deltaX: number;
  deltaY: number;
  targetX: number;
  targetY: number;
}

export type InspectionSetupMode = 'normal' | 'advanced';

const INSPECTION_SETUP_MODE_STORAGE_KEY = 'urdf-studio.ai-inspection.setup-mode';

export const TOTAL_INSPECTION_ITEM_COUNT = INSPECTION_CRITERIA.reduce(
  (sum, category) => sum + category.items.length,
  0,
);

export function readStoredInspectionSetupMode(): InspectionSetupMode {
  if (typeof window === 'undefined') {
    return 'advanced';
  }

  try {
    const storedMode = window.localStorage.getItem(INSPECTION_SETUP_MODE_STORAGE_KEY);
    return storedMode === 'normal' || storedMode === 'advanced' ? storedMode : 'advanced';
  } catch {
    return 'advanced';
  }
}

export function writeStoredInspectionSetupMode(mode: InspectionSetupMode): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(INSPECTION_SETUP_MODE_STORAGE_KEY, mode);
  } catch {
    // Ignore storage write failures and keep the in-memory mode.
  }
}

export function createInitialSelectedItems(): SelectedInspectionItems {
  const initial: SelectedInspectionItems = {};
  INSPECTION_CRITERIA.forEach((category) => {
    initial[category.id] = new Set(category.items.map((item) => item.id));
  });
  return initial;
}

export function recalculateReportMetrics(
  issues: InspectionReport['issues'],
  fallbackMaxScore: number | undefined,
): Pick<InspectionReport, 'overallScore' | 'categoryScores' | 'maxScore'> {
  const categoryScoreBuckets: Record<string, number[]> = {};
  INSPECTION_CRITERIA.forEach((category) => {
    categoryScoreBuckets[category.id] = [];
  });

  issues.forEach((issue) => {
    if (!issue.category || issue.score === undefined) {
      return;
    }
    if (!categoryScoreBuckets[issue.category]) {
      categoryScoreBuckets[issue.category] = [];
    }
    categoryScoreBuckets[issue.category].push(issue.score);
  });

  const categoryScores: Record<string, number> = {};
  Object.entries(categoryScoreBuckets).forEach(([categoryId, scores]) => {
    categoryScores[categoryId] =
      scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 10;
  });

  const allItemScores = issues
    .map((issue) => issue.score)
    .filter((score): score is number => score !== undefined);

  const overallScore = calculateOverallScore(categoryScores, allItemScores);

  return {
    overallScore: Math.round(overallScore * 10) / 10,
    categoryScores,
    maxScore: allItemScores.length > 0 ? allItemScores.length * 10 : (fallbackMaxScore ?? 100),
  };
}
