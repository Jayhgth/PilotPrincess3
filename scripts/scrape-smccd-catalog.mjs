import { writeFile } from "node:fs/promises";
import * as cheerio from "cheerio";

const CATALOG_YEAR = "2025-2026";
const COLLEGES = [
  {
    code: "CSM",
    name: "College of San Mateo",
    baseUrl: "https://catalog.collegeofsanmateo.edu",
    coursesUrl: "https://catalog.collegeofsanmateo.edu/current/courses/",
    programsUrl: "https://catalog.collegeofsanmateo.edu/current/programs/"
  },
  {
    code: "SKY",
    name: "Skyline College",
    baseUrl: "https://catalog.skylinecollege.edu",
    coursesUrl: "https://catalog.skylinecollege.edu/current/courses/",
    programsUrl: "https://catalog.skylinecollege.edu/current/programs/"
  },
  {
    code: "CAN",
    name: "Cañada College",
    baseUrl: "https://catalog.canadacollege.edu",
    coursesUrl: "https://catalog.canadacollege.edu/current/courses/",
    programsUrl: "https://catalog.canadacollege.edu/current/programs/"
  }
];

const DOTTED_SUBJECTS = new Set(["BUS", "EMC", "LIT", "MUS", "P.E", "RE", "BCM", "ECE", "HTM"]);

async function main() {
  const catalogParts = await Promise.all(COLLEGES.map(scrapeCollege));
  const catalog = {
    catalogYear: CATALOG_YEAR,
    generatedAt: new Date().toISOString(),
    sources: COLLEGES.map(({ code, name, coursesUrl, programsUrl }) => ({ code, name, coursesUrl, programsUrl })),
    courses: catalogParts.flatMap((part) => part.courses),
    programs: catalogParts.flatMap((part) => part.programs)
  };

  await writeFile("supabase/catalog/smccd-2025-2026.json", `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Wrote ${catalog.courses.length} courses and ${catalog.programs.length} AA/AS programs across ${COLLEGES.length} colleges.`);
}

async function scrapeCollege(college) {
  const [courses, programs] = await Promise.all([scrapeCourses(college), scrapePrograms(college)]);
  console.log(`${college.code}: ${courses.length} courses, ${programs.length} AA/AS programs`);
  return { courses, programs };
}

async function scrapeCourses(college) {
  const indexHtml = await fetchText(college.coursesUrl);
  const $ = cheerio.load(indexHtml);
  const subjectUrls = new Set();
  $("a[href]").each((_, element) => {
    const text = $(element).text().replace(/\s+/g, " ").trim();
    const href = $(element).attr("href");
    if (!href || !/\([A-Z.]{2,6}\)$/.test(text)) return;
    const url = new URL(href, college.coursesUrl).toString();
    if (new URL(url).pathname.includes("/current/courses/") && url.endsWith("/")) subjectUrls.add(url);
  });

  const pages = await mapWithConcurrency([...subjectUrls], 8, async (url) => ({ url, html: await fetchText(url) }));
  const courses = new Map();
  for (const page of pages) {
    const subject$ = cheerio.load(page.html);
    subject$("table.smc-catalog-course-listings tbody tr").each((_, row) => {
      const cells = subject$(row).find("td");
      const courseText = cells.eq(0).text().replace(/\s+/g, " ").trim();
      const title = cells.eq(1).text().replace(/\s+/g, " ").trim();
      const unitsText = cells.eq(2).text().replace(/\s+/g, " ").trim();
      const transferText = cells.eq(3).text().replace(/\s+/g, " ").trim();
      const rowText = subject$(row).text().replace(/\s+/g, " ").trim();
      const match = courseText.match(/^([A-Z]{2,5}\.?)\s+([A-Z]?\d{2,4}(?:\.\d)?[A-Z]?)$/i);
      const unitRange = parseUnitsText(unitsText);
      if (!match || !unitRange || !title) return;
      const courseCode = normalizeCourseId(`${match[1]} ${match[2]}`);
      const courseHref = cells.eq(1).find("a[href]").attr("href");
      const numericCourseNumber = Number(match[2].match(/\d{2,4}/)?.[0] ?? 0);
      courses.set(courseCode, {
        collegeCode: college.code,
        courseCode,
        subject: courseCode.split(" ")[0],
        number: courseCode.split(" ").slice(1).join(" "),
        title,
        unitsMin: unitRange.unitsMin,
        unitsMax: unitRange.unitsMax ?? null,
        degreeApplicable: numericCourseNumber > 0 && numericCourseNumber < 800,
        transferCredit: parseTransferCredit(transferText),
        attributes: attributesFromText(rowText),
        catalogUrl: new URL(courseHref ?? `${courseCode.toLowerCase().replace(/\./g, "").replace(/\s+/g, "-")}.php`, page.url).toString()
      });
    });
  }
  const summaries = [...courses.values()].sort((a, b) => a.courseCode.localeCompare(b.courseCode));
  return mapWithConcurrency(summaries, 12, async (course) => {
    try {
      const detailHtml = await fetchText(course.catalogUrl);
      return enrichCourseFromDetail(course, detailHtml);
    } catch (error) {
      console.warn(`Could not read course detail ${course.catalogUrl}: ${error instanceof Error ? error.message : String(error)}`);
      return {
        ...course,
        prerequisites: [],
        corequisites: [],
        recommendedPreparation: [],
        detailStatus: "unavailable",
        degreeApplicabilitySource: "number_heuristic"
      };
    }
  });
}

function enrichCourseFromDetail(course, html) {
  const $ = cheerio.load(html);
  const prerequisites = labeledRequirement($, "Prerequisites");
  const corequisites = labeledRequirement($, "Corequisites");
  const recommendedPreparation = labeledRequirement($, "Recommended");
  const creditLabel = ownTextValues($).find((value) => /^(?:Non-|Not )?Degree Credit$/i.test(value));
  const exactDegreeApplicable = creditLabel
    ? !/^(?:Non-|Not )Degree Credit$/i.test(creditLabel)
    : null;
  const detailText = $("body").text().replace(/\s+/g, " ").trim();
  const detailAttributes = attributesFromText(detailText);
  const hasRequirementLabels = prerequisites.found || corequisites.found;

  return {
    ...course,
    degreeApplicable: exactDegreeApplicable ?? course.degreeApplicable,
    transferCredit: parseTransferCredit(detailText) ?? course.transferCredit,
    attributes: [...new Set([...course.attributes, ...detailAttributes])],
    prerequisites: prerequisites.values,
    corequisites: corequisites.values,
    recommendedPreparation: recommendedPreparation.values,
    detailStatus: exactDegreeApplicable !== null && hasRequirementLabels ? "verified" : "partial",
    degreeApplicabilitySource: exactDegreeApplicable !== null ? "course_detail" : "number_heuristic"
  };
}

function labeledRequirement($, label) {
  const labelPattern = new RegExp(`^${label}:?$`, "i");
  const node = $("strong, b").filter((_, element) => labelPattern.test($(element).text().replace(/\s+/g, " ").trim())).first();
  if (node.length === 0) return { found: false, values: [] };
  const parentText = node.parent().text().replace(/\s+/g, " ").trim();
  const value = parentText.replace(new RegExp(`^${label}:?\\s*`, "i"), "").trim();
  return {
    found: true,
    values: !value || /^none\.?$/i.test(value) ? [] : [value]
  };
}

function ownTextValues($) {
  const values = [];
  $("body *").each((_, element) => {
    const ownText = $(element).clone().children().remove().end().text().replace(/\s+/g, " ").trim();
    if (ownText) values.push(ownText);
  });
  return values;
}

async function scrapePrograms(college) {
  const indexHtml = await fetchText(college.programsUrl);
  const $ = cheerio.load(indexHtml);
  const summaries = new Map();
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href || !href.endsWith(".php")) return;
    const url = new URL(href, college.programsUrl).toString();
    if (!new URL(url).pathname.includes("/current/programs/")) return;
    const id = url.split("/").pop().replace(".php", "");
    if (/-aa-t$|-as-t$/i.test(id)) return;
    const awardType = /-aa$/i.test(id) ? "AA" : /-as$/i.test(id) ? "AS" : null;
    if (!awardType) return;
    const context = $(element).closest("tr, li, div").text().replace(/\s+/g, " ");
    if (!/Associate in (Arts|Science) Degree Program/i.test(context) && !/(^|-)(aa|as)$/i.test(id)) return;
    summaries.set(id, { id, awardType, url, fallbackTitle: $(element).text().replace(/\s+/g, " ").trim() });
  });

  const programs = await mapWithConcurrency([...summaries.values()], 8, async (summary) => {
    const html = await fetchText(summary.url);
    const page$ = cheerio.load(html);
    const pageTitle = page$("h1").first().text().replace(/\s+/g, " ").trim();
    const bodyText = page$("body").text().replace(/\r/g, "\n");
    const totalMajorUnitsText = bodyText.match(/Total Required Major Units:\s*([0-9.\s-]+)/i)?.[1]?.trim() ?? "";
    const requirementGroups = parseRequirementGroups(page$, bodyText);
    if (requirementGroups.length === 0) return null;
    return {
      collegeCode: college.code,
      programCode: summary.id,
      title: pageTitle.replace(/Associate in (Arts|Science) Degree Program/i, "").trim() || summary.fallbackTitle,
      awardType: summary.awardType,
      totalDegreeUnitsRequired: 60,
      totalMajorUnitsText,
      requirementGroups,
      catalogUrl: summary.url
    };
  });
  return programs.filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
}

function parseRequirementGroups($, text) {
  const tableGroups = [];
  $("table.smc-table-core-requirements").each((index, table) => {
    const header = $(table).find("thead th").first().text().replace(/\s+/g, " ").trim();
    if (!/(core|selective|elective|courses)/i.test(header)) return;
    const isSelection = /(selective|elective|choose|minimum)/i.test(header) && !/^complete core/i.test(header);
    const group = {
      id: `${slug(header)}-${index}`,
      label: header,
      kind: isSelection ? "choose_units" : "all",
      minUnits: parseRequirementMinUnits(header),
      minCount: null,
      rawText: null,
      courseOptions: []
    };
    $(table).find("tbody tr").each((_, row) => {
      const cells = $(row).find("td");
      const courseText = cells.eq(0).text().replace(/\s+/g, " ").trim();
      const unitsText = cells.eq(2).text().replace(/\s+/g, " ").trim();
      const match = courseText.match(/^([A-Z]{2,5}\.?)\s+([A-Z]?\d{2,4}(?:\.\d)?[A-Z]?)$/i);
      if (match) group.courseOptions.push({ courseCode: normalizeCourseId(`${match[1]} ${match[2]}`), unitsText, note: null });
    });
    if (group.courseOptions.length > 0) tableGroups.push(group);
  });
  if (tableGroups.length > 0) return tableGroups;

  const groups = [];
  const lines = text.split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  let current = null;
  for (const line of lines) {
    if (/^Required (Core|Selective) Courses?:/i.test(line)) {
      if (current) groups.push(current);
      current = {
        id: `${slug(line)}-${groups.length}`,
        label: line.replace(/\s+Units$/i, ""),
        kind: /^Required Selective/i.test(line) ? "choose_units" : "all",
        minUnits: parseRequirementMinUnits(line),
        minCount: null,
        rawText: null,
        courseOptions: []
      };
      continue;
    }
    if (!current || /^Total Required Major Units:/i.test(line) || /^(OR|AND)$/i.test(line)) continue;
    const match = line.match(/^([A-Z]{2,5}\.?)\s+([A-Z]?\d{2,4}(?:\.\d)?[A-Z]?)\s+.+?\s+(\d+(?:\.\d)?(?:\s*-\s*\d+(?:\.\d)?)?\s*units)$/i);
    if (match) current.courseOptions.push({ courseCode: normalizeCourseId(`${match[1]} ${match[2]}`), unitsText: match[3], note: null });
    else if (/minimum|any other|select/i.test(line) && current.courseOptions.length === 0) {
      current.kind = "text_rule";
      current.rawText = line;
    }
  }
  if (current) groups.push(current);
  return groups;
}

function normalizeCourseId(input) {
  const cleaned = input.trim().toUpperCase().replace(/\s+/g, " ").replace(/^([A-Z]{2,5})\s*\.\s*/, "$1. ");
  const match = cleaned.match(/^([A-Z]{2,5}|P\.E\.|R\.E\.)(\.?)\s*([A-Z]?\d{1,4}(?:\.\d)?[A-Z]?)$/);
  if (!match) return cleaned;
  const rawSubject = match[1].replace(/\.$/, "");
  const subject = DOTTED_SUBJECTS.has(rawSubject) ? `${rawSubject}.` : rawSubject;
  return `${subject} ${match[3]}`;
}

function parseUnitsText(value) {
  const match = value.match(/(\d+(?:\.\d+)?)(?:\s*(?:-|or)\s*(\d+(?:\.\d+)?))?/i);
  return match ? { unitsMin: Number(match[1]), unitsMax: match[2] ? Number(match[2]) : undefined } : null;
}

function parseTransferCredit(value) {
  const normalized = value.toUpperCase().replace(/\s+/g, " ");
  const hasCsu = /\bCSU\b/.test(normalized);
  const hasUc = /\bUC\b/.test(normalized);
  return hasCsu && hasUc ? "CSU/UC" : hasCsu ? "CSU" : hasUc ? "UC" : null;
}

function attributesFromText(value) {
  const attributes = [];
  for (const match of value.matchAll(/(?:AA\/AS Degree Requirements?|Cal-GETC)[:\s]+(?:Area\s*)?([0-9][A-B]?)/gi)) {
    attributes.push(match[0].replace(/\s+/g, " ").trim());
  }
  return [...new Set(attributes)];
}

function parseRequirementMinUnits(value) {
  const match = value.match(/(\d+(?:\.\d+)?)(?:\s*(?:-|or)\s*(?:more\s*)?(?:\d+(?:\.\d+)?)?)?\s*units?\b/i);
  return match ? Number(match[1]) : null;
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { "user-agent": "Pilot Princess SMCCD catalog importer" } });
  if (!response.ok) throw new Error(`Failed ${response.status} ${url}`);
  return response.text();
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }));
  return results;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
