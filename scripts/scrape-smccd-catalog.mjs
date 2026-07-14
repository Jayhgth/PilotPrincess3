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
  let groupedCore = null;
  let alternativePathway = null;
  $("table.smc-table-core-requirements").each((index, table) => {
    const header = $(table).find("thead th").first().text().replace(/\s+/g, " ").trim();
    if (/(?:not required|additional recommended)/i.test(header)) return;
    const rows = [];
    $(table).find("tbody tr").each((_, row) => {
      const cells = $(row).find("th, td");
      const courseText = cells.eq(0).text().replace(/\s+/g, " ").trim();
      const rowText = cells.map((__, cell) => $(cell).text().replace(/\s+/g, " ").trim()).get().filter(Boolean).join(" ");
      const unitsText = cells.last().text().replace(/\s+/g, " ").trim();
      const match = courseText.match(/^([A-Z]{2,5}\.?)\s+([A-Z]?\d{2,4}(?:\.\d)?[A-Z]?)$/i);
      if (match) rows.push({ type: "course", option: { courseCode: normalizeCourseId(`${match[1]} ${match[2]}`), unitsText, note: null } });
      else if (/^OR$/i.test(rowText)) rows.push({ type: "or" });
      else if (courseText) rows.push({ type: "text", text: courseText, unitsText });
    });
    const courseOptions = rows.filter((row) => row.type === "course").map((row) => row.option);
    const groupNumber = header.match(/\bGroup\s+(\d+)\b/i)?.[1] ?? null;
    if (/one of the following groups/i.test(header) && courseOptions.length > 0) {
      alternativePathway = {
        id: `${slug(header)}-${index}`,
        label: header.replace(/\s+Units$/i, ""),
        kind: "text_rule",
        minUnits: parseRequirementMinUnits(header),
        minCount: null,
        rawText: `${header} Group ${groupNumber ?? 1}: ${courseOptions.map((option) => option.courseCode).join(", ")}`,
        constraintOnly: false,
        courseOptions: courseOptions.map((option) => ({ ...option, note: `Alternative pathway group ${groupNumber ?? 1}` }))
      };
      tableGroups.push(alternativePathway);
      return;
    }
    if (groupNumber && alternativePathway && courseOptions.length > 0) {
      alternativePathway.rawText += ` Group ${groupNumber}: ${courseOptions.map((option) => option.courseCode).join(", ")}`;
      alternativePathway.courseOptions.push(...courseOptions.map((option) => ({ ...option, note: `Alternative pathway group ${groupNumber}` })));
      return;
    }
    const startsGroupedCore = /one or more courses selected from each group/i.test(header);
    if (startsGroupedCore) {
      groupedCore = { totalUnits: parseRequirementMinUnits(header), courseOptions: [] };
    }
    if ((startsGroupedCore || groupNumber) && groupedCore && courseOptions.length > 0) {
      groupedCore.courseOptions.push(...courseOptions);
      tableGroups.push({
        id: `required-core-group-${groupNumber ?? tableGroups.length + 1}-${index}`,
        label: `Required core: Group ${groupNumber ?? tableGroups.length + 1}`,
        kind: "or_group",
        minUnits: null,
        minCount: 1,
        rawText: header,
        constraintOnly: true,
        courseOptions
      });
      return;
    }
    if (groupedCore && /complete the required\s+\d+(?:\.\d+)?\s+units with courses selected from Groups/i.test(header)) {
      const combinedOptions = [...groupedCore.courseOptions, ...courseOptions]
        .filter((option, optionIndex, options) => options.findIndex((candidate) => candidate.courseCode === option.courseCode) === optionIndex);
      tableGroups.push({
        id: `required-core-unit-total-${index}`,
        label: `Required core unit total: ${groupedCore.totalUnits ?? parseRequirementMinUnits(header)} units`,
        kind: "choose_units",
        minUnits: groupedCore.totalUnits ?? parseRequirementMinUnits(header),
        minCount: null,
        rawText: header,
        constraintOnly: false,
        courseOptions: combinedOptions
      });
      groupedCore = null;
      return;
    }
    if (!/(core|selective|elective|courses|selection|complete|list\s+[a-z]|group\s+[a-z])/i.test(header)) return;

    const alternativeSets = [];
    const fixedOptions = [];
    for (let rowIndex = 0; rowIndex < rows.length;) {
      const row = rows[rowIndex];
      if (row.type !== "course") { rowIndex += 1; continue; }
      const alternatives = [row.option];
      while (rows[rowIndex + 1]?.type === "or" && rows[rowIndex + 2]?.type === "course") {
        alternatives.push(rows[rowIndex + 2].option);
        rowIndex += 2;
      }
      if (alternatives.length > 1) alternativeSets.push(alternatives);
      else fixedOptions.push(row.option);
      rowIndex += 1;
    }
    const freeTextRows = rows.filter((row) => row.type === "text");
    const headerMinUnits = parseRequirementMinUnits(header);
    const complexText = [header, ...freeTextRows.map((row) => row.text)].join(" ");
    if (courseOptions.length > 0 && (/(?:any .*list|not already (?:used|chosen)|famil(?:y|ies))/i.test(complexText) || (alternativeSets.length > 1 && freeTextRows.length > 0))) {
      tableGroups.push({
        id: `${slug(header)}-manual-${index}`,
        label: header.replace(/\s+Units$/i, ""),
        kind: "text_rule",
        minUnits: headerMinUnits,
        minCount: null,
        rawText: complexText,
        constraintOnly: false,
        courseOptions
      });
      return;
    }
    if (alternativeSets.length > 0 && /^Required Core/i.test(header)) {
      alternativeSets.forEach((options, alternativeIndex) => tableGroups.push({
        id: `${slug(header)}-option-${alternativeIndex + 1}-${index}`,
        label: `${header.replace(/\s+Units$/i, "")}: option ${alternativeIndex + 1}`,
        kind: "or_group",
        minUnits: null,
        minCount: 1,
        rawText: header,
        constraintOnly: false,
        courseOptions: options
      }));
      if (fixedOptions.length > 0) tableGroups.push({
        id: `${slug(header)}-fixed-${index}`,
        label: `${header.replace(/\s+Units$/i, "")}: remaining required courses`,
        kind: "all",
        minUnits: fixedOptions.reduce((sum, option) => sum + (parseUnitsText(option.unitsText)?.unitsMin ?? 0), 0),
        minCount: null,
        rawText: header,
        constraintOnly: false,
        courseOptions: fixedOptions
      });
      return;
    }
    if (courseOptions.length > 0) {
      const explicitlySelects = /(selective|elective|choose|\bselect\b|selection|minimum|at least)/i.test(header);
      const isSelection = explicitlySelects || (
        /(from the following|or more units|complete\s+\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?\s+units?\s+from)/i.test(header)
        && !/^(?:complete\s+)?(?:required\s+)?core/i.test(header)
      );
      tableGroups.push({
        id: `${slug(header)}-${index}`,
        label: header.replace(/\s+Units$/i, ""),
        kind: isSelection ? (headerMinUnits === null ? "text_rule" : "choose_units") : "all",
        minUnits: headerMinUnits,
        minCount: null,
        rawText: isSelection && headerMinUnits === null ? header : null,
        constraintOnly: false,
        courseOptions
      });
    } else if (freeTextRows.length > 0) {
      const rawText = freeTextRows.map((row) => row.text).join(" ");
      tableGroups.push({
        id: `${slug(header)}-${index}`,
        label: header.replace(/\s+Units$/i, ""),
        kind: "text_rule",
        minUnits: headerMinUnits ?? parseRequirementMinUnits(rawText),
        minCount: null,
        rawText,
        constraintOnly: false,
        courseOptions: []
      });
    }
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
