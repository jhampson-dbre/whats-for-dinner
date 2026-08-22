import { appStateV1Schema, appStateV2Schema, type AppStateV1, type AppStateV2 } from './schema'

export const APP_STATE_STORAGE_KEY = 'whats-for-dinner.app-state'

export type LoadResult =
  | { kind: 'ready'; state: AppStateV2; unsaved?: true }
  | { kind: 'recovery'; raw: string; reason: 'malformed' | 'unsupported-version' }

export type SaveResult = { saved: true } | { saved: false; error: Error }

export function createEmptyAppState(): AppStateV2 {
  return {
    schemaVersion: 2,
    household: { diners: [], hardRestrictions: [], scheduleExceptions: [] },
    meals: [],
    recipes: [],
    plans: [],
    leftoverLots: [],
    outcomes: [],
  }
}

export function migrateV1ToV2(state: AppStateV1): AppStateV2 {
  const validV1 = appStateV1Schema.parse(state)
  return appStateV2Schema.parse({ ...validV1, schemaVersion: 2, meals: validV1.meals.map((meal) => { const next = { ...meal }; delete next.provisional; return next }) })
}

export function loadAppState(storage: Storage): LoadResult {
  const raw = storage.getItem(APP_STATE_STORAGE_KEY)
  if (raw === null) return { kind: 'ready', state: createEmptyAppState() }

  try {
    const parsed: unknown = JSON.parse(raw)
    const v2 = appStateV2Schema.safeParse(parsed)
    if (v2.success) return { kind: 'ready', state: v2.data }
    const v1 = appStateV1Schema.safeParse(parsed)
    if (v1.success) {
      const state = migrateV1ToV2(v1.data)
      return saveAppState(storage, state).saved ? { kind: 'ready', state } : { kind: 'ready', state, unsaved: true }
    }
    return {
      kind: 'recovery',
      raw,
      reason:
        typeof parsed === 'object' &&
        parsed !== null &&
        'schemaVersion' in parsed &&
        parsed.schemaVersion !== 1 &&
        parsed.schemaVersion !== 2
          ? 'unsupported-version'
          : 'malformed',
    }
  } catch {
    return { kind: 'recovery', raw, reason: 'malformed' }
  }
}

export function saveAppState(storage: Storage, state: AppStateV2): SaveResult {
  const parsed = appStateV2Schema.safeParse(state)
  if (!parsed.success) return { saved: false, error: new Error('Cannot save invalid app state.') }

  try {
    storage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(parsed.data))
    return { saved: true }
  } catch (error) {
    return { saved: false, error: error instanceof Error ? error : new Error('Storage write failed.') }
  }
}

export function exportAppState(state: AppStateV2): string {
  return JSON.stringify(appStateV2Schema.parse(state), null, 2)
}

export function importAppState(raw: string): AppStateV2 {
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed === 'object' && parsed !== null && 'schemaVersion' in parsed && parsed.schemaVersion === 1) return migrateV1ToV2(appStateV1Schema.parse(parsed))
  return appStateV2Schema.parse(parsed)
}
