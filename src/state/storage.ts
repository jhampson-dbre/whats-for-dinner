import { appStateV1Schema, appStateV2Schema, appStateV3Schema, appStateV4Schema, type AppStateV1, type AppStateV2, type AppStateV3, type AppStateV4 } from './schema'

export const APP_STATE_STORAGE_KEY = 'whats-for-dinner.app-state'

export type LoadResult =
  | { kind: 'ready'; state: AppStateV4; unsaved?: true }
  | { kind: 'recovery'; raw: string; reason: 'malformed' | 'unsupported-version' }

export type SaveResult = { saved: true } | { saved: false; error: Error }

export function createEmptyAppState(): AppStateV4 {
  return {
    schemaVersion: 4,
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

export function migrateV2ToV3(state: AppStateV2): AppStateV3 {
  const validV2 = appStateV2Schema.parse(state)
  const leftoverSlotIds = new Set(validV2.plans.flatMap((plan) => plan.slots.filter((slot) => slot.leftoverFromSlotId || slot.leftoverLotIds?.length).map((slot) => slot.id)))
  return appStateV3Schema.parse({ ...validV2, schemaVersion: 3, outcomes: validV2.outcomes.map((outcome) => outcome.planSlotId && leftoverSlotIds.has(outcome.planSlotId) ? { ...outcome, leftoverServing: true } : outcome) })
}

export function migrateV3ToV4(state: AppStateV3): AppStateV4 {
  return appStateV4Schema.parse({ ...appStateV3Schema.parse(state), schemaVersion: 4 }) as AppStateV4
}

export function loadAppState(storage: Storage): LoadResult {
  const raw = storage.getItem(APP_STATE_STORAGE_KEY)
  if (raw === null) return { kind: 'ready', state: createEmptyAppState() }

  try {
    const parsed: unknown = JSON.parse(raw)
    const v4 = appStateV4Schema.safeParse(parsed)
    if (v4.success) return { kind: 'ready', state: v4.data as AppStateV4 }
    const v3 = appStateV3Schema.safeParse(parsed)
    if (v3.success) {
      const state = migrateV3ToV4(v3.data)
      return saveAppState(storage, state).saved ? { kind: 'ready', state } : { kind: 'ready', state, unsaved: true }
    }
    const v2 = appStateV2Schema.safeParse(parsed)
    if (v2.success) {
      const state = migrateV3ToV4(migrateV2ToV3(v2.data))
      return saveAppState(storage, state).saved ? { kind: 'ready', state } : { kind: 'ready', state, unsaved: true }
    }
    const v1 = appStateV1Schema.safeParse(parsed)
    if (v1.success) {
      const state = migrateV3ToV4(migrateV2ToV3(migrateV1ToV2(v1.data)))
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
        parsed.schemaVersion !== 2 &&
        parsed.schemaVersion !== 3 &&
        parsed.schemaVersion !== 4
          ? 'unsupported-version'
          : 'malformed',
    }
  } catch {
    return { kind: 'recovery', raw, reason: 'malformed' }
  }
}

export function saveAppState(storage: Storage, state: AppStateV4): SaveResult {
  const parsed = appStateV4Schema.safeParse(state)
  if (!parsed.success) return { saved: false, error: new Error('Cannot save invalid app state.') }

  try {
    storage.setItem(APP_STATE_STORAGE_KEY, JSON.stringify(parsed.data))
    return { saved: true }
  } catch (error) {
    return { saved: false, error: error instanceof Error ? error : new Error('Storage write failed.') }
  }
}

export function exportAppState(state: AppStateV4): string {
  return JSON.stringify(appStateV4Schema.parse(state), null, 2)
}

export function importAppState(raw: string): AppStateV4 {
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed === 'object' && parsed !== null && 'schemaVersion' in parsed) {
    if (parsed.schemaVersion === 1) return migrateV3ToV4(migrateV2ToV3(migrateV1ToV2(appStateV1Schema.parse(parsed))))
    if (parsed.schemaVersion === 2) return migrateV3ToV4(migrateV2ToV3(appStateV2Schema.parse(parsed)) )
    if (parsed.schemaVersion === 3) return migrateV3ToV4(appStateV3Schema.parse(parsed))
  }
  return appStateV4Schema.parse(parsed) as AppStateV4
}
