create table public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by text not null check (char_length(granted_by) between 1 and 120)
);

alter table public.app_admins enable row level security;

create policy "admins read own membership" on public.app_admins
for select to authenticated
using ((select auth.uid()) = user_id);

comment on table public.app_admins is
  'Non-resettable application administrator membership. Membership is provisioned only by trusted database migrations or service-role operations.';

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_admins
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_app_admin() from public;
grant execute on function public.is_app_admin() to authenticated;

-- Initial testing administrator requested by the project owner. Admin access is
-- tied to the existing auth user ID so changing resettable profile data cannot
-- grant or remove the role.
insert into public.app_admins (user_id, granted_by)
select id, 'project-owner bootstrap migration'
from auth.users
where lower(email) = 'jiachenhuo55@gmail.com'
on conflict (user_id) do nothing;

create or replace function public.reset_current_admin_workspace()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid := (select auth.uid());
  school_uuid uuid;
  plan_uuid uuid;
  preferred_name_value text;
begin
  if target_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.app_admins where user_id = target_user_id
  ) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  select id into school_uuid
  from public.schools
  where slug = 'design-tech-high-school'
  limit 1;

  if school_uuid is null then
    raise exception 'The default d.tech school record is missing.';
  end if;

  select coalesce(raw_user_meta_data ->> 'preferred_name', '')
  into preferred_name_value
  from auth.users
  where id = target_user_id;

  -- Clear every student-owned record. Catalogs, requirements, schools, and the
  -- app_admins membership are intentionally outside this reset boundary.
  delete from public.ai_conversations where user_id = target_user_id;
  delete from public.student_prerequisite_clearances where user_id = target_user_id;
  delete from public.student_smccd_goals where user_id = target_user_id;
  delete from public.generated_summaries where user_id = target_user_id;
  delete from public.simulations where user_id = target_user_id;
  delete from public.simulation_configs where user_id = target_user_id;
  delete from public.gpa_records where user_id = target_user_id;
  delete from public.grade_records where user_id = target_user_id;
  delete from public.timeline_tasks where user_id = target_user_id;
  delete from public.activities where user_id = target_user_id;
  delete from public.catalog_review_items where user_id = target_user_id;
  delete from public.parse_jobs where user_id = target_user_id;
  delete from public.four_year_plans where user_id = target_user_id;
  delete from public.official_sources where user_id = target_user_id;
  delete from public.event_logs where user_id = target_user_id;
  delete from public.student_profiles where id = target_user_id;

  -- Recreate the same minimal records made at signup. The auth user and admin
  -- membership remain intact, while onboarding starts from a clean state.
  insert into public.student_profiles (id, school_id, preferred_name)
  values (target_user_id, school_uuid, preferred_name_value);

  insert into public.four_year_plans (user_id, school_id)
  values (target_user_id, school_uuid)
  returning id into plan_uuid;

  insert into public.plan_versions (plan_id, user_id, label, kind)
  values (plan_uuid, target_user_id, 'Current plan', 'active');

  return jsonb_build_object(
    'ok', true,
    'adminPreserved', true,
    'onboardingComplete', false,
    'resetAt', now()
  );
end;
$$;

revoke all on function public.reset_current_admin_workspace() from public;
grant execute on function public.reset_current_admin_workspace() to authenticated;

comment on function public.reset_current_admin_workspace() is
  'Admin-only self-service test reset. Deletes the caller''s student workspace and recreates signup defaults without deleting auth or administrator membership.';
