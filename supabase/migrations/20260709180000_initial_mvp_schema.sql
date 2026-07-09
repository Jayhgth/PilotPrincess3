create extension if not exists pgcrypto with schema extensions;

create type public.confidence_status as enum ('verified', 'likely', 'uncertain');
create type public.review_status as enum ('pending', 'approved', 'rejected');
create type public.course_status as enum ('completed', 'current', 'planned');
create type public.plan_version_kind as enum ('active', 'snapshot', 'simulation');
create type public.source_kind as enum ('official_url', 'upload', 'pasted_text', 'screenshot');
create type public.parse_status as enum ('pending', 'processing', 'complete', 'needs_review', 'failed');
create type public.timeline_category as enum ('academics', 'activities', 'college', 'summer', 'admin');
create type public.activity_kind as enum ('club', 'athletics', 'service', 'work', 'family', 'internship', 'other');
create type public.requirement_area as enum (
  'english',
  'social_science',
  'math',
  'lab_science',
  'world_language',
  'design_lab',
  'visual_performing_arts',
  'personal_development'
);

create table public.allowed_email_domains (
  domain text primary key check (domain = lower(domain) and domain !~ '@'),
  label text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.allowed_email_domains (domain, label)
values ('dtechhs.org', 'Design Tech High School')
on conflict (domain) do nothing;

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  short_name text not null,
  website_url text,
  source_year text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.student_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  school_id uuid references public.schools(id) on delete restrict,
  preferred_name text not null default '',
  age integer check (age between 12 and 22),
  grade_level integer check (grade_level between 9 and 12),
  graduation_year integer check (graduation_year between 2025 and 2040),
  academic_interests text[] not null default '{}',
  major_direction text not null default 'undecided',
  career_direction text not null default '',
  goal_intensity text not null default 'balanced' check (goal_intensity in ('lower_stress', 'balanced', 'competitive')),
  workload_tolerance text not null default 'balanced' check (workload_tolerance in ('light', 'balanced', 'high')),
  stress_level integer not null default 3 check (stress_level between 1 and 5),
  activity_load_hours numeric(5,1) not null default 0 check (activity_load_hours between 0 and 80),
  school_confirmed boolean not null default false,
  onboarding_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.official_sources (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  title text not null,
  kind public.source_kind not null,
  source_url text,
  storage_path text,
  raw_text text,
  mime_type text,
  source_year text,
  is_official boolean not null default false,
  parse_status public.parse_status not null default 'pending',
  confidence public.confidence_status not null default 'uncertain',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_url is not null or storage_path is not null or raw_text is not null)
);

create table public.parse_jobs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.official_sources(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_name text not null default 'source_parse',
  status public.parse_status not null default 'pending',
  model text,
  output jsonb,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  fallback_used boolean not null default false,
  uncertainty_involved boolean not null default false,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.catalog_versions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  source_id uuid references public.official_sources(id) on delete set null,
  label text not null,
  academic_year text not null,
  is_current boolean not null default false,
  published_at date,
  created_at timestamptz not null default now(),
  unique (school_id, academic_year)
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  catalog_version_id uuid not null references public.catalog_versions(id) on delete cascade,
  source_id uuid references public.official_sources(id) on delete set null,
  course_code text,
  name text not null,
  subject text not null,
  course_type text not null default 'high_school',
  grade_levels integer[] not null default '{}',
  credits numeric(6,2),
  college_units numeric(5,2),
  term_type text not null default 'year' check (term_type in ('semester', 'year', 'variable')),
  uc_ag_area text,
  prerequisites text[] not null default '{}',
  description text,
  is_honors boolean not null default false,
  is_weighted boolean not null default false,
  confidence public.confidence_status not null default 'uncertain',
  review_status public.review_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (catalog_version_id, name)
);

create table public.graduation_requirements (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  catalog_version_id uuid not null references public.catalog_versions(id) on delete cascade,
  source_id uuid references public.official_sources(id) on delete set null,
  area public.requirement_area not null,
  name text not null,
  credits_required numeric(6,2) not null check (credits_required > 0),
  years_required numeric(4,1),
  notes text,
  confidence public.confidence_status not null default 'uncertain',
  review_status public.review_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (catalog_version_id, area)
);

create table public.course_requirement_mappings (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  requirement_id uuid not null references public.graduation_requirements(id) on delete cascade,
  source_id uuid references public.official_sources(id) on delete set null,
  confidence public.confidence_status not null default 'uncertain',
  is_user_override boolean not null default false,
  created_at timestamptz not null default now(),
  unique (course_id, requirement_id)
);

create table public.catalog_review_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id uuid not null references public.official_sources(id) on delete cascade,
  entity_type text not null check (entity_type in ('course', 'requirement', 'policy', 'source_note')),
  proposed_payload jsonb not null,
  corrected_payload jsonb,
  status public.review_status not null default 'pending',
  confidence public.confidence_status not null default 'uncertain',
  uncertainty_notes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.four_year_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete restrict,
  title text not null default 'My four-year plan',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index four_year_plans_one_active_per_user
  on public.four_year_plans(user_id)
  where is_active;

create table public.plan_versions (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.four_year_plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  kind public.plan_version_kind not null default 'active',
  generation_config jsonb not null default '{}',
  ai_summary text,
  created_at timestamptz not null default now()
);

create unique index plan_versions_one_active_per_plan
  on public.plan_versions(plan_id)
  where kind = 'active';

create table public.plan_courses (
  id uuid primary key default gen_random_uuid(),
  plan_version_id uuid not null references public.plan_versions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  custom_course_name text,
  grade_level integer not null check (grade_level between 9 and 12),
  school_year text not null,
  term text not null default 'full_year' check (term in ('fall', 'spring', 'summer', 'full_year')),
  status public.course_status not null,
  credits numeric(6,2),
  college_units numeric(5,2),
  letter_grade text,
  is_weighted boolean not null default false,
  mapping_verified boolean not null default false,
  user_edited boolean not null default false,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (course_id is not null or nullif(trim(custom_course_name), '') is not null)
);

create table public.grade_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_course_id uuid not null references public.plan_courses(id) on delete cascade,
  letter_grade text not null,
  credits numeric(6,2) not null check (credits > 0),
  is_weighted boolean not null default false,
  confidence public.confidence_status not null default 'verified',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_course_id)
);

create table public.gpa_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_version_id uuid not null references public.plan_versions(id) on delete cascade,
  current_unweighted numeric(4,3),
  current_weighted numeric(4,3),
  projected_unweighted numeric(4,3),
  projected_weighted numeric(4,3),
  methodology text not null,
  is_estimate boolean not null default true,
  calculated_at timestamptz not null default now()
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  kind public.activity_kind not null,
  role text,
  weekly_hours numeric(5,1) not null check (weekly_hours between 0 and 80),
  start_grade integer check (start_grade between 9 and 12),
  end_grade integer check (end_grade between 9 and 12),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.timeline_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_version_id uuid references public.plan_versions(id) on delete cascade,
  title text not null,
  category public.timeline_category not null,
  due_date date,
  due_label text,
  is_completed boolean not null default false,
  is_generated boolean not null default false,
  explanation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.simulation_configs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  major_direction text not null,
  path_intensity text not null check (path_intensity in ('lower_stress', 'balanced', 'competitive')),
  course_style text not null check (course_style in ('more_honors', 'more_dual_enrollment', 'more_regular')),
  activity_load text not null check (activity_load in ('lower', 'same', 'higher')),
  created_at timestamptz not null default now()
);

create table public.simulations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_version_id uuid not null references public.plan_versions(id) on delete cascade,
  config_id uuid not null references public.simulation_configs(id) on delete cascade,
  current_result jsonb not null,
  simulated_result jsonb not null,
  explanation text,
  risks text[] not null default '{}',
  is_saved boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.generated_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_version_id uuid references public.plan_versions(id) on delete set null,
  content text not null,
  generation_source text not null check (generation_source in ('codex', 'fallback')),
  created_at timestamptz not null default now()
);

create table public.event_logs (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  event_name text not null,
  feature_name text,
  source_used text,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  success boolean,
  fallback_used boolean,
  uncertainty_involved boolean,
  properties jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index courses_catalog_idx on public.courses(catalog_version_id);
create index courses_subject_idx on public.courses(subject);
create index sources_user_idx on public.official_sources(user_id, created_at desc);
create index plan_courses_version_idx on public.plan_courses(plan_version_id, grade_level, sort_order);
create index timeline_user_idx on public.timeline_tasks(user_id, is_completed, due_date);
create index events_user_idx on public.event_logs(user_id, created_at desc);
create index review_items_user_idx on public.catalog_review_items(user_id, status, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger schools_set_updated_at before update on public.schools
for each row execute procedure public.set_updated_at();
create trigger profiles_set_updated_at before update on public.student_profiles
for each row execute procedure public.set_updated_at();
create trigger sources_set_updated_at before update on public.official_sources
for each row execute procedure public.set_updated_at();
create trigger courses_set_updated_at before update on public.courses
for each row execute procedure public.set_updated_at();
create trigger requirements_set_updated_at before update on public.graduation_requirements
for each row execute procedure public.set_updated_at();
create trigger review_items_set_updated_at before update on public.catalog_review_items
for each row execute procedure public.set_updated_at();
create trigger plans_set_updated_at before update on public.four_year_plans
for each row execute procedure public.set_updated_at();
create trigger plan_courses_set_updated_at before update on public.plan_courses
for each row execute procedure public.set_updated_at();
create trigger grade_records_set_updated_at before update on public.grade_records
for each row execute procedure public.set_updated_at();
create trigger activities_set_updated_at before update on public.activities
for each row execute procedure public.set_updated_at();
create trigger tasks_set_updated_at before update on public.timeline_tasks
for each row execute procedure public.set_updated_at();

create or replace function public.enforce_allowed_email_domain()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  email_domain text;
begin
  if new.email is null then
    raise exception 'An approved d.tech email address is required.';
  end if;

  email_domain := lower(split_part(new.email, '@', 2));
  if not exists (
    select 1
    from public.allowed_email_domains
    where domain = email_domain and is_active
  ) then
    raise exception 'Only approved d.tech email addresses may register.';
  end if;

  return new;
end;
$$;

create trigger enforce_allowed_email_domain_before_signup
before insert on auth.users
for each row execute procedure public.enforce_allowed_email_domain();

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

  insert into public.student_profiles (id, school_id, preferred_name)
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

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.log_app_event(
  event_name text,
  properties jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.event_logs (user_id, event_name, properties)
  values ((select auth.uid()), event_name, coalesce(properties, '{}'::jsonb));
$$;

alter table public.allowed_email_domains enable row level security;
alter table public.schools enable row level security;
alter table public.student_profiles enable row level security;
alter table public.official_sources enable row level security;
alter table public.parse_jobs enable row level security;
alter table public.catalog_versions enable row level security;
alter table public.courses enable row level security;
alter table public.graduation_requirements enable row level security;
alter table public.course_requirement_mappings enable row level security;
alter table public.catalog_review_items enable row level security;
alter table public.four_year_plans enable row level security;
alter table public.plan_versions enable row level security;
alter table public.plan_courses enable row level security;
alter table public.grade_records enable row level security;
alter table public.gpa_records enable row level security;
alter table public.activities enable row level security;
alter table public.timeline_tasks enable row level security;
alter table public.simulation_configs enable row level security;
alter table public.simulations enable row level security;
alter table public.generated_summaries enable row level security;
alter table public.event_logs enable row level security;

create policy "email domains are readable" on public.allowed_email_domains
for select to anon, authenticated using (is_active);

create policy "schools are readable" on public.schools
for select to anon, authenticated using (true);

create policy "users read own profile" on public.student_profiles
for select to authenticated using ((select auth.uid()) = id);
create policy "users update own profile" on public.student_profiles
for update to authenticated using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "users read official or owned sources" on public.official_sources
for select to authenticated using (is_official or (select auth.uid()) = user_id);
create policy "users add own sources" on public.official_sources
for insert to authenticated with check ((select auth.uid()) = user_id and not is_official);
create policy "users update own sources" on public.official_sources
for update to authenticated using ((select auth.uid()) = user_id and not is_official)
with check ((select auth.uid()) = user_id and not is_official);
create policy "users delete own sources" on public.official_sources
for delete to authenticated using ((select auth.uid()) = user_id and not is_official);

create policy "users manage own parse jobs" on public.parse_jobs
for all to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "catalog versions are readable" on public.catalog_versions
for select to authenticated using (true);
create policy "courses are readable" on public.courses
for select to authenticated using (true);
create policy "requirements are readable" on public.graduation_requirements
for select to authenticated using (true);
create policy "mappings are readable" on public.course_requirement_mappings
for select to authenticated using (true);

create policy "users manage own review items" on public.catalog_review_items
for all to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "users manage own plans" on public.four_year_plans
for all to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy "users manage own plan versions" on public.plan_versions
for all to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy "users manage own plan courses" on public.plan_courses
for all to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy "users manage own grade records" on public.grade_records
for all to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy "users manage own gpa records" on public.gpa_records
for all to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy "users manage own activities" on public.activities
for all to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy "users manage own timeline" on public.timeline_tasks
for all to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy "users manage own simulation configs" on public.simulation_configs
for all to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy "users manage own simulations" on public.simulations
for all to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy "users manage own summaries" on public.generated_summaries
for all to authenticated using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
create policy "users read own events" on public.event_logs
for select to authenticated using ((select auth.uid()) = user_id);
create policy "users add own events" on public.event_logs
for insert to authenticated with check ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'source-uploads',
  'source-uploads',
  false,
  15728640,
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/csv',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "users read own source uploads" on storage.objects
for select to authenticated
using (bucket_id = 'source-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "users upload own source files" on storage.objects
for insert to authenticated
with check (bucket_id = 'source-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "users update own source files" on storage.objects
for update to authenticated
using (bucket_id = 'source-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text)
with check (bucket_id = 'source-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "users delete own source files" on storage.objects
for delete to authenticated
using (bucket_id = 'source-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text);

grant execute on function public.log_app_event(text, jsonb) to authenticated;
