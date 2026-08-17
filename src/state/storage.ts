import { appStateV1Schema, type AppStateV1 } from './schema'

export const APP_STATE_STORAGE_KEY = 'whats-for-dinner.app-state'

export type LoadResult =
  | { kind: 'ready'; state: AppStateV1 }
  | { kind: 'recovery'; raw: string; reason: 'malformed' | 'unsupported-version' }

export type SaveResult = { saved: true } | { saved: false; error: Error }

export function createEmptyAppState(): AppStateV1 {
  return {
    schemaVersion: 1,
    household: { diners: [], hardRestrictions: [], scheduleExceptions: [] },
    meals: [],
    recipes: [],
    plans: [],
    leftoverLots: [],
    outcomes: [],
  }
}

export function loadAppState(storage: Storage): LoadResult {
  const raw = storage.getItem(APP_STATE_STORAGE_KEY)
  if (raw === null) return { kind: 'ready', state: createEmptyAppState() }

  try {
    const parsed: unknown = JSON.parse(raw)
    const result = appStateV1Schema.safeParse(parsed)
    if (result.success) return { kind: 'ready', state: result.data }
    return {
      kind: 'recovery',
      raw,
      reason:
        typeof parsed === 'object' &&
        parsed !== null &&
        'schemaVersion' in parsed &&
        parsed.schemaVersion !== 1
          ? 'unsupported-version'
          : 'malformed',
    }
  } catch {
    return { kind: 'recovery', raw, reason: 'malformed' }
  }
}

export function saveAppState(storage: Storage, state: AppStateV1): SaveResult {
  const parsed = appStateV1Schema.safeParse(state)
  if (!parsed.success) return { saved: false, error: new Error('Cannot save invalid app state.') }

  try {
    storage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(parsed.data))
    return { saved: true }
  } catch (error) {
    return { saved: false, error: error instanceof Error ? error : new Error('Storage write failed.') }
  }
}

export function exportAppState(state: AppStateV1): string {
  return JSON.stringify(appStateV1Schema.parse(state), null, 2)
}

export function importAppState(raw: string): AppStateV1 {
  return appStateV1Schema.parse(JSON.parse(raw))
}
