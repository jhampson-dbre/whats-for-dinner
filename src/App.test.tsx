import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
