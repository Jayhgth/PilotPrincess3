alter table public.student_profiles
  add column ai_review_mode text not null default 'manual'
    check (ai_review_mode in ('manual', 'auto_review'));

comment on column public.student_profiles.ai_review_mode is
  'Student-selected routing for assistant change proposals. Manual routes every proposal to the student; auto_review uses a separate risk reviewer with product-enforced manual fallbacks.';

update public.ai_knowledge_chunks
set content = 'Read-only student tools may run after the student sends a message. Every write begins as an exact proposal. Manual mode routes it to the student. Auto-review routes eligible proposals to a separate risk reviewer; destructive, identity-sensitive, grade-changing, or high-risk changes still require the student. Normal RLS, eligibility, prerequisite, evidence, and transcript-lock rules run again during execution. Never claim a change happened before the tool result confirms it.'
where id = 'assistant-approval';

comment on table public.ai_tool_calls is
  'Actual student-data tool activity. Mutating calls start pending and are routed through the student-selected manual or separate auto-review approval path.';
