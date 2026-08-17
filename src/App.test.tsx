import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({
      meals: [{ id: 'new-meal' }],
    })
  })

  it('keeps the current backup when reading an import file fails', async () => {
    localStorage.setItem(APP_STATE_STORAGE_KEY, backup('old-meal'))
    const { container } = render(<App />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(input, { target: { files: [{ text: () => Promise.reject(new Error('read failed')) }] } })

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('That file is not a valid V1 backup.'))
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({
      meals: [{ id: 'old-meal' }],
    })
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

  it('does not preview a plan without a week-start date', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '' } })

    expect(screen.getByRole('button', { name: 'Preview weekly plan' })).toBeDisabled()
  })

  it('keeps the fallback selected when an optional meal cannot fit the first cooking night', () => {
    const state = createEmptyAppState()
    state.household.scheduleExceptions.push({ id: 'late', date: '2026-08-17', constrained: true })
    state.meals.push(
      { id: 'fallback', name: 'Fallback', active: true, safetyReview: 'approved' },
      { id: 'new', name: 'New', active: true, provisional: true, safetyReview: 'approved' },
    )
    state.recipes.push({ id: 'new-recipe', title: 'New', mealId: 'new', prepMinutes: 20, cookMinutes: 30 })
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Week starts'), { target: { value: '2026-08-17' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use this meal' }))

    expect(screen.getByText('That unfamiliar meal cannot fit the first cooking night, so the proven fallback remains selected.')).toBeInTheDocument()
  })

  it('makes a rejected provisional meal inactive when the weekly plan is confirmed', () => {
    const state = createEmptyAppState()
    state.meals.push(
      { id: 'fallback', name: 'Fallback', active: true, safetyReview: 'approved' },
      { id: 'new', name: 'New', active: true, provisional: true, safetyReview: 'approved' },
    )
    localStorage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(state))

    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview weekly plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Not for us' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm weekly plan' }))

    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({ meals: expect.arrayContaining([expect.objectContaining({ id: 'new', active: false })]) })
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
    expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({ meals: [{ id: 'old-meal' }], recipes: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }))

    await waitFor(() => expect(JSON.parse(localStorage.getItem(APP_STATE_STORAGE_KEY) ?? '')).toMatchObject({
      meals: expect.arrayContaining([expect.objectContaining({ name: 'Weeknight Soup', provisional: true, safetyReview: 'unknown' })]),
      recipes: expect.arrayContaining([expect.objectContaining({ title: 'Weeknight Soup', externalId: 'rk-1', source: { provider: 'Recipe Keeper', reference: 'Family notes' } })]),
    }))
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
  })
})
