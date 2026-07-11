create table public.enrollment_policies (
  id text primary key,
  provider_code text not null,
  provider_name text not null,
  program_type text not null check (program_type in ('concurrent', 'dual')),
  term text not null default 'any' check (term in ('fall', 'spring', 'summer', 'any')),
  unit_system text not null check (unit_system in ('semester', 'quarter')),
  recommended_max_units numeric(4,1) not null check (recommended_max_units >= 0),
  fee_free_max_units numeric(4,1) not null check (fee_free_max_units >= recommended_max_units),
  absolute_max_units numeric(4,1) not null check (absolute_max_units >= fee_free_max_units),
  approval_required boolean not null default true,
  source_url text not null,
  source_label text not null,
  source_year text not null,
  notes text,
  confidence public.confidence_status not null default 'likely',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_code, program_type, term)
);

create table public.student_enrollment_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_code text not null,
  program_type text not null check (program_type in ('concurrent', 'dual')),
  limit_mode text not null default 'recommended' check (limit_mode in ('recommended', 'fee_free', 'absolute', 'custom')),
  custom_unit_limit numeric(4,1) check (custom_unit_limit is null or custom_unit_limit between 0 and 30),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider_code),
  constraint student_enrollment_preferences_profile_fk
    foreign key (user_id) references public.student_profiles(id) on delete cascade,
  check (limit_mode <> 'custom' or custom_unit_limit is not null)
);

alter table public.plan_courses
  add column college_provider_code text;

update public.plan_courses
set college_provider_code = 'SMCCD'
where smccd_course_id is not null;

create index plan_courses_college_provider_idx
  on public.plan_courses (user_id, college_provider_code)
  where college_provider_code is not null;

create trigger enrollment_policies_set_updated_at
  before update on public.enrollment_policies
  for each row execute function public.set_updated_at();

create trigger student_enrollment_preferences_set_updated_at
  before update on public.student_enrollment_preferences
  for each row execute function public.set_updated_at();

alter table public.enrollment_policies enable row level security;
alter table public.student_enrollment_preferences enable row level security;

create policy "authenticated users read enrollment policies"
  on public.enrollment_policies for select to authenticated using (true);

create policy "users manage own enrollment preferences"
  on public.student_enrollment_preferences for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

insert into public.enrollment_policies (
  id, provider_code, provider_name, program_type, term, unit_system,
  recommended_max_units, fee_free_max_units, absolute_max_units,
  approval_required, source_url, source_label, source_year, notes, confidence
) values
  (
    'smccd-concurrent-2026', 'SMCCD', 'San Mateo County Community College District',
    'concurrent', 'any', 'semester', 11, 11.5, 19, true,
    'https://smccd.edu/k-12/faqs.php', 'SMCCD K-12 Frequently Asked Questions', '2026',
    'The district FAQ lists 11.5 fee-free units and a 19-unit K-12 maximum. The current College of San Mateo concurrent-enrollment page says 11 units or fewer avoid enrollment and health fees, so 11 is the conservative planning threshold. Course approval, prerequisites, impacted-program restrictions, materials, and textbooks remain separate.',
    'verified'
  ),
  (
    'smccd-dual-2026', 'SMCCD', 'San Mateo County Community College District',
    'dual', 'any', 'semester', 15, 15.5, 19, true,
    'https://smccd.edu/k-12/faqs.php', 'SMCCD K-12 Frequently Asked Questions', '2026',
    'The district FAQ lists 15.5 fee-free units for dual enrollment and a 19-unit K-12 maximum. A partnership, school approval, prerequisites, course availability, and program-specific rules still apply.',
    'verified'
  )
on conflict (id) do update set
  provider_name = excluded.provider_name,
  recommended_max_units = excluded.recommended_max_units,
  fee_free_max_units = excluded.fee_free_max_units,
  absolute_max_units = excluded.absolute_max_units,
  approval_required = excluded.approval_required,
  source_url = excluded.source_url,
  source_label = excluded.source_label,
  source_year = excluded.source_year,
  notes = excluded.notes,
  confidence = excluded.confidence,
  updated_at = now();

comment on table public.enrollment_policies is
  'Source-backed, provider-specific concurrent and dual-enrollment unit thresholds. Limits are data, not application constants.';

comment on table public.student_enrollment_preferences is
  'Per-student choice of which source-backed enrollment threshold the schedule planner should enforce.';

update public.ai_knowledge_chunks
set content = 'Overview owns the current path and next actions. Courses owns Done, In progress, Planned classes, and plan snapshots. Graduation owns diploma, A-G, and degree evidence. GPA planner owns deterministic grade scenarios plus workload and provider-specific college-unit guardrails. Student profile is a centered settings dialog for direction, interests, capacity, and experiences. Transcript import owns evidence review and is entered from Courses. Pilot may read every area and propose supported changes through exact validated tools.'
where id = 'workspace-ownership';

update public.ai_knowledge_chunks
set content = 'Graduation and GPA are deterministic. Keep earned, current, planned, unverified, and open credit distinct. A d.tech star means A-G approval, not Honors. A+, A, and A- share the same grade-point band while preserving the printed mark. Pass grades earn eligible credit but do not enter GPA. GPA scenarios use only the saved schedule and student-supplied expected grades. Call the all-A result a saved-schedule ceiling, never a prediction or admissions guarantee. Before suggesting a schedule change, check graduation, prerequisites, workload, and provider-specific concurrent-enrollment limits.'
where id = 'graduation-gpa';

insert into public.ai_knowledge_chunks (id, title, content, source_path, tags, priority)
values (
  'concurrent-enrollment-guardrails',
  'Concurrent enrollment guardrails',
  'Concurrent-enrollment limits are provider, program, term, and unit-system specific. For SMCCD, use the enrollment_policies record and the student-selected guardrail. Aggregate CSM, Skyline, and Cañada units across the same term. The conservative concurrent threshold is 11 units, the district FAQ fee-free figure is 11.5, and the K-12 maximum is 19. Dual-enrollment figures differ. Unit count alone never proves eligibility: prerequisites, school and college approval, impacted restrictions, materials, fees, and availability remain separate. Other districts require their own sourced policy rows.',
  'docs/ACADEMIC_RULES.md',
  array['assistant', 'gpa', 'courses', 'smccd', 'all'],
  9
)
on conflict (id) do update set
  content = excluded.content,
  tags = excluded.tags,
  priority = excluded.priority,
  is_active = true,
  updated_at = now();
