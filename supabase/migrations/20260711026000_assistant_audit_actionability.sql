update public.ai_knowledge_chunks
set content = 'For any request to check, audit, verify, or find errors, use the most specific structured evidence tool. Compare source facts with the saved derived record. Separate confirmed mismatches, unresolved verification, and downstream planning outcomes. Prefer a plain no-supported-error result over a plausible inference. Name at most three exact affected records, state what is wrong or unresolved for each, and count any remainder instead of returning a vague category.'
where id = 'assistant-evidence-audit';
