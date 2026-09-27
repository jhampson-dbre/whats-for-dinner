create table public.households (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table public.household_memberships (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('creator', 'member')),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create unique index one_creator_per_household on public.household_memberships (household_id) where role = 'creator';

create table public.household_invitations (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  email text not null check (email = lower(trim(email))),
  role text not null check (role in ('creator', 'member')),
  household_id uuid references public.households(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check ((role = 'creator' and household_id is null) or (role = 'member' and household_id is not null))
);

alter table public.households enable row level security;
alter table public.household_memberships enable row level security;
alter table public.household_invitations enable row level security;
revoke all on public.households, public.household_memberships, public.household_invitations from public, anon, authenticated;
grant all on public.households, public.household_memberships, public.household_invitations to service_role;

create function public.accept_household_invitation(p_token_hash text, p_user_id uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invitation record;
  target_household uuid;
begin
  update public.household_invitations
  set used_at = now()
  where token_hash = p_token_hash
    and email = lower(p_email)
    and expires_at > now()
    and used_at is null
    and revoked_at is null
  returning role, household_id into invitation;

  if not found then
    raise exception 'invalid_invitation';
  end if;

  if invitation.role = 'creator' then
    insert into public.households default values returning id into target_household;
  else
    target_household := invitation.household_id;
    if not exists (
      select 1 from public.household_memberships
      where household_id = target_household and role = 'creator'
    ) then
      raise exception 'invalid_invitation';
    end if;
  end if;

  insert into public.household_memberships (household_id, user_id, email, role)
  values (target_household, p_user_id, lower(p_email), invitation.role)
  on conflict (household_id, user_id) do nothing;
  return target_household;
end;
$$;

revoke all on function public.accept_household_invitation(text, uuid, text) from public, anon, authenticated;
grant execute on function public.accept_household_invitation(text, uuid, text) to service_role;

create function public.revoke_household_member(p_household_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_email text;
begin
  select email into removed_email from public.household_memberships
  where household_id = p_household_id and user_id = p_user_id and role = 'member';
  if not found then return false; end if;

  update public.household_invitations
  set revoked_at = now()
  where household_id = p_household_id and email = removed_email
    and role = 'member' and used_at is null and revoked_at is null;
  delete from public.household_memberships
  where household_id = p_household_id and user_id = p_user_id and role = 'member';
  return true;
end;
$$;

revoke all on function public.revoke_household_member(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_household_member(uuid, uuid) to service_role;
