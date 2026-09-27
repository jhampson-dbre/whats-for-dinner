import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

const migration = (name: string) => readFile(resolve('supabase/migrations', name), 'utf8')
const household = '31a95af5-89dc-4858-9546-5c039852f63a'
const actor = '11111111-1111-4111-8111-111111111111'

describe('household record migrations', () => {
  it('guards actual-lot timing and single-lot selection in direct CAS writes', async () => {
    const db = new PGlite()
    try {
      await db.exec('create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users (id uuid primary key)')
      await db.exec(await migration('20260927000000_household_access.sql'))
      await db.exec(await migration('20260927000001_household_records.sql'))
      await db.query('insert into auth.users(id) values ($1)', [actor])
      await db.query('insert into public.households(id) values ($1)', [household])
      await db.query("insert into public.household_memberships(household_id,user_id,email,role) values ($1,$2,'cook@example.com','creator')", [household, actor])
      await db.query(`insert into public.household_records(household_id,kind,record_id,value) values
        ($1,'meal','m1','{"id":"m1","name":"Pasta","active":true}'::jsonb),
        ($1,'plan','source_plan','{"id":"source_plan"}'::jsonb),
        ($1,'leftover-lot','lot1','{"id":"lot1","sourcePlanId":"source_plan","sourceSlotId":"source_slot","sourceMealId":"m1","dinnerCoverage":"one"}'::jsonb),
        ($1,'leftover-lot','lot2','{"id":"lot2","sourcePlanId":"source_plan","sourceSlotId":"source_slot","sourceMealId":"m1","dinnerCoverage":"one"}'::jsonb)`, [household])
      await db.query(`insert into public.household_records(household_id,kind,record_id,plan_id,position,value)
        values ($1,'slot','source_slot','source_plan',0,'{"id":"source_slot","date":"2026-09-27","mealId":"m1"}'::jsonb)`, [household])
      await db.query(`insert into public.household_record_refs(household_id,source_kind,source_id,target_kind,target_id) values
        ($1,'leftover-lot','lot1','slot','source_slot'),
        ($1,'leftover-lot','lot2','slot','source_slot')`, [household])
      const write = async (changes: unknown[], revision: number, key: string) => (await db.query<{ result: { status: number; revision?: number } }>(
        'select public.write_household_records($1::uuid,$2::uuid,$3::bigint,$4,$5,$6::jsonb,$7::jsonb) result',
        [household, actor, revision, key, 'a'.repeat(64), JSON.stringify(changes), '[]'],
      )).rows[0].result
      const selection = (date: string, lots: string[]) => [
        { kind: 'plan', id: 'target_plan', value: { id: 'target_plan', confirmed: true } },
        { kind: 'slot', id: 'target_slot', planId: 'target_plan', position: 0, value: { id: 'target_slot', date, mealId: 'm1', leftoverLotIds: lots } },
      ]
      expect((await write(selection('2026-09-26', ['lot1']), 0, 'before-source')).status).toBe(400)
      expect((await write(selection('2026-09-27', ['lot1']), 0, 'same-date')).status).toBe(400)
      expect((await write(selection('2026-09-28', ['lot1', 'lot2']), 0, 'two-lots')).status).toBe(400)
      const wrongSourcePlan = [{ kind: 'leftover-lot', id: 'lot1', value: { id: 'lot1', sourcePlanId: 'other_plan', sourceSlotId: 'source_slot', sourceMealId: 'm1', dinnerCoverage: 'one' } }, ...selection('2026-09-28', ['lot1'])]
      expect((await write(wrongSourcePlan, 0, 'wrong-source-plan')).status).toBe(400)
      const movedSource = [{ kind: 'slot', id: 'source_slot', planId: 'source_plan', position: 0, value: { id: 'source_slot', date: '2026-09-29', mealId: 'm1' } }, ...selection('2026-09-28', ['lot1'])]
      expect((await write(movedSource, 0, 'moved-source')).status).toBe(400)
      expect(await write(selection('2026-09-28', ['lot1']), 0, 'later-source')).toEqual({ status: 200, revision: 1 })
      const movedAfterSelection = { kind: 'slot', id: 'source_slot', planId: 'source_plan', position: 0, value: { id: 'source_slot', date: '2026-09-28', mealId: 'm1' } }
      expect((await write([movedAfterSelection], 1, 'move-existing-source')).status).toBe(400)
      const releasedTarget = { kind: 'slot', id: 'target_slot', planId: 'target_plan', position: 0, value: { id: 'target_slot', date: '2026-09-28', mealId: 'm1' } }
      const check = async (changes: unknown[]) => (await db.query<{ result: { status: number } }>(
        'select public.check_household_record_changes($1::uuid,$2::uuid,$3::bigint,$4::jsonb) result',
        [household, actor, 1, JSON.stringify(changes)],
      )).rows[0].result
      const outcome = (slotId: string, extra: Record<string, unknown>) => [{ kind: 'outcome', id: 'effort_guard',
        value: { id: 'effort_guard', planId: slotId === 'target_slot' ? 'target_plan' : 'source_plan', planSlotId: slotId, mealId: 'm1', ...extra } }]
      expect((await check(outcome('target_slot', {}))).status).toBe(400)
      expect((await check(outcome('target_slot', { leftoverServing: true, activeEffortMinutes: 20 }))).status).toBe(400)
      expect((await check(outcome('target_slot', { leftoverServing: true }))).status).toBe(200)
      expect((await check(outcome('source_slot', { leftoverServing: true }))).status).toBe(400)
      expect((await check([releasedTarget])).status).toBe(200)
      expect((await check([movedAfterSelection, releasedTarget])).status).toBe(200)
      await db.query(`insert into public.household_records(household_id,kind,record_id,value)
        values ($1,'plan','pending_plan','{"id":"pending_plan"}'::jsonb)`, [household])
      await db.query(`insert into public.household_records(household_id,kind,record_id,plan_id,position,value)
        values ($1,'slot','pending_slot','pending_plan',0,'{"id":"pending_slot","date":"2026-09-27","mealId":"m1","leftoverLotIds":["lot2"]}'::jsonb)`, [household])
      expect((await write([{ kind: 'plan', id: 'pending_plan', value: { id: 'pending_plan', confirmed: true } }], 1, 'confirm-existing')).status).toBe(400)
    } finally {
      await db.close()
    }
  })

  it('rejects assigning a listed recipe to another meal in the CAS write', async () => {
    const db = new PGlite()
    try {
      await db.exec('create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users (id uuid primary key)')
      await db.exec(await migration('20260927000000_household_access.sql'))
      await db.exec(await migration('20260927000001_household_records.sql'))
      await db.query('insert into auth.users(id) values ($1)', [actor])
      await db.query('insert into public.households(id) values ($1)', [household])
      await db.query("insert into public.household_memberships(household_id,user_id,email,role) values ($1,$2,'cook@example.com','creator')", [household, actor])
      await db.query(`insert into public.household_records(household_id,kind,record_id,value) values
        ($1,'meal','m1','{"id":"m1","name":"Owner","active":true,"recipeIds":["r1"]}'::jsonb),
        ($1,'meal','m2','{"id":"m2","name":"Other","active":true}'::jsonb),
        ($1,'recipe','r1','{"id":"r1","title":"Soup"}'::jsonb),
        ($1,'recipe','r2','{"id":"r2","title":"Other soup","mealId":"m2"}'::jsonb)`, [household])
      await db.query(`insert into public.household_record_refs(household_id,source_kind,source_id,target_kind,target_id)
        values ($1,'meal','m1','recipe','r1')`, [household])
      const changes = [{ kind: 'recipe', id: 'r1', value: { id: 'r1', title: 'Soup', mealId: 'm2' } }]
      const result = (await db.query<{ result: { status: number } }>(
        'select public.write_household_records($1::uuid,$2::uuid,0,$3,$4,$5::jsonb,$6::jsonb) result',
        [household, actor, 'dual-owner', 'a'.repeat(64), JSON.stringify(changes), '[]'],
      )).rows[0].result
      expect(result.status).toBe(400)
      const reverse = [{ kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Owner', active: true, recipeIds: ['r1', 'r2'] } }]
      const reverseResult = (await db.query<{ result: { status: number } }>(
        'select public.write_household_records($1::uuid,$2::uuid,0,$3,$4,$5::jsonb,$6::jsonb) result',
        [household, actor, 'reverse-owner', 'b'.repeat(64), JSON.stringify(reverse), '[]'],
      )).rows[0].result
      expect(reverseResult.status).toBe(400)
      const transfer = [
        { kind: 'meal', id: 'm1', value: { id: 'm1', name: 'Owner', active: true, recipeIds: [] } },
        { kind: 'recipe', id: 'r1', value: { id: 'r1', title: 'Soup', mealId: 'm2' } },
      ]
      const transferResult = (await db.query<{ result: { status: number; revision: number } }>(
        'select public.write_household_records($1::uuid,$2::uuid,0,$3,$4,$5::jsonb,$6::jsonb) result',
        [household, actor, 'transfer-owner', 'c'.repeat(64), JSON.stringify(transfer), '[]'],
      )).rows[0].result
      expect(transferResult).toEqual({ status: 200, revision: 1 })
      const noRefs = [
        { kind: 'meal', id: 'm3', value: { id: 'm3', name: 'Direct owner', active: true, recipeIds: ['r3'] } },
        { kind: 'recipe', id: 'r3', value: { id: 'r3', title: 'Direct recipe' } },
      ]
      const bootstrap = (await db.query<{ result: { status: number; revision: number } }>(
        'select public.write_household_records($1::uuid,$2::uuid,1,$3,$4,$5::jsonb,$6::jsonb) result',
        [household, actor, 'direct-owner', 'd'.repeat(64), JSON.stringify(noRefs), '[]'],
      )).rows[0].result
      expect(bootstrap).toEqual({ status: 200, revision: 2 })
      const bypass = [{ kind: 'recipe', id: 'r3', value: { id: 'r3', title: 'Direct recipe', mealId: 'm2' } }]
      const bypassResult = (await db.query<{ result: { status: number } }>(
        'select public.write_household_records($1::uuid,$2::uuid,2,$3,$4,$5::jsonb,$6::jsonb) result',
        [household, actor, 'direct-dual-owner', 'e'.repeat(64), JSON.stringify(bypass), '[]'],
      )).rows[0].result
      expect(bypassResult.status).toBe(400)
    } finally {
      await db.close()
    }
  })

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
      const args = [household, actor, 0, 'once', 'a'.repeat(64), JSON.stringify(changes), '[]']
      const write = async (values: unknown[]) => (await db.query<{ result: { status: number; revision: number } }>(
        'select public.write_household_records($1::uuid,$2::uuid,$3::bigint,$4::text,$5::text,$6::jsonb,$7::jsonb) result', values,
      )).rows[0].result
      const read = async (revision: number | null) => (await db.query<{ result: { status: number; revision?: number; records?: unknown[] } }>(
        "select public.read_household_records($1::uuid,$2::uuid,'meal',$3::bigint,0,100) result", [household, actor, revision],
      )).rows[0].result

      expect(await write(args)).toEqual({ status: 200, revision: 1 })
      expect(await write(args)).toEqual({ status: 200, revision: 1 })
      expect((await write([household, actor, 0, 'once', 'b'.repeat(64), JSON.stringify(changes), '[]'])).status).toBe(409)
      expect((await read(1)).records).toHaveLength(1)
      expect((await read(0)).status).toBe(409)
      expect((await write([household, actor, 0, 'different', 'b'.repeat(64), JSON.stringify(changes), '[]'])).status).toBe(409)
      const invalidBatch = [
        { kind: 'meal', id: 'm2', value: { id: 'm2', name: 'Soup', active: true } },
        { kind: 'unknown', id: 'm3', value: { id: 'm3' } },
      ]
      expect((await write([household, actor, 1, 'partial', 'c'.repeat(64), JSON.stringify(invalidBatch), '[]'])).status).toBe(400)
      expect((await read(1)).records).toHaveLength(1)
      const oversized = [{ kind: 'meal', id: 'large', value: { id: 'large', name: 'x'.repeat(32768), active: true } }]
      expect((await write([household, actor, 1, 'large', 'd'.repeat(64), JSON.stringify(oversized), '[]'])).status).toBe(413)
      expect((await read(1)).records).toHaveLength(1)
      expect((await write([household, actor, 1, 'null', 'e'.repeat(64), null, '[]'])).status).toBe(400)
      expect((await read(1)).records).toHaveLength(1)
      const recipe = [{ kind: 'recipe', id: 'r1', value: { id: 'r1', title: 'Pasta', mealId: 'm1' } }]
      const refs = [{ sourceKind: 'recipe', sourceId: 'r1', targetKind: 'meal', targetId: 'm1' }]
      expect((await write([household, actor, 1, 'recipe', 'f'.repeat(64), JSON.stringify(recipe), JSON.stringify(refs)])).revision).toBe(2)
      const affected = async (revision: number) => (await db.query<{ result: { status: number; records?: Array<{ id: string }> } }>(
        'select public.read_household_dependencies($1::uuid,$2::uuid,$3::bigint,$4::jsonb,$5::jsonb,$6::text[],0,100) result',
        [household, actor, revision, '[]', JSON.stringify([{ kind: 'meal', id: 'm1', sourceKinds: ['recipe'] }]), []],
      )).rows[0].result
      expect((await affected(2)).records?.map((row) => row.id)).toEqual(['r1'])
      expect((await affected(1)).status).toBe(409)
      const outcome = [{ kind: 'outcome', id: 'o1', value: { id: 'o1', acceptance: 'accepted' } }]
      expect(await write([household, actor, 2, 'outcome', 'a'.repeat(64), JSON.stringify(outcome), '[]'])).toEqual({ status: 200, revision: 3 })
      const replacement = [{ kind: 'outcome', id: 'o1', value: { id: 'o1', acceptance: 'rejected' } }]
      expect((await write([household, actor, 3, 'replace', 'b'.repeat(64), JSON.stringify(replacement), '[]'])).status).toBe(409)
      const plan = [{ kind: 'plan', id: 'p1', value: { id: 'p1', confirmed: true, shopping: { confirmedAt: '2026-09-27T18:00:00Z', partial: false, skippedIncompleteMealIds: [] } } }]
      expect((await write([household, actor, 3, 'plan', 'c'.repeat(64), JSON.stringify(plan), '[]'])).revision).toBe(4)
      const lateItem = [{ kind: 'shopping-item', id: 'item1', planId: 'p1', position: 0, value: { id: 'item1', label: 'Milk', sourceLines: ['milk'], mealIds: [], perishable: true, availability: 'available' } }]
      expect((await write([household, actor, 4, 'late-item', 'd'.repeat(64), JSON.stringify(lateItem), '[]'])).status).toBe(409)
      const duplicate = [
        { kind: 'meal', id: 'duplicate', value: { id: 'duplicate', name: 'First', active: true } },
        { kind: 'meal', id: 'duplicate', value: { id: 'duplicate', name: 'Second', active: true } },
      ]
      expect((await write([household, actor, 4, 'duplicate', 'e'.repeat(64), JSON.stringify(duplicate), '[]'])).status).toBe(400)
      const linked = [
        { kind: 'meal', id: 'm2', value: { id: 'm2', name: 'Soup', active: true, plannedLeftoverDinner: true, recipeIds: ['r2'] } },
        { kind: 'recipe', id: 'r2', value: { id: 'r2', title: 'Soup recipe' } },
        { kind: 'plan', id: 'p2', value: { id: 'p2' } },
        { kind: 'slot', id: 's2', planId: 'p2', position: 1, value: { id: 's2', date: '2026-09-28', mealId: 'm2', recipeId: 'r2', dinnerReadyAt: '2026-09-28T18:00:00Z' } },
      ]
      const linkedRefs = [
        { sourceKind: 'meal', sourceId: 'm2', targetKind: 'recipe', targetId: 'r2' },
        { sourceKind: 'slot', sourceId: 's2', targetKind: 'plan', targetId: 'p2' },
        { sourceKind: 'slot', sourceId: 's2', targetKind: 'meal', targetId: 'm2' },
        { sourceKind: 'slot', sourceId: 's2', targetKind: 'recipe', targetId: 'r2' },
      ]
      expect((await write([household, actor, 4, 'linked', 'f'.repeat(64), JSON.stringify(linked), JSON.stringify(linkedRefs)])).revision).toBe(5)
      await db.query(`insert into public.household_records(household_id,kind,record_id,plan_id,position,value)
        values ($1,'slot','s_source','p2',0,'{"id":"s_source","date":"2026-09-27","mealId":"m2"}'::jsonb)`, [household])
      const check = async (changes: unknown[], revision = 5) => (await db.query<{ result: { status: number } }>(
        'select public.check_household_record_changes($1::uuid,$2::uuid,$3::bigint,$4::jsonb) result', [household, actor, revision, JSON.stringify(changes)],
      )).rows[0].result
      expect((await check([{ kind: 'meal', id: 'm2', value: { id: 'm2', name: 'Soup', active: true, recipeIds: [] } }])).status).toBe(400)
      expect((await check([{ kind: 'meal', id: 'm2', value: { id: 'm2', name: 'Noodle soup', active: true, recipeIds: ['r2'] } }])).status).toBe(200)
      const linkedOutcome = [{ kind: 'outcome', id: 'o2', value: { id: 'o2', planId: 'p2', planSlotId: 's2', mealId: 'm2', recipeId: 'r2' } }]
      const outcomeRefs = [
        { sourceKind: 'outcome', sourceId: 'o2', targetKind: 'plan', targetId: 'p2' },
        { sourceKind: 'outcome', sourceId: 'o2', targetKind: 'slot', targetId: 's2' },
        { sourceKind: 'outcome', sourceId: 'o2', targetKind: 'meal', targetId: 'm2' },
        { sourceKind: 'outcome', sourceId: 'o2', targetKind: 'recipe', targetId: 'r2' },
      ]
      expect((await write([household, actor, 5, 'linked-outcome', 'a'.repeat(64), JSON.stringify(linkedOutcome), JSON.stringify(outcomeRefs)])).revision).toBe(6)
      const takeout = { kind: 'slot', id: 's2', planId: 'p2', position: 1, value: { id: 's2', date: '2026-09-28', dinnerReadyAt: '2026-09-28T18:00:00Z' } }
      expect((await check([takeout], 6)).status).toBe(400)
      expect((await check([takeout, { kind: 'outcome', id: 'o3', value: { id: 'o3', correctionOfOutcomeId: 'o2', planId: 'p2', planSlotId: 's2' } }], 6)).status).toBe(200)
      const effort = (id: string, minutes?: number, correctionOfOutcomeId?: string) => [{ kind: 'outcome', id, value: { id, mealId: 'm2', recipeId: 'r2', planSlotId: 's2', ...(minutes !== undefined && { activeEffortMinutes: minutes }), ...(correctionOfOutcomeId && { correctionOfOutcomeId }) } }]
      const total = async () => (await db.query<{ effort_count: number; effort_sum: number }>(
        "select effort_count,effort_sum from public.household_effort_totals where household_id=$1 and meal_id='m2' and recipe_id='r2'", [household],
      )).rows[0]
      expect((await write([household, actor, 6, 'effort1', 'b'.repeat(64), JSON.stringify(effort('o4', 20)), '[]'])).revision).toBe(7)
      expect(await total()).toEqual({ effort_count: 1, effort_sum: 20 })
      expect((await write([household, actor, 7, 'effort2', 'c'.repeat(64), JSON.stringify(effort('o5', 40, 'o4')), '[]'])).revision).toBe(8)
      expect(await total()).toEqual({ effort_count: 1, effort_sum: 40 })
      expect((await write([household, actor, 8, 'effort3', 'd'.repeat(64), JSON.stringify(effort('o6', undefined, 'o5')), '[]'])).revision).toBe(9)
      expect(await total()).toEqual({ effort_count: 0, effort_sum: 0 })
      const unavailable = [{ kind: 'shopping-item', id: 'item2', planId: 'p2', position: 1, value: { id: 'item2', label: 'Milk', sourceLines: ['1 cup milk'], mealIds: [], perishable: true, availability: 'unavailable' } }]
      expect((await write([household, actor, 9, 'unavailable', 'e'.repeat(64), JSON.stringify(unavailable), '[]'])).revision).toBe(10)
      const facts = (await db.query<{ result: { status: number; totals: Array<{ count: string; sum: string; unavailable: boolean }> } }>(
        'select public.read_household_effort($1::uuid,$2::uuid,$3::bigint,$4::jsonb,$5::jsonb,$6::jsonb) result',
        [household, actor, 10, JSON.stringify([{ planId: 'p2', mealId: 'm2', recipeId: 'r2', ingredientLines: ['cup:milk'] }]), '[]', '[]'],
      )).rows[0].result
      expect(facts.status).toBe(200)
      expect(facts.totals[0]).toMatchObject({ count: '0', sum: '0', unavailable: true })
      const planChildren = (await db.query<{ result: { records: Array<{ kind: string }> } }>(
        'select public.read_household_dependencies($1::uuid,$2::uuid,10,$3::jsonb,$4::jsonb,$5::text[],0,100) result',
        [household, actor, '[]', '[]', ['p2']],
      )).rows[0].result.records
      expect(planChildren.every((row) => row.kind === 'slot')).toBe(true)
      const activeEffort = [{ kind: 'outcome', id: 'o7', value: { id: 'o7', mealId: 'm2', recipeId: 'r2', planSlotId: 's2', activeEffortMinutes: 20 } }]
      const activeRefs = [{ sourceKind: 'outcome', sourceId: 'o7', targetKind: 'slot', targetId: 's2' }]
      expect((await write([household, actor, 10, 'slot-effort', 'f'.repeat(64), JSON.stringify(activeEffort), JSON.stringify(activeRefs)])).revision).toBe(11)
      const makeLeftover = { kind: 'slot', id: 's2', planId: 'p2', position: 1, value: { id: 's2', date: '2026-09-28', mealId: 'm2', recipeId: 'r2', dinnerReadyAt: '2026-09-28T18:00:00Z', leftoverFromSlotId: 's_source' } }
      expect((await check([makeLeftover], 11)).status).toBe(400)
      expect((await check([makeLeftover, { kind: 'outcome', id: 'o8', value: { id: 'o8', mealId: 'm2', recipeId: 'r2', planSlotId: 's2', correctionOfOutcomeId: 'o7', leftoverServing: true } }], 11)).status).toBe(200)

      // A retained history of dependent slots still produces one scalar guard result.
      await db.query(`insert into public.household_records(household_id,kind,record_id,value)
        select $1,'plan','history_plan_' || number,jsonb_build_object('id','history_plan_' || number)
        from generate_series(1,300) number`, [household])
      await db.query(`insert into public.household_records(household_id,kind,record_id,plan_id,position,value)
        select $1,'slot','history_slot_' || number,'history_plan_' || number,0,
          jsonb_build_object('id','history_slot_' || number,'date','2026-09-27','mealId','m2','recipeId','r2')
        from generate_series(1,300) number`, [household])
      await db.query(`insert into public.household_record_refs(household_id,source_kind,source_id,target_kind,target_id)
        select $1,'slot','history_slot_' || number,'meal','m2' from generate_series(1,300) number`, [household])
      expect((await check([{ kind: 'meal', id: 'm2', value: { id: 'm2', name: 'Soup', active: true, recipeIds: [] } }], 11)).status).toBe(400)
      await db.query(`insert into public.household_records(household_id,kind,record_id,value) values
        ($1,'plan','reservation_plan','{"id":"reservation_plan"}'::jsonb),
        ($1,'plan','other_plan','{"id":"other_plan"}'::jsonb),
        ($1,'leftover-lot','reserved_lot','{"id":"reserved_lot","sourcePlanId":"reservation_plan","sourceSlotId":"source_slot","sourceMealId":"m2","dinnerCoverage":"one"}'::jsonb)`, [household])
      await db.query(`insert into public.household_records(household_id,kind,record_id,plan_id,position,value) values
        ($1,'slot','source_slot','reservation_plan',0,'{"id":"source_slot","date":"2026-09-27","mealId":"m2"}'::jsonb),
        ($1,'slot','planned_old','reservation_plan',1,'{"id":"planned_old","date":"2026-09-28","mealId":"m2","leftoverFromSlotId":"source_slot"}'::jsonb),
        ($1,'slot','planned_new','reservation_plan',2,'{"id":"planned_new","date":"2026-09-29","mealId":"m2"}'::jsonb),
        ($1,'slot','lot_old','reservation_plan',3,'{"id":"lot_old","date":"2026-09-30","mealId":"m2","leftoverLotIds":["reserved_lot"]}'::jsonb),
        ($1,'slot','lot_new','other_plan',0,'{"id":"lot_new","date":"2026-10-01","mealId":"m2"}'::jsonb)`, [household])
      await db.query(`insert into public.household_record_refs(household_id,source_kind,source_id,target_kind,target_id) values
        ($1,'slot','planned_old','slot','source_slot'),
        ($1,'slot','lot_old','leftover-lot','reserved_lot')`, [household])
      const target = { kind: 'slot', id: 'planned_new', planId: 'reservation_plan', position: 2, value: { id: 'planned_new', date: '2026-09-29', mealId: 'm2', leftoverFromSlotId: 'source_slot' } }
      const releaseTarget = { kind: 'slot', id: 'planned_old', planId: 'reservation_plan', position: 1, value: { id: 'planned_old', date: '2026-09-28', mealId: 'm2' } }
      expect((await check([target], 11)).status).toBe(400)
      expect((await check([releaseTarget, target], 11)).status).toBe(200)
      const lotTarget = { kind: 'slot', id: 'lot_new', planId: 'other_plan', position: 0, value: { id: 'lot_new', date: '2026-10-01', mealId: 'm2', leftoverLotIds: ['reserved_lot'] } }
      const releaseLot = { kind: 'slot', id: 'lot_old', planId: 'reservation_plan', position: 3, value: { id: 'lot_old', date: '2026-09-30', mealId: 'm2' } }
      expect((await check([lotTarget], 11)).status).toBe(400)
      expect((await check([releaseLot, lotTarget], 11)).status).toBe(200)
      expect((await write([household, actor, 11, 'direct-planned-duplicate', 'b'.repeat(64), JSON.stringify([target]), '[]'])).status).toBe(400)
      expect((await write([household, actor, 11, 'direct-lot-duplicate', 'c'.repeat(64), JSON.stringify([lotTarget]), '[]'])).status).toBe(400)
      await db.query(`insert into public.household_records(household_id,kind,record_id,value) values
        ($1,'plan','date_plan','{"id":"date_plan","confirmed":true}'::jsonb)`, [household])
      await db.query(`insert into public.household_records(household_id,kind,record_id,plan_id,position,value) values
        ($1,'slot','date_slot','date_plan',0,'{"id":"date_slot","date":"2026-09-27","mealId":"m2"}'::jsonb)`, [household])
      const moved = [{ kind: 'slot', id: 'date_slot', planId: 'date_plan', position: 0, value: { id: 'date_slot', date: '2026-09-28', mealId: 'm2' } }]
      expect((await write([household, actor, 11, 'move-date', 'a'.repeat(64), JSON.stringify(moved), '[]'])).status).toBe(409)
      await db.query(`insert into public.household_records(household_id,kind,record_id,value)
        values ($1,'leftover-lot','unreferenced_lot','{"id":"unreferenced_lot","sourcePlanId":"reservation_plan","sourceSlotId":"source_slot","sourceMealId":"m2","dinnerCoverage":"one"}'::jsonb)`, [household])
      const directReserve = [{ ...lotTarget, value: { ...lotTarget.value, leftoverLotIds: ['unreferenced_lot'] } }]
      expect((await write([household, actor, 11, 'direct-reserve', 'd'.repeat(64), JSON.stringify(directReserve), '[]'])).revision).toBe(12)
      const indexedLinks = (await db.query<{ count: number }>(`select count(*)::integer count from public.household_record_refs
        where household_id=$1 and source_kind='slot' and source_id='lot_new'
          and target_kind='leftover-lot' and target_id='unreferenced_lot'`, [household])).rows[0].count
      expect(indexedLinks).toBe(1)
      const secondReserve = [{ ...target, value: { ...target.value, leftoverFromSlotId: undefined, leftoverLotIds: ['unreferenced_lot'] } }]
      expect((await write([household, actor, 12, 'direct-second-reserve', 'e'.repeat(64), JSON.stringify(secondReserve), '[]'])).status).toBe(400)
      const proposed = (planned: boolean, targetDate: string, chained = false) => [
        { kind: 'meal', id: 'guard_meal', value: { id: 'guard_meal', name: 'Guard meal', active: true, ...(planned && { plannedLeftoverDinner: true }) } },
        { kind: 'plan', id: 'guard_plan', value: { id: 'guard_plan' } },
        ...(chained ? [{ kind: 'slot', id: 'guard_anchor', planId: 'guard_plan', position: 0, value: { id: 'guard_anchor', date: '2026-09-26', mealId: 'guard_meal' } }] : []),
        { kind: 'slot', id: 'guard_source', planId: 'guard_plan', position: 1, value: { id: 'guard_source', date: '2026-09-27', mealId: 'guard_meal', ...(chained && { leftoverFromSlotId: 'guard_anchor' }) } },
        { kind: 'slot', id: 'guard_target', planId: 'guard_plan', position: 2, value: { id: 'guard_target', date: targetDate, mealId: 'guard_meal', leftoverFromSlotId: 'guard_source' } },
      ]
      expect((await write([household, actor, 12, 'unflagged-source', 'f'.repeat(64), JSON.stringify(proposed(false, '2026-09-28')), '[]'])).status).toBe(400)
      expect((await write([household, actor, 12, 'same-date-source', 'a'.repeat(64), JSON.stringify(proposed(true, '2026-09-27')), '[]'])).status).toBe(400)
      expect((await write([household, actor, 12, 'consumer-source', 'b'.repeat(64), JSON.stringify(proposed(true, '2026-09-28', true)), '[]'])).status).toBe(400)
      expect((await write([household, actor, 12, 'valid-source', 'c'.repeat(64), JSON.stringify(proposed(true, '2026-09-28')), '[]'])).revision).toBe(13)
      const existingSourceTarget = [{ kind: 'slot', id: 'existing_source_target', planId: 'p2', position: 2, value: { id: 'existing_source_target', date: '2026-09-29', mealId: 'm2', leftoverFromSlotId: 's_source' } }]
      expect((await write([household, actor, 13, 'valid-existing-source', 'd'.repeat(64), JSON.stringify(existingSourceTarget), '[]'])).revision).toBe(14)
      await db.query(`insert into public.household_records(household_id,kind,record_id,value)
        values ($1,'leftover-lot','source_change_lot','{"id":"source_change_lot","sourceMealId":"m2","dinnerCoverage":"one"}'::jsonb)`, [household])
      const changedSource = [{ kind: 'slot', id: 's_source', planId: 'p2', position: 0, value: { id: 's_source', date: '2026-09-27', mealId: 'm2', leftoverLotIds: ['source_change_lot'] } }]
      expect((await write([household, actor, 14, 'source-becomes-consumer', 'e'.repeat(64), JSON.stringify(changedSource), '[]'])).status).toBe(400)
      await db.query('delete from public.household_memberships where household_id=$1 and user_id=$2', [household, actor])
      expect((await write(args)).status).toBe(403)
      expect((await affected(14)).status).toBe(403)
    } finally {
      await db.close()
    }
  })
})
