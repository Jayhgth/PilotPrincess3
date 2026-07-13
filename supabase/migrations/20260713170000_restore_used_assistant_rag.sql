create table if not exists public.ai_knowledge_chunks (
  id text primary key,
  title text not null check (char_length(title) between 1 and 160),
  content text not null check (char_length(content) between 1 and 6000),
  source_path text not null check (char_length(source_path) between 1 and 300),
  tags text[] not null default '{}',
  priority smallint not null default 50 check (priority between 0 and 100),
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  search_document tsvector generated always as (
    to_tsvector('english'::regconfig, coalesce(title, '') || ' ' || coalesce(content, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_knowledge_chunks_search_idx on public.ai_knowledge_chunks using gin(search_document);
create index if not exists ai_knowledge_chunks_tags_idx on public.ai_knowledge_chunks using gin(tags);

drop trigger if exists ai_knowledge_chunks_set_updated_at on public.ai_knowledge_chunks;
create trigger ai_knowledge_chunks_set_updated_at
before update on public.ai_knowledge_chunks
for each row execute procedure public.set_updated_at();

alter table public.ai_knowledge_chunks enable row level security;

drop policy if exists "authenticated users read active AI guidance" on public.ai_knowledge_chunks;
create policy "authenticated users read active AI guidance" on public.ai_knowledge_chunks
for select to authenticated using (is_active);

drop function if exists public.search_ai_knowledge(text, text[], integer);
create or replace function public.search_ai_knowledge(
  query_text text,
  context_tags text[] default '{}',
  result_limit integer default 7
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
  )
  select
    ranked.id,
    ranked.title,
    ranked.content,
    ranked.source_path,
    ranked.tags,
    (ranked.text_score * 4 + ranked.tag_matches * 0.65 + ranked.priority::real / 1000)::real as score,
    case
      when ranked.required then 'required'
      when ranked.text_score > 0 and ranked.tag_matches > 0 then 'text_and_context'
      when ranked.text_score > 0 then 'text'
      else 'context'
    end as match_reason
  from ranked
  where ranked.required or ranked.text_score > 0 or ranked.tag_matches > 0
  order by ranked.required desc, score desc, ranked.title
  limit least(greatest(result_limit, 1), 10);
$$;

grant execute on function public.search_ai_knowledge(text, text[], integer) to authenticated;

insert into public.ai_knowledge_chunks (id, title, content, source_path, tags, priority, metadata) values
  (
    'pilot-role-and-boundary',
    'Pilot role and data boundary',
    'Pilot is an opt-in academic planning assistant. Read current RLS-protected student records through validated tools when the answer depends on them. Every write is an exact proposal and normal product validation runs again at execution. Never certify graduation, predict admission, invent availability, or expose hidden chain-of-thought.',
    'docs/AI_TRANSPARENCY.md',
    array['assistant'],
    100,
    '{"always":true}'::jsonb
  ),
  (
    'pilot-answer-contract',
    'Pilot answer contract',
    'Lead with the answer, then explain the evidence that materially changes it. Concision must not erase the distinction between existing records, proposed additions, unresolved gaps, and institutional uncertainty. Use a short list when several courses or requirement areas need separate explanations.',
    'docs/AI_TRANSPARENCY.md',
    array['assistant'],
    98,
    '{"always":true}'::jsonb
  ),
  (
    'current-plan-glossary',
    'Current plan terminology',
    'The current four-year plan is the active set of Done, In progress, and Planned course rows shown in Courses. Do not call it a saved plan without explaining that meaning. A schedule-generation request normally completes or evaluates this existing plan; it does not discard courses already recorded.',
    'docs/PRODUCT_DESIGN.md',
    array['courses','schedule','overview'],
    96,
    '{}'::jsonb
  ),
  (
    'schedule-generation-evidence',
    'Schedule generation evidence contract',
    'A generated schedule result must report how many existing courses were retained, which exact courses are proposed, why each course was selected, and which graduation requirements remain open afterward. One proposed course can be a valid completion only when the existing current plan already supplies the rest; explain that explicitly. Never describe a partial batch as a complete schedule.',
    'docs/AI_TRANSPARENCY.md',
    array['courses','schedule','graduation'],
    100,
    '{}'::jsonb
  ),
  (
    'graduation-evidence',
    'Graduation evidence rules',
    'Keep completed, current, planned, unverified, and remaining credit distinct. Graduation progress is deterministic and requirement-level. A course addition should identify the verified requirement mapping it improves. If gaps remain after a proposed batch, name them and do not claim the plan covers the diploma.',
    'docs/ACADEMIC_RULES.md',
    array['graduation','courses','schedule'],
    94,
    '{}'::jsonb
  ),
  (
    'course-and-transcript-integrity',
    'Course and transcript integrity',
    'Transcript-backed Done courses are evidence records and cannot be moved or removed by Pilot. Catalog additions must pass duplicate, grade-window, math-progression, and prerequisite checks. Preserve d.tech and SMCCD provenance. Catalog inclusion never proves a live section, seat, schedule fit, counselor approval, or award eligibility.',
    'docs/ACADEMIC_RULES.md',
    array['courses','transcript','college','smccd'],
    95,
    '{}'::jsonb
  ),
  (
    'concurrent-enrollment-guardrails',
    'Concurrent enrollment guardrails',
    'Use the matching provider and program policy for college-unit limits. Respect the recommended per-term limit by default and never exceed the absolute limit. Unit totals do not prove prerequisites, school or college approval, fee status, materials, schedule availability, or seats.',
    'docs/ACADEMIC_RULES.md',
    array['college','smccd','courses','schedule'],
    92,
    '{}'::jsonb
  ),
  (
    'gpa-schedule-boundary',
    'GPA schedule boundary',
    'GPA scenarios operate only on the current four-year plan and student-supplied expected grades. Call the all-A result the current-plan all-A ceiling, not a prediction. Check graduation coverage, prerequisites, and enrollment constraints before proposing schedule changes.',
    'docs/ACADEMIC_RULES.md',
    array['gpa','schedule','graduation'],
    90,
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

comment on table public.ai_knowledge_chunks is
  'Curated, versioned application guidance actually retrieved for each Pilot turn; student records remain in validated tools.';
comment on function public.search_ai_knowledge(text, text[], integer) is
  'Hybrid full-text and bounded context-tag retrieval for Pilot application guidance.';
