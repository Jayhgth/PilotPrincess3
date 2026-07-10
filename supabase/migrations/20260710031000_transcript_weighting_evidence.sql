-- The transcript legend defines * as UC A-G approval, not honors. Repair
-- previously imported d.tech rows from their reviewed course names instead of
-- inheriting the combined catalog row's honors flag.

update public.plan_courses plan_course
set is_weighted = coalesce(
      (coalesce(review_item.corrected_payload, review_item.proposed_payload) ->> 'course_name') ilike '%honors%',
      false
    ),
    updated_at = now()
from public.catalog_review_items review_item
where plan_course.source_review_item_id = review_item.id
  and coalesce(review_item.corrected_payload, review_item.proposed_payload) ->> 'institution_name' ilike '%Design Tech High School%';
