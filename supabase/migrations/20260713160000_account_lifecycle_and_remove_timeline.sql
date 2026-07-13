drop table if exists public.timeline_tasks;
drop type if exists public.timeline_category;
drop table if exists public.grade_records;
drop table if exists public.gpa_records;
drop table if exists public.generated_summaries;

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

  delete from public.ai_conversations where user_id = target_user_id;
  delete from public.student_prerequisite_clearances where user_id = target_user_id;
  delete from public.student_smccd_goals where user_id = target_user_id;
  delete from public.student_smccd_ge_completions where user_id = target_user_id;
  delete from public.student_enrollment_preferences where user_id = target_user_id;
  delete from public.catalog_review_items where user_id = target_user_id;
  delete from public.parse_jobs where user_id = target_user_id;
  delete from public.four_year_plans where user_id = target_user_id;
  delete from public.official_sources where user_id = target_user_id;
  delete from public.event_logs where user_id = target_user_id;
  delete from public.student_settings where id = target_user_id;

  insert into public.student_settings (id, school_id, preferred_name)
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

create or replace function public.delete_current_user_account()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid := (select auth.uid());
begin
  if target_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  delete from public.event_logs where user_id = target_user_id;
  delete from auth.users where id = target_user_id;

  return true;
end;
$$;

revoke all on function public.delete_current_user_account() from public;
grant execute on function public.delete_current_user_account() to authenticated;

comment on function public.delete_current_user_account() is
  'Deletes the authenticated user after application storage objects have been removed.';
