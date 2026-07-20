drop index if exists public.schools_cds_code_unique;
create unique index schools_cds_code_unique on public.schools(cds_code);

comment on index public.schools_cds_code_unique is
  'Supports idempotent CDE directory upserts; PostgreSQL permits multiple null CDS values for future private-school expansion.';
