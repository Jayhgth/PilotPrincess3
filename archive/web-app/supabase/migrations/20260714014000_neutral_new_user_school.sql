-- New accounts need an active plan row before onboarding, but that structural
-- requirement must not silently assign every California student to d.tech.

insert into public.schools (
  slug, name, short_name, website_url, source_year, governance_type, status,
  school_type, low_grade, high_grade, state_code, directory_source_url
)
values (
  'california-high-school-unselected',
  'Choose a California high school',
  'School not selected',
  'https://www.cde.ca.gov/ds/si/ds/pubschls.asp',
  '2026-27',
  'other',
  'pending',
  'System placeholder',
  9,
  12,
  'CA',
  'https://www.cde.ca.gov/ds/si/ds/pubschls.asp'
)
on conflict (slug) do update set
  name = excluded.name,
  short_name = excluded.short_name,
  website_url = excluded.website_url,
  governance_type = excluded.governance_type,
  status = excluded.status,
  school_type = excluded.school_type,
  directory_source_url = excluded.directory_source_url,
  updated_at = now();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  school_uuid uuid;
  plan_uuid uuid;
begin
  select id into school_uuid
  from public.schools
  where slug = 'california-high-school-unselected'
  limit 1;

  if school_uuid is null then raise exception 'The onboarding school placeholder is missing.'; end if;

  insert into public.student_settings (id, school_id, preferred_name)
  values (new.id, school_uuid, coalesce(new.raw_user_meta_data ->> 'preferred_name', ''));

  insert into public.four_year_plans (user_id, school_id)
  values (new.id, school_uuid)
  returning id into plan_uuid;

  insert into public.plan_versions (plan_id, user_id, label, kind)
  values (plan_uuid, new.id, 'Current plan', 'active');

  return new;
end;
$$;

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
