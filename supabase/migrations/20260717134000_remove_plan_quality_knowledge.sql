-- Remove the retired standalone plan-quality feature from Pilot retrieval.
-- General schedule consistency and prerequisite rules remain in their owning
-- planning contracts rather than a separate audit surface.

delete from public.ai_knowledge_chunks
where id = 'plan-quality-revision-loop';
