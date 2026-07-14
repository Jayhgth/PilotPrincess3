-- Skyline's information-literacy tutorial or an equivalent competency can be
-- confirmed manually. Area 7A remains the only manually confirmed GE area.

alter table public.student_smccd_ge_completions
  drop constraint if exists student_smccd_ge_completions_area_check;

alter table public.student_smccd_ge_completions
  add constraint student_smccd_ge_completions_area_check
  check (area in ('7A', 'information_literacy'));

comment on table public.student_smccd_ge_completions is
  'Student-confirmed local AA/AS degree completions not reliably represented on transcripts: Area 7A waivers and Skyline information literacy.';
