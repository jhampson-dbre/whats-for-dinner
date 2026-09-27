import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

const migration = (name: string) => readFile(resolve('supabase/migrations', name), 'utf8')
const household = '31a95af5-89dc-4858-9546-5c039852f63a'
const actor = '11111111-1111-4111-8111-111111111111'

describe('household record migrations', () => {
  it('keeps pages pinned and serializes CAS writes with membership checked on replay', async () => {
    const db = new PGlite()
    try {
      await db.exec('create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users (id uuid primary key)')
      await db.exec(await migration('20260927000000_household_access.sql'))
      await db.exec(await migration('20260927000001_household_records.sql'))
      await db.query('insert into auth.users(id) values ($1)', [actor])
      await db.query('insert into public.households(id) values ($1)', [household])
      await db.query("insert into public.household_memberships(household_id,user_id,email,role) values ($1,$2,'cook@example.com','creator')", [household, actor])

      const changes = [{ kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Pasta', active: true } }]
      const args = [household, actor, 0, 'once', 'a'.repeat(64), JSON.stringify(changes)]
      const write = async (values: unknown[]) => (await db.query<{ result: { status: number; revision: number } }>(
        'select public.write_household_records($1::uuid,$2::uuid,$3::bigint,$4::text,$5::text,$6::jsonb) result', values,
      )).rows[0].result
      const read = async (revision: number | null) => (await db.query<{ result: { status: number; revision?: number; records?: unknown[] } }>(
        "select public.read_household_records($1::uuid,$2::uuid,'meal',$3::bigint,0,100) result", [household, actor, revision],
      )).rows[0].result

      expect(await write(args)).toEqual({ status: 200, revision: 1 })
      expect(await write(args)).toEqual({ status: 200, revision: 1 })
      expect((await write([household, actor, 0, 'once', 'b'.repeat(64), JSON.stringify(changes)])).status).toBe(409)
      expect((await read(1)).records).toHaveLength(1)
      expect((await read(0)).status).toBe(409)
      expect((await write([household, actor, 0, 'different', 'b'.repeat(64), JSON.stringify(changes)])).status).toBe(409)
      const invalidBatch = [
        { kind: 'meal', id: 'm2', value: { id: 'm2', name: 'Soup', active: true } },
        { kind: 'unknown', id: 'm3', value: { id: 'm3' } },
      ]
      expect((await write([household, actor, 1, 'partial', 'c'.repeat(64), JSON.stringify(invalidBatch)])).status).toBe(400)
      expect((await read(1)).records).toHaveLength(1)
      const oversized = [{ kind: 'meal', id: 'large', value: { id: 'large', name: 'x'.repeat(32768), active: true } }]
      expect((await write([household, actor, 1, 'large', 'd'.repeat(64), JSON.stringify(oversized)])).status).toBe(413)
      expect((await read(1)).records).toHaveLength(1)
      expect((await write([household, actor, 1, 'null', 'e'.repeat(64), null])).status).toBe(400)
      expect((await read(1)).records).toHaveLength(1)
      await db.query('delete from public.household_memberships where household_id=$1 and user_id=$2', [household, actor])
      expect((await write(args)).status).toBe(403)
      expect((await read(1)).status).toBe(403)
    } finally {
      await db.close()
    }
  })
})
