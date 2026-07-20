create table public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reporter_email text not null,
  school_id uuid references public.schools(id) on delete set null,
  category text not null check (category in ('support', 'bug', 'course_issue')),
  subject text not null check (char_length(subject) between 3 and 120),
  message text not null check (char_length(message) between 10 and 4000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  admin_response text check (admin_response is null or char_length(admin_response) between 3 and 4000),
  assigned_admin_id uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index support_requests_user_created_idx on public.support_requests (user_id, created_at desc);
create index support_requests_admin_queue_idx on public.support_requests (status, created_at desc);

create or replace function public.prepare_support_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  new.user_id := current_user_id;
  new.reporter_email := coalesce((select auth.jwt() ->> 'email'), 'Student account');
  select settings.school_id into new.school_id from public.student_settings settings where settings.id = current_user_id;
  new.status := 'open';
  new.admin_response := null;
  new.assigned_admin_id := null;
  new.resolved_at := null;
  return new;
end;
$$;

create trigger support_requests_prepare before insert on public.support_requests
for each row execute function public.prepare_support_request();

create trigger support_requests_set_updated_at before update on public.support_requests
for each row execute function public.set_updated_at();

alter table public.support_requests enable row level security;

create policy "students submit support requests" on public.support_requests
for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "students read own support requests" on public.support_requests
for select to authenticated using (user_id = (select auth.uid()) or (select public.is_app_admin()));

create policy "admins address support requests" on public.support_requests
for update to authenticated using ((select public.is_app_admin()))
with check ((select public.is_app_admin()));

grant select, insert, update on public.support_requests to authenticated;

comment on table public.support_requests is
  'Private student support, bug, and course-data reports with administrator status and response tracking.';
