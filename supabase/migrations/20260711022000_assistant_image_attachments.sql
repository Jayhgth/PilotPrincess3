insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ai-attachments',
  'ai-attachments',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.ai_messages drop constraint if exists ai_messages_content_check;
alter table public.ai_messages
  add constraint ai_messages_content_check check (char_length(content) between 0 and 20000);

create table public.ai_message_attachments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  message_id uuid not null references public.ai_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 10485760),
  storage_path text not null unique check (char_length(storage_path) between 1 and 500),
  created_at timestamptz not null default now()
);

create index ai_message_attachments_conversation_message_idx
  on public.ai_message_attachments(conversation_id, message_id, created_at);

alter table public.ai_message_attachments enable row level security;

create policy "users manage own AI image attachments" on public.ai_message_attachments
for all to authenticated
using (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.ai_conversations c
    where c.id = conversation_id and c.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.ai_messages m
    where m.id = message_id and m.user_id = (select auth.uid()) and m.conversation_id = conversation_id
  )
)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.ai_conversations c
    where c.id = conversation_id and c.user_id = (select auth.uid())
  )
  and exists (
    select 1 from public.ai_messages m
    where m.id = message_id and m.user_id = (select auth.uid()) and m.conversation_id = conversation_id
  )
);

create policy "users upload own AI images" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'ai-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "users read own AI images" on storage.objects
for select to authenticated
using (
  bucket_id = 'ai-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "users delete own AI images" on storage.objects
for delete to authenticated
using (
  bucket_id = 'ai-attachments'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

comment on table public.ai_message_attachments is
  'Private image context explicitly attached by a student to a Pilot Assistant message. Preview access uses short-lived signed URLs.';
