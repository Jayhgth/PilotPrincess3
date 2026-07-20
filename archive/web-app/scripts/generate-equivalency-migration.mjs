import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactPath = resolve(root, "supabase/catalog/dtech-smccd-equivalencies-2021.json");
const migrationPath = resolve(root, "supabase/migrations/20260710030000_dtech_smccd_equivalencies.sql");
const artifact = JSON.parse(await readFile(artifactPath, "utf8"));

const sqlString = (value) => value === null ? "null" : `'${String(value).replaceAll("'", "''")}'`;
const values = artifact.rows.map((row) => `  (${[
  sqlString(row.normalized_course_code),
  sqlString(row.college_course_code),
  sqlString(row.description),
  row.college_units,
  row.high_school_credits,
  sqlString(row.high_school_equivalent),
  sqlString(row.requirement_area),
  sqlString(row.pairing_note),
  "'d7ec1000-0000-4000-8000-000000000005'",
  "'verified'"
].join(", ")})`).join(",\n");

const migration = `-- Generated from supabase/catalog/dtech-smccd-equivalencies-2021.json.
-- The source is an official d.tech sheet last updated April 26, 2021.

insert into public.official_sources (
  id, school_id, title, kind, source_url, source_year, is_official, parse_status, confidence
)
values (
  'd7ec1000-0000-4000-8000-000000000005',
  'd7ec0000-0000-4000-8000-000000000001',
  ${sqlString(artifact.title)},
  'official_url',
  ${sqlString(artifact.source_url)},
  '2021',
  true,
  'complete',
  'verified'
)
on conflict (id) do update set
  title = excluded.title,
  source_url = excluded.source_url,
  source_year = excluded.source_year,
  parse_status = excluded.parse_status,
  confidence = excluded.confidence;

create table if not exists public.smccd_high_school_equivalencies (
  normalized_course_code text primary key,
  college_course_code text not null,
  description text not null,
  college_units numeric(5,2) not null check (college_units > 0),
  high_school_credits numeric(6,2) not null check (high_school_credits > 0),
  high_school_equivalent text not null,
  requirement_area public.requirement_area not null,
  pairing_note text,
  source_id uuid not null references public.official_sources(id) on delete restrict,
  confidence public.confidence_status not null default 'verified',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.smccd_high_school_equivalencies is
  'Exact SMCCD-to-d.tech high-school credit conversions from the official d.tech equivalency chart. The source is visibly dated 2021 and should be counselor-confirmed for new enrollment.';

alter table public.smccd_high_school_equivalencies enable row level security;

drop policy if exists "SMCCD high-school equivalencies are readable" on public.smccd_high_school_equivalencies;
create policy "SMCCD high-school equivalencies are readable"
  on public.smccd_high_school_equivalencies for select to authenticated using (true);

insert into public.smccd_high_school_equivalencies (
  normalized_course_code, college_course_code, description, college_units,
  high_school_credits, high_school_equivalent, requirement_area, pairing_note,
  source_id, confidence
)
values
${values}
on conflict (normalized_course_code) do update set
  college_course_code = excluded.college_course_code,
  description = excluded.description,
  college_units = excluded.college_units,
  high_school_credits = excluded.high_school_credits,
  high_school_equivalent = excluded.high_school_equivalent,
  requirement_area = excluded.requirement_area,
  pairing_note = excluded.pairing_note,
  source_id = excluded.source_id,
  confidence = excluded.confidence,
  updated_at = now();

-- Repair exact transcript-imported college rows so the app uses the d.tech
-- conversion instead of treating every college class as unverified credit.
update public.plan_courses plan_course
set credits = equivalency.high_school_credits,
    requirement_area_override = equivalency.requirement_area,
    mapping_verified = true,
    updated_at = now()
from public.smccd_high_school_equivalencies equivalency
where plan_course.source_review_item_id is not null
  and equivalency.normalized_course_code = coalesce(
    (
      select upper(smccd_course.course_code)
      from public.smccd_courses smccd_course
      where smccd_course.id = plan_course.smccd_course_id
    ),
    regexp_replace(
      substring(upper(coalesce(plan_course.custom_course_name, '')) from '^([A-Z]{2,5}[.]?[[:space:]]+[A-Z]?[0-9]{2,4}([.][0-9])?[A-Z]?)'),
      '^([A-Z]{2,5})[.]',
      '\\1'
    )
  );
`;

await writeFile(migrationPath, migration);
console.log(`Wrote ${artifact.rows.length} equivalencies to ${migrationPath}`);
