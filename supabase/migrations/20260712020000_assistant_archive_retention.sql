alter table public.ai_conversations
  add column archived_at timestamptz;

update public.ai_conversations
set archived_at = updated_at
where is_archived = true;

alter table public.ai_conversations
  add constraint ai_conversations_archive_timestamp_check
  check (
    (is_archived = true and archived_at is not null)
    or (is_archived = false and archived_at is null)
  );

create index ai_conversations_archive_expiry_idx
  on public.ai_conversations(user_id, archived_at)
  where is_archived = true;

comment on column public.ai_conversations.archived_at is
  'Archive start time. Pilot permanently deletes the conversation and its dependent records after 14 days.';
