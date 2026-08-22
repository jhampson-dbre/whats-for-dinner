import { mealEligibility } from './mealEligibility'
import { mealLearning } from './learning'
import { correctedOutcomes, observedElapsedMinutes } from './outcomes'
import { recipeUsesUnavailableIngredient } from './grocery'

export const PLAN_WEIGHTS = { acceptanceHistory: 32, effortTimeFit: 18, scheduleContext: 12, sharedAdaptation: 12, variety: 12, leftoverFit: 8, confidence: 6 } as const

type Meal = { id: string; name: string; active: boolean; provisional?: boolean; plannedLeftoverDinner?: boolean; safetyReview?: 'unknown' | 'approved' | 'rejected'; adaptations?: Array<{ id: string; recipeId?: string }>; recipeIds?: string[] }
type Recipe = { id: string; title?: string; mealId?: string; prepMinutes?: number; cookMinutes?: number; ingredients?: string[] }
type Outcome = { id?: string; mealId?: string; recipeId?: string; planSlotId?: string; correctionOfOutcomeId?: string; acceptance?: 'accepted' | 'rejected' | 'neutral' | 'unknown'; cookingStartedAt?: string; dinnerReadyAt?: string; activeEffortMinutes?: number; leftoverServing?: true }
type PlannerState = { household: { hardRestrictions: { id: string }[]; scheduleExceptions: { id?: string; date: string; constrained?: boolean }[] }; meals: Meal[]; recipes: Recipe[]; outcomes: Outcome[] }

type PlanSlot = { date: string; mealId: string; recipeId?: string; leftoverFrom?: number; kind?: 'cook' | 'leftover' | 'takeout'; score: number; confidence: 'Estimated' | 'Learning' | 'Established'; reasons: string[] }
type OptionalAction = 'fallback' | 'use' | 'adapt' | 'reject'
type Excluded = { mealId: string; reason: string }
export type WeeklyPlan = { kind: 'plan'; slots: PlanSlot[]; excluded: Excluded[]; optional?: { mealId: string; fallbackMealId: string } }
  | { kind: 'guidance'; excluded: Excluded[]; nextStep: string }
  | { kind: 'no-eligible'; excluded: Excluded[]; nextStep: string }

function dateAfter(start: string, days: number): string {
  const date = new Date(`${start}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function recipeFor(meal: Meal, recipes: Recipe[]): Recipe | undefined {
  return meal.recipeIds?.map((id) => recipes.find((recipe) => recipe.id === id)).find((recipe): recipe is Recipe => recipe !== undefined) ?? recipes.find((recipe) => recipe.mealId === meal.id)
}

export function normalizedLeftoverServing(state: { plans?: Array<{ slots: Array<{ id: string; leftoverFromSlotId?: string; leftoverLotIds?: string[] }> }> }, outcome: Outcome): boolean {
  return outcome.leftoverServing === true || Boolean(outcome.planSlotId && state.plans?.some((plan) => plan.slots.some((slot) => slot.id === outcome.planSlotId && (slot.leftoverFromSlotId || slot.leftoverLotIds?.length))))
}

function selectedRecipeEffort(state: PlannerState, meal: Meal, recipe: Recipe | undefined): number | undefined {
  const corrected = correctedOutcomes(state.outcomes).filter((outcome) => outcome.mealId === meal.id && !normalizedLeftoverServing(state as { plans?: Array<{ slots: Array<{ id: string; leftoverFromSlotId?: string; leftoverLotIds?: string[] }> }> }, outcome) && (recipe ? outcome.recipeId === recipe.id : outcome.recipeId === undefined)).flatMap((outcome) => outcome.activeEffortMinutes === undefined ? [] : [outcome.activeEffortMinutes])
  return corrected.length ? corrected.reduce((total, value) => total + value, 0) / corrected.length : recipe?.prepMinutes
}

export type InitialRequest = { kind: 'initial'; startDate: string; optionalAction?: OptionalAction; takeoutDates?: string[] }
export type ReplanState = PlannerState & { plans: Array<{ id: string; slots: Array<{ id: string; date: string; mealId?: string; recipeId?: string; cookingStartedAt?: string; dinnerReadyAt?: string; leftoverFromSlotId?: string; leftoverLotIds?: string[] }>; shopping?: { items: Array<{ id?: string; perishable: boolean; availability: string; mealIds: string[]; sourceLines: string[]; sourceSlotIds?: string[] }> } }>; leftoverLots: Array<{ id: string; active?: boolean; sourceMealId?: string }> }
export type RepairAction = { kind: 'replan' } | { kind: 'simpler'; recipeId: string; adaptationId: string } | { kind: 'swap'; otherDate: string } | { kind: 'leftovers'; leftoverLotId: string } | { kind: 'recovery'; mealId: string } | { kind: 'takeout'; takeoutContext: 'planned' | 'unforeseeable-disruption' | 'predictable-planning-or-acceptance-failure' }
export type RepairRequest = { kind: 'repair'; planId: string; targetDate: string; action: RepairAction }
export type RepairCorePreview = { kind: 'repair'; plan: ReplanState['plans'][number]; leftoverLots: ReplanState['leftoverLots']; changedSlotIds: string[]; revisionDrafts: Array<{ slotId: string; kind: RepairAction['kind'] }>; releasedLotIds: string[]; consumedLotIds: string[]; perishableRisks: Array<{ itemId?: string; sourceSlotId?: string; sourceLine: string }> }
type RepairFailure = Extract<WeeklyPlan, { kind: 'guidance' | 'no-eligible' }> | { kind: 'invalid-target'; nextStep: string }

function initialPlan(state: PlannerState, startDate: string, optionalAction: OptionalAction = 'fallback', takeoutDates: string[] = []): WeeklyPlan {
  const outcomes = correctedOutcomes(state.outcomes)
  const excluded: Excluded[] = state.meals.flatMap((meal) => {
    if (!meal.active) return [{ mealId: meal.id, reason: 'Meal is inactive.' }]
    const eligibility = mealEligibility({ hardRestrictions: state.household.hardRestrictions, safetyReview: meal.safetyReview })
    return eligibility.eligible ? [] : [{ mealId: meal.id, reason: eligibility.reason }]
  })
  const eligible = state.meals.filter((meal) => !excluded.some((item) => item.mealId === meal.id))
  const unfamiliar = eligible.filter((meal) => meal.provisional && !outcomes.some((outcome) => outcome.mealId === meal.id && outcome.acceptance === 'accepted'))
  const familiar = eligible.filter((meal) => !unfamiliar.includes(meal))
  if (!familiar.length) return eligible.length ? { kind: 'guidance', excluded, nextStep: 'Add an active compatible familiar meal before planning unfamiliar meals.' } : { kind: 'no-eligible', excluded, nextStep: 'Activate or confirm a compatible meal, then try again.' }
  if (familiar.length === 1) return { kind: 'guidance', excluded, nextStep: 'Add another active compatible meal for a useful first plan.' }

  const optionalMeal = unfamiliar.sort((a, b) => a.id.localeCompare(b.id))[0]
  const optionalSelection = optionalMeal && (optionalAction === 'use' || optionalAction === 'adapt' && optionalMeal.adaptations?.length)
  const candidates = [...familiar, ...(optionalSelection ? [optionalMeal] : [])]
  const counts = new Map(candidates.map((meal) => [meal.id, 0]))
  const slots: PlanSlot[] = []
  const reservations = new Map<number, number>()
  let fallbackMealId: string | undefined

  for (let day = 0; day < 7;) {
    const date = dateAfter(startDate, day)
    if (takeoutDates.includes(date)) {
      slots.push({ date, mealId: '', kind: 'takeout', score: 0, confidence: 'Estimated', reasons: ['Planned takeout.'] })
      day++
      continue
    }
    const constrained = state.household.scheduleExceptions.some((exception) => exception.date === date && exception.constrained)
    const leftoverFrom = reservations.get(day)
    if (leftoverFrom !== undefined) {
      const source = slots[leftoverFrom]
      slots.push({ ...source, date, leftoverFrom, kind: 'leftover', reasons: ['Planned leftovers from an earlier dinner.', ...source.reasons] })
      day++
      continue
    }
    const ranked = candidates.filter((meal) => meal !== optionalMeal || day === 0).flatMap((meal) => {
      const recipe = recipeFor(meal, state.recipes)
      const cookingOutcomes = outcomes.filter((outcome) => outcome.mealId === meal.id && !normalizedLeftoverServing(state as { plans?: Array<{ slots: Array<{ id: string; leftoverFromSlotId?: string; leftoverLotIds?: string[] }> }> }, outcome) && (!recipe || outcome.recipeId === recipe.id))
      const effort = selectedRecipeEffort(state, meal, recipe)
      const observed = cookingOutcomes.map(observedElapsedMinutes).filter((minutes): minutes is number => minutes !== undefined)
      if (constrained && (effort === undefined || effort > 30)) {
        const reason = effort === undefined ? `Timing is unknown on constrained night ${date}.` : `Does not fit constrained night on ${date}.`
        if (!excluded.some((item) => item.mealId === meal.id && item.reason === reason)) excluded.push({ mealId: meal.id, reason })
        return []
      }
      const used = counts.get(meal.id) ?? 0
      const learning = mealLearning(state.outcomes, meal.id, (state as { plans?: Array<{ slots: Array<{ id: string; leftoverFromSlotId?: string; leftoverLotIds?: string[] }> }> }).plans?.flatMap((plan) => plan.slots) ?? [])
      const accepted = outcomes.filter((outcome) => outcome.mealId === meal.id && outcome.acceptance === 'accepted').length
      const rejected = outcomes.filter((outcome) => outcome.mealId === meal.id && outcome.acceptance === 'rejected').length
      const historyScore = accepted || rejected ? Math.round(PLAN_WEIGHTS.acceptanceHistory * accepted / (accepted + rejected)) : PLAN_WEIGHTS.acceptanceHistory / 2
      const confidenceScore = learning.confidence === 'Established' ? PLAN_WEIGHTS.confidence : learning.confidence === 'Learning' ? PLAN_WEIGHTS.confidence / 2 : 0
      const leftoverDay = meal.plannedLeftoverDinner ? [...Array(6 - day)].map((_, offset) => day + offset + 1).find((candidateDay) => !takeoutDates.includes(dateAfter(startDate, candidateDay)) && !reservations.has(candidateDay) && state.household.scheduleExceptions.some((exception) => exception.date === dateAfter(startDate, candidateDay) && exception.constrained)) ?? [...Array(6 - day)].map((_, offset) => day + offset + 1).find((candidateDay) => !takeoutDates.includes(dateAfter(startDate, candidateDay)) && !reservations.has(candidateDay)) : undefined
      if (meal.plannedLeftoverDinner && leftoverDay === undefined) return []
      const plannedLeftovers = leftoverDay !== undefined
      const score = historyScore + (effort !== undefined ? PLAN_WEIGHTS.effortTimeFit : 0) + PLAN_WEIGHTS.scheduleContext + (meal.adaptations?.length ? PLAN_WEIGHTS.sharedAdaptation : 0) + (used ? 0 : PLAN_WEIGHTS.variety) + (plannedLeftovers ? PLAN_WEIGHTS.leftoverFit : 0) + confidenceScore
      return [{ meal, recipe, score, band: learning.confidence, used, leftoverDay, reasons: [
        accepted || rejected ? `Household outcomes contribute ${historyScore}/${PLAN_WEIGHTS.acceptanceHistory}.` : `No household outcome yet (${historyScore}/${PLAN_WEIGHTS.acceptanceHistory} starting point).`,
        constrained ? 'Fits this constrained night (18 effort/time + 12 schedule).' : 'Fits the household schedule.',
        ...(effort !== undefined ? observed.length ? [`Observed elapsed time is ${Math.round(observed.reduce((total, value) => total + value, 0) / observed.length)} minutes.`] : [] : ['Timing is unknown, so effort/time fit has no points.']),
        meal.adaptations?.length ? 'A saved shared-meal adaptation is available (12 adaptation).' : 'No saved shared-meal adaptation is needed.',
        used ? 'Used again after other options.' : 'Keeps this week varied (12 variety).',
        ...(plannedLeftovers ? ['Planned leftovers reserve one later dinner (8 leftover fit).'] : []),
        `${learning.confidence}: ${learning.confidence === 'Estimated' ? 'no household outcomes yet.' : learning.confidence === 'Learning' ? 'one or two household outcomes.' : 'three or more household outcomes.'}`,
      ] }]
    })
    if (!ranked.length) return { kind: 'no-eligible', excluded, nextStep: 'Add or confirm a meal that fits every constrained night.' }
    const leastUsed = Math.min(...ranked.map((item) => item.used))
    let pool = ranked.filter((item) => item.used === leastUsed)
    const lastCooking = [...slots].reverse().find((slot) => slot.leftoverFrom === undefined)?.mealId
    if (pool.some((item) => item.meal.id !== lastCooking)) pool = pool.filter((item) => item.meal.id !== lastCooking)
    const byScore = (items: typeof pool) => [...items].sort((a, b) => b.score - a.score || a.meal.id.localeCompare(b.meal.id))[0]
    if (day === 0 && optionalMeal) fallbackMealId = byScore(pool.filter((item) => item.meal !== optionalMeal))?.meal.id
    const selected = (optionalSelection && day === 0 ? pool.find((item) => item.meal === optionalMeal) : undefined) ?? byScore(pool)
    slots.push({ date, mealId: selected.meal.id, kind: 'cook', ...(selected.recipe && { recipeId: selected.recipe.id }), score: selected.score, confidence: selected.band, reasons: selected.reasons })
    counts.set(selected.meal.id, selected.used + 1)
    if (selected.leftoverDay !== undefined) reservations.set(selected.leftoverDay, slots.length - 1)
    day++
  }
  return { kind: 'plan', slots, excluded, ...(optionalMeal && fallbackMealId && { optional: { mealId: optionalMeal.id, fallbackMealId } }) }
}

export function replanRemainingWeek(state: PlannerState, request: InitialRequest): WeeklyPlan
export function replanRemainingWeek(state: ReplanState, request: RepairRequest): RepairCorePreview | RepairFailure
export function replanRemainingWeek(state: PlannerState | ReplanState, request: InitialRequest | RepairRequest): WeeklyPlan | RepairCorePreview | RepairFailure {
  if (request.kind === 'initial') return initialPlan(state, request.startDate, request.optionalAction, request.takeoutDates)
  const repairState = state as ReplanState
  const plan = repairState.plans.find((item) => item.id === request.planId)
  const target = plan?.slots.find((item) => item.date === request.targetDate)
  if (!plan || !target || target.dinnerReadyAt) return { kind: 'invalid-target', nextStep: 'Choose an unfinished slot in the selected plan.' }
  if (request.action.kind === 'takeout' && plan.slots.some((slot) => slot.leftoverFromSlotId === target.id && slot.dinnerReadyAt)) return { kind: 'invalid-target', nextStep: 'A completed leftover dinner cannot be changed.' }
  if (plan.slots.some((slot) => plan.slots.filter((other) => other.leftoverFromSlotId === slot.id).length > 1) || repairState.plans.some((candidate) => candidate.slots.some((slot) => (slot.leftoverLotIds?.length ?? 0) > 1) || repairState.leftoverLots.some((lot) => repairState.plans.flatMap((candidate) => candidate.slots).filter((slot) => slot.leftoverLotIds?.includes(lot.id)).length > 1))) return { kind: 'invalid-target', nextStep: 'Repair malformed leftover links before replanning.' }
  const slots = plan.slots.map((slot) => ({ ...slot }))
  const changed = new Set<string>()
  const replace = (next: Partial<typeof target>) => { Object.assign(slots.find((slot) => slot.id === target.id)!, next); changed.add(target.id) }
  const validRecipe = (meal: Meal | undefined, recipe: Recipe | undefined, date: string) => Boolean(meal?.active && (!recipe ? !meal.recipeIds?.length && !state.recipes.some((item) => item.mealId === meal.id) : (recipe.mealId === meal.id || meal.recipeIds?.includes(recipe.id)) && !recipeUsesUnavailableIngredient(recipe, plan.shopping?.items ?? [])) && mealEligibility({ hardRestrictions: state.household.hardRestrictions, safetyReview: meal.safetyReview }).eligible && (!state.household.scheduleExceptions.some((exception) => exception.date === date && exception.constrained) || ((selectedRecipeEffort(state, meal, recipe) ?? Infinity) <= 30)))
  const releasedLotIds = target.leftoverLotIds ?? []
  let consumedLotIds: string[] = []
  if (request.action.kind === 'simpler') {
    const meal = state.meals.find((item) => item.id === target.mealId)
    const action = request.action as Extract<RepairAction, { kind: 'simpler' }>
    const recipe = state.recipes.find((item) => item.id === action.recipeId)
    if (target.leftoverFromSlotId || target.leftoverLotIds?.length || !action.adaptationId || action.recipeId === target.recipeId || !meal?.adaptations?.some((item) => item.id === action.adaptationId && item.recipeId === action.recipeId) || !validRecipe(meal, recipe, target.date)) return { kind: 'invalid-target', nextStep: 'Choose a saved compatible simpler recipe.' }
    replace({ recipeId: action.recipeId })
  } else if (request.action.kind === 'recovery') {
    const meal = state.meals.find((item) => item.id === (request.action as Extract<RepairAction, { kind: 'recovery' }>).mealId)
    const recipe = meal && recipeFor(meal, state.recipes)
    if (!validRecipe(meal, recipe, target.date)) return { kind: 'invalid-target', nextStep: 'Choose an eligible recovery meal.' }
    replace({ mealId: meal!.id, recipeId: recipe?.id, leftoverFromSlotId: undefined, leftoverLotIds: undefined })
  }
  else if (request.action.kind === 'takeout') {
    replace({ mealId: undefined, recipeId: undefined, leftoverFromSlotId: undefined, leftoverLotIds: undefined })
    const targetSlot = slots.find((slot) => slot.id === target.id)!
    delete targetSlot.cookingStartedAt
  }
  else if (request.action.kind === 'leftovers') {
    const lot = repairState.leftoverLots.find((item) => item.id === (request.action as Extract<RepairAction, { kind: 'leftovers' }>).leftoverLotId && item.active !== false)
    if (!lot || repairState.plans.some((candidate) => candidate.slots.some((slot) => slot.id !== target.id && slot.leftoverLotIds?.includes(lot.id)))) return { kind: 'invalid-target', nextStep: 'Choose an available leftover lot.' }
    const sourceMeal = repairState.meals.find((meal) => meal.id === lot.sourceMealId)
    if (!sourceMeal?.active || !mealEligibility({ hardRestrictions: repairState.household.hardRestrictions, safetyReview: sourceMeal.safetyReview }).eligible) return { kind: 'invalid-target', nextStep: 'Choose an eligible leftover source.' }
    consumedLotIds = [lot.id]
    replace({ mealId: sourceMeal.id, recipeId: undefined, leftoverFromSlotId: undefined, leftoverLotIds: [lot.id] })
  } else if (request.action.kind === 'swap') {
    const other = slots.find((item) => item.date === (request.action as Extract<RepairAction, { kind: 'swap' }>).otherDate)
    if (!other || other.dinnerReadyAt || target.leftoverFromSlotId || other.leftoverFromSlotId || plan.slots.some((slot) => slot.leftoverFromSlotId === other.id && !slot.dinnerReadyAt)) return { kind: 'invalid-target', nextStep: 'Choose another unfinished unlinked slot.' }
    const original = { mealId: target.mealId, recipeId: target.recipeId }
    replace({ mealId: other.mealId, recipeId: other.recipeId }); Object.assign(other, original); changed.add(other.id)
  } else if (request.action.kind === 'replan') replace({ recipeId: recipeFor(state.meals.find((meal) => meal.id === target.mealId)!, state.recipes)?.id })
  const dependents = plan.slots.filter((slot) => slot.leftoverFromSlotId === target.id && !slot.dinnerReadyAt)
  const closure = request.action.kind === 'replan' ? [target, ...dependents] : dependents
  const candidateFor = (date: string) => state.meals.find((meal) => {
    if (!meal.active || !mealEligibility({ hardRestrictions: state.household.hardRestrictions, safetyReview: meal.safetyReview }).eligible) return false
    const recipe = recipeFor(meal, state.recipes)
    if (recipeUsesUnavailableIngredient(recipe, plan.shopping?.items ?? [])) return false
    const constrained = state.household.scheduleExceptions.some((exception) => exception.date === date && exception.constrained)
    return !constrained || ((selectedRecipeEffort(state, meal, recipe) ?? Infinity) <= 30)
  })
  for (const slot of closure) {
    const candidate = candidateFor(slot.date)
    if (!candidate) return { kind: 'no-eligible', excluded: [], nextStep: 'No eligible replacement fits this repair.' }
    const recipe = recipeFor(candidate, state.recipes)
    const next = slots.find((item) => item.id === slot.id)!
    if (slot.id !== target.id || request.action.kind === 'replan') Object.assign(next, { mealId: candidate.id, recipeId: recipe?.id, leftoverFromSlotId: undefined, leftoverLotIds: undefined })
    changed.add(slot.id)
  }
  const perishableRisks = plan.shopping?.items.flatMap((item) => item.perishable && item.availability === 'available' && target.mealId && item.mealIds.includes(target.mealId) ? item.sourceLines.map((sourceLine, index) => ({ itemId: item.id, sourceSlotId: item.sourceSlotIds?.[index], sourceLine })) : []) ?? []
  const changedSlotIds = slots.filter((slot, index) => JSON.stringify(slot) !== JSON.stringify(plan.slots[index])).map((slot) => slot.id)
  const replannedSlotIds = new Set(closure.map((slot) => slot.id))
  return { kind: 'repair', plan: { ...plan, slots }, leftoverLots: repairState.leftoverLots.map((lot) => consumedLotIds.includes(lot.id) ? { ...lot, active: false } : releasedLotIds.includes(lot.id) ? { ...lot, active: true } : lot), changedSlotIds, revisionDrafts: changedSlotIds.map((slotId) => ({ slotId, kind: slotId !== target.id && replannedSlotIds.has(slotId) ? 'replan' : request.action.kind })), releasedLotIds, consumedLotIds, perishableRisks }
}

export function buildWeeklyPlan(state: PlannerState, startDate: string, optionalAction: OptionalAction = 'fallback', takeoutDates: string[] = []): WeeklyPlan {
  return replanRemainingWeek(state, { kind: 'initial', startDate, optionalAction, takeoutDates })
}
