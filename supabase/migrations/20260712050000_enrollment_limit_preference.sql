alter table public.student_enrollment_preferences
  add column respect_recommended_limit boolean not null default true;

comment on column public.student_enrollment_preferences.respect_recommended_limit is
  'Whether generated schedules should stay at or below the provider policy recommended_max_units value. Defaults on; the threshold itself remains policy data.';

update public.ai_knowledge_chunks
set content = 'Concurrent-enrollment limits are provider, program, term, and unit-system specific. Read the matching enrollment_policies row; never hardcode a unit number. Before generating or applying a course schedule, show the student the matching recommended_max_units value and ask whether to respect it, with Yes as the recommended default. Aggregate every college in the same provider across each term. Even when the student declines the recommended planning threshold, never exceed absolute_max_units. Unit count alone never proves eligibility: prerequisites, school and college approval, impacted restrictions, materials, fees, and availability remain separate. Other districts require their own sourced policy rows.',
    updated_at = now()
where id = 'concurrent-enrollment-guardrails';
