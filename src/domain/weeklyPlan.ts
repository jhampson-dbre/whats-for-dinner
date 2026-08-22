import { mealEligibility } from './mealEligibility'
import { mealLearning } from './learning'
import { correctedOutcomes, observedElapsedMinutes } from './outcomes'

export const PLAN_WEIGHTS = { acceptanceHistory: 32, effortTimeFit: 18, scheduleContext: 12, sharedAdaptation: 12, variety: 12, leftoverFit: 8, confidence: 6 } as const

type Meal = { id: string; name: string; active: boolean; provisional?: boolean; plannedLeftoverDinner?: boolean; safetyReview?: 'unknown' | 'approved' | 'rejected'; adaptations?: unknown[]; recipeIds?: string[] }
type Recipe = { id: string; title?: string; mealId?: string; prepMinutes?: number; cookMinutes?: number }
type Outcome = { id?: string; mealId?: string; correctionOfOutcomeId?: string; acceptance?: 'accepted' | 'rejected' | 'neutral' | 'unknown'; cookingStartedAt?: string; dinnerReadyAt?: string; activeEffortMinutes?: number }
type PlannerState = { household: { hardRestrictions: { id: string }[]; scheduleExceptions: { id?: string; date: string; constrained?: boolean }[] }; meals: Meal[]; recipes: Recipe[]; outcomes: Outcome[] }

type PlanSlot = { date: string; mealId: string; recipeId?: string; leftoverFrom?: number; score: number; confidence: 'Estimated' | 'Learning' | 'Established'; reasons: string[] }
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
  return recipes.filter((recipe) => recipe.mealId === meal.id || meal.recipeIds?.includes(recipe.id)).sort((a, b) => a.id.localeCompare(b.id))[0]
}

export function buildWeeklyPlan(state: PlannerState, startDate: string, optionalAction: OptionalAction = 'fallback'): WeeklyPlan {
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
    const constrained = state.household.scheduleExceptions.some((exception) => exception.date === date && exception.constrained)
    const leftoverFrom = reservations.get(day)
    if (leftoverFrom !== undefined) {
      const source = slots[leftoverFrom]
      slots.push({ ...source, date, leftoverFrom, reasons: ['Planned leftovers from an earlier dinner.', ...source.reasons] })
      day++
      continue
    }
    const ranked = candidates.filter((meal) => meal !== optionalMeal || day === 0).flatMap((meal) => {
      const recipe = recipeFor(meal, state.recipes)
      const efforts = outcomes.filter((outcome) => outcome.mealId === meal.id && outcome.activeEffortMinutes !== undefined).map((outcome) => outcome.activeEffortMinutes!)
      const effort = efforts.length ? efforts.reduce((total, value) => total + value, 0) / efforts.length : recipe?.prepMinutes
      const observed = outcomes.filter((outcome) => outcome.mealId === meal.id).map(observedElapsedMinutes).filter((minutes): minutes is number => minutes !== undefined)
      if (constrained && (effort === undefined || effort > 30)) {
        const reason = effort === undefined ? `Timing is unknown on constrained night ${date}.` : `Does not fit constrained night on ${date}.`
        if (!excluded.some((item) => item.mealId === meal.id && item.reason === reason)) excluded.push({ mealId: meal.id, reason })
        return []
      }
      const used = counts.get(meal.id) ?? 0
      const learning = mealLearning(state.outcomes, meal.id)
      const accepted = outcomes.filter((outcome) => outcome.mealId === meal.id && outcome.acceptance === 'accepted').length
      const rejected = outcomes.filter((outcome) => outcome.mealId === meal.id && outcome.acceptance === 'rejected').length
      const historyScore = accepted || rejected ? Math.round(PLAN_WEIGHTS.acceptanceHistory * accepted / (accepted + rejected)) : PLAN_WEIGHTS.acceptanceHistory / 2
      const confidenceScore = learning.confidence === 'Established' ? PLAN_WEIGHTS.confidence : learning.confidence === 'Learning' ? PLAN_WEIGHTS.confidence / 2 : 0
      const leftoverDay = meal.plannedLeftoverDinner ? [...Array(6 - day)].map((_, offset) => day + offset + 1).find((candidateDay) => !reservations.has(candidateDay) && state.household.scheduleExceptions.some((exception) => exception.date === dateAfter(startDate, candidateDay) && exception.constrained)) ?? [...Array(6 - day)].map((_, offset) => day + offset + 1).find((candidateDay) => !reservations.has(candidateDay)) : undefined
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
    slots.push({ date, mealId: selected.meal.id, ...(selected.recipe && { recipeId: selected.recipe.id }), score: selected.score, confidence: selected.band, reasons: selected.reasons })
    counts.set(selected.meal.id, selected.used + 1)
    if (selected.leftoverDay !== undefined) reservations.set(selected.leftoverDay, slots.length - 1)
    day++
  }
  return { kind: 'plan', slots, excluded, ...(optionalMeal && fallbackMealId && { optional: { mealId: optionalMeal.id, fallbackMealId } }) }
}
