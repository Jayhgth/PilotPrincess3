import { readFile, writeFile } from "node:fs/promises";
import * as cheerio from "cheerio";
import { PDFParse } from "pdf-parse";

const SOURCE_YEAR = "2025-2026";
const OUTPUT = "supabase/catalog/smccd-local-ge-2025-2026.json";
const CATALOG = "supabase/catalog/smccd-2025-2026.json";
const sources = {
  CSM: "https://collegeofsanmateo.edu/forms/docs/counseling/AAAS_DegreeWorksheet_25-26.pdf",
  CAN: "https://catalog.canadacollege.edu/current/ge-worksheets/_docs/aa-as-req.pdf",
  SKY: "https://catalog.skylinecollege.edu/current/generaldegreerequirements/associatestable.php"
};
const reciprocitySource = "https://catalog.skylinecollege.edu/current/generaldegreerequirements/transferrequirements.php";

const catalog = JSON.parse(await readFile(CATALOG, "utf8"));
const inventories = new Map(["CSM", "SKY", "CAN"].map((collegeCode) => [
  collegeCode,
  new Map(catalog.courses
    .filter((course) => course.collegeCode === collegeCode)
    .map((course) => [normalizeCode(course.courseCode), course.courseCode]))
]));

const [csmText, canText, skyText] = await Promise.all([
  pdfText(sources.CSM),
  pdfText(sources.CAN),
  htmlText(sources.SKY)
]);

const rosters = {
  CSM: parseRoster(csmText, "CSM", {
    "1A": ["AREA 1A", "AREA 1B"],
    "1B": ["AREA 1B", "AREA 2"],
    "2": ["AREA 2", "AREA 3"],
    "3": ["AREA 3", "AREA 4"],
    "4": ["AREA 4", "AREA 5"],
    "5": ["AREA 5", "AREA 6"],
    "6": ["AREA 6", "AREA 7"],
    "7A": ["7A Wellness and Kinesiology Activity courses", "Area 7A is waived"],
    "7B": ["7B Personal Development courses", "AREA 8"],
    "8": ["AREA 8", "UNIT DEFICIENCY"]
  }),
  CAN: parseRoster(canText, "CAN", {
    "1A": ["AREA 1A", "AREA 1B"],
    "1B": ["AREA 1B", "AREA 2"],
    "2": ["AREA 2", "AREA 3"],
    "3": ["AREA 3", "AREA 4"],
    "4": ["AREA 4", "AREA 5"],
    "5": ["AREA 5", "AREA 6"],
    "6": ["AREA 6", "AREA 7"],
    "7A": ["7A-Physical Education Activity Courses", "7B-Personal and Academic Development"],
    "7B": ["7B-Personal and Academic Development", "Area 7 Exemptions"]
  }),
  SKY: parseRoster(skyText, "SKY", {
    "1A": ["1A - English Composition:", "1B - Oral Communication"],
    "1B": ["1B - Oral Communication", "Area 2 - Mathematical Concepts"],
    "2": ["Area 2 - Mathematical Concepts", "Area 3 - Arts and Humanities"],
    "3": ["Area 3 - Arts and Humanities", "Area 4 - Social and Behavioral Sciences"],
    "4": ["Area 4 - Social and Behavioral Sciences", "Area 5 - Natural Sciences"],
    "5": ["Area 5 - Natural Sciences", "Area 6 - Ethnic Studies"],
    "6": ["Area 6 - Ethnic Studies", "Area 7"],
    "7A": ["7A - Kinesiology Activity", "7B - Personal Development and Wellness"],
    "7B": ["7B - Personal Development and Wellness", "Area 7 Exemptions"],
    "8": ["US-1 (American History):", "5. MAJOR REQUIREMENT"]
  })
};

rosters.CAN["5"].labCourseCodes = [
  "CHEM 114", "CHEM 192", "CHEM 210", "CHEM 220", "CHEM 231", "CHEM 232", "CHEM 410", "GEOL 121",
  "PHYS 114", "PHYS 210", "PHYS 220", "PHYS 250", "PHYS 260", "PHYS 270", "BIOL 110", "BIOL 225",
  "BIOL 230", "BIOL 240", "BIOL 250", "BIOL 260", "ANTH 126", "ASTR 101", "BIOL 132", "ENVS 101",
  "GEOG 101", "GEOL 101", "OCEN 101"
].filter((code) => inventories.get("CAN").has(normalizeCode(code)));

const output = {
  sourceYear: SOURCE_YEAR,
  reciprocitySource,
  colleges: Object.fromEntries(Object.entries(rosters).map(([collegeCode, areas]) => [collegeCode, {
    sourceUrl: sources[collegeCode],
    areas
  }]))
};

await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${OUTPUT}: ${Object.entries(rosters).map(([college, areas]) => `${college} ${Object.values(areas).reduce((sum, area) => sum + area.courseCodes.length, 0)} area placements`).join(", ")}.`);

async function pdfText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed ${response.status} ${url}`);
  const parser = new PDFParse({ data: Buffer.from(await response.arrayBuffer()) });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

async function htmlText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed ${response.status} ${url}`);
  return cheerio.load(await response.text())("body").text().replace(/\s+/g, " ");
}

function parseRoster(text, collegeCode, markers) {
  return Object.fromEntries(Object.entries(markers).map(([area, [start, end]]) => {
    const startIndex = text.indexOf(start);
    const endIndex = text.indexOf(end, startIndex + start.length);
    if (startIndex < 0 || endIndex < 0) throw new Error(`${collegeCode} Area ${area} markers were not found.`);
    const segment = text.slice(startIndex, endIndex)
      .replace(/\(formerly[^)]*\)/gi, " ")
      .replace(/1\s+1\s+7\.1-117\.4/g, "117.1-117.4");
    return [area, { courseCodes: extractCourseCodes(segment, inventories.get(collegeCode)) }];
  }));
}

function extractCourseCodes(segment, inventory) {
  const subjects = new Set([...inventory.keys()].map((code) => code.split(" ")[0].replace(/\.$/, "")));
  const found = new Set();
  let subject = null;
  const tokens = segment
    .replace(/([A-Z]{2,5}\.)(?=[A-Z]?\d)/g, "$1 ")
    .replace(/[;,]/g, " ")
    .split(/\s+/);

  for (let token of tokens) {
    token = token.replace(/^[^A-Z0-9]+|[^A-Z0-9.\-]+$/gi, "");
    const candidateSubject = token.toUpperCase().replace(/\.$/, "");
    if (subjects.has(candidateSubject)) {
      subject = candidateSubject;
      continue;
    }
    if (!subject || !/^[A-Z]?\d{2,4}(?:\.\d)?[A-Z]?(?:-[A-Z]?\d{2,4}(?:\.\d)?[A-Z]?)?$/.test(token)) continue;
    for (const number of expandNumber(token.toUpperCase())) {
      const candidates = [`${subject} ${number}`, `${subject}. ${number}`].map(normalizeCode);
      const matched = candidates.map((code) => inventory.get(code)).find(Boolean);
      if (matched) found.add(matched);
    }
  }
  if (/any VARSITY activity course/i.test(segment)) {
    for (const [normalized, code] of inventory) if (normalized.startsWith("VARS ")) found.add(code);
  }
  return [...found].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function expandNumber(value) {
  const match = value.match(/^(\d+)\.(\d+)-(?:\d+)\.(\d+)$/);
  if (!match) return [value];
  const [, base, first, last] = match;
  return Array.from({ length: Number(last) - Number(first) + 1 }, (_, index) => `${base}.${Number(first) + index}`);
}

function normalizeCode(value) {
  return value.trim().toUpperCase().replace(/\s+/g, " ").replace(/^([A-Z]{2,5})\.\s*/, "$1 ");
}
