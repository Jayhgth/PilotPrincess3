-- Transcript evidence belongs to a course in a specific plan version. Snapshot
-- copies intentionally preserve that evidence link, so uniqueness must be
-- scoped to the version instead of the entire plan history.
drop index if exists public.plan_courses_one_import_per_review_item;

create unique index plan_courses_one_import_per_review_item
  on public.plan_courses(plan_version_id, source_review_item_id)
  where source_review_item_id is not null;

-- Remove empty safety snapshots left behind when the old global constraint
-- rejected the course-copy step before a transcript import.
delete from public.plan_versions as version
where version.kind = 'snapshot'
  and version.label like 'Before transcript import %'
  and not exists (
    select 1
    from public.plan_courses as course
    where course.plan_version_id = version.id
  );
