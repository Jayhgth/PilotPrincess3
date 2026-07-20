update public.ai_knowledge_chunks
set content = 'Pilot can read every student-facing data domain through structured RLS-protected tools: profile, active plan, plan versions, catalogs, graduation evidence, GPA evidence, transcript evidence, experiences, next steps, workload, and the selected SMCCD degree. Use the compact inventory only to locate a domain, then use its specific evidence tool. Never request arbitrary SQL, authentication secrets, admin-only data, or another user''s records. Every write remains an exact validated proposal.'
where id = 'workspace-ownership';

update public.ai_knowledge_chunks
set content = 'Transcript audits must compare the original extracted source text, parsed course rows, review decisions, catalog identities, and imported active-plan rows. Report a parsing or reconciliation error only when those records conflict or a required field is missing. Keep pending review and uncertain catalog identity separate from confirmed errors. A graduation requirement gap is a downstream plan result and is never evidence of a transcript parsing error by itself. Transcript-backed rows remain read-only in chat.'
where id = 'transcript-evidence';

insert into public.ai_knowledge_chunks (id, title, content, source_path, tags)
values (
  'assistant-evidence-audit',
  'Evidence audit rules',
  'For any request to check, audit, verify, or find errors, use the most specific structured evidence tool. Compare source facts with the saved derived record. Separate confirmed mismatches, unresolved verification, and downstream planning outcomes. Prefer a plain no-supported-error result over a plausible inference. Name only the few records that require action.',
  'docs/AI_TRANSPARENCY.md',
  array['assistant', 'all', 'transcript', 'gpa', 'graduation']
)
on conflict (id) do update set
  title = excluded.title,
  content = excluded.content,
  source_path = excluded.source_path,
  tags = excluded.tags,
  updated_at = now();

comment on table public.ai_knowledge_chunks is
  'Curated application guidance retrieved for Pilot Assistant turns, including evidence-audit, concise-answer, and safe-mutation rules.';
