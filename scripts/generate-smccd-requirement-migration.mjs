import { readFile, writeFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile("supabase/catalog/smccd-2025-2026.json", "utf8"));
const outputPath = "supabase/migrations/20260714020000_smccd_degree_and_ge_catalog_audit.sql";
const requirements = catalog.programs.flatMap((program) => program.requirementGroups.map((requirement, sortOrder) => ({
  ...requirement,
  id: `${program.collegeCode}:${program.programCode}:${requirement.id}`,
  programId: `${program.collegeCode}:${program.programCode}`,
  sortOrder
})));
const options = requirements.flatMap((requirement) => requirement.courseOptions.map((option) => ({
  requirementId: requirement.id,
  ...option
})));

const sql = [`-- Refresh the source-backed SMCCD catalog and rebuild all AA/AS requirements
-- after a catalog-wide source-table and local-GE audit.

alter table public.smccd_program_requirements
  add column if not exists constraint_only boolean not null default false;
`];

for (const batch of chunks(catalog.courses, 150)) {
  const statement = insertValues(
    "public.smccd_courses (id, college_code, course_code, subject, course_number, title, units_min, units_max, degree_applicable, transfer_credit, attributes, prerequisites, corequisites, recommended_preparation, detail_status, degree_applicability_source, catalog_url, source_year)",
    batch.map((course) => [
      `${course.collegeCode}:${course.courseCode}`,
      course.collegeCode,
      course.courseCode,
      course.subject,
      course.number,
      course.title,
      course.unitsMin,
      course.unitsMax,
      course.degreeApplicable,
      course.transferCredit,
      { sql: `array[${course.attributes.map(quote).join(", ")}]::text[]` },
      { sql: `array[${course.prerequisites.map(quote).join(", ")}]::text[]` },
      { sql: `array[${course.corequisites.map(quote).join(", ")}]::text[]` },
      { sql: `array[${course.recommendedPreparation.map(quote).join(", ")}]::text[]` },
      course.detailStatus,
      course.degreeApplicabilitySource,
      course.catalogUrl,
      catalog.catalogYear
    ])
  ).trimEnd().replace(/;$/, "");
  sql.push(`${statement}
on conflict (id) do update set
  title = excluded.title,
  units_min = excluded.units_min,
  units_max = excluded.units_max,
  degree_applicable = excluded.degree_applicable,
  transfer_credit = excluded.transfer_credit,
  attributes = excluded.attributes,
  prerequisites = excluded.prerequisites,
  corequisites = excluded.corequisites,
  recommended_preparation = excluded.recommended_preparation,
  detail_status = excluded.detail_status,
  degree_applicability_source = excluded.degree_applicability_source,
  catalog_url = excluded.catalog_url,
  source_year = excluded.source_year;
`);
}

for (const batch of chunks(catalog.programs, 150)) {
  const rows = batch.map((program) => [
    `${program.collegeCode}:${program.programCode}`,
    program.collegeCode,
    program.programCode,
    program.title,
    program.awardType,
    program.totalDegreeUnitsRequired,
    program.totalMajorUnitsText,
    program.catalogUrl,
    catalog.catalogYear
  ]);
  sql.push(`${insertValues("public.smccd_programs (id, college_code, program_code, title, award_type, total_degree_units, total_major_units_text, catalog_url, source_year)", rows).trimEnd().replace(/;$/, "")}
on conflict (id) do update set
  title = excluded.title,
  total_degree_units = excluded.total_degree_units,
  total_major_units_text = excluded.total_major_units_text,
  catalog_url = excluded.catalog_url,
  source_year = excluded.source_year;
`);
}

sql.push("delete from public.smccd_program_requirements;\n");

for (const batch of chunks(requirements, 150)) {
  sql.push(insertValues(
    "public.smccd_program_requirements (id, program_id, label, kind, min_units, min_count, raw_text, constraint_only, sort_order)",
    batch.map((requirement) => [
      requirement.id,
      requirement.programId,
      requirement.label,
      requirement.kind,
      requirement.minUnits,
      requirement.minCount,
      requirement.rawText,
      requirement.constraintOnly === true,
      requirement.sortOrder
    ])
  ));
}

for (const batch of chunks(options, 250)) {
  sql.push(insertValues(
    "public.smccd_requirement_courses (requirement_id, course_code, units_text, note)",
    batch.map((option) => [option.requirementId, option.courseCode, option.unitsText, option.note])
  ));
}

await writeFile(outputPath, `${sql.join("\n").trimEnd()}\n`);
console.log(`Wrote ${outputPath}: ${catalog.courses.length} courses, ${catalog.programs.length} programs, ${requirements.length} requirement groups, and ${options.length} course options.`);

function chunks(values, size) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

function insertValues(table, rows) {
  return `insert into ${table} values\n${rows.map((row) => `  (${row.map(value).join(", ")})`).join(",\n")};\n`;
}

function value(input) {
  if (input && typeof input === "object" && "sql" in input) return input.sql;
  if (input === null || input === undefined) return "null";
  if (typeof input === "number") return String(input);
  if (typeof input === "boolean") return input ? "true" : "false";
  return quote(String(input));
}

function quote(input) {
  return `'${input.replaceAll("'", "''")}'`;
}
