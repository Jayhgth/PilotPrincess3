alter table public.student_profiles
  add column ai_enabled boolean not null default false,
  add column ai_model text not null default 'gpt-5.6-luna'
    check (ai_model in ('gpt-5.6-luna', 'gpt-5.5', 'gpt-5.4-mini')),
  add column ai_reasoning_effort text not null default 'low'
    check (ai_reasoning_effort = 'low'),
  add column ai_connection_approved_at timestamptz,
  add column ai_setup_tested_at timestamptz,
  add constraint student_profiles_ai_consent_check check (
    not ai_enabled or ai_connection_approved_at is not null
  );

comment on column public.student_profiles.ai_enabled is
  'Student-controlled consent gate for Codex-backed features.';
comment on column public.student_profiles.ai_model is
  'Allowlisted Codex model selected by the student. Reasoning remains Light.';
comment on column public.student_profiles.ai_connection_approved_at is
  'Timestamp of the student action that approved sending selected context to OpenAI Codex.';

create table public.ai_knowledge_chunks (
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

create index ai_knowledge_chunks_search_idx
  on public.ai_knowledge_chunks using gin(search_document);
create index ai_knowledge_chunks_tags_idx
  on public.ai_knowledge_chunks using gin(tags);

create trigger ai_knowledge_chunks_set_updated_at
before update on public.ai_knowledge_chunks
for each row execute procedure public.set_updated_at();

alter table public.ai_knowledge_chunks enable row level security;

create policy "authenticated users read active AI guidance" on public.ai_knowledge_chunks
for select to authenticated using (is_active);

create or replace function public.search_ai_knowledge(
  query_text text,
  context_tags text[] default '{}',
  result_limit integer default 6
)
returns table (
  id text,
  title text,
  content text,
  source_path text,
  tags text[],
  score real
)
language sql
stable
security invoker
set search_path = public
as $$
  with query as (
    select plainto_tsquery('english', left(coalesce(query_text, ''), 500)) as terms
  )
  select
    chunk.id,
    chunk.title,
    chunk.content,
    chunk.source_path,
    chunk.tags,
    (
      ts_rank_cd(chunk.search_document, query.terms)
      + case when chunk.tags && coalesce(context_tags, '{}') then 0.8 else 0 end
      + chunk.priority::real / 1000
    )::real as score
  from public.ai_knowledge_chunks chunk
  cross join query
  where chunk.is_active
    and (
      query.terms = ''::tsquery
      or chunk.search_document @@ query.terms
      or chunk.tags && coalesce(context_tags, '{}')
    )
  order by score desc, chunk.title
  limit least(greatest(result_limit, 1), 10);
$$;

grant execute on function public.search_ai_knowledge(text, text[], integer) to authenticated;

insert into public.ai_knowledge_chunks (id, title, content, source_path, tags, priority) values
  (
    'assistant-role',
    'Pilot Assistant role',
    'Pilot is a concise academic planning assistant for Design Tech High School students. It helps the student understand recorded facts, find eligible options, compare deterministic results, and prepare supported changes. It does not replace a counselor, certify graduation, predict admission, or invent course availability. Answer the student first, then use tools only when current records or an exact change are needed.',
    'docs/AI_TRANSPARENCY.md',
    array['assistant', 'role', 'safety', 'all'],
    100
  ),
  (
    'assistant-approval',
    'Read and write boundary',
    'Read-only student tools may run after the student sends a message. Every write must remain a pending proposal until the interface shows its exact arguments and the student confirms it. Normal RLS, eligibility, prerequisite, evidence, and transcript-lock rules run again during execution. Never claim a change happened before the tool result confirms it.',
    'docs/AI_TRANSPARENCY.md',
    array['assistant', 'approval', 'tools', 'all'],
    100
  ),
  (
    'workspace-ownership',
    'Workspace ownership map',
    'Overview summarizes but does not own records. Courses owns Done, In progress, and Planned classes. Graduation owns diploma, A-G, and degree evidence. GPA owns calculation evidence. Experiences owns activities and workload contributions. Next steps owns student tasks. Load check owns deterministic capacity scenarios. Planning preferences owns direction, interests, stress, and workload limits. Transcript import owns evidence review.',
    'docs/PRODUCT_DESIGN.md',
    array['navigation', 'overview', 'courses', 'graduation', 'gpa', 'activities', 'timeline', 'simulator', 'profile', 'sources'],
    90
  ),
  (
    'course-planning',
    'Course planning rules',
    'Course status is always Done, In progress, or Planned. Transcript-backed Done courses are evidence records and cannot be moved or removed by the assistant. Catalog additions must pass duplicate, grade-window, math-progression, and prerequisite checks. d.tech and SMCCD provenance must stay explicit. Catalog inclusion does not prove a live section, seat, schedule, or approval.',
    'docs/ACADEMIC_RULES.md',
    array['courses', 'catalog', 'prerequisites', 'dtech', 'smccd'],
    90
  ),
  (
    'graduation-gpa',
    'Graduation and GPA evidence',
    'Graduation and GPA are deterministic. Keep earned, current, planned, unverified, and open credit distinct. A d.tech star means A-G approval, not Honors. A+, A, and A- share the same grade-point band while preserving the printed mark. Pass grades earn eligible credit but do not enter GPA. A verified Level 3 world-language course satisfies the full sequence.',
    'docs/ACADEMIC_RULES.md',
    array['graduation', 'gpa', 'requirements', 'language'],
    85
  ),
  (
    'concurrent-enrollment',
    'Concurrent enrollment boundary',
    'SMCCD courses are weighted in the d.tech planning model. Prerequisites, concurrent-enrollment approval, placement, current schedules, seats, calendars, residency, substitutions, and final degree eligibility remain college or counselor decisions unless verified evidence is saved. Associate-degree progress is planning evidence, not an official degree audit.',
    'docs/ACADEMIC_RULES.md',
    array['smccd', 'college', 'degree', 'courses', 'graduation'],
    85
  ),
  (
    'profile-workload',
    'Profile and workload rules',
    'Planning preferences are student constraints, not diagnoses. Workload uses saved active experiences and current-year SMCCD class-and-study time. It does not invent d.tech homework, commute, employment, caregiving, sleep, or recovery. Stress and capacity inputs should produce warnings and questions, never predictions about grades or health.',
    'docs/PRODUCT_DESIGN.md',
    array['profile', 'activities', 'simulator', 'workload', 'stress'],
    80
  ),
  (
    'transcript-evidence',
    'Transcript evidence boundary',
    'Readable transcript PDFs are parsed deterministically. Codex vision is allowed only when no usable text layer exists and the student has enabled AI. Imported rows remain reviewable evidence. The assistant may explain transcript records but must not rewrite, delete, or recertify transcript evidence through chat.',
    'docs/ACADEMIC_RULES.md',
    array['sources', 'transcript', 'gpa', 'courses'],
    90
  ),
  (
    'conversation-style',
    'Student answer style',
    'Use short paragraphs or a small list. Do not generate a dashboard, long report, generic motivation, or repeated caveats. State what the saved data supports, name uncertainty once, and ask one focused question only when required to act safely. Use the current page as context, not as a reason to repeat the page.',
    'docs/AI_TRANSPARENCY.md',
    array['assistant', 'style', 'all'],
    95
  )
on conflict (id) do update set
  title = excluded.title,
  content = excluded.content,
  source_path = excluded.source_path,
  tags = excluded.tags,
  priority = excluded.priority,
  is_active = true;

comment on table public.ai_knowledge_chunks is
  'Curated application guidance retrieved for each Pilot Assistant turn. This is role and product context, not student data.';
comment on function public.search_ai_knowledge(text, text[], integer) is
  'Deterministic full-text and page-tag retrieval for Pilot Assistant grounding.';
