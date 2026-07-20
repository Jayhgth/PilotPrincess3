-- Define d.tech's full-year Calculus course at the Calculus I sequence level.
-- This is planning metadata only: it does not award college credit or claim
-- that the high-school course satisfies an SMCCD degree requirement.

update public.courses course
set description = 'Full-year limits, derivatives, integrals, optimization, related rates, differential equations, area, and volume. For sequence planning this is Calculus I level, equivalent to the MATH 251 position in the math ladder; it does not award college credit or satisfy a college degree requirement without separate articulation evidence.'
from public.schools school
where course.school_id = school.id
  and school.slug = 'design-tech-high-school'
  and course.name = 'Calculus / Calculus Honors';
