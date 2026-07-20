-- Local authorities can require multiple distinct courses in the same broad
-- subject family (for example Health and College & Career). Keep a stable
-- source key instead of collapsing them into one enum bucket.

alter table public.graduation_requirements
  add column if not exists requirement_key text;

update public.graduation_requirements
set requirement_key = coalesce(requirement_key, area::text)
where requirement_key is null;

alter table public.graduation_requirements
  alter column requirement_key set not null;

alter table public.graduation_requirements
  drop constraint if exists graduation_requirements_catalog_version_id_area_key;

create unique index if not exists graduation_requirements_version_source_key
  on public.graduation_requirements(catalog_version_id, requirement_key);

comment on column public.graduation_requirements.requirement_key is
  'Stable source-local key. Multiple explicit requirements may share one broad progress area without being merged.';
