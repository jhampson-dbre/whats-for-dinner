import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { appStateV4Schema } from '../src/state/schema'
import { mealEligibility } from '../src/domain/mealEligibility'
import { normalizedIngredientLine } from '../src/domain/grocery'

const uuid = z.string().uuid()
const recordId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
const kinds = ['settings', 'meal', 'recipe', 'plan', 'slot', 'shopping-item', 'repair', 'outcome', 'leftover-lot'] as const
type Kind = typeof kinds[number]
const kind = z.enum(kinds)
const root = appStateV4Schema.shape
const plan = root.plans.element
const shopping = plan.shape.shopping.unwrap()
const item = shopping.shape.items.element.extend({ id: recordId })
const schemas = {
  settings: root.household,
  meal: root.meals.element,
  recipe: root.recipes.element,
  plan: plan.omit({ slots: true, shopping: true, repairRevisions: true }).extend({ shopping: shopping.omit({ items: true }).optional() }),
  slot: plan.shape.slots.element,
  'shopping-item': item,
  repair: plan.shape.repairRevisions.unwrap().element,
  outcome: root.outcomes.element,
  'leftover-lot': root.leftoverLots.element,
} as const
const change = z.object({
  kind, id: recordId, planId: recordId.optional(), position: z.number().int().min(0).max(2147483647).optional(), value: z.unknown(),
}).strict()
const write = z.object({ householdId: uuid, expectedRevision: z.number().int().min(0), idempotencyKey: z.string().min(1).max(128), changes: z.array(change).min(1).max(100) }).strict()
type Change = z.infer<typeof change>
type Row = Change & { seq: number }
type Key = { kind: string; id: string }
type Incoming = Key & { sourceKinds: Kind[] }
type Ref = { sourceKind: Kind; sourceId: string; targetKind: string; targetId: string }
const children = new Set<Kind>(['slot', 'shopping-item', 'repair'])
const maxRecordBytes = 32 * 1024
const maxChangesetBytes = 256 * 1024
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
const fail = (status: number) => json({ error: ({ 400: 'Invalid request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not found', 409: 'Revision conflict', 413: 'Payload too large' } as Record<number, string>)[status] ?? 'Server error' }, status)
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8')
const keyOf = ({ kind, id }: Key) => `${kind}:${id}`
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}
const ids = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

export function refs(row: Change): Ref[] {
  const value = object(row.value)
  const found: Ref[] = []
  const add = (targetKind: string, targetId: unknown) => {
    if (typeof targetId === 'string') found.push({ sourceKind: row.kind, sourceId: row.id, targetKind, targetId })
  }
  const many = (targetKind: string, values: unknown) => ids(values).forEach((id) => add(targetKind, id))
  if (row.planId) add('plan', row.planId)
  if (row.kind === 'meal') {
    many('recipe', value.recipeIds); many('meal', value.recoveryMealIds)
    for (const adaptation of (value.adaptations as unknown[] | undefined) ?? []) {
      const entry = object(adaptation)
      add('adaptation', entry.id); add('meal', entry.mealId); add('recipe', entry.recipeId); add('diner', entry.dinerId)
    }
  } else if (row.kind === 'recipe') add('meal', value.mealId)
  else if (row.kind === 'plan') {
    for (const variant of (value.variants as unknown[] | undefined) ?? []) {
      const entry = object(variant)
      add('variant', entry.id); add('meal', entry.mealId); add('recipe', entry.recipeId)
    }
    many('meal', object(value.shopping).skippedIncompleteMealIds)
  } else if (row.kind === 'slot') {
    add('meal', value.mealId); add('recipe', value.recipeId); add('slot', value.leftoverFromSlotId)
    many('leftover-lot', value.leftoverLotIds); many('leftover-lot', value.leftoverDependencyIds)
    if (ids(value.expectedDinerIds).length) add('settings', 'settings')
    many('diner', value.expectedDinerIds)
  } else if (row.kind === 'shopping-item') {
    many('meal', value.mealIds); many('slot', value.sourceSlotIds)
  } else if (row.kind === 'repair') {
    add('slot', value.slotId); add('leftover-lot', value.leftoverLotId); add('adaptation', value.adaptationId)
  } else if (row.kind === 'outcome') {
    add('plan', value.planId); add('slot', value.planSlotId); add('meal', value.mealId)
    add('recipe', value.recipeId); add('outcome', value.correctionOfOutcomeId)
    for (const feedback of (value.personFeedback as unknown[] | undefined) ?? []) add('diner', object(feedback).dinerId)
    if (Array.isArray(value.personFeedback) && value.personFeedback.length) add('settings', 'settings')
  } else if (row.kind === 'leftover-lot') {
    add('plan', value.sourcePlanId); add('slot', value.sourceSlotId); add('meal', value.sourceMealId)
  }
  return [...new Map(found.map((ref) => [`${ref.targetKind}:${ref.targetId}`, ref])).values()]
}

function historyAllowed(old: Row | undefined, next: Change, changes: Change[], loaded: Map<string, Row>): boolean {
  if (next.kind === 'shopping-item' && !old && object(loaded.get(`plan:${next.planId}`)?.value).shopping) return false
  if (!old) return true
  if (children.has(next.kind) && (old.planId !== next.planId || old.position !== next.position)) return false
  if (next.kind === 'outcome' || next.kind === 'repair') return false
  const before = object(old.value)
  const after = object(next.value)
  if (next.kind === 'plan') {
    if (before.shopping && !isDeepStrictEqual(before.shopping, after.shopping)) return false
    if (before.confirmed === true && after.confirmed !== true) return false
    if (before.confirmed === true && !isDeepStrictEqual({ ...before, shopping: undefined }, { ...after, shopping: undefined })) return false
  }
  if (next.kind === 'shopping-item') return false
  if (next.kind === 'leftover-lot' && (!isDeepStrictEqual({ ...before, active: undefined }, { ...after, active: undefined }) || (before.active === false && after.active !== false))) return false
  if (next.kind === 'slot') {
    if (before.feedbackDismissed === true && after.feedbackDismissed !== true) return false
    if (before.cookingStartedAt && !after.cookingStartedAt && !changes.some((row) => row.kind === 'repair' && row.planId === next.planId && object(row.value).slotId === next.id)) return false
    const plan = object(loaded.get(`plan:${next.planId}`)?.value)
    if (plan.confirmed && before.date !== after.date) return false
    const selection = (value: Record<string, unknown>) => [value.mealId, value.recipeId, value.leftoverFromSlotId, value.leftoverLotIds, value.leftoverDependencyIds]
    if (plan.confirmed && !isDeepStrictEqual(selection(before), selection(after))
      && !changes.some((row) => row.kind === 'repair' && row.planId === next.planId && object(row.value).slotId === next.id)) return false
  }
  if (next.kind === 'slot' && before.dinnerReadyAt) {
    if (after.dinnerReadyAt !== before.dinnerReadyAt || after.date !== before.date) return false
    const justDismissed = isDeepStrictEqual({ ...before, feedbackDismissed: after.feedbackDismissed }, after)
    const stable = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([field]) =>
      !['mealId', 'recipeId', 'cookingStartedAt', 'leftoverFromSlotId', 'leftoverLotIds', 'leftoverDependencyIds', 'feedbackDismissed'].includes(field)))
    const correction = !after.mealId && !after.recipeId && !after.cookingStartedAt
      && !after.leftoverFromSlotId && !after.leftoverLotIds && !after.leftoverDependencyIds
      && isDeepStrictEqual(stable(before), stable(after))
      && changes.some((row) => row.kind === 'repair' && row.planId === next.planId && object(row.value).slotId === next.id && object(row.value).kind === 'takeout')
    if (!justDismissed && !correction) return false
  }
  return true
}

export function validChange(row: Change): boolean {
  if (children.has(row.kind) !== Boolean(row.planId) || (children.has(row.kind) !== (row.position !== undefined))) return false
  if (row.kind === 'settings') return row.id === 'settings' && schemas.settings.safeParse(row.value).success
  const parsed = schemas[row.kind].safeParse(row.value)
  return parsed.success && 'id' in parsed.data && parsed.data.id === row.id
}

// Reuse V4's reference and safety rules, while removing its local-file lifetime caps.
const serverPlan = plan.safeExtend({
  repairRevisions: z.array(schemas.repair).optional(),
  shopping: shopping.safeExtend({ items: z.array(item) }).optional(),
})
const serverState = appStateV4Schema.safeExtend({
  meals: z.array(schemas.meal), recipes: z.array(schemas.recipe), plans: z.array(serverPlan),
  leftoverLots: z.array(schemas['leftover-lot']), outcomes: z.array(schemas.outcome),
})

export function validHousehold(rows: Row[]): boolean {
  const byKind = <K extends Kind>(selected: K) => rows.filter((row) => row.kind === selected)
  const settings = byKind('settings')
  if (settings.length > 1 || rows.some((row) => children.has(row.kind) && !rows.some((parent) => parent.kind === 'plan' && parent.id === row.planId))) return false
  const plans = byKind('plan').map((header) => {
    const local = <K extends Kind>(selected: K) => byKind(selected).filter((row) => row.planId === header.id).sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.seq - b.seq)
    const value = header.value as Record<string, unknown>
    return {
      ...value,
      slots: local('slot').map((row) => row.value),
      repairRevisions: local('repair').map((row) => row.value),
      ...(value.shopping ? { shopping: { ...(value.shopping as object), items: local('shopping-item').map((row) => row.value) } } : {}),
    }
  })
  if (byKind('shopping-item').some((row) => !plans.some((value) => (value as Record<string, unknown>).id === row.planId && value.shopping))) return false
  return serverState.safeParse({
    schemaVersion: 4,
    household: settings[0]?.value ?? { diners: [], hardRestrictions: [], scheduleExceptions: [] },
    meals: byKind('meal').map((row) => row.value),
    recipes: byKind('recipe').map((row) => row.value),
    plans, leftoverLots: byKind('leftover-lot').map((row) => row.value),
    outcomes: byKind('outcome').sort((a, b) => a.seq - b.seq).map((row) => row.value),
  }).success
}

function validationRows(rows: Row[], changes: Change[]): Row[] {
  const changed = new Set(changes.map(keyOf))
  const known = new Set(rows.map(keyOf))
  const adaptations = new Set(changes.filter((row) => row.kind === 'repair').flatMap((row) => ids([object(row.value).adaptationId])))
  const filtered = (value: Record<string, unknown>, field: string, target: Kind) =>
    value[field] === undefined ? undefined : ids(value[field]).filter((id) => known.has(`${target}:${id}`))
  const ref = (value: Record<string, unknown>, field: string, target: Kind) =>
    known.has(`${target}:${value[field]}`) ? value[field] : undefined
  return rows.map((row) => {
    if (changed.has(keyOf(row)) || row.kind === 'settings') return row
    const value = object(row.value)
    let shallow: Record<string, unknown> = value
    if (row.kind === 'meal') shallow = { ...value,
      recipeIds: filtered(value, 'recipeIds', 'recipe'), recoveryMealIds: filtered(value, 'recoveryMealIds', 'meal'),
      adaptations: Array.isArray(value.adaptations) ? value.adaptations.filter((entry) => adaptations.has(String(object(entry).id)))
        .map((entry) => { const item = object(entry); return { ...item, mealId: ref(item, 'mealId', 'meal'), recipeId: ref(item, 'recipeId', 'recipe'), dinerId: undefined } }) : undefined,
    }
    else if (row.kind === 'recipe') shallow = { ...value, mealId: ref(value, 'mealId', 'meal') }
    else if (row.kind === 'plan') shallow = { ...value, variants: undefined,
      shopping: value.shopping ? { ...object(value.shopping), skippedIncompleteMealIds: [] } : undefined }
    else if (row.kind === 'slot') shallow = { ...value,
      mealId: ref(value, 'mealId', 'meal'), recipeId: ref(value, 'recipeId', 'recipe'),
      leftoverFromSlotId: ref(value, 'leftoverFromSlotId', 'slot'),
      leftoverLotIds: filtered(value, 'leftoverLotIds', 'leftover-lot'),
      leftoverDependencyIds: filtered(value, 'leftoverDependencyIds', 'leftover-lot'),
    }
    else if (row.kind === 'outcome') shallow = { ...value,
      mealId: ref(value, 'mealId', 'meal'), recipeId: ref(value, 'recipeId', 'recipe'),
      correctionOfOutcomeId: ref(value, 'correctionOfOutcomeId', 'outcome'), personFeedback: undefined,
    }
    else if (row.kind === 'leftover-lot') shallow = { ...value,
      sourcePlanId: ref(value, 'sourcePlanId', 'plan'), sourceSlotId: ref(value, 'sourceSlotId', 'slot'),
      sourceMealId: ref(value, 'sourceMealId', 'meal'),
    }
    return { ...row, value: shallow }
  })
}

type RpcResult = { status: number; revision?: number; records?: Row[]; nextCursor?: number | null }

export default {
  async fetch(request: Request): Promise<Response> {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SECRET_KEY
    if (!url || !key) return fail(500)
    const token = /^Bearer (\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1]
    if (!token) return fail(401)
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
    const { data: { user }, error: authError } = await db.auth.getUser(token)
    if (authError || !user) return fail(401)
    if (!user.email || !user.email_confirmed_at || user.is_anonymous) return fail(403)

    const readPage = async (householdId: string, selected: Kind, revision: number | null, after: number, limit: number): Promise<RpcResult | null> => {
      const { data, error } = await db.rpc('read_household_records', { p_household_id: householdId, p_user_id: user.id, p_kind: selected, p_revision: revision, p_after: after, p_limit: limit })
      return error ? null : data as RpcResult
    }

    if (request.method === 'GET') {
      const params = new URL(request.url).searchParams
      const householdId = uuid.safeParse(params.get('householdId'))
      const selected = kind.safeParse(params.get('kind'))
      const revisionText = params.get('revision')
      const revision = revisionText === null ? null : Number(revisionText)
      const after = Number(params.get('after') ?? 0)
      const limit = Number(params.get('limit') ?? 100)
      const id = params.get('id')
      if (!householdId.success || !selected.success || (revision !== null && (!Number.isSafeInteger(revision) || revision < 0)) || !Number.isSafeInteger(after) || after < 0 || (after > 0 && revision === null) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (id !== null && (!recordId.safeParse(id).success || after > 0))) return fail(400)
      if (id !== null) {
        const { data, error } = await db.rpc('read_household_dependencies', {
          p_household_id: householdId.data, p_user_id: user.id, p_revision: revision,
          p_keys: [{ kind: selected.data, id }], p_incoming: [], p_plan_ids: [], p_after: 0, p_limit: 1,
        })
        if (error) return fail(500)
        const result = data as RpcResult
        if (result.status !== 200) return fail(result.status)
        return result.records?.[0] ? json({ revision: result.revision, record: result.records[0] }) : fail(404)
      }
      const result = await readPage(householdId.data, selected.data, revision, after, limit)
      if (!result) return fail(500)
      if (result.status !== 200) return fail(result.status)
      return json({ revision: result.revision, records: result.records, nextCursor: result.nextCursor })
    }
    if (request.method !== 'POST') return fail(405)
    if (Number(request.headers.get('content-length') ?? 0) > maxChangesetBytes) return fail(413)
    const rawText = await request.text()
    if (Buffer.byteLength(rawText, 'utf8') > maxChangesetBytes) return fail(413)
    let raw: unknown
    try { raw = JSON.parse(rawText) } catch { return fail(400) }
    const parsed = write.safeParse(raw)
    if (!parsed.success) return fail(400)
    const { householdId, expectedRevision, idempotencyKey, changes } = parsed.data
    if (changes.some((row) => bytes(row.value) > maxRecordBytes)) return fail(413)
    if (changes.some((row) => !validChange(row))) return fail(400)
    if (new Set(changes.map((row) => `${row.kind}:${row.id}`)).size !== changes.length) return fail(400)

    const digest = createHash('sha256').update(JSON.stringify({ expectedRevision, changes })).digest('hex')
    const writeParams = { p_household_id: householdId, p_user_id: user.id, p_expected_revision: expectedRevision, p_key: idempotencyKey, p_digest: digest, p_changes: changes, p_refs: changes.flatMap(refs) }
    const loaded = new Map<string, Row>()
    const readAffected = async (keys: Key[], incoming: Incoming[], planIds: string[]): Promise<number> => {
      let after = 0
      while (true) {
        const { data, error } = await db.rpc('read_household_dependencies', {
          p_household_id: householdId, p_user_id: user.id, p_revision: expectedRevision,
          p_keys: keys, p_incoming: incoming, p_plan_ids: planIds, p_after: after, p_limit: 100,
        })
        if (error) return 500
        const page = data as RpcResult
        if (page.status !== 200) return page.status
        for (const row of page.records ?? []) loaded.set(keyOf(row), row)
        if (page.nextCursor == null) return 200
        after = page.nextCursor
      }
    }
    const first = await readAffected(changes.map(({ kind, id }) => ({ kind, id })), [], [])
    if (first === 409) {
      const replay = await db.rpc('write_household_records', writeParams)
      return replay.error ? fail(500) : (replay.data as RpcResult).status === 200
        ? json({ revision: (replay.data as RpcResult).revision }) : fail((replay.data as RpcResult).status)
    }
    if (first !== 200) return fail(first)
    const checked = await db.rpc('check_household_record_changes', {
      p_household_id: householdId, p_user_id: user.id, p_revision: expectedRevision, p_changes: changes,
    })
    if (checked.error) return fail(500)
    if ((checked.data as RpcResult).status !== 200) return fail((checked.data as RpcResult).status)

    const direct = new Map<string, Key>()
    const incoming = new Map<string, Incoming>()
    const planIds = new Set<string>()
    const seenDirect = new Set(changes.map(keyOf))
    const seenIncoming = new Set<string>()
    const seenPlans = new Set<string>()
    const queuedSlots = new Set<string>()
    const queue = (row: Change) => {
      if (row.kind === 'plan') planIds.add(row.id)
      if (row.planId) planIds.add(row.planId)
      if (row.kind === 'plan' || row.kind === 'slot') direct.set('settings:settings', { kind: 'settings', id: 'settings' })
      for (const ref of refs(row)) {
        if (kind.safeParse(ref.targetKind).success) {
          const target = { kind: ref.targetKind, id: ref.targetId }
          if (!seenDirect.has(keyOf(target))) direct.set(keyOf(target), target)
          if (ref.targetKind === 'plan') planIds.add(ref.targetId)
        } else if (ref.targetKind === 'diner') direct.set('settings:settings', { kind: 'settings', id: 'settings' })
        else if (ref.targetKind === 'adaptation') {
          const target = { kind: 'adaptation', id: ref.targetId, sourceKinds: ['meal'] as Kind[] }
          incoming.set(`${target.kind}:${target.id}:meal`, target)
        }
      }
    }
    for (const row of loaded.values()) queue(row)
    for (const row of changes) {
      queue(row)
      if (row.kind === 'recipe') incoming.set(`recipe:${row.id}:meal`, { kind: 'recipe', id: row.id, sourceKinds: ['meal'] })
    }
    while (direct.size || incoming.size || planIds.size) {
      const keys = [...direct.values()].filter((target) => !seenDirect.has(keyOf(target))).slice(0, 100)
      const dependents = [...incoming.entries()].filter(([id]) => !seenIncoming.has(id)).slice(0, 100)
      const plans = [...planIds].filter((id) => !seenPlans.has(id)).slice(0, 100)
      if (!keys.length && !dependents.length && !plans.length) break
      keys.forEach((target) => { seenDirect.add(keyOf(target)); direct.delete(keyOf(target)) })
      dependents.forEach(([id]) => { seenIncoming.add(id); incoming.delete(id) })
      plans.forEach((id) => { seenPlans.add(id); planIds.delete(id) })
      const prior = new Set(loaded.keys())
      const status = await readAffected(keys, dependents.map(([, value]) => value), plans)
      if (status !== 200) return fail(status)
      for (const [id, row] of loaded) if (!prior.has(id) && row.kind === 'slot' && !queuedSlots.has(id)) {
        queuedSlots.add(id)
        queue(row)
      }
    }

    // An existing lot is a direct target, so its source is read explicitly without
    // walking every outgoing reference of every loaded record.
    const lotSources = [...loaded.values()].filter((row) => row.kind === 'leftover-lot').flatMap((row) => {
      const value = object(row.value)
      return [
        ...(typeof value.sourceSlotId === 'string' ? [{ kind: 'slot' as Kind, id: value.sourceSlotId }] : []),
        ...(typeof value.sourcePlanId === 'string' ? [{ kind: 'plan' as Kind, id: value.sourcePlanId }] : []),
      ]
    }).filter((target) => !loaded.has(keyOf(target)))
    if (lotSources.length) {
      const status = await readAffected(lotSources, [], [])
      if (status !== 200) return fail(status)
    }

    if (changes.some((row) => !historyAllowed(loaded.get(keyOf(row)), row, changes, loaded))) return fail(400)

    const rows = [...loaded.values()]
    let newSeq = rows.reduce((maximum, row) => Math.max(maximum, row.seq), 0)
    for (const row of changes) {
      const index = rows.findIndex((current) => current.kind === row.kind && current.id === row.id)
      if (index < 0) rows.push({ ...row, seq: ++newSeq })
      else rows[index] = { ...row, seq: rows[index].seq }
    }
    const current = new Map(rows.map((row) => [keyOf(row), row]))
    if (changes.some((row) => row.kind === 'meal' && ids(object(row.value).recipeIds).some((id) => {
      const owner = object(current.get(`recipe:${id}`)?.value).mealId
      return owner !== undefined && owner !== row.id
    }))) return fail(400)
    if (!validHousehold(validationRows(rows, changes))) return fail(400)

    const newlyConfirmed = new Set(changes.filter((row) => row.kind === 'plan' && object(row.value).confirmed === true
      && object(loaded.get(keyOf(row))?.value).confirmed !== true).map((row) => row.id))
    const selection = (value: Record<string, unknown>) => [value.date, value.mealId, value.recipeId, value.leftoverFromSlotId, value.leftoverLotIds]
    const selected = rows.filter((row) => row.kind === 'slot' && object(current.get(`plan:${row.planId}`)?.value).confirmed === true
      && (newlyConfirmed.has(row.planId!) || changes.some((change) => change.kind === 'slot' && change.id === row.id
        && !isDeepStrictEqual(selection(object(loaded.get(keyOf(row))?.value)), selection(object(row.value))))))
    if (selected.length) {
      const pairs = [...new Map(selected.flatMap((slot) => {
        const value = object(slot.value)
        const recipe = object(current.get(`recipe:${value.recipeId}`)?.value)
        return typeof value.mealId === 'string' ? [[`${slot.planId}:${value.mealId}:${value.recipeId ?? ''}`, {
          planId: slot.planId, mealId: value.mealId, recipeId: value.recipeId,
          ingredientLines: ids(recipe.ingredients).map(normalizedIngredientLine),
        }]] as const : []
      })).values()]
      type Effort = { status: number; totals?: Array<{ planId: string; mealId: string; recipeId?: string; count: string; sum: string; hasRecipe: boolean; unavailable: boolean }>; contributions?: Array<{ outcomeId: string; mealId: string; recipeId?: string; minutes: number; active: boolean }> }
      const facts: NonNullable<Effort['totals']> = []
      const contributions = new Map<string, NonNullable<Effort['contributions']>[number]>()
      for (let index = 0; index < pairs.length; index += 100) {
        const { data: effortData, error: effortError } = await db.rpc('read_household_effort', {
          p_household_id: householdId, p_user_id: user.id, p_revision: expectedRevision, p_pairs: pairs.slice(index, index + 100),
          p_corrections: changes.filter((row) => row.kind === 'outcome').flatMap((row) => ids([object(row.value).correctionOfOutcomeId])),
          p_changes: changes,
        })
        if (effortError) return fail(500)
        const effort = effortData as Effort
        if (effort.status !== 200) return fail(effort.status)
        facts.push(...effort.totals ?? [])
        for (const prior of effort.contributions ?? []) contributions.set(prior.outcomeId, prior)
      }
      const totals = new Map(facts.map((entry) => [`${entry.mealId}:${entry.recipeId ?? ''}`, { count: BigInt(entry.count), sum: BigInt(entry.sum), hasRecipe: entry.hasRecipe }]))
      const unavailable = new Set(facts.filter((entry) => entry.unavailable).map((entry) => `${entry.planId}:${entry.mealId}:${entry.recipeId ?? ''}`))
      const adjust = (mealId: string, recipeId: string | undefined, minutes: number, sign: 1 | -1) => {
        const total = totals.get(`${mealId}:${recipeId ?? ''}`)
        if (total) { total.count += BigInt(sign); total.sum += BigInt(sign * minutes) }
      }
      for (const changed of changes.filter((row) => row.kind === 'outcome')) {
        const value = object(changed.value)
        const prior = contributions.get(String(value.correctionOfOutcomeId))
        if (prior?.active) {
          adjust(prior.mealId, prior.recipeId, prior.minutes, -1)
          prior.active = false
        }
        const source = current.get(`slot:${value.planSlotId}`)
        const sourceValue = object(source?.value)
        if (typeof value.mealId === 'string' && typeof value.activeEffortMinutes === 'number'
          && value.leftoverServing !== true && !sourceValue.leftoverFromSlotId && !ids(sourceValue.leftoverLotIds).length) {
          adjust(value.mealId, typeof value.recipeId === 'string' ? value.recipeId : undefined, value.activeEffortMinutes, 1)
          contributions.set(changed.id, { outcomeId: changed.id, mealId: value.mealId, recipeId: typeof value.recipeId === 'string' ? value.recipeId : undefined, minutes: value.activeEffortMinutes, active: true })
        }
      }
      const settings = object(current.get('settings:settings')?.value)
      const diners = (settings.diners ?? []) as Array<{ id: string; active: boolean }>
      const hardRestrictions = (settings.hardRestrictions ?? []) as Array<{ id: string; dinerId?: string }>
      const exceptions = (settings.scheduleExceptions ?? []) as Array<{ date: string; constrained?: boolean; handsOff?: true }>
      const selectedIds = new Set(selected.map((slot) => slot.id))
      const linkTargets = rows.filter((row) => row.kind === 'slot' && object(row.value).leftoverFromSlotId
        && (selectedIds.has(row.id) || selectedIds.has(String(object(row.value).leftoverFromSlotId))))
      for (const target of linkTargets) {
        const targetValue = object(target.value)
        const source = current.get(`slot:${targetValue.leftoverFromSlotId}`)
        const sourceValue = object(source?.value)
        const sourceMeal = object(current.get(`meal:${sourceValue.mealId}`)?.value)
        const planSlots = rows.filter((row) => row.kind === 'slot' && row.planId === target.planId)
        if (!source || source.planId !== target.planId || sourceValue.mealId !== targetValue.mealId
          || typeof sourceValue.date !== 'string' || sourceValue.date >= String(targetValue.date)
          || sourceValue.leftoverFromSlotId || ids(sourceValue.leftoverLotIds).length || sourceMeal.plannedLeftoverDinner !== true
          || planSlots.filter((row) => object(row.value).leftoverFromSlotId === source.id).length !== 1) return fail(400)
      }
      for (const slot of selected) {
        const value = object(slot.value)
        if (!value.mealId) continue
        const meal = object(current.get(`meal:${value.mealId}`)?.value)
        const recipe = value.recipeId ? object(current.get(`recipe:${value.recipeId}`)?.value) : undefined
        const total = totals.get(`${value.mealId}:${value.recipeId ?? ''}`)
        if (!meal.active || !mealEligibility({ diners, hardRestrictions, safetyReview: meal.safetyReview as 'unknown' | 'approved' | 'rejected' | undefined }).eligible) return fail(400)
        const source = value.leftoverFromSlotId ? current.get(`slot:${value.leftoverFromSlotId}`) : undefined
        const lotIds = ids(value.leftoverLotIds)
        const linked = Boolean(value.leftoverFromSlotId || lotIds.length)
        if (recipe ? recipe.mealId !== value.mealId && !ids(meal.recipeIds).includes(String(value.recipeId))
          : !linked && (ids(meal.recipeIds).length > 0 || total?.hasRecipe)) return fail(400)
        if (!linked && unavailable.has(`${slot.planId}:${value.mealId}:${value.recipeId ?? ''}`)) return fail(400)
        if (linked) {
          if (value.leftoverFromSlotId && !source) return fail(400)
          if (lotIds.length > 1 || lotIds.some((id) => {
            const lot = object(current.get(`leftover-lot:${id}`)?.value)
            const source = current.get(`slot:${lot.sourceSlotId}`)
            const sourceSlot = object(source?.value)
            return lot.active === false || lot.sourceMealId !== value.mealId
              || !['one', 'more-than-one'].includes(String(lot.dinnerCoverage))
              || (lot.sourcePlanId !== undefined && lot.sourcePlanId !== source?.planId)
              || sourceSlot.mealId !== lot.sourceMealId
              || typeof sourceSlot.date !== 'string' || sourceSlot.date >= String(value.date)
          })) return fail(400)
          continue
        }
        const sameDate = exceptions.filter((entry) => entry.date === value.date)
        if (sameDate.some((entry) => entry.handsOff)) {
          if (recipe?.handsOffSlowCooker !== true) return fail(400)
        } else if (sameDate.some((entry) => entry.constrained)) {
          if (!total || (total.count ? total.sum > total.count * 30n : typeof recipe?.prepMinutes !== 'number' || recipe.prepMinutes > 30)) return fail(400)
        }
      }
    }
    const { data, error } = await db.rpc('write_household_records', writeParams)
    if (error) return fail(500)
    const result = data as RpcResult
    return result.status === 200 ? json({ revision: result.revision }) : fail(result.status)
  },
}
