-- Consolidate the authenticated workspace read model, expose school support
-- readiness, and provide atomic commands for the highest-churn course flows.

create or replace function public.ensure_current_user_workspace_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid := (select auth.uid());
  school_uuid uuid;
  plan_uuid uuid;
  version_uuid uuid;
  preferred_name_value text;
begin
  if target_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  select id into school_uuid
  from public.schools
  where slug = 'california-high-school-unselected'
  limit 1;
  if school_uuid is null then raise exception 'The onboarding school placeholder is missing.'; end if;

  select coalesce(
    nullif(trim(raw_user_meta_data ->> 'preferred_name'), ''),
    nullif(trim(raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(raw_user_meta_data ->> 'name'), ''),
    ''
  ) into preferred_name_value
  from auth.users
  where id = target_user_id;

  insert into public.student_settings (id, school_id, preferred_name)
  values (target_user_id, school_uuid, preferred_name_value)
  on conflict (id) do nothing;

  select id into plan_uuid
  from public.four_year_plans
  where user_id = target_user_id and is_active
  order by created_at
  limit 1;
  if plan_uuid is null then
    insert into public.four_year_plans (user_id, school_id)
    values (target_user_id, coalesce((select school_id from public.student_settings where id = target_user_id), school_uuid))
    returning id into plan_uuid;
  end if;

  select id into version_uuid
  from public.plan_versions
  where plan_id = plan_uuid and user_id = target_user_id and kind = 'active'
  order by created_at
  limit 1;
  if version_uuid is null then
    insert into public.plan_versions (plan_id, user_id, label, kind)
    values (plan_uuid, target_user_id, 'Current plan', 'active')
    returning id into version_uuid;
  end if;

  return jsonb_build_object(
    'user_id', target_user_id,
    'settings_ready', true,
    'plan_id', plan_uuid,
    'active_version_id', version_uuid
  );
end;
$$;

revoke all on function public.ensure_current_user_workspace_v1() from public;
grant execute on function public.ensure_current_user_workspace_v1() to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  school_uuid uuid;
  plan_uuid uuid;
  preferred_name_value text;
begin
  select id into school_uuid
  from public.schools
  where slug = 'california-high-school-unselected'
  limit 1;
  if school_uuid is null then raise exception 'The onboarding school placeholder is missing.'; end if;

  preferred_name_value := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'preferred_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    ''
  );

  insert into public.student_settings (id, school_id, preferred_name)
  values (new.id, school_uuid, preferred_name_value)
  on conflict (id) do nothing;

  select id into plan_uuid from public.four_year_plans where user_id = new.id and is_active limit 1;
  if plan_uuid is null then
    insert into public.four_year_plans (user_id, school_id)
    values (new.id, school_uuid)
    returning id into plan_uuid;
  end if;

  insert into public.plan_versions (plan_id, user_id, label, kind)
  select plan_uuid, new.id, 'Current plan', 'active'
  where not exists (
    select 1 from public.plan_versions where plan_id = plan_uuid and user_id = new.id and kind = 'active'
  );
  return new;
end;
$$;

create or replace view public.school_support_readiness
with (security_invoker = true)
as
select
  school.id as school_id,
  exists (
    select 1
    from public.courses course
    join public.catalog_versions version on version.id = course.catalog_version_id
    where course.school_id = school.id
      and course.review_status = 'approved'
      and version.is_current
  ) as catalog_supported,
  exists (
    select 1 from public.graduation_requirements requirement
    where requirement.school_id = school.id and requirement.review_status = 'approved'
  ) and exists (
    select 1
    from public.course_requirement_mappings mapping
    join public.courses course on course.id = mapping.course_id
    where course.school_id = school.id
  ) as diploma_supported,
  exists (
    select 1 from public.school_planning_profiles profile
    where profile.school_id = school.id
      and profile.status = 'verified'
  ) as planning_supported,
  (
    select max(source.updated_at)
    from public.official_sources source
    where source.school_id = school.id and source.is_official
  ) as last_source_update
from public.schools school;

grant select on public.school_support_readiness to anon, authenticated;

drop function if exists public.search_california_high_schools(text, integer);
create function public.search_california_high_schools(
  query_text text default '',
  result_limit integer default 20
)
returns table (
  id uuid,
  cds_code text,
  name text,
  district_name text,
  county_name text,
  governance_type text,
  city text,
  postal_code text,
  low_grade integer,
  high_grade integer,
  website_url text,
  support_level text,
  catalog_supported boolean,
  diploma_supported boolean,
  planning_supported boolean,
  last_source_update timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    school.id,
    school.cds_code,
    school.name,
    school.district_name,
    school.county_name,
    school.governance_type,
    school.city,
    school.postal_code,
    school.low_grade,
    school.high_grade,
    school.website_url,
    case
      when readiness.catalog_supported and readiness.diploma_supported and readiness.planning_supported then 'complete'
      when readiness.catalog_supported or readiness.diploma_supported or readiness.planning_supported then 'partial'
      else 'discovery'
    end,
    readiness.catalog_supported,
    readiness.diploma_supported,
    readiness.planning_supported,
    readiness.last_source_update
  from public.schools school
  join public.school_support_readiness readiness on readiness.school_id = school.id
  where school.status in ('active', 'pending')
    and school.governance_type in ('district', 'charter')
    and coalesce(school.high_grade, 12) >= 9
    and (
      coalesce(trim(query_text), '') = ''
      or school.name ilike '%' || trim(query_text) || '%'
      or coalesce(school.district_name, '') ilike '%' || trim(query_text) || '%'
      or coalesce(school.city, '') ilike '%' || trim(query_text) || '%'
      or coalesce(school.postal_code, '') = trim(query_text)
      or coalesce(school.cds_code, '') = regexp_replace(trim(query_text), '[^0-9]', '', 'g')
    )
  order by
    case when lower(school.name) = lower(trim(query_text)) then 0 else 1 end,
    case when readiness.catalog_supported and readiness.diploma_supported and readiness.planning_supported then 0
         when readiness.catalog_supported or readiness.diploma_supported or readiness.planning_supported then 1
         else 2 end,
    school.name,
    school.city
  limit least(greatest(result_limit, 1), 50);
$$;

grant execute on function public.search_california_high_schools(text, integer) to anon, authenticated;

create or replace function public.get_workspace_snapshot_v1()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select public.get_workspace_bootstrap() as value
  ), selected_school as (
    select (base.value -> 'school' ->> 'id')::uuid as id from base
  ), readiness as (
    select support.*
    from public.school_support_readiness support
    where support.school_id = (select id from selected_school)
  )
  select base.value || jsonb_build_object(
    'school_support', jsonb_build_object(
      'level', case
        when readiness.catalog_supported and readiness.diploma_supported and readiness.planning_supported then 'complete'
        when readiness.catalog_supported or readiness.diploma_supported or readiness.planning_supported then 'partial'
        else 'discovery'
      end,
      'catalog_supported', coalesce(readiness.catalog_supported, false),
      'diploma_supported', coalesce(readiness.diploma_supported, false),
      'planning_supported', coalesce(readiness.planning_supported, false),
      'last_source_update', readiness.last_source_update
    )
  )
  from base left join readiness on true;
$$;

revoke all on function public.get_workspace_snapshot_v1() from public;
grant execute on function public.get_workspace_snapshot_v1() to authenticated;

create or replace function public.apply_plan_course_updates_v1(p_updates jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_user_id uuid := (select auth.uid());
  update_count integer;
  result jsonb;
begin
  if target_user_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if jsonb_typeof(p_updates) <> 'array' or jsonb_array_length(p_updates) > 250 then
    raise exception 'Course updates must be a bounded array.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_updates) as patch(id uuid, grade_level integer, school_year text, term text, status text, sort_order integer, letter_grade text, user_edited boolean)
    left join public.plan_courses course on course.id = patch.id and course.user_id = target_user_id
    where course.id is null
  ) then raise exception 'One or more courses are unavailable.'; end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_updates) as patch(id uuid, grade_level integer, school_year text, term text, status text, sort_order integer, letter_grade text, user_edited boolean)
    join public.plan_courses course on course.id = patch.id and course.user_id = target_user_id
    where (course.source_review_item_id is not null or course.status = 'completed')
      and (course.grade_level, course.school_year, course.term, course.status::text, course.letter_grade)
        is distinct from (patch.grade_level, patch.school_year, patch.term, patch.status, patch.letter_grade)
  ) then raise exception 'Completed and transcript-backed courses cannot be moved.'; end if;

  with patches as (
    select * from jsonb_to_recordset(p_updates) as patch(id uuid, grade_level integer, school_year text, term text, status text, sort_order integer, letter_grade text, user_edited boolean)
  )
  update public.plan_courses course
  set grade_level = patch.grade_level,
      school_year = patch.school_year,
      term = patch.term,
      status = patch.status::public.course_status,
      sort_order = patch.sort_order,
      letter_grade = patch.letter_grade,
      user_edited = patch.user_edited,
      updated_at = now()
  from patches patch
  where course.id = patch.id and course.user_id = target_user_id;
  get diagnostics update_count = row_count;

  select coalesce(jsonb_agg(to_jsonb(course) order by course.grade_level, course.sort_order), '[]'::jsonb)
  into result
  from public.plan_courses course
  where course.user_id = target_user_id
    and course.id in (select (item ->> 'id')::uuid from jsonb_array_elements(p_updates) item);
  return jsonb_build_object('updated_count', update_count, 'rows', result);
end;
$$;

revoke all on function public.apply_plan_course_updates_v1(jsonb) from public;
grant execute on function public.apply_plan_course_updates_v1(jsonb) to authenticated;

create or replace function public.commit_transcript_import_v1(
  p_plan_version_id uuid,
  p_approved_ids uuid[],
  p_rejected_ids uuid[],
  p_corrections jsonb,
  p_plan_rows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_user_id uuid := (select auth.uid());
  saved_rows jsonb;
begin
  if target_user_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.plan_versions version
    where version.id = p_plan_version_id and version.user_id = target_user_id and version.kind = 'active'
  ) then raise exception 'The active plan is unavailable.'; end if;
  if jsonb_typeof(p_plan_rows) <> 'array' or jsonb_array_length(p_plan_rows) > 250 then
    raise exception 'Transcript rows must be a bounded array.';
  end if;
  if jsonb_typeof(p_corrections) <> 'array' or jsonb_array_length(p_corrections) > 250 then
    raise exception 'Transcript corrections must be a bounded array.';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_approved_ids, '{}'::uuid[]) || coalesce(p_rejected_ids, '{}'::uuid[])) requested_id
    left join public.catalog_review_items item on item.id = requested_id and item.user_id = target_user_id and item.entity_type = 'transcript_course'
    where item.id is null
  ) then raise exception 'One or more transcript rows are unavailable.'; end if;

  update public.catalog_review_items
  set status = 'approved', updated_at = now()
  where user_id = target_user_id and id = any(coalesce(p_approved_ids, '{}'::uuid[]));
  update public.catalog_review_items
  set status = 'rejected', updated_at = now()
  where user_id = target_user_id and id = any(coalesce(p_rejected_ids, '{}'::uuid[]));

  with corrections as (
    select * from jsonb_to_recordset(p_corrections) as correction(id uuid, payload jsonb)
  )
  update public.catalog_review_items item
  set corrected_payload = correction.payload, updated_at = now()
  from corrections correction
  where item.id = correction.id
    and item.user_id = target_user_id
    and item.entity_type = 'transcript_course'
    and item.status = 'approved';

  with rows as (
    select * from jsonb_to_recordset(p_plan_rows) as row(
      id uuid,
      course_id uuid,
      custom_course_name text,
      grade_level integer,
      school_year text,
      term text,
      status text,
      credits numeric,
      college_units numeric,
      letter_grade text,
      is_weighted boolean,
      mapping_verified boolean,
      user_edited boolean,
      notes text,
      sort_order integer,
      source_review_item_id uuid,
      smccd_course_id text,
      college_provider_code text,
      requirement_area_override text
    )
  )
  insert into public.plan_courses (
    id, plan_version_id, user_id, course_id, custom_course_name, grade_level, school_year, term, status,
    credits, college_units, letter_grade, is_weighted, mapping_verified, user_edited, notes, sort_order,
    source_review_item_id, smccd_course_id, college_provider_code, requirement_area_override
  )
  select
    row.id, p_plan_version_id, target_user_id, row.course_id, row.custom_course_name, row.grade_level, row.school_year,
    row.term, row.status::public.course_status, row.credits, row.college_units, row.letter_grade, row.is_weighted,
    row.mapping_verified, row.user_edited, row.notes, row.sort_order, row.source_review_item_id, row.smccd_course_id,
    row.college_provider_code, nullif(row.requirement_area_override, '')::public.requirement_area
  from rows row
  join public.catalog_review_items item on item.id = row.source_review_item_id
    and item.user_id = target_user_id
    and item.status = 'approved'
    and item.entity_type = 'transcript_course'
  on conflict (id) do update set
    course_id = excluded.course_id,
    custom_course_name = excluded.custom_course_name,
    grade_level = excluded.grade_level,
    school_year = excluded.school_year,
    term = excluded.term,
    status = excluded.status,
    credits = excluded.credits,
    college_units = excluded.college_units,
    letter_grade = excluded.letter_grade,
    is_weighted = excluded.is_weighted,
    mapping_verified = excluded.mapping_verified,
    user_edited = excluded.user_edited,
    notes = excluded.notes,
    sort_order = excluded.sort_order,
    source_review_item_id = excluded.source_review_item_id,
    smccd_course_id = excluded.smccd_course_id,
    college_provider_code = excluded.college_provider_code,
    requirement_area_override = excluded.requirement_area_override,
    updated_at = now();

  select coalesce(jsonb_agg(to_jsonb(course) order by course.grade_level, course.sort_order), '[]'::jsonb)
  into saved_rows
  from public.plan_courses course
  where course.user_id = target_user_id
    and course.source_review_item_id = any(coalesce(p_approved_ids, '{}'::uuid[]));
  return jsonb_build_object('rows', saved_rows, 'imported_count', jsonb_array_length(saved_rows));
end;
$$;

revoke all on function public.commit_transcript_import_v1(uuid, uuid[], uuid[], jsonb, jsonb) from public;
grant execute on function public.commit_transcript_import_v1(uuid, uuid[], uuid[], jsonb, jsonb) to authenticated;
