-- For an integrated concurrent-enrollment school, the listed grades are the
-- verified planning window, not proof of registration eligibility. Approval,
-- prerequisites, and the district term limit remain independent checks.

update public.school_planning_profiles profile
set
  college_eligible_grades = array[9,10,11,12]::smallint[],
  guidance_notes = array[
    'English and Design Lab remain at d.tech every year.',
    'Approved community-college courses may replace math, science, art, social studies, or world language when the grade-specific minimum number of d.tech courses is maintained.',
    'Concurrent enrollment may be planned in grades 9 through 12 when it improves prerequisite sequencing or verified diploma/degree overlap; school and college approval remain separate checks.',
    'd.tech offers Honors pathways rather than AP courses.'
  ],
  updated_at = now()
from public.schools school
where profile.school_id = school.id
  and school.slug = 'design-tech-high-school'
  and profile.status = 'verified';

