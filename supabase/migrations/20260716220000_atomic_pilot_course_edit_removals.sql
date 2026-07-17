-- Extend the atomic Pilot edit boundary so a single student request can
-- replace a sequence and remove superseded editable rows without partial state.
create or replace function public.apply_pilot_plan_course_edits_v1(p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_user_id uuid := (select auth.uid());
  requested_count integer;
  updated_count integer := 0;
  deleted_count integer := 0;
  result jsonb;
begin
  if target_user_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Course edits must be an array.'; end if;

  requested_count := jsonb_array_length(p_rows);
  if requested_count = 0 or requested_count > 250 then
    raise exception 'Course edits must contain between 1 and 250 rows.';
  end if;
  if (select count(distinct (item ->> 'id')::uuid) from jsonb_array_elements(p_rows) item) <> requested_count then
    raise exception 'Each course may be edited only once per operation.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) item
    left join public.plan_courses course on course.id = (item ->> 'id')::uuid and course.user_id = target_user_id
    where course.id is null
  ) then raise exception 'One or more courses are unavailable.'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) item
    join public.plan_courses course on course.id = (item ->> 'id')::uuid and course.user_id = target_user_id
    where course.source_review_item_id is not null or course.status = 'completed'
  ) then raise exception 'Completed and transcript-backed courses cannot be edited here.'; end if;

  delete from public.plan_courses course
  where course.user_id = target_user_id
    and course.id in (
      select (item ->> 'id')::uuid
      from jsonb_array_elements(p_rows) item
      where coalesce((item ->> 'remove')::boolean, false)
    );
  get diagnostics deleted_count = row_count;

  with edits as (
    select
      (item ->> 'id')::uuid as id,
      nullif(item ->> 'course_id', '')::uuid as course_id,
      nullif(item ->> 'smccd_course_id', '') as smccd_course_id,
      nullif(item ->> 'college_provider_code', '') as college_provider_code,
      nullif(trim(item ->> 'custom_course_name'), '') as custom_course_name,
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
    from jsonb_array_elements(p_rows) item
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
  where course.id = edit.id and course.user_id = target_user_id;
  get diagnostics updated_count = row_count;

  if updated_count + deleted_count <> requested_count then
    raise exception 'The complete course edit could not be applied.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(course) order by course.grade_level, course.sort_order), '[]'::jsonb)
  into result
  from public.plan_courses course
  where course.user_id = target_user_id
    and course.id in (select (item ->> 'id')::uuid from jsonb_array_elements(p_rows) item);

  return jsonb_build_object('updated_count', updated_count, 'deleted_count', deleted_count, 'rows', result);
end;
$$;

revoke all on function public.apply_pilot_plan_course_edits_v1(jsonb) from public;
grant execute on function public.apply_pilot_plan_course_edits_v1(jsonb) to authenticated;

