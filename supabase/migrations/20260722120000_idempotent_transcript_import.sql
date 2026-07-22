-- Keep onboarding and the transcript workspace on one idempotent write path.
-- A review row may be submitted again after a stale client refresh, but it may
-- only own one course row inside a named plan version.

create or replace function public.commit_transcript_import_v1(
  p_plan_version_id uuid,
  p_approved_ids uuid[],
  p_rejected_ids uuid[],
  p_corrections jsonb,
  p_plan_rows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_user_id uuid := (select auth.uid());
  saved_rows jsonb;
begin
  if target_user_id is null then raise exception 'Authentication required.' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.plan_versions version
    where version.id = p_plan_version_id and version.user_id = target_user_id
      and version.kind = 'active' and version.archived_at is null
  ) then raise exception 'The active plan is unavailable.'; end if;
  if jsonb_typeof(p_plan_rows) <> 'array' or jsonb_array_length(p_plan_rows) > 250 then
    raise exception 'Transcript rows must be a bounded array.';
  end if;
  if jsonb_typeof(p_corrections) <> 'array' or jsonb_array_length(p_corrections) > 250 then
    raise exception 'Transcript corrections must be a bounded array.';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_approved_ids, '{}'::uuid[]) || coalesce(p_rejected_ids, '{}'::uuid[])) requested_id
    left join public.catalog_review_items item on item.id = requested_id
      and item.user_id = target_user_id and item.entity_type = 'transcript_course'
    where item.id is null
  ) then raise exception 'One or more transcript rows are unavailable.'; end if;

  update public.catalog_review_items set status = 'approved', updated_at = now()
  where user_id = target_user_id and id = any(coalesce(p_approved_ids, '{}'::uuid[]));
  update public.catalog_review_items set status = 'rejected', updated_at = now()
  where user_id = target_user_id and id = any(coalesce(p_rejected_ids, '{}'::uuid[]));

  with corrections as (
    select * from jsonb_to_recordset(p_corrections) as correction(id uuid, payload jsonb)
  )
  update public.catalog_review_items item
  set corrected_payload = correction.payload, updated_at = now()
  from corrections correction
  where item.id = correction.id and item.user_id = target_user_id
    and item.entity_type = 'transcript_course' and item.status = 'approved';

  -- Preserve the existing row identity when the transcript is reconciling a
  -- manually-created completed course.
  with rows as (
    select * from jsonb_to_recordset(p_plan_rows) as row(
      id uuid, course_id uuid, custom_course_name text, grade_level integer,
      school_year text, term text, status text, credits numeric,
      college_units numeric, letter_grade text, is_weighted boolean,
      mapping_verified boolean, user_edited boolean, notes text,
      sort_order integer, source_review_item_id uuid, smccd_course_id text,
      college_provider_code text, requirement_area_override text
    )
  )
  update public.plan_courses existing
  set course_id = row.course_id,
      custom_course_name = row.custom_course_name,
      grade_level = row.grade_level,
      school_year = row.school_year,
      term = row.term,
      status = row.status::public.course_status,
      credits = row.credits,
      college_units = row.college_units,
      letter_grade = row.letter_grade,
      is_weighted = row.is_weighted,
      mapping_verified = row.mapping_verified,
      user_edited = row.user_edited,
      notes = row.notes,
      sort_order = row.sort_order,
      source_review_item_id = row.source_review_item_id,
      smccd_course_id = row.smccd_course_id,
      college_provider_code = row.college_provider_code,
      requirement_area_override = nullif(row.requirement_area_override, '')::public.requirement_area,
      updated_at = now()
  from rows row
  join public.catalog_review_items item on item.id = row.source_review_item_id
    and item.user_id = target_user_id and item.status = 'approved'
    and item.entity_type = 'transcript_course'
  where existing.id = row.id and existing.user_id = target_user_id
    and existing.plan_version_id = p_plan_version_id;

  with rows as (
    select * from jsonb_to_recordset(p_plan_rows) as row(
      id uuid, course_id uuid, custom_course_name text, grade_level integer,
      school_year text, term text, status text, credits numeric,
      college_units numeric, letter_grade text, is_weighted boolean,
      mapping_verified boolean, user_edited boolean, notes text,
      sort_order integer, source_review_item_id uuid, smccd_course_id text,
      college_provider_code text, requirement_area_override text
    )
  )
  insert into public.plan_courses (
    id, plan_version_id, user_id, course_id, custom_course_name, grade_level,
    school_year, term, status, credits, college_units, letter_grade,
    is_weighted, mapping_verified, user_edited, notes, sort_order,
    source_review_item_id, smccd_course_id, college_provider_code,
    requirement_area_override
  )
  select
    row.id, p_plan_version_id, target_user_id, row.course_id,
    row.custom_course_name, row.grade_level, row.school_year, row.term,
    row.status::public.course_status, row.credits, row.college_units,
    row.letter_grade, row.is_weighted, row.mapping_verified, row.user_edited,
    row.notes, row.sort_order, row.source_review_item_id, row.smccd_course_id,
    row.college_provider_code,
    nullif(row.requirement_area_override, '')::public.requirement_area
  from rows row
  join public.catalog_review_items item on item.id = row.source_review_item_id
    and item.user_id = target_user_id and item.status = 'approved'
    and item.entity_type = 'transcript_course'
  where not exists (
    select 1 from public.plan_courses existing
    where existing.id = row.id and existing.user_id = target_user_id
      and existing.plan_version_id = p_plan_version_id
  )
  on conflict (plan_version_id, source_review_item_id)
    where source_review_item_id is not null
  do update set
    course_id = excluded.course_id,
    custom_course_name = excluded.custom_course_name,
    grade_level = excluded.grade_level,
    school_year = excluded.school_year,
    term = excluded.term,
    status = excluded.status,
    credits = excluded.credits,
    college_units = excluded.college_units,
    letter_grade = excluded.letter_grade,
    is_weighted = excluded.is_weighted,
    mapping_verified = excluded.mapping_verified,
    user_edited = excluded.user_edited,
    notes = excluded.notes,
    sort_order = excluded.sort_order,
    smccd_course_id = excluded.smccd_course_id,
    college_provider_code = excluded.college_provider_code,
    requirement_area_override = excluded.requirement_area_override,
    updated_at = now();

  select coalesce(jsonb_agg(to_jsonb(course) order by course.grade_level, course.sort_order), '[]'::jsonb)
  into saved_rows
  from public.plan_courses course
  where course.user_id = target_user_id
    and course.plan_version_id = p_plan_version_id
    and course.source_review_item_id = any(coalesce(p_approved_ids, '{}'::uuid[]));

  return jsonb_build_object('rows', saved_rows, 'imported_count', jsonb_array_length(saved_rows));
end;
$$;

revoke all on function public.commit_transcript_import_v1(uuid, uuid[], uuid[], jsonb, jsonb) from public;
grant execute on function public.commit_transcript_import_v1(uuid, uuid[], uuid[], jsonb, jsonb) to authenticated;

comment on function public.commit_transcript_import_v1(uuid, uuid[], uuid[], jsonb, jsonb) is
  'Atomically imports transcript review rows into one active plan version and safely replays duplicate submissions.';
