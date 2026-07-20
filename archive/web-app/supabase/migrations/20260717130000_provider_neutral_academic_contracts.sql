-- Provider-neutral read contracts over the existing immutable SMCCD product history.
-- New districts can publish into the generic contract without changing student and
-- Pilot consumers. Existing SMCCD tables and identifiers remain compatible.

create or replace view public.college_courses
with (security_invoker = true)
as
select
  course.id,
  'SMCCD'::text as district_code,
  course.college_code as provider_code,
  course.course_code,
  course.subject,
  course.course_number,
  course.title,
  course.units_min,
  course.units_max,
  course.degree_applicable,
  course.transfer_credit,
  course.attributes,
  course.prerequisites,
  course.corequisites,
  course.recommended_preparation,
  course.detail_status,
  course.catalog_url,
  course.source_year
from public.smccd_courses course;

create or replace view public.college_programs
with (security_invoker = true)
as
select
  program.id,
  'SMCCD'::text as district_code,
  program.college_code as provider_code,
  program.program_code,
  program.title,
  program.award_type,
  program.total_degree_units,
  program.total_major_units_text,
  program.catalog_url,
  program.source_year
from public.smccd_programs program;

create or replace view public.college_program_requirements
with (security_invoker = true)
as
select
  requirement.id,
  requirement.program_id,
  requirement.label,
  requirement.kind,
  requirement.min_units,
  requirement.min_count,
  requirement.raw_text,
  requirement.constraint_only,
  requirement.sort_order
from public.smccd_program_requirements requirement;

create or replace view public.college_requirement_courses
with (security_invoker = true)
as
select id, requirement_id, course_code, units_text, note
from public.smccd_requirement_courses;

create or replace view public.school_college_course_equivalencies
with (security_invoker = true)
as
select
  equivalency.normalized_course_code as id,
  source.school_id,
  'SMCCD'::text as district_code,
  equivalency.normalized_course_code,
  equivalency.college_course_code,
  equivalency.description,
  equivalency.college_units,
  equivalency.high_school_credits,
  equivalency.high_school_equivalent,
  equivalency.requirement_area,
  equivalency.pairing_note,
  equivalency.source_id,
  equivalency.confidence
from public.smccd_high_school_equivalencies equivalency
join public.official_sources source on source.id = equivalency.source_id
where source.is_official = true
  and source.school_id is not null
  and equivalency.confidence = 'verified';

grant select on public.college_courses,
  public.college_programs,
  public.college_program_requirements,
  public.college_requirement_courses,
  public.school_college_course_equivalencies
to authenticated;

comment on view public.college_courses is
  'Provider-neutral college-course read contract. SMCCD is the first deep adapter; future district adapters must preserve source provenance.';
comment on view public.school_college_course_equivalencies is
  'Only official, selected-school-specific college-to-high-school equivalencies. College unit count alone never establishes diploma credit.';
