-- Reconcile transcript spellings with the selected school's current catalog.
-- This repairs older imports that predate catalog-aware review matching and
-- keeps transcript identity usable by graduation progress and Pilot.

create or replace function public.normalize_school_course_title(value text, strip_honors boolean default false)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select case normalized
    when 'foundationdesignthinking' then 'foundationindesignthinking'
    else normalized
  end
  from (
    select regexp_replace(
      case when strip_honors
        then regexp_replace(expanded, '(^|[^a-z0-9])honors?([^a-z0-9]|$)', '\1\2', 'g')
        else expanded
      end,
      '[^a-z0-9]+',
      '',
      'g'
    ) as normalized
    from (
      select regexp_replace(
        regexp_replace(
          regexp_replace(lower(value), '^\s*d\s*\.?\s*lab\s*:\s*', ''),
          '(^|[^a-z0-9])intro([^a-z0-9]|$)',
          '\1introduction\2',
          'g'
        ),
        '(^|[^a-z0-9])advanced placement([^a-z0-9]|$)',
        '\1ap\2',
        'g'
      ) as expanded
    ) source
  ) keyed
$$;

with review_payloads as (
  select
    review.id as review_id,
    source.school_id,
    school.slug as school_slug,
    coalesce(review.corrected_payload, review.proposed_payload) as payload
  from public.catalog_review_items review
  join public.official_sources source on source.id = review.source_id
  left join public.schools school on school.id = source.school_id
  where review.entity_type = 'transcript_course'
    and source.school_id is not null
    and nullif(coalesce(review.corrected_payload, review.proposed_payload) ->> 'matched_smccd_course_id', '') is null
), raw_candidates as (
  select distinct
    review.review_id,
    review.school_slug,
    course.id as course_id,
    course.name as course_name,
    case
      when public.normalize_school_course_title(alias.value, false)
        = public.normalize_school_course_title(review.payload ->> 'course_name', false) then 0
      else 1
    end as priority
  from review_payloads review
  join public.courses course
    on course.school_id = review.school_id
   and course.review_status = 'approved'
  join public.catalog_versions version
    on version.id = course.catalog_version_id
   and version.is_current
  cross join lateral regexp_split_to_table(course.name, '\s*/\s*') alias(value)
  where public.normalize_school_course_title(alias.value, false)
      = public.normalize_school_course_title(review.payload ->> 'course_name', false)
     or public.normalize_school_course_title(alias.value, true)
      = public.normalize_school_course_title(review.payload ->> 'course_name', true)
), prioritized_candidates as (
  select
    candidate.*,
    min(priority) over (partition by review_id) as best_priority
  from raw_candidates candidate
), unique_candidates as (
  select
    candidate.*,
    count(*) over (partition by review_id) as candidate_count
  from prioritized_candidates candidate
  where priority = best_priority
), resolved as (
  select *
  from unique_candidates
  where candidate_count = 1
), repaired_reviews as (
  select
    review.id,
    review.proposed_payload || jsonb_build_object(
      'matched_course_id', resolved.course_id,
      'matched_course_name', resolved.course_name,
      'transcript_classification', case when resolved.school_slug = 'design-tech-high-school' then 'dtech_catalog' else 'high_school_catalog' end
    ) as proposed_payload,
    case when review.corrected_payload is null then null else
      review.corrected_payload || jsonb_build_object(
        'matched_course_id', resolved.course_id,
        'matched_course_name', resolved.course_name,
        'transcript_classification', case when resolved.school_slug = 'design-tech-high-school' then 'dtech_catalog' else 'high_school_catalog' end
      )
    end as corrected_payload,
    coalesce(array(
      select note
      from unnest(review.uncertainty_notes) note
      where note not like 'No exact selected-school catalog match was found%'
        and note not like 'No exact d.tech catalog match was found.%'
    ), '{}'::text[]) as uncertainty_notes
  from public.catalog_review_items review
  join resolved on resolved.review_id = review.id
)
update public.catalog_review_items review
set
  proposed_payload = repaired.proposed_payload,
  corrected_payload = repaired.corrected_payload,
  uncertainty_notes = repaired.uncertainty_notes,
  updated_at = now()
from repaired_reviews repaired
where review.id = repaired.id;

update public.plan_courses plan_course
set
  course_id = course.id,
  smccd_course_id = null,
  college_provider_code = null,
  college_units = null,
  mapping_verified = exists (
    select 1
    from public.course_requirement_mappings mapping
    where mapping.course_id = course.id
      and mapping.confidence = 'verified'
  ),
  updated_at = now()
from public.catalog_review_items review
join public.courses course
  on course.id = nullif(coalesce(review.corrected_payload, review.proposed_payload) ->> 'matched_course_id', '')::uuid
where plan_course.source_review_item_id = review.id
  and coalesce(review.corrected_payload, review.proposed_payload) ->> 'transcript_classification' in ('dtech_catalog', 'high_school_catalog');

comment on function public.normalize_school_course_title(text, boolean) is
  'Deterministic selected-school transcript/catalog identity key; optional honors removal is used only after exact matching.';
