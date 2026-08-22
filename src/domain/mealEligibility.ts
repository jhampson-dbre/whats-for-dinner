export function mealEligibility({ hardRestrictions, diners, safetyReview }: { hardRestrictions: { id: string; dinerId?: string }[]; diners?: { id: string; active: boolean }[]; safetyReview?: 'unknown' | 'approved' | 'rejected' }) {
  if (safetyReview === 'rejected') return { eligible: false, reason: 'Not compatible with household restrictions.' }
  if (hardRestrictions.some((restriction) => !restriction.dinerId || !diners || diners.some((diner) => diner.id === restriction.dinerId && diner.active)) && safetyReview !== 'approved') return { eligible: false, reason: 'Confirm compatibility before planning.' }
  return { eligible: true } as const
}
