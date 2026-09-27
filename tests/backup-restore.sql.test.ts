// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

it('stages privately, publishes once, and binds only a verified creator', async () => {
  const db = new PGlite()
  const creator = '11111111-1111-4111-8111-111111111111'
  const unverified = '22222222-2222-4222-8222-222222222222'
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
      insert into auth.users values ('${creator}', 'new@example.com', now()), ('${unverified}', 'unverified@example.com', null);`)
    for (const file of ['20260927000000_household_access.sql', '20260927000001_household_records.sql', '20260927000002_household_backup.sql'])
      await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'))
    const household = (await db.query<{ id: string }>('insert into public.households default values returning id')).rows[0].id
    const audit = await db.query<{ id: number }>(`insert into public.household_backup_audit(action,household_id,archive_digest,operator_name,archive_location)
      values ('verified-copy',$1,$2,'rehearsal','offsite-copy') returning id`, [household, 'a'.repeat(64)])
    await expect(db.query('update public.household_backup_audit set operator_name=$1 where id=$2', ['changed', audit.rows[0].id])).rejects.toThrow(/append_only_audit/)
    await expect(db.query('delete from public.household_backup_audit where id=$1', [audit.rows[0].id])).rejects.toThrow(/append_only_audit/)
    await expect(db.query('truncate public.household_backup_audit')).rejects.toThrow(/append_only_audit/)
    await db.query('insert into public.household_restore_stages (household_id, archive_digest, source_household_id, source_revision) values ($1,$2,$3,7)', [household, 'a'.repeat(64), household])
    await db.query(`insert into public.household_restore_records(household_id,source_seq,kind,record_id,value) values ($1,1,'meal','m1','{"id":"m1"}'::jsonb)`, [household])
    await db.exec('set role authenticated')
    await expect(db.query('select * from public.household_restore_records')).rejects.toThrow(/permission denied/)
    await db.exec('reset role')
    await expect(db.query('select public.bind_restored_creator($1,$2,$3)', [household, creator, 'wrong@example.com'])).rejects.toThrow(/invalid_recovery/)
    await expect(db.query('select public.bind_restored_creator($1,$2,$3)', [household, creator, 'new@example.com'])).rejects.toThrow(/invalid_recovery/)
    await db.query('update public.household_restore_stages set published_at=now() where household_id=$1', [household])
    await expect(db.query('select public.bind_restored_creator($1,$2,$3)', [household, unverified, 'unverified@example.com'])).rejects.toThrow(/invalid_recovery/)
    await db.query('select public.bind_restored_creator($1,$2,$3)', [household, creator, 'new@example.com'])
    expect((await db.query('select role from public.household_memberships where household_id=$1', [household])).rows).toEqual([{ role: 'creator' }])
    await expect(db.query('select public.bind_restored_creator($1,$2,$3)', [household, creator, 'new@example.com'])).rejects.toThrow(/invalid_recovery/)
  } finally { await db.close() }
}, 20_000)
