create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New conversation'
    check (char_length(title) between 1 and 120),
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  turn_id uuid,
  role text not null check (role in ('user', 'assistant', 'tool')),
  content text not null check (char_length(content) between 1 and 20000),
  page_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.ai_events (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  turn_id uuid not null,
  sequence integer not null check (sequence > 0),
  event_type text not null check (char_length(event_type) between 1 and 120),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (turn_id, sequence)
);

create table public.ai_tool_calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  turn_id uuid not null,
  tool_name text not null check (char_length(tool_name) between 1 and 120),
  arguments jsonb not null default '{}'::jsonb,
  explanation text not null check (char_length(explanation) between 1 and 1200),
  mutates_data boolean not null default false,
  status text not null check (status in ('running', 'pending_confirmation', 'completed', 'failed', 'rejected')),
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  completed_at timestamptz
);

create index ai_conversations_user_updated_idx
  on public.ai_conversations(user_id, is_archived, updated_at desc);
create index ai_messages_conversation_created_idx
  on public.ai_messages(conversation_id, created_at);
create index ai_events_conversation_turn_idx
  on public.ai_events(conversation_id, turn_id, sequence);
create index ai_tool_calls_conversation_created_idx
  on public.ai_tool_calls(conversation_id, created_at);

create trigger ai_conversations_set_updated_at
before update on public.ai_conversations
for each row execute procedure public.set_updated_at();

create trigger ai_tool_calls_set_updated_at
before update on public.ai_tool_calls
for each row execute procedure public.set_updated_at();

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_events enable row level security;
alter table public.ai_tool_calls enable row level security;

create policy "users manage own AI conversations" on public.ai_conversations
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "users manage own AI messages" on public.ai_messages
for all to authenticated
using (
  (select auth.uid()) = user_id
  and exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = (select auth.uid()))
)
with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = (select auth.uid()))
);

create policy "users manage own AI events" on public.ai_events
for all to authenticated
using (
  (select auth.uid()) = user_id
  and exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = (select auth.uid()))
)
with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = (select auth.uid()))
);

create policy "users manage own AI tool calls" on public.ai_tool_calls
for all to authenticated
using (
  (select auth.uid()) = user_id
  and exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = (select auth.uid()))
)
with check (
  (select auth.uid()) = user_id
  and exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = (select auth.uid()))
);

comment on table public.ai_conversations is
  'Persistent student-owned Pilot Assistant conversations.';
comment on table public.ai_events is
  'Sanitized Codex and application activity used to reconstruct the human-readable conversation timeline.';
comment on table public.ai_tool_calls is
  'Actual student-data tool activity. Mutating calls remain pending until the owning student explicitly confirms them.';
