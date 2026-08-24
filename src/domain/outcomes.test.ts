import { describe, expect, it } from 'vitest'
import { classifyRecovery, correctedOutcomes, householdAcceptance, observedElapsedMinutes } from './outcomes'

describe('outcomes', () => {
  it('keeps raw corrections append-only while deriving timing and household acceptance', () => {
    const outcomes = correctedOutcomes([
      { id: 'old', mealId: 'tacos', acceptance: 'rejected' },
      { id: 'fix', mealId: 'tacos', correctionOfOutcomeId: 'old', acceptance: 'accepted', cookingStartedAt: '2026-08-17T17:00:00.000Z', dinnerReadyAt: '2026-08-17T17:25:00.000Z' },
    ])

    expect(outcomes).toEqual([expect.objectContaining({ id: 'fix' })])
    expect(observedElapsedMinutes(outcomes[0])).toBe(25)
    expect(observedElapsedMinutes({ cookingStartedAt: '2026-08-17T17:00:00.000Z' })).toBeUndefined()
    expect(householdAcceptance(['accepted', 'neutral', 'rejected'])).toBe('rejected')
    expect(householdAcceptance(['accepted', 'neutral'])).toBe('accepted')
  })

  it('classifies takeout using its repair context', () => {
    expect(classifyRecovery({ acceptance: 'accepted' })).toBe('none')
    expect(classifyRecovery({ repairKind: 'simpler', acceptance: 'accepted' })).toBe('successful')
    expect(classifyRecovery({ repairKind: 'swap', acceptance: 'rejected' })).toBe('unsuccessful')
    expect(classifyRecovery({ repairKind: 'leftovers', acceptance: 'accepted' })).toBe('successful')
    expect(classifyRecovery({ repairKind: 'recovery', acceptance: 'accepted' })).toBe('successful')
    expect(classifyRecovery({ repairKind: 'recovery', acceptance: 'rejected' })).toBe('unsuccessful')
    expect(classifyRecovery({ repairKind: 'takeout', takeoutContext: 'planned', acceptance: 'accepted' })).toBe('successful')
    expect(classifyRecovery({ repairKind: 'takeout', takeoutContext: 'unforeseeable-disruption', acceptance: 'accepted' })).toBe('successful')
    expect(classifyRecovery({ repairKind: 'takeout', takeoutContext: 'predictable-planning-or-acceptance-failure', acceptance: 'accepted' })).toBe('unsuccessful')
  })

  it('leaves reversed cooking timestamps unknown', () => {
    expect(observedElapsedMinutes({ cookingStartedAt: '2026-08-17T18:00:00.000Z', dinnerReadyAt: '2026-08-17T17:00:00.000Z' })).toBeUndefined()
  })
})
