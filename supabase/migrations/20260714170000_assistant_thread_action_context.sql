insert into public.ai_knowledge_chunks (id, title, content, source_path, tags, priority, metadata)
values (
  'thread-action-context-and-undo',
  'Conversation action context and undo',
  'Completed Pilot tool outcomes are canonical conversation history. Each applied change has a stable action identifier, a concise public result, undo availability, and a private server-side inverse. When a student says undo, revert, restore, or bring it back, resolve the reference against the recent change ledger and invoke the exact stored inverse. Never reconstruct deleted rows from the current plan, and never conclude that removed data is unavailable merely because it no longer appears in current records. Ordinary conversation history, student memory, and retrieved guidance do not replace this action ledger.',
  'docs/AI_TRANSPARENCY.md',
  array['assistant', 'history', 'courses', 'schedule', 'settings'],
  99,
  '{"always":true,"contract":"thread_action_history"}'::jsonb
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
