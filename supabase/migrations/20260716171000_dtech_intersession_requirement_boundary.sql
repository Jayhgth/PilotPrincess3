with dtech as (
  select id from public.schools where slug = 'design-tech-high-school'
), prototyping as (
  update public.courses course
  set subject = 'Design and Fabrication',
      updated_at = now()
  where course.school_id = (select id from dtech)
    and course.name = 'Introduction to Prototyping and Fabrication'
  returning course.id
), personal_development as (
  select requirement.id
  from public.graduation_requirements requirement
  where requirement.school_id = (select id from dtech)
    and requirement.area = 'personal_development'::public.requirement_area
)
delete from public.course_requirement_mappings mapping
where mapping.course_id in (select id from prototyping)
  and mapping.requirement_id in (select id from personal_development);

update public.school_planning_profiles profile
set grade_rules = jsonb_set(
      profile.grade_rules,
      '{9,required_areas}',
      coalesce((
        select jsonb_agg(area order by ordinal)
        from jsonb_array_elements(profile.grade_rules -> '9' -> 'required_areas') with ordinality value(area, ordinal)
        where area <> '"personal_development"'::jsonb
      ), '[]'::jsonb),
      true
    ),
    updated_at = now()
where profile.school_id = (select id from public.schools where slug = 'design-tech-high-school');
