alter table public.student_profiles
  add column if not exists weekly_commitment_limit numeric(5,1)
  check (weekly_commitment_limit is null or weekly_commitment_limit between 1 and 80);

comment on column public.student_profiles.weekly_commitment_limit is
  'Student-entered weekly hours available for activities and college coursework outside the d.tech school day.';

alter table public.plan_courses
  add column if not exists requirement_area_override public.requirement_area;

comment on column public.plan_courses.requirement_area_override is
  'Source-backed graduation area for transcript rows that do not have a catalog course record, such as intersession electives.';

-- Every SMCCD course shown on the d.tech transcript contributes the weighted
-- GPA point. This also repairs exact and manual college rows imported earlier.
update public.plan_courses
set is_weighted = true,
    updated_at = now()
where smccd_course_id is not null
   or coalesce(college_units, 0) > 0;

-- The official d.tech graduation requirement identifies intersession elective
-- classes as Personal Development at 2.5 credits per class. The transcript
-- records those rows with P, which is excluded from GPA but still earns credit.
update public.plan_courses
set requirement_area_override = 'personal_development'::public.requirement_area,
    mapping_verified = true,
    updated_at = now()
where source_review_item_id is not null
  and upper(coalesce(letter_grade, '')) = 'P'
  and smccd_course_id is null
  and coalesce(college_units, 0) = 0
  and credits in (2.5, 5)
  and notes ilike '%Design Tech High School%';
