update public.ai_knowledge_chunks
set content = 'Completed Pilot tool outcomes are canonical conversation history. The thread receives bounded public summaries and app-data results from recent read and write tools so follow-up references retain context. Each applied change has a stable action identifier and a durable private server-side inverse with no arbitrary expiration. When a student says undo, revert, restore, or bring it back, resolve the reference against the recent change ledger and invoke the exact stored inverse. Never reconstruct deleted rows from current state and never conclude that removed data is unavailable because it no longer appears there. Refuse only when a newer conflicting edit makes the inverse unsafe; do not overwrite newer data. Refresh historical read evidence through its owning tool when current state matters.',
    priority = 100,
    updated_at = now()
where id = 'thread-action-context-and-undo';

insert into public.ai_knowledge_chunks (id, title, content, source_path, tags, priority, metadata)
values (
  'complete-student-academic-control',
  'Complete student academic control and planning rules',
  'Pilot can read and change every student-owned academic and ordinary profile feature exposed by the app through validated tools: selected school and settings; editable course rows, placement, grades, credits, units, weighting and notes; saved GPA assumptions; degree bookmarks and manual completion evidence; enrollment preference; transcript review corrections; prerequisite evidence; plan snapshots; and compound academic-plan operations. Use get_academic_context for a bounded cross-feature view and narrower evidence tools for source detail. Prefer one batch or compound action for a complete request, and explain the selected courses and remaining gaps. Every verified college course is weighted in the d.tech GPA calculation; only high-school courses with approved weighting evidence are weighted. College units are not d.tech transcript credits. College coursework can satisfy high-school graduation requirements only through verified equivalency mappings. CSM, Skyline, and Cañada keep distinct local GE rules even when cross-college course identities or prerequisites are equivalent. For multi-year planning, honor the requested starting grade, prerequisites, published enrollment limits, student major/interests, diploma completion, degree overlap, and weighted-GPA objective without inventing availability or approvals. Pilot cannot delete accounts, alter authentication, approve institutional evidence, publish shared catalog data, act as an administrator, or access another user.',
  'docs/AI_TRANSPARENCY.md',
  array['assistant', 'schedule', 'gpa', 'degrees', 'transcript', 'settings', 'undo'],
  100,
  '{"always":true,"contract":"student_academic_control"}'::jsonb
)
on conflict (id) do update set
  title = excluded.title,
  content = excluded.content,
  source_path = excluded.source_path,
  tags = excluded.tags,
  priority = excluded.priority,
  metadata = excluded.metadata,
  is_active = true,
  updated_at = now();

create or replace function public.clear_pilot_academic_plan(
  p_clear_courses boolean,
  p_clear_degree_bookmarks boolean,
  p_clear_gpa_scenario boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := (select auth.uid());
  active_version_id uuid;
  plan_rows jsonb := '[]'::jsonb;
  goal_rows jsonb := '[]'::jsonb;
  gpa_rows jsonb := '[]'::jsonb;
begin
  if current_user_id is null then raise exception 'Authentication is required.'; end if;
  select version.id into active_version_id
  from public.four_year_plans plan
  join public.plan_versions version on version.plan_id = plan.id and version.kind = 'active'
  where plan.user_id = current_user_id and plan.is_active
  limit 1;
  if active_version_id is null then raise exception 'The active academic plan is unavailable.'; end if;

  if p_clear_courses then
    select coalesce(jsonb_agg(to_jsonb(course) order by course.sort_order, course.id), '[]'::jsonb)
    into plan_rows
    from public.plan_courses course
    where course.user_id = current_user_id
      and course.plan_version_id = active_version_id
      and course.source_review_item_id is null;
  end if;
  if p_clear_degree_bookmarks then
    select coalesce(jsonb_agg(to_jsonb(goal) order by goal.created_at, goal.id), '[]'::jsonb)
    into goal_rows
    from public.student_smccd_goals goal
    where goal.user_id = current_user_id;
  end if;
  select coalesce(jsonb_agg(to_jsonb(choice) order by choice.plan_course_id), '[]'::jsonb)
  into gpa_rows
  from public.student_gpa_scenario_choices choice
  where choice.user_id = current_user_id
    and (
      p_clear_gpa_scenario
      or (p_clear_courses and exists (
        select 1 from jsonb_array_elements(plan_rows) row
        where row->>'id' = choice.plan_course_id::text
      ))
    );

  if p_clear_gpa_scenario then
    delete from public.student_gpa_scenario_choices where user_id = current_user_id;
  end if;
  if p_clear_courses then
    delete from public.plan_courses
    where user_id = current_user_id
      and plan_version_id = active_version_id
      and source_review_item_id is null;
  end if;
  if p_clear_degree_bookmarks then
    delete from public.student_smccd_goals where user_id = current_user_id;
  end if;
  return jsonb_build_object('plan_rows', plan_rows, 'goal_rows', goal_rows, 'gpa_rows', gpa_rows);
end;
$$;

create or replace function public.restore_pilot_academic_plan(
  p_plan_rows jsonb,
  p_goal_rows jsonb,
  p_gpa_rows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then raise exception 'Authentication is required.'; end if;
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(p_plan_rows, '[]'::jsonb)) as saved(id uuid, user_id uuid)
    join public.plan_courses current on current.id = saved.id
    where saved.user_id = current_user_id
  ) then
    raise exception 'This plan changed after the clear operation, so newer course data cannot be overwritten.';
  end if;

  insert into public.plan_courses (
    id, plan_version_id, user_id, course_id, custom_course_name, grade_level, school_year, term, status,
    credits, college_units, letter_grade, is_weighted, mapping_verified, user_edited, notes, sort_order,
    source_review_item_id, smccd_course_id, college_provider_code, requirement_area_override
  )
  select id, plan_version_id, user_id, course_id, custom_course_name, grade_level, school_year, term, status,
    credits, college_units, letter_grade, is_weighted, mapping_verified, user_edited, notes, sort_order,
    source_review_item_id, smccd_course_id, college_provider_code, requirement_area_override
  from jsonb_populate_recordset(null::public.plan_courses, coalesce(p_plan_rows, '[]'::jsonb)) saved
  where saved.user_id = current_user_id;

  insert into public.student_smccd_goals (id, user_id, program_id, is_primary, notes)
  select id, user_id, program_id, is_primary, notes
  from jsonb_populate_recordset(null::public.student_smccd_goals, coalesce(p_goal_rows, '[]'::jsonb)) saved
  where saved.user_id = current_user_id
  on conflict (user_id, program_id) do nothing;

  insert into public.student_gpa_scenario_choices (user_id, plan_course_id, included, expected_grade)
  select user_id, plan_course_id, included, expected_grade
  from jsonb_populate_recordset(null::public.student_gpa_scenario_choices, coalesce(p_gpa_rows, '[]'::jsonb)) saved
  where saved.user_id = current_user_id
  on conflict (user_id, plan_course_id) do update
    set included = excluded.included,
        expected_grade = excluded.expected_grade;

  return jsonb_build_object(
    'courses_restored', jsonb_array_length(coalesce(p_plan_rows, '[]'::jsonb)),
    'degree_bookmarks_restored', jsonb_array_length(coalesce(p_goal_rows, '[]'::jsonb)),
    'gpa_assumptions_restored', jsonb_array_length(coalesce(p_gpa_rows, '[]'::jsonb))
  );
end;
$$;

grant execute on function public.clear_pilot_academic_plan(boolean, boolean, boolean) to authenticated;
grant execute on function public.restore_pilot_academic_plan(jsonb, jsonb, jsonb) to authenticated;
