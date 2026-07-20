-- Preserve a separate academic workspace for every selected high school.
-- Account preferences remain user-owned, while courses, plan versions,
-- degree bookmarks, and college-district choices follow the selected school.

alter table public.student_smccd_goals
  add column if not exists plan_id uuid references public.four_year_plans(id) on delete cascade;

update public.student_smccd_goals goal
set plan_id = plan.id
from public.four_year_plans plan
where goal.plan_id is null
  and plan.user_id = goal.user_id
  and plan.is_active;

-- New accounts always have an active plan. Keep a defensive fallback for old
-- rows created before workspace provisioning became mandatory.
insert into public.four_year_plans (user_id, school_id, title, is_active)
select distinct goal.user_id, settings.school_id, 'My four-year plan', false
from public.student_smccd_goals goal
join public.student_settings settings on settings.id = goal.user_id
where goal.plan_id is null and settings.school_id is not null
  and not exists (
    select 1 from public.four_year_plans existing
    where existing.user_id = goal.user_id and existing.school_id = settings.school_id
  )
on conflict do nothing;

update public.student_smccd_goals goal
set plan_id = (
  select plan.id
  from public.four_year_plans plan
  where plan.user_id = goal.user_id
  order by plan.is_active desc, plan.created_at
  limit 1
)
where goal.plan_id is null;

alter table public.student_smccd_goals alter column plan_id set not null;
alter table public.student_smccd_goals drop constraint if exists student_smccd_goals_user_id_program_id_key;
drop index if exists public.student_smccd_goals_one_primary;
create unique index if not exists student_smccd_goals_plan_program_unique
  on public.student_smccd_goals(plan_id, program_id);
create unique index if not exists student_smccd_goals_one_primary_per_plan
  on public.student_smccd_goals(plan_id) where is_primary;
create index if not exists student_smccd_goals_user_plan_idx
  on public.student_smccd_goals(user_id, plan_id, created_at);

create unique index if not exists four_year_plans_user_school_unique
  on public.four_year_plans(user_id, school_id);

-- Create a strategy plan in one client round trip while preserving the stable
-- v1 lifecycle contract used by older clients.
create or replace function public.create_plan_version_v2(
  p_label text,
  p_source_version_id uuid default null,
  p_activate boolean default true,
  p_start_empty boolean default false,
  p_role text default 'plan',
  p_strategy text default 'balanced'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created jsonb;
  updated public.plan_versions%rowtype;
begin
  if p_strategy not in ('balanced', 'highest_gpa', 'degree_overlap', 'minimum_courses') then
    raise exception 'Unsupported plan strategy.' using errcode = '22023';
  end if;
  created := public.create_plan_version_v1(
    p_label,
    p_source_version_id,
    p_activate,
    p_start_empty,
    p_role
  );
  update public.plan_versions
  set generation_config = coalesce(generation_config, '{}'::jsonb) || jsonb_build_object('strategy', p_strategy),
      updated_at = now()
  where id = (created ->> 'id')::uuid and user_id = (select auth.uid())
  returning * into updated;
  return to_jsonb(updated) || jsonb_build_object(
    'course_count', coalesce((created ->> 'course_count')::integer, 0),
    'previous_active_version_id', created ->> 'previous_active_version_id'
  );
end;
$$;

-- College-district choice is school context, not a global account override.
update public.student_college_district_preferences preference
set school_id_at_selection = settings.school_id
from public.student_settings settings
where preference.user_id = settings.id and preference.school_id_at_selection is null;

alter table public.student_college_district_preferences
  alter column school_id_at_selection set not null;
alter table public.student_college_district_preferences
  drop constraint if exists student_college_district_preferences_school_id_at_selection_fkey;
alter table public.student_college_district_preferences
  add constraint student_college_district_preferences_school_id_at_selection_fkey
  foreign key (school_id_at_selection) references public.schools(id) on delete cascade;
alter table public.student_college_district_preferences
  drop constraint if exists student_college_district_preferences_pkey;
alter table public.student_college_district_preferences
  add primary key (user_id, school_id_at_selection);

create or replace function public.set_college_district_preference(
  target_district_code text,
  preference_method text default 'student'
)
returns public.student_college_district_preferences
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid := (select auth.uid());
  selected_school_id uuid;
  saved public.student_college_district_preferences;
begin
  if target_user_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if preference_method not in ('suggested', 'student', 'pilot') then
    raise exception 'Invalid college-district selection method.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.college_districts district
    where district.district_code = target_district_code and district.status = 'active'
  ) then
    raise exception 'Choose an active California community-college district.' using errcode = '22023';
  end if;

  select settings.school_id into selected_school_id
  from public.student_settings settings where settings.id = target_user_id;
  if selected_school_id is null then raise exception 'Choose a high school first.' using errcode = '22023'; end if;

  insert into public.student_college_district_preferences (
    user_id, district_code, selection_method, school_id_at_selection
  ) values (
    target_user_id, target_district_code, preference_method, selected_school_id
  )
  on conflict (user_id, school_id_at_selection) do update set
    district_code = excluded.district_code,
    selection_method = excluded.selection_method,
    updated_at = now()
  returning * into saved;
  return saved;
end;
$$;

create or replace function public.select_current_school(target_school_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid := (select auth.uid());
  target_plan_id uuid;
  suggested_district_code text;
begin
  if target_user_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.schools school
    where school.id = target_school_id
      and school.status in ('active', 'pending')
      and school.governance_type in ('district', 'charter')
      and coalesce(school.high_grade, 12) >= 9
  ) then
    raise exception 'Choose an active California public or charter high school.' using errcode = '22023';
  end if;

  update public.four_year_plans set is_active = false, updated_at = now()
  where user_id = target_user_id and is_active;

  select plan.id into target_plan_id
  from public.four_year_plans plan
  where plan.user_id = target_user_id and plan.school_id = target_school_id
  limit 1;

  if target_plan_id is null then
    insert into public.four_year_plans (user_id, school_id, title, is_active)
    values (target_user_id, target_school_id, 'My four-year plan', true)
    returning id into target_plan_id;
    insert into public.plan_versions (plan_id, user_id, label, kind, generation_config)
    values (target_plan_id, target_user_id, 'New plan', 'active', jsonb_build_object('role', 'plan'));
  else
    update public.four_year_plans set is_active = true, updated_at = now()
    where id = target_plan_id and user_id = target_user_id;
    if not exists (
      select 1 from public.plan_versions version
      where version.plan_id = target_plan_id and version.user_id = target_user_id and version.kind = 'active'
    ) then
      insert into public.plan_versions (plan_id, user_id, label, kind, generation_config)
      values (target_plan_id, target_user_id, 'New plan', 'active', jsonb_build_object('role', 'plan'));
    end if;
  end if;

  update public.student_settings
  set school_id = target_school_id, school_confirmed = true,
      school_selected_at = now(), updated_at = now()
  where id = target_user_id;

  if not exists (
    select 1 from public.student_college_district_preferences preference
    where preference.user_id = target_user_id
      and preference.school_id_at_selection = target_school_id
  ) then
    select nearby.district_code into suggested_district_code
    from public.nearby_college_districts(target_school_id, 1) nearby limit 1;
    if suggested_district_code is not null then
      insert into public.student_college_district_preferences (
        user_id, district_code, selection_method, school_id_at_selection
      ) values (target_user_id, suggested_district_code, 'suggested', target_school_id)
      on conflict (user_id, school_id_at_selection) do nothing;
    end if;
  end if;

  return target_plan_id;
end;
$$;

-- One compact refresh request replaces separate plan, GPA, and catalog reads.
create or replace function public.get_plan_workspace_slice_v1(p_version_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with owned_version as (
    select version.id
    from public.plan_versions version
    where version.id = p_version_id and version.user_id = (select auth.uid())
  ), rows as (
    select course.* from public.plan_courses course
    where course.user_id = (select auth.uid())
      and course.plan_version_id in (select id from owned_version)
  )
  select jsonb_build_object(
    'plan_courses', coalesce((select jsonb_agg(to_jsonb(row) order by row.grade_level, row.sort_order, row.created_at) from rows row), '[]'::jsonb),
    'gpa_scenario_choices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'plan_course_id', choice.plan_course_id,
        'included', choice.included,
        'expected_grade', choice.expected_grade
      ))
      from public.student_gpa_scenario_choices choice
      where choice.user_id = (select auth.uid())
        and choice.plan_course_id in (select id from rows)
    ), '[]'::jsonb),
    'planned_college_courses', coalesce((
      select jsonb_agg(to_jsonb(catalog))
      from public.smccd_courses catalog
      where catalog.id in (select row.smccd_course_id from rows row where row.smccd_course_id is not null)
    ), '[]'::jsonb)
  );
$$;

-- Merge selected rows from one named strategy into another atomically. Existing
-- matching courses receive the source placement; new courses are copied.
create or replace function public.merge_plan_version_courses_v1(
  p_source_version_id uuid,
  p_target_version_id uuid,
  p_source_course_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_user_id uuid := (select auth.uid());
  source_plan_id uuid;
  target_plan_id uuid;
  source_row public.plan_courses%rowtype;
  match_id uuid;
  inserted_id uuid;
  inserted_ids uuid[] := array[]::uuid[];
  previous_rows jsonb := '[]'::jsonb;
  changed integer := 0;
begin
  if target_user_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  select plan_id into source_plan_id from public.plan_versions where id = p_source_version_id and user_id = target_user_id;
  select plan_id into target_plan_id from public.plan_versions where id = p_target_version_id and user_id = target_user_id;
  if source_plan_id is null or target_plan_id is null or source_plan_id <> target_plan_id then
    raise exception 'Both plans must belong to the same school workspace.' using errcode = '42501';
  end if;
  if coalesce(array_length(p_source_course_ids, 1), 0) = 0 then
    return jsonb_build_object('changed_count', 0, 'inserted_ids', '[]'::jsonb, 'previous_rows', '[]'::jsonb);
  end if;

  for source_row in
    select * from public.plan_courses
    where user_id = target_user_id and plan_version_id = p_source_version_id and id = any(p_source_course_ids)
    order by grade_level, sort_order, created_at
  loop
    select target.id into match_id
    from public.plan_courses target
    where target.user_id = target_user_id and target.plan_version_id = p_target_version_id
      and (
        (source_row.course_id is not null and target.course_id = source_row.course_id)
        or (source_row.smccd_course_id is not null and target.smccd_course_id = source_row.smccd_course_id)
        or (source_row.course_id is null and source_row.smccd_course_id is null
          and lower(trim(coalesce(target.custom_course_name, ''))) = lower(trim(coalesce(source_row.custom_course_name, ''))))
      )
    limit 1;

    if match_id is null then
      insert into public.plan_courses (
        plan_version_id, user_id, course_id, custom_course_name, grade_level,
        school_year, term, status, credits, college_units, letter_grade,
        is_weighted, mapping_verified, user_edited, notes, sort_order,
        source_review_item_id, smccd_course_id, college_provider_code,
        requirement_area_override
      ) values (
        p_target_version_id, target_user_id, source_row.course_id, source_row.custom_course_name,
        source_row.grade_level, source_row.school_year, source_row.term, source_row.status,
        source_row.credits, source_row.college_units, source_row.letter_grade,
        source_row.is_weighted, source_row.mapping_verified, true, source_row.notes,
        source_row.sort_order, source_row.source_review_item_id, source_row.smccd_course_id,
        source_row.college_provider_code, source_row.requirement_area_override
      ) returning id into inserted_id;
      inserted_ids := array_append(inserted_ids, inserted_id);
    else
      previous_rows := previous_rows || coalesce((
        select jsonb_agg(to_jsonb(target)) from public.plan_courses target
        where target.id = match_id and target.user_id = target_user_id
      ), '[]'::jsonb);
      update public.plan_courses set
        grade_level = source_row.grade_level, school_year = source_row.school_year,
        term = source_row.term, status = source_row.status, credits = source_row.credits,
        college_units = source_row.college_units, is_weighted = source_row.is_weighted,
        notes = source_row.notes, sort_order = source_row.sort_order, user_edited = true,
        requirement_area_override = source_row.requirement_area_override, updated_at = now()
      where id = match_id and user_id = target_user_id;
    end if;
    changed := changed + 1;
    match_id := null;
  end loop;
  return jsonb_build_object(
    'changed_count', changed,
    'inserted_ids', to_jsonb(inserted_ids),
    'previous_rows', previous_rows
  );
end;
$$;

-- Rebuild the bootstrap wrappers so all academic choices are selected from the
-- active school workspace while profile and Pilot preferences remain account-wide.
create or replace function public.get_workspace_bootstrap()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with core as (select public.get_workspace_bootstrap_core() as value),
  active_context as (
    select plan.id as plan_id, plan.school_id
    from public.four_year_plans plan
    where plan.user_id = (select auth.uid()) and plan.is_active limit 1
  ), goals as (
    select goal.* from public.student_smccd_goals goal
    where goal.user_id = (select auth.uid()) and goal.plan_id = (select plan_id from active_context)
  ), programs as (
    select program.* from public.smccd_programs program where program.id in (select program_id from goals)
  ), requirements as (
    select requirement.* from public.smccd_program_requirements requirement
    where requirement.program_id in (select id from programs)
  ), preference as (
    select district_preference.* from public.student_college_district_preferences district_preference
    where district_preference.user_id = (select auth.uid())
      and district_preference.school_id_at_selection = (select school_id from active_context)
    limit 1
  ), district as (
    select college_district.* from public.college_districts college_district
    where college_district.district_code = (select district_code from preference) limit 1
  ), school_sources as (
    select source.* from public.official_sources source
    where source.school_id = (select school_id from active_context)
      and (source.user_id is null or source.user_id = (select auth.uid()))
  )
  select core.value || jsonb_build_object(
    'sources', coalesce((select jsonb_agg(to_jsonb(source) order by source.created_at desc) from school_sources source), '[]'::jsonb),
    'review_items', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.created_at)
      from public.catalog_review_items item
      where item.user_id = (select auth.uid()) and item.source_id in (select id from school_sources)
    ), '[]'::jsonb),
    'degree_goals', coalesce((select jsonb_agg(to_jsonb(goal) order by goal.is_primary desc, goal.created_at) from goals goal), '[]'::jsonb),
    'degree_programs', coalesce((select jsonb_agg(to_jsonb(program)) from programs program), '[]'::jsonb),
    'degree_requirements', coalesce((select jsonb_agg(to_jsonb(requirement) order by requirement.sort_order) from requirements requirement), '[]'::jsonb),
    'degree_requirement_courses', coalesce((
      select jsonb_agg(to_jsonb(option)) from public.smccd_requirement_courses option
      where option.requirement_id in (select id from requirements)
    ), '[]'::jsonb),
    'college_district_preference', (select to_jsonb(preference) from preference),
    'college_district', (select to_jsonb(district) from district),
    'enrollment_preference', case when (select policy_provider_code from district) is null then null else (
      select to_jsonb(enrollment_preference) from public.student_enrollment_preferences enrollment_preference
      where enrollment_preference.user_id = (select auth.uid())
        and enrollment_preference.provider_code = (select policy_provider_code from district) limit 1
    ) end
  ) from core;
$$;

create or replace function public.get_workspace_snapshot_v1()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (select public.get_workspace_bootstrap() as value),
  selected_school as (select (base.value -> 'school' ->> 'id')::uuid as id from base),
  readiness as (select support.* from public.school_support_readiness support where support.school_id = (select id from selected_school)),
  planning_profile as (
    select profile.* from public.school_planning_profiles profile
    where profile.school_id = (select id from selected_school) and profile.status = 'verified'
    order by profile.academic_year desc limit 1
  )
  select base.value || jsonb_build_object(
    'school_support', jsonb_build_object(
      'level', case when readiness.catalog_supported and readiness.diploma_supported and readiness.planning_supported then 'complete'
        when readiness.catalog_supported or readiness.diploma_supported or readiness.planning_supported then 'partial' else 'discovery' end,
      'catalog_supported', coalesce(readiness.catalog_supported, false),
      'diploma_supported', coalesce(readiness.diploma_supported, false),
      'planning_supported', coalesce(readiness.planning_supported, false),
      'last_source_update', readiness.last_source_update
    ),
    'school_planning_profile', (select to_jsonb(profile) from planning_profile profile)
  ) from base left join readiness on true;
$$;

create or replace function public.get_assistant_workspace_bootstrap()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with core as (select public.get_workspace_snapshot_v1() as value),
  selected_school as (select (core.value -> 'school' ->> 'id')::uuid as id from core),
  transcript_sources as (
    select source.* from public.official_sources source
    where source.user_id = (select auth.uid()) and source.school_id = (select id from selected_school)
      and source.document_type = 'transcript'
  )
  select core.value || jsonb_build_object(
    'transcript_sources', coalesce((select jsonb_agg(to_jsonb(source) order by source.created_at desc) from transcript_sources source), '[]'::jsonb),
    'transcript_review_items', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.created_at) from public.catalog_review_items item
      where item.user_id = (select auth.uid()) and item.source_id in (select id from transcript_sources)
        and item.entity_type in ('transcript_course', 'transcript_note')
    ), '[]'::jsonb),
    'prerequisite_clearances', coalesce((select jsonb_agg(to_jsonb(clearance)) from public.student_prerequisite_clearances clearance where clearance.user_id = (select auth.uid())), '[]'::jsonb),
    'memories', coalesce((select jsonb_agg(jsonb_build_object('memory_key', memory.memory_key, 'content', memory.content, 'tags', memory.tags)) from public.ai_student_memories memory where memory.user_id = (select auth.uid()) and memory.is_active), '[]'::jsonb),
    'nearby_providers', coalesce((select jsonb_agg(to_jsonb(provider)) from public.nearby_school_providers((select id from selected_school), 8) provider), '[]'::jsonb),
    'nearby_college_districts', coalesce((select jsonb_agg(to_jsonb(district)) from public.nearby_college_districts((select id from selected_school), 8) district), '[]'::jsonb)
  ) from core;
$$;

create or replace function public.clear_pilot_academic_plan(
  p_clear_courses boolean,
  p_clear_degree_bookmarks boolean,
  p_clear_gpa_scenario boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  active_plan_id uuid;
  active_version_id uuid;
  plan_rows jsonb := '[]'::jsonb;
  goal_rows jsonb := '[]'::jsonb;
  gpa_rows jsonb := '[]'::jsonb;
begin
  if current_user_id is null then raise exception 'Authentication is required.'; end if;
  select plan.id, version.id into active_plan_id, active_version_id
  from public.four_year_plans plan
  join public.plan_versions version on version.plan_id = plan.id and version.kind = 'active'
  where plan.user_id = current_user_id and plan.is_active limit 1;
  if active_version_id is null then raise exception 'The active academic plan is unavailable.'; end if;

  if p_clear_courses then
    select coalesce(jsonb_agg(to_jsonb(course) order by course.sort_order, course.id), '[]'::jsonb) into plan_rows
    from public.plan_courses course
    where course.user_id = current_user_id and course.plan_version_id = active_version_id and course.source_review_item_id is null;
  end if;
  if p_clear_degree_bookmarks then
    select coalesce(jsonb_agg(to_jsonb(goal) order by goal.created_at, goal.id), '[]'::jsonb) into goal_rows
    from public.student_smccd_goals goal
    where goal.user_id = current_user_id and goal.plan_id = active_plan_id;
  end if;
  select coalesce(jsonb_agg(to_jsonb(choice) order by choice.plan_course_id), '[]'::jsonb) into gpa_rows
  from public.student_gpa_scenario_choices choice
  where choice.user_id = current_user_id and (
    (p_clear_gpa_scenario and exists (
      select 1 from public.plan_courses course
      where course.id = choice.plan_course_id and course.plan_version_id = active_version_id
    ))
    or (p_clear_courses and exists (select 1 from jsonb_array_elements(plan_rows) row where row->>'id' = choice.plan_course_id::text))
  );

  if p_clear_gpa_scenario then
    delete from public.student_gpa_scenario_choices choice
    where choice.user_id = current_user_id and exists (
      select 1 from public.plan_courses course
      where course.id = choice.plan_course_id and course.plan_version_id = active_version_id
    );
  end if;
  if p_clear_courses then
    delete from public.plan_courses where user_id = current_user_id and plan_version_id = active_version_id and source_review_item_id is null;
  end if;
  if p_clear_degree_bookmarks then
    delete from public.student_smccd_goals where user_id = current_user_id and plan_id = active_plan_id;
  end if;
  return jsonb_build_object('plan_rows', plan_rows, 'goal_rows', goal_rows, 'gpa_rows', gpa_rows);
end;
$$;

create or replace function public.restore_pilot_academic_plan(
  p_plan_rows jsonb,
  p_goal_rows jsonb,
  p_gpa_rows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'Authentication is required.'; end if;
  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_plan_rows, '[]'::jsonb)) as saved(id uuid, user_id uuid)
    join public.plan_courses current on current.id = saved.id where saved.user_id = current_user_id
  ) then raise exception 'This plan changed after the clear operation, so newer course data cannot be overwritten.'; end if;

  insert into public.plan_courses (
    id, plan_version_id, user_id, course_id, custom_course_name, grade_level, school_year, term, status,
    credits, college_units, letter_grade, is_weighted, mapping_verified, user_edited, notes, sort_order,
    source_review_item_id, smccd_course_id, college_provider_code, requirement_area_override
  )
  select id, plan_version_id, user_id, course_id, custom_course_name, grade_level, school_year, term, status,
    credits, college_units, letter_grade, is_weighted, mapping_verified, user_edited, notes, sort_order,
    source_review_item_id, smccd_course_id, college_provider_code, requirement_area_override
  from jsonb_populate_recordset(null::public.plan_courses, coalesce(p_plan_rows, '[]'::jsonb)) saved
  where saved.user_id = current_user_id;

  insert into public.student_smccd_goals (id, user_id, plan_id, program_id, is_primary, notes)
  select id, user_id, plan_id, program_id, is_primary, notes
  from jsonb_populate_recordset(null::public.student_smccd_goals, coalesce(p_goal_rows, '[]'::jsonb)) saved
  where saved.user_id = current_user_id
  on conflict (plan_id, program_id) do nothing;

  insert into public.student_gpa_scenario_choices (user_id, plan_course_id, included, expected_grade)
  select user_id, plan_course_id, included, expected_grade
  from jsonb_populate_recordset(null::public.student_gpa_scenario_choices, coalesce(p_gpa_rows, '[]'::jsonb)) saved
  where saved.user_id = current_user_id
  on conflict (user_id, plan_course_id) do update set included = excluded.included, expected_grade = excluded.expected_grade;

  return jsonb_build_object(
    'courses_restored', jsonb_array_length(coalesce(p_plan_rows, '[]'::jsonb)),
    'degree_bookmarks_restored', jsonb_array_length(coalesce(p_goal_rows, '[]'::jsonb)),
    'gpa_assumptions_restored', jsonb_array_length(coalesce(p_gpa_rows, '[]'::jsonb))
  );
end;
$$;

revoke all on function public.get_plan_workspace_slice_v1(uuid) from public;
revoke all on function public.merge_plan_version_courses_v1(uuid, uuid, uuid[]) from public;
revoke all on function public.create_plan_version_v2(text, uuid, boolean, boolean, text, text) from public;
grant execute on function public.get_plan_workspace_slice_v1(uuid) to authenticated;
grant execute on function public.merge_plan_version_courses_v1(uuid, uuid, uuid[]) to authenticated;
grant execute on function public.create_plan_version_v2(text, uuid, boolean, boolean, text, text) to authenticated;
grant execute on function public.get_workspace_bootstrap() to authenticated;
grant execute on function public.get_workspace_snapshot_v1() to authenticated;
grant execute on function public.get_assistant_workspace_bootstrap() to authenticated;
grant execute on function public.clear_pilot_academic_plan(boolean, boolean, boolean) to authenticated;
grant execute on function public.restore_pilot_academic_plan(jsonb, jsonb, jsonb) to authenticated;

comment on function public.select_current_school(uuid) is
  'Selects or restores a school-isolated academic workspace without moving records between schools.';
comment on function public.get_plan_workspace_slice_v1(uuid) is
  'One-request plan refresh containing owned course rows, scoped GPA assumptions, and referenced college catalog rows.';
comment on function public.create_plan_version_v2(text, uuid, boolean, boolean, text, text) is
  'Creates, optionally activates, and labels a complete strategy plan atomically in one client request.';
