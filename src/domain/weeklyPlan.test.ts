import { describe, expect, it } from 'vitest'
import { buildWeeklyPlan, PLAN_WEIGHTS } from './weeklyPlan'

const base = {
  household: { diners: [], hardRestrictions: [], scheduleExceptions: [] },
  recipes: [], plans: [], leftoverLots: [],
  outcomes: [],
}

describe('weekly plan', () => {
  it('treats first-run non-provisional meals as familiar and does not invent leftovers', () => {
    const plan = buildWeeklyPlan({ ...base, meals: [
      { id: 'meal-b', name: 'B', active: true, safetyReview: 'approved' },
      { id: 'meal-a', name: 'A', active: true, safetyReview: 'approved' },
    ] }, '2026-08-17')

    expect(plan.slots).toHaveLength(7)
    expect(plan.slots[0]).toMatchObject({ mealId: 'meal-a' })
    expect(plan.slots[0]).not.toHaveProperty('leftoverFrom')
    expect(plan.slots.filter((slot) => slot.leftoverFrom !== undefined)).toHaveLength(0)
  })

  it('excludes inactive, rejected, and unknown-safety meals when restrictions apply', () => {
    const plan = buildWeeklyPlan({ ...base, household: { ...base.household, hardRestrictions: [{ id: 'restriction-1' }] }, meals: [
      { id: 'inactive', name: 'Inactive', active: false, safetyReview: 'approved' },
      { id: 'rejected', name: 'Rejected', active: true, safetyReview: 'rejected' },
      { id: 'unknown', name: 'Unknown', active: true, safetyReview: 'unknown' },
      { id: 'approved', name: 'Approved', active: true, safetyReview: 'approved' },
    ] }, '2026-08-17')

    expect(plan.slots.every((slot) => slot.mealId === 'approved')).toBe(true)
    expect(plan.excluded).toEqual(expect.arrayContaining([
      expect.objectContaining({ mealId: 'inactive' }),
      expect.objectContaining({ mealId: 'rejected' }),
      expect.objectContaining({ mealId: 'unknown', reason: 'Confirm compatibility before planning.' }),
    ]))
  })

  it('uses fixed weighted reasons, constrained-night time fit, variety, and confidence bands', () => {
    const plan = buildWeeklyPlan({ ...base, household: { ...base.household, scheduleExceptions: [{ id: 'late', date: '2026-08-17', constrained: true }] }, meals: [
      { id: 'slow', name: 'Slow', active: true, safetyReview: 'approved' },
      { id: 'quick', name: 'Quick', active: true, safetyReview: 'approved' },
    ], recipes: [{ id: 'slow-recipe', title: 'Slow', mealId: 'slow', prepMinutes: 20, cookMinutes: 30 }, { id: 'quick-recipe', title: 'Quick', mealId: 'quick', prepMinutes: 10, cookMinutes: 10 }] }, '2026-08-17')

    expect(PLAN_WEIGHTS).toEqual({ acceptanceHistory: 32, effortTimeFit: 18, scheduleContext: 12, sharedAdaptation: 12, variety: 12, leftoverFit: 8, confidence: 6 })
    expect(plan.slots[0]).toMatchObject({ mealId: 'quick', confidence: 'Estimated' })
    expect(plan.slots[0].reasons).toEqual(expect.arrayContaining(['Fits this constrained night (18 effort/time + 12 schedule).', 'Estimated: no household outcomes yet.']))
    expect(plan.slots[1].mealId).not.toBe(plan.slots[0].mealId)
  })

  it('does not schedule a meal that cannot fit a constrained night', () => {
    const plan = buildWeeklyPlan({ ...base, household: { ...base.household, scheduleExceptions: [{ id: 'late', date: '2026-08-17', constrained: true }] }, meals: [{ id: 'slow', name: 'Slow', active: true, safetyReview: 'approved' }], recipes: [{ id: 'slow-recipe', title: 'Slow', mealId: 'slow', prepMinutes: 20, cookMinutes: 30 }] }, '2026-08-17')

    expect(plan.slots).toHaveLength(0)
    expect(plan.excluded).toContainEqual({ mealId: 'slow', reason: 'Does not fit constrained night on 2026-08-17.' })
  })

  it('keeps contradictory history in Learning confidence and only treats provisional meals as unfamiliar', () => {
    const plan = buildWeeklyPlan({ ...base, meals: [
      { id: 'mixed', name: 'Mixed', active: true, safetyReview: 'approved' },
      { id: 'fallback', name: 'Fallback', active: true, safetyReview: 'approved' },
      { id: 'neutral', name: 'Neutral', active: true, safetyReview: 'approved', provisional: true },
    ], outcomes: [
      { id: 'one', mealId: 'mixed', acceptance: 'accepted' }, { id: 'two', mealId: 'mixed', acceptance: 'rejected' }, { id: 'three', mealId: 'mixed', acceptance: 'accepted' },
      { id: 'four', mealId: 'fallback', acceptance: 'accepted' }, { id: 'five', mealId: 'neutral', acceptance: 'neutral' },
    ] }, '2026-08-17')

    expect(plan.slots.find((slot) => slot.mealId === 'mixed')).toMatchObject({ confidence: 'Learning' })
    expect(plan.optional).toMatchObject({ mealId: 'neutral', fallbackMealId: 'fallback' })
  })

  it('offers at most one unfamiliar meal only with a proven fallback, and defaults to that fallback', () => {
    const plan = buildWeeklyPlan({ ...base, meals: [
      { id: 'fallback', name: 'Fallback', active: true, safetyReview: 'approved' },
      { id: 'new', name: 'New', active: true, safetyReview: 'approved', provisional: true },
    ], outcomes: [{ id: 'outcome-1', mealId: 'fallback', acceptance: 'accepted' }] }, '2026-08-17')

    expect(plan.optional).toMatchObject({ mealId: 'new', fallbackMealId: 'fallback' })
    expect(plan.slots.some((slot) => slot.mealId === 'new')).toBe(false)
    expect(buildWeeklyPlan({ ...base, meals: [
      { id: 'fallback', name: 'Fallback', active: true, safetyReview: 'approved' },
      { id: 'new', name: 'New', active: true, safetyReview: 'approved', provisional: true },
    ], outcomes: [{ id: 'outcome-1', mealId: 'fallback', acceptance: 'accepted' }] }, '2026-08-17', 'use').slots[0].mealId).toBe('new')
  })

  it('uses an optional provisional meal on only its first cooking slot', () => {
    const plan = buildWeeklyPlan({ ...base, meals: [
      { id: 'fallback', name: 'Fallback', active: true, safetyReview: 'approved' },
      { id: 'optional', name: 'Optional', active: true, provisional: true, safetyReview: 'approved', adaptations: [{}] },
    ], outcomes: [{ id: 'fallback-outcome', mealId: 'fallback', acceptance: 'accepted' }] }, '2026-08-17', 'use')

    expect(plan.slots[0].mealId).toBe('optional')
    expect(plan.slots.slice(1).every((slot) => slot.mealId !== 'optional')).toBe(true)
  })

  it('offers only one of two provisional meals and does not offer either without a familiar fallback', () => {
    const plan = buildWeeklyPlan({ ...base, meals: [
      { id: 'fallback', name: 'Fallback', active: true, safetyReview: 'approved' },
      { id: 'new-a', name: 'New A', active: true, safetyReview: 'approved', provisional: true },
      { id: 'new-b', name: 'New B', active: true, safetyReview: 'approved', provisional: true },
    ], outcomes: [{ id: 'fallback-outcome', mealId: 'fallback', acceptance: 'accepted' }] }, '2026-08-17')
    const noFallback = buildWeeklyPlan({ ...base, meals: [
      { id: 'new-a', name: 'New A', active: true, safetyReview: 'approved', provisional: true },
      { id: 'new-b', name: 'New B', active: true, safetyReview: 'approved', provisional: true },
    ] }, '2026-08-17')

    expect(plan.optional).toMatchObject({ mealId: 'new-a', fallbackMealId: 'fallback' })
    expect(plan.slots.every((slot) => slot.mealId === 'fallback')).toBe(true)
    expect(noFallback).toMatchObject({ slots: [] })
    expect(noFallback.optional).toBeUndefined()
  })

  it('requires an accepted outcome before offering a familiar meal as a provisional fallback', () => {
    const plan = buildWeeklyPlan({ ...base, meals: [
      { id: 'familiar', name: 'Familiar', active: true, safetyReview: 'approved' },
      { id: 'new', name: 'New', active: true, provisional: true, safetyReview: 'approved' },
    ] }, '2026-08-17')

    expect(plan.slots).toHaveLength(7)
    expect(plan.optional).toBeUndefined()
  })

  it('treats missing timing as unknown capacity on constrained nights and no effort fit on ordinary nights', () => {
    const constrained = buildWeeklyPlan({ ...base, household: { ...base.household, scheduleExceptions: [{ id: 'late', date: '2026-08-17', constrained: true }] }, meals: [{ id: 'meal', name: 'Meal', active: true, safetyReview: 'approved' }] }, '2026-08-17')
    const incomplete = buildWeeklyPlan({ ...base, household: { ...base.household, scheduleExceptions: [{ id: 'late', date: '2026-08-17', constrained: true }] }, meals: [{ id: 'meal', name: 'Meal', active: true, safetyReview: 'approved' }], recipes: [{ id: 'recipe', mealId: 'meal', prepMinutes: 10 }] }, '2026-08-17')
    const ordinary = buildWeeklyPlan({ ...base, meals: [{ id: 'meal', name: 'Meal', active: true, safetyReview: 'approved' }] }, '2026-08-17')

    expect(constrained).toMatchObject({ slots: [], excluded: [expect.objectContaining({ reason: 'Timing is unknown on constrained night 2026-08-17.' })] })
    expect(incomplete).toMatchObject({ slots: [], excluded: [expect.objectContaining({ reason: 'Timing is unknown on constrained night 2026-08-17.' })] })
    expect(ordinary.slots[0]).toMatchObject({ score: 40 })
    expect(ordinary.slots[0].reasons).toContain('Timing is unknown, so effort/time fit has no points.')
  })

  it('uses planned leftovers only for meals explicitly flagged for one dinner', () => {
    const plan = buildWeeklyPlan({ ...base, meals: [
      { id: 'leftovers', name: 'Leftovers', active: true, safetyReview: 'approved', plannedLeftoverDinner: true },
      { id: 'regular', name: 'Regular', active: true, safetyReview: 'approved' },
    ] }, '2026-08-17')

    expect(plan.slots).toHaveLength(7)
    expect(plan.slots.filter((slot) => slot.leftoverFrom !== undefined).length).toBeGreaterThan(0)
    expect(plan.slots.filter((slot) => slot.mealId === 'regular').every((slot) => slot.leftoverFrom === undefined)).toBe(true)
    expect(plan.slots.filter((slot) => slot.leftoverFrom !== undefined).every((slot) => slot.reasons.join(' ').includes('8 leftover fit'))).toBe(true)
  })
})
