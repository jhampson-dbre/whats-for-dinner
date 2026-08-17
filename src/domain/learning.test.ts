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
})
