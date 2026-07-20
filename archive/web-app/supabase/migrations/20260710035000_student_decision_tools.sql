alter table public.student_profiles
  add column if not exists career_interest_areas text[] not null default '{}',
  add column if not exists work_values text[] not null default '{}',
  add column if not exists exploration_questions text[] not null default '{}';

comment on column public.student_profiles.career_interest_areas is
  'Student-selected RIASEC-inspired interest areas used for exploration, never a diagnostic result.';
comment on column public.student_profiles.work_values is
  'Student-selected conditions they want future study or work to support.';
comment on column public.student_profiles.exploration_questions is
  'Open questions the student wants planning experiences to help answer.';

alter table public.activities
  add column if not exists organization text,
  add column if not exists weeks_per_year numeric(5,1)
    check (weeks_per_year is null or weeks_per_year between 0 and 52),
  add column if not exists impact text,
  add column if not exists description text,
  add column if not exists is_active boolean not null default true;

comment on column public.activities.weeks_per_year is
  'Typical weeks per year used for an experience portfolio estimate; weekly workload still uses weekly_hours.';
comment on column public.activities.impact is
  'Student-authored evidence of contribution, responsibility, growth, or outcome.';

create index if not exists activities_user_active_idx
  on public.activities(user_id, is_active, updated_at desc);
