create table public.student_gpa_scenario_choices (
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_course_id uuid not null references public.plan_courses(id) on delete cascade,
  included boolean not null default true,
  expected_grade text check (
    expected_grade is null
    or expected_grade in ('A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'F')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, plan_course_id)
);

create trigger student_gpa_scenario_choices_set_updated_at
before update on public.student_gpa_scenario_choices
for each row execute procedure public.set_updated_at();

alter table public.student_gpa_scenario_choices enable row level security;

create policy "users manage own GPA scenarios"
on public.student_gpa_scenario_choices for all
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.plan_courses course
    where course.id = plan_course_id
      and course.user_id = (select auth.uid())
  )
);

comment on table public.student_gpa_scenario_choices is
  'Saved GPA-planner inclusion and expected-grade choices. These assumptions never replace transcript grades or plan-course evidence.';
