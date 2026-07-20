-- Load the authenticated student workspace in one request. The function is
-- security-invoker so every underlying table keeps enforcing its existing RLS
-- policy; it only removes client/server round trips and dependency waterfalls.
create or replace function public.get_workspace_bootstrap()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with
  current_settings as (
    select settings.*
    from public.student_settings settings
    where settings.id = (select auth.uid())
    limit 1
  ),
  active_plan as (
    select plan.*
    from public.four_year_plans plan
    where plan.user_id = (select auth.uid())
      and plan.is_active
    limit 1
  ),
  selected_school as (
    select school.*
    from public.schools school
    where school.id = coalesce(
      (select settings.school_id from current_settings settings),
      (select plan.school_id from active_plan plan)
    )
    limit 1
  ),
  active_version as (
    select version.*
    from public.plan_versions version
    where version.plan_id = (select plan.id from active_plan plan)
      and version.user_id = (select auth.uid())
      and version.kind = 'active'
    order by version.created_at desc
    limit 1
  ),
  selected_courses as (
    select course.*
    from public.courses course
    where course.school_id = (select school.id from selected_school school)
      and course.review_status = 'approved'
  ),
  selected_plan_courses as (
    select course.*
    from public.plan_courses course
    where course.plan_version_id = (select version.id from active_version version)
      and course.user_id = (select auth.uid())
  )
  select jsonb_build_object(
    'settings', (select to_jsonb(settings) from current_settings settings),
    'plan', (select to_jsonb(plan) from active_plan plan),
    'school', (select to_jsonb(school) from selected_school school),
    'active_version', (select to_jsonb(version) from active_version version),
    'sources', coalesce((
      select jsonb_agg(to_jsonb(source) order by source.is_official desc, source.created_at desc)
      from public.official_sources source
      where source.school_id = (select school.id from selected_school school)
         or source.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'courses', coalesce((
      select jsonb_agg(to_jsonb(course) order by course.subject, course.name)
      from selected_courses course
    ), '[]'::jsonb),
    'requirements', coalesce((
      select jsonb_agg(to_jsonb(requirement) order by requirement.name)
      from public.graduation_requirements requirement
      where requirement.school_id = (select school.id from selected_school school)
        and requirement.review_status = 'approved'
    ), '[]'::jsonb),
    'mappings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', mapping.id,
        'course_id', mapping.course_id,
        'requirement_id', mapping.requirement_id,
        'source_id', mapping.source_id,
        'confidence', mapping.confidence,
        'is_user_override', mapping.is_user_override
      ))
      from public.course_requirement_mappings mapping
      join selected_courses course on course.id = mapping.course_id
    ), '[]'::jsonb),
    'course_designations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', designation.id,
        'course_id', designation.course_id,
        'designation', designation.designation,
        'source_url', designation.source_url,
        'source_year', designation.source_year,
        'confidence', designation.confidence,
        'review_status', designation.review_status
      ))
      from public.course_designations designation
      join selected_courses course on course.id = designation.course_id
      where designation.review_status = 'approved'
    ), '[]'::jsonb),
    'equivalencies', coalesce((
      select jsonb_agg(to_jsonb(equivalency) order by equivalency.normalized_course_code)
      from public.smccd_high_school_equivalencies equivalency
      where (select school.slug from selected_school school) = 'design-tech-high-school'
    ), '[]'::jsonb),
    'review_items', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.created_at desc)
      from public.catalog_review_items item
      where item.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'enrollment_policies', coalesce((
      select jsonb_agg(to_jsonb(policy) order by policy.provider_code, policy.program_type)
      from public.enrollment_policies policy
    ), '[]'::jsonb),
    'enrollment_preference', (
      select to_jsonb(preference)
      from public.student_enrollment_preferences preference
      where preference.user_id = (select auth.uid())
        and preference.provider_code = 'SMCCD'
      limit 1
    ),
    'plan_courses', coalesce((
      select jsonb_agg(to_jsonb(course) order by course.grade_level, course.sort_order)
      from selected_plan_courses course
    ), '[]'::jsonb),
    'gpa_scenario_choices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'plan_course_id', choice.plan_course_id,
        'included', choice.included,
        'expected_grade', choice.expected_grade
      ))
      from public.student_gpa_scenario_choices choice
      where choice.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'planned_smccd_courses', coalesce((
      select jsonb_agg(to_jsonb(course))
      from public.smccd_courses course
      where course.id in (
        select plan_course.smccd_course_id
        from selected_plan_courses plan_course
        where plan_course.smccd_course_id is not null
      )
    ), '[]'::jsonb),
    'is_admin', public.is_app_admin()
  );
$$;

revoke all on function public.get_workspace_bootstrap() from public;
grant execute on function public.get_workspace_bootstrap() to authenticated;

comment on function public.get_workspace_bootstrap() is
  'RLS-protected initial workspace snapshot used to avoid the client query waterfall.';
