-- AP and IB remain separate designations from generic school or UC honors.
-- The official UCOP title is strong evidence of the label, while downstream
-- exam credit and weighting policies remain separate questions.

insert into public.course_designations (
  course_id, designation, source_url, source_year, confidence, review_status
)
select
  course.id,
  case
    when course.name ~* '(^|[^A-Za-z])(AP)([^A-Za-z]|$)|Advanced Placement' then 'ap'
    else 'ib'
  end,
  source.source_url,
  coalesce(source.source_year, version.academic_year),
  'likely',
  'approved'
from public.courses course
join public.catalog_versions version on version.id = course.catalog_version_id
left join public.official_sources source on source.id = course.source_id
where course.name ~* '(^|[^A-Za-z])(AP|IB)([^A-Za-z]|$)|Advanced Placement|International Baccalaureate'
on conflict (course_id, designation) do update set
  source_url = excluded.source_url,
  source_year = excluded.source_year,
  confidence = excluded.confidence,
  review_status = excluded.review_status;
