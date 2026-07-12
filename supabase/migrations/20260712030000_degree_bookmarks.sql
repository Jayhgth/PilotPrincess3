-- Degree selections are independent bookmarks. The former primary-degree rank is retired.
drop index if exists public.student_smccd_goals_one_primary;

update public.student_smccd_goals
set is_primary = false
where is_primary;

alter table public.student_smccd_goals
  alter column is_primary set default false;

comment on column public.student_smccd_goals.is_primary is
  'Deprecated compatibility field. Degree selections are unordered bookmarks.';

-- The course-page import omitted the new 2025-2026 Area 6 and CSM Area 8
-- secondary designations. Restore them from each college's official local GE pattern.
update public.smccd_courses
set attributes = array_append(attributes, 'AA/AS Degree Requirements: Area 6')
where college_code = 'CSM'
  and course_code = any (array['ETHN 101', 'ETHN 103', 'ETHN 104', 'ETHN 105', 'ETHN 106', 'ETHN 107', 'ETHN 108', 'ETHN 109', 'ETHN 110', 'ETHN 265', 'ETHN 288', 'ETHN 300', 'ETHN 585'])
  and not ('AA/AS Degree Requirements: Area 6' = any (attributes));

update public.smccd_courses
set attributes = array_append(attributes, 'AA/AS Degree Requirements: Area 8')
where college_code = 'CSM'
  and course_code = any (array['HIST 201', 'HIST 202', 'HIST 260', 'HIST 261', 'HIST 262', 'HIST 310', 'POLS C1000', 'POLS 210', 'POLS 310'])
  and not ('AA/AS Degree Requirements: Area 8' = any (attributes));

update public.smccd_courses
set attributes = array_append(attributes, 'AA/AS Degree Requirements: Area 6')
where college_code = 'CAN'
  and course_code = any (array['ETHN 103', 'ETHN 105', 'ETHN 107', 'ETHN 108', 'ETHN 109', 'ETHN 130', 'ETHN 265', 'ETHN 288'])
  and not ('AA/AS Degree Requirements: Area 6' = any (attributes));

update public.smccd_courses
set attributes = array_append(attributes, 'AA/AS Degree Requirements: Area 6')
where college_code = 'SKY'
  and course_code = any (array['ETHN 101', 'ETHN 103', 'ETHN 107', 'ETHN 108', 'ETHN 109', 'ETHN 120', 'ETHN 142', 'ETHN 265'])
  and not ('AA/AS Degree Requirements: Area 6' = any (attributes));
