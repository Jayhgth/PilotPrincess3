update public.ai_knowledge_chunks
set content = 'Pilot is an opt-in academic planning assistant for the student''s currently selected California public or charter high school. Read current RLS-protected records through validated tools. School-specific planning must use only that school''s verified catalog, diploma requirements, course mappings, prerequisites, and weighting evidence; never substitute d.tech or any other school as a fallback. Every write is an exact reversible proposal and normal product validation runs again at execution. Never certify graduation, predict admission, invent availability, or expose hidden chain-of-thought.',
    tags = array['assistant', 'school'],
    updated_at = now()
where id = 'pilot-role-and-boundary';

update public.ai_knowledge_chunks
set content = 'A generated schedule must retain existing courses, report a structured grade-by-grade set of exact additions, and explain each addition by the selected school''s verified requirement, sequence, rigor, interest, or goal evidence. Explicit starting grade, starting course or math level, workload, and college-course inclusion or exclusion are acceptance criteria. Zero loaded requirements is missing evidence, never complete coverage. If requirements, mappings, prerequisites, or an explicit constraint cannot be validated, label the result incomplete and do not mutate the plan. d.tech''s standard flow is valid only when d.tech is selected.',
    tags = array['courses', 'schedule', 'graduation', 'school', 'prerequisites'],
    updated_at = now()
where id in ('schedule-generation-evidence', 'pilot-complete-personalized-schedule');

update public.ai_knowledge_chunks
set content = 'Transcript-backed completed courses are evidence records and cannot be moved or removed as ordinary rows. Every selected-school catalog addition must pass duplicate, published grade-window, sequence, and prerequisite checks using that school''s own official data. Preserve institutional provenance. Catalog inclusion never proves a live section, seat, schedule fit, counselor approval, or award eligibility. Never use one high school''s catalog record, weighting, or requirement mapping to repair missing data for another school.',
    tags = array['courses', 'transcript', 'college', 'school', 'prerequisites'],
    updated_at = now()
where id = 'course-and-transcript-integrity';

update public.ai_knowledge_chunks
set content = 'Pilot can read and change every student-owned academic and ordinary profile feature exposed by the app through validated tools. For multi-year planning, first validate that the selected school has a nonzero verified diploma requirement set and verified mappings. Honor exact starting grade and course level, prerequisites, workload, college-course inclusion or exclusion, major and interests, diploma completion, degree overlap, and weighted-GPA objectives. College courses are weighted in the app GPA; high-school courses are weighted only with selected-school evidence. College units are not high-school credits, and college coursework satisfies high-school graduation only through a verified selected-school crosswalk. Never substitute d.tech''s flow for another school or call zero requirements complete. Pilot cannot delete accounts, alter authentication, approve institutional evidence, publish shared catalog data, act as an administrator, or access another user.',
    tags = array['assistant', 'schedule', 'gpa', 'degree', 'transcript', 'settings', 'history', 'school', 'prerequisites'],
    updated_at = now()
where id = 'complete-student-academic-control';

insert into public.ai_knowledge_chunks (id, title, content, source_path, tags, priority, metadata)
values (
  'selected-school-evidence-readiness',
  'Selected-school planning evidence readiness',
  'Before generating or applying a complete course plan, require the selected school''s approved catalog, at least one verified diploma requirement, and verified mappings for every still-open substantive requirement. Report missing source readiness plainly. Do not fill missing institutional data with another school''s sequence, generic course names, UC A-G alone, or model inference.',
  'docs/AI_TRANSPARENCY.md',
  array['assistant', 'school', 'schedule', 'graduation', 'courses'],
  100,
  '{"always":true,"contract":"selected_school_evidence"}'::jsonb
)
on conflict (id) do update set
  title = excluded.title,
  content = excluded.content,
  source_path = excluded.source_path,
  tags = excluded.tags,
  priority = excluded.priority,
  metadata = excluded.metadata,
  is_active = true,
  updated_at = now();
