-- Reconcile the transcript spelling "Pre-Calculus Honors" with the current
-- d.tech catalog row "Precalculus Honors" and remove only untouched generated
-- duplicates that were created before name-based suggestion deduplication.

delete from public.plan_courses as generated
using public.courses as catalog_course,
      public.catalog_versions as catalog_version,
      public.plan_courses as transcript_course
where generated.course_id = catalog_course.id
  and catalog_course.catalog_version_id = catalog_version.id
  and catalog_course.school_id = 'd7ec0000-0000-4000-8000-000000000001'
  and catalog_version.is_current
  and catalog_course.name = 'Precalculus Honors'
  and catalog_course.review_status = 'approved'
  and generated.user_edited = false
  and generated.source_review_item_id is null
  and transcript_course.plan_version_id = generated.plan_version_id
  and transcript_course.user_id = generated.user_id
  and transcript_course.status = 'completed'
  and transcript_course.source_review_item_id is not null
  and transcript_course.course_id is null
  and regexp_replace(
    lower(coalesce(transcript_course.custom_course_name, '')),
    '[^a-z0-9]+',
    '',
    'g'
  ) = 'precalculushonors';

update public.plan_courses as transcript_course
set course_id = catalog_course.id,
    mapping_verified = exists (
      select 1
      from public.course_requirement_mappings as mapping
      where mapping.course_id = catalog_course.id
        and mapping.confidence = 'verified'
    ),
    updated_at = now()
from public.courses as catalog_course
join public.catalog_versions as catalog_version
  on catalog_version.id = catalog_course.catalog_version_id
where catalog_course.school_id = 'd7ec0000-0000-4000-8000-000000000001'
  and catalog_version.is_current
  and catalog_course.name = 'Precalculus Honors'
  and catalog_course.review_status = 'approved'
  and transcript_course.status = 'completed'
  and transcript_course.source_review_item_id is not null
  and transcript_course.course_id is null
  and regexp_replace(
    lower(coalesce(transcript_course.custom_course_name, '')),
    '[^a-z0-9]+',
    '',
    'g'
  ) = 'precalculushonors';
