-- Archived strategies and hidden safety backups are not visible named plans,
-- so their internal labels must not block a student from reusing a name.
update public.plan_versions
set archived_at = coalesce(updated_at, now())
where archived_at is null
  and kind <> 'active'
  and generation_config ->> 'archived' = 'true';

create or replace function public.create_plan_version_v3(
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
  target_user_id uuid := (select auth.uid());
  clean_label text := nullif(trim(p_label), '');
begin
  if target_user_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if clean_label is null or length(clean_label) > 100 then raise exception 'Plan names must contain 1 to 100 characters.'; end if;

  update public.plan_versions version
  set label = left(version.label, 72) || ' · backup ' || left(version.id::text, 8),
      updated_at = now()
  from public.four_year_plans plan
  where version.plan_id = plan.id
    and version.user_id = target_user_id
    and plan.user_id = target_user_id
    and plan.is_active
    and version.archived_at is null
    and version.generation_config ->> 'role' = 'backup'
    and lower(version.label) = lower(clean_label);

  return public.create_plan_version_v2(
    clean_label,
    p_source_version_id,
    p_activate,
    p_start_empty,
    p_role,
    p_strategy
  );
end;
$$;

revoke all on function public.create_plan_version_v3(text, uuid, boolean, boolean, text, text) from public;
grant execute on function public.create_plan_version_v3(text, uuid, boolean, boolean, text, text) to authenticated;

comment on function public.create_plan_version_v3(text, uuid, boolean, boolean, text, text) is
  'Creates a named plan without allowing archived strategies or hidden safety-backup labels to create false name conflicts.';
