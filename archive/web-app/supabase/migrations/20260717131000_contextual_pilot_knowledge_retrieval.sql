-- Required guardrails occupy a bounded quota so contextual planning guidance is
-- never pushed out of Pilot's retrieval window.

create or replace function public.search_ai_knowledge(
  query_text text,
  context_tags text[] default '{}',
  result_limit integer default 8
)
returns table (
  id text,
  title text,
  content text,
  source_path text,
  tags text[],
  score real,
  match_reason text
)
language sql
stable
security invoker
set search_path = public
as $$
  with query as (
    select websearch_to_tsquery('english', left(coalesce(query_text, ''), 500)) as terms
  ), ranked as (
    select
      chunk.*,
      ts_rank_cd(chunk.search_document, query.terms) as text_score,
      cardinality(array(select unnest(chunk.tags) intersect select unnest(coalesce(context_tags, '{}')))) as tag_matches,
      coalesce((chunk.metadata ->> 'always')::boolean, false) as required
    from public.ai_knowledge_chunks chunk
    cross join query
    where chunk.is_active
  ), required_rows as (
    select ranked.*, 'required'::text as match_reason
    from ranked
    where ranked.required
    order by ranked.priority desc, ranked.title
    limit 3
  ), contextual_rows as (
    select ranked.*,
      case
        when ranked.text_score > 0 and ranked.tag_matches > 0 then 'text_and_context'
        when ranked.text_score > 0 then 'text'
        else 'context'
      end as match_reason
    from ranked
    where not ranked.required and (ranked.text_score > 0 or ranked.tag_matches > 0)
    order by (ranked.text_score * 4 + ranked.tag_matches * 0.65 + ranked.priority::real / 1000) desc, ranked.title
    limit greatest(least(result_limit, 10) - 3, 1)
  ), selected as (
    select * from required_rows
    union all
    select * from contextual_rows
  )
  select
    selected.id,
    selected.title,
    selected.content,
    selected.source_path,
    selected.tags,
    (selected.text_score * 4 + selected.tag_matches * 0.65 + selected.priority::real / 1000)::real as score,
    selected.match_reason
  from selected
  order by selected.required desc, score desc, selected.title;
$$;

insert into public.ai_knowledge_chunks (id, title, content, source_path, tags, priority, metadata)
values
  (
    'provider-neutral-college-planning',
    'Provider-neutral college planning',
    'Use the student-selected district and its registered provider adapter. Never substitute another district catalog, degree, general-education pattern, prerequisite, or enrollment policy. College coursework applies to high-school graduation only when an official selected-school equivalency explicitly says so. A unit-count heuristic is not equivalency evidence.',
    'docs/ACADEMIC_RULES.md',
    array['college','courses','graduation','degree','school'],
    99,
    '{}'::jsonb
  ),
  (
    'plan-quality-revision-loop',
    'Plan quality revision loop',
    'Before applying a broad schedule, inspect the complete resulting plan for exact and subject-level duplication, prerequisite order, math and language continuity, workload balance, provider limits, school course-count guidance, diploma coverage, and bookmarked-degree progress. Revise feasible warnings before applying. Only ownership locks, impossible records or placements, unoverridden verified prerequisite failures, and true absolute limits block a write. Return the best feasible applied result with concise warnings rather than a prose-only preview.',
    'docs/ACADEMIC_RULES.md',
    array['schedule','courses','graduation','degree','prerequisites'],
    100,
    '{}'::jsonb
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

grant execute on function public.search_ai_knowledge(text, text[], integer) to authenticated;

comment on function public.search_ai_knowledge(text, text[], integer) is
  'Hybrid retrieval with a three-item guardrail quota and contextual guidance filling the remaining result window.';
