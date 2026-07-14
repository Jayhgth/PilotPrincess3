import { readFile } from "node:fs/promises";

const catalog = JSON.parse(await readFile("supabase/catalog/smccd-2025-2026.json", "utf8"));
const equivalencies = JSON.parse(await readFile("supabase/catalog/dtech-smccd-equivalencies-2021.json", "utf8"));
const collegeCodes = new Set(["CSM", "SKY", "CAN"]);
const errors = [];
const courseIds = new Set();
const programIds = new Set();
const equivalencyCodes = new Set();
const detailStatuses = new Set(["verified", "partial", "unavailable"]);
const degreeSources = new Set(["course_detail", "number_heuristic"]);

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
  if (!Array.isArray(course.prerequisites) || !Array.isArray(course.corequisites) || !Array.isArray(course.recommendedPreparation)) {
    errors.push(`Missing prerequisite arrays for ${id}.`);
  }
  if (!detailStatuses.has(course.detailStatus)) errors.push(`Invalid detail status for ${id}.`);
  if (!degreeSources.has(course.degreeApplicabilitySource)) errors.push(`Invalid degree source for ${id}.`);
  if (/^C\d+/i.test(course.number) && !course.degreeApplicable) errors.push(`Common Course Numbering row ${id} is incorrectly non-degree-applicable.`);
}

const verifiedDetailCount = catalog.courses.filter((course) => course.detailStatus === "verified").length;
const unavailableDetailCount = catalog.courses.filter((course) => course.detailStatus === "unavailable").length;
const prerequisiteCount = catalog.courses.filter((course) => course.prerequisites.length > 0).length;
const corequisiteCount = catalog.courses.filter((course) => course.corequisites.length > 0).length;
if (verifiedDetailCount < 2200) errors.push(`Only ${verifiedDetailCount} course-detail pages were verified.`);
if (unavailableDetailCount > 4) errors.push(`${unavailableDetailCount} course-detail pages are unavailable.`);
if (prerequisiteCount < 900) errors.push(`Only ${prerequisiteCount} courses have captured prerequisites.`);
if (corequisiteCount < 60) errors.push(`Only ${corequisiteCount} courses have captured corequisites.`);

const englishC1000 = catalog.courses.filter((course) => course.courseCode === "ENGL C1000");
if (englishC1000.length !== 3) errors.push(`Expected ENGL C1000 at all three colleges, found ${englishC1000.length}.`);
for (const course of englishC1000) {
  if (!course.degreeApplicable || !course.attributes.some((attribute) => attribute.includes("Area 1A"))) {
    errors.push(`${course.collegeCode}:ENGL C1000 must be degree-applicable general education Area 1A.`);
  }
  if (!course.prerequisites.some((prerequisite) => /multiple measures assessment process/i.test(prerequisite))) {
    errors.push(`${course.collegeCode}:ENGL C1000 is missing its official multiple-measures prerequisite.`);
  }
}

for (const program of catalog.programs) {
  const id = `${program.collegeCode}:${program.programCode}`;
  if (programIds.has(id)) errors.push(`Duplicate program ${id}.`);
  programIds.add(id);
  if (!collegeCodes.has(program.collegeCode)) errors.push(`Unknown program college ${program.collegeCode}.`);
  if (!program.requirementGroups.length) errors.push(`Program ${id} has no parsed requirement groups.`);
  if (!program.catalogUrl?.startsWith("https://catalog.")) errors.push(`Invalid program URL for ${id}.`);
  for (const requirement of program.requirementGroups) {
    if (typeof requirement.constraintOnly !== "boolean") errors.push(`Requirement ${id}:${requirement.id} is missing constraintOnly.`);
    if (/(?:not required|additional recommended)/i.test(requirement.label)) errors.push(`Program ${id} treats a recommended course list as required.`);
  }
}

const physicalScience = catalog.programs.find((program) => program.collegeCode === "CSM" && program.programCode === "physical-science-as");
if (!physicalScience) errors.push("CSM Physical Science AS is missing.");
else {
  const constraints = physicalScience.requirementGroups.filter((requirement) => requirement.constraintOnly);
  const unitPool = physicalScience.requirementGroups.find((requirement) => requirement.kind === "choose_units" && requirement.minUnits === 18);
  if (constraints.length !== 4 || constraints.some((requirement) => requirement.kind !== "or_group" || requirement.minCount !== 1)) {
    errors.push("CSM Physical Science must preserve all four one-course core-group constraints.");
  }
  if (!unitPool || unitPool.courseOptions.length < 19) errors.push("CSM Physical Science must preserve its complete 18-unit core and supplemental pool.");
}

const computerScience = catalog.programs.find((program) => program.collegeCode === "CSM" && program.programCode === "computer-and-information-science-as");
if (!computerScience) errors.push("CSM Computer and Information Science AS is missing.");
else {
  const optionGroups = computerScience.requirementGroups.filter((requirement) => requirement.kind === "or_group");
  const cisSelective = computerScience.requirementGroups.find((requirement) => requirement.kind === "text_rule" && /CIS courses numbered 110 or higher/i.test(requirement.rawText ?? ""));
  if (optionGroups.length !== 2) errors.push("CSM Computer and Information Science must preserve both required OR course pairs.");
  if (!cisSelective || cisSelective.minUnits !== 4) errors.push("CSM Computer and Information Science must preserve its four-unit CIS 110+ selective.");
}

const preNursing = catalog.programs.find((program) => program.collegeCode === "CSM" && program.programCode === "biology-pre-nursing-as");
const preNursingPathway = preNursing?.requirementGroups.find((requirement) => /one of the following groups/i.test(requirement.rawText ?? ""));
if (!preNursingPathway || preNursingPathway.kind !== "text_rule" || preNursingPathway.courseOptions.length !== 4) {
  errors.push("CSM Biology Pre-Nursing must preserve both chemistry pathways without treating every course as required.");
}

const engineering = catalog.programs.find((program) => program.collegeCode === "CSM" && program.programCode === "engineering-as");
if (engineering?.requirementGroups[0]?.kind !== "choose_units" || engineering.requirementGroups[0]?.minUnits !== 7) {
  errors.push("CSM Engineering must treat its engineering-core table as a selection, not require every option.");
}

const skylineDance = catalog.programs.find((program) => program.collegeCode === "SKY" && program.programCode === "dance-aa");
if (skylineDance?.requirementGroups[0]?.kind !== "text_rule") {
  errors.push("Skyline Dance must keep its nested list and OR structure in manual review instead of flattening it.");
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
