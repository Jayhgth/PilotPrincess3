-- Statewide school, policy, provider, and shared-correction foundations.
-- Existing d.tech and SMCCD records remain intact while new institutions can be
-- added from their official directories without changing student-owned rows.

alter table public.schools
  add column if not exists cds_code text,
  add column if not exists nces_district_id text,
  add column if not exists nces_school_id text,
  add column if not exists district_name text,
  add column if not exists county_name text,
  add column if not exists governance_type text not null default 'district',
  add column if not exists charter_number text,
  add column if not exists status text not null default 'active',
  add column if not exists school_type text,
  add column if not exists low_grade integer,
  add column if not exists high_grade integer,
  add column if not exists street_address text,
  add column if not exists city text,
  add column if not exists state_code text not null default 'CA',
  add column if not exists postal_code text,
  add column if not exists latitude numeric(9,6),
  add column if not exists longitude numeric(9,6),
  add column if not exists uc_ag_institution_id text,
  add column if not exists directory_source_url text,
  add column if not exists directory_updated_at timestamptz;

alter table public.schools
  drop constraint if exists schools_cds_code_check,
  add constraint schools_cds_code_check check (cds_code is null or cds_code ~ '^[0-9]{14}$'),
  drop constraint if exists schools_governance_type_check,
  add constraint schools_governance_type_check check (governance_type in ('district', 'charter', 'private', 'other')),
  drop constraint if exists schools_status_check,
  add constraint schools_status_check check (status in ('active', 'pending', 'closed', 'merged')),
  drop constraint if exists schools_grade_span_check,
  add constraint schools_grade_span_check check (
    (low_grade is null or low_grade between -1 and 12)
    and (high_grade is null or high_grade between -1 and 12)
    and (low_grade is null or high_grade is null or high_grade >= low_grade)
  ),
  drop constraint if exists schools_coordinates_check,
  add constraint schools_coordinates_check check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  );

create unique index if not exists schools_cds_code_unique
  on public.schools(cds_code)
  where cds_code is not null;
create index if not exists schools_statewide_search
  on public.schools(status, governance_type, high_grade, name);
create index if not exists schools_postal_code
  on public.schools(postal_code)
  where postal_code is not null;

update public.schools
set
  cds_code = '41690470129759',
  district_name = 'San Mateo Union High',
  county_name = 'San Mateo',
  governance_type = 'charter',
  charter_number = '1647',
  status = 'active',
  school_type = 'High Schools (Public)',
  low_grade = 9,
  high_grade = 12,
  street_address = '275 Oracle Pkwy.',
  city = 'Redwood City',
  state_code = 'CA',
  postal_code = '94065',
  directory_source_url = 'https://sd.cde.ca.gov/schooldirectory/details?cdscode=41690470129759',
  directory_updated_at = now()
where slug = 'design-tech-high-school';

alter table public.student_settings
  add column if not exists school_selected_at timestamptz;

create table public.academic_frameworks (
  id uuid primary key default gen_random_uuid(),
  school_id uuid references public.schools(id) on delete cascade,
  framework_type text not null check (framework_type in ('state_graduation', 'local_graduation', 'uc_ag')),
  jurisdiction_key text not null,
  name text not null,
  academic_year text not null,
  source_url text not null,
  source_label text not null,
  status text not null default 'published' check (status in ('draft', 'published', 'retired')),
  effective_graduation_year_start integer,
  effective_graduation_year_end integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (framework_type, jurisdiction_key, academic_year)
);

create table public.academic_requirement_rules (
  id uuid primary key default gen_random_uuid(),
  framework_id uuid not null references public.academic_frameworks(id) on delete cascade,
  rule_key text not null,
  parent_rule_key text,
  subject_area text not null,
  title text not null,
  credits_required numeric(7,2),
  years_required numeric(5,2),
  courses_required numeric(5,2),
  minimum_grade text,
  required_before_grade integer,
  effective_graduation_year_start integer,
  effective_graduation_year_end integer,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (framework_id, rule_key)
);

create table public.course_framework_mappings (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  framework_id uuid not null references public.academic_frameworks(id) on delete cascade,
  requirement_rule_id uuid references public.academic_requirement_rules(id) on delete cascade,
  source_url text,
  confidence public.confidence_status not null default 'uncertain',
  review_status public.review_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, framework_id, requirement_rule_id)
);

create table public.course_designations (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  designation text not null check (designation in ('ap', 'ib', 'uc_honors', 'school_honors', 'cte', 'dual_enrollment')),
  source_url text,
  source_year text,
  confidence public.confidence_status not null default 'uncertain',
  review_status public.review_status not null default 'pending',
  created_at timestamptz not null default now(),
  unique (course_id, designation)
);

create table public.education_providers (
  id uuid primary key default gen_random_uuid(),
  provider_code text not null unique,
  provider_type text not null check (provider_type in ('community_college', 'university', 'roc_program', 'online_program')),
  district_name text,
  name text not null,
  website_url text not null,
  street_address text,
  city text,
  state_code text not null default 'CA',
  postal_code text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  status text not null default 'active' check (status in ('active', 'inactive')),
  source_url text not null,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  )
);

create table public.school_provider_links (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  provider_id uuid not null references public.education_providers(id) on delete cascade,
  relationship_type text not null check (relationship_type in ('nearby', 'district', 'articulation', 'dual_enrollment_partner', 'student_selected')),
  distance_miles numeric(7,2),
  source_url text,
  confidence public.confidence_status not null default 'uncertain',
  review_status public.review_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, provider_id, relationship_type)
);

create table public.shared_data_proposals (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null references auth.users(id) on delete cascade,
  submitted_via text not null check (submitted_via in ('student', 'pilot', 'admin')),
  entity_type text not null check (entity_type in ('school', 'course', 'course_mapping', 'requirement', 'provider', 'provider_link', 'policy', 'source')),
  action text not null check (action in ('create', 'correct', 'retire')),
  school_id uuid references public.schools(id) on delete cascade,
  target_table text not null,
  target_id uuid,
  proposed_payload jsonb not null,
  evidence_url text,
  evidence_summary text not null,
  status public.review_status not null default 'pending',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'pending' and reviewed_at is null)
    or (status in ('approved', 'rejected') and reviewed_at is not null)
  )
);

create index if not exists shared_data_proposals_review_queue
  on public.shared_data_proposals(status, entity_type, created_at);
create index if not exists school_provider_links_school
  on public.school_provider_links(school_id, review_status, distance_miles);

insert into public.academic_frameworks (
  framework_type, jurisdiction_key, name, academic_year, source_url, source_label, status
)
values
  (
    'state_graduation',
    'california',
    'California state minimum graduation requirements',
    '2026-27',
    'https://www.cde.ca.gov/ci/gs/hs/hsgrmin.asp',
    'California Department of Education',
    'published'
  ),
  (
    'uc_ag',
    'university-of-california',
    'University of California A–G subject requirements',
    '2026-27',
    'https://admission.universityofcalifornia.edu/admission-requirements/first-year-requirements/subject-requirement-a-g.html',
    'University of California Admissions',
    'published'
  )
on conflict (framework_type, jurisdiction_key, academic_year) do update set
  name = excluded.name,
  source_url = excluded.source_url,
  source_label = excluded.source_label,
  status = excluded.status,
  updated_at = now();

with framework as (
  select id from public.academic_frameworks
  where framework_type = 'state_graduation' and jurisdiction_key = 'california' and academic_year = '2026-27'
)
insert into public.academic_requirement_rules (
  framework_id, rule_key, subject_area, title, years_required,
  effective_graduation_year_start, notes, sort_order
)
select framework.id, rule.rule_key, rule.subject_area, rule.title, rule.years_required,
  rule.effective_year, rule.notes, rule.sort_order
from framework
cross join (values
  ('ca_english', 'english', 'English', 3::numeric, null::integer, null::text, 10),
  ('ca_math', 'mathematics', 'Mathematics including Algebra I', 2::numeric, null::integer, 'Algebra I or equivalent content is required.', 20),
  ('ca_social_science', 'social_science', 'Social science', 3::numeric, null::integer, 'Includes U.S. history and geography; world history, culture, and geography; government and civics; and economics.', 30),
  ('ca_science', 'science', 'Science', 2::numeric, null::integer, 'Includes biological and physical science.', 40),
  ('ca_lote_vpa_cte', 'elective_pathway', 'World language, visual/performing arts, or career technical education', 1::numeric, null::integer, null::text, 50),
  ('ca_pe', 'physical_education', 'Physical education', 2::numeric, null::integer, 'Subject to statutory exemptions.', 60),
  ('ca_ethnic_studies', 'ethnic_studies', 'Ethnic studies', 0.5::numeric, 2030, 'Applies beginning with the 2029–30 graduating class.', 70),
  ('ca_personal_finance', 'personal_finance', 'Personal finance', 0.5::numeric, 2031, 'Applies beginning with the 2030–31 graduating class.', 80)
) as rule(rule_key, subject_area, title, years_required, effective_year, notes, sort_order)
on conflict (framework_id, rule_key) do update set
  subject_area = excluded.subject_area,
  title = excluded.title,
  years_required = excluded.years_required,
  effective_graduation_year_start = excluded.effective_graduation_year_start,
  notes = excluded.notes,
  sort_order = excluded.sort_order,
  updated_at = now();

with framework as (
  select id from public.academic_frameworks
  where framework_type = 'uc_ag' and jurisdiction_key = 'university-of-california' and academic_year = '2026-27'
)
insert into public.academic_requirement_rules (
  framework_id, rule_key, subject_area, title, years_required,
  minimum_grade, required_before_grade, notes, sort_order
)
select framework.id, rule.rule_key, rule.subject_area, rule.title, rule.years_required,
  'C', 12, rule.notes, rule.sort_order
from framework
cross join (values
  ('a', 'A', 'A — History / Social Science', 2::numeric, 'One year world history and one year U.S. history, or one semester U.S. history plus one semester government.', 10),
  ('b', 'B', 'B — English', 4::numeric, null::text, 20),
  ('c', 'C', 'C — Mathematics', 3::numeric, 'Four years recommended; geometry content is required.', 30),
  ('d', 'D', 'D — Science', 2::numeric, 'Three years recommended; the minimum spans two foundational disciplines.', 40),
  ('e', 'E', 'E — Language other than English', 2::numeric, 'Three years recommended in the same language.', 50),
  ('f', 'F', 'F — Visual and Performing Arts', 1::numeric, null::text, 60),
  ('g', 'G', 'G — College-Preparatory Elective', 1::numeric, null::text, 70)
) as rule(rule_key, subject_area, title, years_required, notes, sort_order)
on conflict (framework_id, rule_key) do update set
  subject_area = excluded.subject_area,
  title = excluded.title,
  years_required = excluded.years_required,
  minimum_grade = excluded.minimum_grade,
  required_before_grade = excluded.required_before_grade,
  notes = excluded.notes,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.academic_frameworks (
  school_id, framework_type, jurisdiction_key, name, academic_year,
  source_url, source_label, status
)
select
  school.id,
  'local_graduation',
  school.cds_code,
  school.name || ' local graduation requirements',
  version.academic_year,
  coalesce(source.source_url, school.website_url, school.directory_source_url),
  school.name,
  'published'
from public.schools school
join public.catalog_versions version on version.school_id = school.id and version.is_current
left join public.official_sources source on source.id = version.source_id
where school.slug = 'design-tech-high-school'
  and coalesce(source.source_url, school.website_url, school.directory_source_url) is not null
on conflict (framework_type, jurisdiction_key, academic_year) do nothing;

with local_framework as (
  select framework.id, framework.school_id
  from public.academic_frameworks framework
  where framework.framework_type = 'local_graduation'
    and framework.jurisdiction_key = '41690470129759'
)
insert into public.academic_requirement_rules (
  framework_id, rule_key, subject_area, title, credits_required,
  years_required, notes, sort_order
)
select
  local_framework.id,
  requirement.area::text,
  requirement.area::text,
  requirement.name,
  requirement.credits_required,
  requirement.years_required,
  requirement.notes,
  row_number() over (order by requirement.name)::integer * 10
from local_framework
join public.graduation_requirements requirement on requirement.school_id = local_framework.school_id
where requirement.review_status = 'approved'
on conflict (framework_id, rule_key) do update set
  title = excluded.title,
  credits_required = excluded.credits_required,
  years_required = excluded.years_required,
  notes = excluded.notes,
  updated_at = now();

with uc_framework as (
  select id from public.academic_frameworks
  where framework_type = 'uc_ag' and jurisdiction_key = 'university-of-california' and academic_year = '2026-27'
), mapped as (
  select
    course.id as course_id,
    uc_framework.id as framework_id,
    rule.id as requirement_rule_id,
    course.source_id,
    course.confidence,
    course.review_status
  from public.courses course
  cross join uc_framework
  join public.academic_requirement_rules rule
    on rule.framework_id = uc_framework.id
    and lower(rule.rule_key) = lower(course.uc_ag_area)
  where course.uc_ag_area is not null
)
insert into public.course_framework_mappings (
  course_id, framework_id, requirement_rule_id, confidence, review_status
)
select course_id, framework_id, requirement_rule_id, confidence, review_status
from mapped
on conflict (course_id, framework_id, requirement_rule_id) do nothing;

insert into public.course_designations (
  course_id, designation, source_year, confidence, review_status
)
select
  course.id,
  case
    when course.name ~* '(^|[^A-Za-z])AP([^A-Za-z]|$)' then 'ap'
    when course.name ~* '(^|[^A-Za-z])IB([^A-Za-z]|$)' then 'ib'
    else 'school_honors'
  end,
  version.academic_year,
  course.confidence,
  course.review_status
from public.courses course
join public.catalog_versions version on version.id = course.catalog_version_id
where course.is_honors
on conflict (course_id, designation) do nothing;

create or replace function public.search_california_high_schools(
  query_text text default '',
  result_limit integer default 20
)
returns table (
  id uuid,
  cds_code text,
  name text,
  district_name text,
  county_name text,
  governance_type text,
  city text,
  postal_code text,
  low_grade integer,
  high_grade integer,
  website_url text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    school.id,
    school.cds_code,
    school.name,
    school.district_name,
    school.county_name,
    school.governance_type,
    school.city,
    school.postal_code,
    school.low_grade,
    school.high_grade,
    school.website_url
  from public.schools school
  where school.status in ('active', 'pending')
    and school.governance_type in ('district', 'charter')
    and coalesce(school.high_grade, 12) >= 9
    and (
      coalesce(trim(query_text), '') = ''
      or school.name ilike '%' || trim(query_text) || '%'
      or coalesce(school.district_name, '') ilike '%' || trim(query_text) || '%'
      or coalesce(school.city, '') ilike '%' || trim(query_text) || '%'
      or coalesce(school.postal_code, '') = trim(query_text)
      or coalesce(school.cds_code, '') = regexp_replace(trim(query_text), '[^0-9]', '', 'g')
    )
  order by
    case when lower(school.name) = lower(trim(query_text)) then 0 else 1 end,
    school.name,
    school.city
  limit least(greatest(result_limit, 1), 50);
$$;

create or replace function public.nearby_school_providers(
  target_school_id uuid,
  result_limit integer default 8
)
returns table (
  provider_id uuid,
  provider_code text,
  name text,
  provider_type text,
  city text,
  postal_code text,
  website_url text,
  distance_miles numeric,
  relationship_type text,
  confidence public.confidence_status
)
language sql
stable
security invoker
set search_path = ''
as $$
  with selected_school as (
    select school.id, school.latitude, school.longitude, school.postal_code
    from public.schools school
    where school.id = target_school_id
  ), candidates as (
    select
      provider.id,
      provider.provider_code,
      provider.name,
      provider.provider_type,
      provider.city,
      provider.postal_code,
      provider.website_url,
      link.relationship_type,
      coalesce(link.confidence, 'uncertain'::public.confidence_status) as confidence,
      coalesce(
        link.distance_miles,
        case
          when school.latitude is not null and provider.latitude is not null then
            3958.7613 * acos(least(1, greatest(-1,
              sin(radians(school.latitude::double precision)) * sin(radians(provider.latitude::double precision))
              + cos(radians(school.latitude::double precision)) * cos(radians(provider.latitude::double precision))
              * cos(radians(provider.longitude::double precision - school.longitude::double precision))
            )))
          else null
        end
      )::numeric(7,2) as distance_miles
    from selected_school school
    join public.education_providers provider on provider.status = 'active'
    left join public.school_provider_links link
      on link.school_id = school.id
      and link.provider_id = provider.id
      and link.review_status = 'approved'
    where link.id is not null
      or (school.latitude is not null and provider.latitude is not null)
      or (school.postal_code is not null and provider.postal_code = school.postal_code)
  )
  select
    candidates.id,
    candidates.provider_code,
    candidates.name,
    candidates.provider_type,
    candidates.city,
    candidates.postal_code,
    candidates.website_url,
    candidates.distance_miles,
    coalesce(candidates.relationship_type, 'nearby'),
    candidates.confidence
  from candidates
  order by candidates.distance_miles nulls last, candidates.name
  limit least(greatest(result_limit, 1), 20);
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

  return active_plan_id;
end;
$$;

revoke all on function public.select_current_school(uuid) from public;
grant execute on function public.select_current_school(uuid) to authenticated;
grant execute on function public.search_california_high_schools(text, integer) to anon, authenticated;
grant execute on function public.nearby_school_providers(uuid, integer) to authenticated;

alter table public.academic_frameworks enable row level security;
alter table public.academic_requirement_rules enable row level security;
alter table public.course_framework_mappings enable row level security;
alter table public.course_designations enable row level security;
alter table public.education_providers enable row level security;
alter table public.school_provider_links enable row level security;
alter table public.shared_data_proposals enable row level security;

create policy "academic frameworks are readable" on public.academic_frameworks
for select to authenticated using (status = 'published' or (select public.is_app_admin()));
create policy "academic requirement rules are readable" on public.academic_requirement_rules
for select to authenticated using (true);
create policy "course framework mappings are readable" on public.course_framework_mappings
for select to authenticated using (review_status = 'approved' or (select public.is_app_admin()));
create policy "course designations are readable" on public.course_designations
for select to authenticated using (review_status = 'approved' or (select public.is_app_admin()));
create policy "education providers are readable" on public.education_providers
for select to authenticated using (status = 'active' or (select public.is_app_admin()));
create policy "school provider links are readable" on public.school_provider_links
for select to authenticated using (review_status = 'approved' or (select public.is_app_admin()));

create policy "users submit shared data proposals" on public.shared_data_proposals
for insert to authenticated with check (
  submitted_by = (select auth.uid())
  and submitted_via in ('student', 'pilot')
  and status = 'pending'
  and reviewed_by is null
  and reviewed_at is null
);
create policy "users read own shared data proposals" on public.shared_data_proposals
for select to authenticated using (submitted_by = (select auth.uid()) or (select public.is_app_admin()));
create policy "admins review shared data proposals" on public.shared_data_proposals
for update to authenticated using ((select public.is_app_admin()))
with check ((select public.is_app_admin()));

create trigger academic_frameworks_set_updated_at before update on public.academic_frameworks
for each row execute procedure public.set_updated_at();
create trigger academic_requirement_rules_set_updated_at before update on public.academic_requirement_rules
for each row execute procedure public.set_updated_at();
create trigger course_framework_mappings_set_updated_at before update on public.course_framework_mappings
for each row execute procedure public.set_updated_at();
create trigger education_providers_set_updated_at before update on public.education_providers
for each row execute procedure public.set_updated_at();
create trigger school_provider_links_set_updated_at before update on public.school_provider_links
for each row execute procedure public.set_updated_at();
create trigger shared_data_proposals_set_updated_at before update on public.shared_data_proposals
for each row execute procedure public.set_updated_at();

comment on table public.academic_frameworks is
  'Versioned California state, local school, and UC A–G requirement frameworks with official provenance.';
comment on table public.shared_data_proposals is
  'Student- or Pilot-submitted shared catalog/policy corrections. Only an administrator may publish them.';
comment on function public.nearby_school_providers(uuid, integer) is
  'Ranks public education providers from the selected school public address or reviewed school-provider links; it never uses student location.';
