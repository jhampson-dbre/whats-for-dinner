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
import { readRecipeKeeperZip, type RecipeKeeperCandidate } from './import/recipeKeeper'
import './app.css'

type Action = { type: 'replace'; state: AppStateV1 }

function reducer(_state: AppStateV1, action: Action): AppStateV1 {
  return action.state
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

  const commit = (next: AppStateV1) => {
    setSaveStatus(saveAppState(localStorage, next).saved ? 'saved' : 'unsaved')
    setWeeklyPreview(undefined)
    dispatch({ type: 'replace', state: next })
  }

  const reset = () => {
    if (window.confirm('Reset all current app data?')) commit(createEmptyAppState())
  }

  const update = (change: (current: AppStateV1) => AppStateV1) => commit(change(state))
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
    update((current) => ({ ...current, meals: rejectedMealId ? current.meals.map((meal) => meal.id === rejectedMealId ? { ...meal, active: false } : meal) : current.meals, plans: [...current.plans, {
      id: planId,
      confirmed: true,
      scoreReasons: weeklyPreview.slots.flatMap((slot) => slot.reasons).filter((reason, index, values) => values.indexOf(reason) === index),
      ...(weeklyPreview.optional && { variants: [{ id: crypto.randomUUID(), label: 'Proven fallback for optional unfamiliar meal', mealId: weeklyPreview.optional.fallbackMealId }] }),
      slots: weeklyPreview.slots.map((slot, index) => ({ id: slotIds[index], date: slot.date, mealId: slot.mealId, ...(slot.recipeId && { recipeId: slot.recipeId }), ...(slot.leftoverFrom !== undefined && { leftoverFromSlotId: slotIds[slot.leftoverFrom] }), score: slot.score, confidence: slot.confidence, scoreReasons: slot.reasons })),
    }] }))
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
          commit(sameRestrictions(state.household.hardRestrictions, imported.household.hardRestrictions) ? imported : { ...imported, meals: imported.meals.map((meal) => ({ ...meal, safetyReview: 'unknown' })) })
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
        <p className="actions"><label>Week starts<input aria-label="Week starts" type="date" value={planStartDate} onChange={(event) => setPlanStartDate(event.target.value)} /></label><button onClick={previewWeeklyPlan} disabled={!planStartDate}>Preview weekly plan</button></p>
        {weeklyPreview && <div className="weekly-plan-preview">
          <h3>Weekly plan preview</h3>
          {weeklyPreview.slots.length === 0 ? <p>No eligible household meal is available to plan.</p> : <ol>{weeklyPreview.slots.map((slot) => <li key={slot.date}><strong>{slot.date}</strong>: {state.meals.find((meal) => meal.id === slot.mealId)?.name} {slot.leftoverFrom !== undefined && '(planned leftovers)'}<br /><small>{slot.confidence} · {slot.score} reliability points. {slot.reasons.join(' ')}</small></li>)}</ol>}
          {weeklyPreview.excluded.length > 0 && <p>Excluded: {weeklyPreview.excluded.map((item) => `${state.meals.find((meal) => meal.id === item.mealId)?.name}: ${item.reason}`).join(' ')}</p>}
          {weeklyPreview.optional && <div><p>Optional unfamiliar meal: {state.meals.find((meal) => meal.id === weeklyPreview.optional?.mealId)?.name}. No action keeps proven fallback {state.meals.find((meal) => meal.id === weeklyPreview.optional?.fallbackMealId)?.name}.</p><p className="actions"><button onClick={() => chooseOptionalMeal('use')}>Use this meal</button><button onClick={() => chooseOptionalMeal('adapt')}>Make it work for us</button><button onClick={() => chooseOptionalMeal('reject')}>Not for us</button></p>{optionalAction !== 'fallback' && <p>{optionalAction === 'adapt' && !state.meals.find((meal) => meal.id === weeklyPreview.optional?.mealId)?.adaptations?.length ? 'No saved shared adaptation is available, so the proven fallback remains selected.' : optionalAction === 'reject' ? 'The proven fallback remains selected.' : weeklyPreview.slots.some((slot) => slot.mealId === weeklyPreview.optional?.mealId) ? 'Your chosen unfamiliar meal is in this preview.' : 'That unfamiliar meal cannot fit the first cooking night, so the proven fallback remains selected.'}</p>}</div>}
          <button onClick={confirmWeeklyPlan} disabled={weeklyPreview.slots.length !== 7 || state.plans.length >= 100}>Confirm weekly plan</button>
        </div>}
        {state.plans.filter((plan) => plan.confirmed && plan.slots.length === 7).slice(-1).map((plan) => <div key={plan.id}><h3>Current weekly plan</h3><ol>{plan.slots.map((slot) => <li key={slot.id}>{slot.date}: {state.meals.find((meal) => meal.id === slot.mealId)?.name}{slot.leftoverFromSlotId && ' (planned leftovers)'}</li>)}</ol></div>)}
      </section>
      <section aria-labelledby="meals-heading">
        <h2 id="meals-heading">Meal library</h2>
        <p>{state.meals.filter((meal) => meal.active).length} selected. For a useful first plan, select 8–12 active meals.</p>
        <form className="actions" onSubmit={(event) => { event.preventDefault(); addMeal() }}>
          <label>Meal name<input maxLength={160} value={mealName} onChange={(event) => setMealName(event.target.value)} /></label>
          <label><input aria-label={`Plan one leftover dinner for ${mealName}`} type="checkbox" checked={plannedLeftoverDinner} onChange={(event) => setPlannedLeftoverDinner(event.target.checked)} /> Plan one leftover dinner</label>
          <button disabled={state.meals.length >= 500}>Add meal</button>
        </form>
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
