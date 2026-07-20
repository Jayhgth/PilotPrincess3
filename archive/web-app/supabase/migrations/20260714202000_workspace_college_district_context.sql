-- Keep the initial app bootstrap district-aware without adding another client
-- request. SMCCD policy is returned only when the selected district maps to
-- that reviewed policy; other districts never inherit SMCCD limits.

create or replace function public.get_workspace_bootstrap()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with core as (
    select public.get_workspace_bootstrap_core() as value
  ), goals as (
    select goal.* from public.student_smccd_goals goal
    where goal.user_id = (select auth.uid())
  ), programs as (
    select program.* from public.smccd_programs program
    where program.id in (select goal.program_id from goals goal)
  ), requirements as (
    select requirement.* from public.smccd_program_requirements requirement
    where requirement.program_id in (select program.id from programs program)
  ), preference as (
    select district_preference.*
    from public.student_college_district_preferences district_preference
    where district_preference.user_id = (select auth.uid())
    limit 1
  ), district as (
    select college_district.*
    from public.college_districts college_district
    where college_district.district_code = (select preference.district_code from preference)
    limit 1
  )
  select core.value || jsonb_build_object(
    'degree_goals', coalesce((
      select jsonb_agg(to_jsonb(goal) order by goal.is_primary desc, goal.created_at) from goals goal
    ), '[]'::jsonb),
    'degree_programs', coalesce((
      select jsonb_agg(to_jsonb(program)) from programs program
    ), '[]'::jsonb),
    'degree_requirements', coalesce((
      select jsonb_agg(to_jsonb(requirement) order by requirement.sort_order) from requirements requirement
    ), '[]'::jsonb),
    'degree_requirement_courses', coalesce((
      select jsonb_agg(to_jsonb(option)) from public.smccd_requirement_courses option
      where option.requirement_id in (select requirement.id from requirements requirement)
    ), '[]'::jsonb),
    'college_district_preference', (select to_jsonb(preference) from preference),
    'college_district', (select to_jsonb(district) from district),
    'enrollment_preference', case
      when (select district.policy_provider_code from district) is null then null
      else (
        select to_jsonb(enrollment_preference)
        from public.student_enrollment_preferences enrollment_preference
        where enrollment_preference.user_id = (select auth.uid())
          and enrollment_preference.provider_code = (select district.policy_provider_code from district)
        limit 1
      )
    end
  )
  from core;
$$;

revoke all on function public.get_workspace_bootstrap() from public;
grant execute on function public.get_workspace_bootstrap() to authenticated;

comment on function public.get_workspace_bootstrap() is
  'RLS-protected initial workspace snapshot with the selected college district and only its reviewed enrollment-policy preference.';
