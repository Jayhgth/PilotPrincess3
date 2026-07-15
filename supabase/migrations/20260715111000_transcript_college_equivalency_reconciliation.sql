-- Re-apply selected-school college equivalencies to transcript rows imported
-- after the original equivalency catalog migration was installed.

update public.plan_courses plan_course
set
  credits = equivalency.high_school_credits,
  requirement_area_override = equivalency.requirement_area,
  mapping_verified = true,
  updated_at = now()
from public.smccd_high_school_equivalencies equivalency
where plan_course.source_review_item_id is not null
  and equivalency.normalized_course_code = coalesce(
    (
      select upper(smccd_course.course_code)
      from public.smccd_courses smccd_course
      where smccd_course.id = plan_course.smccd_course_id
    ),
    regexp_replace(
      substring(upper(coalesce(plan_course.custom_course_name, '')) from '^([A-Z]{2,5}[.]?[[:space:]]+[A-Z]?[0-9]{2,4}([.][0-9])?[A-Z]?)'),
      '^([A-Z]{2,5})[.]',
      '\1'
    )
  );
