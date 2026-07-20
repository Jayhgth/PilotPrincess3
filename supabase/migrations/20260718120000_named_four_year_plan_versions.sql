-- Surface the existing plan-version model as named, switchable four-year
-- plans. All lifecycle operations are atomic and continue to rely on the
-- existing user-owned RLS policies.
alter table public.plan_versions
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists archived_at timestamptz;

update public.plan_versions
set label = 'New plan'
where kind = 'active'
  and (trim(label) = '' or lower(trim(label)) in ('active plan', 'current plan'));

create or replace function public.normalize_default_plan_version_label()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.kind = 'active' and (trim(new.label) = '' or lower(trim(new.label)) in ('active plan', 'current plan')) then
    new.label := 'New plan';
  end if;
  return new;
end;
$$;

drop trigger if exists plan_versions_normalize_default_label on public.plan_versions;
create trigger plan_versions_normalize_default_label
before insert or update of label, kind on public.plan_versions
for each row execute function public.normalize_default_plan_version_label();

update public.plan_versions
set generation_config = coalesce(generation_config, '{}'::jsonb) || jsonb_build_object(
  'role', case
    when kind = 'active' then 'plan'
    when label ilike 'Before %' then 'backup'
    else coalesce(generation_config ->> 'role', 'plan')
  end
)
where generation_config ->> 'role' is null;

create index if not exists plan_versions_visible_history_idx
  on public.plan_versions (plan_id, archived_at, updated_at desc);

create or replace function public.touch_owned_plan_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_version_id uuid;
begin
  target_version_id := coalesce(new.plan_version_id, old.plan_version_id);
  update public.plan_versions
  set updated_at = now()
  where id = target_version_id
    and user_id = (select auth.uid());
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists plan_courses_touch_plan_version on public.plan_courses;
create trigger plan_courses_touch_plan_version
after insert or update or delete on public.plan_courses
for each row execute function public.touch_owned_plan_version();

create or replace function public.list_plan_versions_v1()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    to_jsonb(version) || jsonb_build_object(
      'course_count', (
        select count(*)
        from public.plan_courses course
        where course.plan_version_id = version.id
          and course.user_id = (select auth.uid())
      )
    )
    order by case when version.kind = 'active' then 0 when version.generation_config ->> 'role' = 'plan' then 1 else 2 end,
      version.updated_at desc
  ), '[]'::jsonb)
  from public.plan_versions version
  join public.four_year_plans plan on plan.id = version.plan_id
  where version.user_id = (select auth.uid())
    and plan.user_id = (select auth.uid())
    and plan.is_active
    and version.archived_at is null;
$$;

create or replace function public.create_plan_version_v1(
  p_label text,
  p_source_version_id uuid default null,
  p_activate boolean default true,
  p_start_empty boolean default false,
  p_role text default 'plan'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_user_id uuid := (select auth.uid());
  target_plan_id uuid;
  source_version_id uuid;
  current_version_id uuid;
  new_version public.plan_versions%rowtype;
  copied_count integer := 0;
  clean_label text := nullif(trim(p_label), '');
begin
  if target_user_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if clean_label is null or length(clean_label) > 100 then raise exception 'Plan names must contain 1 to 100 characters.'; end if;
  if p_role not in ('plan', 'backup') then raise exception 'Unsupported plan-version role.'; end if;

  select plan.id into target_plan_id
  from public.four_year_plans plan
  where plan.user_id = target_user_id and plan.is_active
  limit 1;
  if target_plan_id is null then raise exception 'The active four-year plan is unavailable.'; end if;

  if exists (
    select 1 from public.plan_versions version
    where version.plan_id = target_plan_id
      and version.user_id = target_user_id
      and version.archived_at is null
      and lower(version.label) = lower(clean_label)
  ) then raise exception 'A plan with that name already exists.'; end if;

  select version.id into current_version_id
  from public.plan_versions version
  where version.plan_id = target_plan_id and version.user_id = target_user_id and version.kind = 'active'
  limit 1;
  if current_version_id is null then raise exception 'The active plan version is unavailable.'; end if;

  source_version_id := coalesce(p_source_version_id, current_version_id);
  if not exists (
    select 1 from public.plan_versions version
    where version.id = source_version_id
      and version.plan_id = target_plan_id
      and version.user_id = target_user_id
      and version.archived_at is null
  ) then raise exception 'The source plan is unavailable.'; end if;

  insert into public.plan_versions (
    plan_id, user_id, label, kind, generation_config, ai_summary, updated_at
  ) values (
    target_plan_id, target_user_id, clean_label, 'snapshot',
    jsonb_build_object('role', p_role, 'source_version_id', source_version_id),
    case when p_role = 'backup' then 'Automatic backup before a broad Pilot change.' else null end,
    now()
  ) returning * into new_version;

  if not p_start_empty then
    insert into public.plan_courses (
      plan_version_id, user_id, course_id, custom_course_name, grade_level,
      school_year, term, status, credits, college_units, letter_grade,
      is_weighted, mapping_verified, user_edited, notes, sort_order,
      source_review_item_id, smccd_course_id, college_provider_code,
      requirement_area_override
    )
    select
      new_version.id, target_user_id, course.course_id, course.custom_course_name,
      course.grade_level, course.school_year, course.term, course.status,
      course.credits, course.college_units, course.letter_grade,
      course.is_weighted, course.mapping_verified, course.user_edited,
      course.notes, course.sort_order, course.source_review_item_id,
      course.smccd_course_id, course.college_provider_code,
      course.requirement_area_override
    from public.plan_courses course
    where course.plan_version_id = source_version_id
      and course.user_id = target_user_id;
    get diagnostics copied_count = row_count;
  end if;

  if p_activate then
    update public.plan_versions
    set kind = 'snapshot',
        generation_config = coalesce(generation_config, '{}'::jsonb) || jsonb_build_object('role', 'plan'),
        updated_at = now()
    where id = current_version_id and user_id = target_user_id;

    update public.plan_versions
    set kind = 'active', updated_at = now()
    where id = new_version.id and user_id = target_user_id;
    new_version.kind := 'active';
  end if;

  return to_jsonb(new_version) || jsonb_build_object(
    'course_count', copied_count,
    'previous_active_version_id', current_version_id
  );
end;
$$;

create or replace function public.activate_plan_version_v1(p_version_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_user_id uuid := (select auth.uid());
  target public.plan_versions%rowtype;
  previous_version_id uuid;
begin
  if target_user_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  select version.* into target
  from public.plan_versions version
  join public.four_year_plans plan on plan.id = version.plan_id
  where version.id = p_version_id
    and version.user_id = target_user_id
    and plan.user_id = target_user_id
    and plan.is_active
    and version.archived_at is null;
  if target.id is null then raise exception 'That plan is unavailable.'; end if;

  select version.id into previous_version_id
  from public.plan_versions version
  where version.plan_id = target.plan_id and version.user_id = target_user_id and version.kind = 'active'
  limit 1;
  if previous_version_id = target.id then
    return to_jsonb(target) || jsonb_build_object('previous_active_version_id', previous_version_id);
  end if;

  update public.plan_versions
  set kind = 'snapshot',
      generation_config = coalesce(generation_config, '{}'::jsonb) || jsonb_build_object('role', 'plan'),
      updated_at = now()
  where id = previous_version_id and user_id = target_user_id;

  update public.plan_versions
  set kind = 'active',
      generation_config = coalesce(generation_config, '{}'::jsonb) || jsonb_build_object('role', 'plan'),
      updated_at = now()
  where id = target.id and user_id = target_user_id
  returning * into target;

  return to_jsonb(target) || jsonb_build_object('previous_active_version_id', previous_version_id);
end;
$$;

create or replace function public.rename_plan_version_v1(p_version_id uuid, p_label text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_user_id uuid := (select auth.uid());
  clean_label text := nullif(trim(p_label), '');
  target public.plan_versions%rowtype;
begin
  if target_user_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if clean_label is null or length(clean_label) > 100 then raise exception 'Plan names must contain 1 to 100 characters.'; end if;
  select * into target from public.plan_versions
  where id = p_version_id and user_id = target_user_id and archived_at is null;
  if target.id is null then raise exception 'That plan is unavailable.'; end if;
  if exists (
    select 1 from public.plan_versions version
    where version.plan_id = target.plan_id and version.user_id = target_user_id
      and version.id <> target.id and version.archived_at is null
      and lower(version.label) = lower(clean_label)
  ) then raise exception 'A plan with that name already exists.'; end if;
  update public.plan_versions set label = clean_label, updated_at = now()
  where id = target.id and user_id = target_user_id returning * into target;
  return to_jsonb(target);
end;
$$;

create or replace function public.archive_plan_version_v1(p_version_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_user_id uuid := (select auth.uid());
  target public.plan_versions%rowtype;
begin
  if target_user_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  select * into target from public.plan_versions
  where id = p_version_id and user_id = target_user_id and archived_at is null;
  if target.id is null then raise exception 'That plan is unavailable.'; end if;
  if target.kind = 'active' then raise exception 'Switch to another plan before deleting the active plan.'; end if;
  update public.plan_versions set archived_at = now(), updated_at = now()
  where id = target.id and user_id = target_user_id returning * into target;
  return to_jsonb(target);
end;
$$;

create or replace function public.restore_plan_version_v1(p_version_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_user_id uuid := (select auth.uid());
  target public.plan_versions%rowtype;
begin
  if target_user_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  update public.plan_versions set archived_at = null, updated_at = now()
  where id = p_version_id and user_id = target_user_id and archived_at is not null
  returning * into target;
  if target.id is null then raise exception 'That deleted plan is no longer available.'; end if;
  return to_jsonb(target);
end;
$$;

revoke all on function public.list_plan_versions_v1() from public;
revoke all on function public.create_plan_version_v1(text, uuid, boolean, boolean, text) from public;
revoke all on function public.activate_plan_version_v1(uuid) from public;
revoke all on function public.rename_plan_version_v1(uuid, text) from public;
revoke all on function public.archive_plan_version_v1(uuid) from public;
revoke all on function public.restore_plan_version_v1(uuid) from public;

grant execute on function public.list_plan_versions_v1() to authenticated;
grant execute on function public.create_plan_version_v1(text, uuid, boolean, boolean, text) to authenticated;
grant execute on function public.activate_plan_version_v1(uuid) to authenticated;
grant execute on function public.rename_plan_version_v1(uuid, text) to authenticated;
grant execute on function public.archive_plan_version_v1(uuid) to authenticated;
grant execute on function public.restore_plan_version_v1(uuid) to authenticated;

comment on function public.create_plan_version_v1(text, uuid, boolean, boolean, text) is
  'Creates a complete named four-year plan or backup from an owned plan version and optionally activates it atomically.';
comment on function public.activate_plan_version_v1(uuid) is
  'Switches the active named four-year plan without copying or losing either version.';
