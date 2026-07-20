alter table public.student_settings
  drop constraint if exists student_profiles_plan_grade_order_check,
  drop constraint if exists student_profiles_plan_length_check,
  drop column if exists plan_start_grade,
  drop column if exists plan_end_grade;

comment on table public.student_settings is
  'Student-owned profile and application preferences. Four-year plans always span grades 9 through 12; current grade is temporal context, not a plan-access boundary.';
