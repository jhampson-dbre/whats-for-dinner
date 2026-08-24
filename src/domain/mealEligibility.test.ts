import { describe, expect, it } from 'vitest'
import { mealEligibility } from './mealEligibility'

describe('meal eligibility', () => {
  it('blocks an unknown meal when the household has a hard restriction until compatibility is confirmed', () => {
    expect(mealEligibility({ hardRestrictions: [{ id: 'restriction-1' }], safetyReview: 'unknown' })).toEqual({ eligible: false, reason: 'Confirm compatibility before planning.' })
    expect(mealEligibility({ hardRestrictions: [{ id: 'restriction-1' }], safetyReview: 'approved' })).toEqual({ eligible: true })
  })

  it('ignores a diner-scoped restriction while that diner is inactive', () => {
    expect(mealEligibility({ hardRestrictions: [{ id: 'restriction-1', dinerId: 'ava' }], diners: [{ id: 'ava', active: false }], safetyReview: 'unknown' })).toEqual({ eligible: true })
    expect(mealEligibility({ hardRestrictions: [{ id: 'restriction-1', dinerId: 'ava' }], diners: [{ id: 'ava', active: true }], safetyReview: 'unknown' })).toEqual({ eligible: false, reason: 'Confirm compatibility before planning.' })
  })
})
