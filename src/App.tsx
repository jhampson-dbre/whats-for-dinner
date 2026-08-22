import { useReducer, useState, type ChangeEvent } from 'react'
import {
  createEmptyAppState,
  exportAppState,
  importAppState,
  loadAppState,
  saveAppState,
  type LoadResult,
} from './state/storage'
import { appStateV4Schema, type AppStateV4 } from './state/schema'
import { mealEligibility } from './domain/mealEligibility'
import { buildWeeklyPlan, effectiveCapacity } from './domain/weeklyPlan'
import { buildGroceryList, recipeUsesUnavailableIngredient, unavailableShoppingTargets } from './domain/grocery'
import { adaptSharedMeal, missingLeftoverDependencies, previewRepair, type RepairPreview } from './domain/repair'
import { classifyRecovery, correctedOutcomes, householdAcceptance, type NeutralReason } from './domain/outcomes'
import { readRecipeKeeperZip, type RecipeKeeperCandidate } from './import/recipeKeeper'
import './app.css'

type Action = { type: 'replace'; state: AppStateV4 }
type FeedbackChoice = 'accepted' | 'rejected' | NeutralReason

function reducer(_state: AppStateV4, action: Action): AppStateV4 {
  return action.state
}

function leftoverConsumer(slot: { leftoverFromSlotId?: string; leftoverLotIds?: string[] }): boolean {
  return Boolean(slot.leftoverFromSlotId || slot.leftoverLotIds?.length)
}

function weekDate(start: string, day: number): string {
  const date = new Date(`${start}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + day)
  return date.toISOString().slice(0, 10)
}

function unresolvedFailedLeftovers(state: AppStateV4): Array<{ planId: string; sourceSlotId: string; dependentSlotId: string; mealId?: string }> {
  return correctedOutcomes(state.outcomes).slice().reverse().flatMap((outcome) => {
    if (outcome.leftoverCoverage !== 'none' && outcome.leftoverCoverage !== 'some') return []
    const plan = state.plans.find((candidate) => candidate.id === outcome.planId && candidate.confirmed)
    const source = plan?.slots.find((slot) => slot.id === outcome.planSlotId)
    const dependent = plan?.slots.find((slot) => slot.leftoverFromSlotId === source?.id && !slot.dinnerReadyAt)
    return plan && source && dependent ? [{ planId: plan.id, sourceSlotId: source.id, dependentSlotId: dependent.id, mealId: source.mealId }] : []
  })
}

function withoutUnresolvedLeftoverReservations(state: AppStateV4): AppStateV4 {
  const mealIds = new Set(unresolvedFailedLeftovers(state).flatMap((item) => item.mealId ? [item.mealId] : []))
  return mealIds.size ? { ...state, meals: state.meals.map((meal) => mealIds.has(meal.id) ? { ...meal, plannedLeftoverDinner: undefined } : meal) } : state
}

function shoppingControls(state: AppStateV4, planId: string) {
  const plan = state.plans.find((candidate) => candidate.id === planId && candidate.confirmed)
  const shopping = plan?.shopping
  const groceries = shopping ? buildGroceryList(state, planId).items : []
  const itemId = (item: NonNullable<typeof shopping>['items'][number]) => item.id ?? groceries.find((candidate) => candidate.label === item.label && candidate.sourceLines.join('\n') === item.sourceLines.join('\n') && candidate.mealIds.join('\n') === item.mealIds.join('\n'))?.id
  const itemIds = (matches: (item: NonNullable<typeof shopping>['items'][number]) => boolean) => new Set(shopping?.items.flatMap((item) => { const id = itemId(item); return matches(item) && id ? [id] : [] }) ?? [])
  return { unavailable: itemIds((item) => item.availability === 'unavailable'), skipped: itemIds((item) => item.availability === 'skipped'), perishable: itemIds((item) => item.perishable), skippedIncompleteMeals: new Set(shopping?.skippedIncompleteMealIds) }
}

function sameRestrictions(a: AppStateV4['household']['hardRestrictions'], b: AppStateV4['household']['hardRestrictions']): boolean {
  return a.length === b.length && a.every((restriction, index) => restriction.id === b[index].id && restriction.label === b[index].label && restriction.dinerId === b[index].dinerId)
}

function affectedReviewSlots(before: AppStateV4, next: AppStateV4): Set<string> {
  const affected = new Set<string>()
  const plans = next.plans.filter((plan) => plan.confirmed)
  const add = (planId: string, slotId: string) => affected.add(`${planId}:${slotId}`)
  const unfinished = (predicate: (plan: typeof plans[number], slot: typeof plans[number]['slots'][number]) => boolean) => plans.forEach((plan) => plan.slots.filter((slot) => !slot.dinnerReadyAt && predicate(plan, slot)).forEach((slot) => add(plan.id, slot.id)))
  const changedIds = <T extends { id: string }>(a: T[], b: T[], value: (item: T) => unknown) => new Set([...a, ...b].filter((item) => JSON.stringify(a.find((other) => other.id === item.id) && value(a.find((other) => other.id === item.id)!)) !== JSON.stringify(b.find((other) => other.id === item.id) && value(b.find((other) => other.id === item.id)!))).map((item) => item.id))
  if (JSON.stringify(before.household.hardRestrictions) !== JSON.stringify(next.household.hardRestrictions)) unfinished(() => true)
  const scheduleDates = new Set([...changedIds(before.household.scheduleExceptions, next.household.scheduleExceptions, (item) => item)].flatMap((id) => [before.household.scheduleExceptions.find((item) => item.id === id)?.date, next.household.scheduleExceptions.find((item) => item.id === id)?.date].filter((date): date is string => Boolean(date))))
  if (scheduleDates.size) unfinished((_plan, slot) => scheduleDates.has(slot.date))
  const mealIds = changedIds(before.meals, next.meals, ({ active, safetyReview, recipeIds }) => ({ active, safetyReview, recipeIds }))
  const recipeIds = changedIds(before.recipes, next.recipes, ({ mealId, ingredients, prepMinutes, cookMinutes }) => ({ mealId, ingredients, prepMinutes, cookMinutes }))
  if (mealIds.size || recipeIds.size) unfinished((_plan, slot) => Boolean(slot.mealId && mealIds.has(slot.mealId)) || Boolean(slot.recipeId && recipeIds.has(slot.recipeId)))
  for (const plan of plans) {
    const prior = before.plans.find((item) => item.id === plan.id)
    if (JSON.stringify(prior?.shopping) !== JSON.stringify(plan.shopping)) unfinished((candidate) => candidate.id === plan.id)
  }
  const lotIds = changedIds(before.leftoverLots, next.leftoverLots, (item) => item)
  const sourceSlotIds = new Set([...before.leftoverLots, ...next.leftoverLots].filter((lot) => lotIds.has(lot.id)).flatMap((lot) => lot.sourceSlotId ? [lot.sourceSlotId] : []))
  const outcomeSources = [...changedIds(before.outcomes, next.outcomes, (item) => item)].flatMap((id) => [before.outcomes.find((item) => item.id === id), next.outcomes.find((item) => item.id === id)].flatMap((outcome) => outcome?.planSlotId ? [outcome.planSlotId] : []))
  outcomeSources.forEach((id) => sourceSlotIds.add(id))
  if (lotIds.size || sourceSlotIds.size) unfinished((_plan, slot) => Boolean(slot.leftoverLotIds?.some((id) => lotIds.has(id)) || slot.leftoverDependencyIds?.some((id) => lotIds.has(id)) || (slot.leftoverFromSlotId && sourceSlotIds.has(slot.leftoverFromSlotId))) )
  return affected
}

function currentReviewSlots(state: AppStateV4): Set<string> {
  const affected = new Set<string>()
  for (const plan of state.plans.filter((item) => item.confirmed)) for (const slot of plan.slots) {
    if (slot.dinnerReadyAt || !slot.mealId) continue
    const meal = state.meals.find((item) => item.id === slot.mealId)
    const recipe = state.recipes.find((item) => item.id === slot.recipeId) ?? state.recipes.find((item) => item.mealId === meal?.id) ?? state.recipes.find((item) => meal?.recipeIds?.includes(item.id))
    const associated = recipe ? recipe.mealId === meal?.id || meal?.recipeIds?.includes(recipe.id) : !meal?.recipeIds?.length && !state.recipes.some((item) => item.mealId === meal?.id)
    const selectedRecipe = state.recipes.find((item) => item.id === slot.recipeId)
    const selectedRecipeAssociated = selectedRecipe?.mealId === meal?.id || meal?.recipeIds?.includes(selectedRecipe?.id ?? '')
    const efforts = correctedOutcomes(state.outcomes).filter((item) => item.mealId === meal?.id && item.recipeId === recipe?.id && !(item as { leftoverServing?: true }).leftoverServing && item.activeEffortMinutes !== undefined).map((item) => item.activeEffortMinutes!)
    const effort = efforts.length ? efforts.reduce((total, value) => total + value, 0) / efforts.length : recipe?.prepMinutes
    const capacity = effectiveCapacity(state, slot.date)
    if (!meal?.active || !mealEligibility({ hardRestrictions: state.household.hardRestrictions, safetyReview: meal.safetyReview }).eligible || (!leftoverConsumer(slot) && (!associated || recipeUsesUnavailableIngredient(recipe, plan.shopping?.items ?? []) || (capacity === 'hands-off' ? !(selectedRecipe && selectedRecipeAssociated && selectedRecipe.handsOffSlowCooker) : capacity === 'constrained' && (effort === undefined || effort > 30))))) affected.add(`${plan.id}:${slot.id}`)
  }
  return affected
}

function download(filename: string, contents: string): void {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

function Recovery({ recovery }: { recovery: Extract<LoadResult, { kind: 'recovery' }> }) {
  const [error, setError] = useState('')
  const reset = () => {
    if (window.confirm('Reset this device to a new empty plan?')) {
      if (saveAppState(localStorage, createEmptyAppState()).saved) window.location.reload()
      else setError('Could not reset saved data locally.')
    }
  }

  return (
    <main className="shell">
      <h1>What’s for dinner?</h1>
      <h2>Saved data needs recovery</h2>
      <p>Your saved data was not changed. Download it before resetting if you need a copy.</p>
      <p>{recovery.reason === 'unsupported-version' ? 'This version is not supported.' : 'The saved data is malformed.'}</p>
      <p className="actions">
        <button onClick={() => download('whats-for-dinner-recovery.json', recovery.raw)}>Download saved data</button>
        <button onClick={reset}>Reset saved data</button>
      </p>
      {error && <p role="status">{error}</p>}
    </main>
  )
}

export default function App() {
  const [loaded] = useState(() => loadAppState(localStorage))
  if (loaded.kind === 'recovery') return <Recovery recovery={loaded} />

  return <ReadyApp initialState={loaded.state} initialUnsaved={loaded.unsaved} />
}

function ReadyApp({ initialState, initialUnsaved = false }: { initialState: AppStateV4; initialUnsaved?: boolean }) {
  const initialFailedLeftover = unresolvedFailedLeftovers(initialState)[0]
  const [state, dispatch] = useReducer(reducer, initialState)
  const [initialShoppingControls] = useState(() => shoppingControls(initialState, ''))
  const [saveStatus, setSaveStatus] = useState<'saved' | 'unsaved'>(initialUnsaved ? 'unsaved' : 'saved')
  const [message, setMessage] = useState('')
  const [dinerName, setDinerName] = useState('')
  const [restriction, setRestriction] = useState('')
  const [restrictionDinerId, setRestrictionDinerId] = useState('')
  const [exceptionDate, setExceptionDate] = useState('')
  const [exceptionNote, setExceptionNote] = useState('')
  const [exceptionConstrained, setExceptionConstrained] = useState(false)
  const [exceptionHandsOff, setExceptionHandsOff] = useState(false)
  const [mealName, setMealName] = useState('')
  const [plannedLeftoverDinner, setPlannedLeftoverDinner] = useState(false)
  const [candidates, setCandidates] = useState<RecipeKeeperCandidate[]>([])
  const [skipped, setSkipped] = useState(0)
  const [candidateQuery, setCandidateQuery] = useState('')
  const [selectedCandidate, setSelectedCandidate] = useState('')
  const [destination, setDestination] = useState<'new' | 'existing' | 'recipe'>('new')
  const [existingMealId, setExistingMealId] = useState('')
  const [newToHousehold, setNewToHousehold] = useState(false)
  const [planStartDate, setPlanStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [weeklyPreview, setWeeklyPreview] = useState<ReturnType<typeof buildWeeklyPlan>>()
  const [optionalAction, setOptionalAction] = useState<'fallback' | 'use' | 'adapt' | 'reject'>('fallback')
  const [plannedTakeoutDates, setPlannedTakeoutDates] = useState<string[]>([])
  const [shoppingPlanId, setShoppingPlanId] = useState('')
  const [unavailableItems, setUnavailableItems] = useState<Set<string>>(() => initialShoppingControls.unavailable)
  const [skippedItems, setSkippedItems] = useState<Set<string>>(() => initialShoppingControls.skipped)
  const [perishableItems, setPerishableItems] = useState<Set<string>>(() => initialShoppingControls.perishable)
  const [skippedIncompleteMeals, setSkippedIncompleteMeals] = useState<Set<string>>(() => initialShoppingControls.skippedIncompleteMeals)
  const [perishableAcknowledged, setPerishableAcknowledged] = useState(false)
  const [repairOpen, setRepairOpen] = useState(Boolean(initialFailedLeftover))
  const [repairPreview, setRepairPreview] = useState<RepairPreview>()
  const [adaptationMealId, setAdaptationMealId] = useState('')
  const [adaptationDinerId, setAdaptationDinerId] = useState('')
  const [adaptationIssue, setAdaptationIssue] = useState('')
  const [adaptationName, setAdaptationName] = useState('')
  const [recoveryMealId, setRecoveryMealId] = useState('')
  const [recoveryTargetId, setRecoveryTargetId] = useState('')
  const [adaptationChecks, setAdaptationChecks] = useState({ solvesIssue: false, coordinatedCooking: false, noSecondEntree: false, noUnplannedProtein: false, noSeparateTimeline: false, noExtraEffort: false })
  const [takeoutContext, setTakeoutContext] = useState<'planned' | 'unforeseeable-disruption' | 'predictable-planning-or-acceptance-failure'>('planned')
  const [feedbackTarget, setFeedbackTarget] = useState<{ planId: string; slotId: string }>()
  const [feedbackCorrectionId, setFeedbackCorrectionId] = useState<string>()
  const [failedLeftover, setFailedLeftover] = useState<{ sourceSlotId: string; multiplier?: 1.5 | 2; remove?: true } | undefined>(() => initialFailedLeftover && { sourceSlotId: initialFailedLeftover.sourceSlotId })
  const [personFeedback, setPersonFeedback] = useState<Record<string, FeedbackChoice>>({})
  const [leftoverCoverage, setLeftoverCoverage] = useState<'none' | 'some' | 'one' | 'more-than-one'>('none')
  const [activeEffortMinutes, setActiveEffortMinutes] = useState('')
  const [repairPlanId, setRepairPlanId] = useState(() => initialFailedLeftover?.planId ?? '')
  const [repairSlotId, setRepairSlotId] = useState<string | undefined>(() => initialFailedLeftover?.dependentSlotId)
  const [reviewNeeded, setReviewNeeded] = useState<Set<string>>(() => new Set())
  const currentReviewSlotIds = currentReviewSlots(state)

  const commit = (next: AppStateV4, markReview = true) => {
    if (!appStateV4Schema.safeParse(next).success) { setSaveStatus('unsaved'); setMessage('Changes are invalid and were not applied.'); return { saved: false as const, error: new Error('Invalid app state.') } }
    const result = saveAppState(localStorage, next)
    setSaveStatus(result.saved ? 'saved' : 'unsaved')
    setWeeklyPreview(undefined)
    setRepairPreview(undefined)
    if (markReview) { const affected = affectedReviewSlots(state, next); if (affected.size) setReviewNeeded((notices) => new Set([...notices, ...affected])) }
    dispatch({ type: 'replace', state: next })
    return result
  }
  const hydrateShoppingControls = (next: AppStateV4, planId = shoppingPlanId) => {
    const controls = shoppingControls(next, planId)
    setUnavailableItems(controls.unavailable)
    setSkippedItems(controls.skipped)
    setPerishableItems(controls.perishable)
    setSkippedIncompleteMeals(controls.skippedIncompleteMeals)
  }

  const reset = () => {
    if (window.confirm('Reset all current app data?')) commit(createEmptyAppState())
  }

  const update = (change: (current: AppStateV4) => AppStateV4, markReview = true) => commit(change(state), markReview)
  const startCooking = (planId: string, slotId: string) => { if (!currentReviewSlotIds.has(`${planId}:${slotId}`) && !reviewNeeded.has(`${planId}:${slotId}`)) update((current) => ({ ...current, plans: current.plans.map((plan) => plan.id !== planId ? plan : { ...plan, slots: plan.slots.map((slot) => slot.id !== slotId || slot.cookingStartedAt ? slot : { ...slot, cookingStartedAt: new Date().toISOString() }) }) })) }
  const dinnerReady = (planId: string, slotId: string) => {
    if (currentReviewSlotIds.has(`${planId}:${slotId}`) || reviewNeeded.has(`${planId}:${slotId}`)) return
    const plan = state.plans.find((item) => item.id === planId)
    const slot = plan?.slots.find((item) => item.id === slotId)
    if (slot?.leftoverFromSlotId && !plan?.slots.find((item) => item.id === slot.leftoverFromSlotId)?.dinnerReadyAt) { setMessage('Mark the source dinner ready before serving leftovers.'); return }
    const now = new Date()
    update((current) => ({ ...current, plans: current.plans.map((plan) => plan.id !== planId ? plan : { ...plan, slots: plan.slots.map((slot) => slot.id !== slotId || slot.dinnerReadyAt ? slot : { ...slot, dinnerReadyAt: now.toISOString(), feedbackEligibleAt: new Date(now.getTime() + 30 * 60_000).toISOString(), expectedDinerIds: current.household.diners.filter((diner) => diner.active).map((diner) => diner.id) }) }) }))
    setMessage('Dinner recorded. Feedback will be available on a later visit.')
  }
  const addDiner = () => {
    const name = dinerName.trim()
    if (!name || name.length > 160 || state.household.diners.length >= 20) return
    update((current) => ({ ...current, household: { ...current.household, diners: [...current.household.diners, { id: crypto.randomUUID(), name, active: true }] } }))
    setDinerName('')
  }
  const addRestriction = () => {
    const label = restriction.trim()
    if (!label || label.length > 160 || state.household.hardRestrictions.length >= 50) return
    update((current) => ({ ...current, household: { ...current.household, hardRestrictions: [...current.household.hardRestrictions, { id: crypto.randomUUID(), label, ...(restrictionDinerId && { dinerId: restrictionDinerId }) }] }, meals: current.meals.map((meal) => ({ ...meal, safetyReview: 'unknown' })) }))
    setRestriction('')
    setRestrictionDinerId('')
  }
  const addException = () => {
    if (!exceptionDate || (state.household.scheduleExceptions.length >= 100 && !state.household.scheduleExceptions.some((item) => item.date === exceptionDate))) return
    const note = exceptionNote.trim()
    if (note.length > 500) return
    update((current) => {
      const priorNote = [...current.household.scheduleExceptions].reverse().find((item) => item.date === exceptionDate && item.note)?.note
      const capacity = exceptionHandsOff ? { handsOff: true as const } : exceptionConstrained ? { constrained: true } : {}
      const nextNote = note || (Object.keys(capacity).length ? priorNote : undefined)
      return { ...current, household: { ...current.household, scheduleExceptions: [...current.household.scheduleExceptions.filter((item) => item.date !== exceptionDate), ...(nextNote || Object.keys(capacity).length ? [{ id: crypto.randomUUID(), date: exceptionDate, ...(nextNote && { note: nextNote }), ...capacity }] : [])] } }
    })
    setExceptionDate('')
    setExceptionNote('')
    setExceptionConstrained(false)
    setExceptionHandsOff(false)
  }
  const addMeal = () => {
    const name = mealName.trim()
    if (!name || name.length > 160 || state.meals.length >= 500) return
    update((current) => ({ ...current, meals: [...current.meals, { id: crypto.randomUUID(), name, active: true, safetyReview: 'unknown', ...(plannedLeftoverDinner && { plannedLeftoverDinner: true }) }] }))
    setMealName('')
    setPlannedLeftoverDinner(false)
  }
  const previewWeeklyPlan = () => {
    if (!planStartDate) { setWeeklyPreview(undefined); setMessage('Choose a week-start date first.'); return }
    setOptionalAction('fallback')
    setPlannedTakeoutDates([])
    setWeeklyPreview(buildWeeklyPlan(withoutUnresolvedLeftoverReservations(state), planStartDate))
  }
  const chooseOptionalMeal = (action: 'use' | 'adapt' | 'reject') => {
    setOptionalAction(action)
    setWeeklyPreview(buildWeeklyPlan(withoutUnresolvedLeftoverReservations(state), planStartDate, action, plannedTakeoutDates))
  }
  const togglePlannedTakeout = (date: string) => {
    const dates = plannedTakeoutDates.includes(date) ? plannedTakeoutDates.filter((item) => item !== date) : [...plannedTakeoutDates, date]
    setPlannedTakeoutDates(dates)
    setWeeklyPreview(buildWeeklyPlan(withoutUnresolvedLeftoverReservations(state), planStartDate, optionalAction, dates))
  }
  const confirmWeeklyPlan = () => {
    if (!weeklyPreview || weeklyPreview.kind !== 'plan' || state.plans.length >= 100) return
    const verified = buildWeeklyPlan(withoutUnresolvedLeftoverReservations(state), planStartDate, optionalAction, plannedTakeoutDates)
    if (verified.kind !== 'plan') { setWeeklyPreview(verified); return }
    const overlaps = state.plans.filter((plan) => plan.confirmed).flatMap((plan) => plan.slots.filter((slot) => !slot.dinnerReadyAt && verified.slots.some((preview) => preview.date === slot.date)).map((slot) => ({ plan, slot })))
    if (overlaps.length) { setRepairPlanId(''); setRepairSlotId(undefined); setRepairOpen(false); setWeeklyPreview(undefined); setMessage('Choose the overlapping confirmed plan and unfinished date explicitly before confirming a new plan.'); return }
    const planId = crypto.randomUUID()
    const slotIds = verified.slots.map(() => crypto.randomUUID())
    const rejectedMealId = optionalAction === 'reject' ? verified.optional?.mealId : undefined
    const takeoutDates = new Set(plannedTakeoutDates)
    const next: AppStateV4 = { ...state, meals: rejectedMealId ? state.meals.map((meal) => meal.id === rejectedMealId ? { ...meal, active: false } : meal) : state.meals, plans: [...state.plans, {
      id: planId,
      confirmed: true,
      scoreReasons: verified.slots.flatMap((slot) => slot.reasons).filter((reason, index, values) => values.indexOf(reason) === index),
       ...(verified.optional && { variants: [{ id: crypto.randomUUID(), label: 'Familiar fallback for optional unfamiliar meal', mealId: verified.optional.fallbackMealId }] }),
      slots: verified.slots.map((slot, index) => ({ id: slotIds[index], date: slot.date, ...(!takeoutDates.has(slot.date) && { mealId: slot.mealId }), ...(!takeoutDates.has(slot.date) && slot.recipeId && { recipeId: slot.recipeId }), ...(!takeoutDates.has(slot.date) && slot.leftoverFrom !== undefined && { leftoverFromSlotId: slotIds[slot.leftoverFrom] }), score: slot.score, confidence: slot.confidence, scoreReasons: slot.reasons })),
      ...(plannedTakeoutDates.length && { repairRevisions: verified.slots.flatMap((slot, index) => takeoutDates.has(slot.date) ? [{ id: crypto.randomUUID(), createdAt: new Date().toISOString(), slotId: slotIds[index], kind: 'takeout' as const, takeoutContext: 'planned' as const }] : []) }),
    }] }
    if (!appStateV4Schema.safeParse(next).success) { commit(next); return }
    commit(next)
    hydrateShoppingControls(next)
    setWeeklyPreview(undefined)
    setMessage('Weekly plan confirmed.')
  }

  const onImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    void file.text()
      .then((raw) => {
        try {
          const imported = importAppState(raw)
          if (!window.confirm('Replace all current app data with this backup?')) return
          const next: AppStateV4 = sameRestrictions(state.household.hardRestrictions, imported.household.hardRestrictions) ? imported : { ...imported, meals: imported.meals.map((meal) => ({ ...meal, safetyReview: 'unknown' })) }
          const saved = commit(next).saved
          hydrateShoppingControls(next)
          setMessage(saved ? 'Backup imported.' : 'Loaded but not saved locally.')
        } catch {
          setMessage('That file is not a valid backup.')
        }
      })
      .catch(() => {
        setMessage('That file is not a valid backup.')
      })
      .finally(() => {
        event.target.value = ''
      })
  }
  const onRecipeKeeperImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 32 * 1024 * 1024) { setCandidates([]); setSelectedCandidate(''); setNewToHousehold(false); setMessage('The ZIP file exceeds 32 MiB.'); event.target.value = ''; return }
    void file.arrayBuffer().then((buffer) => readRecipeKeeperZip(new Uint8Array(buffer))).then((result) => {
      setCandidates(result.candidates); setSkipped(result.skipped); setSelectedCandidate(result.candidates[0].externalId); setNewToHousehold(false); setMessage(`Found ${result.candidates.length} recipes${result.skipped ? `; skipped ${result.skipped}.` : '.'}`)
    }).catch((error: unknown) => {
      setCandidates([]); setSelectedCandidate(''); setNewToHousehold(false); setMessage(error instanceof Error ? error.message : 'Could not read that Recipe Keeper ZIP.')
    }).finally(() => { event.target.value = '' })
  }
  const saveCandidate = () => {
    const candidate = chosenCandidate
    if (!candidate) return
    if (state.recipes.some((recipe) => recipe.externalId === candidate.externalId)) { setMessage('That Recipe Keeper recipe is already saved.'); return }
    const targetMeal = destination === 'existing' ? state.meals.find((meal) => meal.id === existingMealId) : undefined
    if (destination === 'existing' && !targetMeal) { setMessage('Choose an existing meal first.'); return }
    if (destination === 'new' && candidate.title.length > 160) { setMessage('Save recipe only or choose an existing meal; this title is too long for a new meal.'); return }
    if (state.recipes.length >= 1000) { setMessage('Recipe storage is full; remove a recipe before importing.'); return }
    if (destination === 'new' && state.meals.length >= 500) { setMessage('Meal storage is full; save recipe only or choose an existing meal.'); return }
    if (targetMeal && (targetMeal.recipeIds?.length ?? 0) >= 50) { setMessage('That meal already has the maximum number of recipes.'); return }
    if (!window.confirm(`Save ${candidate.title}?`)) return
    const recipeId = crypto.randomUUID(); const mealId = targetMeal?.id ?? (destination === 'new' ? crypto.randomUUID() : undefined)
    const recipe = { id: recipeId, externalId: candidate.externalId, title: candidate.title, ...(mealId && { mealId }), source: { provider: 'Recipe Keeper', ...(candidate.source && { reference: candidate.source }) }, ...(candidate.category && { category: candidate.category }), ...(candidate.prepMinutes !== undefined && { prepMinutes: candidate.prepMinutes }), ...(candidate.cookMinutes !== undefined && { cookMinutes: candidate.cookMinutes }), ...(candidate.yield && { yield: candidate.yield }), ...(candidate.ingredients && { ingredients: candidate.ingredients }), ...(candidate.instructions && { instructions: candidate.instructions }) }
    update((current) => ({ ...current, recipes: [...current.recipes, recipe], meals: destination === 'new' ? [...current.meals, { id: mealId!, name: candidate.title, active: true, ...(newToHousehold && { provisional: true }), safetyReview: 'unknown', recipeIds: [recipeId] }] : targetMeal ? current.meals.map((meal) => meal.id === targetMeal.id ? { ...meal, recipeIds: [...(meal.recipeIds ?? []), recipeId], safetyReview: 'unknown' } : meal) : current.meals }))
    setMessage(destination === 'recipe' ? 'Recipe saved without a meal.' : 'Recipe saved. Confirm compatibility before planning.')
    const remainingCandidates = candidates.filter((item) => item.externalId !== candidate.externalId)
    setCandidates(remainingCandidates); setSelectedCandidate(remainingCandidates[0]?.externalId ?? ''); setNewToHousehold(false)
  }
  const visibleCandidates = candidates.filter((candidate) => candidate.title.toLowerCase().includes(candidateQuery.trim().toLowerCase()))
  const chosenCandidate = visibleCandidates.find((candidate) => candidate.externalId === selectedCandidate) ?? visibleCandidates[0]
  const shoppingPlan = state.plans.find((plan) => plan.id === shoppingPlanId && plan.confirmed)
  const groceries = shoppingPlan ? buildGroceryList(state, shoppingPlan.id) : undefined
  const shoppingItems = shoppingPlan?.shopping ? shoppingPlan.shopping.items.map((item, index) => ({ ...item, id: item.id ?? groceries?.items.find((candidate) => candidate.label === item.label && candidate.sourceLines.join('\n') === item.sourceLines.join('\n') && candidate.mealIds.join('\n') === item.mealIds.join('\n'))?.id ?? `saved-${index}` })) : groceries?.items
  const repairPlan = state.plans.find((plan) => plan.id === repairPlanId && plan.confirmed)
  const repairTarget = repairPlan?.slots.find((slot) => slot.id === repairSlotId)
  const repairGroceryChanges = repairPreview && repairPlan ? (() => {
    const planIds = repairPreview.plans.map((plan) => plan.id)
    const before = planIds.flatMap((planId) => buildGroceryList(state, planId).items.map((item) => item.label))
    const afterState = { ...state, recipes: failedLeftover?.multiplier ? state.recipes.map((recipe) => recipe.id === repairPlan.slots.find((slot) => slot.id === failedLeftover.sourceSlotId)?.recipeId ? { ...recipe, leftoverQuantityMultiplier: failedLeftover.multiplier } : recipe) : state.recipes, plans: state.plans.map((plan) => repairPreview.plans.find((repaired) => repaired.id === plan.id) ?? plan) }
    const after = planIds.flatMap((planId) => buildGroceryList(afterState, planId).items)
    return { added: after.filter((item) => !before.includes(item.label)).map((item) => `${item.label}${item.manualQuantityAdjustment ? ' (Manual quantity adjustment)' : ''}`), removed: before.filter((item) => !after.some((candidate) => candidate.label === item)), manual: after.filter((item) => item.manualQuantityAdjustment).map((item) => item.label) }
  })() : undefined
  const repairMeal = state.meals.find((meal) => meal.id === repairTarget?.mealId)
  const repairSlotHasLeftoverLink = (slotId: string) => {
    const slot = repairPlan?.slots.find((item) => item.id === slotId)
    return Boolean(slot?.leftoverFromSlotId || slot?.leftoverLotIds?.length || repairPlan?.slots.some((item) => !item.dinnerReadyAt && item.leftoverFromSlotId === slotId))
  }
  const showRepair = (kind: 'simpler' | 'swap' | 'leftovers' | 'recovery' | 'takeout' | 'replan', mealId?: string, recipeId?: string, swapSlotId?: string, leftoverLotId?: string, adaptationId?: string) => {
    if (!repairPlan || !repairTarget) return
    if (failedLeftover && !repairPlan.slots.some((slot) => slot.id === failedLeftover.sourceSlotId)) setFailedLeftover(undefined)
    else if (failedLeftover && kind !== 'replan') return
    setPerishableAcknowledged(false)
    try { setRepairPreview(previewRepair(state, repairPlan, { slotId: repairTarget.id, kind, ...(mealId && { mealId }), ...(recipeId && { recipeId }), ...(swapSlotId && { swapSlotId }), ...(leftoverLotId && { leftoverLotId }), ...(adaptationId && { adaptationId }), ...(kind === 'takeout' && { takeoutContext }) })) }
    catch (error) { setRepairPreview(undefined); setMessage(error instanceof Error ? error.message : 'That repair is no longer valid.') }
  }
  const confirmRepair = () => {
    if (!repairPreview) return
    if (!repairPlan || !repairTarget) return
    let verified: RepairPreview
    try { verified = previewRepair(state, repairPlan, repairPreview.choice) }
    catch { setRepairPreview(undefined); setMessage('Plan changes invalidated this preview. Review the options again.'); return }
    const perishableRisk = verified.perishableRisks.length > 0
    if (perishableRisk && !perishableAcknowledged) { setMessage('Acknowledge the confirmed perishable groceries before replacing this meal.'); return }
    if (!window.confirm('Apply this repair?')) return
    const sourceRecipeId = failedLeftover && repairPlan.slots.find((slot) => slot.id === failedLeftover.sourceSlotId)?.recipeId
    const priorOutcome = correctedOutcomes(state.outcomes).find((outcome) => outcome.planId === repairPlan.id && outcome.planSlotId === repairTarget.id)
    const retroactiveTakeoutOutcome = verified.choice.kind === 'takeout' && repairTarget.dinnerReadyAt && priorOutcome ? { id: crypto.randomUUID(), planId: repairPlan.id, planSlotId: repairTarget.id, correctionOfOutcomeId: priorOutcome.id, recordedAt: new Date().toISOString(), dinnerReadyAt: repairTarget.dinnerReadyAt, acceptance: priorOutcome.acceptance, personFeedback: priorOutcome.personFeedback, recoveryClassification: classifyRecovery({ acceptance: priorOutcome.acceptance, repairKind: 'takeout', takeoutContext: verified.choice.takeoutContext }) } : undefined
    const next: AppStateV4 = { ...state, recipes: failedLeftover?.multiplier ? state.recipes.map((recipe) => recipe.id === sourceRecipeId ? { ...recipe, leftoverQuantityMultiplier: failedLeftover.multiplier } : recipe) as AppStateV4['recipes'] : state.recipes, meals: failedLeftover?.remove ? state.meals.map((meal) => meal.id === repairPlan.slots.find((slot) => slot.id === failedLeftover.sourceSlotId)?.mealId ? { ...meal, plannedLeftoverDinner: undefined } : meal) : state.meals, plans: state.plans.map((plan) => { const repaired = verified.plans.find((item) => item.id === plan.id); const drafts = verified.revisionDrafts.filter((draft) => draft.planId === plan.id); return !repaired ? plan : { ...repaired, repairRevisions: [...(plan.repairRevisions ?? []), ...drafts.map((draft) => ({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), slotId: draft.slotId, kind: draft.kind, ...(perishableRisk && { perishableDisposition: 'acknowledged-preservation-risk' as const }), ...(verified.choice.leftoverLotId && { leftoverLotId: verified.choice.leftoverLotId }), ...(verified.choice.adaptationId && { adaptationId: verified.choice.adaptationId }), ...(draft.kind === 'recovery' && verified.choice.kind !== 'recovery' && { reason: 'replan' }), ...(verified.choice.reason && { reason: verified.choice.reason }), ...(draft.kind === 'takeout' && verified.choice.takeoutContext && { takeoutContext: verified.choice.takeoutContext }) }))] } }), outcomes: retroactiveTakeoutOutcome ? [...state.outcomes, retroactiveTakeoutOutcome] : state.outcomes, leftoverLots: verified.leftoverLots }
    if (!appStateV4Schema.safeParse(next).success) { setMessage('Changes are invalid and were not applied.'); return }
    commit(next, false)
    const nextFailedLeftover = unresolvedFailedLeftovers(next)[0]
    setRepairPreview(undefined); setFailedLeftover(nextFailedLeftover && { sourceSlotId: nextFailedLeftover.sourceSlotId }); setRepairPlanId(nextFailedLeftover?.planId ?? ''); setRepairSlotId(nextFailedLeftover?.dependentSlotId); setRepairOpen(Boolean(nextFailedLeftover)); setReviewNeeded((notices) => { const next = new Set(notices); verified.revisionDrafts.forEach((draft) => next.delete(`${draft.planId}:${draft.slotId}`)); return next }); setMessage(nextFailedLeftover ? 'Another failed leftover dinner needs repair.' : 'Plan repair confirmed.')
  }
  const saveAdaptation = () => {
    const result = adaptSharedMeal({ dinerId: adaptationDinerId, issue: adaptationIssue.trim(), name: adaptationName.trim(), solvesIssue: adaptationChecks.solvesIssue, coordinatedCooking: adaptationChecks.coordinatedCooking, secondEntree: !adaptationChecks.noSecondEntree, unplannedProtein: !adaptationChecks.noUnplannedProtein, separateTimeline: !adaptationChecks.noSeparateTimeline, extraEffort: !adaptationChecks.noExtraEffort })
    if (!result.valid || !adaptationMealId || !adaptationName.trim()) { setMessage(result.reason ?? 'Choose a meal and adaptation name first.'); return }
    update((current) => ({ ...current, meals: current.meals.map((meal) => meal.id !== adaptationMealId ? meal : { ...meal, adaptations: [...(meal.adaptations ?? []), { id: crypto.randomUUID(), name: adaptationName.trim(), dinerId: adaptationDinerId, issue: adaptationIssue.trim(), solvesIssue: true, coordinatedCooking: true, noSecondEntree: true, noUnplannedProtein: true, noSeparateTimeline: true, noExtraEffort: true }] }) }))
    setAdaptationName(''); setAdaptationIssue(''); setMessage('Shared-meal adaptation saved.')
  }
  const linkRecovery = (mealId: string, recoveryMealId: string) => {
    if (mealId === recoveryMealId || (state.meals.find((meal) => meal.id === mealId)?.recoveryMealIds?.length ?? 0) >= 50) return
    update((current) => ({ ...current, meals: current.meals.map((meal) => meal.id !== mealId || meal.recoveryMealIds?.includes(recoveryMealId) ? meal : { ...meal, recoveryMealIds: [...(meal.recoveryMealIds ?? []), recoveryMealId] }) }))
  }
  const feedbackPlan = feedbackTarget && state.plans.find((plan) => plan.id === feedbackTarget.planId)
  const feedbackSlot = feedbackPlan?.slots.find((slot) => slot.id === feedbackTarget?.slotId)
  const feedbackMeal = state.meals.find((meal) => meal.id === feedbackSlot?.mealId)
  const openFeedback = (planId: string, slotId: string, correctionId?: string) => {
    const prior = correctionId ? state.outcomes.find((outcome) => outcome.id === correctionId) : undefined
    setFeedbackTarget({ planId, slotId }); setFeedbackCorrectionId(correctionId)
    setPersonFeedback(Object.fromEntries(prior?.personFeedback?.map((item) => [item.dinerId, item.neutralReason ?? item.acceptance]) ?? []) as Record<string, FeedbackChoice>)
    setLeftoverCoverage(prior?.leftoverCoverage ?? 'none'); setActiveEffortMinutes(prior?.activeEffortMinutes?.toString() ?? '')
  }
  const submitFeedback = () => {
    if (!feedbackPlan || !feedbackSlot) return
    const prior = feedbackCorrectionId ? state.outcomes.find((outcome) => outcome.id === feedbackCorrectionId) as (typeof state.outcomes[number] & { leftoverServing?: true }) | undefined : undefined
    const feedback: { dinerId: string; acceptance: 'accepted' | 'rejected' | 'neutral'; neutralReason?: NeutralReason }[] = (feedbackSlot.expectedDinerIds ?? state.household.diners.filter((diner) => diner.active).map((diner) => diner.id)).map((dinerId) => {
      const diner = state.household.diners.find((item) => item.id === dinerId)
      if (!diner) return { dinerId, acceptance: 'neutral' }
      const value = personFeedback[diner.id]
      return value === 'accepted' || value === 'rejected' ? { dinerId, acceptance: value } : { dinerId, acceptance: 'neutral', neutralReason: value ?? 'absent' }
    })
    const revision = [...(feedbackPlan.repairRevisions ?? [])].reverse().find((item) => item.slotId === feedbackSlot.id)
    const effort = activeEffortMinutes === '' ? undefined : Number(activeEffortMinutes)
    const acceptance = householdAcceptance(feedback.map((item) => item.acceptance))
    const noCookingEvidence = leftoverConsumer(feedbackSlot) || !feedbackSlot.mealId
    const outcome = { id: crypto.randomUUID(), planId: feedbackPlan.id, planSlotId: feedbackSlot.id, ...(feedbackSlot.mealId && { mealId: feedbackSlot.mealId }), ...(feedbackSlot.recipeId && { recipeId: feedbackSlot.recipeId }), ...(feedbackCorrectionId && { correctionOfOutcomeId: feedbackCorrectionId }), ...((leftoverConsumer(feedbackSlot) || prior?.leftoverServing) && { leftoverServing: true as const }), recordedAt: new Date().toISOString(), ...(!noCookingEvidence && feedbackSlot.cookingStartedAt && { cookingStartedAt: feedbackSlot.cookingStartedAt, dinnerReadyAt: feedbackSlot.dinnerReadyAt }), ...(!noCookingEvidence && effort !== undefined && Number.isInteger(effort) && effort >= 0 && effort <= 10_080 && { activeEffortMinutes: effort }), acceptance, personFeedback: feedback, ...(!noCookingEvidence && { leftoverCoverage }), recoveryClassification: classifyRecovery({ acceptance, repairKind: revision?.kind, takeoutContext: revision?.takeoutContext }) }
    const dependentIds = !noCookingEvidence && leftoverCoverage !== 'one' && leftoverCoverage !== 'more-than-one' ? missingLeftoverDependencies(feedbackPlan, feedbackSlot.id) : []
    update((current) => ({ ...current, outcomes: [...current.outcomes, outcome], leftoverLots: [...current.leftoverLots.map((lot) => feedbackCorrectionId && lot.sourcePlanId === feedbackPlan.id && lot.sourceSlotId === feedbackSlot.id ? { ...lot, active: false } : lot), ...(!noCookingEvidence && (leftoverCoverage === 'one' || leftoverCoverage === 'more-than-one') && current.leftoverLots.length < 500 ? [{ id: crypto.randomUUID(), sourcePlanId: feedbackPlan.id, sourceSlotId: feedbackSlot.id, ...(feedbackSlot.mealId && { sourceMealId: feedbackSlot.mealId }), dinnerCoverage: leftoverCoverage, active: true }] : [])], plans: current.plans.map((plan) => plan.id !== feedbackPlan.id ? plan : { ...plan, slots: plan.slots.map((slot) => slot.id === feedbackSlot.id ? { ...slot, feedbackDismissed: true } : slot) }) }))
    setFeedbackTarget(undefined); setFeedbackCorrectionId(undefined); setPersonFeedback({}); setLeftoverCoverage('none'); setActiveEffortMinutes('')
    if (dependentIds[0]) { setRepairPlanId(feedbackPlan.id); setRepairSlotId(dependentIds[0]); setRepairOpen(true); setFailedLeftover({ sourceSlotId: feedbackSlot.id }); setMessage('Expected leftovers are insufficient. Choose and confirm the smallest repair.') } else setMessage('Dinner feedback recorded.')
  }
  const confirmShopping = () => {
    if (!shoppingPlan || shoppingPlan.shopping || !groceries || !window.confirm('Record shopping completion?')) return
    const next: AppStateV4 = { ...state, plans: state.plans.map((plan) => plan.id !== shoppingPlan.id ? plan : { ...plan, shopping: { confirmedAt: new Date().toISOString(), partial: groceries.incompleteMeals.length > 0, skippedIncompleteMealIds: [...skippedIncompleteMeals], items: groceries.items.map((item) => ({ id: item.id, label: item.label, sourceLines: item.sourceLines, sourceSlotIds: item.sourceSlotIds, mealIds: item.mealIds, perishable: perishableItems.has(item.id), availability: unavailableItems.has(item.id) ? 'unavailable' : skippedItems.has(item.id) ? 'skipped' : 'available' })) } }) }
    const confirmed = next.plans.find((plan) => plan.id === shoppingPlan.id)!
    const targets = [...new Set(confirmed.shopping!.items.flatMap((item) => unavailableShoppingTargets(next, confirmed.id, item)))]
    if (!appStateV4Schema.safeParse(next).success) { setMessage('Changes are invalid and were not applied.'); return }
    commit(next, false)
    setReviewNeeded((notices) => new Set([...notices, ...targets.map((slotId) => `${confirmed.id}:${slotId}`)]))
    if (targets.length === 1) { setRepairPlanId(confirmed.id); setRepairSlotId(targets[0]); setRepairOpen(true); setMessage('Unavailable ingredients need a confirmed repair.') }
    else if (targets.length > 1) { setRepairPlanId(confirmed.id); setRepairSlotId(undefined); setRepairOpen(false); setMessage('Unavailable ingredients need review; choose an affected date.') }
    else setMessage('Shopping completion recorded.')
  }

  return (
    <main className="shell">
      <h1>What’s for dinner?</h1>
      <p>Build a small household meal library to start.</p>
      <p aria-live="polite">{saveStatus === 'saved' ? 'Changes saved locally.' : 'Changes are not saved locally.'}</p>
      {message && <p role="status">{message}</p>}
      <section aria-labelledby="household-heading">
        <h2 id="household-heading">Household</h2>
        <form className="actions" onSubmit={(event) => { event.preventDefault(); addDiner() }}>
          <label>Diner name<input maxLength={160} value={dinerName} onChange={(event) => setDinerName(event.target.value)} /></label>
          <button disabled={state.household.diners.length >= 20}>Add diner</button>
        </form>
        {state.household.diners.length > 0 && <ul>{state.household.diners.map((diner) => <li key={diner.id}>{diner.name}</li>)}</ul>}
        <form className="actions" onSubmit={(event) => { event.preventDefault(); addRestriction() }}>
          <label>Hard restriction<input maxLength={160} value={restriction} onChange={(event) => setRestriction(event.target.value)} /></label>
          <label>Applies to<select value={restrictionDinerId} onChange={(event) => setRestrictionDinerId(event.target.value)}><option value="">Everyone</option>{state.household.diners.map((diner) => <option key={diner.id} value={diner.id}>{diner.name}</option>)}</select></label>
          <button disabled={state.household.hardRestrictions.length >= 50}>Add restriction</button>
        </form>
        {state.household.hardRestrictions.length > 0 && <ul>{state.household.hardRestrictions.map((item) => <li key={item.id}>{item.label}{item.dinerId && ` — ${state.household.diners.find((diner) => diner.id === item.dinerId)?.name}`}</li>)}</ul>}
        <form className="actions" onSubmit={(event) => { event.preventDefault(); addException() }}>
          <label>Exception date<input type="date" value={exceptionDate} onChange={(event) => setExceptionDate(event.target.value)} /></label>
          <label>Exception note<input maxLength={500} value={exceptionNote} onChange={(event) => setExceptionNote(event.target.value)} /></label>
          <label><input aria-label="Constrained night" type="checkbox" checked={exceptionConstrained} onChange={(event) => { setExceptionConstrained(event.target.checked); if (event.target.checked) setExceptionHandsOff(false) }} /> Quick-cook night (30 minutes hands-on)</label>
          <label><input aria-label="Hands-off night" type="checkbox" checked={exceptionHandsOff} onChange={(event) => { setExceptionHandsOff(event.target.checked); if (event.target.checked) setExceptionConstrained(false) }} /> Hands-off night (planned leftovers or your marked slow-cooker recipe)</label>
          <button disabled={state.household.scheduleExceptions.length >= 100 && !state.household.scheduleExceptions.some((item) => item.date === exceptionDate)}>Add exception</button>
        </form>
        {state.household.scheduleExceptions.length > 0 && <ul>{state.household.scheduleExceptions.map((item) => <li key={item.id}>{item.date}: {item.handsOff ? 'Hands-off' : item.constrained ? 'Quick-cook' : 'Normal'}{item.note && ` — ${item.note}`}</li>)}</ul>}
      </section>
      <section aria-labelledby="weekly-plan-heading">
        <h2 id="weekly-plan-heading">Weekly plan</h2>
        <p>Meals marked to cover leftovers reduce cooking nights; all other nights stay cooking nights.</p>
        <p className="actions"><label>Week starts<input aria-label="Week starts" type="date" value={planStartDate} onChange={(event) => { setPlanStartDate(event.target.value); setWeeklyPreview(undefined) }} /></label><button onClick={previewWeeklyPlan} disabled={!planStartDate}>Preview weekly plan</button></p>
        {weeklyPreview && <div className="weekly-plan-preview">
          <h3>Weekly plan preview</h3>
          {weeklyPreview.kind === 'plan' ? <><ol>{weeklyPreview.slots.map((slot) => <li key={slot.date}><strong>{slot.date}</strong>: {plannedTakeoutDates.includes(slot.date) ? 'Takeout' : state.meals.find((meal) => meal.id === slot.mealId)?.name} {slot.leftoverFrom !== undefined && '(planned leftovers)'} <button onClick={() => togglePlannedTakeout(slot.date)}> {plannedTakeoutDates.includes(slot.date) ? 'Use planned meal' : `Plan takeout for ${slot.date}`}</button><br /><small>{slot.confidence} · {slot.score} reliability points. {slot.reasons.join(' ')}</small></li>)}</ol>
            {weeklyPreview.optional && <div><p>Optional unfamiliar meal: {state.meals.find((meal) => meal.id === weeklyPreview.optional?.mealId)?.name}. No action keeps familiar fallback {state.meals.find((meal) => meal.id === weeklyPreview.optional?.fallbackMealId)?.name}.</p><p className="actions"><button onClick={() => chooseOptionalMeal('use')}>Use this meal</button><button onClick={() => chooseOptionalMeal('adapt')}>Make it work for us</button><button onClick={() => chooseOptionalMeal('reject')}>Not for us</button></p>{optionalAction !== 'fallback' && <p>{optionalAction === 'adapt' && !state.meals.find((meal) => meal.id === weeklyPreview.optional?.mealId)?.adaptations?.length ? 'No saved shared adaptation is available, so the familiar fallback remains selected.' : optionalAction === 'reject' ? 'The familiar fallback remains selected.' : weeklyPreview.slots.some((slot) => slot.mealId === weeklyPreview.optional?.mealId) ? 'Your chosen unfamiliar meal is in this preview.' : 'That unfamiliar meal cannot fit the first cooking night, so the familiar fallback remains selected.'}</p>}</div>}
            <button onClick={confirmWeeklyPlan} disabled={state.plans.length >= 100}>Confirm weekly plan</button></> : <><p>{weeklyPreview.nextStep}</p><p className="actions">{Array.from({ length: 7 }, (_, day) => { const date = weekDate(planStartDate, day); return <button key={date} onClick={() => togglePlannedTakeout(date)}>{plannedTakeoutDates.includes(date) ? 'Use planned meal' : `Plan takeout for ${date}`}</button> })}</p></>}
          {weeklyPreview.excluded.length > 0 && <p>Excluded: {weeklyPreview.excluded.map((item) => `${state.meals.find((meal) => meal.id === item.mealId)?.name}: ${item.reason}`).join(' ')}</p>}
        </div>}
        {state.plans.filter((plan) => plan.confirmed).map((plan) => <div key={plan.id}><h3>Current weekly plan</h3><ol>{plan.slots.map((slot) => {
          const name = state.meals.find((meal) => meal.id === slot.mealId)?.name ?? 'Takeout'
          const outcome = correctedOutcomes(state.outcomes).find((item) => item.planId === plan.id && item.planSlotId === slot.id)
          const needsReview = reviewNeeded.has(`${plan.id}:${slot.id}`) || currentReviewSlotIds.has(`${plan.id}:${slot.id}`)
          const leftoverSourcePending = Boolean(slot.leftoverFromSlotId && !plan.slots.find((item) => item.id === slot.leftoverFromSlotId)?.dinnerReadyAt)
          return <li key={slot.id}>{slot.date}: {name}{slot.leftoverFromSlotId && ' (planned leftovers)'} {needsReview && <button onClick={() => { setRepairPlanId(plan.id); setRepairSlotId(slot.id); setRepairOpen(false); setRepairPreview(undefined) }}>Review needed</button>} {slot.mealId && !leftoverConsumer(slot) && !slot.cookingStartedAt && !slot.dinnerReadyAt && <button disabled={needsReview} onClick={() => startCooking(plan.id, slot.id)}>Start cooking {name}</button>} {!slot.dinnerReadyAt && <button disabled={needsReview || leftoverSourcePending || Boolean(slot.mealId && !slot.cookingStartedAt && !leftoverConsumer(slot))} onClick={() => dinnerReady(plan.id, slot.id)}>Dinner’s ready {name}</button>} {leftoverSourcePending && <small> Mark the source dinner ready before serving leftovers.</small>} {slot.dinnerReadyAt && <small> Dinner recorded.</small>} {outcome ? <button onClick={() => openFeedback(plan.id, slot.id, outcome.id)}>Correct feedback</button> : slot.dinnerReadyAt && slot.feedbackEligibleAt && slot.feedbackEligibleAt <= new Date().toISOString() && <button onClick={() => openFeedback(plan.id, slot.id)}>Add feedback</button>}</li>
        })}</ol></div>)}
      </section>
      {feedbackPlan && feedbackSlot && <section aria-labelledby="feedback-heading">
        <h2 id="feedback-heading">Dinner feedback</h2>
        <p>{feedbackMeal?.name ?? 'Dinner'} feedback is saved as raw household and person evidence.</p>
        {(feedbackSlot.expectedDinerIds ?? state.household.diners.filter((diner) => diner.active).map((diner) => diner.id)).flatMap((dinerId) => state.household.diners.filter((diner) => diner.id === dinerId)).map((diner) => <label key={diner.id}>{diner.name}<select aria-label={`Feedback for ${diner.name}`} value={personFeedback[diner.id] ?? 'absent'} onChange={(event) => setPersonFeedback((current) => ({ ...current, [diner.id]: event.target.value as FeedbackChoice }))}><option value="accepted">Ate it</option><option value="rejected">Refused it</option><option value="absent">Absent</option><option value="ate-separately">Ate separately</option><option value="not-hungry">Not hungry</option></select></label>)}
        {!leftoverConsumer(feedbackSlot) && feedbackSlot.mealId && <label>Active effort minutes<input aria-label="Active effort minutes" type="number" min="0" max="10080" value={activeEffortMinutes} onChange={(event) => setActiveEffortMinutes(event.target.value)} /></label>}
        {!leftoverConsumer(feedbackSlot) && feedbackSlot.mealId && <label>Leftover coverage<select aria-label="Leftover coverage" value={leftoverCoverage} onChange={(event) => setLeftoverCoverage(event.target.value as typeof leftoverCoverage)}><option value="none">None</option><option value="some">Some, not a dinner</option><option value="one">One dinner</option><option value="more-than-one">More than one dinner</option></select></label>}
        <p className="actions"><button onClick={submitFeedback}>Save feedback</button><button onClick={() => { setFeedbackTarget(undefined); setFeedbackCorrectionId(undefined); update((current) => ({ ...current, plans: current.plans.map((plan) => plan.id !== feedbackPlan.id ? plan : { ...plan, slots: plan.slots.map((slot) => slot.id === feedbackSlot.id ? { ...slot, feedbackDismissed: true } : slot) }) })) }}>Not now</button></p>
      </section>}
      {state.plans.some((plan) => plan.confirmed) && <section aria-labelledby="shopping-heading">
        <h2 id="shopping-heading">Shopping</h2>
        <label>Plan for shopping<select aria-label="Plan for shopping" value={shoppingPlanId} onChange={(event) => { setShoppingPlanId(event.target.value); hydrateShoppingControls(state, event.target.value); setRepairPreview(undefined) }}><option value="">Choose a confirmed plan</option>{state.plans.filter((plan) => plan.confirmed).map((plan) => <option key={plan.id} value={plan.id}>{plan.id}</option>)}</select></label>
        {shoppingPlan && groceries && shoppingItems && <>
        {!shoppingPlan.shopping && groceries.incompleteMeals.length > 0 && <p>Shopping list is incomplete: {groceries.incompleteMeals.map((meal) => meal.mealName).join(', ')}.</p>}
        <fieldset disabled={Boolean(shoppingPlan.shopping)}><legend>Shopping availability</legend>
        {shoppingPlan.shopping?.partial && <p>This saved shopping record is partial.</p>}
        {!shoppingPlan.shopping && groceries.incompleteMeals.map((meal) => <label key={meal.mealId}><input aria-label={`Ingredients unavailable or skipped for ${meal.mealName}`} type="checkbox" checked={skippedIncompleteMeals.has(meal.mealId)} onChange={(event) => { setRepairPreview(undefined); setSkippedIncompleteMeals((current) => { const next = new Set(current); if (event.target.checked) next.add(meal.mealId); else next.delete(meal.mealId); return next }) }} /> Ingredients unavailable/skipped for {meal.mealName}</label>)}
        <ul>{shoppingItems.map((item) => <li key={item.id}><label><input aria-label={`Unavailable ${item.label}`} type="checkbox" checked={shoppingPlan.shopping ? ('availability' in item && item.availability === 'unavailable') : unavailableItems.has(item.id)} onChange={(event) => { setRepairPreview(undefined); setUnavailableItems((current) => { const next = new Set(current); if (event.target.checked) { next.add(item.id); setSkippedItems((skipped) => { const nextSkipped = new Set(skipped); nextSkipped.delete(item.id); return nextSkipped }) } else next.delete(item.id); return next }) }} /> {item.label}</label><label><input aria-label={`Skip ${item.label}`} type="checkbox" checked={shoppingPlan.shopping ? ('availability' in item && item.availability === 'skipped') : skippedItems.has(item.id)} onChange={(event) => { setRepairPreview(undefined); setSkippedItems((current) => { const next = new Set(current); if (event.target.checked) { next.add(item.id); setUnavailableItems((unavailable) => { const nextUnavailable = new Set(unavailable); nextUnavailable.delete(item.id); return nextUnavailable }) } else next.delete(item.id); return next }) }} /> Skip</label><label><input aria-label={`Perishable ${item.label}`} type="checkbox" checked={shoppingPlan.shopping ? ('perishable' in item && item.perishable) : perishableItems.has(item.id)} onChange={(event) => { setRepairPreview(undefined); setPerishableItems((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next }) }} /> Perishable</label><small> Sources: {item.sourceLines.join('; ')}</small></li>)}</ul>
        {shoppingItems.some((item) => 'manualQuantityAdjustment' in item && item.manualQuantityAdjustment) && <p>Manual quantity adjustment: unparsed ingredient quantities were not scaled.</p>}
        <button disabled={groceries.incompleteMeals.some((meal) => !skippedIncompleteMeals.has(meal.mealId))} onClick={confirmShopping}>Shopping done</button>
        </fieldset>
        </>}
      </section>}
      {state.plans.some((plan) => plan.confirmed) && <section aria-labelledby="repair-heading">
        <h2 id="repair-heading">Plan repair</h2>
        <label>Plan to repair<select aria-label="Plan to repair" value={repairPlanId} disabled={Boolean(failedLeftover)} onChange={(event) => { setRepairPlanId(event.target.value); setRepairSlotId(undefined); setRepairOpen(false); setRepairPreview(undefined) }}><option value="">Choose a plan</option>{state.plans.filter((plan) => plan.confirmed).map((plan) => <option key={plan.id} value={plan.id}>{plan.id}</option>)}</select></label>
        <label>Date to repair<select aria-label="Date to repair" value={repairSlotId ?? ''} disabled={!repairPlan || Boolean(failedLeftover)} onChange={(event) => { setRepairSlotId(event.target.value || undefined); setRepairOpen(false); setRepairPreview(undefined) }}><option value="">Choose a date</option>{repairPlan?.slots.map((slot) => <option key={slot.id} value={slot.id}>{slot.date}{slot.dinnerReadyAt && ' (completed)'}</option>)}</select></label>
        <button disabled={!repairTarget || Boolean(failedLeftover)} onClick={() => { setRepairOpen(true); setRepairPreview(undefined) }}>Plans changed</button>
        {repairOpen && repairTarget && <div className="repair-options"><button onClick={() => setRepairPreview(undefined)}>Just show me options</button><p>Choose one whole-household option for {state.meals.find((meal) => meal.id === repairTarget.mealId)?.name}.</p>
          {failedLeftover && (() => { const source = repairPlan?.slots.find((slot) => slot.id === failedLeftover.sourceSlotId); const recipe = state.recipes.find((item) => item.id === source?.recipeId) as (typeof state.recipes[number] & { leftoverQuantityMultiplier?: 1.5 | 2 }) | undefined; const multiplier = recipe?.leftoverQuantityMultiplier; return <p className="actions"><button onClick={() => { setFailedLeftover({ sourceSlotId: failedLeftover.sourceSlotId, remove: true }); showRepair('replan') }}>Remove leftover planning</button>{recipe && multiplier === undefined && <button onClick={() => { setFailedLeftover({ sourceSlotId: failedLeftover.sourceSlotId, multiplier: 1.5 }); showRepair('replan') }}>Increase recipe quantity to 1.5x</button>}{recipe && multiplier !== 2 && <button onClick={() => { setFailedLeftover({ sourceSlotId: failedLeftover.sourceSlotId, multiplier: 2 }); showRepair('replan') }}>Increase recipe quantity to 2x</button>}</p> })()}
          {!failedLeftover && <p className="actions">{!repairTarget.dinnerReadyAt && <><button onClick={() => showRepair('replan')}>Replan with eligible meal</button>{!leftoverConsumer(repairTarget) && repairMeal?.adaptations?.filter((adaptation) => adaptation.solvesIssue && adaptation.coordinatedCooking && adaptation.noSecondEntree && adaptation.noUnplannedProtein && adaptation.noSeparateTimeline && adaptation.noExtraEffort && adaptation.recipeId && adaptation.recipeId !== repairTarget.recipeId && state.recipes.some((recipe) => recipe.id === adaptation.recipeId && (recipe.mealId === repairTarget.mealId || repairMeal.recipeIds?.includes(recipe.id)))).map((adaptation) => <button key={adaptation.id} onClick={() => showRepair('simpler', repairTarget.mealId, adaptation.recipeId, undefined, undefined, adaptation.id)}>Use {adaptation.name}</button>)}{!repairSlotHasLeftoverLink(repairTarget.id) && repairPlan!.slots.filter((slot) => slot.id !== repairTarget.id && slot.mealId && !slot.dinnerReadyAt && !repairSlotHasLeftoverLink(slot.id)).map((slot) => <button key={slot.id} onClick={() => showRepair('swap', undefined, undefined, slot.id)}>Swap with {state.meals.find((meal) => meal.id === slot.mealId)?.name}</button>)}{state.leftoverLots.filter((lot) => lot.active !== false && (lot.dinnerCoverage === 'one' || lot.dinnerCoverage === 'more-than-one') && lot.sourceMealId).map((lot) => <button key={lot.id} onClick={() => showRepair('leftovers', lot.sourceMealId, undefined, undefined, lot.id)}>Use confirmed leftovers</button>)}{repairMeal?.recoveryMealIds?.map((mealId) => <button key={mealId} onClick={() => showRepair('recovery', mealId)}>Use recovery {state.meals.find((meal) => meal.id === mealId)?.name}</button>)}</>}<label>Takeout context<select value={takeoutContext} onChange={(event) => setTakeoutContext(event.target.value as typeof takeoutContext)}><option value="planned">Planned</option><option value="unforeseeable-disruption">Unforeseeable disruption</option><option value="predictable-planning-or-acceptance-failure">Predictable planning or acceptance failure</option></select></label><button onClick={() => showRepair('takeout')}>Choose takeout</button></p>}
          {repairPreview && <div>{failedLeftover && <p>Future recipe preference cannot fix cooked food; the dependent dinner is being replanned.</p>}<p>Repair preview: {repairPreview.choice.adaptationId ? `${state.meals.find((meal) => meal.id === repairTarget.mealId)?.name} uses ${repairMeal?.adaptations?.find((adaptation) => adaptation.id === repairPreview.choice.adaptationId)?.name}` : `${state.meals.find((meal) => meal.id === repairTarget.mealId)?.name} becomes ${repairPreview.choice.kind === 'takeout' ? 'takeout' : state.meals.find((meal) => meal.id === repairPreview.plan.slots.find((slot) => slot.id === repairTarget.id)?.mealId)?.name}`}. Unaffected days stay unchanged.</p>{repairPreview.changedSlotIds.length > 0 && <ul>{repairPreview.revisionDrafts.map((draft) => { const before = state.plans.find((plan) => plan.id === draft.planId)?.slots.find((slot) => slot.id === draft.slotId); const after = repairPreview.plans.find((plan) => plan.id === draft.planId)?.slots.find((slot) => slot.id === draft.slotId); return <li key={`${draft.planId}:${draft.slotId}`}>{before?.date}: {state.meals.find((meal) => meal.id === before?.mealId)?.name ?? 'Takeout'} → {state.meals.find((meal) => meal.id === after?.mealId)?.name ?? 'Takeout'}{before?.leftoverFromSlotId !== after?.leftoverFromSlotId && ' (planned leftover dependency changed)'}{JSON.stringify(before?.leftoverLotIds ?? []) !== JSON.stringify(after?.leftoverLotIds ?? []) && ` (confirmed leftover lots: ${(before?.leftoverLotIds ?? []).join(', ') || 'none'} → ${(after?.leftoverLotIds ?? []).join(', ') || 'none'})`}</li> })}</ul>}{repairPreview.consumedLotIds.length > 0 && <p>Confirmed leftover lots consumed: {repairPreview.consumedLotIds.join(', ')}.</p>}{repairPreview.releasedLotIds.length > 0 && <p>Confirmed leftover lots released: {repairPreview.releasedLotIds.join(', ')}.</p>}{repairGroceryChanges && <><p>Grocery changes: {repairGroceryChanges.added.length ? `add ${repairGroceryChanges.added.join(', ')}` : 'no additions'}; {repairGroceryChanges.removed.length ? `remove ${repairGroceryChanges.removed.join(', ')}` : 'no removals'}.</p>{repairGroceryChanges.manual.length > 0 && <p>Manual quantity adjustment: {repairGroceryChanges.manual.join(', ')}.</p>}</>}{repairPreview.perishableRisks.length > 0 && <label><input aria-label="Acknowledge perishable grocery risk" type="checkbox" checked={perishableAcknowledged} onChange={(event) => setPerishableAcknowledged(event.target.checked)} /> I understand this replaces meals with confirmed perishables.</label>}<button onClick={confirmRepair}>Confirm repair</button></div>}
        </div>}
      </section>}
      <section aria-labelledby="meals-heading">
        <h2 id="meals-heading">Meal library</h2>
        <p>{state.meals.filter((meal) => meal.active).length} selected. For a useful first plan, select 8–12 active meals.</p>
        <form className="actions" onSubmit={(event) => { event.preventDefault(); addMeal() }}>
          <label>Meal name<input maxLength={160} value={mealName} onChange={(event) => setMealName(event.target.value)} /></label>
          <label><input aria-label={`Plan one leftover dinner for ${mealName}`} type="checkbox" checked={plannedLeftoverDinner} onChange={(event) => setPlannedLeftoverDinner(event.target.checked)} /> Plan one leftover dinner</label>
          <button disabled={state.meals.length >= 500}>Add meal</button>
        </form>
        {state.meals.length > 0 && state.household.diners.length > 0 && <form className="actions" onSubmit={(event) => { event.preventDefault(); saveAdaptation() }}>
          <label>Adapt meal<select value={adaptationMealId} onChange={(event) => setAdaptationMealId(event.target.value)}><option value="">Choose a meal</option>{state.meals.map((meal) => <option key={meal.id} value={meal.id}>{meal.name}</option>)}</select></label>
          <label>Diner<select value={adaptationDinerId} onChange={(event) => setAdaptationDinerId(event.target.value)}><option value="">Choose a diner</option>{state.household.diners.map((diner) => <option key={diner.id} value={diner.id}>{diner.name}</option>)}</select></label>
          <label>Issue<input maxLength={500} value={adaptationIssue} onChange={(event) => setAdaptationIssue(event.target.value)} /></label>
          <label>Shared adaptation<input maxLength={160} value={adaptationName} onChange={(event) => setAdaptationName(event.target.value)} /></label><button>Add shared adaptation</button>
          {Object.entries({ solvesIssue: 'Solves the issue', coordinatedCooking: 'One coordinated cooking session', noSecondEntree: 'No second entree', noUnplannedProtein: 'No unplanned non-staple protein', noSeparateTimeline: 'No separate timeline', noExtraEffort: 'No needless extra effort' }).map(([key, label]) => <label key={key}><input aria-label={label} type="checkbox" checked={adaptationChecks[key as keyof typeof adaptationChecks]} onChange={(event) => setAdaptationChecks((current) => ({ ...current, [key]: event.target.checked }))} /> {label}</label>)}
        </form>}
        {state.meals.length > 1 && <p className="actions"><label>Meal needing recovery<select aria-label="Meal needing recovery" value={recoveryMealId} onChange={(event) => setRecoveryMealId(event.target.value)}><option value="">Choose a meal</option>{state.meals.map((meal) => <option key={meal.id} value={meal.id}>{meal.name}</option>)}</select></label><label>Recovery meal<select aria-label="Recovery meal" value={recoveryTargetId} onChange={(event) => setRecoveryTargetId(event.target.value)}><option value="">Choose a recovery meal</option>{state.meals.filter((meal) => meal.id !== recoveryMealId).map((meal) => <option key={meal.id} value={meal.id}>{meal.name}</option>)}</select></label><button disabled={!recoveryMealId || !recoveryTargetId || (state.meals.find((meal) => meal.id === recoveryMealId)?.recoveryMealIds?.length ?? 0) >= 50} onClick={() => { linkRecovery(recoveryMealId, recoveryTargetId); setRecoveryTargetId('') }}>Link recovery meal</button></p>}
        <ul className="meal-list">
          {state.meals.map((meal) => {
            const recipes = state.recipes.filter((recipe) => recipe.mealId === meal.id || meal.recipeIds?.includes(recipe.id))
            const eligibility = mealEligibility({ hardRestrictions: state.household.hardRestrictions, safetyReview: meal.safetyReview })
            return <li key={meal.id}>
              <label>Meal name {meal.name}<input maxLength={160} value={meal.name} onChange={(event) => { if (event.target.value.trim() && event.target.value.length <= 160) update((current) => ({ ...current, meals: current.meals.map((currentMeal) => currentMeal.id === meal.id ? { ...currentMeal, name: event.target.value } : currentMeal) })) }} /></label>
              <label><input aria-label={`Active ${meal.name}`} type="checkbox" checked={meal.active} onChange={(event) => update((current) => ({ ...current, meals: current.meals.map((currentMeal) => currentMeal.id === meal.id ? { ...currentMeal, active: event.target.checked } : currentMeal) }))} /> Active</label>
              <label><input aria-label={`Plan one leftover dinner for ${meal.name}`} type="checkbox" checked={meal.plannedLeftoverDinner === true} onChange={(event) => update((current) => ({ ...current, meals: current.meals.map((currentMeal) => currentMeal.id === meal.id ? { ...currentMeal, plannedLeftoverDinner: event.target.checked || undefined } : currentMeal) }))} /> Plan one leftover dinner</label>
              <label>Safety review for {meal.name}<select value={meal.safetyReview ?? 'unknown'} onChange={(event) => update((current) => ({ ...current, meals: current.meals.map((currentMeal) => currentMeal.id === meal.id ? { ...currentMeal, safetyReview: event.target.value as 'unknown' | 'approved' | 'rejected' } : currentMeal) }))}><option value="unknown">Unknown</option><option value="approved">Compatibility confirmed</option><option value="rejected">Not compatible</option></select></label>
              {recipes.map((recipe) => <div key={recipe.id}><p>Recipe: {recipe.title}</p><label><input aria-label={`Hands-off slow cooker ${recipe.title}`} type="checkbox" checked={recipe.handsOffSlowCooker === true} onChange={(event) => update((current) => ({ ...current, recipes: current.recipes.map((item) => item.id === recipe.id ? { ...item, handsOffSlowCooker: event.target.checked || undefined } : item) }))} /> I can start this slow-cooker recipe before the hands-off window</label>{recipe.ingredients?.length ? <section aria-label={`Ingredients for ${recipe.title}`}><ul>{recipe.ingredients.map((ingredient, index) => <li key={index}>{ingredient}</li>)}</ul></section> : null}</div>)}
              <p>{recipes.length === 0 ? 'No linked recipe. Grocery ingredients are incomplete.' : `${recipes.length} linked recipe${recipes.length === 1 ? '' : 's'}. ${recipes.some((recipe) => !recipe.ingredients?.length) ? 'Grocery ingredients are incomplete.' : 'Grocery ingredients are available.'}`}</p>
              <p>{eligibility.eligible ? 'Eligible to plan.' : eligibility.reason}</p>
              {state.household.hardRestrictions.length > 0 && <p className="hint">Compatibility confirmation is your review; this app does not certify allergy safety.</p>}
            </li>
          })}
        </ul>
      </section>
      <p className="actions">
        <button onClick={() => download('whats-for-dinner-backup.json', exportAppState(state))}>Export backup</button>
        <label>
          Import backup
          <input type="file" accept="application/json" onChange={onImport} />
        </label>
        <button onClick={reset}>Reset data</button>
      </p>
      <section aria-labelledby="recipe-keeper-heading">
        <h2 id="recipe-keeper-heading">Recipe Keeper import</h2>
        <label>Recipe Keeper ZIP<input aria-label="Recipe Keeper ZIP" type="file" accept="application/zip,.zip" onChange={onRecipeKeeperImport} /></label>
        {candidates.length > 0 && <div className="recipe-import">
          <label>Search recipes<input value={candidateQuery} onChange={(event) => { setCandidateQuery(event.target.value); setNewToHousehold(false) }} /></label>
          <label>Recipe<select value={chosenCandidate?.externalId ?? ''} onChange={(event) => { setSelectedCandidate(event.target.value); setNewToHousehold(false) }}>{visibleCandidates.map((candidate) => <option key={candidate.externalId} value={candidate.externalId}>{candidate.title}</option>)}</select></label>
          {chosenCandidate && <p>Preview: {chosenCandidate.title}{chosenCandidate.category && ` — ${chosenCandidate.category}`}{chosenCandidate.ingredients && ` (${chosenCandidate.ingredients.length} ingredients)`}</p>}
          <fieldset><legend>Save destination</legend><label><input type="radio" checked={destination === 'new'} onChange={() => { setDestination('new'); setNewToHousehold(false) }} /> Add as a new meal</label><label><input type="radio" checked={destination === 'existing'} onChange={() => { setDestination('existing'); setNewToHousehold(false) }} /> Add as a version of an existing meal</label><label><input type="radio" checked={destination === 'recipe'} onChange={() => { setDestination('recipe'); setNewToHousehold(false) }} /> Save recipe only</label></fieldset>
          {destination === 'new' && <label><input aria-label="New to our household" type="checkbox" checked={newToHousehold} onChange={(event) => setNewToHousehold(event.target.checked)} /> New to our household</label>}
          {destination === 'existing' && <label>Existing meal<select value={existingMealId} onChange={(event) => setExistingMealId(event.target.value)}><option value="">Choose a meal</option>{state.meals.map((meal) => <option key={meal.id} value={meal.id}>{meal.name}{meal.name.toLowerCase() === chosenCandidate?.title.toLowerCase() ? ' (title match)' : ''}</option>)}</select></label>}
          <button onClick={saveCandidate} disabled={!chosenCandidate}>Confirm import</button>
          {skipped > 0 && <p>{skipped} recipes were skipped.</p>}
        </div>}
      </section>
    </main>
  )
}
