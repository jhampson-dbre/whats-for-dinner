import { describe, expect, it } from 'vitest'
import { buildWeeklyPlan, PLAN_WEIGHTS, replanRemainingWeek, type WeeklyPlan } from './weeklyPlan'

const base = { household: { diners: [], hardRestrictions: [], scheduleExceptions: [] }, recipes: [], plans: [], leftoverLots: [], outcomes: [] }
const meal = (id: string, extra = {}) => ({ id, name: id, active: true, safetyReview: 'approved' as const, ...extra })
const plan = (preview: WeeklyPlan) => {
  expect(preview.kind).toBe('plan')
  if (preview.kind !== 'plan') throw new Error('Expected plan')
  return preview
}
const cookingIds = (preview: ReturnType<typeof plan>) => preview.slots.filter((slot) => slot.leftoverFrom === undefined).map((slot) => slot.mealId)

describe('weekly plan', () => {
  it('keeps the initial wrapper equivalent and reserves requested takeout dates', () => {
    const state = { ...base, meals: [meal('a'), meal('b')] }
    expect(buildWeeklyPlan(state, '2026-08-17')).toEqual(replanRemainingWeek(state, { kind: 'initial', startDate: '2026-08-17' }))
    const preview = plan(replanRemainingWeek(state, { kind: 'initial', startDate: '2026-08-17', takeoutDates: ['2026-08-17', '2026-08-19'] }))
    expect(preview.slots.filter((slot) => slot.kind === 'takeout')).toHaveLength(2)
    expect(preview.slots.filter((slot) => slot.leftoverFrom !== undefined).every((slot) => slot.date !== '2026-08-17' && slot.date !== '2026-08-19')).toBe(true)
  })

  it('repairs only the selected unfinished slot and emits a revision draft', () => {
    const state = { ...base, meals: [meal('a'), meal('b')], plans: [{ id: 'plan', slots: [{ id: 'done', date: '2026-08-17', mealId: 'a', dinnerReadyAt: '2026-08-17T18:00:00.000Z' }, { id: 'target', date: '2026-08-18', mealId: 'a' }, { id: 'outside', date: '2026-08-19', mealId: 'b' }] }], leftoverLots: [] }
    const preview = replanRemainingWeek(state, { kind: 'repair', planId: 'plan', targetDate: '2026-08-18', action: { kind: 'takeout', takeoutContext: 'planned' } })
    expect(preview).toMatchObject({ kind: 'repair', changedSlotIds: ['target'], revisionDrafts: [{ slotId: 'target', kind: 'takeout' }] })
    if (preview.kind === 'repair') expect(preview.plan.slots.find((slot) => slot.id === 'outside')).toEqual(state.plans[0].slots[2])
    expect(replanRemainingWeek(state, { kind: 'repair', planId: 'plan', targetDate: '2026-08-17', action: { kind: 'replan' } })).toMatchObject({ kind: 'invalid-target' })
  })

  it('refills a source closure with an available recipe and leaves outside slots unchanged', () => {
    const state = { ...base, meals: [meal('blocked', { recipeIds: ['blocked-r'] }), meal('available', { recipeIds: ['available-r'] })], recipes: [{ id: 'blocked-r', ingredients: ['1 cup tomatoes'] }, { id: 'available-r', ingredients: ['1 cup beans'] }], plans: [{ id: 'plan', slots: [{ id: 'source', date: '2026-08-17', mealId: 'blocked' }, { id: 'dependent', date: '2026-08-18', mealId: 'blocked', leftoverFromSlotId: 'source' }, { id: 'outside', date: '2026-08-19', mealId: 'available' }], shopping: { items: [{ id: 'tomatoes', availability: 'unavailable', perishable: false, mealIds: ['blocked'], sourceLines: ['1 cup tomatoes'], sourceSlotIds: ['source'] }] } }], leftoverLots: [] }
    const preview = replanRemainingWeek(state, { kind: 'repair', planId: 'plan', targetDate: '2026-08-17', action: { kind: 'replan' } })
    expect(preview).toMatchObject({ kind: 'repair', changedSlotIds: ['source', 'dependent'], revisionDrafts: [{ slotId: 'source', kind: 'replan' }, { slotId: 'dependent', kind: 'replan' }] })
    if (preview.kind === 'repair') {
      expect(preview.plan.slots.find((slot) => slot.id === 'source')).toMatchObject({ mealId: 'available', recipeId: 'available-r' })
      expect(preview.plan.slots.find((slot) => slot.id === 'outside')).toEqual(state.plans[0].slots[2])
    }
  })

  it('reports immutable perishable contribution evidence', () => {
    const state = { ...base, meals: [meal('a'), meal('b')], plans: [{ id: 'plan', slots: [{ id: 'target', date: '2026-08-17', mealId: 'a' }], shopping: { items: [{ id: 'milk', availability: 'available', perishable: true, mealIds: ['a'], sourceLines: ['1 cup milk'], sourceSlotIds: ['target'] }] } }], leftoverLots: [] }
    const before = JSON.stringify(state.plans[0].shopping)
    const preview = replanRemainingWeek(state, { kind: 'repair', planId: 'plan', targetDate: '2026-08-17', action: { kind: 'recovery', mealId: 'b' } })
    expect(preview).toMatchObject({ kind: 'repair', perishableRisks: [{ itemId: 'milk', sourceSlotId: 'target', sourceLine: '1 cup milk' }] })
    expect(JSON.stringify(state.plans[0].shopping)).toBe(before)
  })

  it('uses selected recipe effort when refilling a constrained repair', () => {
    const state = { ...base, household: { ...base.household, scheduleExceptions: [{ date: '2026-08-17', constrained: true }] }, meals: [meal('slow', { recipeIds: ['slow-v'] }), meal('fast', { recipeIds: ['fast-v', 'other-v'] })], recipes: [{ id: 'slow-v', prepMinutes: 10 }, { id: 'fast-v', prepMinutes: 10 }, { id: 'other-v', prepMinutes: 50 }], outcomes: [{ id: 'slow-effort', mealId: 'slow', recipeId: 'slow-v', activeEffortMinutes: 31 }, { id: 'other-effort', mealId: 'fast', recipeId: 'other-v', activeEffortMinutes: 60 }], plans: [{ id: 'plan', slots: [{ id: 'target', date: '2026-08-17', mealId: 'slow', recipeId: 'slow-v' }] }], leftoverLots: [] }
    const preview = replanRemainingWeek(state, { kind: 'repair', planId: 'plan', targetDate: '2026-08-17', action: { kind: 'replan' } })

    expect(preview).toMatchObject({ kind: 'repair' })
    if (preview.kind === 'repair') expect(preview.plan.slots[0]).toMatchObject({ mealId: 'fast', recipeId: 'fast-v' })
  })

  it('rejects simpler repairs on leftover consumers and swaps with active leftover sources', () => {
    const meals = [meal('a', { recipeIds: ['a-r', 'a-simple'], adaptations: [{ id: 'simple', recipeId: 'a-simple' }] }), meal('b')]
    const state = { ...base, meals, recipes: [{ id: 'a-r', mealId: 'a', prepMinutes: 10 }, { id: 'a-simple', mealId: 'a', prepMinutes: 10 }], plans: [{ id: 'plan', slots: [{ id: 'target', date: '2026-08-17', mealId: 'a', recipeId: 'a-r', leftoverLotIds: ['lot'] }, { id: 'source', date: '2026-08-18', mealId: 'b' }, { id: 'dependent', date: '2026-08-19', mealId: 'b', leftoverFromSlotId: 'source' }] }], leftoverLots: [{ id: 'lot', sourceMealId: 'a' }] }

    expect(replanRemainingWeek(state, { kind: 'repair', planId: 'plan', targetDate: '2026-08-17', action: { kind: 'simpler', recipeId: 'a-simple', adaptationId: 'simple' } })).toMatchObject({ kind: 'invalid-target' })
    expect(replanRemainingWeek(state, { kind: 'repair', planId: 'plan', targetDate: '2026-08-17', action: { kind: 'swap', otherDate: '2026-08-18' } })).toMatchObject({ kind: 'invalid-target' })
  })

  it('rejects confirmed leftovers whose source meal is inactive or unsafe', () => {
    const state = { ...base, meals: [meal('target'), meal('inactive', { active: false }), meal('unsafe', { safetyReview: 'rejected' })], plans: [{ id: 'plan', slots: [{ id: 'target', date: '2026-08-17', mealId: 'target' }] }], leftoverLots: [{ id: 'inactive-lot', sourceMealId: 'inactive' }, { id: 'unsafe-lot', sourceMealId: 'unsafe' }] }

    expect(replanRemainingWeek(state, { kind: 'repair', planId: 'plan', targetDate: '2026-08-17', action: { kind: 'leftovers', leftoverLotId: 'inactive-lot' } })).toMatchObject({ kind: 'invalid-target' })
    expect(replanRemainingWeek(state, { kind: 'repair', planId: 'plan', targetDate: '2026-08-17', action: { kind: 'leftovers', leftoverLotId: 'unsafe-lot' } })).toMatchObject({ kind: 'invalid-target' })
  })
  it('returns actionable guidance instead of a confirmable partial plan for one familiar meal', () => {
    expect(buildWeeklyPlan({ ...base, meals: [meal('meal')] }, '2026-08-17')).toMatchObject({ kind: 'guidance', nextStep: expect.stringContaining('active compatible meal') })
  })

  it('makes familiar zero-outcome meals immediately plannable', () => {
    const preview = plan(buildWeeklyPlan({ ...base, meals: [meal('b'), meal('a')] }, '2026-08-17'))

    expect(preview.slots).toHaveLength(7)
    expect(preview.slots.map((slot) => slot.mealId)).toEqual(['a', 'b', 'a', 'b', 'a', 'b', 'a'])
    expect(PLAN_WEIGHTS.acceptanceHistory).toBe(32)
  })

  it('offers an unfamiliar meal with an active compatible zero-outcome familiar fallback', () => {
    const state = { ...base, meals: [meal('b'), meal('a'), meal('new-a', { provisional: true }), meal('new-z', { provisional: true })] }
    const preview = plan(buildWeeklyPlan(state, '2026-08-17'))

    expect(preview.optional).toEqual({ mealId: 'new-a', fallbackMealId: 'a' })
    expect(preview.slots.some((slot) => slot.mealId.startsWith('new-'))).toBe(false)
    expect(plan(buildWeeklyPlan(state, '2026-08-17', 'use')).slots[0].mealId).toBe('new-a')
  })

  it('reports the scored first-slot familiar fallback when an unfamiliar meal cannot fit', () => {
    const state = { ...base, household: { ...base.household, scheduleExceptions: [{ id: 'late', date: '2026-08-17', constrained: true }] }, meals: [meal('a-slow'), meal('z-quick'), meal('new', { provisional: true })], recipes: [
      { id: 'a-recipe', mealId: 'a-slow', prepMinutes: 20, cookMinutes: 30 },
      { id: 'z-recipe', mealId: 'z-quick', prepMinutes: 10, cookMinutes: 10 },
      { id: 'new-recipe', mealId: 'new', prepMinutes: 20, cookMinutes: 30 },
    ], outcomes: [{ id: 'accepted', mealId: 'a-slow', acceptance: 'accepted' as const }] }

    expect(plan(buildWeeklyPlan(state, '2026-08-17')).optional).toEqual({ mealId: 'new', fallbackMealId: 'a-slow' })
    expect(plan(buildWeeklyPlan(state, '2026-08-17', 'use')).optional).toEqual({ mealId: 'new', fallbackMealId: 'a-slow' })
  })

  it('uses a corrected accepted outcome to make a provisional meal familiar without rewriting it', () => {
    const preview = plan(buildWeeklyPlan({ ...base, meals: [meal('a'), meal('b'), meal('new', { provisional: true })], outcomes: [
      { id: 'old', mealId: 'new', acceptance: 'rejected' as const },
      { id: 'fixed', correctionOfOutcomeId: 'old', mealId: 'new', acceptance: 'accepted' as const },
    ] }, '2026-08-17'))

    expect(preview.optional).toBeUndefined()
    expect(preview.slots.some((slot) => slot.mealId === 'new')).toBe(true)
  })

  it('uses corrected outcomes for score reasons and confidence, not familiar eligibility', () => {
    const preview = plan(buildWeeklyPlan({ ...base, meals: [meal('accepted'), meal('unknown')], outcomes: [
      { id: 'old', mealId: 'accepted', acceptance: 'rejected' as const },
      { id: 'fixed', correctionOfOutcomeId: 'old', mealId: 'accepted', acceptance: 'accepted' as const },
    ] }, '2026-08-17'))

    expect(preview.slots[0]).toMatchObject({ mealId: 'accepted', confidence: 'Learning' })
    expect(preview.slots[0].reasons).toContain('Household outcomes contribute 32/32.')
  })

  it('keeps inactive and unknown-safety meals excluded within a valid restricted plan', () => {
    const preview = plan(buildWeeklyPlan({ ...base, household: { ...base.household, hardRestrictions: [{ id: 'restriction' }] }, meals: [
      meal('approved-a'), meal('approved-b'), meal('inactive', { active: false }), meal('unknown', { safetyReview: 'unknown' }),
    ] }, '2026-08-17'))

    expect(preview.slots.every((slot) => slot.mealId.startsWith('approved-'))).toBe(true)
    expect(preview.excluded).toEqual(expect.arrayContaining([expect.objectContaining({ mealId: 'inactive', reason: 'Meal is inactive.' }), expect.objectContaining({ mealId: 'unknown', reason: 'Confirm compatibility before planning.' })]))
  })

  it('keeps fixed weights and selects a quick meal over a slow meal on a constrained night', () => {
    const preview = plan(buildWeeklyPlan({ ...base, household: { ...base.household, scheduleExceptions: [{ id: 'late', date: '2026-08-17', constrained: true }] }, meals: [meal('slow'), meal('quick')], recipes: [
      { id: 'slow-recipe', mealId: 'slow', prepMinutes: 20, cookMinutes: 30 }, { id: 'quick-recipe', mealId: 'quick', prepMinutes: 10, cookMinutes: 10 },
    ] }, '2026-08-17'))

    expect(PLAN_WEIGHTS).toEqual({ acceptanceHistory: 32, effortTimeFit: 18, scheduleContext: 12, sharedAdaptation: 12, variety: 12, leftoverFit: 8, confidence: 6 })
    expect(preview.slots[0]).toMatchObject({ mealId: 'quick', confidence: 'Estimated' })
    expect(preview.slots[0].reasons).toContain('Fits this constrained night (18 effort/time + 12 schedule).')
  })

  it('keeps elapsed explanatory but never uses it for constrained fit', () => {
    const observed = plan(buildWeeklyPlan({ ...base, household: { ...base.household, scheduleExceptions: [{ id: 'late', date: '2026-08-17', constrained: true }] }, meals: [meal('tacos'), meal('quick')], recipes: [{ id: 'quick-recipe', mealId: 'quick', prepMinutes: 10, cookMinutes: 10 }], outcomes: [
      { id: 'old', mealId: 'tacos', acceptance: 'rejected' as const }, { id: 'fixed', correctionOfOutcomeId: 'old', mealId: 'tacos', acceptance: 'accepted' as const, cookingStartedAt: '2026-08-16T17:00:00.000Z', dinnerReadyAt: '2026-08-16T17:25:00.000Z' },
    ] }, '2026-08-17'))
    const constrained = buildWeeklyPlan({ ...base, household: { ...base.household, scheduleExceptions: [{ id: 'late', date: '2026-08-17', constrained: true }] }, meals: [meal('unknown-a'), meal('unknown-b')], recipes: [{ id: 'partial', mealId: 'unknown-a', prepMinutes: 10 }] }, '2026-08-17')
    const ordinary = plan(buildWeeklyPlan({ ...base, meals: [meal('unknown-a'), meal('unknown-b')] }, '2026-08-17'))

    expect(observed.slots[0].mealId).toBe('quick')
    expect(constrained).toMatchObject({ kind: 'plan' })
    expect(ordinary.slots[0]).toMatchObject({ score: 40 })
    expect(ordinary.slots[0].reasons).toContain('Timing is unknown, so effort/time fit has no points.')
  })

  it('keeps contradictory outcomes Learning and includes the leftover-fit reason', () => {
    const preview = plan(buildWeeklyPlan({ ...base, meals: [meal('leftovers', { plannedLeftoverDinner: true }), meal('mixed')], outcomes: [
      { id: 'one', mealId: 'mixed', acceptance: 'accepted' as const }, { id: 'two', mealId: 'mixed', acceptance: 'rejected' as const },
    ] }, '2026-08-17'))

    expect(preview.slots.find((slot) => slot.mealId === 'mixed')).toMatchObject({ confidence: 'Learning' })
    expect(preview.slots.find((slot) => slot.mealId === 'leftovers')?.reasons).toContain('Planned leftovers reserve one later dinner (8 leftover fit).')
  })

  it('uses least-used rotation before score and stable IDs only inside that pool', () => {
    const seven = plan(buildWeeklyPlan({ ...base, meals: ['g', 'f', 'e', 'd', 'c', 'b', 'a'].map((id) => meal(id)) }, '2026-08-17'))
    const six = plan(buildWeeklyPlan({ ...base, meals: ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => meal(id)) }, '2026-08-17'))
    const two = plan(buildWeeklyPlan({ ...base, meals: [meal('strong'), meal('weak')], outcomes: [{ id: 'accepted', mealId: 'strong', acceptance: 'accepted' as const }] }, '2026-08-17'))

    expect(cookingIds(seven)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
    expect(new Set(cookingIds(six)).size).toBe(6)
    expect(cookingIds(six).filter((id) => id === 'a')).toHaveLength(2)
    expect(cookingIds(two)).toEqual(['strong', 'weak', 'strong', 'weak', 'strong', 'weak', 'strong'])
  })

  it('avoids adjacent cooking duplicates while allowing explicit leftover duplicates', () => {
    const preview = plan(buildWeeklyPlan({ ...base, meals: [meal('leftover', { plannedLeftoverDinner: true }), meal('regular')] }, '2026-08-17'))
    expect(preview.slots.some((slot) => slot.leftoverFrom !== undefined)).toBe(true)
    expect(preview.slots.filter((slot) => slot.leftoverFrom !== undefined).every((slot) => slot.mealId === preview.slots[slot.leftoverFrom ?? 0].mealId)).toBe(true)
  })

  it('returns no-eligible only when capacity or eligibility prevents a complete plan', () => {
    const capacity = buildWeeklyPlan({ ...base, household: { ...base.household, scheduleExceptions: [{ id: 'late', date: '2026-08-17', constrained: true }] }, meals: [meal('slow-a'), meal('slow-b')], recipes: [
      { id: 'slow-a-recipe', mealId: 'slow-a', prepMinutes: 20, cookMinutes: 30 },
      { id: 'slow-b-recipe', mealId: 'slow-b', prepMinutes: 20, cookMinutes: 30 },
    ] }, '2026-08-17')
    const inactive = buildWeeklyPlan({ ...base, meals: [meal('inactive-a', { active: false }), meal('inactive-b', { active: false })] }, '2026-08-17')
    const incompatible = buildWeeklyPlan({ ...base, meals: [meal('rejected-a', { safetyReview: 'rejected' }), meal('rejected-b', { safetyReview: 'rejected' })] }, '2026-08-17')

    expect(capacity).toMatchObject({ kind: 'plan' })
    expect(inactive).toMatchObject({ kind: 'no-eligible', excluded: expect.arrayContaining([expect.objectContaining({ reason: 'Meal is inactive.' })]) })
    expect(incompatible).toMatchObject({ kind: 'no-eligible', excluded: expect.arrayContaining([expect.objectContaining({ reason: 'Not compatible with household restrictions.' })]) })
  })

  it('returns guidance for unfamiliar meals without a familiar fallback', () => {
    expect(buildWeeklyPlan({ ...base, meals: [meal('new', { provisional: true })] }, '2026-08-17')).toMatchObject({ kind: 'guidance', nextStep: expect.stringContaining('familiar meal') })
  })

  it('uses timing from either supported meal-recipe association', () => {
    const state = (recipes: Array<{ id: string; mealId?: string; prepMinutes?: number; cookMinutes?: number }>, meals = [meal('a'), meal('b')]) => plan(buildWeeklyPlan({ ...base, household: { ...base.household, scheduleExceptions: [{ id: 'late', date: '2026-08-17', constrained: true }] }, meals, recipes }, '2026-08-17'))

    expect(state([{ id: 'a-r', mealId: 'a', prepMinutes: 10, cookMinutes: 10 }, { id: 'b-r', mealId: 'b', prepMinutes: 10, cookMinutes: 10 }]).slots[0].recipeId).toBe('a-r')
    expect(state([{ id: 'a-r', prepMinutes: 10, cookMinutes: 10 }, { id: 'b-r', prepMinutes: 10, cookMinutes: 10 }], [meal('a', { recipeIds: ['a-r'] }), meal('b', { recipeIds: ['b-r'] })]).slots[0].recipeId).toBe('a-r')
  })

  it('keeps recipe association order instead of sorting opaque IDs', () => {
    const preview = plan(buildWeeklyPlan({ ...base, meals: [meal('a', { recipeIds: ['z-first', 'a-second'] }), meal('b')], recipes: [{ id: 'a-second', prepMinutes: 10 }, { id: 'z-first', prepMinutes: 20 }] }, '2026-08-17'))
    expect(preview.slots[0].recipeId).toBe('z-first')
  })

  it('uses effort evidence for the selected recipe version only', () => {
    const state = { ...base, household: { ...base.household, scheduleExceptions: [{ date: '2026-08-17', constrained: true }] }, meals: [meal('a', { recipeIds: ['a-fast', 'a-slow'] }), meal('b')], recipes: [{ id: 'a-fast', prepMinutes: 10 }, { id: 'a-slow', prepMinutes: 40 }, { id: 'b-r', mealId: 'b', prepMinutes: 20 }], outcomes: [{ mealId: 'a', recipeId: 'a-slow', activeEffortMinutes: 60 }] }
    expect(plan(buildWeeklyPlan(state, '2026-08-17')).slots[0]).toMatchObject({ mealId: 'a', recipeId: 'a-fast' })
  })

  it('uses active effort, not cook or elapsed time, for constrained fit', () => {
    const constrained = { ...base, household: { ...base.household, scheduleExceptions: [{ date: '2026-08-17', constrained: true }] }, meals: [meal('crockpot'), meal('quick')], recipes: [{ id: 'crockpot-r', mealId: 'crockpot', prepMinutes: 30, cookMinutes: 600 }, { id: 'quick-r', mealId: 'quick', prepMinutes: 10 }] }
    expect(plan(buildWeeklyPlan(constrained, '2026-08-17')).slots[0].mealId).toBe('crockpot')
    expect(plan(buildWeeklyPlan({ ...constrained, outcomes: [{ id: 'old', mealId: 'crockpot', recipeId: 'crockpot-r', activeEffortMinutes: 20 }, { id: 'fix', correctionOfOutcomeId: 'old', mealId: 'crockpot', recipeId: 'crockpot-r', activeEffortMinutes: 31 }] }, '2026-08-17')).slots[0].mealId).toBe('quick')
    expect(buildWeeklyPlan({ ...constrained, meals: [meal('crockpot'), meal('other')], recipes: [], outcomes: [{ id: 'elapsed', mealId: 'crockpot', cookingStartedAt: '2026-08-16T17:00:00.000Z', dinnerReadyAt: '2026-08-16T17:10:00.000Z' }] }, '2026-08-17')).toMatchObject({ kind: 'no-eligible' })
    expect(buildWeeklyPlan({ ...constrained, meals: [meal('unknown'), meal('other')], recipes: [{ id: 'unknown-r', mealId: 'unknown', cookMinutes: 1 }] }, '2026-08-17')).toMatchObject({ kind: 'no-eligible' })
    expect(buildWeeklyPlan({ ...constrained, meals: [meal('fractional'), meal('other')], outcomes: [{ mealId: 'fractional', activeEffortMinutes: 30 }, { mealId: 'fractional', activeEffortMinutes: 31 }] }, '2026-08-17')).toMatchObject({ kind: 'no-eligible' })
  })

  it('reserves one later leftover slot per selected source', () => {
    const preview = plan(buildWeeklyPlan({ ...base, household: { ...base.household, scheduleExceptions: [{ date: '2026-08-17', constrained: true }, { date: '2026-08-19', constrained: true }] }, meals: [meal('crockpot', { plannedLeftoverDinner: true }), meal('regular')], recipes: [{ id: 'crockpot-r', mealId: 'crockpot', prepMinutes: 30, cookMinutes: 600 }] }, '2026-08-17'))
    expect(preview.slots.slice(0, 3)).toMatchObject([{ date: '2026-08-17', mealId: 'crockpot' }, { date: '2026-08-18', mealId: 'regular' }, { date: '2026-08-19', mealId: 'crockpot', leftoverFrom: 0 }])
    expect(preview.slots[2].leftoverFrom).toBe(0)
  })

  it('gives every selected leftover source one distinct later target', () => {
    const preview = plan(buildWeeklyPlan({ ...base, meals: [meal('a', { plannedLeftoverDinner: true }), meal('b', { plannedLeftoverDinner: true }), meal('c'), meal('d')] }, '2026-08-17'))
    const sources = preview.slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => slot.leftoverFrom === undefined && (slot.mealId === 'a' || slot.mealId === 'b'))
    const targets = preview.slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => slot.leftoverFrom !== undefined)

    expect(targets).toHaveLength(sources.length)
    expect(new Set(targets.map(({ index }) => index)).size).toBe(targets.length)
    sources.forEach(({ index }) => expect(targets.filter(({ slot }) => slot.leftoverFrom === index)).toHaveLength(1))
    targets.forEach(({ slot, index }) => expect(slot.leftoverFrom).toBeLessThan(index))
  })

  it('does not select a leftover source on the final day without a later target', () => {
    const preview = plan(buildWeeklyPlan({ ...base, meals: [meal('leftovers', { plannedLeftoverDinner: true }), meal('regular')] }, '2026-08-17'))

    expect(preview.slots.filter((slot) => slot.leftoverFrom === undefined).at(-1)?.mealId).toBe('regular')
  })
})
