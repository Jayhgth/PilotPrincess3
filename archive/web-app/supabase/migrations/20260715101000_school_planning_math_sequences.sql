-- Starting-math placement controls the whole sequence. Keep the school profile's
-- preferred-course anchors for fixed subjects and let the prerequisite-aware
-- math planner select the next course from the selected school's own catalog.

update public.school_planning_profiles profile
set grade_rules = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(profile.grade_rules, '{9,preferred_course_names}', '["English 1","Ethnic Studies","Environmental Science","Foundation in Design Thinking","Spanish 1","Introduction to Prototyping and Fabrication"]'::jsonb),
      '{10,preferred_course_names}', '["English 2","World History","Chemistry","Co-designers","Spanish 2","Introduction to Visual Art"]'::jsonb
    ),
    '{11,preferred_course_names}', '["English 3","US History","Biology"]'::jsonb
  ),
  '{12,preferred_course_names}', '["English 4","Government & Economics"]'::jsonb
)
where profile.school_id = (
  select school.id from public.schools school where school.slug = 'design-tech-high-school' limit 1
)
and profile.status = 'verified';

