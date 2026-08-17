import { mealEligibility } from './mealEligibility'

export const PLAN_WEIGHTS = { acceptanceHistory: 32, effortTimeFit: 18, scheduleContext: 12, sharedAdaptation: 12, variety: 12, leftoverFit: 8, confidence: 6 } as const

type Meal = { id: string; name: string; active: boolean; provisional?: boolean; plannedLeftoverDinner?: boolean; safetyReview?: 'unknown' | 'approved' | 'rejected'; adaptations?: unknown[] }
type Recipe = { id: string; title?: string; mealId?: string; prepMinutes?: number; cookMinutes?: number }
type Outcome = { id?: string; mealId?: string; acceptance?: 'accepted' | 'rejected' | 'neutral' | 'unknown' }
type PlannerState = { household: { hardRestrictions: { id: string }[]; scheduleExceptions: { id?: string; date: string; constrained?: boolean }[] }; meals: Meal[]; recipes: Recipe[]; outcomes: Outcome[] }

type PlanSlot = { date: string; mealId: string; recipeId?: string; leftoverFrom?: number; score: number; confidence: 'Estimated' | 'Learning' | 'Established'; reasons: string[] }
type WeeklyPlan = { slots: PlanSlot[]; excluded: { mealId: string; reason: string }[]; optional?: { mealId: string; fallbackMealId: string } }
type OptionalAction = 'fallback' | 'use' | 'adapt' | 'reject'

function dateAfter(start: string, days: number): string {
  const date = new Date(`${start}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function confidence(outcomes: Outcome[], mealId: string): PlanSlot['confidence'] {
  const relevant = outcomes.filter((outcome) => outcome.mealId === mealId && (outcome.acceptance === 'accepted' || outcome.acceptance === 'rejected'))
  const count = relevant.length
  if (relevant.some((outcome) => outcome.acceptance === 'accepted') && relevant.some((outcome) => outcome.acceptance === 'rejected')) return 'Learning'
  return count === 0 ? 'Estimated' : count < 3 ? 'Learning' : 'Established'
}

export function buildWeeklyPlan(state: PlannerState, startDate: string, optionalAction: OptionalAction = 'fallback'): WeeklyPlan {
  const excluded = state.meals.flatMap((meal) => {
    if (!meal.active) return [{ mealId: meal.id, reason: 'Meal is inactive.' }]
    const eligibility = mealEligibility({ hardRestrictions: state.household.hardRestrictions, safetyReview: meal.safetyReview })
    return eligibility.eligible ? [] : [{ mealId: meal.id, reason: eligibility.reason }]
  })
  const eligible = state.meals.filter((meal) => !excluded.some((item) => item.mealId === meal.id))
  const unfamiliar = eligible.filter((meal) => meal.provisional && !state.outcomes.some((outcome) => outcome.mealId === meal.id && outcome.acceptance === 'accepted'))
  const optionalMeal = unfamiliar.sort((a, b) => a.id.localeCompare(b.id))[0]
  const familiar = eligible.filter((meal) => !unfamiliar.includes(meal))
  const fallback = optionalMeal ? familiar.sort((a, b) => a.id.localeCompare(b.id))[0] : undefined
  const optionalSelection = optionalMeal && fallback && (optionalAction === 'use' || optionalAction === 'adapt' && optionalMeal.adaptations?.length)
  const candidates = [...familiar, ...(optionalSelection ? [optionalMeal] : [])]
  const slots: PlanSlot[] = []

  for (let cookingDay = 0; cookingDay < 7;) {
    const date = dateAfter(startDate, cookingDay)
    const constrained = state.household.scheduleExceptions.some((exception) => exception.date === date && exception.constrained)
    const ranked = candidates.filter((meal) => meal !== optionalMeal || cookingDay === 0).map((meal) => {
      const recipe = state.recipes.filter((item) => item.mealId === meal.id).sort((a, b) => a.id.localeCompare(b.id))[0]
      const minutes = (recipe?.prepMinutes ?? 0) + (recipe?.cookMinutes ?? 0)
      const fits = !constrained || minutes <= 30
      if (!fits) {
        if (!excluded.some((item) => item.mealId === meal.id && item.reason === `Does not fit constrained night on ${date}.`)) excluded.push({ mealId: meal.id, reason: `Does not fit constrained night on ${date}.` })
        return undefined
      }
      const prior = slots.filter((slot) => slot.mealId === meal.id && slot.leftoverFrom === undefined).length
      const band = confidence(state.outcomes, meal.id)
      const accepted = state.outcomes.filter((outcome) => outcome.mealId === meal.id && outcome.acceptance === 'accepted').length
      const rejected = state.outcomes.filter((outcome) => outcome.mealId === meal.id && outcome.acceptance === 'rejected').length
      const historyScore = accepted || rejected ? Math.round(PLAN_WEIGHTS.acceptanceHistory * accepted / (accepted + rejected)) : PLAN_WEIGHTS.acceptanceHistory / 2
      const confidenceScore = band === 'Established' ? PLAN_WEIGHTS.confidence : band === 'Learning' ? PLAN_WEIGHTS.confidence / 2 : 0
      const plannedLeftovers = meal.plannedLeftoverDinner && cookingDay < 6
      const leftoverScore = plannedLeftovers ? PLAN_WEIGHTS.leftoverFit : 0
      const score = historyScore + (fits ? PLAN_WEIGHTS.effortTimeFit + PLAN_WEIGHTS.scheduleContext : 0) + (meal.adaptations?.length ? PLAN_WEIGHTS.sharedAdaptation : 0) + (prior ? 0 : PLAN_WEIGHTS.variety) + leftoverScore + confidenceScore
      const reasons = [
        `${accepted || rejected ? `Household outcomes contribute ${historyScore}/${PLAN_WEIGHTS.acceptanceHistory}.` : `No household outcome yet (${historyScore}/${PLAN_WEIGHTS.acceptanceHistory} starting point).`}`,
        constrained ? (fits ? 'Fits this constrained night (18 effort/time + 12 schedule).' : 'Does not fit this constrained night.') : 'Fits the household schedule.',
        meal.adaptations?.length ? 'A saved shared-meal adaptation is available (12 adaptation).' : 'No saved shared-meal adaptation is needed.',
        prior ? 'Used again after other options.' : 'Keeps this week varied (12 variety).',
        ...(plannedLeftovers ? ['Planned leftovers cover the following night (8 leftover fit).'] : []),
        `${band}: ${band === 'Estimated' ? 'no household outcomes yet.' : band === 'Learning' ? 'one or two household outcomes.' : 'three or more household outcomes.'}`,
      ]
      return { meal, recipe, score, band, reasons }
    }).filter((item): item is NonNullable<typeof item> => item !== undefined).sort((a, b) => cookingDay === 0 && optionalSelection ? Number(b.meal === optionalMeal) - Number(a.meal === optionalMeal) || b.score - a.score : b.score - a.score || a.meal.id.localeCompare(b.meal.id))
    const selected = ranked[0]
    if (!selected) break
    slots.push({ date, mealId: selected.meal.id, ...(selected.recipe && { recipeId: selected.recipe.id }), score: selected.score, confidence: selected.band, reasons: selected.reasons })
    if (selected.meal.plannedLeftoverDinner && cookingDay < 6) {
      slots.push({ date: dateAfter(startDate, cookingDay + 1), mealId: selected.meal.id, ...(selected.recipe && { recipeId: selected.recipe.id }), leftoverFrom: slots.length - 1, score: selected.score, confidence: selected.band, reasons: ['Planned leftovers from the previous dinner.', ...selected.reasons] })
      cookingDay += 2
    } else cookingDay++
  }
  return { slots, excluded, ...(optionalMeal && fallback && { optional: { mealId: optionalMeal.id, fallbackMealId: fallback.id } }) }
}
