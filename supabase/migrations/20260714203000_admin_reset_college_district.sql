-- Admin QA reset must return to a truly neutral onboarding state, including
-- the newly persisted community-college district choice.

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
  if target_user_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if not exists (select 1 from public.app_admins where user_id = target_user_id) then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  select id into school_uuid from public.schools where slug = 'california-high-school-unselected' limit 1;
  if school_uuid is null then raise exception 'The onboarding school placeholder is missing.'; end if;
  select coalesce(raw_user_meta_data ->> 'preferred_name', '') into preferred_name_value from auth.users where id = target_user_id;

  delete from public.ai_conversations where user_id = target_user_id;
  delete from public.student_prerequisite_clearances where user_id = target_user_id;
  delete from public.student_smccd_goals where user_id = target_user_id;
  delete from public.student_smccd_ge_completions where user_id = target_user_id;
  delete from public.student_enrollment_preferences where user_id = target_user_id;
  delete from public.student_college_district_preferences where user_id = target_user_id;
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

  return jsonb_build_object('ok', true, 'adminPreserved', true, 'onboardingComplete', false, 'schoolSelected', false, 'resetAt', now());
end;
$$;

revoke all on function public.reset_current_admin_workspace() from public;
grant execute on function public.reset_current_admin_workspace() to authenticated;
