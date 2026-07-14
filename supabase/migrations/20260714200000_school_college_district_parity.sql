-- Normalize California community-college districts and persist one student
-- preference. Individual colleges remain the source directory records; the
-- district is the planning boundary students actually choose.

create or replace function public.college_district_code(district_name text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select 'ccc-district-' || trim(both '-' from regexp_replace(
    replace(lower(district_name), '&', ' and '),
    '[^a-z0-9]+', '-', 'g'
  ));
$$;

create table public.college_districts (
  district_code text primary key,
  name text not null unique,
  website_url text,
  policy_provider_code text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  source_url text not null,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.education_providers
  add column district_code text;

insert into public.college_districts (
  district_code, name, policy_provider_code, source_url, source_updated_at
)
select
  public.college_district_code(provider.district_name),
  provider.district_name,
  case when provider.district_name = 'San Mateo County Community College District' then 'SMCCD' else null end,
  min(provider.source_url),
  max(provider.source_updated_at)
from public.education_providers provider
where provider.provider_type = 'community_college'
  and provider.district_name is not null
group by provider.district_name
on conflict (district_code) do update set
  name = excluded.name,
  policy_provider_code = coalesce(excluded.policy_provider_code, public.college_districts.policy_provider_code),
  source_url = excluded.source_url,
  source_updated_at = excluded.source_updated_at,
  status = 'active',
  updated_at = now();

update public.education_providers
set district_code = public.college_district_code(district_name)
where provider_type = 'community_college'
  and district_name is not null;

alter table public.education_providers
  add constraint education_providers_district_code_fk
  foreign key (district_code) references public.college_districts(district_code) on update cascade;

create index education_providers_district_idx
  on public.education_providers (district_code, status, name)
  where district_code is not null;

create table public.student_college_district_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  district_code text not null references public.college_districts(district_code) on update cascade,
  selection_method text not null default 'suggested' check (selection_method in ('suggested', 'student', 'pilot')),
  school_id_at_selection uuid references public.schools(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.nearby_college_districts(
  target_school_id uuid,
  result_limit integer default 8
)
returns table (
  district_code text,
  district_name text,
  colleges_count bigint,
  nearest_distance_miles numeric,
  providers jsonb,
  is_recommended boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with grouped as (
    select
      provider.district_code,
      district.name as district_name,
      count(*) as colleges_count,
      min(nearby.distance_miles) as nearest_distance_miles,
      jsonb_agg(jsonb_build_object(
        'id', provider.id,
        'provider_code', provider.provider_code,
        'name', provider.name,
        'website_url', provider.website_url,
        'city', provider.city,
        'postal_code', provider.postal_code,
        'distance_miles', nearby.distance_miles
      ) order by nearby.distance_miles nulls last, provider.name) as providers
    from public.nearby_school_providers(target_school_id, 20) nearby
    join public.education_providers provider on provider.id = nearby.provider_id
    join public.college_districts district on district.district_code = provider.district_code and district.status = 'active'
    where provider.provider_type = 'community_college'
    group by provider.district_code, district.name
  ), ranked as (
    select grouped.*, row_number() over (order by grouped.nearest_distance_miles nulls last, grouped.district_name) as position
    from grouped
  )
  select
    ranked.district_code,
    ranked.district_name,
    ranked.colleges_count,
    ranked.nearest_distance_miles,
    ranked.providers,
    ranked.position = 1
  from ranked
  order by ranked.position
  limit least(greatest(result_limit, 1), 20);
$$;

create or replace function public.set_college_district_preference(
  target_district_code text,
  preference_method text default 'student'
)
returns public.student_college_district_preferences
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid := (select auth.uid());
  selected_school_id uuid;
  saved public.student_college_district_preferences;
begin
  if target_user_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if preference_method not in ('suggested', 'student', 'pilot') then
    raise exception 'Invalid college-district selection method.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.college_districts district
    where district.district_code = target_district_code and district.status = 'active'
  ) then
    raise exception 'Choose an active California community-college district.' using errcode = '22023';
  end if;

  select settings.school_id into selected_school_id
  from public.student_settings settings
  where settings.id = target_user_id;

  insert into public.student_college_district_preferences (
    user_id, district_code, selection_method, school_id_at_selection
  ) values (
    target_user_id, target_district_code, preference_method, selected_school_id
  )
  on conflict (user_id) do update set
    district_code = excluded.district_code,
    selection_method = excluded.selection_method,
    school_id_at_selection = excluded.school_id_at_selection,
    updated_at = now()
  returning * into saved;

  return saved;
end;
$$;

create or replace function public.select_current_school(target_school_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid := (select auth.uid());
  active_plan_id uuid;
  suggested_district_code text;
begin
  if target_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.schools school
    where school.id = target_school_id
      and school.status in ('active', 'pending')
      and school.governance_type in ('district', 'charter')
      and coalesce(school.high_grade, 12) >= 9
  ) then
    raise exception 'Choose an active California public or charter high school.' using errcode = '22023';
  end if;

  update public.student_settings
  set school_id = target_school_id,
      school_confirmed = true,
      school_selected_at = now(),
      updated_at = now()
  where id = target_user_id;

  select plan.id into active_plan_id
  from public.four_year_plans plan
  where plan.user_id = target_user_id and plan.is_active
  limit 1;

  if active_plan_id is null then
    insert into public.four_year_plans (user_id, school_id)
    values (target_user_id, target_school_id)
    returning id into active_plan_id;
    insert into public.plan_versions (plan_id, user_id, label, kind)
    values (active_plan_id, target_user_id, 'Current plan', 'active');
  else
    update public.four_year_plans
    set school_id = target_school_id, updated_at = now()
    where id = active_plan_id and user_id = target_user_id;
  end if;

  if not exists (
    select 1 from public.student_college_district_preferences preference
    where preference.user_id = target_user_id and preference.selection_method in ('student', 'pilot')
  ) then
    select nearby.district_code into suggested_district_code
    from public.nearby_college_districts(target_school_id, 1) nearby
    limit 1;
    if suggested_district_code is not null then
      insert into public.student_college_district_preferences (
        user_id, district_code, selection_method, school_id_at_selection
      ) values (
        target_user_id, suggested_district_code, 'suggested', target_school_id
      )
      on conflict (user_id) do update set
        district_code = excluded.district_code,
        selection_method = 'suggested',
        school_id_at_selection = excluded.school_id_at_selection,
        updated_at = now();
    end if;
  end if;

  return active_plan_id;
end;
$$;

insert into public.student_college_district_preferences (
  user_id, district_code, selection_method, school_id_at_selection
)
select settings.id, nearby.district_code, 'suggested', settings.school_id
from public.student_settings settings
cross join lateral public.nearby_college_districts(settings.school_id, 1) nearby
where settings.school_confirmed
on conflict (user_id) do nothing;

alter table public.college_districts enable row level security;
alter table public.student_college_district_preferences enable row level security;

create policy "college districts are readable" on public.college_districts
for select to authenticated using (status = 'active' or (select public.is_app_admin()));

create policy "users manage own college district preference" on public.student_college_district_preferences
for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create trigger college_districts_set_updated_at before update on public.college_districts
for each row execute procedure public.set_updated_at();
create trigger student_college_district_preferences_set_updated_at before update on public.student_college_district_preferences
for each row execute procedure public.set_updated_at();

revoke all on function public.set_college_district_preference(text, text) from public;
grant execute on function public.set_college_district_preference(text, text) to authenticated;
grant execute on function public.nearby_college_districts(uuid, integer) to authenticated;

comment on table public.student_college_district_preferences is
  'The student-selected or public-address-suggested California community-college district. It is separate from sourced enrollment-limit policy and never implies eligibility.';
comment on function public.nearby_college_districts(uuid, integer) is
  'Groups official CCCCO colleges by district and ranks districts from the selected school public address; it never uses student device location.';

create or replace function public.get_assistant_workspace_bootstrap()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with core as (
    select public.get_workspace_bootstrap() as value
  )
  select core.value || jsonb_build_object(
    'transcript_sources', coalesce((
      select jsonb_agg(to_jsonb(source) order by source.created_at desc)
      from public.official_sources source
      where source.user_id = (select auth.uid()) and source.document_type = 'transcript'
    ), '[]'::jsonb),
    'transcript_review_items', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.created_at)
      from public.catalog_review_items item
      where item.user_id = (select auth.uid()) and item.entity_type in ('transcript_course', 'transcript_note')
    ), '[]'::jsonb),
    'prerequisite_clearances', coalesce((
      select jsonb_agg(to_jsonb(clearance)) from public.student_prerequisite_clearances clearance
      where clearance.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'manual_smccd_completions', coalesce((
      select jsonb_agg(jsonb_build_object('college_code', completion.college_code, 'area', completion.area))
      from public.student_smccd_ge_completions completion where completion.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'memories', coalesce((
      select jsonb_agg(jsonb_build_object('memory_key', memory.memory_key, 'content', memory.content, 'tags', memory.tags))
      from public.ai_student_memories memory where memory.user_id = (select auth.uid()) and memory.is_active
    ), '[]'::jsonb),
    'nearby_providers', coalesce((
      select jsonb_agg(to_jsonb(provider))
      from public.nearby_school_providers(((core.value -> 'school' ->> 'id')::uuid), 8) provider
    ), '[]'::jsonb),
    'nearby_college_districts', coalesce((
      select jsonb_agg(to_jsonb(district))
      from public.nearby_college_districts(((core.value -> 'school' ->> 'id')::uuid), 8) district
    ), '[]'::jsonb),
    'college_district_preference', (
      select to_jsonb(preference) from public.student_college_district_preferences preference
      where preference.user_id = (select auth.uid()) limit 1
    )
  )
  from core;
$$;

revoke all on function public.get_assistant_workspace_bootstrap() from public;
grant execute on function public.get_assistant_workspace_bootstrap() to authenticated;
