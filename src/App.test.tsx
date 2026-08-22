import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import recipeFixture from './import/recipeKeeper.fixture.html?raw'
import App from './App'
import { APP_STATE_STORAGE_KEY, createEmptyAppState } from './state/storage'

function backup(mealId: string) {
  const state = createEmptyAppState()
  state.meals.push({ id: mealId, name: 'Tacos', active: true })
  return JSON.stringify(state)
}

function openPlanRepair(planId = 'plan') {
  fireEvent.change(screen.getByLabelText('Plan to repair'), { target: { value: planId } })
  const dates = screen.getByLabelText('Date to repair') as HTMLSelectElement
  fireEvent.change(dates, { target: { value: dates.options[1].value } })
  fireEvent.click(screen.getByRole('button', { name: 'Plans changed' }))
}

function openShopping(planId = 'plan') {
  fireEvent.change(screen.getByLabelText('Plan for shopping'), { target: { value: planId } })
}

describe('backup import', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('replaces the document after confirmation and shows an unsaved write failure', async () => {
    localStorage.setItem(APP_STATE_STORAGE_KEY, backup('old-meal'))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const originalSetItem = Storage.prototype.setItem
    let failWrites = false
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (failWrites) throw new Error('quota exceeded')
      return originalSetItem.call(this, key, value)
    })

    const { container } = render(<App />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [{ text: () => Promise.resolve(backup('new-meal')) }] } })

    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({
      meals: [{ id: 'new-meal' }],
    }))
    expect(screen.getByRole('status')).toHaveTextContent('Backup imported.')

    failWrites = true
    fireEvent.change(input, { target: { files: [{ text: () => Promise.resolve(backup('unsaved-meal')) }] } })

    await waitFor(() => expect(screen.getByText('Changes are not saved locally.')).toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('Loaded but not saved locally.')
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({
      meals: [{ id: 'new-meal' }],
    })
  })

  it('hydrates imported shopping evidence before re-confirming it', async () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, recipeIds: ['tacos-recipe'] }, { id: 'soup', name: 'Soup', active: true })
    state.recipes.push({ id: 'tacos-recipe', title: 'Tacos', mealId: 'tacos', ingredients: ['1 cup tomatoes'] })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'tacos-slot', date: '2026-08-17', mealId: 'tacos', recipeId: 'tacos-recipe' }, { id: 'soup-slot', date: '2026-08-18', mealId: 'soup' }], shopping: { confirmedAt: '2026-08-17T12:00:00.000Z', partial: true, skippedIncompleteMealIds: ['soup'], items: [{ id: 'tacos-slot:0', label: '1 cup tomatoes', sourceLines: ['1 cup tomatoes'], mealIds: ['tacos'], perishable: true, availability: 'unavailable' }] } } as never)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { container } = render(<App />)

    fireEvent.change(container.querySelector('input[accept="application/json"]')!, { target: { files: [{ text: () => Promise.resolve(JSON.stringify(state)) }] } })
    await waitFor(() => expect(screen.getByLabelText('Plan for shopping')).toBeInTheDocument())
    openShopping()
    await waitFor(() => expect(screen.getByLabelText('Unavailable 1 cup tomatoes')).toBeChecked())
    expect(screen.getByLabelText('Perishable 1 cup tomatoes')).toBeChecked()
    expect(screen.getByText('This saved shopping record is partial.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Shopping done' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].shopping).toMatchObject({ partial: true, skippedIncompleteMealIds: ['soup'], items: [{ id: 'tacos-slot:0', perishable: true, availability: 'unavailable' }] })
  })

  it('keeps the current backup when reading an import file fails', async () => {
    localStorage.setItem(APP_STATE_STORAGE_KEY, backup('old-meal'))
    const { container } = render(<App />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(input, { target: { files: [{ text: () => Promise.reject(new Error('read failed')) }] } })

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('That file is not a valid backup.'))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({
      meals: [{ id: 'old-meal' }],
    })
  })

  it('shows migrated V1 data as unsaved when its startup write fails', () => {
    const v1 = { ...createEmptyAppState(), schemaVersion: 1, meals: [{ id: 'old-meal', name: 'Tacos', active: true, provisional: true }] }
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(v1))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded') })

    render(<App />)

    expect(screen.getByText('Changes are not saved locally.')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Tacos')).toBeInTheDocument()
    expect(localStorage.getItem(APP_STATE_STORAGE_KEY)).toBe(JSON.stringify(v1))
  })

  it('keeps recovery visible when resetting malformed data cannot be saved', () => {
    localStorage.setItem(APP_STATE_STORAGE_KEY, '{broken')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota exceeded') })

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Reset saved data' }))

    expect(screen.getByRole('heading', { name: 'Saved data needs recovery' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Could not reset saved data locally.')
  })
})

describe('household onboarding and meal library', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('onboards a diner, a diner restriction, and a schedule exception', () => {
    render(<App />)

    fireEvent.change(screen.getByLabelText('Diner name'), { target: { value: 'Ava' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add diner' }))
    fireEvent.change(screen.getByLabelText('Hard restriction'), { target: { value: 'Peanuts' } })
    fireEvent.change(screen.getByLabelText('Applies to'), { target: { value: screen.getByRole('option', { name: 'Ava' }).getAttribute('value') } })
    fireEvent.click(screen.getByRole('button', { name: 'Add restriction' }))
    fireEvent.change(screen.getByLabelText('Exception date'), { target: { value: '2026-08-20' } })
    fireEvent.change(screen.getByLabelText('Exception note'), { target: { value: 'Late practice' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add exception' }))

    expect(screen.getByText('Peanuts — Ava')).toBeInTheDocument()
    expect(screen.getByText('2026-08-20: Late practice')).toBeInTheDocument()
  })

  it('keeps a name-only meal ineligible with a restriction until compatibility is confirmed, and persists the choice', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Hard restriction'), { target: { value: 'Peanuts' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add restriction' }))
    fireEvent.change(screen.getByLabelText('Meal name'), { target: { value: 'Tacos' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add meal' }))

    expect(screen.getByText('No linked recipe. Grocery ingredients are incomplete.')).toBeInTheDocument()
    expect(screen.getByText('Confirm compatibility before planning.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Safety review for Tacos'), { target: { value: 'approved' } })
    expect(screen.getByText('Eligible to plan.')).toBeInTheDocument()

    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({
      meals: [{ name: 'Tacos', active: true, safetyReview: 'approved' }],
    })
  })

  it('requires a new safety review when a hard restriction changes', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Meal name'), { target: { value: 'Tacos' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add meal' }))
    fireEvent.change(screen.getByLabelText('Safety review for Tacos'), { target: { value: 'approved' } })
    fireEvent.change(screen.getByLabelText('Hard restriction'), { target: { value: 'Peanuts' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add restriction' }))

    expect(screen.getByText('Confirm compatibility before planning.')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({
      meals: [{ name: 'Tacos', safetyReview: 'unknown' }],
    })
  })

  it('shows active-meal count guidance and updates active name-only meals', () => {
    render(<App />)
    expect(screen.getByText('0 selected. For a useful first plan, select 8–12 active meals.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Meal name'), { target: { value: 'Soup' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add meal' }))
    expect(screen.getByText('1 selected. For a useful first plan, select 8–12 active meals.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Meal name Soup'), { target: { value: 'Tomato soup' } })
    fireEvent.click(screen.getByLabelText('Active Tomato soup'))
    expect(screen.getByText('0 selected. For a useful first plan, select 8–12 active meals.')).toBeInTheDocument()
  })

  it('persists whether a meal intentionally covers one leftover dinner', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Meal name'), { target: { value: 'Chili' } })
    fireEvent.click(screen.getByLabelText('Plan one leftover dinner for Chili'))
    fireEvent.click(screen.getByRole('button', { name: 'Add meal' }))

    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({ meals: [{ name: 'Chili', plannedLeftoverDinner: true }] })
    fireEvent.click(screen.getByLabelText('Plan one leftover dinner for Chili'))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').meals[0]).not.toHaveProperty('plannedLeftoverDinner')
  })

  it('does not save a blank inline meal name', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Meal name'), { target: { value: 'Soup' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add meal' }))
    fireEvent.change(screen.getByLabelText('Meal name Soup'), { target: { value: '' } })

    expect(screen.getByText('Changes saved locally.')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({ meals: [{ name: 'Soup' }] })
  })

  it('does not save an overlong inline meal name', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Meal name'), { target: { value: 'Soup' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add meal' }))
    fireEvent.change(screen.getByLabelText('Meal name Soup'), { target: { value: 'x'.repeat(161) } })

    expect(screen.getByText('Changes saved locally.')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({ meals: [{ name: 'Soup' }] })
  })

  it('restores committed onboarding and name-only meals after reload', () => {
    const view = render(<App />)
    fireEvent.change(screen.getByLabelText('Diner name'), { target: { value: 'Ava' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add diner' }))
    fireEvent.change(screen.getByLabelText('Meal name'), { target: { value: 'Tacos' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add meal' }))
    view.unmount()

    render(<App />)
    expect(screen.getByText('Ava', { selector: 'li' })).toBeInTheDocument()
    expect(screen.getByLabelText('Meal name Tacos')).toHaveValue('Tacos')
  })

  it('shows a linked recipe separately and warns when its ingredients are incomplete', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-1', name: 'Soup', active: true, recipeIds: ['recipe-1'] })
    state.recipes.push({ id: 'recipe-1', title: 'Weeknight soup', mealId: 'meal-1' })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    expect(screen.getByText('Recipe: Weeknight soup')).toBeInTheDocument()
    expect(screen.getByText('1 linked recipe. Grocery ingredients are incomplete.')).toBeInTheDocument()
  })

  it('shows ingredient lines for linked recipes without inventing missing ingredients', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-1', name: 'Soup', active: true, recipeIds: ['recipe-1', 'recipe-2'] })
    state.recipes.push(
      { id: 'recipe-1', title: 'Weeknight soup', mealId: 'meal-1', ingredients: ['1 onion', '2 cups broth'] },
      { id: 'recipe-2', title: 'Mystery soup', mealId: 'meal-1' },
    )
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)

    expect(within(screen.getByRole('region', { name: 'Ingredients for Weeknight soup' })).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('1 onion')).toBeInTheDocument()
    expect(screen.getByText('2 cups broth')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Ingredients for Mystery soup' })).not.toBeInTheDocument()
  })

  it('resets imported meal approvals when imported restrictions differ', async () => {
    const current = createEmptyAppState()
    current.household.hardRestrictions.push({ id: 'restriction-current', label: 'Peanuts' })
    current.meals.push({ id: 'meal-current', name: 'Tacos', active: true, safetyReview: 'approved' })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(current))
    const imported = createEmptyAppState()
    imported.household.hardRestrictions.push({ id: 'restriction-imported', label: 'Dairy' })
    imported.meals.push({ id: 'meal-imported', name: 'Pasta', active: true, safetyReview: 'approved' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const { container } = render(<App />)
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [{ text: () => Promise.resolve(JSON.stringify(imported)) }] } })

    await waitFor(() => expect(screen.getByText('Confirm compatibility before planning.')).toBeInTheDocument())
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({
      household: { hardRestrictions: [{ id: 'restriction-imported', label: 'Dairy' }] },
      meals: [{ name: 'Pasta', safetyReview: 'unknown' }],
    })
  })
})

describe('weekly planning', () => {
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('keeps the seven-day preview out of AppStateV1 until confirmation, then restores it', () => {
    const state = createEmptyAppState()
    state.meals.push(
      { id: 'meal-a', name: 'Soup', active: true, safetyReview: 'approved' },
      { id: 'meal-b', name: 'Pasta', active: true, safetyReview: 'approved' },
    )
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    const view = render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-17' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    expect(screen.getByRole('heading', { name: 'Weekly plan preview' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].slots).toHaveLength(7)
    view.unmount()

    render(<App />)
    expect(screen.getByRole('heading', { name: 'Current weekly plan' })).toBeInTheDocument()
    expect(screen.getByText(/2026-08-17: Soup/)).toBeInTheDocument()
  })

  it('clears a weekly preview when a committed household change invalidates it', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-a', name: 'Soup', active: true, safetyReview: 'approved' })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.change(screen.getByLabelText('Hard restriction'), { target: { value: 'Peanuts' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add restriction' }))

    expect(screen.queryByRole('heading', { name: 'Weekly plan preview' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm weekly plan' })).not.toBeInTheDocument()
  })

  it('clears a weekly preview when its week-start date changes', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-a', name: 'Soup', active: true, safetyReview: 'approved' })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    expect(screen.getByRole('heading', { name: 'Weekly plan preview' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-24' } })

    expect(screen.queryByRole('heading', { name: 'Weekly plan preview' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm weekly plan' })).not.toBeInTheDocument()
  })

  it('does not preview a plan without a week-start date', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '' } })

    expect(screen.getByRole('button', { name: 'Preview weekly plan' })).toBeDisabled()
  })

  it('keeps guidance and no-eligible previews transient and non-confirmable', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'only', name: 'Only', active: true, safetyReview: 'approved' })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    const view = render(<App />)

    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    expect(screen.getByText('Add another active compatible meal for a useful first plan.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm weekly plan' })).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans).toHaveLength(0)
    view.unmount()

    state.meals[0].active = false
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    expect(screen.getByText('Activate or confirm a compatible meal, then try again.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Confirm weekly plan' })).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans).toHaveLength(0)
  })

  it('keeps the fallback selected when an optional meal cannot fit the first cooking night', () => {
    const state = createEmptyAppState()
    state.household.scheduleExceptions.push({ id: 'late', date: '2026-08-17', constrained: true })
    state.meals.push(
      { id: 'fallback', name: 'Fallback', active: true, safetyReview: 'approved' },
      { id: 'backup', name: 'Backup', active: true, safetyReview: 'approved' },
      { id: 'new', name: 'New', active: true, provisional: true, safetyReview: 'approved' },
    )
    state.outcomes.push({ id: 'fallback-outcome', mealId: 'fallback', acceptance: 'accepted' })
    state.recipes.push({ id: 'fallback-recipe', title: 'Fallback', mealId: 'fallback', prepMinutes: 10, cookMinutes: 10 }, { id: 'backup-recipe', title: 'Backup', mealId: 'backup', prepMinutes: 10, cookMinutes: 10 }, { id: 'new-recipe', title: 'New', mealId: 'new', prepMinutes: 20, cookMinutes: 30 })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-17' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use this meal' }))

    expect(screen.getByText('Your chosen unfamiliar meal is in this preview.')).toBeInTheDocument()
  })

  it('shows and persists the actual scored fallback when IDs sort differently', () => {
    const state = createEmptyAppState()
    state.household.scheduleExceptions.push({ id: 'late', date: '2026-08-17', constrained: true })
    state.meals.push({ id: 'a-slow', name: 'A slow', active: true, safetyReview: 'approved' }, { id: 'z-quick', name: 'Z quick', active: true, safetyReview: 'approved' }, { id: 'new', name: 'New', active: true, provisional: true, safetyReview: 'approved' })
    state.recipes.push({ id: 'a-recipe', title: 'A slow', mealId: 'a-slow', prepMinutes: 20, cookMinutes: 30 }, { id: 'z-recipe', title: 'Z quick', mealId: 'z-quick', prepMinutes: 10, cookMinutes: 10 }, { id: 'new-recipe', title: 'New', mealId: 'new', prepMinutes: 20, cookMinutes: 30 })
    state.outcomes.push({ id: 'accepted', mealId: 'a-slow', acceptance: 'accepted' })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-17' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    expect(screen.getByText(/No action keeps familiar fallback A slow/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Not for us' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))

    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].variants).toEqual([expect.objectContaining({ mealId: 'a-slow', label: 'Familiar fallback for optional unfamiliar meal' })])
  })

  it('makes a rejected provisional meal inactive when the weekly plan is confirmed', () => {
    const state = createEmptyAppState()
    state.meals.push(
      { id: 'fallback', name: 'Fallback', active: true, safetyReview: 'approved' },
      { id: 'backup', name: 'Backup', active: true, safetyReview: 'approved' },
      { id: 'new', name: 'New', active: true, provisional: true, safetyReview: 'approved' },
    )
    state.outcomes.push({ id: 'fallback-outcome', mealId: 'fallback', acceptance: 'accepted' })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Not for us' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))

    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({ meals: expect.arrayContaining([expect.objectContaining({ id: 'new', active: false })]) })
  })

  it('records user-selected planned takeout as a takeout revision, not a planner meal', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'meal-a', name: 'Soup', active: true, safetyReview: 'approved' }, { id: 'meal-b', name: 'Pasta', active: true, safetyReview: 'approved' })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-17' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan takeout for 2026-08-17' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))
    const plan = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0]
    expect(plan.slots).toContainEqual(expect.not.objectContaining({ mealId: expect.anything() }))
    expect(plan.repairRevisions).toEqual([expect.objectContaining({ kind: 'takeout', takeoutContext: 'planned' })])
  })

  it('keeps multiple user-selected takeout dates in an initial plan', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'approved' }, { id: 'soup', name: 'Soup', active: true, safetyReview: 'approved' })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-17' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan takeout for 2026-08-17' }))
    fireEvent.click(screen.getByRole('button', { name: 'Plan takeout for 2026-08-18' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))

    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].repairRevisions).toEqual([
      expect.objectContaining({ kind: 'takeout', takeoutContext: 'planned' }),
      expect.objectContaining({ kind: 'takeout', takeoutContext: 'planned' }),
    ])
  })

  it('routes an overlapping new plan to an explicitly selected existing plan repair', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'approved' }, { id: 'soup', name: 'Soup', active: true, safetyReview: 'approved' })
    state.plans.push({ id: 'legacy', confirmed: true, slots: [{ id: 'legacy-slot', date: '2026-08-17', mealId: 'tacos' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-17' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))
    openShopping('old')

    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('Repair the overlapping confirmed plan first')
    expect(screen.getByLabelText('Plan to repair')).toHaveValue('legacy')
    expect(screen.getByLabelText('Date to repair')).toHaveValue('legacy-slot')
  })

  it('requires explicit selection when more than one confirmed plan overlaps', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'approved' }, { id: 'soup', name: 'Soup', active: true, safetyReview: 'approved' })
    state.plans.push({ id: 'first', confirmed: true, slots: [{ id: 'first-slot', date: '2026-08-17', mealId: 'tacos' }] }, { id: 'second', confirmed: true, slots: [{ id: 'second-slot', date: '2026-08-17', mealId: 'soup' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-17' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))

    expect(screen.getByRole('status')).toHaveTextContent('Choose the overlapping plan and date explicitly')
    expect(screen.getByLabelText('Plan to repair')).toHaveValue('')
  })

  it('marks review only after a planning-relevant change, not cooking', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'approved' })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'tacos' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Start cooking Tacos' }))
    expect(screen.queryByRole('button', { name: 'Review needed' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Safety review for Tacos'), { target: { value: 'rejected' } })
    expect(screen.getByRole('button', { name: 'Review needed' })).toBeInTheDocument()
  })

  it('does not mark an existing plan for review when confirming a non-overlapping plan', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, safetyReview: 'approved' }, { id: 'soup', name: 'Soup', active: true, safetyReview: 'approved' })
    state.plans.push({ id: 'old', confirmed: true, slots: [{ id: 'old-slot', date: '2026-08-10', mealId: 'tacos' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-17' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))

    expect(screen.queryByRole('button', { name: 'Review needed' })).not.toBeInTheDocument()
  })

  it('confirms a non-adjacent leftover link and protects both ends from takeout', () => {
    const state = createEmptyAppState()
    state.household.scheduleExceptions.push({ id: 'mon', date: '2026-08-17', constrained: true }, { id: 'wed', date: '2026-08-19', constrained: true })
    state.meals.push({ id: 'crockpot', name: 'Crockpot', active: true, safetyReview: 'approved', plannedLeftoverDinner: true }, { id: 'regular', name: 'Regular', active: true, safetyReview: 'approved' })
    state.recipes.push({ id: 'crockpot-r', title: 'Crockpot', mealId: 'crockpot', prepMinutes: 30, cookMinutes: 600 })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-17' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    expect(screen.getByRole('button', { name: 'Plan takeout for 2026-08-17' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Plan takeout for 2026-08-19' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))
    const slots = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].slots
    expect(slots.find((slot: { date: string }) => slot.date === '2026-08-19').leftoverFromSlotId).toBe(slots.find((slot: { date: string }) => slot.date === '2026-08-17').id)
  })

  it('does not carry an old plan incomplete-meal acknowledgement into a new plan', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'soup', name: 'Soup', active: true, safetyReview: 'approved' }, { id: 'pasta', name: 'Pasta', active: true, safetyReview: 'approved' })
    state.plans.push({ id: 'old', confirmed: true, slots: [{ id: 'old-slot', date: '2026-08-10', mealId: 'soup' }], shopping: { confirmedAt: '2026-08-10T00:00:00.000Z', partial: true, skippedIncompleteMealIds: ['soup'], items: [] } } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))
    const plans = screen.getByLabelText('Plan for shopping') as HTMLSelectElement
    openShopping(plans.options[plans.options.length - 1].value)
    expect(screen.getByRole('button', { name: 'Shopping done' })).toBeDisabled()
  })
})

describe('shopping and repair', () => {
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

  it('shows incomplete groceries, records an unavailable item, and applies a selected repair only after confirmation', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, recipeIds: ['tacos-recipe'] }, { id: 'soup', name: 'Soup', active: true, recipeIds: ['soup-recipe'] })
    state.recipes.push({ id: 'tacos-recipe', title: 'Tacos', mealId: 'tacos', ingredients: ['1 cup tomatoes'] }, { id: 'soup-recipe', title: 'Soup', mealId: 'soup' })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'tacos-slot', date: '2026-08-17', mealId: 'tacos', recipeId: 'tacos-recipe' }, { id: 'soup-slot', date: '2026-08-18', mealId: 'soup', recipeId: 'soup-recipe' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)
    openShopping()
    expect(screen.getByText('Shopping list is incomplete: Soup.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Shopping done' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Ingredients unavailable or skipped for Soup'))
    fireEvent.click(screen.getByLabelText('Unavailable 1 cup tomatoes'))
    fireEvent.click(screen.getByRole('button', { name: 'Shopping done' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].shopping).toMatchObject({ partial: true, skippedIncompleteMealIds: ['soup'], items: [{ id: 'tacos-slot:0', label: '1 cup tomatoes', sourceLines: ['1 cup tomatoes'], mealIds: ['tacos'], perishable: false, availability: 'unavailable' }] })
    openPlanRepair()
    fireEvent.click(screen.getByRole('button', { name: 'Swap with Soup' }))
    expect(screen.getByText(/Repair preview: Tacos becomes Soup/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm repair' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].slots[0].mealId).toBe('soup')
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].slots[1].mealId).toBe('tacos')
  })

  it('uses the explicitly selected plan for shopping and invalidates a repair preview on local availability changes', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, recipeIds: ['tacos-r'] }, { id: 'soup', name: 'Soup', active: true, recipeIds: ['soup-r'] })
    state.recipes.push({ id: 'tacos-r', title: 'Tacos', mealId: 'tacos', ingredients: ['1 cup tomatoes'] }, { id: 'soup-r', title: 'Soup', mealId: 'soup', ingredients: ['1 cup beans'] })
    state.plans.push({ id: 'old', confirmed: true, slots: [{ id: 'old-slot', date: '2026-08-17', mealId: 'tacos', recipeId: 'tacos-r' }] }, { id: 'new', confirmed: true, slots: [{ id: 'new-slot', date: '2026-08-18', mealId: 'soup', recipeId: 'soup-r' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)
    openShopping('old')
    fireEvent.click(screen.getByLabelText('Unavailable 1 cup tomatoes'))
    fireEvent.click(screen.getByRole('button', { name: 'Shopping done' }))
    const saved = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')
    expect(saved.plans.find((plan: { id: string }) => plan.id === 'old').shopping.items[0].availability).toBe('unavailable')
    expect(saved.plans.find((plan: { id: string }) => plan.id === 'new').shopping).toBeUndefined()

    openPlanRepair('new')
    fireEvent.click(screen.getByRole('button', { name: 'Choose takeout' }))
    expect(screen.getByRole('button', { name: 'Confirm repair' })).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Unavailable 1 cup tomatoes'))
    expect(screen.queryByRole('button', { name: 'Confirm repair' })).not.toBeInTheDocument()
  })

  it('links a distinct recovery meal and exposes it to plan repair', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true }, { id: 'soup', name: 'Soup', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'tacos-slot', date: '2026-08-17', mealId: 'tacos' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Meal needing recovery'), { target: { value: 'tacos' } })
    fireEvent.change(screen.getByLabelText('Recovery meal'), { target: { value: 'soup' } })
    fireEvent.click(screen.getByRole('button', { name: 'Link recovery meal' }))
    openPlanRepair()
    expect(screen.getByRole('button', { name: 'Use recovery Soup' })).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').meals.find((meal: { id: string }) => meal.id === 'tacos').recoveryMealIds).toEqual(['soup'])
  })

  it('does not add recovery links beyond the meal limit', () => {
    const state = createEmptyAppState()
    const recoveryMealIds = Array.from({ length: 50 }, (_, index) => `recovery-${index}`)
    state.meals.push(
      { id: 'tacos', name: 'Tacos', active: true, recoveryMealIds },
      { id: 'soup', name: 'Soup', active: true },
      ...recoveryMealIds.map((id) => ({ id, name: id, active: true })),
    )
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Meal needing recovery'), { target: { value: 'tacos' } })
    fireEvent.change(screen.getByLabelText('Recovery meal'), { target: { value: 'soup' } })
    expect(screen.getByRole('button', { name: 'Link recovery meal' })).toBeDisabled()

    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').meals.find((meal: { id: string }) => meal.id === 'tacos').recoveryMealIds).toEqual(recoveryMealIds)
  })

  it('hydrates shopping controls from the saved record and keeps their stable item evidence on re-confirmation', async () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, recipeIds: ['tacos-recipe'] })
    state.recipes.push({ id: 'tacos-recipe', title: 'Tacos', mealId: 'tacos', ingredients: ['1 cup tomatoes'] })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'tacos-slot', date: '2026-08-17', mealId: 'tacos', recipeId: 'tacos-recipe' }], shopping: { confirmedAt: '2026-08-17T12:00:00.000Z', partial: false, skippedIncompleteMealIds: [], items: [{ id: 'tacos-slot:0', label: '1 cup tomatoes', sourceLines: ['1 cup tomatoes'], mealIds: ['tacos'], perishable: true, availability: 'unavailable' }] } } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const first = render(<App />)
    openShopping()
    await waitFor(() => expect(screen.getByLabelText('Unavailable 1 cup tomatoes')).toBeChecked())
    expect(screen.getByLabelText('Perishable 1 cup tomatoes')).toBeChecked()
    first.unmount()
    render(<App />)
    openShopping()
    await waitFor(() => expect(screen.getByLabelText('Unavailable 1 cup tomatoes')).toBeChecked())
    fireEvent.click(screen.getByRole('button', { name: 'Shopping done' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].shopping.items).toEqual([{ id: 'tacos-slot:0', label: '1 cup tomatoes', sourceLines: ['1 cup tomatoes'], mealIds: ['tacos'], perishable: true, availability: 'unavailable' }])
  })

  it('hydrates legacy shopping evidence without an item id by matching its saved sources', async () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, recipeIds: ['tacos-recipe'] })
    state.recipes.push({ id: 'tacos-recipe', title: 'Tacos', mealId: 'tacos', ingredients: ['1 cup tomatoes'] })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'tacos-slot', date: '2026-08-17', mealId: 'tacos', recipeId: 'tacos-recipe' }], shopping: { confirmedAt: '2026-08-17T12:00:00.000Z', partial: false, skippedIncompleteMealIds: [], items: [{ label: '1 cup tomatoes', sourceLines: ['1 cup tomatoes'], mealIds: ['tacos'], perishable: true, availability: 'skipped' }] } } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    openShopping()
    await waitFor(() => expect(screen.getByLabelText('Skip 1 cup tomatoes')).toBeChecked())
    expect(screen.getByLabelText('Perishable 1 cup tomatoes')).toBeChecked()
  })

  it('requires acknowledgement before replacing a meal with confirmed perishables', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, recipeIds: ['tacos-recipe'], recoveryMealIds: ['soup'] }, { id: 'soup', name: 'Soup', active: true })
    state.recipes.push({ id: 'tacos-recipe', title: 'Tacos', mealId: 'tacos', ingredients: ['1 cup tomatoes'] })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'tacos-slot', date: '2026-08-17', mealId: 'tacos', recipeId: 'tacos-recipe' }], shopping: { confirmedAt: '2026-08-17T12:00:00.000Z', partial: false, skippedIncompleteMealIds: [], items: [{ id: 'tacos-slot:0', label: '1 cup tomatoes', sourceLines: ['1 cup tomatoes'], mealIds: ['tacos'], perishable: true, availability: 'available' }] } } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)
    openPlanRepair()
    fireEvent.click(screen.getByRole('button', { name: 'Use recovery Soup' }))
    expect(screen.getByLabelText('Acknowledge perishable grocery risk')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm repair' }))
    expect(screen.getByRole('status')).toHaveTextContent('Acknowledge the confirmed perishable groceries')
    expect(confirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('Acknowledge perishable grocery risk'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm repair' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].repairRevisions[0]).toMatchObject({ kind: 'recovery', perishableDisposition: 'acknowledged-preservation-risk' })
  })

  it('omits swaps when either unfinished slot participates in planned leftovers', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true }, { id: 'soup', name: 'Soup', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'tacos-slot', date: '2026-08-17', mealId: 'tacos' }, { id: 'soup-slot', date: '2026-08-18', mealId: 'soup', leftoverFromSlotId: 'tacos-slot' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    openPlanRepair()
    expect(screen.queryByRole('button', { name: 'Swap with Soup' })).not.toBeInTheDocument()
  })

  it('clears a repair preview after another persisted change', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true }, { id: 'soup', name: 'Soup', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'tacos-slot', date: '2026-08-17', mealId: 'tacos' }, { id: 'soup-slot', date: '2026-08-18', mealId: 'soup' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    openPlanRepair()
    fireEvent.click(screen.getByRole('button', { name: 'Swap with Soup' }))
    expect(screen.getByRole('button', { name: 'Confirm repair' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Meal name Tacos'), { target: { value: 'Tacos tonight' } })
    expect(screen.queryByRole('button', { name: 'Confirm repair' })).not.toBeInTheDocument()
  })

  it('consumes a one-dinner leftover lot only when its repair is confirmed', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'tacos-slot', date: '2026-08-17', mealId: 'tacos' }] } as never)
    state.leftoverLots.push({ id: 'lot', sourcePlanId: 'plan', sourceSlotId: 'tacos-slot', sourceMealId: 'tacos', dinnerCoverage: 'one', active: true })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(<App />)
    openPlanRepair()
    fireEvent.click(screen.getByRole('button', { name: 'Use confirmed leftovers' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').leftoverLots[0]).toMatchObject({ active: true })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm repair' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').leftoverLots[0]).toMatchObject({ active: false })
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].repairRevisions).toHaveLength(1)
    openPlanRepair()
    expect(screen.queryByRole('button', { name: 'Use confirmed leftovers' })).not.toBeInTheDocument()
  })
})

describe('Recipe Keeper import', () => {
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

  it('keeps state unchanged until confirmation, then saves a new meal with unknown safety', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    localStorage.setItem(APP_STATE_STORAGE_KEY, backup('old-meal'))
    render(<App />)
    const input = screen.getByLabelText('Recipe Keeper ZIP')
    const bytes = zipSync({ 'recipes.html': strToU8(recipeFixture), 'images/ignored.jpg': strToU8('image') })
    fireEvent.change(input, { target: { files: [{ arrayBuffer: () => Promise.resolve(bytes.buffer) }] } })

    await screen.findByText('Preview: Weeknight Soup — Dinner / Soup (2 ingredients)')
    expect(screen.getByLabelText('New to our household')).not.toBeChecked()
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({ meals: [{ id: 'old-meal' }], recipes: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }))

    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({
      meals: expect.arrayContaining([expect.objectContaining({ name: 'Weeknight Soup', safetyReview: 'unknown' })]),
      recipes: expect.arrayContaining([expect.objectContaining({ title: 'Weeknight Soup', externalId: 'rk-1', source: { provider: 'Recipe Keeper', reference: 'Family notes' } })]),
    }))
  })

  it('marks an opted-in new meal unfamiliar and preserves an existing meal familiarity for recipe versions', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const state = createEmptyAppState()
    state.meals.push({ id: 'familiar', name: 'Existing dinner', active: true, provisional: false })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    render(<App />)
    const bytes = zipSync({ 'recipes.html': strToU8(recipeFixture) })
    const secondBytes = zipSync({ 'recipes.html': strToU8(recipeFixture.replace('rk-1', 'rk-2')) })
    fireEvent.change(screen.getByLabelText('Recipe Keeper ZIP'), { target: { files: [{ arrayBuffer: () => Promise.resolve(secondBytes.buffer) }] } })
    await screen.findByText(/Preview: Weeknight Soup/)
    fireEvent.click(screen.getByLabelText('New to our household'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').meals).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Weeknight Soup', provisional: true })])))

    fireEvent.change(screen.getByLabelText('Recipe Keeper ZIP'), { target: { files: [{ arrayBuffer: () => Promise.resolve(bytes.buffer) }] } })
    await screen.findByText(/Preview: Weeknight Soup/)
    fireEvent.click(screen.getByLabelText('Add as a version of an existing meal'))
    fireEvent.change(screen.getByLabelText('Existing meal'), { target: { value: 'familiar' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').meals).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'familiar', provisional: false, safetyReview: 'unknown' })])))
  })

  it('does not carry the unfamiliar opt-in from one candidate to another', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App />)
    const second = recipeFixture.replace('rk-1', 'rk-2').replace('Weeknight Soup', 'Quick Pasta')
    const bytes = zipSync({ 'recipes.html': strToU8(recipeFixture.replace('</body>', `${second}</body>`)) })
    fireEvent.change(screen.getByLabelText('Recipe Keeper ZIP'), { target: { files: [{ arrayBuffer: () => Promise.resolve(bytes.buffer) }] } })
    await screen.findByText(/Preview: Weeknight Soup/)
    fireEvent.click(screen.getByLabelText('New to our household'))
    fireEvent.change(screen.getByLabelText('Recipe'), { target: { value: 'rk-2' } })
    expect(screen.getByLabelText('New to our household')).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').meals).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Quick Pasta' })])))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').meals.find((meal: { name: string }) => meal.name === 'Quick Pasta')).not.toHaveProperty('provisional')
  })

  it('saves the visible filtered candidate after saving another import', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App />)
    const secondRecipe = recipeFixture
      .replace('rk-1', 'rk-2')
      .replace('Weeknight Soup', 'Hidden Salad')
    const thirdRecipe = recipeFixture
      .replace('rk-1', 'rk-3')
      .replace('Weeknight Soup', 'Quick Pasta')
    const bytes = zipSync({ 'recipes.html': strToU8(recipeFixture.replace('</body>', `${secondRecipe}${thirdRecipe}</body>`)) })
    fireEvent.change(screen.getByLabelText('Recipe Keeper ZIP'), { target: { files: [{ arrayBuffer: () => Promise.resolve(bytes.buffer) }] } })

    await screen.findByText(/Preview: Weeknight Soup/)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }))
    await screen.findByText('Recipe saved. Confirm compatibility before planning.')
    fireEvent.change(screen.getByLabelText('Search recipes'), { target: { value: 'Quick Pasta' } })

    const confirmImport = screen.getByRole('button', { name: 'Confirm import' })
    expect(confirmImport).toBeEnabled()
    fireEvent.click(confirmImport)
    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').recipes).toEqual([
      expect.objectContaining({ title: 'Weeknight Soup', externalId: 'rk-1' }),
      expect.objectContaining({ title: 'Quick Pasta', externalId: 'rk-3' }),
    ]))
  })

  it('does not turn an overlong imported title into an invalid new meal', async () => {
    const { container } = render(<App />)
    const bytes = zipSync({ 'recipes.html': strToU8(recipeFixture.replace('Weeknight Soup', 'x'.repeat(161))) })
    fireEvent.change(screen.getByLabelText('Recipe Keeper ZIP'), { target: { files: [{ arrayBuffer: () => Promise.resolve(bytes.buffer) }] } })

    await screen.findByText(/Preview: x{161}/)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }))

    expect(screen.getByRole('status')).toHaveTextContent('Save recipe only or choose an existing meal; this title is too long for a new meal.')
    expect(container.querySelectorAll('.meal-list li')).toHaveLength(0)
  })

  it('clears candidates and preserves saved state after an importer failure', async () => {
    localStorage.setItem(APP_STATE_STORAGE_KEY, backup('old-meal'))
    render(<App />)
    const input = screen.getByLabelText('Recipe Keeper ZIP')
    fireEvent.change(input, { target: { files: [{ size: 1, arrayBuffer: () => Promise.resolve(zipSync({ 'recipes.html': strToU8(recipeFixture) }).buffer) }] } })
    await screen.findByText(/Preview: Weeknight Soup/)
    fireEvent.change(input, { target: { files: [{ size: 1, arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer) }] } })
    await waitFor(() => expect(screen.queryByText(/Preview: Weeknight Soup/)).not.toBeInTheDocument())
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({ meals: [{ id: 'old-meal' }], recipes: [] })
  })

  it('does not read oversized files and keeps state unchanged when confirmation is cancelled', async () => {
    const read = vi.fn(); localStorage.setItem(APP_STATE_STORAGE_KEY, backup('old-meal'))
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<App />)
    fireEvent.change(screen.getByLabelText('Recipe Keeper ZIP'), { target: { files: [{ size: 32 * 1024 * 1024 + 1, arrayBuffer: read }] } })
    expect(read).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('32 MiB')
    const bytes = zipSync({ 'recipes.html': strToU8(recipeFixture) })
    fireEvent.change(screen.getByLabelText('Recipe Keeper ZIP'), { target: { files: [{ size: bytes.length, arrayBuffer: () => Promise.resolve(bytes.buffer) }] } })
    await screen.findByText(/Preview: Weeknight Soup/)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({ meals: [{ id: 'old-meal' }], recipes: [] })
  })

  it.each([
    ['recipe storage', (state: ReturnType<typeof createEmptyAppState>) => { state.recipes.push(...Array.from({ length: 1000 }, (_, index) => ({ id: `recipe-${index}`, title: 'Saved' }))) }, 'Recipe storage is full'],
    ['meal storage', (state: ReturnType<typeof createEmptyAppState>) => { state.meals.push(...Array.from({ length: 500 }, (_, index) => ({ id: `meal-${index}`, name: 'Saved', active: true }))) }, 'Meal storage is full'],
    ['meal recipe links', (state: ReturnType<typeof createEmptyAppState>) => { const recipeIds = Array.from({ length: 50 }, (_, index) => `recipe-${index}`); state.recipes.push(...recipeIds.map((id) => ({ id, title: 'Saved' }))); state.meals.push({ id: 'meal-1', name: 'Saved', active: true, recipeIds }) }, 'maximum number of recipes'],
  ])('does not dispatch when %s is at capacity', async (_name, prepare, message) => {
    const state = createEmptyAppState(); prepare(state); localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    render(<App />)
    const bytes = zipSync({ 'recipes.html': strToU8(recipeFixture) })
    fireEvent.change(screen.getByLabelText('Recipe Keeper ZIP'), { target: { files: [{ size: bytes.length, arrayBuffer: () => Promise.resolve(bytes.buffer) }] } })
    await screen.findByText(/Preview: Weeknight Soup/)
    if (message === 'maximum number of recipes') {
      fireEvent.click(screen.getByLabelText('Add as a version of an existing meal'))
      fireEvent.change(screen.getByLabelText('Existing meal'), { target: { value: 'meal-1' } })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }))
    expect(screen.getByRole('status')).toHaveTextContent(message)
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toEqual(state)
  }, 10_000)
})

describe('cooking outcomes', () => {
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); vi.useRealTimers() })

  it('persists cooking timestamps and only opens delayed feedback after a reload', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-17T17:00:00.000Z'))
    const state = createEmptyAppState()
    state.household.diners.push({ id: 'ava', name: 'Ava', active: true })
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'tacos' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    const first = render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Start cooking Tacos' }))
    vi.setSystemTime(new Date('2026-08-17T17:25:00.000Z'))
    fireEvent.click(screen.getByRole('button', { name: 'Dinner’s ready Tacos' }))
    expect(screen.queryByRole('heading', { name: 'Dinner feedback' })).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').plans[0].slots[0]).toMatchObject({ cookingStartedAt: '2026-08-17T17:00:00.000Z', dinnerReadyAt: '2026-08-17T17:25:00.000Z', feedbackEligibleAt: '2026-08-17T17:55:00.000Z', expectedDinerIds: ['ava'] })
    first.unmount()
    vi.setSystemTime(new Date('2026-08-17T17:56:00.000Z'))

    render(<App />)
    expect(screen.queryByRole('heading', { name: 'Dinner feedback' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }))
    fireEvent.change(screen.getByLabelText('Feedback for Ava'), { target: { value: 'rejected' } })
    fireEvent.change(screen.getByLabelText('Leftover coverage'), { target: { value: 'some' } })
    fireEvent.change(screen.getByLabelText('Active effort minutes'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').outcomes).toEqual([expect.objectContaining({ acceptance: 'rejected', personFeedback: [{ dinerId: 'ava', acceptance: 'rejected' }], activeEffortMinutes: 12, leftoverCoverage: 'some', recoveryClassification: 'none' })])
    fireEvent.click(screen.getByRole('button', { name: 'Correct feedback' }))
    expect(screen.getByLabelText('Active effort minutes')).toHaveValue(12)
    expect(screen.getByLabelText('Leftover coverage')).toHaveValue('some')
    fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').outcomes).toEqual([expect.any(Object), expect.objectContaining({ correctionOfOutcomeId: expect.any(String), activeEffortMinutes: 12, leftoverCoverage: 'some' })])
  })

  it('reopens dismissed feedback with the dinner-time diner snapshot and preserves the neutral reason', () => {
    const state = createEmptyAppState()
    state.household.diners.push({ id: 'ava', name: 'Ava', active: false })
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'tacos', cookingStartedAt: '2026-08-17T17:00:00.000Z', dinnerReadyAt: '2026-08-17T17:25:00.000Z', feedbackEligibleAt: '2020-01-01T17:55:00.000Z', feedbackDismissed: true, expectedDinerIds: ['ava'] }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }))
    fireEvent.change(screen.getByLabelText('Feedback for Ava'), { target: { value: 'not-hungry' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').outcomes).toEqual([expect.objectContaining({ acceptance: 'neutral', personFeedback: [{ dinerId: 'ava', acceptance: 'neutral', neutralReason: 'not-hungry' }] })])
  })

  it('hides early history feedback and keeps blank active effort unknown', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-17T17:30:00.000Z'))
    const state = createEmptyAppState()
    state.household.diners.push({ id: 'ava', name: 'Ava', active: true })
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'tacos', cookingStartedAt: '2026-08-17T17:00:00.000Z', dinnerReadyAt: '2026-08-17T17:20:00.000Z', feedbackEligibleAt: '2026-08-17T18:00:00.000Z', feedbackDismissed: true, expectedDinerIds: ['ava'] }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    const first = render(<App />)
    expect(screen.queryByRole('button', { name: 'Add feedback' })).not.toBeInTheDocument()
    first.unmount()
    state.plans[0].slots[0].feedbackEligibleAt = '2026-08-17T17:00:00.000Z'
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').outcomes[0]).not.toHaveProperty('activeEffortMinutes')
  })

  it('records a linked leftover dinner without cooking or effort', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-19T18:00:00.000Z'))
    const state = createEmptyAppState()
    state.meals.push({ id: 'soup', name: 'Soup', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'source', date: '2026-08-17', mealId: 'soup' }, { id: 'normal', date: '2026-08-18', mealId: 'soup' }, { id: 'target', date: '2026-08-19', mealId: 'soup', leftoverFromSlotId: 'source' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    const view = render(<App />)
    expect(screen.getAllByRole('button', { name: 'Start cooking Soup' })).toHaveLength(2)
    const ready = screen.getAllByRole('button', { name: 'Dinner’s ready Soup' })
    fireEvent.click(ready[2])
    expect(screen.getByRole('status')).toHaveTextContent('Dinner recorded')
    vi.setSystemTime(new Date('2026-08-19T18:31:00.000Z'))
    view.unmount()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }))
    expect(screen.queryByLabelText('Active effort minutes')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }))
    const outcome = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').outcomes[0]
    expect(outcome).not.toHaveProperty('activeEffortMinutes')
    expect(outcome).not.toHaveProperty('cookingStartedAt')
    expect(outcome).not.toHaveProperty('dinnerReadyAt')
  })

  it('records an actual leftover dinner without showing cooking controls or saving cooking metrics', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-08-19T18:00:00.000Z'))
    const state = createEmptyAppState()
    state.meals.push({ id: 'soup', name: 'Soup', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'source', date: '2026-08-17', mealId: 'soup' }, { id: 'actual', date: '2026-08-19', mealId: 'soup', leftoverLotIds: ['lot'] }] } as never)
    state.leftoverLots.push({ id: 'lot', sourcePlanId: 'plan', sourceSlotId: 'source', sourceMealId: 'soup', dinnerCoverage: 'one', active: true })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    const view = render(<App />)
    expect(screen.getAllByRole('button', { name: 'Start cooking Soup' })).toHaveLength(1)
    fireEvent.click(screen.getAllByRole('button', { name: 'Dinner’s ready Soup' })[1])
    expect(screen.getByRole('status')).toHaveTextContent('Dinner recorded.')
    vi.setSystemTime(new Date('2026-08-19T18:31:00.000Z'))
    view.unmount()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }))
    expect(screen.queryByLabelText('Active effort minutes')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }))
    const outcome = JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').outcomes[0]
    expect(outcome).toMatchObject({ leftoverServing: true })
    expect(outcome).not.toHaveProperty('activeEffortMinutes')
    expect(outcome).not.toHaveProperty('cookingStartedAt')
    expect(outcome).not.toHaveProperty('dinnerReadyAt')
  })

  it('hides recipe-less and same-recipe simpler adaptations', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true, recipeIds: ['tacos-r'], adaptations: [{ id: 'missing', name: 'Missing recipe', solvesIssue: true, coordinatedCooking: true, noSecondEntree: true, noUnplannedProtein: true, noSeparateTimeline: true, noExtraEffort: true }, { id: 'same', name: 'Same recipe', recipeId: 'tacos-r', solvesIssue: true, coordinatedCooking: true, noSecondEntree: true, noUnplannedProtein: true, noSeparateTimeline: true, noExtraEffort: true }] })
    state.recipes.push({ id: 'tacos-r', mealId: 'tacos', title: 'Tacos' })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-19', mealId: 'tacos', recipeId: 'tacos-r' }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    openPlanRepair()
    expect(screen.queryByRole('button', { name: 'Use Missing recipe' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use Same recipe' })).not.toBeInTheDocument()
  })

  it('supersedes a corrected leftover lot instead of leaving two active lots', () => {
    const state = createEmptyAppState()
    state.household.diners.push({ id: 'ava', name: 'Ava', active: true })
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true })
    state.plans.push({ id: 'plan', confirmed: true, slots: [{ id: 'slot', date: '2026-08-17', mealId: 'tacos', cookingStartedAt: '2020-01-01T17:00:00.000Z', dinnerReadyAt: '2020-01-01T17:20:00.000Z', feedbackEligibleAt: '2020-01-01T18:00:00.000Z', feedbackDismissed: true, expectedDinerIds: ['ava'] }] } as never)
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }))
    fireEvent.change(screen.getByLabelText('Leftover coverage'), { target: { value: 'one' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }))
    fireEvent.click(screen.getByRole('button', { name: 'Correct feedback' }))
    fireEvent.change(screen.getByLabelText('Leftover coverage'), { target: { value: 'none' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save feedback' }))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '').leftoverLots).toEqual([expect.objectContaining({ dinnerCoverage: 'one', active: false })])
  })

  it('keeps feedback actions available for older confirmed plans', () => {
    const state = createEmptyAppState()
    state.meals.push({ id: 'tacos', name: 'Tacos', active: true }, { id: 'soup', name: 'Soup', active: true })
    state.plans.push(
      { id: 'old', confirmed: true, slots: [{ id: 'old-slot', date: '2026-08-15', mealId: 'tacos', cookingStartedAt: '2020-01-01T17:00:00.000Z', dinnerReadyAt: '2020-01-01T17:20:00.000Z', feedbackEligibleAt: '2020-01-01T18:00:00.000Z', feedbackDismissed: true }, { id: 'old-cook', date: '2026-08-15', mealId: 'tacos' }] },
      { id: 'middle', confirmed: true, slots: [{ id: 'middle-slot', date: '2026-08-16', mealId: 'tacos', cookingStartedAt: '2020-01-01T17:00:00.000Z', dinnerReadyAt: '2020-01-01T17:20:00.000Z', feedbackEligibleAt: '2020-01-01T18:00:00.000Z' }] },
      { id: 'new', confirmed: true, slots: [{ id: 'new-slot', date: '2026-08-17', mealId: 'soup' }] },
    )
    state.outcomes.push({ id: 'middle-outcome', planId: 'middle', planSlotId: 'middle-slot', mealId: 'tacos', acceptance: 'accepted' })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    expect(screen.getByRole('button', { name: 'Start cooking Tacos' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dinner’s ready Tacos' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Start cooking Soup' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add feedback' }))
    expect(screen.getByRole('heading', { name: 'Dinner feedback' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    fireEvent.click(screen.getByRole('button', { name: 'Correct feedback' }))
    expect(screen.getByRole('heading', { name: 'Dinner feedback' })).toBeInTheDocument()
  })
})
