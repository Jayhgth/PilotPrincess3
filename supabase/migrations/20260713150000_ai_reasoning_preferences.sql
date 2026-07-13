alter table public.student_settings
  drop constraint if exists student_profiles_ai_reasoning_effort_check,
  drop constraint if exists student_settings_ai_reasoning_effort_check;

alter table public.student_settings
  add constraint student_settings_ai_reasoning_effort_check
  check (ai_reasoning_effort in ('low', 'medium', 'high'));

comment on column public.student_settings.ai_reasoning_effort is
  'Student-selected Codex reasoning depth for Pilot Assistant turns.';
