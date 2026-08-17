import { useReducer, useState, type ChangeEvent } from 'react'
import {
  createEmptyAppState,
  exportAppState,
  importAppState,
  loadAppState,
  saveAppState,
  type LoadResult,
} from './state/storage'
import type { AppStateV1 } from './state/schema'
import { mealEligibility } from './domain/mealEligibility'
import { buildWeeklyPlan } from './domain/weeklyPlan'
import { buildGroceryList } from './domain/grocery'
import { adaptSharedMeal, missingLeftoverDependencies, previewRepair, type RepairPreview } from './domain/repair'
import { classifyRecovery, correctedOutcomes, householdAcceptance, type NeutralReason } from './domain/outcomes'
import { readRecipeKeeperZip, type RecipeKeeperCandidate } from './import/recipeKeeper'
import './app.css'

type Action = { type: 'replace'; state: AppStateV1 }
type FeedbackChoice = 'accepted' | 'rejected' | NeutralReason

function reducer(_state: AppStateV1, action: Action): AppStateV1 {
  return action.state
}

function eligibleFeedbackSlot(state: AppStateV1): { planId: string; slotId: string } | undefined {
  const now = new Date().toISOString()
  const found = [...state.plans].reverse().flatMap((plan) => plan.slots.map((slot) => ({ plan, slot }))).find(({ plan, slot }) => Boolean(slot.dinnerReadyAt && slot.feedbackEligibleAt && slot.feedbackEligibleAt <= now && !slot.feedbackDismissed && !state.outcomes.some((outcome) => outcome.planId === plan.id && outcome.planSlotId === slot.id)))
  return found ? { planId: found.plan.id, slotId: found.slot.id } : undefined
}

function shoppingControls(state: AppStateV1) {
  const shopping = [...state.plans].reverse().find((plan) => plan.confirmed)?.shopping
  const groceries = shopping ? buildGroceryList(state).items : []
  const itemId = (item: NonNullable<typeof shopping>['items'][number]) => item.id ?? groceries.find((candidate) => candidate.label === item.label && candidate.sourceLines.join('\n') === item.sourceLines.join('\n') && candidate.mealIds.join('\n') === item.mealIds.join('\n'))?.id
  const itemIds = (matches: (item: NonNullable<typeof shopping>['items'][number]) => boolean) => new Set(shopping?.items.flatMap((item) => { const id = itemId(item); return matches(item) && id ? [id] : [] }) ?? [])
  return { unavailable: itemIds((item) => item.availability === 'unavailable'), skipped: itemIds((item) => item.availability === 'skipped'), perishable: itemIds((item) => item.perishable), skippedIncompleteMeals: new Set(shopping?.skippedIncompleteMealIds) }
}

function sameRestrictions(a: AppStateV1['household']['hardRestrictions'], b: AppStateV1['household']['hardRestrictions']): boolean {
  return a.length === b.length && a.every((restriction, index) => restriction.id === b[index].id && restriction.label === b[index].label && restriction.dinerId === b[index].dinerId)
}

function download(filename: string, contents: string): void {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([contents], { type: 'application/json' }))
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

function Recovery({ recovery }: { recovery: Extract<LoadResult, { kind: 'recovery' }> }) {
  const reset = () => {
    if (window.confirm('Reset this device to a new empty plan?')) {
      saveAppState(localStorage, createEmptyAppState())
      window.location.reload()
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
    </main>
  )
}

export default function App() {
  const [loaded] = useState(() => loadAppState(localStorage))
  if (loaded.kind === 'recovery') return <Recovery recovery={loaded} />

  return <ReadyApp initialState={loaded.state} />
}

function ReadyApp({ initialState }: { initialState: AppStateV1 }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [initialShoppingControls] = useState(() => shoppingControls(initialState))
  const [saveStatus, setSaveStatus] = useState<'saved' | 'unsaved'>('saved')
  const [message, setMessage] = useState('')
  const [dinerName, setDinerName] = useState('')
  const [restriction, setRestriction] = useState('')
  const [restrictionDinerId, setRestrictionDinerId] = useState('')
  const [exceptionDate, setExceptionDate] = useState('')
  const [exceptionNote, setExceptionNote] = useState('')
  const [exceptionConstrained, setExceptionConstrained] = useState(false)
  const [mealName, setMealName] = useState('')
  const [plannedLeftoverDinner, setPlannedLeftoverDinner] = useState(false)
  const [candidates, setCandidates] = useState<RecipeKeeperCandidate[]>([])
  const [skipped, setSkipped] = useState(0)
  const [candidateQuery, setCandidateQuery] = useState('')
  const [selectedCandidate, setSelectedCandidate] = useState('')
  const [destination, setDestination] = useState<'new' | 'existing' | 'recipe'>('new')
  const [existingMealId, setExistingMealId] = useState('')
  const [planStartDate, setPlanStartDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [weeklyPreview, setWeeklyPreview] = useState<ReturnType<typeof buildWeeklyPlan>>()
  const [optionalAction, setOptionalAction] = useState<'fallback' | 'use' | 'adapt' | 'reject'>('fallback')
  const [plannedTakeoutDate, setPlannedTakeoutDate] = useState<string>()
  const [unavailableItems, setUnavailableItems] = useState<Set<string>>(() => initialShoppingControls.unavailable)
  const [skippedItems, setSkippedItems] = useState<Set<string>>(() => initialShoppingControls.skipped)
  const [perishableItems, setPerishableItems] = useState<Set<string>>(() => initialShoppingControls.perishable)
  const [skippedIncompleteMeals, setSkippedIncompleteMeals] = useState<Set<string>>(() => initialShoppingControls.skippedIncompleteMeals)
  const [perishableAcknowledged, setPerishableAcknowledged] = useState(false)
  const [repairOpen, setRepairOpen] = useState(false)
  const [repairPreview, setRepairPreview] = useState<RepairPreview>()
  const [adaptationMealId, setAdaptationMealId] = useState('')
  const [adaptationDinerId, setAdaptationDinerId] = useState('')
  const [adaptationIssue, setAdaptationIssue] = useState('')
  const [adaptationName, setAdaptationName] = useState('')
  const [recoveryMealId, setRecoveryMealId] = useState('')
  const [recoveryTargetId, setRecoveryTargetId] = useState('')
  const [adaptationChecks, setAdaptationChecks] = useState({ solvesIssue: false, coordinatedCooking: false, noSecondEntree: false, noUnplannedProtein: false, noSeparateTimeline: false, noExtraEffort: false })
  const [takeoutContext, setTakeoutContext] = useState<'planned' | 'unforeseeable-disruption' | 'predictable-planning-or-acceptance-failure'>('planned')
  const [feedbackTarget, setFeedbackTarget] = useState(() => eligibleFeedbackSlot(initialState))
  const [feedbackCorrectionId, setFeedbackCorrectionId] = useState<string>()
  const [personFeedback, setPersonFeedback] = useState<Record<string, FeedbackChoice>>({})
  const [leftoverCoverage, setLeftoverCoverage] = useState<'none' | 'some' | 'one' | 'more-than-one'>('none')
  const [activeEffortMinutes, setActiveEffortMinutes] = useState('')
  const [repairSlotId, setRepairSlotId] = useState<string>()

  const commit = (next: AppStateV1) => {
    setSaveStatus(saveAppState(localStorage, next).saved ? 'saved' : 'unsaved')
    setWeeklyPreview(undefined)
    setRepairPreview(undefined)
    dispatch({ type: 'replace', state: next })
  }
  const hydrateShoppingControls = (next: AppStateV1) => {
    const controls = shoppingControls(next)
    setUnavailableItems(controls.unavailable)
    setSkippedItems(controls.skipped)
    setPerishableItems(controls.perishable)
    setSkippedIncompleteMeals(controls.skippedIncompleteMeals)
  }

  const reset = () => {
    if (window.confirm('Reset all current app data?')) commit(createEmptyAppState())
  }

  const update = (change: (current: AppStateV1) => AppStateV1) => commit(change(state))
  const startCooking = (planId: string, slotId: string) => update((current) => ({ ...current, plans: current.plans.map((plan) => plan.id !== planId ? plan : { ...plan, slots: plan.slots.map((slot) => slot.id !== slotId || slot.cookingStartedAt ? slot : { ...slot, cookingStartedAt: new Date().toISOString() }) }) }))
  const dinnerReady = (planId: string, slotId: string) => {
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
    if (!exceptionDate || state.household.scheduleExceptions.length >= 100) return
    const note = exceptionNote.trim()
    if (note.length > 500) return
    update((current) => ({ ...current, household: { ...current.household, scheduleExceptions: [...current.household.scheduleExceptions, { id: crypto.randomUUID(), date: exceptionDate, ...(note && { note }), ...(exceptionConstrained && { constrained: true }) }] } }))
    setExceptionDate('')
    setExceptionNote('')
    setExceptionConstrained(false)
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
    setPlannedTakeoutDate(undefined)
    setWeeklyPreview(buildWeeklyPlan(state, planStartDate))
  }
  const chooseOptionalMeal = (action: 'use' | 'adapt' | 'reject') => {
    setOptionalAction(action)
    setWeeklyPreview(buildWeeklyPlan(state, planStartDate, action))
  }
  const confirmWeeklyPlan = () => {
    if (!weeklyPreview || weeklyPreview.slots.length !== 7 || state.plans.length >= 100) return
    const planId = crypto.randomUUID()
    const slotIds = weeklyPreview.slots.map(() => crypto.randomUUID())
    const rejectedMealId = optionalAction === 'reject' ? weeklyPreview.optional?.mealId : undefined
    const takeoutIndex = weeklyPreview.slots.findIndex((slot) => slot.date === plannedTakeoutDate)
    const next: AppStateV1 = { ...state, meals: rejectedMealId ? state.meals.map((meal) => meal.id === rejectedMealId ? { ...meal, active: false } : meal) : state.meals, plans: [...state.plans, {
      id: planId,
      confirmed: true,
      scoreReasons: weeklyPreview.slots.flatMap((slot) => slot.reasons).filter((reason, index, values) => values.indexOf(reason) === index),
      ...(weeklyPreview.optional && { variants: [{ id: crypto.randomUUID(), label: 'Proven fallback for optional unfamiliar meal', mealId: weeklyPreview.optional.fallbackMealId }] }),
      slots: weeklyPreview.slots.map((slot, index) => ({ id: slotIds[index], date: slot.date, ...(index !== takeoutIndex && { mealId: slot.mealId }), ...(index !== takeoutIndex && slot.recipeId && { recipeId: slot.recipeId }), ...(index !== takeoutIndex && slot.leftoverFrom !== undefined && { leftoverFromSlotId: slotIds[slot.leftoverFrom] }), score: slot.score, confidence: slot.confidence, scoreReasons: slot.reasons })),
      ...(takeoutIndex >= 0 && { repairRevisions: [{ id: crypto.randomUUID(), createdAt: new Date().toISOString(), slotId: slotIds[takeoutIndex], kind: 'takeout' as const, takeoutContext: 'planned' as const }] }),
    }] }
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
          const next: AppStateV1 = sameRestrictions(state.household.hardRestrictions, imported.household.hardRestrictions) ? imported : { ...imported, meals: imported.meals.map((meal) => ({ ...meal, safetyReview: 'unknown' })) }
          commit(next)
          hydrateShoppingControls(next)
          setMessage('Backup imported.')
        } catch {
          setMessage('That file is not a valid V1 backup.')
        }
      })
      .catch(() => {
        setMessage('That file is not a valid V1 backup.')
      })
      .finally(() => {
        event.target.value = ''
      })
  }
  const onRecipeKeeperImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 32 * 1024 * 1024) { setCandidates([]); setSelectedCandidate(''); setMessage('The ZIP file exceeds 32 MiB.'); event.target.value = ''; return }
    void file.arrayBuffer().then((buffer) => readRecipeKeeperZip(new Uint8Array(buffer))).then((result) => {
      setCandidates(result.candidates); setSkipped(result.skipped); setSelectedCandidate(result.candidates[0].externalId); setMessage(`Found ${result.candidates.length} recipes${result.skipped ? `; skipped ${result.skipped}.` : '.'}`)
    }).catch((error: unknown) => {
      setCandidates([]); setSelectedCandidate(''); setMessage(error instanceof Error ? error.message : 'Could not read that Recipe Keeper ZIP.')
    }).finally(() => { event.target.value = '' })
  }
  const saveCandidate = () => {
    const candidate = candidates.find((item) => item.externalId === selectedCandidate)
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
    update((current) => ({ ...current, recipes: [...current.recipes, recipe], meals: destination === 'new' ? [...current.meals, { id: mealId!, name: candidate.title, active: true, provisional: true, safetyReview: 'unknown', recipeIds: [recipeId] }] : targetMeal ? current.meals.map((meal) => meal.id === targetMeal.id ? { ...meal, recipeIds: [...(meal.recipeIds ?? []), recipeId], safetyReview: 'unknown' } : meal) : current.meals }))
    setMessage(destination === 'recipe' ? 'Recipe saved without a meal.' : 'Recipe saved. Confirm compatibility before planning.')
    setCandidates((current) => current.filter((item) => item.externalId !== candidate.externalId)); setSelectedCandidate('')
  }
  const visibleCandidates = candidates.filter((candidate) => candidate.title.toLowerCase().includes(candidateQuery.trim().toLowerCase()))
  const chosenCandidate = candidates.find((candidate) => candidate.externalId === selectedCandidate)
  const currentPlan = [...state.plans].reverse().find((plan) => plan.confirmed)
  const groceries = currentPlan ? buildGroceryList(state) : undefined
  const repairTarget = currentPlan?.slots.find((slot) => slot.id === repairSlotId) ?? currentPlan?.slots.find((slot) => !slot.dinnerReadyAt)
  const repairMeal = state.meals.find((meal) => meal.id === repairTarget?.mealId)
  const repairSlotHasLeftoverLink = (slotId: string) => {
    const slot = currentPlan?.slots.find((item) => item.id === slotId)
    return Boolean(slot?.leftoverFromSlotId || slot?.leftoverLotIds?.length || currentPlan?.slots.some((item) => !item.dinnerReadyAt && item.leftoverFromSlotId === slotId))
  }
  const showRepair = (kind: 'simpler' | 'swap' | 'leftovers' | 'recovery' | 'takeout', mealId?: string, recipeId?: string, swapSlotId?: string, leftoverLotId?: string, adaptationId?: string) => {
    if (!currentPlan || !repairTarget) return
    setPerishableAcknowledged(false)
    setRepairPreview(previewRepair(currentPlan, { slotId: repairTarget.id, kind, ...(mealId && { mealId }), ...(recipeId && { recipeId }), ...(swapSlotId && { swapSlotId }), ...(leftoverLotId && { leftoverLotId }), ...(adaptationId && { adaptationId }), ...(kind === 'takeout' && { takeoutContext }) }))
  }
  const confirmRepair = () => {
    if (!repairPreview) return
    const targetMealRemoved = repairTarget?.mealId !== undefined && !repairPreview.plan.slots.some((slot) => slot.mealId === repairTarget.mealId)
    const perishableRisk = targetMealRemoved && currentPlan?.shopping?.items.some((item) => item.availability === 'available' && item.perishable && item.mealIds.includes(repairTarget.mealId ?? ''))
    if (perishableRisk && !perishableAcknowledged) { setMessage('Acknowledge the confirmed perishable groceries before replacing this meal.'); return }
    if (!window.confirm('Apply this repair?')) return
    update((current) => ({ ...current, plans: current.plans.map((plan) => plan.id !== repairPreview.plan.id ? plan : { ...repairPreview.plan, repairRevisions: [...(plan.repairRevisions ?? []), { id: crypto.randomUUID(), createdAt: new Date().toISOString(), slotId: repairPreview.choice.slotId, kind: repairPreview.choice.kind, ...(perishableRisk && { perishableDisposition: 'acknowledged-preservation-risk' as const }), ...(repairPreview.choice.leftoverLotId && { leftoverLotId: repairPreview.choice.leftoverLotId }), ...(repairPreview.choice.adaptationId && { adaptationId: repairPreview.choice.adaptationId }), ...(repairPreview.choice.reason && { reason: repairPreview.choice.reason }), ...(repairPreview.choice.takeoutContext && { takeoutContext: repairPreview.choice.takeoutContext }) }] }), leftoverLots: repairPreview.choice.leftoverLotId ? current.leftoverLots.map((lot) => lot.id === repairPreview.choice.leftoverLotId && lot.dinnerCoverage === 'one' ? { ...lot, active: false } : lot) : current.leftoverLots }))
    setRepairPreview(undefined); setRepairOpen(false); setMessage('Plan repair confirmed.')
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
    const feedback: { dinerId: string; acceptance: 'accepted' | 'rejected' | 'neutral'; neutralReason?: NeutralReason }[] = (feedbackSlot.expectedDinerIds ?? state.household.diners.filter((diner) => diner.active).map((diner) => diner.id)).map((dinerId) => {
      const diner = state.household.diners.find((item) => item.id === dinerId)
      if (!diner) return { dinerId, acceptance: 'neutral' }
      const value = personFeedback[diner.id]
      return value === 'accepted' || value === 'rejected' ? { dinerId, acceptance: value } : { dinerId, acceptance: 'neutral', neutralReason: value ?? 'absent' }
    })
    const revision = [...(feedbackPlan.repairRevisions ?? [])].reverse().find((item) => item.slotId === feedbackSlot.id)
    const effort = activeEffortMinutes === '' ? undefined : Number(activeEffortMinutes)
    const acceptance = householdAcceptance(feedback.map((item) => item.acceptance))
    const outcome = { id: crypto.randomUUID(), planId: feedbackPlan.id, planSlotId: feedbackSlot.id, ...(feedbackSlot.mealId && { mealId: feedbackSlot.mealId }), ...(feedbackSlot.recipeId && { recipeId: feedbackSlot.recipeId }), ...(feedbackCorrectionId && { correctionOfOutcomeId: feedbackCorrectionId }), recordedAt: new Date().toISOString(), ...(feedbackSlot.cookingStartedAt && { cookingStartedAt: feedbackSlot.cookingStartedAt }), ...(feedbackSlot.dinnerReadyAt && { dinnerReadyAt: feedbackSlot.dinnerReadyAt }), ...(effort !== undefined && Number.isInteger(effort) && effort >= 0 && effort <= 10_080 && { activeEffortMinutes: effort }), acceptance, personFeedback: feedback, leftoverCoverage, recoveryClassification: classifyRecovery({ acceptance, repairKind: revision?.kind, takeoutContext: revision?.takeoutContext }) }
    const dependentIds = feedbackPlan.id === currentPlan?.id && leftoverCoverage !== 'one' && leftoverCoverage !== 'more-than-one' ? missingLeftoverDependencies(feedbackPlan, feedbackSlot.id) : []
    update((current) => ({ ...current, outcomes: [...current.outcomes, outcome], leftoverLots: [...current.leftoverLots.map((lot) => feedbackCorrectionId && lot.sourcePlanId === feedbackPlan.id && lot.sourceSlotId === feedbackSlot.id ? { ...lot, active: false } : lot), ...(leftoverCoverage === 'one' || leftoverCoverage === 'more-than-one') && current.leftoverLots.length < 500 ? [{ id: crypto.randomUUID(), sourcePlanId: feedbackPlan.id, sourceSlotId: feedbackSlot.id, ...(feedbackSlot.mealId && { sourceMealId: feedbackSlot.mealId }), dinnerCoverage: leftoverCoverage, active: true }] : []], plans: current.plans.map((plan) => plan.id !== feedbackPlan.id ? plan : { ...plan, slots: plan.slots.map((slot) => slot.id === feedbackSlot.id ? { ...slot, feedbackDismissed: true } : slot) }) }))
    setFeedbackTarget(undefined); setFeedbackCorrectionId(undefined); setPersonFeedback({}); setLeftoverCoverage('none'); setActiveEffortMinutes('')
    if (dependentIds[0]) { setRepairSlotId(dependentIds[0]); setRepairOpen(true); setMessage('Expected leftovers are insufficient. Choose and confirm the smallest repair.') } else setMessage('Dinner feedback recorded.')
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
          <label><input aria-label="Constrained night" type="checkbox" checked={exceptionConstrained} onChange={(event) => setExceptionConstrained(event.target.checked)} /> Constrained night</label>
          <button disabled={state.household.scheduleExceptions.length >= 100}>Add exception</button>
        </form>
        {state.household.scheduleExceptions.length > 0 && <ul>{state.household.scheduleExceptions.map((item) => <li key={item.id}>{item.date}{item.note && `: ${item.note}`}</li>)}</ul>}
      </section>
      <section aria-labelledby="weekly-plan-heading">
        <h2 id="weekly-plan-heading">Weekly plan</h2>
        <p>Meals marked to cover leftovers reduce cooking nights; all other nights stay cooking nights.</p>
        <p className="actions"><label>Week starts<input aria-label="Week starts" type="date" value={planStartDate} onChange={(event) => { setPlanStartDate(event.target.value); setWeeklyPreview(undefined) }} /></label><button onClick={previewWeeklyPlan} disabled={!planStartDate}>Preview weekly plan</button></p>
        {weeklyPreview && <div className="weekly-plan-preview">
          <h3>Weekly plan preview</h3>
          {weeklyPreview.slots.length === 0 ? <p>No eligible household meal is available to plan.</p> : <ol>{weeklyPreview.slots.map((slot, index) => <li key={slot.date}><strong>{slot.date}</strong>: {plannedTakeoutDate === slot.date ? 'Takeout' : state.meals.find((meal) => meal.id === slot.mealId)?.name} {slot.leftoverFrom !== undefined && '(planned leftovers)'} <button onClick={() => setPlannedTakeoutDate(plannedTakeoutDate === slot.date ? undefined : slot.date)} disabled={weeklyPreview.slots.some((item) => item.leftoverFrom === index)}> {plannedTakeoutDate === slot.date ? 'Use planned meal' : `Plan takeout for ${slot.date}`}</button><br /><small>{slot.confidence} · {slot.score} reliability points. {slot.reasons.join(' ')}</small></li>)}</ol>}
          {weeklyPreview.excluded.length > 0 && <p>Excluded: {weeklyPreview.excluded.map((item) => `${state.meals.find((meal) => meal.id === item.mealId)?.name}: ${item.reason}`).join(' ')}</p>}
          {weeklyPreview.optional && <div><p>Optional unfamiliar meal: {state.meals.find((meal) => meal.id === weeklyPreview.optional?.mealId)?.name}. No action keeps proven fallback {state.meals.find((meal) => meal.id === weeklyPreview.optional?.fallbackMealId)?.name}.</p><p className="actions"><button onClick={() => chooseOptionalMeal('use')}>Use this meal</button><button onClick={() => chooseOptionalMeal('adapt')}>Make it work for us</button><button onClick={() => chooseOptionalMeal('reject')}>Not for us</button></p>{optionalAction !== 'fallback' && <p>{optionalAction === 'adapt' && !state.meals.find((meal) => meal.id === weeklyPreview.optional?.mealId)?.adaptations?.length ? 'No saved shared adaptation is available, so the proven fallback remains selected.' : optionalAction === 'reject' ? 'The proven fallback remains selected.' : weeklyPreview.slots.some((slot) => slot.mealId === weeklyPreview.optional?.mealId) ? 'Your chosen unfamiliar meal is in this preview.' : 'That unfamiliar meal cannot fit the first cooking night, so the proven fallback remains selected.'}</p>}</div>}
          <button onClick={confirmWeeklyPlan} disabled={weeklyPreview.slots.length !== 7 || state.plans.length >= 100}>Confirm weekly plan</button>
        </div>}
        {state.plans.filter((plan) => plan.confirmed).map((plan) => <div key={plan.id}><h3>Current weekly plan</h3><ol>{plan.slots.map((slot) => {
          const name = state.meals.find((meal) => meal.id === slot.mealId)?.name ?? 'Takeout'
          const outcome = correctedOutcomes(state.outcomes).find((item) => item.planId === plan.id && item.planSlotId === slot.id)
          return <li key={slot.id}>{slot.date}: {name}{slot.leftoverFromSlotId && ' (planned leftovers)'} {plan.id === currentPlan?.id && !slot.cookingStartedAt && !slot.dinnerReadyAt && <button onClick={() => startCooking(plan.id, slot.id)}>Start cooking {name}</button>} {plan.id === currentPlan?.id && !slot.dinnerReadyAt && <button disabled={!slot.cookingStartedAt} onClick={() => dinnerReady(plan.id, slot.id)}>Dinner’s ready {name}</button>} {slot.dinnerReadyAt && <small> Dinner recorded.</small>} {outcome ? <button onClick={() => openFeedback(plan.id, slot.id, outcome.id)}>Correct feedback</button> : slot.dinnerReadyAt && slot.feedbackEligibleAt && slot.feedbackEligibleAt <= new Date().toISOString() && <button onClick={() => openFeedback(plan.id, slot.id)}>Add feedback</button>}</li>
        })}</ol></div>)}
      </section>
      {feedbackPlan && feedbackSlot && <section aria-labelledby="feedback-heading">
        <h2 id="feedback-heading">Dinner feedback</h2>
        <p>{feedbackMeal?.name ?? 'Dinner'} feedback is saved as raw household and person evidence.</p>
        {(feedbackSlot.expectedDinerIds ?? state.household.diners.filter((diner) => diner.active).map((diner) => diner.id)).flatMap((dinerId) => state.household.diners.filter((diner) => diner.id === dinerId)).map((diner) => <label key={diner.id}>{diner.name}<select aria-label={`Feedback for ${diner.name}`} value={personFeedback[diner.id] ?? 'absent'} onChange={(event) => setPersonFeedback((current) => ({ ...current, [diner.id]: event.target.value as FeedbackChoice }))}><option value="accepted">Ate it</option><option value="rejected">Refused it</option><option value="absent">Absent</option><option value="ate-separately">Ate separately</option><option value="not-hungry">Not hungry</option></select></label>)}
        <label>Active effort minutes<input aria-label="Active effort minutes" type="number" min="0" max="10080" value={activeEffortMinutes} onChange={(event) => setActiveEffortMinutes(event.target.value)} /></label>
        <label>Leftover coverage<select aria-label="Leftover coverage" value={leftoverCoverage} onChange={(event) => setLeftoverCoverage(event.target.value as typeof leftoverCoverage)}><option value="none">None</option><option value="some">Some, not a dinner</option><option value="one">One dinner</option><option value="more-than-one">More than one dinner</option></select></label>
        <p className="actions"><button onClick={submitFeedback}>Save feedback</button><button onClick={() => { setFeedbackTarget(undefined); setFeedbackCorrectionId(undefined); update((current) => ({ ...current, plans: current.plans.map((plan) => plan.id !== feedbackPlan.id ? plan : { ...plan, slots: plan.slots.map((slot) => slot.id === feedbackSlot.id ? { ...slot, feedbackDismissed: true } : slot) }) })) }}>Not now</button></p>
      </section>}
      {currentPlan && groceries && <section aria-labelledby="shopping-heading">
        <h2 id="shopping-heading">Shopping</h2>
        {groceries.incompleteMeals.length > 0 && <p>Shopping list is incomplete: {groceries.incompleteMeals.map((meal) => meal.mealName).join(', ')}.</p>}
        {currentPlan.shopping?.partial && <p>This saved shopping record is partial.</p>}
        {groceries.incompleteMeals.map((meal) => <label key={meal.mealId}><input aria-label={`Ingredients unavailable or skipped for ${meal.mealName}`} type="checkbox" checked={skippedIncompleteMeals.has(meal.mealId)} onChange={(event) => setSkippedIncompleteMeals((current) => { const next = new Set(current); if (event.target.checked) next.add(meal.mealId); else next.delete(meal.mealId); return next })} /> Ingredients unavailable/skipped for {meal.mealName}</label>)}
        <ul>{groceries.items.map((item) => <li key={item.id}><label><input aria-label={`Unavailable ${item.label}`} type="checkbox" checked={unavailableItems.has(item.id)} onChange={(event) => setUnavailableItems((current) => { const next = new Set(current); if (event.target.checked) { next.add(item.id); setSkippedItems((skipped) => { const nextSkipped = new Set(skipped); nextSkipped.delete(item.id); return nextSkipped }) } else next.delete(item.id); return next })} /> {item.label}</label><label><input aria-label={`Skip ${item.label}`} type="checkbox" checked={skippedItems.has(item.id)} onChange={(event) => setSkippedItems((current) => { const next = new Set(current); if (event.target.checked) { next.add(item.id); setUnavailableItems((unavailable) => { const nextUnavailable = new Set(unavailable); nextUnavailable.delete(item.id); return nextUnavailable }) } else next.delete(item.id); return next })} /> Skip</label><label><input aria-label={`Perishable ${item.label}`} type="checkbox" checked={perishableItems.has(item.id)} onChange={(event) => setPerishableItems((current) => { const next = new Set(current); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next })} /> Perishable</label><small> Sources: {item.sourceLines.join('; ')}</small></li>)}</ul>
        <button disabled={groceries.incompleteMeals.some((meal) => !skippedIncompleteMeals.has(meal.mealId))} onClick={() => { if (!window.confirm('Record shopping completion?')) return; update((current) => ({ ...current, plans: current.plans.map((plan) => plan.id !== currentPlan.id ? plan : { ...plan, shopping: { confirmedAt: new Date().toISOString(), partial: groceries.incompleteMeals.length > 0, skippedIncompleteMealIds: [...skippedIncompleteMeals], items: groceries.items.map((item) => ({ id: item.id, label: item.label, sourceLines: item.sourceLines, mealIds: item.mealIds, perishable: perishableItems.has(item.id), availability: unavailableItems.has(item.id) ? 'unavailable' : skippedItems.has(item.id) ? 'skipped' : 'available' })) } }) })); setMessage('Shopping completion recorded.') }}>Shopping done</button>
      </section>}
      {currentPlan && repairTarget && <section aria-labelledby="repair-heading">
        <h2 id="repair-heading">Plan repair</h2>
        <button onClick={() => { setRepairOpen(true); setRepairPreview(undefined) }}>Plans changed</button>
        {repairOpen && <div className="repair-options"><button onClick={() => setRepairPreview(undefined)}>Just show me options</button><p>Choose one whole-household option for {state.meals.find((meal) => meal.id === repairTarget.mealId)?.name}.</p>
          <p className="actions">{repairMeal?.adaptations?.filter((adaptation) => adaptation.solvesIssue && adaptation.coordinatedCooking && adaptation.noSecondEntree && adaptation.noUnplannedProtein && adaptation.noSeparateTimeline && adaptation.noExtraEffort).map((adaptation) => <button key={adaptation.id} onClick={() => showRepair('simpler', repairTarget.mealId, adaptation.recipeId, undefined, undefined, adaptation.id)}>Use {adaptation.name}</button>)}{!repairSlotHasLeftoverLink(repairTarget.id) && currentPlan.slots.filter((slot) => slot.id !== repairTarget.id && slot.mealId && !slot.dinnerReadyAt && !repairSlotHasLeftoverLink(slot.id)).map((slot) => <button key={slot.id} onClick={() => showRepair('swap', undefined, undefined, slot.id)}>Swap with {state.meals.find((meal) => meal.id === slot.mealId)?.name}</button>)}{state.leftoverLots.filter((lot) => lot.active !== false && (lot.dinnerCoverage === 'one' || lot.dinnerCoverage === 'more-than-one') && lot.sourceMealId).map((lot) => <button key={lot.id} onClick={() => showRepair('leftovers', lot.sourceMealId, undefined, undefined, lot.id)}>Use confirmed leftovers</button>)}{repairMeal?.recoveryMealIds?.map((mealId) => <button key={mealId} onClick={() => showRepair('recovery', mealId)}>Use recovery {state.meals.find((meal) => meal.id === mealId)?.name}</button>)}<label>Takeout context<select value={takeoutContext} onChange={(event) => setTakeoutContext(event.target.value as typeof takeoutContext)}><option value="planned">Planned</option><option value="unforeseeable-disruption">Unforeseeable disruption</option><option value="predictable-planning-or-acceptance-failure">Predictable planning or acceptance failure</option></select></label><button onClick={() => showRepair('takeout')}>Choose takeout</button></p>
          {repairPreview && <div><p>Repair preview: {repairPreview.choice.adaptationId ? `${state.meals.find((meal) => meal.id === repairTarget.mealId)?.name} uses ${repairMeal?.adaptations?.find((adaptation) => adaptation.id === repairPreview.choice.adaptationId)?.name}` : `${state.meals.find((meal) => meal.id === repairTarget.mealId)?.name} becomes ${repairPreview.choice.kind === 'takeout' ? 'takeout' : state.meals.find((meal) => meal.id === repairPreview.plan.slots.find((slot) => slot.id === repairTarget.id)?.mealId)?.name}`}. Unaffected days stay unchanged.</p>{repairTarget.mealId !== undefined && !repairPreview.plan.slots.some((slot) => slot.mealId === repairTarget.mealId) && currentPlan.shopping?.items.some((item) => item.availability === 'available' && item.perishable && item.mealIds.includes(repairTarget.mealId ?? '')) && <label><input aria-label="Acknowledge perishable grocery risk" type="checkbox" checked={perishableAcknowledged} onChange={(event) => setPerishableAcknowledged(event.target.checked)} /> I understand this replaces meals with confirmed perishables.</label>}<button onClick={confirmRepair}>Confirm repair</button></div>}
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
              {recipes.map((recipe) => <p key={recipe.id}>Recipe: {recipe.title}</p>)}
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
          <label>Search recipes<input value={candidateQuery} onChange={(event) => setCandidateQuery(event.target.value)} /></label>
          <label>Recipe<select value={selectedCandidate} onChange={(event) => setSelectedCandidate(event.target.value)}>{visibleCandidates.map((candidate) => <option key={candidate.externalId} value={candidate.externalId}>{candidate.title}</option>)}</select></label>
          {chosenCandidate && <p>Preview: {chosenCandidate.title}{chosenCandidate.category && ` — ${chosenCandidate.category}`}{chosenCandidate.ingredients && ` (${chosenCandidate.ingredients.length} ingredients)`}</p>}
          <fieldset><legend>Save destination</legend><label><input type="radio" checked={destination === 'new'} onChange={() => setDestination('new')} /> Add as a new meal</label><label><input type="radio" checked={destination === 'existing'} onChange={() => setDestination('existing')} /> Add as a version of an existing meal</label><label><input type="radio" checked={destination === 'recipe'} onChange={() => setDestination('recipe')} /> Save recipe only</label></fieldset>
          {destination === 'existing' && <label>Existing meal<select value={existingMealId} onChange={(event) => setExistingMealId(event.target.value)}><option value="">Choose a meal</option>{state.meals.map((meal) => <option key={meal.id} value={meal.id}>{meal.name}{meal.name.toLowerCase() === chosenCandidate?.title.toLowerCase() ? ' (title match)' : ''}</option>)}</select></label>}
          <button onClick={saveCandidate} disabled={!chosenCandidate}>Confirm import</button>
          {skipped > 0 && <p>{skipped} recipes were skipped.</p>}
        </div>}
      </section>
    </main>
  )
}
