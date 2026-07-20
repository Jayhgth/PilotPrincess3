create function public.replace_pilot_course_schedule_v2(
  p_target_plan_version_id uuid,
  p_course_rows jsonb,
  p_grade_levels smallint[] default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := (select auth.uid());
  removed_plan_rows jsonb := '[]'::jsonb;
  removed_gpa_rows jsonb := '[]'::jsonb;
  inserted_ids jsonb := '[]'::jsonb;
begin
  if current_user_id is null then raise exception 'Authentication is required.'; end if;
  if p_target_plan_version_id is null then raise exception 'Choose the named plan to rebuild.'; end if;
  if jsonb_typeof(coalesce(p_course_rows, '[]'::jsonb)) <> 'array' then raise exception 'Course rows must be an array.'; end if;
  if jsonb_array_length(coalesce(p_course_rows, '[]'::jsonb)) > 96 then raise exception 'A generated schedule cannot exceed 96 courses.'; end if;
  if exists (
    select 1 from unnest(coalesce(p_grade_levels, '{}'::smallint[])) grade_level
    where grade_level not between 9 and 12
  ) then
    raise exception 'Replacement grade levels must be between 9 and 12.';
  end if;

  if not exists (
    select 1
    from public.plan_versions version
    join public.four_year_plans plan on plan.id = version.plan_id
    where version.id = p_target_plan_version_id
      and version.kind = 'active'
      and plan.user_id = current_user_id
      and plan.is_active
  ) then
    raise exception 'The selected named plan is no longer active. Refresh it before applying this schedule.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(course) order by course.sort_order, course.id), '[]'::jsonb)
  into removed_plan_rows
  from public.plan_courses course
  where course.user_id = current_user_id
    and course.plan_version_id = p_target_plan_version_id
    and course.source_review_item_id is null
    and (coalesce(cardinality(p_grade_levels), 0) = 0 or course.grade_level = any(p_grade_levels));

  select coalesce(jsonb_agg(to_jsonb(choice) order by choice.plan_course_id), '[]'::jsonb)
  into removed_gpa_rows
  from public.student_gpa_scenario_choices choice
  where choice.user_id = current_user_id
    and exists (
      select 1 from jsonb_array_elements(removed_plan_rows) row
      where row->>'id' = choice.plan_course_id::text
    );

  delete from public.plan_courses
  where user_id = current_user_id
    and plan_version_id = p_target_plan_version_id
    and source_review_item_id is null
    and (coalesce(cardinality(p_grade_levels), 0) = 0 or grade_level = any(p_grade_levels));

  with inserted as (
    insert into public.plan_courses (
      plan_version_id, user_id, course_id, custom_course_name, grade_level, school_year, term, status,
      credits, college_units, letter_grade, is_weighted, mapping_verified, user_edited, notes, sort_order,
      source_review_item_id, smccd_course_id, college_provider_code, requirement_area_override
    )
    select
      p_target_plan_version_id, current_user_id, saved.course_id, null, saved.grade_level, saved.school_year,
      saved.term, saved.status, saved.credits, saved.college_units, null, saved.is_weighted,
      saved.mapping_verified, saved.user_edited, null, saved.sort_order, null, saved.smccd_course_id,
      saved.college_provider_code, saved.requirement_area_override
    from jsonb_populate_recordset(null::public.plan_courses, coalesce(p_course_rows, '[]'::jsonb)) saved
    where coalesce(cardinality(p_grade_levels), 0) = 0 or saved.grade_level = any(p_grade_levels)
    returning id
  )
  select coalesce(jsonb_agg(id), '[]'::jsonb) into inserted_ids from inserted;

  if jsonb_array_length(inserted_ids) <> jsonb_array_length(coalesce(p_course_rows, '[]'::jsonb)) then
    raise exception 'The complete generated schedule was not inserted in the requested grade scope.';
  end if;

  return jsonb_build_object(
    'plan_version_id', p_target_plan_version_id,
    'plan_rows', removed_plan_rows,
    'gpa_rows', removed_gpa_rows,
    'inserted_plan_course_ids', inserted_ids
  );
end;
$$;

grant execute on function public.replace_pilot_course_schedule_v2(uuid, jsonb, smallint[]) to authenticated;
