-- Pilot calculates only published local high-school diploma requirements.
-- UCOP course rows and designations remain catalog identity evidence, but the
-- separate California-minimum and UC A-G progress architecture is removed.

update public.shared_data_proposals
set status = 'rejected',
    review_note = 'The alternate academic-framework architecture was retired.',
    reviewed_at = now(),
    updated_at = now()
where status = 'pending'
  and target_table in ('course_framework_mappings', 'academic_requirement_rules');

drop table if exists public.academic_framework_constraints;
drop table if exists public.course_framework_mappings;
drop table if exists public.academic_requirement_rules;
drop table if exists public.academic_frameworks;
