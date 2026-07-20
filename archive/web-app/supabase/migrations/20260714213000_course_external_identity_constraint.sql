-- PostgREST can target a normal unique constraint during idempotent source
-- refreshes. PostgreSQL unique constraints already permit multiple nulls, so
-- the earlier partial index is unnecessary.

drop index if exists public.courses_school_external_identity;

alter table public.courses
  drop constraint if exists courses_school_external_identity_key,
  add constraint courses_school_external_identity_key unique (school_id, external_course_id);
