-- Apply a targeted Pilot course rewrite as one transaction, including any
-- prerequisite-ordered additions. This prevents a later course from being
-- inserted when an earlier sequence edit fails.
create or replace function public.apply_pilot_plan_course_patch_v2(
  p_edits jsonb default '[]'::jsonb,
  p_additions jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_user_id uuid := (select auth.uid());
  active_version_id uuid;
  edit_count integer := pg_catalog.jsonb_array_length(coalesce(p_edits, '[]'::jsonb));
  addition_count integer := pg_catalog.jsonb_array_length(coalesce(p_additions, '[]'::jsonb));
  updated_count integer := 0;
  deleted_count integer := 0;
  inserted_count integer := 0;
  inserted_ids jsonb := '[]'::jsonb;
begin
  if target_user_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if pg_catalog.jsonb_typeof(coalesce(p_edits, '[]'::jsonb)) <> 'array'
    or pg_catalog.jsonb_typeof(coalesce(p_additions, '[]'::jsonb)) <> 'array'
  then raise exception 'Course edits and additions must be arrays.'; end if;
  if edit_count + addition_count = 0 or edit_count + addition_count > 250 then
    raise exception 'A course patch must contain between 1 and 250 rows.';
  end if;

  select version.id into active_version_id
  from public.four_year_plans plan
  join public.plan_versions version on version.plan_id = plan.id and version.kind = 'active'
  where plan.user_id = target_user_id and plan.is_active
  limit 1;
  if active_version_id is null then raise exception 'The active academic plan is unavailable.'; end if;

  if edit_count > 0 and (
    select count(distinct (item ->> 'id')::uuid)
    from pg_catalog.jsonb_array_elements(p_edits) item
  ) <> edit_count then raise exception 'Each existing course may be edited only once.'; end if;
  if addition_count > 0 and (
    select count(distinct (item ->> 'id')::uuid)
    from pg_catalog.jsonb_array_elements(p_additions) item
  ) <> addition_count then raise exception 'Each added course must have a unique identity.'; end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_edits) item
    left join public.plan_courses course
      on course.id = (item ->> 'id')::uuid
      and course.user_id = target_user_id
      and course.plan_version_id = active_version_id
    where course.id is null
  ) then raise exception 'One or more courses are unavailable.'; end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_edits) item
    join public.plan_courses course
      on course.id = (item ->> 'id')::uuid
      and course.user_id = target_user_id
      and course.plan_version_id = active_version_id
    where course.source_review_item_id is not null or course.status = 'completed'
  ) then raise exception 'Completed and transcript-backed courses cannot be edited here.'; end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_additions) item
    join public.plan_courses course on course.id = (item ->> 'id')::uuid
  ) then raise exception 'One or more added course identities already exist.'; end if;

  delete from public.plan_courses course
  where course.user_id = target_user_id
    and course.plan_version_id = active_version_id
    and course.id in (
      select (item ->> 'id')::uuid
      from pg_catalog.jsonb_array_elements(p_edits) item
      where coalesce((item ->> 'remove')::boolean, false)
    );
  get diagnostics deleted_count = row_count;

  with edits as (
    select
      (item ->> 'id')::uuid as id,
      nullif(item ->> 'course_id', '')::uuid as course_id,
      nullif(item ->> 'smccd_course_id', '') as smccd_course_id,
      nullif(item ->> 'college_provider_code', '') as college_provider_code,
      nullif(pg_catalog.btrim(item ->> 'custom_course_name'), '') as custom_course_name,
      (item ->> 'grade_level')::integer as grade_level,
      item ->> 'school_year' as school_year,
      item ->> 'term' as term,
      nullif(item ->> 'letter_grade', '') as letter_grade,
      nullif(item ->> 'notes', '') as notes,
      nullif(item ->> 'credits', '')::numeric as credits,
      nullif(item ->> 'college_units', '')::numeric as college_units,
      (item ->> 'is_weighted')::boolean as is_weighted,
      (item ->> 'mapping_verified')::boolean as mapping_verified,
      nullif(item ->> 'requirement_area_override', '')::public.requirement_area as requirement_area_override
    from pg_catalog.jsonb_array_elements(p_edits) item
    where not coalesce((item ->> 'remove')::boolean, false)
  )
  update public.plan_courses course
  set course_id = edit.course_id,
      smccd_course_id = edit.smccd_course_id,
      college_provider_code = edit.college_provider_code,
      custom_course_name = edit.custom_course_name,
      grade_level = edit.grade_level,
      school_year = edit.school_year,
      term = edit.term,
      letter_grade = edit.letter_grade,
      notes = edit.notes,
      credits = edit.credits,
      college_units = edit.college_units,
      is_weighted = edit.is_weighted,
      mapping_verified = edit.mapping_verified,
      requirement_area_override = edit.requirement_area_override,
      user_edited = true,
      updated_at = now()
  from edits edit
  where course.id = edit.id
    and course.user_id = target_user_id
    and course.plan_version_id = active_version_id;
  get diagnostics updated_count = row_count;

  with inserted as (
    insert into public.plan_courses (
      id, plan_version_id, user_id, course_id, custom_course_name, grade_level,
      school_year, term, status, credits, college_units, letter_grade,
      is_weighted, mapping_verified, user_edited, notes, sort_order,
      source_review_item_id, smccd_course_id, college_provider_code,
      requirement_area_override
    )
    select
      saved.id, active_version_id, target_user_id, saved.course_id,
      saved.custom_course_name, saved.grade_level, saved.school_year, saved.term,
      saved.status, saved.credits, saved.college_units, saved.letter_grade,
      saved.is_weighted, saved.mapping_verified, true, saved.notes,
      saved.sort_order, null, saved.smccd_course_id, saved.college_provider_code,
      saved.requirement_area_override
    from pg_catalog.jsonb_populate_recordset(null::public.plan_courses, p_additions) saved
    returning id
  )
  select count(*), coalesce(pg_catalog.jsonb_agg(id), '[]'::jsonb)
  into inserted_count, inserted_ids
  from inserted;

  if updated_count + deleted_count <> edit_count or inserted_count <> addition_count then
    raise exception 'The complete course patch could not be applied.';
  end if;

  return pg_catalog.jsonb_build_object(
    'updated_count', updated_count,
    'deleted_count', deleted_count,
    'inserted_count', inserted_count,
    'inserted_plan_course_ids', inserted_ids
  );
end;
$$;

revoke all on function public.apply_pilot_plan_course_patch_v2(jsonb, jsonb) from public;
grant execute on function public.apply_pilot_plan_course_patch_v2(jsonb, jsonb) to authenticated;
