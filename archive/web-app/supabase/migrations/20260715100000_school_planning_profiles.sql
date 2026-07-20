-- School scheduling guidance is distinct from diploma requirements. Keep the
-- compact, source-backed policy beside each school and retrieve it only when
-- Pilot plans a schedule; do not grow the global assistant prompt per school.

create table public.school_planning_profiles (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  academic_year text not null,
  title text not null,
  source_urls text[] not null default '{}',
  status text not null default 'needs_review' check (status in ('verified', 'needs_review', 'retired')),
  college_course_posture text not null default 'supplemental'
    check (college_course_posture in ('integrated', 'supplemental', 'explicit_only')),
  college_eligible_grades smallint[] not null default '{}',
  always_high_school_areas public.requirement_area[] not null default '{}',
  grade_rules jsonb not null default '{}'::jsonb,
  guidance_notes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, academic_year),
  check (jsonb_typeof(grade_rules) = 'object'),
  check (college_eligible_grades <@ array[9,10,11,12]::smallint[])
);

create unique index school_planning_profiles_current_verified
  on public.school_planning_profiles (school_id)
  where status = 'verified';

create trigger school_planning_profiles_set_updated_at before update on public.school_planning_profiles
for each row execute procedure public.set_updated_at();

alter table public.school_planning_profiles enable row level security;

create policy "verified school planning profiles are readable"
on public.school_planning_profiles for select to authenticated
using (status = 'verified' or (select public.is_app_admin()));

comment on table public.school_planning_profiles is
  'Compact official scheduling policy: grade loads, on-campus requirements, normal sequences, and the school-specific posture toward college coursework.';

insert into public.school_planning_profiles (
  school_id, academic_year, title, source_urls, status, college_course_posture,
  college_eligible_grades, always_high_school_areas, grade_rules, guidance_notes
)
select
  school.id,
  '2025-26',
  'd.tech flow of classes and concurrent-enrollment policy',
  array[
    'https://www.designtechhighschool.org/graduation',
    'https://docs.google.com/document/d/1dX4WLEyikPmDjZVWMF3sIYjwGiwmCmSZRYfbdywiQuM/edit',
    'https://docs.google.com/presentation/d/1cVyDYDya2lGkOymkEbmWaNpjOYkn8iBBCGpowiL4xhI/edit'
  ],
  'verified',
  'integrated',
  array[11,12]::smallint[],
  array['english','design_lab']::public.requirement_area[],
  jsonb_build_object(
    '9', jsonb_build_object(
      'minimum_high_school_courses', 6,
      'target_total_courses', 7,
      'required_areas', jsonb_build_array('english','social_science','math','lab_science','design_lab','world_language','personal_development'),
      'preferred_course_names', jsonb_build_array('English 1','Ethnic Studies','Algebra 1','Environmental Science','Foundation in Design Thinking','Spanish 1','Introduction to Prototyping and Fabrication')
    ),
    '10', jsonb_build_object(
      'minimum_high_school_courses', 5,
      'target_total_courses', 7,
      'required_areas', jsonb_build_array('english','social_science','math','lab_science','design_lab','world_language','visual_performing_arts'),
      'preferred_course_names', jsonb_build_array('English 2','World History','Geometry','Chemistry','Co-designers','Spanish 2','Introduction to Visual Art')
    ),
    '11', jsonb_build_object(
      'minimum_high_school_courses', 4,
      'target_total_courses', 6,
      'required_areas', jsonb_build_array('english','social_science','math','lab_science','design_lab'),
      'preferred_course_names', jsonb_build_array('English 3','US History','Algebra 2','Biology')
    ),
    '12', jsonb_build_object(
      'minimum_high_school_courses', 3,
      'target_total_courses', 6,
      'required_areas', jsonb_build_array('english','social_science','math','design_lab'),
      'preferred_course_names', jsonb_build_array('English 4','Government & Economics','Precalculus')
    )
  ),
  array[
    'English and Design Lab remain at d.tech every year.',
    'Approved community-college courses may replace math, science, art, or social studies while the grade-specific minimum number of d.tech courses is maintained.',
    'The current public school guidance describes concurrent enrollment primarily for juniors and seniors; college eligibility and approval remain separate checks.',
    'd.tech offers Honors pathways rather than AP courses.'
  ]
from public.schools school
where school.slug = 'design-tech-high-school'
on conflict (school_id, academic_year) do update set
  title = excluded.title,
  source_urls = excluded.source_urls,
  status = excluded.status,
  college_course_posture = excluded.college_course_posture,
  college_eligible_grades = excluded.college_eligible_grades,
  always_high_school_areas = excluded.always_high_school_areas,
  grade_rules = excluded.grade_rules,
  guidance_notes = excluded.guidance_notes;

insert into public.school_planning_profiles (
  school_id, academic_year, title, source_urls, status, college_course_posture,
  college_eligible_grades, always_high_school_areas, grade_rules, guidance_notes
)
select
  school.id,
  '2026-27',
  'Carlmont course catalog and four-year planning worksheet',
  array[
    'https://www.carlmonths.org/Counseling/Counseling-Staff-and-Resources/Course-Catalog',
    'https://docs.google.com/document/d/1lFTKDRD7K7SSoIL_v-tTrp4qqXVAsfoTj68zd6KVjuI/edit'
  ],
  'verified',
  'supplemental',
  array[10,11,12]::smallint[],
  '{}'::public.requirement_area[],
  jsonb_build_object(
    '9', jsonb_build_object(
      'minimum_high_school_courses', 6,
      'target_total_courses', 6,
      'required_areas', jsonb_build_array('english','social_science','math','lab_science','physical_education'),
      'preferred_course_names', jsonb_build_array('English I','Life Skills','Ethnic Studies','P.E. 1','Biology')
    ),
    '10', jsonb_build_object(
      'minimum_high_school_courses', 6,
      'target_total_courses', 6,
      'required_areas', jsonb_build_array('english','social_science','math','lab_science','physical_education'),
      'preferred_course_names', jsonb_build_array('English II','Modern World History','P.E. 2')
    ),
    '11', jsonb_build_object(
      'minimum_high_school_courses', 6,
      'target_total_courses', 6,
      'required_areas', jsonb_build_array('english','social_science'),
      'preferred_course_names', jsonb_build_array('English III','US History')
    ),
    '12', jsonb_build_object(
      'minimum_high_school_courses', 5,
      'target_total_courses', 6,
      'required_areas', jsonb_build_array('english','social_science'),
      'preferred_course_names', jsonb_build_array('ERWC','American Government','Economics')
    )
  ),
  array[
    'Grades 9 through 11 must carry at least six classes; grade 12 must carry at least five.',
    'A seventh class is reserved for documented support, AVID, or visual/performing-arts participation when space permits.',
    'College and dual-enrollment coursework is supplemental unless a named Carlmont pathway or the student explicitly requests it.',
    'The official worksheet controls the English and social-studies sequence; course prerequisites and placement control math and science.'
  ]
from public.schools school
where lower(school.name) = 'carlmont high'
on conflict (school_id, academic_year) do update set
  title = excluded.title,
  source_urls = excluded.source_urls,
  status = excluded.status,
  college_course_posture = excluded.college_course_posture,
  college_eligible_grades = excluded.college_eligible_grades,
  always_high_school_areas = excluded.always_high_school_areas,
  grade_rules = excluded.grade_rules,
  guidance_notes = excluded.guidance_notes;

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
    ),
    'school_planning_profile', (
      select to_jsonb(profile)
      from public.school_planning_profiles profile
      where profile.school_id = ((core.value -> 'school' ->> 'id')::uuid)
        and profile.status = 'verified'
      order by profile.academic_year desc
      limit 1
    )
  )
  from core;
$$;

revoke all on function public.get_assistant_workspace_bootstrap() from public;
grant execute on function public.get_assistant_workspace_bootstrap() to authenticated;
