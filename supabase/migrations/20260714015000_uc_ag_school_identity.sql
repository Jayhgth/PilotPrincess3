alter table public.schools
  add column if not exists uc_ag_atp_code text,
  add column if not exists uc_ag_directory_updated_at timestamptz;

create unique index if not exists schools_uc_ag_institution_unique
  on public.schools(uc_ag_institution_id)
  where uc_ag_institution_id is not null;

create index if not exists schools_uc_ag_atp_code
  on public.schools(uc_ag_atp_code)
  where uc_ag_atp_code is not null;

comment on column public.schools.uc_ag_institution_id is
  'Public UCOP A-G Course List institution identifier; populated only by an exact school-and-city directory match or reviewed correction.';
comment on column public.schools.uc_ag_atp_code is
  'UCOP A-G six-digit ATP institution code from the public course-list directory.';
