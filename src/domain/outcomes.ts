export type Acceptance = 'accepted' | 'rejected' | 'neutral' | 'unknown'
export type RawOutcome = {
  id?: string
  mealId?: string
  correctionOfOutcomeId?: string
  acceptance?: Acceptance
  cookingStartedAt?: string
  dinnerReadyAt?: string
  activeEffortMinutes?: number
  repairKind?: 'simpler' | 'swap' | 'leftovers' | 'recovery' | 'takeout'
  leftoverCoverage?: 'none' | 'some' | 'one' | 'more-than-one'
  takeoutContext?: 'planned' | 'unforeseeable-disruption' | 'predictable-planning-or-acceptance-failure'
}

export type NeutralReason = 'absent' | 'ate-separately' | 'not-hungry'

export function correctedOutcomes<T extends RawOutcome>(outcomes: T[]): T[] {
  const superseded = new Set(outcomes.flatMap((outcome) => outcome.correctionOfOutcomeId ? [outcome.correctionOfOutcomeId] : []))
  return outcomes.filter((outcome) => !outcome.id || !superseded.has(outcome.id))
}

export function observedElapsedMinutes(outcome: Pick<RawOutcome, 'cookingStartedAt' | 'dinnerReadyAt'>): number | undefined {
  if (!outcome.cookingStartedAt || !outcome.dinnerReadyAt) return undefined
  const elapsed = Math.round((Date.parse(outcome.dinnerReadyAt) - Date.parse(outcome.cookingStartedAt)) / 60_000)
  return elapsed < 0 ? undefined : elapsed
}

export function householdAcceptance(personAcceptances: Acceptance[]): Acceptance {
  if (personAcceptances.includes('rejected')) return 'rejected'
  if (personAcceptances.includes('accepted')) return 'accepted'
  return personAcceptances.includes('neutral') ? 'neutral' : 'unknown'
}

export function classifyRecovery(input: Pick<RawOutcome, 'acceptance' | 'repairKind' | 'takeoutContext'>): 'none' | 'successful' | 'unsuccessful' {
  if (input.repairKind === 'recovery') return input.acceptance === 'accepted' ? 'successful' : 'unsuccessful'
  if (input.repairKind === 'takeout') return input.takeoutContext === 'predictable-planning-or-acceptance-failure' || input.acceptance !== 'accepted' ? 'unsuccessful' : 'successful'
  return 'none'
}
