update public.graduation_requirements requirement
set notes = 'Earned through d.tech intersession courses. Introduction to Prototyping and Fabrication does not count toward this requirement.',
    updated_at = now()
from public.schools school
where requirement.school_id = school.id
  and school.slug = 'design-tech-high-school'
  and requirement.area = 'personal_development'::public.requirement_area;

insert into public.ai_knowledge_chunks (id, title, content, tags, source_path, priority, metadata, is_active)
values (
  'integrated-bookmarked-degree-planning',
  'Integrated bookmarked-degree planning',
  'A request to create or rebuild a schedule must use the integrated schedule optimizer. When college coursework is allowed and degree bookmarks exist, include courses selected against every bookmarked program''s remaining major, awarding-college local GE, separate graduation, and total-unit requirements. Optimize verified overlap with high-school diploma requirements, order prerequisites before dependents, respect the selected school''s per-grade course-count and required-area profile, prevent duplicate automatic core-area fillers in one grade, and stay within the saved concurrent-enrollment boundary. d.tech Personal Development is earned through intersession courses; Introduction to Prototyping and Fabrication does not satisfy it.',
  array['assistant','schedule','degree','graduation','college','prerequisites','school'],
  'docs/ACADEMIC_RULES.md',
  100,
  '{"always":true}'::jsonb,
  true
)
on conflict (id) do update set
  title = excluded.title,
  content = excluded.content,
  tags = excluded.tags,
  source_path = excluded.source_path,
  is_active = true,
  updated_at = now();
