import { readFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile("supabase/catalog/smccd-2025-2026.json", "utf8"));
const collegeCodes = new Set(["CSM", "SKY", "CAN"]);
const errors = [];
const courseIds = new Set();
const programIds = new Set();

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

if (errors.length > 0) {
  console.error(errors.slice(0, 30).join("\n"));
  process.exit(1);
}

console.log(`Validated ${catalog.courses.length} courses and ${catalog.programs.length} programs across CSM, Skyline, and Cañada.`);
