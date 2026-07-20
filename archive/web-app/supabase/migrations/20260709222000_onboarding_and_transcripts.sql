alter table public.student_profiles
  add column plan_start_grade integer check (plan_start_grade between 9 and 12),
  add column plan_end_grade integer check (plan_end_grade between 9 and 12),
  add column tracker_mode text not null default 'full' check (tracker_mode in ('full', 'selected')),
  add column tracked_requirement_areas public.requirement_area[] not null default array[
    'english'::public.requirement_area,
    'social_science'::public.requirement_area,
    'math'::public.requirement_area,
    'lab_science'::public.requirement_area,
    'world_language'::public.requirement_area,
    'design_lab'::public.requirement_area,
    'visual_performing_arts'::public.requirement_area,
    'personal_development'::public.requirement_area
  ];

update public.student_profiles
set
  plan_start_grade = coalesce(grade_level, 9),
  plan_end_grade = 12
where onboarding_complete;

alter table public.student_profiles
  add constraint student_profiles_plan_grade_order_check check (
    plan_start_grade is null
    or plan_end_grade is null
    or plan_end_grade >= plan_start_grade
  ),
  add constraint student_profiles_plan_length_check check (
    plan_start_grade is null
    or plan_end_grade is null
    or plan_end_grade - plan_start_grade between 0 and 3
  ),
  add constraint student_profiles_tracker_selection_check check (
    tracker_mode = 'full' or cardinality(tracked_requirement_areas) > 0
  );

alter table public.official_sources
  add column document_type text not null default 'general'
  check (document_type in ('general', 'transcript'));

alter table public.catalog_review_items
  drop constraint catalog_review_items_entity_type_check,
  add constraint catalog_review_items_entity_type_check check (
    entity_type in ('course', 'requirement', 'policy', 'source_note', 'transcript_course', 'transcript_note')
  );

alter table public.plan_courses
  add column source_review_item_id uuid references public.catalog_review_items(id) on delete set null;

create unique index plan_courses_one_import_per_review_item
  on public.plan_courses(source_review_item_id)
  where source_review_item_id is not null;
