create table public.school_academic_sync_runs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  academic_year text not null,
  payload jsonb not null,
  course_count integer not null default 0,
  requirement_count integer not null default 0,
  validation jsonb not null default '{}'::jsonb,
  status text not null default 'staged' check (status in ('staged', 'promoted', 'rejected', 'failed')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index school_academic_sync_runs_review_queue
  on public.school_academic_sync_runs(status, created_at desc);

create trigger school_academic_sync_runs_set_updated_at
before update on public.school_academic_sync_runs
for each row execute procedure public.set_updated_at();

alter table public.school_academic_sync_runs enable row level security;

create policy "admins review staged school academics"
on public.school_academic_sync_runs for select to authenticated
using (public.is_app_admin());

grant select on public.school_academic_sync_runs to authenticated;

comment on table public.school_academic_sync_runs is
  'Machine-extracted school catalogs and diploma rules awaiting explicit administrator promotion. Scheduled sync never publishes directly.';
