-- d.tech teaches the senior Government and Economics requirement as one
-- full-year course. Consolidate the catalog identity without discarding
-- transcript evidence from older imports that stored the two terms separately.

do $$
declare
  combined_course_id uuid;
  economics_course_id uuid;
  social_science_requirement_id uuid;
begin
  select id into combined_course_id
  from public.courses
  where catalog_version_id = 'd7ec2000-0000-4000-8000-000000000001'
    and name in ('Government', 'Government & Economics')
  order by case when name = 'Government & Economics' then 0 else 1 end
  limit 1;

  select id into economics_course_id
  from public.courses
  where catalog_version_id = 'd7ec2000-0000-4000-8000-000000000001'
    and name = 'Economics'
  limit 1;

  if combined_course_id is null then
    combined_course_id := economics_course_id;
    economics_course_id := null;
  end if;

  if combined_course_id is null then
    return;
  end if;

  update public.courses
  set
    name = 'Government & Economics',
    subject = 'Social Science',
    grade_levels = array[12],
    credits = 10,
    term_type = 'year',
    uc_ag_area = 'A/G (History and College Preparatory Elective)',
    description = 'Full-year senior course covering government, the Constitution, federalism, elections, civil rights, economic systems, markets, public policy, and personal finance.',
    is_honors = false,
    is_weighted = false,
    confidence = 'verified',
    review_status = 'approved',
    updated_at = now()
  where id = combined_course_id;

  select id into social_science_requirement_id
  from public.graduation_requirements
  where catalog_version_id = 'd7ec2000-0000-4000-8000-000000000001'
    and area = 'social_science'
  limit 1;

  if social_science_requirement_id is not null then
    update public.graduation_requirements
    set
      notes = 'World History, US History, and the full-year Government & Economics course are required. Ethnic Studies does not replace one of these three areas.',
      updated_at = now()
    where id = social_science_requirement_id;

    insert into public.course_requirement_mappings (
      course_id, requirement_id, source_id, confidence
    )
    values (
      combined_course_id,
      social_science_requirement_id,
      'd7ec1000-0000-4000-8000-000000000001',
      'verified'
    )
    on conflict (course_id, requirement_id) do update set
      source_id = excluded.source_id,
      confidence = excluded.confidence;
  end if;

  if economics_course_id is not null and economics_course_id <> combined_course_id then
    -- Collapse generated fall/spring pairs. Transcript-backed rows retain their
    -- separate grades and credit amounts while sharing the corrected catalog ID.
    delete from public.plan_courses economics_row
    using public.plan_courses government_row
    where economics_row.course_id = economics_course_id
      and government_row.course_id = combined_course_id
      and economics_row.plan_version_id = government_row.plan_version_id
      and economics_row.user_id = government_row.user_id
      and economics_row.grade_level = government_row.grade_level
      and economics_row.school_year = government_row.school_year
      and economics_row.status = government_row.status
      and economics_row.source_review_item_id is null
      and government_row.source_review_item_id is null
      and economics_row.letter_grade is null
      and government_row.letter_grade is null;

    update public.plan_courses
    set
      course_id = combined_course_id,
      term = case when source_review_item_id is null then 'full_year' else term end,
      credits = case when source_review_item_id is null then 10 else credits end,
      mapping_verified = true,
      updated_at = now()
    where course_id = economics_course_id;
  end if;

  update public.plan_courses
  set
    term = 'full_year',
    credits = 10,
    mapping_verified = true,
    updated_at = now()
  where course_id = combined_course_id
    and source_review_item_id is null;

  update public.plan_courses
  set
    course_id = combined_course_id,
    term = 'full_year',
    mapping_verified = true,
    updated_at = now()
  where source_review_item_id is not null
    and lower(coalesce(custom_course_name, '')) ~ '(government|govt|gov)'
    and lower(coalesce(custom_course_name, '')) ~ '(economics|econ)';

  update public.catalog_review_items
  set proposed_payload = jsonb_set(
    jsonb_set(
      jsonb_set(proposed_payload, '{matched_course_id}', to_jsonb(combined_course_id::text), true),
      '{matched_course_name}', to_jsonb('Government & Economics'::text), true
    ),
    '{transcript_classification}', to_jsonb('dtech_catalog'::text), true
  )
  where entity_type = 'transcript_course'
    and (
      proposed_payload ->> 'matched_course_id' in (combined_course_id::text, coalesce(economics_course_id::text, ''))
      or (
        lower(coalesce(proposed_payload ->> 'course_name', '')) ~ '(government|govt|gov)'
        and lower(coalesce(proposed_payload ->> 'course_name', '')) ~ '(economics|econ)'
      )
    );

  update public.catalog_review_items
  set corrected_payload = jsonb_set(
    jsonb_set(
      jsonb_set(corrected_payload, '{matched_course_id}', to_jsonb(combined_course_id::text), true),
      '{matched_course_name}', to_jsonb('Government & Economics'::text), true
    ),
    '{transcript_classification}', to_jsonb('dtech_catalog'::text), true
  )
  where entity_type = 'transcript_course'
    and corrected_payload is not null
    and (
      corrected_payload ->> 'matched_course_id' in (combined_course_id::text, coalesce(economics_course_id::text, ''))
      or (
        lower(coalesce(corrected_payload ->> 'course_name', '')) ~ '(government|govt|gov)'
        and lower(coalesce(corrected_payload ->> 'course_name', '')) ~ '(economics|econ)'
      )
    );

  if economics_course_id is not null and economics_course_id <> combined_course_id then
    delete from public.courses where id = economics_course_id;
  end if;
end;
$$;
