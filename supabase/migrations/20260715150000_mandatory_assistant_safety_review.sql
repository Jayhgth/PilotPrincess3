alter table public.student_settings
  drop column if exists ai_review_mode;

update public.ai_knowledge_chunks
set content = 'Read-only student tools may run after the student sends a message. Every write begins as an exact proposal and is routed automatically to a separate safety reviewer. An approved proposal executes under normal RLS, eligibility, prerequisite, evidence, transcript-lock, and record rules; a denied proposal is recorded as not applied. Never claim a change happened before the tool result confirms it.'
where id = 'assistant-approval';

comment on table public.ai_tool_calls is
  'Actual student-data tool activity. Mutating calls start pending, receive a mandatory separate safety review, and execute only when approved.';
