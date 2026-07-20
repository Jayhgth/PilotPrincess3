-- plan_courses originally only recognized a selected-school course ID or a
-- custom title. SMCCD courses later gained their own catalog foreign key, so
-- atomic integrated schedules must treat that key as a complete identity too.
alter table public.plan_courses
  drop constraint if exists plan_courses_check;

alter table public.plan_courses
  add constraint plan_courses_catalog_identity
  check (
    course_id is not null
    or smccd_course_id is not null
    or nullif(trim(custom_course_name), '') is not null
  );

comment on constraint plan_courses_catalog_identity on public.plan_courses is
  'A plan row must reference a selected-school course, a college course, or a named custom course.';
