-- Older Pilot threads may contain JSON nulls or non-object payloads. They are
-- valid jsonb values but cannot satisfy the current rendering contract.

update public.ai_messages
set page_context = '{}'::jsonb
where jsonb_typeof(page_context) is distinct from 'object';

update public.ai_events
set payload = '{}'::jsonb
where jsonb_typeof(payload) is distinct from 'object';

update public.ai_tool_calls
set arguments = '{}'::jsonb
where jsonb_typeof(arguments) is distinct from 'object';

alter table public.ai_messages
  drop constraint if exists ai_messages_page_context_object,
  add constraint ai_messages_page_context_object
    check (jsonb_typeof(page_context) = 'object');

alter table public.ai_events
  drop constraint if exists ai_events_payload_object,
  add constraint ai_events_payload_object
    check (jsonb_typeof(payload) = 'object');

alter table public.ai_tool_calls
  drop constraint if exists ai_tool_calls_arguments_object,
  add constraint ai_tool_calls_arguments_object
    check (jsonb_typeof(arguments) = 'object');
