-- Cover the remaining workspace and Pilot access paths with indexes matching
-- their stable filters and orderings.
create index if not exists official_sources_school_feed_idx
  on public.official_sources (school_id, is_official desc, created_at desc);

create index if not exists courses_school_catalog_idx
  on public.courses (school_id, review_status, subject, name);

create index if not exists graduation_requirements_school_idx
  on public.graduation_requirements (school_id, review_status, name);

create index if not exists smccd_program_requirements_program_idx
  on public.smccd_program_requirements (program_id, sort_order);

create index if not exists smccd_requirement_courses_requirement_idx
  on public.smccd_requirement_courses (requirement_id);

-- Pilot needs the same academic snapshot as the app plus private evidence and
-- memories. Return it in one RLS-protected request instead of rebuilding the
-- same query waterfall for every tool call.
create or replace function public.get_assistant_workspace_bootstrap()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with core as (
    select public.get_workspace_bootstrap() as value
  )
  select core.value || jsonb_build_object(
    'transcript_sources', coalesce((
      select jsonb_agg(to_jsonb(source) order by source.created_at desc)
      from public.official_sources source
      where source.user_id = (select auth.uid())
        and source.document_type = 'transcript'
    ), '[]'::jsonb),
    'transcript_review_items', coalesce((
      select jsonb_agg(to_jsonb(item) order by item.created_at)
      from public.catalog_review_items item
      where item.user_id = (select auth.uid())
        and item.entity_type in ('transcript_course', 'transcript_note')
    ), '[]'::jsonb),
    'prerequisite_clearances', coalesce((
      select jsonb_agg(to_jsonb(clearance))
      from public.student_prerequisite_clearances clearance
      where clearance.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'manual_smccd_completions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'college_code', completion.college_code,
        'area', completion.area
      ))
      from public.student_smccd_ge_completions completion
      where completion.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'memories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'memory_key', memory.memory_key,
        'content', memory.content,
        'tags', memory.tags
      ))
      from public.ai_student_memories memory
      where memory.user_id = (select auth.uid())
        and memory.is_active
    ), '[]'::jsonb),
    'nearby_providers', coalesce((
      select jsonb_agg(to_jsonb(provider))
      from public.nearby_school_providers(
        ((core.value -> 'school' ->> 'id')::uuid),
        8
      ) provider
    ), '[]'::jsonb)
  )
  from core;
$$;

revoke all on function public.get_assistant_workspace_bootstrap() from public;
grant execute on function public.get_assistant_workspace_bootstrap() to authenticated;

comment on function public.get_assistant_workspace_bootstrap() is
  'RLS-protected academic, transcript, policy, prerequisite, and memory snapshot for Pilot tools.';
