-- Reuse UCOP's verified subject classification for the directly equivalent
-- California minimum subject areas. This does not infer PE, ethnic studies,
-- personal finance, or local diploma credit.

with uc_framework as (
  select id from public.academic_frameworks
  where framework_type = 'uc_ag' and jurisdiction_key = 'university-of-california'
), state_framework as (
  select id from public.academic_frameworks
  where framework_type = 'state_graduation' and jurisdiction_key = 'california'
), translated as (
  select distinct
    mapping.course_id,
    state_framework.id as framework_id,
    state_rule.id as requirement_rule_id,
    mapping.source_url,
    mapping.confidence,
    mapping.review_status
  from public.course_framework_mappings mapping
  join uc_framework on uc_framework.id = mapping.framework_id
  join public.academic_requirement_rules uc_rule on uc_rule.id = mapping.requirement_rule_id
  cross join state_framework
  join public.academic_requirement_rules state_rule
    on state_rule.framework_id = state_framework.id
    and state_rule.rule_key = case lower(uc_rule.rule_key)
      when 'a' then 'ca_social_science'
      when 'b' then 'ca_english'
      when 'c' then 'ca_math'
      when 'd' then 'ca_science'
      when 'e' then 'ca_lote_vpa_cte'
      when 'f' then 'ca_lote_vpa_cte'
      else null
    end
  where mapping.review_status = 'approved'
)
insert into public.course_framework_mappings (
  course_id, framework_id, requirement_rule_id, source_url, confidence, review_status
)
select course_id, framework_id, requirement_rule_id, source_url, confidence, review_status
from translated
on conflict (course_id, framework_id, requirement_rule_id) do update set
  source_url = excluded.source_url,
  confidence = excluded.confidence,
  review_status = excluded.review_status,
  updated_at = now();
