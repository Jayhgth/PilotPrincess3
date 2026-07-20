-- Run after the restored Pilot knowledge table. This migration originally
-- shared a version with the student_settings migration, which made linked
-- migration history ambiguous and prevented safe deployment.
update public.student_enrollment_preferences
set limit_mode = 'recommended',
    custom_unit_limit = null,
    updated_at = now()
where limit_mode <> 'recommended' or custom_unit_limit is not null;

comment on table public.student_enrollment_preferences is
  'Per-student provider and concurrent- or dual-enrollment context. Application planning thresholds always come from enrollment_policies.';

update public.ai_knowledge_chunks
set content = 'Overview owns the current path and next actions. Courses owns Done, In progress, Planned classes, plan snapshots, and contextual college-unit policy warnings. Graduation owns d.tech diploma and selected associate-degree evidence. GPA planner owns deterministic grade scenarios for the saved schedule. Settings owns student, planning, college-enrollment, Pilot connection, review-mode, and archive preferences. Transcript import owns evidence review and is entered from Courses. Pilot may read every area and propose supported changes through exact validated tools.',
    updated_at = now()
where id = 'workspace-ownership';

update public.ai_knowledge_chunks
set content = 'Concurrent-enrollment limits are provider, program, term, and unit-system specific. For SMCCD, use enrollment_policies and the student saved program_type. Aggregate CSM, Skyline, and Cañada units across the same term. The conservative concurrent threshold is 11 units, the district FAQ fee-free figure is 11.5, and the K-12 maximum is 19. Dual-enrollment figures differ. The student may change enrollment type but may not customize district policy. Warn in Courses when an open term crosses the matching threshold. Unit count alone never proves eligibility: prerequisites, school and college approval, impacted restrictions, materials, fees, and availability remain separate. Other districts require their own sourced policy rows.',
    updated_at = now()
where id = 'concurrent-enrollment-guardrails';
