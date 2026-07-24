-- Area 7A is intentionally student-confirmed because SMCCD activity credits
-- are not reliably present on high-school transcripts. Students who choose the
-- SMCCD district start with that confirmation enabled for each SMCCD college,
-- but may still turn it off afterward.

create or replace function public.seed_smccd_area_7a_defaults(target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target_user_id is null
    or not exists (
      select 1
      from public.student_settings settings
      where settings.id = target_user_id
    )
    or not (
      exists (
        select 1
        from public.student_college_district_preferences preference
        join public.college_districts district
          on district.district_code = preference.district_code
        where preference.user_id = target_user_id
          and district.policy_provider_code = 'SMCCD'
      )
      or exists (
        select 1
        from public.student_enrollment_preferences preference
        where preference.user_id = target_user_id
          and preference.provider_code = 'SMCCD'
      )
    )
  then
    return;
  end if;

  insert into public.student_smccd_ge_completions (
    user_id,
    college_code,
    area,
    completion_source
  )
  select target_user_id, college.code, '7A', 'manual'
  from (values ('CSM'), ('SKY'), ('CAN')) as college(code)
  on conflict (user_id, college_code, area) do nothing;
end;
$$;

revoke all on function public.seed_smccd_area_7a_defaults(uuid)
  from public, anon, authenticated;

create or replace function public.apply_smccd_area_7a_defaults_from_district()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
    or old.district_code is distinct from new.district_code
  then
    perform public.seed_smccd_area_7a_defaults(new.user_id);
  end if;
  return new;
end;
$$;

revoke all on function public.apply_smccd_area_7a_defaults_from_district()
  from public, anon, authenticated;

create trigger student_district_default_smccd_area_7a
  after insert or update of district_code
  on public.student_college_district_preferences
  for each row
  execute function public.apply_smccd_area_7a_defaults_from_district();

create or replace function public.apply_smccd_area_7a_defaults_from_enrollment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
    or old.provider_code is distinct from new.provider_code
  then
    perform public.seed_smccd_area_7a_defaults(new.user_id);
  end if;
  return new;
end;
$$;

revoke all on function public.apply_smccd_area_7a_defaults_from_enrollment()
  from public, anon, authenticated;

create trigger student_enrollment_default_smccd_area_7a
  after insert or update of provider_code
  on public.student_enrollment_preferences
  for each row
  execute function public.apply_smccd_area_7a_defaults_from_enrollment();

do $$
declare
  associated_user record;
begin
  for associated_user in
    select distinct association.user_id
    from (
      select preference.user_id
      from public.student_college_district_preferences preference
      join public.college_districts district
        on district.district_code = preference.district_code
      where district.policy_provider_code = 'SMCCD'

      union

      select preference.user_id
      from public.student_enrollment_preferences preference
      where preference.provider_code = 'SMCCD'
    ) association
  loop
    perform public.seed_smccd_area_7a_defaults(associated_user.user_id);
  end loop;
end;
$$;

comment on function public.seed_smccd_area_7a_defaults(uuid) is
  'Seeds an opt-out Area 7A confirmation for every SMCCD college pattern when a student associates the account with SMCCD.';
