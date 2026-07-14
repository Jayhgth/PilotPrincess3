-- Keep the core workspace snapshot reusable while folding the small bookmarked
-- degree slice into the same initial network request used by the dashboard.
alter function public.get_workspace_bootstrap() rename to get_workspace_bootstrap_core;

revoke all on function public.get_workspace_bootstrap_core() from public;
grant execute on function public.get_workspace_bootstrap_core() to authenticated;

create or replace function public.get_workspace_bootstrap()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with
  core as (
    select public.get_workspace_bootstrap_core() as value
  ),
  goals as (
    select goal.*
    from public.student_smccd_goals goal
    where goal.user_id = (select auth.uid())
  ),
  programs as (
    select program.*
    from public.smccd_programs program
    where program.id in (select goal.program_id from goals goal)
  ),
  requirements as (
    select requirement.*
    from public.smccd_program_requirements requirement
    where requirement.program_id in (select program.id from programs program)
  )
  select core.value || jsonb_build_object(
    'degree_goals', coalesce((
      select jsonb_agg(to_jsonb(goal) order by goal.is_primary desc, goal.created_at)
      from goals goal
    ), '[]'::jsonb),
    'degree_programs', coalesce((
      select jsonb_agg(to_jsonb(program))
      from programs program
    ), '[]'::jsonb),
    'degree_requirements', coalesce((
      select jsonb_agg(to_jsonb(requirement) order by requirement.sort_order)
      from requirements requirement
    ), '[]'::jsonb),
    'degree_requirement_courses', coalesce((
      select jsonb_agg(to_jsonb(option))
      from public.smccd_requirement_courses option
      where option.requirement_id in (select requirement.id from requirements requirement)
    ), '[]'::jsonb)
  )
  from core;
$$;

revoke all on function public.get_workspace_bootstrap() from public;
grant execute on function public.get_workspace_bootstrap() to authenticated;

comment on function public.get_workspace_bootstrap() is
  'RLS-protected workspace and bookmarked-degree snapshot used for initial application load.';
