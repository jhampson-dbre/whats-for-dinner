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
import './app.css'

type Action = { type: 'replace'; state: AppStateV1 }

function reducer(_state: AppStateV1, action: Action): AppStateV1 {
  return action.state
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
  const [mealName, setMealName] = useState('')

  const commit = (next: AppStateV1) => {
    setSaveStatus(saveAppState(localStorage, next).saved ? 'saved' : 'unsaved')
    dispatch({ type: 'replace', state: next })
  }

  const reset = () => {
    if (window.confirm('Reset all current app data?')) commit(createEmptyAppState())
  }

  const update = (change: (current: AppStateV1) => AppStateV1) => commit(change(state))
  const addDiner = () => {
    const name = dinerName.trim()
    if (!name) return
    update((current) => ({ ...current, household: { ...current.household, diners: [...current.household.diners, { id: crypto.randomUUID(), name, active: true }] } }))
    setDinerName('')
  }
  const addRestriction = () => {
    const label = restriction.trim()
    if (!label) return
    update((current) => ({ ...current, household: { ...current.household, hardRestrictions: [...current.household.hardRestrictions, { id: crypto.randomUUID(), label, ...(restrictionDinerId && { dinerId: restrictionDinerId }) }] }, meals: current.meals.map((meal) => ({ ...meal, safetyReview: 'unknown' })) }))
    setRestriction('')
    setRestrictionDinerId('')
  }
  const addException = () => {
    if (!exceptionDate) return
    const note = exceptionNote.trim()
    update((current) => ({ ...current, household: { ...current.household, scheduleExceptions: [...current.household.scheduleExceptions, { id: crypto.randomUUID(), date: exceptionDate, ...(note && { note }) }] } }))
    setExceptionDate('')
    setExceptionNote('')
  }
  const addMeal = () => {
    const name = mealName.trim()
    if (!name) return
    update((current) => ({ ...current, meals: [...current.meals, { id: crypto.randomUUID(), name, active: true, safetyReview: 'unknown' }] }))
    setMealName('')
  }

  const onImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    void file.text()
      .then((raw) => {
        try {
          const imported = importAppState(raw)
          if (!window.confirm('Replace all current app data with this backup?')) return
          commit(imported)
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

  return (
    <main className="shell">
      <h1>What’s for dinner?</h1>
      <p>Build a small household meal library to start.</p>
      <p aria-live="polite">{saveStatus === 'saved' ? 'Changes saved locally.' : 'Changes are not saved locally.'}</p>
      {message && <p role="status">{message}</p>}
      <section aria-labelledby="household-heading">
        <h2 id="household-heading">Household</h2>
        <form className="actions" onSubmit={(event) => { event.preventDefault(); addDiner() }}>
          <label>Diner name<input value={dinerName} onChange={(event) => setDinerName(event.target.value)} /></label>
          <button>Add diner</button>
        </form>
        {state.household.diners.length > 0 && <ul>{state.household.diners.map((diner) => <li key={diner.id}>{diner.name}</li>)}</ul>}
        <form className="actions" onSubmit={(event) => { event.preventDefault(); addRestriction() }}>
          <label>Hard restriction<input value={restriction} onChange={(event) => setRestriction(event.target.value)} /></label>
          <label>Applies to<select value={restrictionDinerId} onChange={(event) => setRestrictionDinerId(event.target.value)}><option value="">Everyone</option>{state.household.diners.map((diner) => <option key={diner.id} value={diner.id}>{diner.name}</option>)}</select></label>
          <button>Add restriction</button>
        </form>
        {state.household.hardRestrictions.length > 0 && <ul>{state.household.hardRestrictions.map((item) => <li key={item.id}>{item.label}{item.dinerId && ` — ${state.household.diners.find((diner) => diner.id === item.dinerId)?.name}`}</li>)}</ul>}
        <form className="actions" onSubmit={(event) => { event.preventDefault(); addException() }}>
          <label>Exception date<input type="date" value={exceptionDate} onChange={(event) => setExceptionDate(event.target.value)} /></label>
          <label>Exception note<input value={exceptionNote} onChange={(event) => setExceptionNote(event.target.value)} /></label>
          <button>Add exception</button>
        </form>
        {state.household.scheduleExceptions.length > 0 && <ul>{state.household.scheduleExceptions.map((item) => <li key={item.id}>{item.date}{item.note && `: ${item.note}`}</li>)}</ul>}
      </section>
      <section aria-labelledby="meals-heading">
        <h2 id="meals-heading">Meal library</h2>
        <p>{state.meals.filter((meal) => meal.active).length} selected. For a useful first plan, select 8–12 active meals.</p>
        <form className="actions" onSubmit={(event) => { event.preventDefault(); addMeal() }}>
          <label>Meal name<input value={mealName} onChange={(event) => setMealName(event.target.value)} /></label>
          <button>Add meal</button>
        </form>
        <ul className="meal-list">
          {state.meals.map((meal) => {
            const recipes = state.recipes.filter((recipe) => recipe.mealId === meal.id || meal.recipeIds?.includes(recipe.id))
            const eligibility = mealEligibility({ hardRestrictions: state.household.hardRestrictions, safetyReview: meal.safetyReview })
            return <li key={meal.id}>
              <label>Meal name {meal.name}<input value={meal.name} onChange={(event) => { if (event.target.value.trim()) update((current) => ({ ...current, meals: current.meals.map((currentMeal) => currentMeal.id === meal.id ? { ...currentMeal, name: event.target.value } : currentMeal) })) }} /></label>
              <label><input aria-label={`Active ${meal.name}`} type="checkbox" checked={meal.active} onChange={(event) => update((current) => ({ ...current, meals: current.meals.map((currentMeal) => currentMeal.id === meal.id ? { ...currentMeal, active: event.target.checked } : currentMeal) }))} /> Active</label>
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
    </main>
  )
}
