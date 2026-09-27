import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { appStateV4Schema } from '../src/state/schema'

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
  kind, id: recordId, planId: recordId.optional(), position: z.number().int().min(0).optional(), value: z.unknown(),
}).strict()
const write = z.object({ householdId: uuid, expectedRevision: z.number().int().min(0), idempotencyKey: z.string().min(1).max(128), changes: z.array(change).min(1).max(100) }).strict()
type Change = z.infer<typeof change>
type Row = Change & { seq: number }
const children = new Set<Kind>(['slot', 'shopping-item', 'repair'])
const maxRecordBytes = 32 * 1024
const maxChangesetBytes = 256 * 1024
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
const fail = (status: number) => json({ error: ({ 400: 'Invalid request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not found', 409: 'Revision conflict', 413: 'Payload too large' } as Record<number, string>)[status] ?? 'Server error' }, status)
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8')

function validChange(row: Change): boolean {
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

function validHousehold(rows: Row[]): boolean {
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
      if (!householdId.success || !selected.success || (revision !== null && (!Number.isSafeInteger(revision) || revision < 0)) || !Number.isSafeInteger(after) || after < 0 || (after > 0 && revision === null) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (id !== null && !recordId.safeParse(id).success)) return fail(400)
      const result = await readPage(householdId.data, selected.data, revision, after, limit)
      if (!result) return fail(500)
      if (result.status !== 200) return fail(result.status)
      if (id !== null) {
        // A single record lookup still uses the authorized, revision-pinned read path.
        let page = result
        while (true) {
          const found = page.records?.find((row) => row.id === id)
          if (found) return json({ revision: page.revision, record: found })
          if (page.nextCursor == null) return fail(404)
          page = await readPage(householdId.data, selected.data, result.revision ?? null, page.nextCursor, 100) as RpcResult
          if (!page) return fail(500)
          if (page.status !== 200) return fail(page.status)
        }
      }
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
    const writeParams = { p_household_id: householdId, p_user_id: user.id, p_expected_revision: expectedRevision, p_key: idempotencyKey, p_digest: digest, p_changes: changes }
    const rows: Row[] = []
    for (const selected of kinds) {
      let after = 0
      while (true) {
        const page = await readPage(householdId, selected, expectedRevision, after, 100)
        if (!page) return fail(500)
        if (page.status === 409) {
          // A stale retry can still be a successful replay. The write RPC checks that without applying changes.
          const replay = await db.rpc('write_household_records', writeParams)
          return replay.error ? fail(500) : (replay.data as RpcResult).status === 200
            ? json({ revision: (replay.data as RpcResult).revision }) : fail((replay.data as RpcResult).status)
        }
        if (page.status !== 200) return fail(page.status)
        rows.push(...(page.records ?? []))
        if (page.nextCursor == null) break
        after = page.nextCursor
      }
    }
    let newSeq = Math.max(0, ...rows.map((row) => row.seq))
    for (const row of changes) {
      const index = rows.findIndex((current) => current.kind === row.kind && current.id === row.id)
      if (index < 0) rows.push({ ...row, seq: ++newSeq })
      else rows[index] = { ...row, seq: rows[index].seq }
    }
    if (!validHousehold(rows)) return fail(400)
    const { data, error } = await db.rpc('write_household_records', writeParams)
    if (error) return fail(500)
    const result = data as RpcResult
    return result.status === 200 ? json({ revision: result.revision }) : fail(result.status)
  },
}
