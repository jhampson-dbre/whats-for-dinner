import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import pg from 'pg'
import { refs, validChange, validHousehold } from '../api/records.ts'

type Row = { seq: number; kind: string; id: string; planId?: string; position?: number; value: unknown }
type Effort = { outcomeId: string; mealId: string; recipeId: string; minutes: number; active: boolean }
type Chunk = { file: string; count: number; bytes: number; sha256: string }
type Manifest = { version: 1; sourceHouseholdId: string; sourceRevision: number; count: number; kinds: Record<string, number>; chunks: Chunk[]; effortCount: number; effortChunks: Chunk[]; recovery: { email: string; role: 'creator' | 'member' }[] }
const size = 100
const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex')
const fail = (message: string): never => { throw new Error(message) }
if (!/^[a-fA-F0-9]{64}$/.test(process.env.BACKUP_KEY_HEX ?? '')) fail('BACKUP_KEY_HEX must contain 32 random bytes in hex')
const key = Buffer.from(process.env.BACKUP_KEY_HEX!, 'hex')
if (!process.env.DATABASE_URL || !process.env.BACKUP_OPERATOR) fail('DATABASE_URL and BACKUP_OPERATOR are required')
const databaseUrl = new URL(process.env.DATABASE_URL!)
if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) fail('Use a PostgreSQL URL')
if (!['localhost', '127.0.0.1', '[::1]'].includes(databaseUrl.hostname)
  && (databaseUrl.searchParams.getAll('sslmode').length !== 1 || databaseUrl.searchParams.get('sslmode') !== 'verify-full'))
  fail('Nonlocal DATABASE_URL requires sslmode=verify-full with a trusted server certificate')
const cipher = (plain: Buffer) => {
  const iv = randomBytes(12)
  const aes = createCipheriv('aes-256-gcm', key, iv)
  return Buffer.concat([iv, aes.update(plain), aes.final(), aes.getAuthTag()])
}
const decipher = (sealed: Buffer) => {
  if (sealed.length < 28) fail('Truncated archive')
  const aes = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12))
  aes.setAuthTag(sealed.subarray(sealed.length - 16))
  return Buffer.concat([aes.update(sealed.subarray(12, -16)), aes.final()])
}
const client = new pg.Client({ connectionString: databaseUrl.toString() })
const audit = async (action: string, household: string, digest: string | null, location: string | null = null) => client.query(
  'insert into public.household_backup_audit(action,household_id,archive_digest,operator_name,archive_location) values ($1,$2,$3,$4,$5)',
  [action, household, digest, process.env.BACKUP_OPERATOR, location],
)
const uuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
const expectedEffort = (rows: Row[]): Effort[] => {
  const outcomes = rows.filter((row) => row.kind === 'outcome')
  const corrected = new Set(outcomes.map((row) => (row.value as Record<string, unknown>).correctionOfOutcomeId).filter((id): id is string => typeof id === 'string'))
  return outcomes.flatMap((row) => {
    const value = row.value as Record<string, unknown>
    return typeof value.mealId === 'string' && typeof value.activeEffortMinutes === 'number' && value.leftoverServing !== true
      ? [{ outcomeId: row.id, mealId: value.mealId, recipeId: typeof value.recipeId === 'string' ? value.recipeId : '',
        minutes: value.activeEffortMinutes, active: !corrected.has(row.id) }] : []
  })
}
const assertEffort = (rows: Row[], actual: Effort[]) => {
  const expected = new Map(expectedEffort(rows).map((item) => [item.outcomeId, item]))
  if (actual.length !== expected.size || actual.some((item) => {
    const match = expected.get(item.outcomeId)
    expected.delete(item.outcomeId)
    return !match || item.mealId !== match.mealId || item.recipeId !== match.recipeId
      || item.minutes !== match.minutes || item.active !== match.active
  })) fail('Missing or inconsistent effort contribution')
}

async function exportHousehold(household: string, destination: string) {
  if (!uuid(household)) fail('Invalid household ID')
  const output = resolve(destination)
  const temporary = `${output}.partial-${process.pid}`
  await mkdir(temporary, { recursive: false })
  let committed = false
  try {
    await client.query('begin isolation level repeatable read read only')
    const householdRow = await client.query('select revision from public.households where id=$1', [household])
    if (householdRow.rowCount !== 1) fail('Household not found')
    const recoveryRows = await client.query('select email,role from public.household_memberships where household_id=$1 order by role,email', [household])
    if (!recoveryRows.rows.some((row) => row.role === 'creator')) fail('Household has no creator')
    const manifest: Manifest = { version: 1, sourceHouseholdId: household, sourceRevision: Number(householdRow.rows[0].revision), count: 0, kinds: {}, chunks: [], effortCount: 0, effortChunks: [], recovery: recoveryRows.rows }
    if (!Number.isSafeInteger(manifest.sourceRevision) || manifest.sourceRevision < 0) fail('Revision exceeds archive format')
    const outcomes: Row[] = []
    let after = '0'
    for (;;) {
      const page = await client.query('select seq::text,kind,record_id,plan_id,position,value from public.household_records where household_id=$1 and seq>$2 order by seq limit $3', [household, after, size])
      if (!page.rowCount) break
      const rows: Row[] = page.rows.map((row) => ({ seq: Number(row.seq), kind: row.kind, id: row.record_id,
        ...(row.plan_id === null ? {} : { planId: row.plan_id }), ...(row.position === null ? {} : { position: row.position }), value: row.value }))
      if (rows.some((row) => !Number.isSafeInteger(row.seq) || !validChange(row as Parameters<typeof validChange>[0]))) fail('Source has invalid records')
      const plain = Buffer.from(rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
      if (plain.length > 4_000_000) fail('Record chunk exceeds archive limit')
      const file = `records-${String(manifest.chunks.length + 1).padStart(6, '0')}.ndjson.enc`
      await writeFile(join(temporary, file), cipher(plain), { flag: 'wx' })
      manifest.chunks.push({ file, count: rows.length, bytes: plain.length, sha256: sha(plain) })
      for (const row of rows) {
        manifest.kinds[row.kind] = (manifest.kinds[row.kind] ?? 0) + 1
        if (row.kind === 'outcome') outcomes.push(row)
      }
      manifest.count += rows.length
      after = page.rows.at(-1).seq
    }
    let afterOutcome = ''
    const effort: Effort[] = []
    for (;;) {
      const page = await client.query(`select outcome_id,meal_id,recipe_id,minutes,active from public.household_effort_contributions
        where household_id=$1 and outcome_id>$2 order by outcome_id limit $3`, [household, afterOutcome, size])
      if (!page.rowCount) break
      const rows: Effort[] = page.rows.map((row) => ({ outcomeId: row.outcome_id, mealId: row.meal_id, recipeId: row.recipe_id, minutes: row.minutes, active: row.active }))
      effort.push(...rows)
      const plain = Buffer.from(rows.map((row) => JSON.stringify(row)).join('\n') + '\n')
      if (plain.length > 4_000_000) fail('Effort chunk exceeds archive limit')
      const file = `effort-${String(manifest.effortChunks.length + 1).padStart(6, '0')}.ndjson.enc`
      await writeFile(join(temporary, file), cipher(plain), { flag: 'wx' })
      manifest.effortChunks.push({ file, count: rows.length, bytes: plain.length, sha256: sha(plain) })
      manifest.effortCount += rows.length
      afterOutcome = page.rows.at(-1).outcome_id
    }
    assertEffort(outcomes, effort)
    const inconsistentEffort = await client.query(`select exists (
      select 1 from (
        select meal_id,recipe_id,count(*) effort_count,sum(minutes) effort_sum
        from public.household_effort_contributions where household_id=$1 and active group by meal_id,recipe_id
      ) actual full join (select * from public.household_effort_totals where household_id=$1) stored
        on stored.meal_id=actual.meal_id and stored.recipe_id=actual.recipe_id
      where coalesce(actual.effort_count,0) is distinct from coalesce(stored.effort_count,0)
        or coalesce(actual.effort_sum,0) is distinct from coalesce(stored.effort_sum,0)
    ) invalid`, [household])
    if (inconsistentEffort.rows[0].invalid) fail('Source effort totals disagree with contributions')
    await client.query('commit')
    committed = true
    const raw = Buffer.from(JSON.stringify(manifest))
    await writeFile(join(temporary, 'manifest.json.enc'), cipher(raw), { flag: 'wx' })
    await audit('export', household, sha(raw))
    await rename(temporary, output)
    console.log(JSON.stringify({ archive: output, digest: sha(raw), records: manifest.count, revision: manifest.sourceRevision }))
  } catch (error) {
    if (!committed) await client.query('rollback').catch(() => {})
    await rm(temporary, { recursive: true, force: true })
    throw error
  }
}

async function readArchive(directory: string) {
  const raw = decipher(await readFile(join(directory, 'manifest.json.enc')))
  const manifest = JSON.parse(raw.toString()) as Manifest
  if (manifest.version !== 1 || !uuid(manifest.sourceHouseholdId) || !Number.isSafeInteger(manifest.sourceRevision)
    || !Array.isArray(manifest.chunks) || !Array.isArray(manifest.effortChunks) || !Array.isArray(manifest.recovery)
    || !Number.isSafeInteger(manifest.count) || !Number.isSafeInteger(manifest.effortCount)) fail('Invalid manifest')
  if ((await readdir(directory)).sort().join('\n') !== ['manifest.json.enc', ...manifest.chunks.map((c) => c.file), ...manifest.effortChunks.map((c) => c.file)].sort().join('\n')) fail('Unexpected archive files')
  const rows: Row[] = []
  const kinds: Record<string, number> = {}
  const seen = new Set<string>()
  let previousSeq = 0
  for (const chunk of manifest.chunks) {
    if (!/^records-[0-9]{6}\.ndjson\.enc$/.test(chunk.file) || chunk.count < 1 || chunk.count > size || chunk.bytes > 4_000_000) fail('Invalid chunk metadata')
    const plain = decipher(await readFile(join(directory, chunk.file)))
    if (plain.length !== chunk.bytes || sha(plain) !== chunk.sha256) fail(`Digest mismatch: ${chunk.file}`)
    const lines = plain.toString('utf8').split('\n')
    if (lines.pop() !== '' || lines.length !== chunk.count) fail(`Invalid NDJSON: ${chunk.file}`)
    for (const line of lines) {
      const row = JSON.parse(line) as Row
      if (!Number.isSafeInteger(row.seq) || row.seq <= previousSeq || !validChange(row as Parameters<typeof validChange>[0])) fail('Invalid record schema/order')
      const id = `${row.kind}:${row.id}`
      if (seen.has(id)) fail('Duplicate record')
      seen.add(id)
      previousSeq = row.seq
      kinds[row.kind] = (kinds[row.kind] ?? 0) + 1
      rows.push(row)
    }
  }
  if (rows.length !== manifest.count || JSON.stringify(kinds) !== JSON.stringify(manifest.kinds)
    || !validHousehold(rows as Parameters<typeof validHousehold>[0])) fail('Archive record count or household schema mismatch')
  const byKey = new Map(rows.map((row) => [`${row.kind}:${row.id}`, row]))
  for (const row of rows) {
    if (row.planId && !byKey.has(`plan:${row.planId}`)) fail('Missing plan')
    const value = row.value as Record<string, unknown>
    if (row.kind === 'outcome' && value.correctionOfOutcomeId &&
      (!byKey.has(`outcome:${value.correctionOfOutcomeId}`) || (byKey.get(`outcome:${value.correctionOfOutcomeId}`)?.seq ?? 0) >= row.seq)) fail('Broken correction history')
    if (row.kind === 'slot' && value.leftoverFromSlotId && !byKey.has(`slot:${value.leftoverFromSlotId}`)) fail('Broken leftover history')
  }
  if (manifest.recovery.filter((row) => row.role === 'creator').length !== 1 ||
    manifest.recovery.some((row) => !['creator', 'member'].includes(row.role) || typeof row.email !== 'string' ||
      row.email !== row.email.trim().toLowerCase() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) ||
    new Set(manifest.recovery.map((row) => row.email)).size !== manifest.recovery.length) fail('Invalid recovery map')
  const effort: Effort[] = []
  for (const chunk of manifest.effortChunks) {
    if (!/^effort-[0-9]{6}\.ndjson\.enc$/.test(chunk.file) || chunk.count < 1 || chunk.count > size || chunk.bytes > 4_000_000) fail('Invalid effort chunk metadata')
    const plain = decipher(await readFile(join(directory, chunk.file)))
    if (plain.length !== chunk.bytes || sha(plain) !== chunk.sha256) fail(`Digest mismatch: ${chunk.file}`)
    const lines = plain.toString('utf8').split('\n')
    if (lines.pop() !== '' || lines.length !== chunk.count) fail('Invalid effort NDJSON')
    for (const line of lines) {
      const item = JSON.parse(line) as Effort
      if (!Number.isSafeInteger(item.minutes) || item.minutes < 0 || typeof item.active !== 'boolean'
        || effort.some((seen) => seen.outcomeId === item.outcomeId)) fail('Invalid effort contribution')
      effort.push(item)
    }
  }
  if (effort.length !== manifest.effortCount) fail('Effort count mismatch')
  assertEffort(rows, effort)
  return { manifest, rows, effort, digest: sha(raw) }
}

async function verifyCopy(directory: string, expectedDigest: string, location: string) {
  if (!/^[a-f0-9]{64}$/.test(expectedDigest) || !location.trim() || location.length > 1024) fail('Expected export digest and offsite location are required')
  const { manifest, digest } = await readArchive(resolve(directory))
  if (digest !== expectedDigest) fail('Copied archive does not match the export digest')
  const prior = await client.query(`select 1 from public.household_backup_audit
    where action='export' and household_id=$1 and archive_digest=$2 limit 1`, [manifest.sourceHouseholdId, digest])
  if (!prior.rowCount) fail('No matching local export audit')
  await audit('verified-copy', manifest.sourceHouseholdId, digest, location)
  console.log(JSON.stringify({ verifiedCopy: location, digest, records: manifest.count }))
}

async function restoreHousehold(directory: string, target: string) {
  const { manifest, rows, effort, digest } = await readArchive(resolve(directory))
  if (target !== 'new' && !uuid(target)) fail('Use new or a target household UUID')
  let household = target
  let created = false
  try {
    await client.query('begin')
    if (target === 'new') {
      household = (await client.query('insert into public.households default values returning id')).rows[0].id
      created = true
    }
    const status = await client.query(`select h.revision, s.archive_digest, s.published_at,
      exists(select 1 from public.household_memberships where household_id=h.id) members,
      exists(select 1 from public.household_invitations where household_id=h.id) invites,
      exists(select 1 from public.household_records where household_id=h.id) records
      from public.households h left join public.household_restore_stages s on s.household_id=h.id where h.id=$1 for update of h`, [household])
    if (status.rowCount !== 1 || status.rows[0].members || status.rows[0].invites || status.rows[0].records || Number(status.rows[0].revision) !== 0
      || status.rows[0].published_at || (status.rows[0].archive_digest && status.rows[0].archive_digest !== digest)) fail('Target must be empty, unpublished, and stage digest must match')
    await client.query('delete from public.household_restore_stages where household_id=$1', [household])
    await client.query('insert into public.household_restore_stages(household_id,archive_digest,source_household_id,source_revision) values ($1,$2,$3,$4)', [household, digest, manifest.sourceHouseholdId, manifest.sourceRevision])
    await audit('stage', household, digest)
    await client.query('commit')
    for (let i = 0; i < rows.length; i += size) {
      const batch = rows.slice(i, i + size)
      await client.query('begin')
      for (const row of batch) await client.query(`insert into public.household_restore_records(household_id,source_seq,kind,record_id,plan_id,position,value)
        values($1,$2,$3,$4,$5,$6,$7)`, [household, row.seq, row.kind, row.id, row.planId ?? null, row.position ?? null, row.value])
      await client.query('commit')
    }
    for (let i = 0; i < effort.length; i += size) {
      await client.query('begin')
      for (const item of effort.slice(i, i + size)) await client.query(`insert into public.household_restore_effort(household_id,outcome_id,meal_id,recipe_id,minutes,active)
        values($1,$2,$3,$4,$5,$6)`, [household, item.outcomeId, item.mealId, item.recipeId, item.minutes, item.active])
      await client.query('commit')
    }
    await client.query('begin')
    const finalTarget = await client.query(`select revision from public.households where id=$1
      and not exists(select 1 from public.household_memberships where household_id=$1)
      and not exists(select 1 from public.household_invitations where household_id=$1)
      and not exists(select 1 from public.household_records where household_id=$1) for update`, [household])
    if (finalTarget.rowCount !== 1 || Number(finalTarget.rows[0].revision) !== 0) fail('Target changed while staging')
    const stageCount = await client.query('select count(*)::integer count from public.household_restore_records where household_id=$1', [household])
    const effortCount = await client.query('select count(*)::integer count from public.household_restore_effort where household_id=$1', [household])
    if (stageCount.rows[0].count !== manifest.count || effortCount.rows[0].count !== manifest.effortCount) fail('Stage count mismatch')
    const stagedEffort = await client.query(`select outcome_id,meal_id,recipe_id,minutes,active
      from public.household_restore_effort where household_id=$1`, [household])
    assertEffort(rows, stagedEffort.rows.map((item) => ({ outcomeId: item.outcome_id, mealId: item.meal_id,
      recipeId: item.recipe_id, minutes: item.minutes, active: item.active })))
    // The locked household remains inaccessible: no membership or invitation exists until after commit.
    await client.query(`insert into public.household_records(household_id,kind,record_id,plan_id,position,value)
      select household_id,kind,record_id,plan_id,position,value from public.household_restore_records
      where household_id=$1 order by source_seq`, [household])
    for (const row of rows) {
      for (const ref of refs(row as Parameters<typeof refs>[0])) await client.query(`insert into public.household_record_refs(household_id,source_kind,source_id,target_kind,target_id)
        values($1,$2,$3,$4,$5) on conflict do nothing`, [household, ref.sourceKind, ref.sourceId, ref.targetKind, ref.targetId])
      const value = row.value as Record<string, unknown>
      if (row.kind === 'shopping-item' && value.availability === 'unavailable') await client.query(`insert into public.household_unavailable_lines(household_id,plan_id,item_id,normalized_line)
        select $1,$2,$3,public.normalized_ingredient_line(line) from jsonb_array_elements_text($4::jsonb) line on conflict do nothing`, [household, row.planId, row.id, JSON.stringify(value.sourceLines ?? [])])
    }
    await client.query(`insert into public.household_effort_contributions(household_id,outcome_id,meal_id,recipe_id,minutes,active)
      select household_id,outcome_id,meal_id,recipe_id,minutes,active from public.household_restore_effort where household_id=$1`, [household])
    await client.query(`insert into public.household_effort_totals(household_id,meal_id,recipe_id,effort_count,effort_sum)
      select household_id,meal_id,recipe_id,count(*),sum(minutes) from public.household_effort_contributions
      where household_id=$1 and active group by household_id,meal_id,recipe_id`, [household])
    await client.query('update public.households set revision=$2 where id=$1', [household, manifest.sourceRevision])
    await client.query('delete from public.household_restore_records where household_id=$1', [household])
    await client.query('delete from public.household_restore_effort where household_id=$1', [household])
    await client.query('update public.household_restore_stages set published_at=now() where household_id=$1', [household])
    await audit('publish', household, digest)
    await client.query('commit')
    console.log(JSON.stringify({ household, digest, records: rows.length, recoveryEntries: manifest.recovery.length }))
  } catch (error) {
    await client.query('rollback').catch(() => {})
    if (household !== 'new') {
      await client.query('begin')
      await client.query('delete from public.household_restore_stages where household_id=$1 and archive_digest=$2 and published_at is null', [household, digest])
      if (created) await client.query(`delete from public.households h where id=$1 and not exists
        (select 1 from public.household_restore_stages where household_id=h.id)`, [household])
      await client.query('commit')
    }
    throw error
  }
}

async function checkRecoveryArchive(directory: string, household: string) {
  if (!uuid(household)) fail('Invalid household ID')
  const archive = await readArchive(resolve(directory))
  const stage = await client.query('select archive_digest,published_at from public.household_restore_stages where household_id=$1', [household])
  if (stage.rowCount !== 1 || !stage.rows[0].published_at || stage.rows[0].archive_digest !== archive.digest) fail('Published archive digest mismatch')
  return archive.manifest.recovery
}

async function bindCreator(directory: string, household: string, user: string) {
  if (!uuid(user)) fail('Invalid creator user ID')
  const recovery = await checkRecoveryArchive(directory, household)
  const email = recovery.find((row) => row.role === 'creator')!.email
  await client.query('begin')
  try {
    await client.query('select public.bind_restored_creator($1,$2,$3)', [household, user, email])
    await audit('bind', household, null)
    await client.query('commit')
  } catch (error) { await client.query('rollback'); throw error }
  console.log('Verified creator bound')
}

async function inviteMember(directory: string, household: string, email: string, appUrl: string) {
  const recovery = await checkRecoveryArchive(directory, household)
  if (!recovery.some((row) => row.role === 'member' && row.email === email)) fail('Email is not a recovered member')
  const url = new URL(appUrl)
  if (url.protocol !== 'https:' || url.username || url.password) fail('Use an HTTPS app URL')
  const creator = await client.query("select 1 from public.household_memberships where household_id=$1 and role='creator'", [household])
  if (!creator.rowCount) fail('Bind the creator first')
  const token = randomBytes(32).toString('base64url')
  await client.query('begin')
  try {
    await client.query(`insert into public.household_invitations(token_hash,email,role,household_id,expires_at)
      values($1,$2,'member',$3,now() + interval '24 hours')`, [sha(token), email, household])
    await audit('invite', household, null)
    await client.query('commit')
  } catch (error) { await client.query('rollback'); throw error }
  url.hash = new URLSearchParams({ invite: token }).toString()
  console.log(url.toString())
}

const [command, ...args] = process.argv.slice(2)
await client.connect()
try {
  const role = await client.query('select current_user')
  if (role.rows[0].current_user !== 'postgres') fail('Connect as dedicated operator-controlled postgres role')
  if (command === 'export' && args.length === 2) await exportHousehold(args[0], args[1])
  else if (command === 'verify' && args.length === 3) await verifyCopy(args[0], args[1], args[2])
  else if (command === 'restore' && args.length === 2) await restoreHousehold(args[0], args[1])
  else if (command === 'bind' && args.length === 3) await bindCreator(args[0], args[1], args[2])
  else if (command === 'invite' && args.length === 4) await inviteMember(args[0], args[1], args[2], args[3])
  else fail('Usage: export HOUSEHOLD_ID OUTPUT_DIR | verify COPIED_ARCHIVE_DIR EXPORT_DIGEST OFFSITE_LOCATION | restore ARCHIVE_DIR new|EMPTY_HOUSEHOLD_ID | bind ARCHIVE_DIR HOUSEHOLD_ID VERIFIED_USER_ID | invite ARCHIVE_DIR HOUSEHOLD_ID EMAIL HTTPS_APP_URL')
} finally { await client.end() }
