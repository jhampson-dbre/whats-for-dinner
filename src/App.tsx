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

  const commit = (next: AppStateV1) => {
    setSaveStatus(saveAppState(localStorage, next).saved ? 'saved' : 'unsaved')
    dispatch({ type: 'replace', state: next })
  }

  const reset = () => {
    if (window.confirm('Reset all current app data?')) commit(createEmptyAppState())
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
      <p>Start by adding your household and meals in the next step.</p>
      <p aria-live="polite">{saveStatus === 'saved' ? 'Changes saved locally.' : 'Changes are not saved locally.'}</p>
      {message && <p role="status">{message}</p>}
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
