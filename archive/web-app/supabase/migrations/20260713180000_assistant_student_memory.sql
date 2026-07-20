create table public.ai_student_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.student_settings(id) on delete cascade,
  memory_key text not null check (memory_key ~ '^[a-z0-9_]{2,64}$'),
  category text not null check (category in ('preference', 'goal', 'constraint', 'interest', 'context')),
  content text not null check (char_length(content) between 1 and 600),
  tags text[] not null default '{}',
  importance smallint not null default 3 check (importance between 1 and 5),
  source_conversation_id uuid references public.ai_conversations(id) on delete set null,
  source_turn_id uuid,
  is_active boolean not null default true,
  search_document tsvector generated always as (
    to_tsvector('english'::regconfig, coalesce(memory_key, '') || ' ' || coalesce(content, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, memory_key)
);

create index ai_student_memories_user_active_idx
  on public.ai_student_memories(user_id, is_active, importance desc, updated_at desc);
create index ai_student_memories_search_idx
  on public.ai_student_memories using gin(search_document);
create index ai_student_memories_tags_idx
  on public.ai_student_memories using gin(tags);

create trigger ai_student_memories_set_updated_at
before update on public.ai_student_memories
for each row execute procedure public.set_updated_at();

alter table public.ai_student_memories enable row level security;

create policy "users manage own Pilot memories" on public.ai_student_memories
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create or replace function public.search_student_memories(
  query_text text,
  context_tags text[] default '{}',
  result_limit integer default 12
)
returns table (
  id uuid,
  memory_key text,
  category text,
  content text,
  tags text[],
  importance smallint,
  score real
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
      memory.*,
      ts_rank_cd(memory.search_document, query.terms) as text_score,
      cardinality(array(select unnest(memory.tags) intersect select unnest(coalesce(context_tags, '{}')))) as tag_matches
    from public.ai_student_memories memory
    cross join query
    where memory.user_id = (select auth.uid())
      and memory.is_active
  )
  select
    ranked.id,
    ranked.memory_key,
    ranked.category,
    ranked.content,
    ranked.tags,
    ranked.importance,
    (ranked.text_score * 4 + ranked.tag_matches * 0.65 + ranked.importance::real / 10)::real as score
  from ranked
  where ranked.text_score > 0 or ranked.tag_matches > 0 or ranked.importance >= 4
  order by score desc, ranked.updated_at desc
  limit least(greatest(result_limit, 1), 20);
$$;

grant execute on function public.search_student_memories(text, text[], integer) to authenticated;

comment on table public.ai_student_memories is
  'Lightweight user-specific Pilot memory for explicit durable preferences, goals, constraints, interests, and context; canonical academic records remain in their owning tables.';
comment on function public.search_student_memories(text, text[], integer) is
  'RLS-scoped retrieval of relevant lightweight Pilot memory for the current user.';

insert into public.ai_knowledge_chunks (id, title, content, source_path, tags, priority, metadata) values
  (
    'pilot-integrated-control-boundary',
    'Integrated app control boundary',
    'When a student explicitly asks for a supported app change, use the validated tool instead of only describing the UI. Pilot may update ordinary student planning settings, editable course variables and placement, degree bookmarks, exact transcript corrections, prerequisite evidence submissions, plan snapshots, enrollment preferences, and student-confirmed GE completion. It may not delete accounts, alter authentication or AI consent, grant admin access, approve institutional evidence, certify graduation, or access another user.',
    'docs/AI_TRANSPARENCY.md',
    array['assistant','settings','courses','transcript','college','smccd'],
    100,
    '{"always":true}'::jsonb
  ),
  (
    'pilot-memory-boundary',
    'Lightweight student memory boundary',
    'Automatically remember only explicit durable preferences, goals, constraints, interests, and personal planning context. Do not store inferred traits, secrets, transcript text, course rows, grades, or GPA in memory because canonical application tables own academic evidence. Memory may rank equally valid options but cannot override catalog, prerequisite, graduation, enrollment, transcript, or review rules.',
    'docs/AI_TRANSPARENCY.md',
    array['assistant','schedule','courses','settings'],
    99,
    '{}'::jsonb
  ),
  (
    'pilot-complete-personalized-schedule',
    'Complete personalized schedule contract',
    'Attempt the full schedule request unless the student narrows it. Keep existing courses, restore standard grade-level flow, fill every remaining tracked requirement with eligible verified mappings when possible, validate prerequisites and provider limits, and apply explicit interests, rigor, and workload caps. Explain every proposed addition. If any gap cannot be filled from validated data, label the result partial and do not mutate the plan.',
    'docs/AI_TRANSPARENCY.md',
    array['schedule','courses','graduation','gpa'],
    100,
    '{}'::jsonb
  ),
  (
    'pilot-transcript-corrections',
    'Transcript correction integrity',
    'A transcript-backed course cannot be moved or deleted as an ordinary plan row. When the student requests a specific correction, preserve the original proposed payload, store the exact corrected payload and reason, update the linked completed row, and let GPA recalculate from corrected course variables. Never silently approve unrelated transcript mappings.',
    'docs/AI_TRANSPARENCY.md',
    array['transcript','gpa','courses'],
    98,
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
