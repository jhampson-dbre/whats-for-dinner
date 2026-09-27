-- Operator connection only. No API role receives access to recovery staging or audit.
create table public.household_backup_audit (
  id bigint generated always as identity primary key,
  action text not null check (action in ('export', 'verified-copy', 'stage', 'publish', 'bind', 'invite')),
  household_id uuid not null,
  archive_digest text check (archive_digest is null or archive_digest ~ '^[a-f0-9]{64}$'),
  archive_location text,
  operator_name text not null,
  occurred_at timestamptz not null default now(),
  check ((action = 'verified-copy') = (archive_location is not null)),
  check (action <> 'verified-copy' or archive_digest is not null)
);
create function public.reject_backup_audit_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'append_only_audit';
end;
$$;
create trigger backup_audit_append_only before update or delete or truncate on public.household_backup_audit
for each statement execute function public.reject_backup_audit_change();
create table public.household_restore_stages (
  household_id uuid primary key references public.households(id) on delete cascade,
  archive_digest text not null check (archive_digest ~ '^[a-f0-9]{64}$'),
  source_household_id uuid not null,
  source_revision bigint not null check (source_revision >= 0),
  published_at timestamptz
);
create table public.household_restore_records (
  household_id uuid not null references public.household_restore_stages(household_id) on delete cascade,
  source_seq bigint not null check (source_seq > 0),
  kind text not null check (kind in ('settings', 'meal', 'recipe', 'plan', 'slot', 'shopping-item', 'repair', 'outcome', 'leftover-lot')),
  record_id text not null check (record_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  plan_id text,
  position integer,
  value jsonb not null check (jsonb_typeof(value) = 'object' and octet_length(value::text) <= 32768),
  primary key (household_id, kind, record_id),
  unique (household_id, source_seq),
  check ((kind in ('slot', 'shopping-item', 'repair')) = (plan_id is not null and position is not null)),
  check (position is null or position >= 0)
);
create index household_restore_record_pages on public.household_restore_records (household_id, kind, record_id);
create table public.household_restore_effort (
  household_id uuid not null references public.household_restore_stages(household_id) on delete cascade,
  outcome_id text not null,
  meal_id text not null,
  recipe_id text not null,
  minutes integer not null check (minutes >= 0),
  active boolean not null,
  primary key (household_id, outcome_id)
);
alter table public.household_backup_audit enable row level security;
alter table public.household_restore_stages enable row level security;
alter table public.household_restore_records enable row level security;
alter table public.household_restore_effort enable row level security;
revoke all on public.household_backup_audit, public.household_restore_stages, public.household_restore_records, public.household_restore_effort from public, anon, authenticated, service_role;

create function public.bind_restored_creator(p_household_id uuid, p_user_id uuid, p_email text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.household_restore_stages stage
    join public.households household on household.id = stage.household_id
    where stage.household_id = p_household_id and stage.published_at is not null
      and not exists (select 1 from public.household_memberships where household_id = p_household_id)
      and not exists (select 1 from public.household_invitations where household_id = p_household_id);
  if not found or p_email is null or p_email <> lower(btrim(p_email))
    or not exists (select 1 from auth.users where id = p_user_id and lower(email) = p_email and email_confirmed_at is not null) then
    raise exception 'invalid_recovery';
  end if;
  insert into public.household_memberships(household_id,user_id,email,role)
    values (p_household_id,p_user_id,p_email,'creator');
end;
$$;
revoke all on function public.bind_restored_creator(uuid, uuid, text) from public, anon, authenticated, service_role;
