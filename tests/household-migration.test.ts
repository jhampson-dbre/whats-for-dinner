// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { expect, it } from 'vitest'

const hash = (token: string) => createHash('sha256').update(token).digest('hex')
const creator = '11111111-1111-4111-8111-111111111111'
const member = '22222222-2222-4222-8222-222222222222'

it('enforces the household invitation migration in PostgreSQL', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      insert into auth.users values ('${creator}'), ('${member}');
    `)
    await db.exec(await readFile(new URL('../supabase/migrations/20260927000000_household_access.sql', import.meta.url), 'utf8'))

    await db.query('insert into public.household_invitations (token_hash,email,role,expires_at) values ($1,$2,$3,now() + interval \'1 hour\')', [hash('creator'), 'creator@example.com', 'creator'])
    const accept = (token: string, userId: string, email: string) => db.query<{ accept_household_invitation: string }>(
      'select public.accept_household_invitation($1,$2,$3)', [hash(token), userId, email],
    )
    await expect(accept('creator', creator, 'wrong@example.com')).rejects.toThrow('invalid_invitation')
    const householdId = (await accept('creator', creator, 'creator@example.com')).rows[0].accept_household_invitation
    await expect(accept('creator', creator, 'creator@example.com')).rejects.toThrow('invalid_invitation')

    await db.query('insert into public.household_invitations (token_hash,email,role,household_id,expires_at) values ($1,$2,$3,$4,now() + interval \'1 hour\')', [hash('member'), 'member@example.com', 'member', householdId])
    await expect(accept('member', member, 'wrong@example.com')).rejects.toThrow('invalid_invitation')
    expect((await accept('member', member, 'member@example.com')).rows[0].accept_household_invitation).toBe(householdId)
    await expect(accept('member', member, 'member@example.com')).rejects.toThrow('invalid_invitation')

    await db.query('insert into public.household_invitations (token_hash,email,role,household_id,expires_at) values ($1,$2,$3,$4,now() - interval \'1 hour\')', [hash('expired'), 'member@example.com', 'member', householdId])
    await db.query('insert into public.household_invitations (token_hash,email,role,household_id,expires_at,revoked_at) values ($1,$2,$3,$4,now() + interval \'1 hour\',now())', [hash('revoked'), 'member@example.com', 'member', householdId])
    await expect(accept('expired', member, 'member@example.com')).rejects.toThrow('invalid_invitation')
    await expect(accept('revoked', member, 'member@example.com')).rejects.toThrow('invalid_invitation')

    const list = (userId: string) => db.query<{ list_household_members: { user_id: string }[] | null }>(
      'select public.list_household_members($1,$2)', [householdId, userId],
    )
    expect((await list(member)).rows[0].list_household_members).toHaveLength(2)
    await db.query('insert into public.household_invitations (token_hash,email,role,household_id,expires_at) values ($1,$2,$3,$4,now() + interval \'1 hour\')', [hash('pending'), 'member@example.com', 'member', householdId])
    await db.query('select public.revoke_household_member($1,$2)', [householdId, member])
    await expect(accept('pending', member, 'member@example.com')).rejects.toThrow('invalid_invitation')
    expect((await list(member)).rows[0].list_household_members).toBeNull()
    expect((await list(creator)).rows[0].list_household_members).toHaveLength(1)

    await db.exec('set role service_role')
    expect((await list(creator)).rows[0].list_household_members).toHaveLength(1)
    await db.exec('reset role')
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      for (const table of ['households', 'household_memberships', 'household_invitations']) {
        await expect(db.query(`select * from public.${table}`)).rejects.toThrow(/permission denied/)
      }
      await expect(db.query('insert into public.households default values')).rejects.toThrow(/permission denied/)
      await expect(list(creator)).rejects.toThrow(/permission denied/)
      await expect(accept('creator', creator, 'creator@example.com')).rejects.toThrow(/permission denied/)
      await expect(db.query('select public.revoke_household_member($1,$2)', [householdId, member])).rejects.toThrow(/permission denied/)
      await db.exec('reset role')
    }
  } finally {
    await db.close()
  }
}, 20_000)
