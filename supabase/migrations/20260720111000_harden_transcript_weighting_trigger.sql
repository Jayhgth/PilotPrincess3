-- Prevent caller-controlled schema resolution inside the transcript weighting trigger.

create or replace function public.enforce_transcript_course_weighting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  payload jsonb;
  catalog_school_slug text;
begin
  if new.source_review_item_id is not null then
    select
      coalesce(review.corrected_payload, review.proposed_payload),
      school.slug
    into payload, catalog_school_slug
    from public.catalog_review_items review
    left join public.courses course on course.id = new.course_id
    left join public.schools school on school.id = course.school_id
    where review.id = new.source_review_item_id;
  end if;

  if payload is not null then
    if coalesce(payload ->> 'transcript_classification', '') = 'dtech_intersession' then
      new.smccd_course_id := null;
      new.college_provider_code := null;
      new.college_units := null;
      new.is_weighted := false;
      return new;
    elsif coalesce(payload ->> 'transcript_classification', '') = 'dtech_catalog'
      or (
        nullif(payload ->> 'matched_course_id', '') is not null
        and nullif(payload ->> 'matched_smccd_course_id', '') is null
      )
      or coalesce(payload ->> 'institution_name', '') ~* '(Design Tech High School|d\.?tech)'
      or catalog_school_slug = 'design-tech-high-school' then
      new.smccd_course_id := null;
      new.college_provider_code := null;
      new.college_units := null;
      new.is_weighted := coalesce(payload ->> 'course_name', '') ~* '(^|[^[:alnum:]])honors?([^[:alnum:]]|$)';
      return new;
    elsif coalesce(payload ->> 'transcript_classification', '') in ('smccd_catalog', 'smccd_unmatched')
      or coalesce(payload ->> 'institution_name', '') ~* '(College of San Mateo|Skyline College|Cañada College|Canada College)' then
      new.is_weighted := true;
      return new;
    end if;
  end if;

  if new.smccd_course_id is not null
    or new.college_provider_code is not null
    or coalesce(new.college_units, 0) > 0 then
    new.is_weighted := true;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_transcript_course_weighting() from public;
