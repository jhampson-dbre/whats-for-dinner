alter table public.households add column revision bigint not null default 0 check (revision >= 0);

create table public.household_records (
  seq bigint generated always as identity unique,
  household_id uuid not null references public.households(id) on delete cascade,
  kind text not null check (kind in ('settings', 'meal', 'recipe', 'plan', 'slot', 'shopping-item', 'repair', 'outcome', 'leftover-lot')),
  record_id text not null check (record_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  plan_id text,
  position integer,
  value jsonb not null check (jsonb_typeof(value) = 'object' and octet_length(value::text) <= 32768),
  primary key (household_id, kind, record_id),
  check ((kind in ('slot', 'shopping-item', 'repair')) = (plan_id is not null and position is not null)),
  check (position is null or position >= 0)
);
create index household_record_pages on public.household_records (household_id, kind, seq);

create table public.household_record_requests (
  household_id uuid not null references public.households(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  operation text not null,
  request_key text not null,
  payload_digest text not null check (payload_digest ~ '^[a-f0-9]{64}$'),
  revision bigint not null,
  primary key (household_id, actor_id, operation, request_key)
);

alter table public.household_records enable row level security;
alter table public.household_record_requests enable row level security;
revoke all on public.household_records, public.household_record_requests from public, anon, authenticated;
grant all on public.household_records, public.household_record_requests to service_role;

create function public.read_household_records(
  p_household_id uuid, p_user_id uuid, p_kind text, p_revision bigint default null,
  p_after bigint default 0, p_limit integer default 100
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  current_revision bigint;
  page jsonb;
  next_cursor bigint;
begin
  if p_kind not in ('settings', 'meal', 'recipe', 'plan', 'slot', 'shopping-item', 'repair', 'outcome', 'leftover-lot') or p_limit < 1 or p_limit > 100 or p_after < 0 then
    return jsonb_build_object('status', 400);
  end if;
  select revision into current_revision from public.households where id = p_household_id for share;
  if not found then return jsonb_build_object('status', 403); end if;
  perform 1 from public.household_memberships where household_id = p_household_id and user_id = p_user_id for share;
  if not found then return jsonb_build_object('status', 403); end if;
  if p_revision is not null and p_revision <> current_revision then return jsonb_build_object('status', 409); end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'seq', seq, 'kind', kind, 'id', record_id, 'planId', plan_id, 'position', position, 'value', value
  ) order by seq), '[]'::jsonb), max(seq)
  into page, next_cursor
  from (
    select seq, kind, record_id, plan_id, position, value
    from public.household_records
    where household_id = p_household_id and kind = p_kind and seq > p_after
    order by seq limit p_limit
  ) selected;
  if next_cursor is not null and not exists (
    select 1 from public.household_records where household_id = p_household_id and kind = p_kind and seq > next_cursor
  ) then next_cursor := null; end if;
  return jsonb_build_object('status', 200, 'revision', current_revision, 'records', page, 'nextCursor', next_cursor);
end;
$$;

create function public.write_household_records(
  p_household_id uuid, p_user_id uuid, p_expected_revision bigint,
  p_key text, p_digest text, p_changes jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  current_revision bigint;
  replay record;
  changed jsonb;
begin
  select revision into current_revision from public.households where id = p_household_id for update;
  if not found then return jsonb_build_object('status', 403); end if;
  perform 1 from public.household_memberships where household_id = p_household_id and user_id = p_user_id for share;
  if not found then return jsonb_build_object('status', 403); end if;
  select payload_digest, revision into replay from public.household_record_requests
  where household_id = p_household_id and actor_id = p_user_id and operation = 'upsert' and request_key = p_key;
  if found then
    if replay.payload_digest = p_digest then return jsonb_build_object('status', 200, 'revision', replay.revision); end if;
    return jsonb_build_object('status', 409);
  end if;
  if current_revision <> p_expected_revision then return jsonb_build_object('status', 409); end if;
  if p_key is null or length(p_key) not between 1 and 128 or p_digest is null or p_digest !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_changes) is distinct from 'array' then
    return jsonb_build_object('status', 400);
  end if;
  if jsonb_array_length(p_changes) not between 1 and 100 then
    return jsonb_build_object('status', 400);
  end if;
  if octet_length(p_changes::text) > 262144 then return jsonb_build_object('status', 413); end if;

  for changed in select value from jsonb_array_elements(p_changes) with ordinality as entry(value, ordinal) order by ordinal loop
    if changed->>'kind' is null or changed->>'kind' not in ('settings', 'meal', 'recipe', 'plan', 'slot', 'shopping-item', 'repair', 'outcome', 'leftover-lot')
      or changed->>'id' is null or changed->>'id' !~ '^[A-Za-z0-9_-]{1,128}$'
      or jsonb_typeof(changed->'value') is distinct from 'object'
      or changed->'value'->>'id' is distinct from changed->>'id' and changed->>'kind' <> 'settings'
      or (changed->>'kind' in ('slot', 'shopping-item', 'repair')) <> (changed ? 'planId' and changed ? 'position') then
      return jsonb_build_object('status', 400);
    end if;
    if octet_length((changed->'value')::text) > 32768 then return jsonb_build_object('status', 413); end if;
  end loop;

  for changed in select value from jsonb_array_elements(p_changes) with ordinality as entry(value, ordinal) order by ordinal loop
    insert into public.household_records (household_id, kind, record_id, plan_id, position, value)
    values (p_household_id, changed->>'kind', changed->>'id', changed->>'planId', (changed->>'position')::integer, changed->'value')
    on conflict (household_id, kind, record_id) do update
      set plan_id = excluded.plan_id, position = excluded.position, value = excluded.value;
  end loop;

  update public.households set revision = revision + 1 where id = p_household_id returning revision into current_revision;
  insert into public.household_record_requests (household_id, actor_id, operation, request_key, payload_digest, revision)
  values (p_household_id, p_user_id, 'upsert', p_key, p_digest, current_revision);
  return jsonb_build_object('status', 200, 'revision', current_revision);
end;
$$;

revoke all on function public.read_household_records(uuid, uuid, text, bigint, bigint, integer), public.write_household_records(uuid, uuid, bigint, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.read_household_records(uuid, uuid, text, bigint, bigint, integer), public.write_household_records(uuid, uuid, bigint, text, text, jsonb) to service_role;
