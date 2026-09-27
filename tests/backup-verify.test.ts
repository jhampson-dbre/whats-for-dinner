// @vitest-environment node
import { createCipheriv, createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ missing: false, queries: [] as { text: string; values: unknown[] }[] }))
vi.mock('node:fs/promises', () => ({
  readFile: async () => {
    if (state.missing) throw new Error('ENOENT: copied archive missing')
    const iv = Buffer.alloc(12)
    const cipher = createCipheriv('aes-256-gcm', Buffer.from('01'.repeat(32), 'hex'), iv)
    const plain = Buffer.from(JSON.stringify({ version: 1, sourceHouseholdId: '11111111-1111-4111-8111-111111111111',
      sourceRevision: 0, count: 0, kinds: {}, chunks: [], effortCount: 0, effortChunks: [],
      recovery: [{ email: 'creator@example.com', role: 'creator' }] }))
    return Buffer.concat([iv, cipher.update(plain), cipher.final(), cipher.getAuthTag()])
  },
  readdir: async () => ['manifest.json.enc'],
}))
vi.mock('pg', () => ({ default: { Client: class {
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
  state.missing = false
  vi.resetModules()
})

async function run(expected: string) {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost/postgres'
  process.env.BACKUP_KEY_HEX = '01'.repeat(32)
  process.env.BACKUP_OPERATOR = 'test'
  process.argv = ['node', 'household-backup.ts', 'verify', 'copied-dir', expected, 'offsite://backup/one']
  await import('../scripts/household-backup.ts')
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
