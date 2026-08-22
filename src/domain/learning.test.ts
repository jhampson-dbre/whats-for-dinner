import { describe, expect, it } from 'vitest'
import { mealLearning } from './learning'

describe('meal learning', () => {
  it('uses corrected household evidence and keeps contradictions in Learning', () => {
    expect(mealLearning([], 'tacos')).toMatchObject({ confidence: 'Estimated', relevant: 0 })
    expect(mealLearning([{ id: 'one', mealId: 'tacos', acceptance: 'accepted' }], 'tacos')).toMatchObject({ confidence: 'Learning', relevant: 1 })
    expect(mealLearning([
      { id: 'one', mealId: 'tacos', acceptance: 'accepted' },
      { id: 'two', mealId: 'tacos', acceptance: 'accepted' },
      { id: 'three', mealId: 'tacos', acceptance: 'accepted' },
    ], 'tacos')).toMatchObject({ confidence: 'Established', relevant: 3 })
    expect(mealLearning([
      { id: 'one', mealId: 'tacos', acceptance: 'accepted' },
      { id: 'two', mealId: 'tacos', acceptance: 'rejected' },
      { id: 'three', mealId: 'tacos', acceptance: 'accepted' },
    ], 'tacos')).toMatchObject({ confidence: 'Learning', contradictory: true })
  })

  it('retains leftover acceptance without treating it as cooking reliability evidence', () => {
    expect(mealLearning([{ id: 'leftover', mealId: 'tacos', acceptance: 'accepted', leftoverServing: true } as never], 'tacos')).toMatchObject({ confidence: 'Estimated', relevant: 0 })
  })

  it('derives an absent leftover marker from direct V3 plan-slot context', () => {
    const outcomes = [{ id: 'leftover', mealId: 'tacos', planSlotId: 'leftover-slot', acceptance: 'accepted', activeEffortMinutes: 20 }, { id: 'cooked', mealId: 'tacos', planSlotId: 'cook-slot', acceptance: 'accepted', activeEffortMinutes: 20 }] as never[]
    expect(mealLearning(outcomes, 'tacos', [{ id: 'leftover-slot', leftoverFromSlotId: 'source-slot' }, { id: 'cook-slot' }])).toMatchObject({ relevant: 1, confidence: 'Learning' })
  })
})
