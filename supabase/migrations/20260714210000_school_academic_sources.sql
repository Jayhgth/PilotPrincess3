-- School course catalogs and diploma rules have different official authorities:
-- UCOP supplies structured A-G course identities, while districts and charters
-- publish their own diploma rules and complete local catalogs.

alter type public.requirement_area add value if not exists 'physical_education';
alter type public.requirement_area add value if not exists 'career_technical_education';
alter type public.requirement_area add value if not exists 'electives';
alter type public.requirement_area add value if not exists 'ethnic_studies';
alter type public.requirement_area add value if not exists 'other';

alter table public.schools
  add column if not exists district_cds_code text,
  add column if not exists district_website_url text,
  add column if not exists academic_authority_key text;

update public.schools
set
  district_cds_code = coalesce(district_cds_code, left(cds_code, 7)),
  academic_authority_key = coalesce(
    academic_authority_key,
    case
      when governance_type = 'charter' then 'charter:' || cds_code
      when cds_code is not null then 'district:' || left(cds_code, 7)
      else 'school:' || id::text
    end
  )
where academic_authority_key is null or district_cds_code is null;

alter table public.schools
  drop constraint if exists schools_district_cds_code_check,
  add constraint schools_district_cds_code_check check (district_cds_code is null or district_cds_code ~ '^[0-9]{7}$');

create index if not exists schools_academic_authority_key
  on public.schools(academic_authority_key)
  where academic_authority_key is not null;

create table public.school_academic_authorities (
  authority_key text primary key,
  authority_type text not null check (authority_type in ('district', 'charter', 'school')),
  name text not null,
  district_cds_code text,
  website_url text,
  source_url text not null,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (district_cds_code is null or district_cds_code ~ '^[0-9]{7}$')
);

insert into public.school_academic_authorities (
  authority_key, authority_type, name, district_cds_code, website_url, source_url, source_updated_at
)
select distinct on (school.academic_authority_key)
  school.academic_authority_key,
  case when school.governance_type = 'charter' then 'charter' else 'district' end,
  case when school.governance_type = 'charter' then school.name else coalesce(school.district_name, school.name) end,
  school.district_cds_code,
  case when school.governance_type = 'charter' then school.website_url else coalesce(school.district_website_url, school.website_url) end,
  coalesce(school.directory_source_url, 'https://www.cde.ca.gov/schooldirectory/'),
  school.directory_updated_at
from public.schools school
where school.academic_authority_key is not null
order by school.academic_authority_key, school.directory_updated_at desc nulls last
on conflict (authority_key) do update set
  name = excluded.name,
  district_cds_code = excluded.district_cds_code,
  website_url = excluded.website_url,
  source_url = excluded.source_url,
  source_updated_at = excluded.source_updated_at,
  updated_at = now();

alter table public.schools
  drop constraint if exists schools_academic_authority_key_fkey,
  add constraint schools_academic_authority_key_fkey
    foreign key (academic_authority_key) references public.school_academic_authorities(authority_key) on update cascade on delete restrict;

create table public.school_academic_sources (
  id uuid primary key default gen_random_uuid(),
  academic_authority_key text not null references public.school_academic_authorities(authority_key) on update cascade on delete cascade,
  school_id uuid references public.schools(id) on delete cascade,
  source_type text not null check (source_type in ('course_catalog', 'graduation_requirements', 'combined')),
  title text not null,
  source_url text not null,
  discovered_from_url text not null,
  academic_year text,
  mime_type text,
  content_hash text,
  status text not null default 'discovered' check (status in ('discovered', 'verified', 'needs_review', 'failed', 'retired')),
  extraction_summary jsonb not null default '{}'::jsonb,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (academic_authority_key, source_type, source_url)
);

alter table public.courses
  add column if not exists external_course_id text;

create unique index if not exists courses_school_external_identity
  on public.courses(school_id, external_course_id)
  where external_course_id is not null;

alter table public.official_sources
  drop constraint if exists official_sources_document_type_check;
alter table public.official_sources
  add constraint official_sources_document_type_check
  check (document_type in ('general', 'transcript', 'course_catalog', 'graduation_requirements'));

alter table public.school_academic_authorities enable row level security;
alter table public.school_academic_sources enable row level security;

create policy "academic authorities are readable"
on public.school_academic_authorities for select to anon, authenticated using (true);

create policy "verified academic sources are readable"
on public.school_academic_sources for select to authenticated
using (status = 'verified' or (select public.is_app_admin()));

create trigger school_academic_authorities_set_updated_at before update on public.school_academic_authorities
for each row execute procedure public.set_updated_at();
create trigger school_academic_sources_set_updated_at before update on public.school_academic_sources
for each row execute procedure public.set_updated_at();

comment on table public.school_academic_authorities is
  'The district or charter that publishes local diploma rules and complete course catalogs for one or more schools.';
comment on table public.school_academic_sources is
  'Official academic source registry with discovery provenance, content hashes, extraction state, and explicit source type.';
comment on column public.courses.external_course_id is
  'Stable source-owned course identity, such as the UCOP course UUID. It prevents title-based merges and duplicate imports.';

-- Correct legacy HTML/entity artifacts already present in provider labels.
update public.education_providers
set name = replace(replace(replace(name, 'Ca&Ntilde;Ada', 'Cañada'), 'Ca&ntilde;ada', 'Cañada'), 'CaÃ±ada', 'Cañada')
where name ilike '%ca&%ada%' or name ilike '%caã±ada%';

