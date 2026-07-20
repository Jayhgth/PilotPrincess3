-- Include the small manual GE completion slice in the initial workspace
-- snapshot so every degree surface evaluates the same student evidence.

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
    ),
    'manual_smccd_completions', coalesce((
      select jsonb_agg(to_jsonb(completion) order by completion.college_code, completion.area)
      from public.student_smccd_ge_completions completion
      where completion.user_id = (select auth.uid())
    ), '[]'::jsonb)
  )
  from base left join readiness on true;
$$;

revoke all on function public.get_workspace_snapshot_v1() from public;
grant execute on function public.get_workspace_snapshot_v1() to authenticated;

comment on function public.get_workspace_snapshot_v1() is
  'Versioned initial workspace snapshot including school support and manual degree-progress evidence.';
