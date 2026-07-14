import { readFile, writeFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile("supabase/catalog/smccd-2025-2026.json", "utf8"));
const outputPath = "supabase/migrations/20260714019000_smccd_requirement_parser_audit.sql";
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

const sql = [`-- Rebuild source-backed SMCCD program requirements after preserving OR choices,
-- free-text course-family rules, and required core groups from the official catalogs.

alter table public.smccd_program_requirements
  add column if not exists constraint_only boolean not null default false;
`];

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
console.log(`Wrote ${outputPath}: ${requirements.length} requirement groups and ${options.length} course options.`);

function chunks(values, size) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size));
}

function insertValues(table, rows) {
  return `insert into ${table} values\n${rows.map((row) => `  (${row.map(value).join(", ")})`).join(",\n")};\n`;
}

function value(input) {
  if (input === null || input === undefined) return "null";
  if (typeof input === "number") return String(input);
  if (typeof input === "boolean") return input ? "true" : "false";
  return quote(String(input));
}

function quote(input) {
  return `'${input.replaceAll("'", "''")}'`;
}
