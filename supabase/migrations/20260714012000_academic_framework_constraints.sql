-- Framework-wide rules cannot be represented as per-subject minimums. Keep
-- them separate so A–G's eleven-courses-before-senior-year rule is evaluated
-- once across the whole framework.

create table public.academic_framework_constraints (
  id uuid primary key default gen_random_uuid(),
  framework_id uuid not null references public.academic_frameworks(id) on delete cascade,
  constraint_key text not null,
  constraint_type text not null check (constraint_type in ('minimum_total_courses_before_grade', 'minimum_total_credits', 'minimum_total_years')),
  numeric_value numeric(7,2) not null,
  before_grade integer,
  minimum_grade text,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (framework_id, constraint_key)
);

alter table public.academic_framework_constraints enable row level security;

create policy "Authenticated users can read published framework constraints"
on public.academic_framework_constraints for select
to authenticated
using (exists (
  select 1 from public.academic_frameworks framework
  where framework.id = framework_id and framework.status = 'published'
));

update public.academic_requirement_rules rule
set required_before_grade = null,
    updated_at = now()
from public.academic_frameworks framework
where rule.framework_id = framework.id
  and framework.framework_type = 'uc_ag';

insert into public.academic_framework_constraints (
  framework_id, constraint_key, constraint_type, numeric_value,
  before_grade, minimum_grade, notes, sort_order
)
select
  framework.id,
  'eleven_courses_before_senior_year',
  'minimum_total_courses_before_grade',
  11,
  12,
  'C',
  'At least 11 of the 15 required A–G courses must be completed before grade 12.',
  10
from public.academic_frameworks framework
where framework.framework_type = 'uc_ag'
  and framework.jurisdiction_key = 'university-of-california'
on conflict (framework_id, constraint_key) do update set
  numeric_value = excluded.numeric_value,
  before_grade = excluded.before_grade,
  minimum_grade = excluded.minimum_grade,
  notes = excluded.notes,
  sort_order = excluded.sort_order,
  updated_at = now();

-- Reuse approved local course evidence for the statewide floor where the
-- subject relationship is direct. Local diploma rules remain authoritative
-- and separate; this only avoids asking the student to verify the same course
-- twice.
with state_framework as (
  select id from public.academic_frameworks
  where framework_type = 'state_graduation' and jurisdiction_key = 'california'
), mapped_courses as (
  select distinct
    mapping.course_id,
    state_framework.id as framework_id,
    state_rule.id as requirement_rule_id,
    mapping.confidence,
    requirement.review_status
  from public.course_requirement_mappings mapping
  join public.graduation_requirements requirement on requirement.id = mapping.requirement_id
  cross join state_framework
  join public.academic_requirement_rules state_rule
    on state_rule.framework_id = state_framework.id
    and state_rule.rule_key = case requirement.area::text
      when 'english' then 'ca_english'
      when 'math' then 'ca_math'
      when 'social_science' then 'ca_social_science'
      when 'lab_science' then 'ca_science'
      when 'world_language' then 'ca_lote_vpa_cte'
      when 'visual_performing_arts' then 'ca_lote_vpa_cte'
      when 'design_lab' then 'ca_lote_vpa_cte'
      else null
    end
  where requirement.review_status = 'approved'
)
insert into public.course_framework_mappings (
  course_id, framework_id, requirement_rule_id, confidence, review_status
)
select course_id, framework_id, requirement_rule_id, confidence, review_status
from mapped_courses
on conflict (course_id, framework_id, requirement_rule_id) do update set
  confidence = excluded.confidence,
  review_status = excluded.review_status,
  updated_at = now();
