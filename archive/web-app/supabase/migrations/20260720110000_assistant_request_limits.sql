create table public.assistant_request_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default clock_timestamp(),
  request_count integer not null default 0 check (request_count >= 0),
  last_requested_at timestamptz not null default clock_timestamp()
);

alter table public.assistant_request_limits enable row level security;

revoke all on table public.assistant_request_limits from anon, authenticated;

create or replace function public.acquire_assistant_turn_v1()
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_at timestamptz := clock_timestamp();
  stored_window_started_at timestamptz;
  stored_request_count integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  insert into public.assistant_request_limits as limits (
    user_id,
    window_started_at,
    request_count,
    last_requested_at
  )
  values (current_user_id, requested_at, 1, requested_at)
  on conflict (user_id) do update set
    window_started_at = case
      when excluded.last_requested_at - limits.window_started_at >= interval '60 seconds'
        then excluded.last_requested_at
      else limits.window_started_at
    end,
    request_count = case
      when excluded.last_requested_at - limits.window_started_at >= interval '60 seconds'
        then 1
      else limits.request_count + 1
    end,
    last_requested_at = excluded.last_requested_at
  returning limits.window_started_at, limits.request_count
  into stored_window_started_at, stored_request_count;

  allowed := stored_request_count <= 12;
  retry_after_seconds := case
    when allowed then 0
    else greatest(1, ceil(extract(epoch from (stored_window_started_at + interval '60 seconds' - requested_at)))::integer)
  end;
  return next;
end;
$$;

revoke all on function public.acquire_assistant_turn_v1() from public;
grant execute on function public.acquire_assistant_turn_v1() to authenticated;

comment on table public.assistant_request_limits is
  'Server-shared burst protection for authenticated Pilot turns. Rows are not exposed through the data API.';

comment on function public.acquire_assistant_turn_v1() is
  'Atomically permits up to twelve Pilot turns per authenticated user per sixty-second window across serverless instances.';
