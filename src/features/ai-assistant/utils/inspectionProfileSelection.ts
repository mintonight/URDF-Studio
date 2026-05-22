import {
  INSPECTION_PROFILE_DEFINITIONS,
  getInspectionProfileDefinition,
  getInspectionProfileItem,
} from '../config/inspectionProfiles'

export type SelectedInspectionProfiles = Record<string, Set<string>>
export type SelectedInspectionProfileMap = Record<string, string[]>

export function createAllSelectedInspectionProfiles(): SelectedInspectionProfiles {
  return INSPECTION_PROFILE_DEFINITIONS.reduce<SelectedInspectionProfiles>((selected, profile) => {
    selected[profile.id] = new Set(profile.items.map((item) => item.id))
    return selected
  }, {})
}

export function createSelectedInspectionProfilesForProfileIds(
  profileIds: string[],
): SelectedInspectionProfiles {
  const selected: SelectedInspectionProfiles = {}

  profileIds.forEach((profileId) => {
    const profile = getInspectionProfileDefinition(profileId)
    if (!profile) {
      return
    }

    selected[profile.id] = new Set(profile.items.map((item) => item.id))
  })

  return selected
}

export function toSelectedInspectionProfileMap(
  selectedProfiles: SelectedInspectionProfiles,
): SelectedInspectionProfileMap {
  return Object.fromEntries(
    Object.entries(selectedProfiles)
      .map(([profileId, itemIds]) => [profileId, Array.from(itemIds)] as const)
      .filter(([, itemIds]) => itemIds.length > 0),
  )
}

export function countSelectedInspectionProfileItems(
  selectedProfiles: SelectedInspectionProfiles,
) {
  return Object.values(selectedProfiles).reduce((sum, itemIds) => sum + itemIds.size, 0)
}

export function countSelectedInspectionProfiles(selectedProfiles: SelectedInspectionProfiles) {
  return Object.values(selectedProfiles).filter((itemIds) => itemIds.size > 0).length
}

export function hasSelectedInspectionProfileItem(
  selectedProfiles: SelectedInspectionProfileMap | undefined,
  profileId: string,
  itemId: string,
) {
  return Boolean(selectedProfiles?.[profileId]?.includes(itemId))
}

export function isKnownInspectionProfileItem(profileId: string, itemId: string) {
  return Boolean(getInspectionProfileItem(profileId, itemId))
}

export function createProfileScoreMetrics(issues: Array<{ profileId: string; score?: number }>) {
  const profileScoreBuckets: Record<string, number[]> = {}

  issues.forEach((issue) => {
    if (issue.score === undefined) {
      return
    }

    if (!profileScoreBuckets[issue.profileId]) {
      profileScoreBuckets[issue.profileId] = []
    }

    profileScoreBuckets[issue.profileId].push(issue.score)
  })

  const profileScores: Record<string, number> = {}
  Object.entries(profileScoreBuckets).forEach(([profileId, scores]) => {
    profileScores[profileId] =
      scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 10
  })

  const scoredItems = issues
    .map((issue) => issue.score)
    .filter((score): score is number => score !== undefined)
  const totalAwardedScore = scoredItems.reduce((sum, score) => sum + score, 0)
  const maxScore = scoredItems.length > 0 ? scoredItems.length * 10 : 100

  return {
    overallScore: scoredItems.length > 0 ? Math.round(totalAwardedScore * 10) / 10 : 100,
    profileScores,
    maxScore,
  }
}
