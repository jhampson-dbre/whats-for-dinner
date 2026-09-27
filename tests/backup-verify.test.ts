// @vitest-environment node
import { createCipheriv, createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ missing: false, customArchive: null as null | { manifest: Buffer; records: Buffer; effort?: Buffer }, queries: [] as { text: string; values: unknown[] }[], connections: [] as { connectionString: string }[] }))
vi.mock('node:fs/promises', () => ({
  readFile: async (path: string) => {
    if (state.missing) throw new Error('ENOENT: copied archive missing')
    if (state.customArchive) return path.endsWith('manifest.json.enc') ? state.customArchive.manifest
      : path.includes('effort-') ? state.customArchive.effort : state.customArchive.records
    const iv = Buffer.alloc(12)
    const cipher = createCipheriv('aes-256-gcm', Buffer.from('01'.repeat(32), 'hex'), iv)
    const plain = Buffer.from(JSON.stringify({ version: 1, sourceHouseholdId: '11111111-1111-4111-8111-111111111111',
      sourceRevision: 0, count: 0, kinds: {}, chunks: [], effortCount: 0, effortChunks: [],
      recovery: [{ email: 'creator@example.com', role: 'creator' }] }))
    return Buffer.concat([iv, cipher.update(plain), cipher.final(), cipher.getAuthTag()])
  },
  readdir: async () => state.customArchive ? ['manifest.json.enc', 'records-000001.ndjson.enc', ...(state.customArchive.effort ? ['effort-000001.ndjson.enc'] : [])] : ['manifest.json.enc'],
}))
vi.mock('pg', () => ({ default: { Client: class {
  constructor(config: { connectionString: string }) { state.connections.push(config) }
  async connect() {}
  async end() {}
  async query(text: string, values: unknown[] = []) {
    state.queries.push({ text, values })
    if (text === 'select current_user') return { rows: [{ current_user: 'postgres' }], rowCount: 1 }
    if (text.includes("action='export'")) return { rows: [{ '?column?': 1 }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }
} } }))

const manifest = Buffer.from(JSON.stringify({ version: 1, sourceHouseholdId: '11111111-1111-4111-8111-111111111111',
  sourceRevision: 0, count: 0, kinds: {}, chunks: [], effortCount: 0, effortChunks: [],
  recovery: [{ email: 'creator@example.com', role: 'creator' }] }))
const digest = createHash('sha256').update(manifest).digest('hex')
const original = { argv: process.argv, databaseUrl: process.env.DATABASE_URL, key: process.env.BACKUP_KEY_HEX, operator: process.env.BACKUP_OPERATOR }
afterEach(() => {
  process.argv = original.argv
  process.env.DATABASE_URL = original.databaseUrl
  process.env.BACKUP_KEY_HEX = original.key
  process.env.BACKUP_OPERATOR = original.operator
  state.queries = []
  state.connections = []
  state.missing = false
  state.customArchive = null
  vi.resetModules()
})

async function run(expected: string, databaseUrl = 'postgresql://postgres:postgres@localhost/postgres') {
  process.env.DATABASE_URL = databaseUrl
  process.env.BACKUP_KEY_HEX = '01'.repeat(32)
  process.env.BACKUP_OPERATOR = 'test'
  process.argv = ['node', 'household-backup.ts', 'verify', 'copied-dir', expected, 'offsite://backup/one']
  await import('../scripts/household-backup.ts')
}

function fixture(rows: Array<{ seq: number; kind: string; id: string; planId?: string; position?: number; value: unknown }>, effort: unknown[] = []) {
  const seal = (value: Buffer) => {
    const iv = Buffer.alloc(12)
    const cipher = createCipheriv('aes-256-gcm', Buffer.from('01'.repeat(32), 'hex'), iv)
    return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()])
  }
  const chunk = (file: string, value: unknown[]) => {
    const plain = Buffer.from(value.map((row) => JSON.stringify(row)).join('\n') + '\n')
    return { plain, metadata: { file, count: value.length, bytes: plain.length, sha256: createHash('sha256').update(plain).digest('hex') } }
  }
  const records = chunk('records-000001.ndjson.enc', rows)
  const contributions = effort.length ? chunk('effort-000001.ndjson.enc', effort) : null
  const kinds = Object.fromEntries([...new Set(rows.map((row) => row.kind))].map((kind) => [kind, rows.filter((row) => row.kind === kind).length]))
  const raw = Buffer.from(JSON.stringify({ version: 1, sourceHouseholdId: '11111111-1111-4111-8111-111111111111',
    sourceRevision: 1, count: rows.length, kinds, chunks: [records.metadata],
    effortCount: effort.length, effortChunks: contributions ? [contributions.metadata] : [], recovery: [{ email: 'creator@example.com', role: 'creator' }] }))
  state.customArchive = { manifest: seal(raw), records: seal(records.plain), ...(contributions ? { effort: seal(contributions.plain) } : {}) }
  return createHash('sha256').update(raw).digest('hex')
}

it('refuses a missing or wrong copied archive and audits a matching copy', async () => {
  state.missing = true
  await expect(run(digest)).rejects.toThrow(/ENOENT/)
  expect(state.queries.some((entry) => entry.text.includes('insert into public.household_backup_audit'))).toBe(false)
  vi.resetModules()
  state.missing = false
  await expect(run('f'.repeat(64))).rejects.toThrow(/does not match/)
  expect(state.queries.some((entry) => entry.text.includes('insert into public.household_backup_audit'))).toBe(false)
  vi.resetModules()
  await run(digest)
  const audit = state.queries.find((entry) => entry.text.includes('insert into public.household_backup_audit'))
  expect(audit?.values).toEqual(['verified-copy', '11111111-1111-4111-8111-111111111111', digest, 'test', 'offsite://backup/one'])
})

it('requires certificate-validated TLS outside loopback', async () => {
  await expect(run(digest, 'postgresql://postgres:secret@db.example.com/postgres')).rejects.toThrow(/verify-full/)
  expect(state.connections).toHaveLength(0)
  vi.resetModules()
  await expect(run(digest, 'postgresql://postgres:secret@db.example.com/postgres?sslmode=disable')).rejects.toThrow(/verify-full/)
  expect(state.connections).toHaveLength(0)
  vi.resetModules()
  await run(digest, 'postgresql://postgres:secret@db.example.com/postgres?sslmode=verify-full')
  expect(state.connections).toHaveLength(1)
})

it('rejects a qualifying outcome whose contribution is absent', async () => {
  const rows = [
    { seq: 1, kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Soup', active: true } },
    { seq: 2, kind: 'plan', id: 'p1', value: { id: 'p1', confirmed: true } },
    { seq: 3, kind: 'slot', id: 's1', planId: 'p1', position: 0, value: { id: 's1', date: '2026-09-27', mealId: 'm1' } },
    { seq: 4, kind: 'outcome', id: 'o1', value: { id: 'o1', planId: 'p1', planSlotId: 's1', mealId: 'm1', activeEffortMinutes: 20 } },
  ]
  await expect(run(fixture(rows))).rejects.toThrow(/effort contribution/i)
  expect(state.queries.some((entry) => entry.text.includes('insert into public.household_backup_audit'))).toBe(false)
})

it('keeps corrected effort inactive when its slot later becomes a leftover consumer', async () => {
  const rows = [
    { seq: 1, kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Soup', active: true, plannedLeftoverDinner: true } },
    { seq: 2, kind: 'plan', id: 'p1', value: { id: 'p1' } },
    { seq: 3, kind: 'slot', id: 'source', planId: 'p1', position: 0, value: { id: 'source', date: '2026-09-26', mealId: 'm1' } },
    { seq: 4, kind: 'slot', id: 'consumer', planId: 'p1', position: 1, value: { id: 'consumer', date: '2026-09-27', mealId: 'm1', leftoverFromSlotId: 'source' } },
    { seq: 5, kind: 'outcome', id: 'o1', value: { id: 'o1', planId: 'p1', planSlotId: 'consumer', mealId: 'm1', activeEffortMinutes: 20 } },
    { seq: 6, kind: 'outcome', id: 'o2', value: { id: 'o2', planId: 'p1', planSlotId: 'consumer', mealId: 'm1', correctionOfOutcomeId: 'o1', leftoverServing: true } },
  ]
  await run(fixture(rows, [{ outcomeId: 'o1', mealId: 'm1', recipeId: '', minutes: 20, active: false }]))
  expect(state.queries.some((entry) => entry.text.includes('insert into public.household_backup_audit'))).toBe(true)
})
