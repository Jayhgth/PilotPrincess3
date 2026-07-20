create temporary table transcript_source_merge on commit drop as
select
  id as source_id,
  first_value(id) over (
    partition by user_id
    order by updated_at desc, created_at desc, id desc
  ) as canonical_source_id,
  row_number() over (
    partition by user_id
    order by updated_at desc, created_at desc, id desc
  ) as source_rank
from public.official_sources
where user_id is not null
  and document_type = 'transcript';

update public.catalog_review_items as review_item
set source_id = source_merge.canonical_source_id
from transcript_source_merge as source_merge
where review_item.source_id = source_merge.source_id
  and source_merge.source_rank > 1;

update public.parse_jobs as parse_job
set source_id = source_merge.canonical_source_id
from transcript_source_merge as source_merge
where parse_job.source_id = source_merge.source_id
  and source_merge.source_rank > 1;

delete from public.official_sources as source
using transcript_source_merge as source_merge
where source.id = source_merge.source_id
  and source_merge.source_rank > 1;

create unique index official_sources_one_transcript_per_user
  on public.official_sources(user_id)
  where user_id is not null
    and document_type = 'transcript';
