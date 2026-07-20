create table public.student_smccd_ge_completions (
  user_id uuid not null references public.student_settings(id) on delete cascade,
  college_code text not null check (college_code in ('CSM', 'SKY', 'CAN')),
  area text not null check (area = '7A'),
  completion_source text not null default 'manual' check (completion_source = 'manual'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, college_code, area)
);

create trigger student_smccd_ge_completions_set_updated_at
  before update on public.student_smccd_ge_completions
  for each row execute function public.set_updated_at();

alter table public.student_smccd_ge_completions enable row level security;

create policy "users manage own manual GE completions"
  on public.student_smccd_ge_completions for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

comment on table public.student_smccd_ge_completions is
  'Student-confirmed local AA/AS general-education completions that are not reliably represented on transcripts.';
