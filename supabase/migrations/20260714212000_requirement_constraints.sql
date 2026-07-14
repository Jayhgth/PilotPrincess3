-- Local graduation rules can contain required pathways whose credits are
-- already counted in a broader area. Track them without double-counting the
-- aggregate diploma progress bar.

alter table public.graduation_requirements
  add column if not exists constraint_only boolean not null default false;

comment on column public.graduation_requirements.constraint_only is
  'Required pathway or subrule whose credits are already counted in another area and must not inflate aggregate progress.';
