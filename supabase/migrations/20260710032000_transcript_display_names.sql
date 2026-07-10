-- Keep the exact reviewed transcript label for display while retaining the
-- catalog foreign key for mappings and source-backed calculations.

update public.plan_courses plan_course
set custom_course_name = nullif(
      trim(coalesce(review_item.corrected_payload, review_item.proposed_payload) ->> 'course_name'),
      ''
    ),
    updated_at = now()
from public.catalog_review_items review_item
where plan_course.source_review_item_id = review_item.id
  and plan_course.course_id is not null
  and plan_course.custom_course_name is null;
