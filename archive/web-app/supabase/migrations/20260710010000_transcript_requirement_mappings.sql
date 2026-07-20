-- Transcript aliases such as D.Lab and Intro map to these source-backed
-- catalog courses. Their graduation-area relationship is explicit in the
-- official graduation requirements, even when a catalog row itself is marked
-- likely because of catalog extraction confidence.

update public.course_requirement_mappings mapping
set confidence = 'verified'::public.confidence_status
from public.courses course,
     public.graduation_requirements requirement
where mapping.course_id = course.id
  and mapping.requirement_id = requirement.id
  and (
    requirement.area = 'design_lab'::public.requirement_area
    or (
      requirement.area = 'personal_development'::public.requirement_area
      and course.name = 'Introduction to Prototyping and Fabrication'
    )
  );

-- Repair already imported transcript rows that were left custom because the
-- transcript used the school's shortened labels.
update public.plan_courses plan_course
set course_id = course.id,
    custom_course_name = null,
    mapping_verified = true,
    updated_at = now()
from public.courses course
where plan_course.source_review_item_id is not null
  and plan_course.course_id is null
  and (
    (plan_course.custom_course_name ilike 'D.Lab: CoDesigners%' and course.name = 'Co-designers')
    or (plan_course.custom_course_name ilike 'D.Lab: Innovation Diploma%' and course.name = 'Innovation Diploma')
    or (plan_course.custom_course_name ilike 'Foundation Design Thinking%' and course.name = 'Foundation in Design Thinking')
    or (plan_course.custom_course_name ilike 'Intro to Prototyping and Fabrication%' and course.name = 'Introduction to Prototyping and Fabrication')
  );

update public.plan_courses plan_course
set mapping_verified = true,
    updated_at = now()
from public.course_requirement_mappings mapping,
     public.graduation_requirements requirement
where plan_course.source_review_item_id is not null
  and plan_course.course_id = mapping.course_id
  and mapping.requirement_id = requirement.id
  and mapping.confidence = 'verified'::public.confidence_status
  and requirement.area in (
    'design_lab'::public.requirement_area,
    'personal_development'::public.requirement_area
  );
