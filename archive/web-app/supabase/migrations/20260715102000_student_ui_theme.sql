alter table public.student_settings
  add column if not exists ui_theme text not null default 'light';

alter table public.student_settings
  drop constraint if exists student_settings_ui_theme_check,
  add constraint student_settings_ui_theme_check check (ui_theme in ('light', 'dark'));

comment on column public.student_settings.ui_theme is
  'Student-owned interface theme shared across devices and controllable through the normal reversible settings path.';
