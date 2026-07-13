-- A transcript has two representations: flattened reading order owns course
-- identity, while positioned text owns semester placement. Repair quarter-coded
-- d.tech intersession rows that an older layout parse attached to a college
-- heading, then enforce one replaceable transcript source per student.

with quarter_reviews as (
  select
    review.id,
    coalesce(review.corrected_payload, review.proposed_payload) as payload
  from public.catalog_review_items review
  join public.official_sources source on source.id = review.source_id
  where source.document_type = 'transcript'
    and review.entity_type = 'transcript_course'
    and upper(coalesce(coalesce(review.corrected_payload, review.proposed_payload) ->> 'letter_grade', '')) in ('P', 'F')
    and nullif(coalesce(review.corrected_payload, review.proposed_payload) ->> 'course_code', '') is null
    and nullif(coalesce(review.corrected_payload, review.proposed_payload) ->> 'credits', '')::numeric = 2.5
    and regexp_replace(lower(coalesce(source.raw_text, '')), '[^a-z0-9]+', ' ', 'g')
      ~ ('q[1-4] ' || regexp_replace(
        lower(coalesce(coalesce(review.corrected_payload, review.proposed_payload) ->> 'course_name', '')),
        '[^a-z0-9]+',
        ' ',
        'g'
      ))
), repaired as (
  select
    review.id,
    review.proposed_payload || jsonb_build_object(
      'institution_name', 'Design Tech High School',
      'reported_institution_name', case
        when coalesce(quarter.payload ->> 'institution_name', '') ~* '(College of San Mateo|Skyline College|Cañada College|Canada College)'
          then quarter.payload ->> 'institution_name'
        else quarter.payload ->> 'reported_institution_name'
      end,
      'institution_resolution', 'dtech_quarter_identity',
      'subject', 'Personal Development',
      'matched_course_id', null,
      'matched_course_name', null,
      'matched_smccd_course_id', null,
      'matched_smccd_course_name', null,
      'college_units', null,
      'transcript_classification', 'dtech_intersession',
      'grading_basis', 'pass_fail',
      'weighted', false,
      'weighting_basis', 'dtech_printed_standard',
      'weighting_source_id', null
    ) as proposed_payload,
    case when review.corrected_payload is null then null else
      review.corrected_payload || jsonb_build_object(
        'institution_name', 'Design Tech High School',
        'reported_institution_name', case
          when coalesce(quarter.payload ->> 'institution_name', '') ~* '(College of San Mateo|Skyline College|Cañada College|Canada College)'
            then quarter.payload ->> 'institution_name'
          else quarter.payload ->> 'reported_institution_name'
        end,
        'institution_resolution', 'dtech_quarter_identity',
        'subject', 'Personal Development',
        'matched_course_id', null,
        'matched_course_name', null,
        'matched_smccd_course_id', null,
        'matched_smccd_course_name', null,
        'college_units', null,
        'transcript_classification', 'dtech_intersession',
        'grading_basis', 'pass_fail',
        'weighted', false,
        'weighting_basis', 'dtech_printed_standard',
        'weighting_source_id', null
      )
    end as corrected_payload
  from public.catalog_review_items review
  join quarter_reviews quarter on quarter.id = review.id
)
update public.catalog_review_items review
set
  proposed_payload = repaired.proposed_payload,
  corrected_payload = repaired.corrected_payload,
  uncertainty_notes = array_remove(review.uncertainty_notes, 'No exact d.tech catalog match was found. This course will remain custom until reviewed.'),
  updated_at = now()
from repaired
where review.id = repaired.id;

update public.plan_courses plan_course
set
  course_id = null,
  smccd_course_id = null,
  college_provider_code = null,
  college_units = null,
  is_weighted = false,
  mapping_verified = upper(coalesce(payload.value ->> 'letter_grade', '')) = 'P',
  notes = case
    when upper(coalesce(payload.value ->> 'letter_grade', '')) = 'P'
      then 'Imported from a reviewed transcript (Design Tech High School). Recognized from the transcript as a d.tech intersession pass/fail course with Personal Development credit.'
    else 'Imported from a reviewed transcript (Design Tech High School). Recognized from the transcript as a d.tech intersession pass/fail course; no Personal Development credit is earned for an F.'
  end,
  requirement_area_override = 'personal_development',
  updated_at = now()
from public.catalog_review_items review,
  lateral (select coalesce(review.corrected_payload, review.proposed_payload) as value) payload
where plan_course.source_review_item_id = review.id
  and payload.value ->> 'transcript_classification' = 'dtech_intersession';

-- Keep the newest uploaded transcript as the replaceable canonical source.
with ranked_sources as (
  select
    source.id,
    row_number() over (
      partition by source.user_id
      order by source.updated_at desc, source.created_at desc, source.id desc
    ) as source_rank
  from public.official_sources source
  where source.document_type = 'transcript'
    and not source.is_official
    and source.user_id is not null
), duplicate_sources as (
  select id from ranked_sources where source_rank > 1
)
delete from public.plan_courses plan_course
using public.catalog_review_items review, duplicate_sources duplicate
where plan_course.source_review_item_id = review.id
  and review.source_id = duplicate.id;

with ranked_sources as (
  select
    source.id,
    row_number() over (
      partition by source.user_id
      order by source.updated_at desc, source.created_at desc, source.id desc
    ) as source_rank
  from public.official_sources source
  where source.document_type = 'transcript'
    and not source.is_official
    and source.user_id is not null
)
delete from public.official_sources source
using ranked_sources ranked
where source.id = ranked.id
  and ranked.source_rank > 1;

delete from public.plan_versions version
where version.kind = 'snapshot'
  and not exists (
    select 1 from public.plan_courses course where course.plan_version_id = version.id
  );

create unique index if not exists official_sources_one_student_transcript
  on public.official_sources(user_id)
  where document_type = 'transcript'
    and not is_official
    and user_id is not null;
