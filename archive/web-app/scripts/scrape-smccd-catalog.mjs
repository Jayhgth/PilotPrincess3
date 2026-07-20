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
      const match = courseText.match(/^([A-Z]{2,5}\.?|P\.E\.|R\.E\.)\s+([A-Z]?\d{2,4}(?:\.\d)?[A-Z]?)$/i);
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
    const parsedRequirements = parseRequirementGroups(page$, bodyText, {
      programCode: summary.id,
      totalMajorUnitsText
    });
    const requirementGroups = parsedRequirements.groups;
    if (requirementGroups.length === 0) return null;
    return {
      collegeCode: college.code,
      programCode: summary.id,
      title: pageTitle.replace(/Associate in (Arts|Science) Degree Program/i, "").trim() || summary.fallbackTitle,
      awardType: summary.awardType,
      totalDegreeUnitsRequired: 60,
      totalMajorUnitsText,
      requirementGroups,
      requirementAudit: parsedRequirements.audit,
      catalogUrl: summary.url
    };
  });
  return programs.filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
}

function parseRequirementGroups($, text, { programCode, totalMajorUnitsText }) {
  const tableGroups = [];
  const sourceTables = [];
  const ignoredTableIndexes = new Set();
  const representedTableIndexes = new Set();
  let groupedCore = null;
  let alternativePathway = null;
  let pendingSelection = null;
  let recommendedSection = false;
  const pathwayTables = [];
  const nativeSpeakerTables = [];
  const addGroup = (group, sourceIndexes) => {
    for (const sourceIndex of sourceIndexes) representedTableIndexes.add(sourceIndex);
    tableGroups.push(group);
    return group;
  };

  $("table.smc-table-core-requirements").each((index, table) => {
    const header = $(table).find("thead th").first().text().replace(/\s+/g, " ").trim();
    const rows = [];
    $(table).find("tbody tr").each((_, row) => {
      const cells = $(row).find("th, td");
      const courseText = cells.eq(0).text().replace(/\s+/g, " ").trim();
      const rowText = cells.map((__, cell) => $(cell).text().replace(/\s+/g, " ").trim()).get().filter(Boolean).join(" ");
      const unitsText = cells.last().text().replace(/\s+/g, " ").trim();
      const match = courseText.match(/^([A-Z]{2,5}\.?|P\.E\.|R\.E\.)\s+([A-Z]?\d{2,4}(?:\.\d)?[A-Z]?)$/i);
      if (match) rows.push({ type: "course", option: { courseCode: normalizeCourseId(`${match[1]} ${match[2]}`), unitsText, note: null } });
      else if (/^OR$/i.test(rowText)) rows.push({ type: "or" });
      else if (courseText) rows.push({ type: "text", text: courseText, unitsText });
    });
    const courseOptions = rows.filter((row) => row.type === "course").map((row) => row.option);
    const freeTextRows = rows.filter((row) => row.type === "text");
    sourceTables.push({ index, header, courseOptions, freeTextRows });

    if (!header && courseOptions.length === 0 && freeTextRows.length === 0) {
      ignoredTableIndexes.add(index);
      return;
    }

    if (/(?:not required|additional recommended|recommended (?:additional courses|electives)|students can earn hours by taking)/i.test(header)) {
      ignoredTableIndexes.add(index);
      recommendedSection = /recommended/i.test(header);
      pendingSelection = null;
      return;
    }
    const isBareContinuation = !/(?:required|select|choose|plus|complete|core|major requirements?|list\s+[a-z]|one of the following groups)/i.test(header);
    if (recommendedSection && !/(?:required|complete|major requirements?)/i.test(header)) {
      ignoredTableIndexes.add(index);
      return;
    }
    recommendedSection = false;

    if (/Pathway:/i.test(header) && /choose one of the following pathways/i.test(text)) {
      pathwayTables.push({ index, header, courseOptions, freeTextRows });
      representedTableIndexes.add(index);
      return;
    }
    if (/For (?:non-)?native speakers of Spanish/i.test(header)) {
      nativeSpeakerTables.push({ index, header, courseOptions });
      representedTableIndexes.add(index);
      return;
    }

    if (pathwayTables.length > 0 || nativeSpeakerTables.length > 0) pendingSelection = null;
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
      addGroup(alternativePathway, [index]);
      return;
    }
    if (groupNumber && alternativePathway && courseOptions.length > 0) {
      alternativePathway.rawText += ` Group ${groupNumber}: ${courseOptions.map((option) => option.courseCode).join(", ")}`;
      alternativePathway.courseOptions.push(...courseOptions.map((option) => ({ ...option, note: `Alternative pathway group ${groupNumber}` })));
      representedTableIndexes.add(index);
      return;
    }
    const startsGroupedCore = /one or more courses selected from each group/i.test(header);
    if (startsGroupedCore) {
      groupedCore = { totalUnits: parseRequirementMinUnits(header), courseOptions: [] };
    }
    if ((startsGroupedCore || groupNumber) && groupedCore && courseOptions.length > 0) {
      groupedCore.courseOptions.push(...courseOptions);
      addGroup({
        id: `required-core-group-${groupNumber ?? tableGroups.length + 1}-${index}`,
        label: `Required core: Group ${groupNumber ?? tableGroups.length + 1}`,
        kind: "or_group",
        minUnits: null,
        minCount: 1,
        rawText: header,
        constraintOnly: true,
        courseOptions
      }, [index]);
      return;
    }
    if (groupedCore && /complete the required\s+\d+(?:\.\d+)?\s+units with courses selected from Groups/i.test(header)) {
      const combinedOptions = [...groupedCore.courseOptions, ...courseOptions]
        .filter((option, optionIndex, options) => options.findIndex((candidate) => candidate.courseCode === option.courseCode) === optionIndex);
      addGroup({
        id: `required-core-unit-total-${index}`,
        label: `Required core unit total: ${groupedCore.totalUnits ?? parseRequirementMinUnits(header)} units`,
        kind: "choose_units",
        minUnits: groupedCore.totalUnits ?? parseRequirementMinUnits(header),
        minCount: null,
        rawText: header,
        constraintOnly: false,
        courseOptions: combinedOptions
      }, [index]);
      groupedCore = null;
      return;
    }

    const headerMinUnits = parseRequirementMinUnits(header);
    const headerMinCount = parseRequirementMinCount(header);
    const startsSelection = /(?:select|choose|plus a minimum|one of the following)/i.test(header);
    if (courseOptions.length === 0 && startsSelection) {
      pendingSelection = addGroup({
        id: `${slug(header || `selection-${index}`)}-${index}`,
        label: header.replace(/\s+Units$/i, ""),
        kind: freeTextRows.length > 0 ? "text_rule" : headerMinUnits !== null ? "choose_units" : headerMinCount !== null ? "choose_count" : "text_rule",
        minUnits: headerMinUnits,
        minCount: headerMinCount,
        rawText: [header, ...freeTextRows.map((row) => row.text)].filter(Boolean).join(" ") || null,
        constraintOnly: false,
        courseOptions: []
      }, [index]);
      return;
    }

    if (courseOptions.length > 0 && pendingSelection && isBareContinuation) {
      pendingSelection.courseOptions.push(...courseOptions);
      pendingSelection.rawText = [pendingSelection.rawText, header, ...freeTextRows.map((row) => row.text)].filter(Boolean).join(" ");
      representedTableIndexes.add(index);
      return;
    }

    const movementSelection = text.match(/Movement Based Courses:\s*Select\s+(\d+(?:\.\d+)?)\s+units[^\n]*/i)?.[0] ?? null;
    if (courseOptions.length > 0 && /^Area\s+1:/i.test(header) && movementSelection) {
      pendingSelection = addGroup({
        id: `movement-based-courses-${index}`,
        label: movementSelection,
        kind: "choose_units",
        minUnits: parseRequirementMinUnits(movementSelection),
        minCount: null,
        rawText: header,
        constraintOnly: false,
        courseOptions: [...courseOptions]
      }, [index]);
      return;
    }

    const priorGroup = tableGroups.at(-1);
    if (courseOptions.length > 0 && isBareContinuation && priorGroup && (
      !header
      || /(?:semester|drawing|painting|ceramics|sculpture|digital art|photography|area\s+\d+)/i.test(header)
    )) {
      priorGroup.courseOptions.push(...courseOptions);
      priorGroup.rawText = [priorGroup.rawText, header, ...freeTextRows.map((row) => row.text)].filter(Boolean).join(" ");
      representedTableIndexes.add(index);
      return;
    }

    pendingSelection = null;

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
    const complexText = [header, ...freeTextRows.map((row) => row.text)].join(" ");
    const explicitlySelects = /(selective|elective|choose|\bselect\b|selection|minimum|at least)/i.test(header);
    const isSelection = explicitlySelects || (
      /(from the following|or more units|complete\s+\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?\s+units?\s+from)/i.test(header)
      && !/^(?:complete\s+)?(?:required\s+)?core/i.test(header)
    );

    if (courseOptions.length > 0 && isSelection && !/(?:any .*list|not already (?:used|chosen)|famil(?:y|ies))/i.test(complexText)) {
      addGroup({
        id: `${slug(header)}-${index}`,
        label: header.replace(/\s+Units$/i, ""),
        kind: headerMinUnits !== null ? "choose_units" : headerMinCount !== null ? "choose_count" : "text_rule",
        minUnits: headerMinUnits,
        minCount: headerMinCount,
        rawText: freeTextRows.length > 0 ? complexText : null,
        constraintOnly: false,
        courseOptions
      }, [index]);
      return;
    }

    if (courseOptions.length > 0 && (/(?:any .*list|not already (?:used|chosen)|famil(?:y|ies))/i.test(complexText) || (alternativeSets.length > 1 && freeTextRows.length > 0))) {
      addGroup({
        id: `${slug(header)}-manual-${index}`,
        label: header.replace(/\s+Units$/i, ""),
        kind: "text_rule",
        minUnits: headerMinUnits,
        minCount: null,
        rawText: complexText,
        constraintOnly: false,
        courseOptions
      }, [index]);
      return;
    }
    if (alternativeSets.length > 0 && /^Required Core/i.test(header)) {
      alternativeSets.forEach((options, alternativeIndex) => addGroup({
        id: `${slug(header)}-option-${alternativeIndex + 1}-${index}`,
        label: `${header.replace(/\s+Units$/i, "")}: option ${alternativeIndex + 1}`,
        kind: "or_group",
        minUnits: null,
        minCount: 1,
        rawText: header,
        constraintOnly: false,
        courseOptions: options
      }, [index]));
      if (fixedOptions.length > 0) addGroup({
        id: `${slug(header)}-fixed-${index}`,
        label: `${header.replace(/\s+Units$/i, "")}: remaining required courses`,
        kind: "all",
        minUnits: fixedOptions.reduce((sum, option) => sum + (parseUnitsText(option.unitsText)?.unitsMin ?? 0), 0),
        minCount: null,
        rawText: header,
        constraintOnly: false,
        courseOptions: fixedOptions
      }, [index]);
      return;
    }
    if (courseOptions.length > 0) {
      addGroup({
        id: `${slug(header)}-${index}`,
        label: header.replace(/\s+Units$/i, ""),
        kind: "all",
        minUnits: headerMinUnits,
        minCount: null,
        rawText: freeTextRows.length > 0 ? complexText : null,
        constraintOnly: false,
        courseOptions
      }, [index]);
    } else if (freeTextRows.length > 0) {
      const rawText = freeTextRows.map((row) => row.text).join(" ");
      addGroup({
        id: `${slug(header)}-${index}`,
        label: header.replace(/\s+Units$/i, ""),
        kind: "text_rule",
        minUnits: headerMinUnits ?? parseRequirementMinUnits(rawText),
        minCount: null,
        rawText,
        constraintOnly: false,
        courseOptions: []
      }, [index]);
    }
  });

  if (pathwayTables.length > 0) {
    const minUnits = Math.min(...pathwayTables.map((table) => parseRequirementMinUnits(table.header)).filter((units) => units !== null));
    addGroup({
      id: "choose-one-official-pathway",
      label: "Required Selective Courses: choose one official pathway",
      kind: "text_rule",
      minUnits: Number.isFinite(minUnits) ? minUnits : null,
      minCount: null,
      rawText: pathwayTables.map((table) => `${table.header}: ${table.courseOptions.map((option) => option.courseCode).join(", ")}`).join(" "),
      constraintOnly: false,
      courseOptions: uniqueCourseOptions(pathwayTables.flatMap((table) => table.courseOptions))
    }, pathwayTables.map((table) => table.index));
  }

  if (nativeSpeakerTables.length > 0) {
    const minUnits = Math.min(...nativeSpeakerTables.map((table) => parseRequirementMinUnits(table.header)).filter((units) => units !== null));
    addGroup({
      id: "native-or-non-native-core-pathway",
      label: "Complete the native-speaker or non-native-speaker core pathway",
      kind: "text_rule",
      minUnits: Number.isFinite(minUnits) ? minUnits : null,
      minCount: null,
      rawText: nativeSpeakerTables.map((table) => `${table.header}: ${table.courseOptions.map((option) => option.courseCode).join(", ")}`).join(" "),
      constraintOnly: false,
      courseOptions: uniqueCourseOptions(nativeSpeakerTables.flatMap((table) => table.courseOptions))
    }, nativeSpeakerTables.map((table) => table.index));
  }

  if (programCode === "interdisciplinary-studies-letters-and-science-aa") {
    const andGroup = tableGroups.find((group) => /^AND choose/i.test(group.label));
    const orGroup = tableGroups.find((group) => /^OR choose/i.test(group.label));
    if (andGroup && orGroup) {
      const firstIndex = tableGroups.indexOf(andGroup);
      tableGroups.splice(firstIndex, 1, {
        id: "letters-or-science-selection",
        label: "Choose 9 units from either the Letters or Science list",
        kind: "text_rule",
        minUnits: 9,
        minCount: null,
        rawText: `${andGroup.label}: ${andGroup.courseOptions.map((option) => option.courseCode).join(", ")} ${orGroup.label}: ${orGroup.courseOptions.map((option) => option.courseCode).join(", ")}`,
        constraintOnly: false,
        courseOptions: uniqueCourseOptions([...andGroup.courseOptions, ...orGroup.courseOptions])
      });
      tableGroups.splice(tableGroups.indexOf(orGroup), 1);
    }
  }

  if (programCode === "interdisciplinary-studies-natural-science-and-mathematics-aa") {
    const introductory = tableGroups.find((group) => /^I\./.test(group.label));
    if (introductory) introductory.rawText = `${introductory.rawText ?? introductory.label} At least one introductory or advanced course must include a laboratory experience.`;
  }

  const minimumMajorUnits = Number(totalMajorUnitsText.match(/\d+(?:\.\d+)?/)?.[0] ?? 0);
  const summaryGroup = tableGroups[0];
  if (summaryGroup?.kind === "all" && summaryGroup.minUnits === minimumMajorUnits && tableGroups.length > 1) {
    const summaryCodes = new Set(summaryGroup.courseOptions.map((option) => option.courseCode));
    const laterGroupsAreBreakdowns = tableGroups.slice(1).every((group) => group.courseOptions.every((option) => summaryCodes.has(option.courseCode)));
    if (laterGroupsAreBreakdowns) tableGroups.splice(1);
  }

  if (tableGroups.length === 1 && tableGroups[0].kind === "text_rule" && tableGroups[0].minUnits === null && minimumMajorUnits > 0) {
    tableGroups[0].minUnits = minimumMajorUnits;
    if (tableGroups[0].courseOptions.length > 0 && /selected from at least \d+ disciplines/i.test(tableGroups[0].label)) {
      tableGroups[0].kind = "choose_units";
    }
  }
  const unresolvedUnitGroups = tableGroups.filter((group) => !group.constraintOnly && group.kind === "text_rule" && group.minUnits === null);
  if (unresolvedUnitGroups.length === 1 && minimumMajorUnits > 0) {
    const knownUnits = tableGroups
      .filter((group) => group !== unresolvedUnitGroups[0] && !group.constraintOnly)
      .reduce((sum, group) => sum + Number(group.minUnits ?? 0), 0);
    if (knownUnits < minimumMajorUnits) unresolvedUnitGroups[0].minUnits = minimumMajorUnits - knownUnits;
  }

  if (tableGroups.length > 0) {
    const requiredTables = sourceTables.filter((table) => !ignoredTableIndexes.has(table.index));
    const sourceCourseCodes = uniqueCourseOptions(requiredTables.flatMap((table) => table.courseOptions)).map((option) => option.courseCode);
    const representedCourseCodes = new Set(tableGroups.flatMap((group) => group.courseOptions.map((option) => option.courseCode)));
    const missingCourseCodes = sourceCourseCodes.filter((courseCode) => !representedCourseCodes.has(courseCode));
    const unrepresentedTableHeaders = requiredTables
      .filter((table) => !representedTableIndexes.has(table.index))
      .map((table) => table.header || `Table ${table.index + 1}`);
    return {
      groups: tableGroups,
      audit: {
        sourceTableCount: sourceTables.length,
        requiredTableCount: requiredTables.length,
        ignoredTableCount: ignoredTableIndexes.size,
        sourceCourseOptionCount: sourceCourseCodes.length,
        representedCourseOptionCount: representedCourseCodes.size,
        missingCourseCodes,
        unrepresentedTableHeaders
      }
    };
  }

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
  return {
    groups,
    audit: {
      sourceTableCount: 0,
      requiredTableCount: 0,
      ignoredTableCount: 0,
      sourceCourseOptionCount: 0,
      representedCourseOptionCount: groups.flatMap((group) => group.courseOptions).length,
      missingCourseCodes: [],
      unrepresentedTableHeaders: []
    }
  };
}

function parseRequirementMinCount(value) {
  const numeric = value.match(/(?:select|choose|complete).*?(\d+)\s+(?:additional\s+)?courses?/i)?.[1];
  if (numeric) return Number(numeric);
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const word = value.match(/(?:select|choose|complete).*?\b(one|two|three|four|five)\b\s+(?:additional\s+)?(?:of the following\s+)?courses?/i)?.[1]?.toLowerCase();
  return word ? words[word] : /(?:select|choose).*?one of the following/i.test(value) ? 1 : null;
}

function uniqueCourseOptions(options) {
  return options.filter((option, index) => options.findIndex((candidate) => candidate.courseCode === option.courseCode) === index);
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
  const areaTotal = value.match(/from each of\s+\d+\s+different areas?.*?\((\d+(?:\.\d+)?)\s*units?\)/i)?.[1];
  if (areaTotal) return Number(areaTotal);
  const match = value.match(/(\d+(?:\.\d+)?)(?:\s*(?:-|or)\s*(?:more\s*)?(?:\d+(?:\.\d+)?)?)?\s*units?\b/i);
  if (match) return Number(match[1]);
  const word = value.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|eighteen)\s+units?\b/i)?.[1]?.toLowerCase();
  return word ? ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, eighteen: 18 })[word] : null;
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
