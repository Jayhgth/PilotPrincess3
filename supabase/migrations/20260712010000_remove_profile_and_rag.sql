drop function if exists public.search_ai_knowledge(text, text[], integer);
drop table if exists public.ai_knowledge_chunks;

alter table public.student_profiles rename to student_settings;

alter table public.student_settings
  drop column if exists academic_interests,
  drop column if exists career_interest_areas,
  drop column if exists work_values,
  drop column if exists exploration_questions,
  drop column if exists major_direction,
  drop column if exists career_direction,
  drop column if exists goal_intensity,
  drop column if exists workload_tolerance,
  drop column if exists stress_level,
  drop column if exists activity_load_hours,
  drop column if exists weekly_commitment_limit;

drop policy if exists "users read own profile" on public.student_settings;
drop policy if exists "users update own profile" on public.student_settings;

create policy "users read own settings" on public.student_settings
for select to authenticated using ((select auth.uid()) = id);

create policy "users update own settings" on public.student_settings
for update to authenticated using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

alter trigger profiles_set_updated_at on public.student_settings
rename to student_settings_set_updated_at;

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
  where slug = 'design-tech-high-school'
  limit 1;

  insert into public.student_settings (id, school_id, preferred_name)
  values (
    new.id,
    school_uuid,
    coalesce(new.raw_user_meta_data ->> 'preferred_name', '')
  );

  if school_uuid is not null then
    insert into public.four_year_plans (user_id, school_id)
    values (new.id, school_uuid)
    returning id into plan_uuid;

    insert into public.plan_versions (plan_id, user_id, label, kind)
    values (plan_uuid, new.id, 'Current plan', 'active');
  end if;

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
  delete from public.generated_summaries where user_id = target_user_id;
  delete from public.gpa_records where user_id = target_user_id;
  delete from public.grade_records where user_id = target_user_id;
  delete from public.timeline_tasks where user_id = target_user_id;
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

drop table if exists public.activities;
drop type if exists public.activity_kind;
drop table if exists public.simulations;
drop table if exists public.simulation_configs;

comment on table public.student_settings is
  'Minimal per-student setup, planning-window, tracker, and Pilot consent settings.';
