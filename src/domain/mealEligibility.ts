export function mealEligibility({ hardRestrictions, safetyReview }: { hardRestrictions: { id: string }[]; safetyReview?: 'unknown' | 'approved' | 'rejected' }) {
  if (safetyReview === 'rejected') return { eligible: false, reason: 'Not compatible with household restrictions.' }
  if (hardRestrictions.length > 0 && safetyReview !== 'approved') return { eligible: false, reason: 'Confirm compatibility before planning.' }
  return { eligible: true } as const
}
