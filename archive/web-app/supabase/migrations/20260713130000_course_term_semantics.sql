-- d.tech prints summer coursework in the upcoming grade's S0 column. Store it
-- with the preceding high-school year so the four-year plan follows chronology.
update public.plan_courses
set
  grade_level = grade_level - 1,
  school_year = case
    when school_year ~ '^\d{4}-\d{4}$' then
      ((split_part(school_year, '-', 1)::integer - 1)::text
        || '-'
        || (split_part(school_year, '-', 2)::integer - 1)::text)
    else school_year
  end
where term = 'summer'
  and grade_level > 9
  and (source_review_item_id is not null or grade_level = 12);

with normalized as (
  select
    id,
    jsonb_set(
      jsonb_set(
        proposed_payload,
        '{grade_level}',
        to_jsonb((proposed_payload ->> 'grade_level')::integer - 1)
      ),
      '{school_year}',
      case
        when (proposed_payload ->> 'school_year') ~ '^\d{4}-\d{4}$' then
          to_jsonb(
            ((split_part(proposed_payload ->> 'school_year', '-', 1)::integer - 1)::text
              || '-'
              || (split_part(proposed_payload ->> 'school_year', '-', 2)::integer - 1)::text)
          )
        else coalesce(proposed_payload -> 'school_year', 'null'::jsonb)
      end
    ) as payload
  from public.catalog_review_items
  where entity_type = 'transcript_course'
    and proposed_payload ->> 'term' = 'summer'
    and (proposed_payload ->> 'grade_level')::integer > 9
)
update public.catalog_review_items as item
set proposed_payload = normalized.payload
from normalized
where item.id = normalized.id;

with normalized as (
  select
    id,
    jsonb_set(
      jsonb_set(
        corrected_payload,
        '{grade_level}',
        to_jsonb((corrected_payload ->> 'grade_level')::integer - 1)
      ),
      '{school_year}',
      case
        when (corrected_payload ->> 'school_year') ~ '^\d{4}-\d{4}$' then
          to_jsonb(
            ((split_part(corrected_payload ->> 'school_year', '-', 1)::integer - 1)::text
              || '-'
              || (split_part(corrected_payload ->> 'school_year', '-', 2)::integer - 1)::text)
          )
        else coalesce(corrected_payload -> 'school_year', 'null'::jsonb)
      end
    ) as payload
  from public.catalog_review_items
  where entity_type = 'transcript_course'
    and corrected_payload is not null
    and corrected_payload ->> 'term' = 'summer'
    and (corrected_payload ->> 'grade_level')::integer > 9
)
update public.catalog_review_items as item
set corrected_payload = normalized.payload
from normalized
where item.id = normalized.id;

alter table public.plan_courses
  add constraint plan_courses_no_summer_after_grade_12
  check (not (grade_level = 12 and term = 'summer'));
