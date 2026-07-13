-- Transcript weighting is evidence-derived. d.tech's transcript asterisk is a
-- UC A-G marker, so only an explicit Honors word in the printed course title
-- makes a d.tech transcript row weighted. College coursework remains weighted.

update public.catalog_review_items review
set proposed_payload = review.proposed_payload || jsonb_build_object(
  'reported_institution_name', review.proposed_payload ->> 'institution_name',
  'institution_name', 'Design Tech High School',
  'institution_resolution', 'dtech_catalog_identity'
)
where review.entity_type = 'transcript_course'
  and review.proposed_payload ->> 'transcript_classification' = 'dtech_catalog'
  and nullif(review.proposed_payload ->> 'matched_course_id', '') is not null
  and nullif(review.proposed_payload ->> 'matched_smccd_course_id', '') is null
  and nullif(review.proposed_payload ->> 'course_code', '') is null
  and coalesce(review.proposed_payload ->> 'institution_name', '') ~* '(College of San Mateo|Skyline College|Cañada College|Canada College)';

update public.catalog_review_items review
set corrected_payload = review.corrected_payload || jsonb_build_object(
  'reported_institution_name', review.corrected_payload ->> 'institution_name',
  'institution_name', 'Design Tech High School',
  'institution_resolution', 'dtech_catalog_identity'
)
where review.entity_type = 'transcript_course'
  and review.corrected_payload is not null
  and coalesce(
    review.corrected_payload ->> 'transcript_classification',
    review.proposed_payload ->> 'transcript_classification'
  ) = 'dtech_catalog'
  and nullif(coalesce(
    review.corrected_payload ->> 'matched_course_id',
    review.proposed_payload ->> 'matched_course_id'
  ), '') is not null
  and nullif(coalesce(
    review.corrected_payload ->> 'matched_smccd_course_id',
    review.proposed_payload ->> 'matched_smccd_course_id'
  ), '') is null
  and nullif(review.corrected_payload ->> 'course_code', '') is null
  and coalesce(review.corrected_payload ->> 'institution_name', '') ~* '(College of San Mateo|Skyline College|Cañada College|Canada College)';

with normalized as (
  select
    review.id,
    jsonb_set(
      jsonb_set(
        jsonb_set(
          review.proposed_payload,
          '{weighted}',
          to_jsonb(case
            when coalesce(review.proposed_payload ->> 'institution_name', '') ~* '(College of San Mateo|Skyline College|Cañada College|Canada College)' then true
            else coalesce(review.proposed_payload ->> 'course_name', '') ~* '(^|[^[:alnum:]])honors?([^[:alnum:]]|$)'
          end)
        ),
        '{weighting_basis}',
        to_jsonb(case
          when coalesce(review.proposed_payload ->> 'institution_name', '') ~* '(College of San Mateo|Skyline College|Cañada College|Canada College)' then 'college_course'
          when coalesce(review.proposed_payload ->> 'course_name', '') ~* '(^|[^[:alnum:]])honors?([^[:alnum:]]|$)' then 'dtech_printed_honors'
          else 'dtech_printed_standard'
        end::text)
      ),
      '{weighting_source_id}',
      coalesce(to_jsonb(course.source_id), 'null'::jsonb)
    ) as payload
  from public.catalog_review_items review
  left join public.courses course
    on course.id::text = review.proposed_payload ->> 'matched_course_id'
  where review.entity_type = 'transcript_course'
    and (
      coalesce(review.proposed_payload ->> 'institution_name', '') ~* '(Design Tech High School|d\.?tech)'
      or coalesce(review.proposed_payload ->> 'institution_name', '') ~* '(College of San Mateo|Skyline College|Cañada College|Canada College)'
    )
)
update public.catalog_review_items review
set proposed_payload = normalized.payload
from normalized
where review.id = normalized.id;

with normalized as (
  select
    review.id,
    jsonb_set(
      jsonb_set(
        jsonb_set(
          review.corrected_payload,
          '{weighted}',
          to_jsonb(case
            when coalesce(review.corrected_payload ->> 'institution_name', '') ~* '(College of San Mateo|Skyline College|Cañada College|Canada College)' then true
            else coalesce(review.corrected_payload ->> 'course_name', '') ~* '(^|[^[:alnum:]])honors?([^[:alnum:]]|$)'
          end)
        ),
        '{weighting_basis}',
        to_jsonb(case
          when coalesce(review.corrected_payload ->> 'institution_name', '') ~* '(College of San Mateo|Skyline College|Cañada College|Canada College)' then 'college_course'
          when coalesce(review.corrected_payload ->> 'course_name', '') ~* '(^|[^[:alnum:]])honors?([^[:alnum:]]|$)' then 'dtech_printed_honors'
          else 'dtech_printed_standard'
        end::text)
      ),
      '{weighting_source_id}',
      coalesce(to_jsonb(course.source_id), 'null'::jsonb)
    ) as payload
  from public.catalog_review_items review
  left join public.courses course
    on course.id::text = coalesce(
      review.corrected_payload ->> 'matched_course_id',
      review.proposed_payload ->> 'matched_course_id'
    )
  where review.entity_type = 'transcript_course'
    and review.corrected_payload is not null
    and (
      coalesce(review.corrected_payload ->> 'institution_name', '') ~* '(Design Tech High School|d\.?tech)'
      or coalesce(review.corrected_payload ->> 'institution_name', '') ~* '(College of San Mateo|Skyline College|Cañada College|Canada College)'
    )
)
update public.catalog_review_items review
set corrected_payload = normalized.payload
from normalized
where review.id = normalized.id;

update public.plan_courses plan_course
set is_weighted = case
      when plan_course.smccd_course_id is not null
        or plan_course.college_provider_code is not null
        or coalesce(plan_course.college_units, 0) > 0
        or coalesce(payload.value ->> 'institution_name', '') ~* '(College of San Mateo|Skyline College|Cañada College|Canada College)'
        then true
      else coalesce(payload.value ->> 'course_name', '') ~* '(^|[^[:alnum:]])honors?([^[:alnum:]]|$)'
    end,
    updated_at = now()
from public.catalog_review_items review,
  lateral (select coalesce(review.corrected_payload, review.proposed_payload) as value) payload
where plan_course.source_review_item_id = review.id
  and (
    coalesce(payload.value ->> 'institution_name', '') ~* '(Design Tech High School|d\.?tech)'
    or coalesce(payload.value ->> 'institution_name', '') ~* '(College of San Mateo|Skyline College|Cañada College|Canada College)'
  );

create or replace function public.enforce_transcript_course_weighting()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb;
  catalog_school_slug text;
begin
  if new.smccd_course_id is not null
    or new.college_provider_code is not null
    or coalesce(new.college_units, 0) > 0 then
    new.is_weighted := true;
    return new;
  end if;

  if new.source_review_item_id is null then
    return new;
  end if;

  select
    coalesce(review.corrected_payload, review.proposed_payload),
    school.slug
  into payload, catalog_school_slug
  from public.catalog_review_items review
  left join public.courses course on course.id = new.course_id
  left join public.schools school on school.id = course.school_id
  where review.id = new.source_review_item_id;

  if payload is null then
    return new;
  end if;

  if coalesce(payload ->> 'transcript_classification', '') = 'dtech_intersession' then
    new.is_weighted := false;
  elsif coalesce(payload ->> 'transcript_classification', '') = 'dtech_catalog'
    or coalesce(payload ->> 'institution_name', '') ~* '(Design Tech High School|d\.?tech)'
    or catalog_school_slug = 'design-tech-high-school' then
    new.is_weighted := coalesce(payload ->> 'course_name', '') ~* '(^|[^[:alnum:]])honors?([^[:alnum:]]|$)';
  elsif coalesce(payload ->> 'institution_name', '') ~* '(College of San Mateo|Skyline College|Cañada College|Canada College)' then
    new.is_weighted := true;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_transcript_course_weighting() from public;

drop trigger if exists enforce_transcript_course_weighting on public.plan_courses;
create trigger enforce_transcript_course_weighting
before insert or update of source_review_item_id, course_id, smccd_course_id, college_provider_code, college_units, is_weighted
on public.plan_courses
for each row execute function public.enforce_transcript_course_weighting();
