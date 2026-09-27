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
create index household_record_plan_slots on public.household_records (household_id, plan_id, seq) where kind = 'slot';
create function public.normalized_ingredient_line(line text) returns text
language plpgsql immutable set search_path = ''
as $$
declare
  parts text[];
  unit text;
begin
  parts := regexp_match(btrim(line), '^([0-9]+([.][0-9]+)?)\s+([A-Za-z]+)\s+(.+)$');
  if parts is not null then
    unit := case lower(parts[3])
      when 'cups' then 'cup' when 'cup' then 'cup'
      when 'tablespoon' then 'tbsp' when 'tablespoons' then 'tbsp' when 'tbsp' then 'tbsp'
      when 'teaspoon' then 'tsp' when 'teaspoons' then 'tsp' when 'tsp' then 'tsp'
      when 'ounce' then 'oz' when 'ounces' then 'oz' when 'oz' then 'oz'
      when 'pound' then 'lb' when 'pounds' then 'lb' when 'lbs' then 'lb' when 'lb' then 'lb'
    end;
    if unit is not null and btrim(parts[4]) <> '' then
      return unit || ':' || regexp_replace(lower(btrim(parts[4])), '\s+', ' ', 'g');
    end if;
  end if;
  return 'raw:' || regexp_replace(lower(btrim(line)), '\s+', ' ', 'g');
end;
$$;

create table public.household_unavailable_lines (
  household_id uuid not null references public.households(id) on delete cascade,
  plan_id text not null,
  item_id text not null,
  normalized_line text not null,
  primary key (household_id, plan_id, item_id, normalized_line)
);
create index household_unavailable_line_lookup on public.household_unavailable_lines (household_id, plan_id, normalized_line);

create table public.household_effort_totals (
  household_id uuid not null references public.households(id) on delete cascade,
  meal_id text not null,
  recipe_id text not null,
  effort_count bigint not null default 0 check (effort_count >= 0),
  effort_sum bigint not null default 0 check (effort_sum >= 0),
  primary key (household_id, meal_id, recipe_id)
);
create table public.household_effort_contributions (
  household_id uuid not null references public.households(id) on delete cascade,
  outcome_id text not null,
  meal_id text not null,
  recipe_id text not null,
  minutes integer not null check (minutes >= 0),
  active boolean not null default true,
  primary key (household_id, outcome_id)
);

create table public.household_record_refs (
  household_id uuid not null,
  source_kind text not null,
  source_id text not null,
  target_kind text not null,
  target_id text not null,
  primary key (household_id, source_kind, source_id, target_kind, target_id),
  foreign key (household_id, source_kind, source_id)
    references public.household_records (household_id, kind, record_id) on delete cascade
);
create index household_record_incoming on public.household_record_refs (household_id, target_kind, target_id, source_kind);

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
alter table public.household_record_refs enable row level security;
alter table public.household_record_requests enable row level security;
alter table public.household_effort_totals enable row level security;
alter table public.household_effort_contributions enable row level security;
alter table public.household_unavailable_lines enable row level security;
revoke all on public.household_records, public.household_record_refs, public.household_record_requests, public.household_effort_totals, public.household_effort_contributions, public.household_unavailable_lines from public, anon, authenticated;
grant all on public.household_records, public.household_record_refs, public.household_record_requests, public.household_effort_totals, public.household_effort_contributions, public.household_unavailable_lines to service_role;

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

create function public.read_household_dependencies(
  p_household_id uuid, p_user_id uuid, p_revision bigint,
  p_keys jsonb, p_incoming jsonb, p_plan_ids text[],
  p_after bigint default 0, p_limit integer default 100
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  current_revision bigint;
  page jsonb;
  next_cursor bigint;
begin
  if jsonb_typeof(p_keys) is distinct from 'array' or jsonb_typeof(p_incoming) is distinct from 'array'
    or p_plan_ids is null or p_after is null or p_after < 0 or p_limit is null or p_limit < 1 or p_limit > 100 then
    return jsonb_build_object('status', 400);
  end if;
  select revision into current_revision from public.households where id = p_household_id for share;
  if not found then return jsonb_build_object('status', 403); end if;
  perform 1 from public.household_memberships where household_id = p_household_id and user_id = p_user_id for share;
  if not found then return jsonb_build_object('status', 403); end if;
  if p_revision <> current_revision then return jsonb_build_object('status', 409); end if;

  with matched as (
    select record.seq from jsonb_array_elements(p_keys) key
    join public.household_records record on record.household_id = p_household_id
      and record.kind = key->>'kind' and record.record_id = key->>'id'
    union
    select record.seq from jsonb_array_elements(p_incoming) requested
    join public.household_record_refs ref on ref.household_id = p_household_id
      and ref.target_kind = requested->>'kind' and ref.target_id = requested->>'id'
      and ref.source_kind in (select jsonb_array_elements_text(requested->'sourceKinds'))
    join public.household_records record on record.household_id = ref.household_id
      and record.kind = ref.source_kind and record.record_id = ref.source_id
      and (requested->>'kind' <> 'recipe' or ref.source_kind <> 'meal'
        or coalesce(record.value->'recipeIds', '[]'::jsonb) ? (requested->>'id'))
    union
    select record.seq from public.household_records record
    where record.household_id = p_household_id and record.kind = 'slot' and record.plan_id = any(p_plan_ids)
  ), selected as (
    select record.seq, record.kind, record.record_id, record.plan_id, record.position, record.value
    from matched join public.household_records record on record.seq = matched.seq
    where record.seq > p_after order by record.seq limit p_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'seq', seq, 'kind', kind, 'id', record_id, 'planId', plan_id, 'position', position, 'value', value
  ) order by seq), '[]'::jsonb), max(seq) into page, next_cursor from selected;
  if next_cursor is not null and exists (
    with matched as (
      select record.seq from jsonb_array_elements(p_keys) key
      join public.household_records record on record.household_id = p_household_id
        and record.kind = key->>'kind' and record.record_id = key->>'id'
      union
      select record.seq from jsonb_array_elements(p_incoming) requested
      join public.household_record_refs ref on ref.household_id = p_household_id
        and ref.target_kind = requested->>'kind' and ref.target_id = requested->>'id'
        and ref.source_kind in (select jsonb_array_elements_text(requested->'sourceKinds'))
      join public.household_records record on record.household_id = ref.household_id
        and record.kind = ref.source_kind and record.record_id = ref.source_id
        and (requested->>'kind' <> 'recipe' or ref.source_kind <> 'meal'
          or coalesce(record.value->'recipeIds', '[]'::jsonb) ? (requested->>'id'))
      union
      select record.seq from public.household_records record
      where record.household_id = p_household_id and record.kind = 'slot' and record.plan_id = any(p_plan_ids)
    ) select 1 from matched where seq > next_cursor
  ) then
    return jsonb_build_object('status', 200, 'revision', current_revision, 'records', page, 'nextCursor', next_cursor);
  end if;
  return jsonb_build_object('status', 200, 'revision', current_revision, 'records', page, 'nextCursor', null);
end;
$$;

create function public.read_household_effort(
  p_household_id uuid, p_user_id uuid, p_revision bigint, p_pairs jsonb, p_corrections jsonb, p_changes jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  current_revision bigint;
  totals jsonb;
  prior jsonb;
begin
  if jsonb_typeof(p_pairs) is distinct from 'array' or jsonb_typeof(p_corrections) is distinct from 'array' or jsonb_typeof(p_changes) is distinct from 'array'
    or jsonb_array_length(p_pairs) > 100 or jsonb_array_length(p_corrections) > 100 then
    return jsonb_build_object('status', 400);
  end if;
  select revision into current_revision from public.households where id = p_household_id for share;
  if not found then return jsonb_build_object('status', 403); end if;
  perform 1 from public.household_memberships where household_id = p_household_id and user_id = p_user_id for share;
  if not found then return jsonb_build_object('status', 403); end if;
  if p_revision <> current_revision then return jsonb_build_object('status', 409); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'planId', requested->>'planId', 'mealId', requested->>'mealId', 'recipeId', requested->>'recipeId',
    'count', coalesce(total.effort_count, 0)::text, 'sum', coalesce(total.effort_sum, 0)::text,
    'hasRecipe', exists (select 1 from public.household_record_refs ref
      where ref.household_id = p_household_id and ref.source_kind = 'recipe'
        and ref.target_kind = 'meal' and ref.target_id = requested->>'mealId'
        and not exists (select 1 from jsonb_array_elements(p_changes) changed
          where changed->>'kind' = 'recipe' and changed->>'id' = ref.source_id))
      or exists (select 1 from jsonb_array_elements(p_changes) changed
        where changed->>'kind' = 'recipe' and changed->'value'->>'mealId' = requested->>'mealId'),
    'unavailable', exists (select 1 from jsonb_array_elements_text(coalesce(requested->'ingredientLines', '[]'::jsonb)) ingredient
      join public.household_unavailable_lines line on line.household_id = p_household_id
        and line.plan_id = requested->>'planId' and line.normalized_line = ingredient)
      or exists (select 1 from jsonb_array_elements(p_changes) changed
        cross join lateral jsonb_array_elements_text(coalesce(changed->'value'->'sourceLines', '[]'::jsonb)) source_line
        join jsonb_array_elements_text(coalesce(requested->'ingredientLines', '[]'::jsonb)) ingredient
          on public.normalized_ingredient_line(source_line) = ingredient
        where changed->>'kind' = 'shopping-item' and changed->>'planId' = requested->>'planId'
          and changed->'value'->>'availability' = 'unavailable')
  )), '[]'::jsonb) into totals
  from jsonb_array_elements(p_pairs) requested
  left join public.household_effort_totals total on total.household_id = p_household_id
    and total.meal_id = requested->>'mealId' and total.recipe_id = coalesce(requested->>'recipeId', '');
  select coalesce(jsonb_agg(jsonb_build_object(
    'outcomeId', contribution.outcome_id, 'mealId', contribution.meal_id,
    'recipeId', nullif(contribution.recipe_id, ''), 'minutes', contribution.minutes,
    'active', contribution.active
  )), '[]'::jsonb) into prior
  from jsonb_array_elements_text(p_corrections) requested
  join public.household_effort_contributions contribution on contribution.household_id = p_household_id
    and contribution.outcome_id = requested;
  return jsonb_build_object('status', 200, 'totals', totals, 'contributions', prior);
end;
$$;

create function public.check_household_record_changes(
  p_household_id uuid, p_user_id uuid, p_revision bigint, p_changes jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  current_revision bigint;
  changed jsonb;
  previous_value jsonb;
  reference_id text;
  source_value jsonb;
  lot_value jsonb;
  source_plan_id text;
  source_meal jsonb;
begin
  select revision into current_revision from public.households where id = p_household_id for share;
  if not found then return jsonb_build_object('status', 403); end if;
  perform 1 from public.household_memberships where household_id = p_household_id and user_id = p_user_id for share;
  if not found then return jsonb_build_object('status', 403); end if;
  if current_revision <> p_revision then return jsonb_build_object('status', 409); end if;
  if jsonb_typeof(p_changes) is distinct from 'array' then return jsonb_build_object('status', 400); end if;

  for changed in select value from jsonb_array_elements(p_changes) as entry(value) loop
    select value into previous_value from public.household_records
    where household_id = p_household_id and kind = changed->>'kind' and record_id = changed->>'id';

    if changed->>'kind' = 'meal' then
      -- Existing unfinished slots must still have an associated recipe after this edit.
      if exists (
        select 1 from public.household_record_refs link
        join public.household_records slot on slot.household_id = link.household_id
          and slot.kind = 'slot' and slot.record_id = link.source_id
        join public.household_records plan on plan.household_id = slot.household_id
          and plan.kind = 'plan' and plan.record_id = slot.plan_id
        left join public.household_records recipe on recipe.household_id = slot.household_id
          and recipe.kind = 'recipe' and recipe.record_id = slot.value->>'recipeId'
        where link.household_id = p_household_id and link.target_kind = 'meal' and link.target_id = changed->>'id'
          and link.source_kind = 'slot' and slot.value ? 'recipeId'
          and coalesce(plan.value->>'confirmed', 'false') <> 'true'
          and not exists (select 1 from jsonb_array_elements(p_changes) c where c->>'kind' = 'slot' and c->>'id' = slot.record_id)
          and not coalesce(changed->'value'->'recipeIds', '[]'::jsonb) ? (slot.value->>'recipeId')
          and coalesce((select c->'value'->>'mealId' from jsonb_array_elements(p_changes) c
            where c->>'kind' = 'recipe' and c->>'id' = slot.value->>'recipeId'), recipe.value->>'mealId') is distinct from changed->>'id'
      ) then return jsonb_build_object('status', 400); end if;

      for reference_id in select item->>'id' from jsonb_array_elements(coalesce(previous_value->'adaptations', '[]'::jsonb)) item
        where not exists (select 1 from jsonb_array_elements(coalesce(changed->'value'->'adaptations', '[]'::jsonb)) next where next->>'id' = item->>'id') loop
        if exists (select 1 from public.household_record_refs ref where ref.household_id = p_household_id
          and ref.target_kind = 'adaptation' and ref.target_id = reference_id and ref.source_kind = 'repair') then
          return jsonb_build_object('status', 400);
        end if;
      end loop;
      for reference_id in select item->>'id' from jsonb_array_elements(coalesce(changed->'value'->'adaptations', '[]'::jsonb)) item loop
        if exists (select 1 from public.household_record_refs ref where ref.household_id = p_household_id
          and ref.target_kind = 'adaptation' and ref.target_id = reference_id and ref.source_kind = 'meal'
          and ref.source_id <> changed->>'id') then return jsonb_build_object('status', 400); end if;
      end loop;
      for reference_id in select jsonb_array_elements_text(coalesce(changed->'value'->'recipeIds', '[]'::jsonb)) loop
        if exists (select 1 from public.household_record_refs ref where ref.household_id = p_household_id
          and ref.target_kind = 'recipe' and ref.target_id = reference_id and ref.source_kind = 'meal'
          and ref.source_id <> changed->>'id'
          and not exists (select 1 from jsonb_array_elements(p_changes) c where c->>'kind' = 'meal' and c->>'id' = ref.source_id
            and not coalesce(c->'value'->'recipeIds', '[]'::jsonb) ? reference_id)) then return jsonb_build_object('status', 400); end if;
        if exists (select 1 from jsonb_array_elements(p_changes) recipe
            where recipe->>'kind' = 'recipe' and recipe->>'id' = reference_id
              and recipe->'value' ? 'mealId' and recipe->'value'->>'mealId' <> changed->>'id')
          or exists (select 1 from public.household_records recipe
            where recipe.household_id = p_household_id and recipe.kind = 'recipe' and recipe.record_id = reference_id
              and recipe.value ? 'mealId' and recipe.value->>'mealId' <> changed->>'id'
              and not exists (select 1 from jsonb_array_elements(p_changes) updated
                where updated->>'kind' = 'recipe' and updated->>'id' = reference_id))
        then return jsonb_build_object('status', 400); end if;
      end loop;
    end if;

    if changed->>'kind' = 'recipe' then
      if changed->'value' ? 'mealId' and (
        exists (select 1 from public.household_record_refs ref
          join public.household_records owner on owner.household_id = ref.household_id
            and owner.kind = 'meal' and owner.record_id = ref.source_id
          where ref.household_id = p_household_id and ref.target_kind = 'recipe'
            and ref.target_id = changed->>'id' and ref.source_kind = 'meal'
            and owner.record_id <> changed->'value'->>'mealId'
            and coalesce(owner.value->'recipeIds', '[]'::jsonb) ? (changed->>'id')
            and not exists (select 1 from jsonb_array_elements(p_changes) updated
              where updated->>'kind' = 'meal' and updated->>'id' = owner.record_id
                and not coalesce(updated->'value'->'recipeIds', '[]'::jsonb) ? (changed->>'id')))
        or exists (select 1 from jsonb_array_elements(p_changes) updated
          where updated->>'kind' = 'meal' and updated->>'id' <> changed->'value'->>'mealId'
            and coalesce(updated->'value'->'recipeIds', '[]'::jsonb) ? (changed->>'id'))
      ) then return jsonb_build_object('status', 400); end if;
      if exists (
        select 1 from public.household_record_refs link
        join public.household_records slot on slot.household_id = link.household_id
          and slot.kind = 'slot' and slot.record_id = link.source_id
        join public.household_records plan on plan.household_id = slot.household_id
          and plan.kind = 'plan' and plan.record_id = slot.plan_id
        left join public.household_records meal on meal.household_id = slot.household_id
          and meal.kind = 'meal' and meal.record_id = slot.value->>'mealId'
        where link.household_id = p_household_id and link.target_kind = 'recipe' and link.target_id = changed->>'id'
          and link.source_kind = 'slot' and slot.value ? 'mealId'
          and coalesce(plan.value->>'confirmed', 'false') <> 'true'
          and not exists (select 1 from jsonb_array_elements(p_changes) c where c->>'kind' = 'slot' and c->>'id' = slot.record_id)
          and changed->'value'->>'mealId' is distinct from slot.value->>'mealId'
          and not coalesce((select c->'value'->'recipeIds' from jsonb_array_elements(p_changes) c
            where c->>'kind' = 'meal' and c->>'id' = slot.value->>'mealId'), meal.value->'recipeIds', '[]'::jsonb) ? (changed->>'id')
      ) then return jsonb_build_object('status', 400); end if;
    end if;

    if changed->>'kind' = 'slot' and previous_value is not null then
      if (changed->'value' ? 'leftoverFromSlotId'
        or jsonb_array_length(coalesce(changed->'value'->'leftoverLotIds', '[]'::jsonb)) > 0)
        and exists (
          select 1 from public.household_record_refs link
          join public.household_effort_contributions effort on effort.household_id = link.household_id
            and effort.outcome_id = link.source_id and effort.active
          where link.household_id = p_household_id and link.target_kind = 'slot'
            and link.target_id = changed->>'id' and link.source_kind = 'outcome'
            and not exists (select 1 from jsonb_array_elements(p_changes) correction
              where correction->>'kind' = 'outcome' and correction->'value'->>'correctionOfOutcomeId' = effort.outcome_id)
        ) then return jsonb_build_object('status', 400); end if;
      -- Corrected outcomes remain in history; only active evidence must match the slot.
      if exists (
        select 1 from public.household_record_refs link
        join public.household_records outcome on outcome.household_id = link.household_id
          and outcome.kind = 'outcome' and outcome.record_id = link.source_id
        where link.household_id = p_household_id and link.target_kind = 'slot' and link.target_id = changed->>'id'
          and link.source_kind = 'outcome'
          and not exists (select 1 from public.household_record_refs correction where correction.household_id = p_household_id
            and correction.target_kind = 'outcome' and correction.target_id = outcome.record_id and correction.source_kind = 'outcome')
          and not exists (select 1 from jsonb_array_elements(p_changes) c where c->>'kind' = 'outcome'
            and c->'value'->>'correctionOfOutcomeId' = outcome.record_id)
          and ((outcome.value ? 'mealId' and outcome.value->>'mealId' is distinct from changed->'value'->>'mealId')
            or (outcome.value ? 'recipeId' and outcome.value->>'recipeId' is distinct from changed->'value'->>'recipeId')
            or (previous_value ? 'dinnerReadyAt' and changed->'value'->>'mealId' is null))
      ) then return jsonb_build_object('status', 400); end if;
      if exists (
        select 1 from public.household_record_refs link
        join public.household_records lot on lot.household_id = link.household_id
          and lot.kind = 'leftover-lot' and lot.record_id = link.source_id
        where link.household_id = p_household_id and link.target_kind = 'slot' and link.target_id = changed->>'id'
          and link.source_kind = 'leftover-lot' and coalesce(lot.value->>'active', 'true') <> 'false'
          and lot.value->>'sourceMealId' is distinct from changed->'value'->>'mealId'
          and not exists (select 1 from jsonb_array_elements(p_changes) c where c->>'kind' = 'leftover-lot' and c->>'id' = lot.record_id)
      ) then return jsonb_build_object('status', 400); end if;
    end if;

    if changed->>'kind' = 'slot' then
      reference_id := changed->'value'->>'leftoverFromSlotId';
      if reference_id is not null then
        select candidate->'value', candidate->>'planId' into source_value, source_plan_id
        from jsonb_array_elements(p_changes) candidate
        where candidate->>'kind' = 'slot' and candidate->>'id' = reference_id;
        if not found then
          select value, plan_id into source_value, source_plan_id from public.household_records
          where household_id = p_household_id and kind = 'slot' and record_id = reference_id;
        end if;
        select candidate->'value' into source_meal from jsonb_array_elements(p_changes) candidate
        where candidate->>'kind' = 'meal' and candidate->>'id' = source_value->>'mealId';
        if not found then
          select value into source_meal from public.household_records
          where household_id = p_household_id and kind = 'meal' and record_id = source_value->>'mealId';
        end if;
        if source_value is null or source_plan_id is distinct from changed->>'planId'
          or source_value->>'mealId' is distinct from changed->'value'->>'mealId'
          or source_value->>'date' is null or changed->'value'->>'date' is null
          or source_value->>'date' >= changed->'value'->>'date'
          or source_value ? 'leftoverFromSlotId'
          or jsonb_array_length(coalesce(source_value->'leftoverLotIds', '[]'::jsonb)) > 0
          or source_meal->>'plannedLeftoverDinner' is distinct from 'true'
        then return jsonb_build_object('status', 400); end if;
      end if;
      if reference_id is not null and (
        exists (select 1 from jsonb_array_elements(p_changes) other
          where other->>'kind' = 'slot' and other->>'id' <> changed->>'id'
            and other->'value'->>'leftoverFromSlotId' = reference_id)
        or exists (select 1 from public.household_record_refs ref
          where ref.household_id = p_household_id and ref.target_kind = 'slot'
            and ref.target_id = reference_id and ref.source_kind = 'slot'
            and ref.source_id <> changed->>'id'
            and not exists (select 1 from jsonb_array_elements(p_changes) other
              where other->>'kind' = 'slot' and other->>'id' = ref.source_id))
      ) then return jsonb_build_object('status', 400); end if;
      for reference_id in select jsonb_array_elements_text(coalesce(changed->'value'->'leftoverLotIds', '[]'::jsonb)) loop
        if exists (select 1 from jsonb_array_elements(p_changes) other
          where other->>'kind' = 'slot' and other->>'id' <> changed->>'id'
            and coalesce(other->'value'->'leftoverLotIds', '[]'::jsonb) ? reference_id)
          or exists (select 1 from public.household_record_refs ref
            join public.household_records consumer on consumer.household_id = ref.household_id
              and consumer.kind = 'slot' and consumer.record_id = ref.source_id
            where ref.household_id = p_household_id and ref.target_kind = 'leftover-lot'
              and ref.target_id = reference_id and ref.source_kind = 'slot'
              and ref.source_id <> changed->>'id'
              and coalesce(consumer.value->'leftoverLotIds', '[]'::jsonb) ? reference_id
              and not exists (select 1 from jsonb_array_elements(p_changes) other
                where other->>'kind' = 'slot' and other->>'id' = ref.source_id))
        then return jsonb_build_object('status', 400); end if;
      end loop;
      if previous_value->>'date' is distinct from changed->'value'->>'date' and exists (
        select 1 from public.household_record_refs lot_source
        join public.household_record_refs lot_consumer on lot_consumer.household_id = lot_source.household_id
          and lot_consumer.target_kind = 'leftover-lot' and lot_consumer.target_id = lot_source.source_id
          and lot_consumer.source_kind = 'slot'
        join public.household_records consumer on consumer.household_id = lot_consumer.household_id
          and consumer.kind = 'slot' and consumer.record_id = lot_consumer.source_id
        where lot_source.household_id = p_household_id and lot_source.target_kind = 'slot'
          and lot_source.target_id = changed->>'id' and lot_source.source_kind = 'leftover-lot'
          and coalesce((select coalesce(updated->'value'->'leftoverLotIds', '[]'::jsonb) from jsonb_array_elements(p_changes) updated
            where updated->>'kind' = 'slot' and updated->>'id' = consumer.record_id),
            consumer.value->'leftoverLotIds', '[]'::jsonb) ? lot_source.source_id
          and coalesce((select updated->'value'->>'date' from jsonb_array_elements(p_changes) updated
            where updated->>'kind' = 'slot' and updated->>'id' = consumer.record_id),
            consumer.value->>'date') <= changed->'value'->>'date'
      ) then return jsonb_build_object('status', 400); end if;
      if exists (
        select 1 from public.household_record_refs ref
        join public.household_records target on target.household_id = ref.household_id
          and target.kind = 'slot' and target.record_id = ref.source_id
        left join public.household_records meal on meal.household_id = ref.household_id
          and meal.kind = 'meal' and meal.record_id = changed->'value'->>'mealId'
        where ref.household_id = p_household_id and ref.target_kind = 'slot'
          and ref.target_id = changed->>'id' and ref.source_kind = 'slot'
          and not exists (select 1 from jsonb_array_elements(p_changes) candidate
            where candidate->>'kind' = 'slot' and candidate->>'id' = target.record_id)
          and (changed->'value'->>'mealId' is distinct from target.value->>'mealId'
            or changed->>'planId' is distinct from target.plan_id
            or changed->'value'->>'date' >= target.value->>'date'
            or changed->'value' ? 'leftoverFromSlotId'
            or jsonb_array_length(coalesce(changed->'value'->'leftoverLotIds', '[]'::jsonb)) > 0
            or coalesce((select candidate->'value'->>'plannedLeftoverDinner'
                from jsonb_array_elements(p_changes) candidate
                where candidate->>'kind' = 'meal' and candidate->>'id' = changed->'value'->>'mealId'),
              meal.value->>'plannedLeftoverDinner') is distinct from 'true')
      ) then return jsonb_build_object('status', 400); end if;
    end if;

    if changed->>'kind' = 'outcome' and changed->'value' ? 'correctionOfOutcomeId' then
      if exists (select 1 from public.household_record_refs ref where ref.household_id = p_household_id
        and ref.target_kind = 'outcome' and ref.target_id = changed->'value'->>'correctionOfOutcomeId'
        and ref.source_kind = 'outcome' and ref.source_id <> changed->>'id') then return jsonb_build_object('status', 400); end if;
    end if;

    if changed->>'kind' = 'settings' and previous_value is not null then
      for reference_id in select diner->>'id' from jsonb_array_elements(previous_value->'diners') diner
        where not exists (select 1 from jsonb_array_elements(changed->'value'->'diners') next where next->>'id' = diner->>'id') loop
        if exists (select 1 from public.household_record_refs ref where ref.household_id = p_household_id
          and ref.target_kind = 'diner' and ref.target_id = reference_id
          and not exists (select 1 from jsonb_array_elements(p_changes) c where c->>'kind' = ref.source_kind and c->>'id' = ref.source_id)) then
          return jsonb_build_object('status', 400);
        end if;
      end loop;
    end if;

    if changed->>'kind' = 'plan' then
      for reference_id in select item->>'id' from jsonb_array_elements(coalesce(changed->'value'->'variants', '[]'::jsonb)) item loop
        if exists (select 1 from public.household_record_refs ref where ref.household_id = p_household_id
          and ref.target_kind = 'variant' and ref.target_id = reference_id and ref.source_kind = 'plan'
          and ref.source_id <> changed->>'id') then return jsonb_build_object('status', 400); end if;
      end loop;
    end if;
  end loop;
  -- Validate changed consumers and persisted consumers when their plan is
  -- confirmed. The latter closes the direct-RPC path around API selection checks.
  for changed in
    select entry.value from jsonb_array_elements(p_changes) entry(value)
      where entry.value->>'kind' = 'slot'
    union all
    select jsonb_build_object('value', slot.value)
    from jsonb_array_elements(p_changes) plan,
      public.household_records slot
    where plan->>'kind' = 'plan' and plan->'value'->>'confirmed' = 'true'
      and slot.household_id = p_household_id and slot.kind = 'slot'
      and slot.plan_id = plan->>'id'
      and not exists (select 1 from jsonb_array_elements(p_changes) updated
        where updated->>'kind' = 'slot' and updated->>'id' = slot.record_id)
  loop
    if jsonb_array_length(coalesce(changed->'value'->'leftoverLotIds', '[]'::jsonb)) > 1 then
      return jsonb_build_object('status', 400);
    end if;
    for reference_id in select jsonb_array_elements_text(coalesce(changed->'value'->'leftoverLotIds', '[]'::jsonb)) loop
      select candidate->'value' into lot_value from jsonb_array_elements(p_changes) candidate
      where candidate->>'kind' = 'leftover-lot' and candidate->>'id' = reference_id;
      if not found then
        select value into lot_value from public.household_records
        where household_id = p_household_id and kind = 'leftover-lot' and record_id = reference_id;
      end if;
      source_value := null;
      source_plan_id := null;
      if lot_value->>'sourceSlotId' is not null then
        select candidate->'value', candidate->>'planId' into source_value, source_plan_id from jsonb_array_elements(p_changes) candidate
        where candidate->>'kind' = 'slot' and candidate->>'id' = lot_value->>'sourceSlotId';
        if not found then
          select value, plan_id into source_value, source_plan_id from public.household_records
          where household_id = p_household_id and kind = 'slot' and record_id = lot_value->>'sourceSlotId';
        end if;
      end if;
      if source_value->>'date' is null or changed->'value'->>'date' is null
        or (lot_value ? 'sourcePlanId' and lot_value->>'sourcePlanId' is distinct from source_plan_id)
        or source_value->>'mealId' is distinct from lot_value->>'sourceMealId'
        or source_value->>'date' >= changed->'value'->>'date' then
        return jsonb_build_object('status', 400);
      end if;
    end loop;
  end loop;
  return jsonb_build_object('status', 200);
end;
$$;

create function public.write_household_records(
  p_household_id uuid, p_user_id uuid, p_expected_revision bigint,
  p_key text, p_digest text, p_changes jsonb, p_refs jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  current_revision bigint;
  replay record;
  changed jsonb;
  reference jsonb;
  previous_value jsonb;
  previous_plan_id text;
  previous_position integer;
  prior_effort record;
  selected_slot jsonb;
  guard_result jsonb;
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
  if p_expected_revision is null or current_revision <> p_expected_revision then return jsonb_build_object('status', 409); end if;
  if p_key is null or length(p_key) not between 1 and 128 or p_digest is null or p_digest !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_changes) is distinct from 'array' then
    return jsonb_build_object('status', 400);
  end if;
  if jsonb_array_length(p_changes) not between 1 and 100 then
    return jsonb_build_object('status', 400);
  end if;
  if octet_length(p_changes::text) > 262144 then return jsonb_build_object('status', 413); end if;
  if jsonb_typeof(p_refs) is distinct from 'array' then return jsonb_build_object('status', 400); end if;
  if exists (
    select 1 from jsonb_array_elements(p_changes) entry
    group by entry->>'kind', entry->>'id' having count(*) > 1
  ) then return jsonb_build_object('status', 400); end if;

  for changed in select value from jsonb_array_elements(p_changes) with ordinality as entry(value, ordinal) order by ordinal loop
    if changed->>'kind' is null or changed->>'kind' not in ('settings', 'meal', 'recipe', 'plan', 'slot', 'shopping-item', 'repair', 'outcome', 'leftover-lot')
      or changed->>'id' is null or changed->>'id' !~ '^[A-Za-z0-9_-]{1,128}$'
      or jsonb_typeof(changed->'value') is distinct from 'object'
      or changed->'value'->>'id' is distinct from changed->>'id' and changed->>'kind' <> 'settings'
      or (changed->>'kind' in ('slot', 'shopping-item', 'repair')) <> (changed ? 'planId' and changed ? 'position') then
      return jsonb_build_object('status', 400);
    end if;
    if octet_length((changed->'value')::text) > 32768 then return jsonb_build_object('status', 413); end if;
    if changed->>'kind' in ('slot', 'shopping-item', 'repair') then
      if changed->>'planId' !~ '^[A-Za-z0-9_-]{1,128}$'
        or jsonb_typeof(changed->'position') is distinct from 'number'
        or changed->>'position' !~ '^[0-9]{1,10}$' then return jsonb_build_object('status', 400); end if;
      if (changed->>'position')::bigint > 2147483647 then return jsonb_build_object('status', 400); end if;
    end if;
    if changed->>'kind' = 'shopping-item' and exists (
      select 1 from public.household_records parent where parent.household_id = p_household_id
        and parent.kind = 'plan' and parent.record_id = changed->>'planId' and parent.value ? 'shopping'
    ) then return jsonb_build_object('status', 409); end if;
    select value, plan_id, position into previous_value, previous_plan_id, previous_position from public.household_records
    where household_id = p_household_id and kind = changed->>'kind' and record_id = changed->>'id';
    if found then
      if changed->>'kind' in ('outcome', 'repair', 'shopping-item')
        or (changed->>'kind' = 'plan' and previous_value ? 'shopping'
          and previous_value->'shopping' is distinct from changed->'value'->'shopping')
        or (changed->>'kind' = 'plan' and previous_value->>'confirmed' = 'true'
          and (changed->'value'->>'confirmed' is distinct from 'true'
            or (previous_value - 'shopping') is distinct from ((changed->'value') - 'shopping')))
        or (changed->>'kind' in ('slot', 'shopping-item', 'repair')
          and (previous_plan_id is distinct from changed->>'planId'
            or previous_position is distinct from (changed->>'position')::integer))
        or (changed->>'kind' = 'slot' and previous_value ? 'dinnerReadyAt'
          and previous_value->>'dinnerReadyAt' is distinct from changed->'value'->>'dinnerReadyAt')
        or (changed->>'kind' = 'slot' and previous_value->>'date' is distinct from changed->'value'->>'date'
          and exists (select 1 from public.household_records parent
            where parent.household_id = p_household_id and parent.kind = 'plan'
              and parent.record_id = previous_plan_id and parent.value->>'confirmed' = 'true')) then
        return jsonb_build_object('status', 409);
      end if;
    end if;
  end loop;

  guard_result := public.check_household_record_changes(p_household_id, p_user_id, current_revision, p_changes);
  if guard_result->>'status' <> '200' then return guard_result; end if;

  for changed in select value from jsonb_array_elements(p_changes) with ordinality as entry(value, ordinal) order by ordinal loop
    insert into public.household_records (household_id, kind, record_id, plan_id, position, value)
    values (p_household_id, changed->>'kind', changed->>'id', changed->>'planId', (changed->>'position')::integer, changed->'value')
    on conflict (household_id, kind, record_id) do update
      set plan_id = excluded.plan_id, position = excluded.position, value = excluded.value;
    delete from public.household_record_refs
    where household_id = p_household_id and source_kind = changed->>'kind' and source_id = changed->>'id';
  end loop;
  for reference in select value from jsonb_array_elements(p_refs) with ordinality as entry(value, ordinal) order by ordinal loop
    insert into public.household_record_refs (household_id, source_kind, source_id, target_kind, target_id)
    values (p_household_id, reference->>'sourceKind', reference->>'sourceId', reference->>'targetKind', reference->>'targetId')
    on conflict do nothing;
  end loop;
  for changed in select value from jsonb_array_elements(p_changes) as entry(value) where value->>'kind' = 'meal' loop
    insert into public.household_record_refs (household_id, source_kind, source_id, target_kind, target_id)
    select p_household_id, 'meal', changed->>'id', 'recipe', recipe_id
    from jsonb_array_elements_text(coalesce(changed->'value'->'recipeIds', '[]'::jsonb)) recipe_id
    on conflict do nothing;
  end loop;
  for changed in select value from jsonb_array_elements(p_changes) as entry(value) where value->>'kind' = 'slot' loop
    if changed->'value' ? 'leftoverFromSlotId' then
      insert into public.household_record_refs (household_id, source_kind, source_id, target_kind, target_id)
      values (p_household_id, 'slot', changed->>'id', 'slot', changed->'value'->>'leftoverFromSlotId')
      on conflict do nothing;
    end if;
    insert into public.household_record_refs (household_id, source_kind, source_id, target_kind, target_id)
    select p_household_id, 'slot', changed->>'id', 'leftover-lot', lot_id
    from jsonb_array_elements_text(coalesce(changed->'value'->'leftoverLotIds', '[]'::jsonb)) lot_id
    on conflict do nothing;
  end loop;

  for changed in select value from jsonb_array_elements(p_changes) with ordinality as entry(value, ordinal) order by ordinal loop
    if changed->>'kind' = 'shopping-item' and changed->'value'->>'availability' = 'unavailable' then
      insert into public.household_unavailable_lines (household_id, plan_id, item_id, normalized_line)
      select p_household_id, changed->>'planId', changed->>'id', public.normalized_ingredient_line(source_line)
      from jsonb_array_elements_text(changed->'value'->'sourceLines') source_line
      on conflict do nothing;
    end if;
  end loop;

  for changed in select value from jsonb_array_elements(p_changes) with ordinality as entry(value, ordinal) order by ordinal loop
    if changed->>'kind' <> 'outcome' then continue; end if;
    if changed->'value' ? 'correctionOfOutcomeId' then
      update public.household_effort_contributions set active = false
      where household_id = p_household_id and outcome_id = changed->'value'->>'correctionOfOutcomeId' and active
      returning meal_id, recipe_id, minutes into prior_effort;
      if found then
        update public.household_effort_totals
        set effort_count = effort_count - 1, effort_sum = effort_sum - prior_effort.minutes
        where household_id = p_household_id and meal_id = prior_effort.meal_id and recipe_id = prior_effort.recipe_id;
      end if;
    end if;
    select value into selected_slot from public.household_records
    where household_id = p_household_id and kind = 'slot' and record_id = changed->'value'->>'planSlotId';
    if changed->'value' ? 'mealId' and changed->'value' ? 'activeEffortMinutes'
      and coalesce(changed->'value'->>'leftoverServing', 'false') <> 'true'
      and not (coalesce(selected_slot ? 'leftoverFromSlotId', false)
        or coalesce(jsonb_array_length(coalesce(selected_slot->'leftoverLotIds', '[]'::jsonb)), 0) > 0) then
      insert into public.household_effort_contributions (household_id, outcome_id, meal_id, recipe_id, minutes)
      values (p_household_id, changed->>'id', changed->'value'->>'mealId', coalesce(changed->'value'->>'recipeId', ''), (changed->'value'->>'activeEffortMinutes')::integer);
      insert into public.household_effort_totals (household_id, meal_id, recipe_id, effort_count, effort_sum)
      values (p_household_id, changed->'value'->>'mealId', coalesce(changed->'value'->>'recipeId', ''), 1, (changed->'value'->>'activeEffortMinutes')::integer)
      on conflict (household_id, meal_id, recipe_id) do update
        set effort_count = public.household_effort_totals.effort_count + 1,
            effort_sum = public.household_effort_totals.effort_sum + excluded.effort_sum;
    end if;
  end loop;

  update public.households set revision = revision + 1 where id = p_household_id returning revision into current_revision;
  insert into public.household_record_requests (household_id, actor_id, operation, request_key, payload_digest, revision)
  values (p_household_id, p_user_id, 'upsert', p_key, p_digest, current_revision);
  return jsonb_build_object('status', 200, 'revision', current_revision);
end;
$$;

revoke all on function public.normalized_ingredient_line(text), public.read_household_records(uuid, uuid, text, bigint, bigint, integer), public.read_household_dependencies(uuid, uuid, bigint, jsonb, jsonb, text[], bigint, integer), public.read_household_effort(uuid, uuid, bigint, jsonb, jsonb, jsonb), public.check_household_record_changes(uuid, uuid, bigint, jsonb), public.write_household_records(uuid, uuid, bigint, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.normalized_ingredient_line(text), public.read_household_records(uuid, uuid, text, bigint, bigint, integer), public.read_household_dependencies(uuid, uuid, bigint, jsonb, jsonb, text[], bigint, integer), public.read_household_effort(uuid, uuid, bigint, jsonb, jsonb, jsonb), public.check_household_record_changes(uuid, uuid, bigint, jsonb), public.write_household_records(uuid, uuid, bigint, text, text, jsonb, jsonb) to service_role;
