-- A named plan is a strategy for future coursework, not a separate academic
-- history. Keep imported transcript rows in every version and scope strategy
-- mutations to the active version at the application boundary.

create or replace function public.create_plan_version_v2(
  p_label text,
  p_source_version_id uuid default null,
  p_activate boolean default true,
  p_start_empty boolean default false,
  p_role text default 'plan',
  p_strategy text default 'balanced'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  created jsonb;
  updated public.plan_versions%rowtype;
  created_version_id uuid;
  history_source_version_id uuid;
  copied_history_count integer := 0;
begin
  if p_strategy not in ('balanced', 'highest_gpa', 'degree_overlap', 'minimum_courses') then
    raise exception 'Unsupported plan strategy.' using errcode = '22023';
  end if;

  created := public.create_plan_version_v1(
    p_label,
    p_source_version_id,
    p_activate,
    p_start_empty,
    p_role
  );
  created_version_id := (created ->> 'id')::uuid;
  history_source_version_id := coalesce(p_source_version_id, (created ->> 'previous_active_version_id')::uuid);

  if p_start_empty then
    insert into public.plan_courses (
      plan_version_id, user_id, course_id, custom_course_name, grade_level,
      school_year, term, status, credits, college_units, letter_grade,
      is_weighted, mapping_verified, user_edited, notes, sort_order,
      source_review_item_id, smccd_course_id, college_provider_code,
      requirement_area_override
    )
    select
      created_version_id, course.user_id, course.course_id, course.custom_course_name,
      course.grade_level, course.school_year, course.term, course.status,
      course.credits, course.college_units, course.letter_grade,
      course.is_weighted, course.mapping_verified, course.user_edited,
      course.notes, course.sort_order, course.source_review_item_id,
      course.smccd_course_id, course.college_provider_code,
      course.requirement_area_override
    from public.plan_courses course
    where course.plan_version_id = history_source_version_id
      and course.user_id = (select auth.uid())
      and course.source_review_item_id is not null;
    get diagnostics copied_history_count = row_count;
  end if;

  update public.plan_versions
  set generation_config = coalesce(generation_config, '{}'::jsonb) || jsonb_build_object('strategy', p_strategy),
      updated_at = now()
  where id = created_version_id and user_id = (select auth.uid())
  returning * into updated;

  return to_jsonb(updated) || jsonb_build_object(
    'course_count', coalesce((created ->> 'course_count')::integer, 0) + copied_history_count,
    'previous_active_version_id', created ->> 'previous_active_version_id'
  );
end;
$$;

-- Repair empty versions created before transcript history was made invariant.
insert into public.plan_courses (
  plan_version_id, user_id, course_id, custom_course_name, grade_level,
  school_year, term, status, credits, college_units, letter_grade,
  is_weighted, mapping_verified, user_edited, notes, sort_order,
  source_review_item_id, smccd_course_id, college_provider_code,
  requirement_area_override
)
select
  target.id, source.user_id, source.course_id, source.custom_course_name,
  source.grade_level, source.school_year, source.term, source.status,
  source.credits, source.college_units, source.letter_grade,
  source.is_weighted, source.mapping_verified, source.user_edited,
  source.notes, source.sort_order, source.source_review_item_id,
  source.smccd_course_id, source.college_provider_code,
  source.requirement_area_override
from public.plan_versions target
join lateral (
  select distinct on (course.source_review_item_id) course.*
  from public.plan_courses course
  join public.plan_versions source_version on source_version.id = course.plan_version_id
  where source_version.plan_id = target.plan_id
    and course.user_id = target.user_id
    and course.source_review_item_id is not null
  order by course.source_review_item_id, course.created_at
) source on true
where target.archived_at is null
  and not exists (
    select 1
    from public.plan_courses existing
    where existing.plan_version_id = target.id
      and existing.source_review_item_id = source.source_review_item_id
  );

comment on function public.create_plan_version_v2(text, uuid, boolean, boolean, text, text) is
  'Creates a named strategy plan while retaining immutable transcript-backed academic history even when future coursework starts empty.';
