-- Keep the student-visible plan audit and Pilot on the same verified school
-- planning profile. This adds one compact object to the existing atomic
-- workspace snapshot instead of introducing another initial-load request.

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
  ), planning_profile as (
    select profile.*
    from public.school_planning_profiles profile
    where profile.school_id = (select id from selected_school)
      and profile.status = 'verified'
    order by profile.academic_year desc
    limit 1
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
    'school_planning_profile', (select to_jsonb(profile) from planning_profile profile)
  )
  from base left join readiness on true;
$$;

revoke all on function public.get_workspace_snapshot_v1() from public;
grant execute on function public.get_workspace_snapshot_v1() to authenticated;
