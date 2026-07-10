import { readFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile("supabase/catalog/smccd-2025-2026.json", "utf8"));
const equivalencies = JSON.parse(await readFile("supabase/catalog/dtech-smccd-equivalencies-2021.json", "utf8"));
const collegeCodes = new Set(["CSM", "SKY", "CAN"]);
const errors = [];
const courseIds = new Set();
const programIds = new Set();
const equivalencyCodes = new Set();

if (catalog.catalogYear !== "2025-2026") errors.push("Catalog year must be 2025-2026.");
for (const code of collegeCodes) {
  const courseCount = catalog.courses.filter((course) => course.collegeCode === code).length;
  const programCount = catalog.programs.filter((program) => program.collegeCode === code).length;
  if (courseCount < 500) errors.push(`${code} has only ${courseCount} courses.`);
  if (programCount < 20) errors.push(`${code} has only ${programCount} AA/AS programs.`);
}

for (const course of catalog.courses) {
  const id = `${course.collegeCode}:${course.courseCode}`;
  if (courseIds.has(id)) errors.push(`Duplicate course ${id}.`);
  courseIds.add(id);
  if (!collegeCodes.has(course.collegeCode)) errors.push(`Unknown college ${course.collegeCode}.`);
  if (!Number.isFinite(course.unitsMin) || course.unitsMin < 0) errors.push(`Invalid units for ${id}.`);
  if (!course.catalogUrl?.startsWith("https://catalog.")) errors.push(`Invalid official URL for ${id}.`);
}

for (const program of catalog.programs) {
  const id = `${program.collegeCode}:${program.programCode}`;
  if (programIds.has(id)) errors.push(`Duplicate program ${id}.`);
  programIds.add(id);
  if (!collegeCodes.has(program.collegeCode)) errors.push(`Unknown program college ${program.collegeCode}.`);
  if (!program.requirementGroups.length) errors.push(`Program ${id} has no parsed requirement groups.`);
  if (!program.catalogUrl?.startsWith("https://catalog.")) errors.push(`Invalid program URL for ${id}.`);
}

if (!equivalencies.source_url?.includes("1DShfEovBYe-N9VlR1QM6Pyy3pmJ4cMMc6bE91QUzLIw")) {
  errors.push("The d.tech equivalency artifact is not linked to the reviewed source sheet.");
}
if (equivalencies.rows.length !== 120) errors.push(`Expected 120 d.tech equivalencies, found ${equivalencies.rows.length}.`);
for (const row of equivalencies.rows) {
  if (equivalencyCodes.has(row.normalized_course_code)) errors.push(`Duplicate equivalency ${row.normalized_course_code}.`);
  equivalencyCodes.add(row.normalized_course_code);
  if (!Number.isFinite(row.college_units) || row.college_units <= 0) errors.push(`Invalid college units for ${row.normalized_course_code}.`);
  if (!Number.isFinite(row.high_school_credits) || row.high_school_credits <= 0) errors.push(`Invalid high-school credits for ${row.normalized_course_code}.`);
  if (!row.requirement_area || !row.high_school_equivalent) errors.push(`Incomplete equivalency ${row.normalized_course_code}.`);
}

if (errors.length > 0) {
  console.error(errors.slice(0, 30).join("\n"));
  process.exit(1);
}

console.log(`Validated ${catalog.courses.length} courses, ${catalog.programs.length} programs, and ${equivalencies.rows.length} d.tech equivalencies across CSM, Skyline, and Cañada.`);
