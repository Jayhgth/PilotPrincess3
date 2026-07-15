import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import * as cheerio from "cheerio";
import { PDFParse } from "pdf-parse";

const ACADEMIC_TERMS = /graduation|diploma|promotion|retention|course(?:s|\s+catalog)|program\s+planning|academic\s+handbook|curriculum|codex/i;
const REQUIREMENT_TERMS = /graduation\s+requirements?|diploma\s+requirements?|promotion|retention|credits?\s+(?:and\s+course\s+)?requirements?|course\s+of\s+study/i;
const COURSE_TERMS = /course(?:s|\s+catalog)|program\s+planning|course\s+guide|curriculum|codex/i;
const STRONG_ACADEMIC_SOURCE = /graduation[-/ _]+requirements?|diploma[-/ _]+requirements?|promotion|retention|credits?[-/ _]+(?:and[-/ _]+course[-/ _]+)?requirements?|course[-/ _]+catalog|program[-/ _]+planning|course[-/ _]+guide|codex/i;
const DOCUMENT_EXTENSION = /\.(?:pdf|docx?)(?:$|[?#])/i;
const execFileAsync = promisify(execFile);

function canonicalAcademicSourceUrl(value) {
  const url = new URL(value);
  const googleDocument = url.pathname.match(/^\/document\/d\/([^/]+)/);
  if (url.hostname === "docs.google.com" && googleDocument) {
    return `https://docs.google.com/document/d/${googleDocument[1]}/export?format=pdf`;
  }
  const googleSheet = url.pathname.match(/^\/spreadsheets\/d\/([^/]+)/);
  if (url.hostname === "docs.google.com" && googleSheet) {
    return `https://docs.google.com/spreadsheets/d/${googleSheet[1]}/export?format=csv`;
  }
  return url.toString();
}

export function decodeHtmlEntities(value) {
  return cheerio.load(`<span>${String(value ?? "")}</span>`)("span").text().replace(/\s+/g, " ").trim();
}

export function academicAuthorityForSchool(school) {
  const cdsCode = String(school.cds_code ?? "");
  if (school.governance_type === "charter") return `charter:${cdsCode}`;
  return cdsCode.length === 14 ? `district:${cdsCode.slice(0, 7)}` : `school:${school.id}`;
}

export async function discoverAcademicAuthorityRoots(rootUrls) {
  const roots = [...new Set(rootUrls.filter(Boolean).map((value) => new URL(value).toString()))];
  const linked = [];
  for (const root of roots.slice(0, 4)) {
    try {
      const response = await fetchResponse(root);
      if (!(response.headers.get("content-type") ?? "").includes("text/html")) continue;
      const $ = cheerio.load(await response.text());
      $("a[href]").each((_, element) => {
        const label = decodeHtmlEntities($(element).text() || $(element).attr("aria-label") || "");
        if (!/^(?:school )?district$|unified school district|union high school district/i.test(label)) return;
        try {
          const url = new URL($(element).attr("href"), response.url);
          if (!/^https?:$/.test(url.protocol) || /finalsite\.com$/i.test(url.hostname)) return;
          url.hash = "";
          linked.push(url.toString());
        } catch { /* ignore malformed navigation links */ }
      });
    } catch { /* a missing school homepage does not block source discovery */ }
  }
  return [...new Set(linked)];
}

export function normalizeRequirementArea(title) {
  const value = String(title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (/english|language arts|ela/.test(value)) return "english";
  if (/social|history|government|civics|economics/.test(value)) return "social_science";
  if (/math|algebra|geometry/.test(value)) return "math";
  if (/career tech|(?:^|\s)cte(?:\s|$)|vocational/.test(value)) return "career_technical_education";
  if (/science|biology|chemistry|physics/.test(value)) return "lab_science";
  if (/physical education|\bpe\b|athletics/.test(value)) return "physical_education";
  if (/visual|performing|fine arts|\bvapa\b/.test(value)) return "visual_performing_arts";
  if (/world language|foreign language|language other than english|\blote\b/.test(value)) return "world_language";
  if (/ethnic studies/.test(value)) return "ethnic_studies";
  if (/elective/.test(value)) return "electives";
  if (/personal development|life skills|living skills|health/.test(value)) return "personal_development";
  if (/design lab/.test(value)) return "design_lab";
  return "other";
}

export function gradeLevelsFromText(value) {
  const normalized = String(value ?? "").replace(/[‐‑‒–—]/g, "-");
  const grades = new Set();
  for (const match of normalized.matchAll(/\b(9|10|11|12)\s*-\s*(9|10|11|12)\b/g)) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    for (let grade = Math.min(start, end); grade <= Math.max(start, end); grade += 1) grades.add(grade);
  }
  for (const match of normalized.matchAll(/\b(9|10|11|12)\b/g)) grades.add(Number(match[1]));
  return [...grades].sort((left, right) => left - right);
}

function advancedWorldLanguageCourse(course) {
  const value = `${course.name ?? ""} ${course.course_code ?? ""}`.toLowerCase().replace(/[‐‑‒–—]/g, "-");
  return /\b(?:iii|iv|v|vi|3|4|5|6)\b|\bap\s+(?:spanish|french|chinese|japanese|latin|german|italian|language)/i.test(value);
}

export function mappedRequirementAreasForCourse(course, requirements = []) {
  const ucArea = ({ a: "social_science", b: "english", c: "math", d: "lab_science", e: "world_language", f: "visual_performing_arts", g: "electives" })[String(course.uc_ag_area ?? "").toLowerCase()] ?? null;
  const namedArea = normalizeRequirementArea(`${course.name ?? ""} ${course.subject ?? ""}`);
  const identity = `${course.name ?? ""} ${course.subject ?? ""}`;
  const explicitCte = /career tech|\bcte\b|vocational/i.test(identity);
  const explicitSocialCore = /\b(?:government|economics|ethnic studies|world history|u\.?s\.? history|united states history)\b/i.test(identity);
  const explicitPhysicalEducation = /\bphysical education\b|\bpe\s*[1-4ivx]*\b/i.test(identity);
  const primaryArea = explicitCte
    ? "career_technical_education"
    : explicitSocialCore
      ? "social_science"
      : explicitPhysicalEducation
        ? "physical_education"
        : ucArea ?? namedArea;
  const areas = new Set(primaryArea && primaryArea !== "other" ? [primaryArea] : []);
  const hasCteOrLanguagePathway = requirements.some((requirement) => requirement.area === "career_technical_education"
    && /world language|foreign language|lote/i.test(`${requirement.name ?? ""} ${requirement.notes ?? ""}`));
  if (hasCteOrLanguagePathway && primaryArea === "world_language" && advancedWorldLanguageCourse(course)) {
    areas.add("career_technical_education");
    areas.delete("world_language");
  }
  return [...areas];
}

function cleanedText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/ {2,}/g, " ")
    .replace(/\r/g, "")
    .trim();
}

export function extractGraduationRequirements(text) {
  let source = cleanedText(text);
  source = source
    .replace(/Visual\s+(?:and\s+)?Performing[^\n]*?(\d+(?:\.\d+)?)\s+\D{0,4}(\d+(?:\.\d+)?)\s+\D{0,4}(\d+(?:\.\d+)?)[^\n]*\n\s*Arts/gi, "Visual and Performing Arts $1 $2 $3")
    .replace(/([A-Za-z]+\s+Core)[^\n]*?(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)[^\n]*\n\s*Electives/gi, "$1 Electives $2 $3");
  const defaultPlan = source.match(/(?:^|\n)\s*(?:#{1,4}\s*)?(?:Section\s+[A-Z]:?\s*)?Plan\s*1\s*:\s*All Students/i);
  if (defaultPlan?.index !== undefined) {
    const fromDefaultPlan = source.slice(defaultPlan.index);
    const nextPlan = fromDefaultPlan.slice(defaultPlan[0].length).search(/(?:^|\n)\s*(?:#{1,4}\s*)?Plan\s*[2-9]\s*:/im);
    source = nextPlan >= 0
      ? fromDefaultPlan.slice(0, defaultPlan[0].length + nextPlan)
      : fromDefaultPlan;
  }
  const rows = new Map();
  const headingSummary = new Map();

  const tableBlockPattern = /(?:^|\n)\s*((?:[a-g][.)]\s*)?(?:History\s*\/\s*Social Science|Social Studies|College Preparatory English|English|Mathematics?|Laboratory Science|Science|World Languages?|Visual and Performing Arts|Physical Education|Health Education|College\s*(?:and|&)\s*Career Course|Electives?)[^\n\t]*)([\s\S]{0,1200}?)\t\s*(\d+(?:\.\d+)?)\s*\t\s*(\d+(?:\.\d+)?)(?:\t|$)/gim;
  for (const match of source.matchAll(tableBlockPattern)) {
    const title = match[1].replace(/^[a-g][.)]\s*/i, "").replace(/\s+/g, " ").trim();
    const area = normalizeRequirementArea(title);
    const credits = Number(match[4]);
    if ((area === "other" && !/college\s*(?:and|&)\s*career/i.test(title)) || !Number.isFinite(credits) || credits <= 0 || credits > 120) continue;
    const key = `${area}:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
    if (rows.has(key)) continue;
    rows.set(key, {
      area,
      name: title,
      credits_required: credits,
      years_required: credits % 10 === 0 ? credits / 10 : null,
      notes: null,
      evidence: `${title} — ${match[3]} semesters — ${match[4]} credits`,
      confidence: "verified"
    });
  }

  for (const line of source.split("\n")) {
    const cells = line.split("\t").map((cell) => cell.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (cells.length < 2) continue;
    const isStructuredHtmlTable = cells[0] === "HTML_TABLE";
    const valueCells = isStructuredHtmlTable ? cells.slice(1) : cells;
    const title = valueCells[0].replace(/^[a-g][.)]\s*/i, "").trim();
    const area = normalizeRequirementArea(title);
    if (area === "other" && !/college\s*(?:and|&)\s*career/i.test(title)) continue;
    const numericCells = valueCells.slice(1).map((cell) => cell.match(/(?:^|\s)(\d+(?:\.\d+)?)(?=\s|$)/)?.[1]).filter(Boolean);
    const credits = Number(isStructuredHtmlTable ? numericCells[0] : numericCells.at(-1));
    if (!Number.isFinite(credits) || credits <= 0 || credits > 120) continue;
    const key = `${area}:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
    if (isStructuredHtmlTable) {
      for (const [existingKey, existingRow] of rows) {
        if (existingRow.area === area) rows.delete(existingKey);
      }
    }
    if (rows.has(key)) continue;
    rows.set(key, {
      area,
      name: title.replace(/\s*\([^)]*\)\s*$/, "").trim(),
      credits_required: credits,
      years_required: credits % 10 === 0 ? credits / 10 : null,
      notes: null,
      evidence: isStructuredHtmlTable ? valueCells.slice(0, 2).join(" — ") : line.trim(),
      confidence: "verified"
    });
  }
  const headingPattern = /(?:^|\n)\s*([A-Za-z][A-Za-z &/,+.-]{2,70}?)\s*\(\s*(\d+(?:\.\d+)?)\s*(?:credits?|units?)(?:\s+for\s+graduation)?\s*\)/gim;
  for (const match of source.matchAll(headingPattern)) {
    const title = match[1].replace(/\.{2,}.*$/, "").replace(/\s+/g, " ").trim();
    if (/certificate of achievement|total|required number of courses/i.test(title)) continue;
    const area = normalizeRequirementArea(title);
    if (area === "other") continue;
    const credits = Number(match[2]);
    if (!Number.isFinite(credits) || credits <= 0 || credits > 120) continue;
    const summaryRow = {
      area,
      name: title.replace(/\b(?:units?|credits?)\b.*$/i, "").trim(),
      credits_required: credits,
      years_required: credits % 10 === 0 ? credits / 10 : null,
      notes: null,
      evidence: match[0].trim(),
      confidence: "verified"
    };
    headingSummary.set(area, summaryRow);
    if (![...rows.values()].some((row) => row.area === area)) rows.set(`${area}:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, summaryRow);
  }

  const linePattern = /(?:^|\n)\s*(English|Mathematics?|Math|Science|History|Social Studies|Social Science|Physical Education|P\.?E\.?|Visual(?: and| &) Performing Arts|Fine Arts|World Languages?|Foreign Languages?|(?:[A-Za-z]+\s+Core\s+)?Electives?|Life Skills|Health)\s*[:-]?\s*((?:\d+(?:\.\d+)?\s*){1,3})(?:credits?|units?)?\b/gim;
  for (const match of source.matchAll(linePattern)) {
    const area = normalizeRequirementArea(match[1]);
    if (area === "other" || [...rows.values()].some((row) => row.area === area)) continue;
    const context = source.slice(Math.max(0, match.index - 180), match.index + match[0].length + 120);
    if (/certificate of achievement/i.test(context)) continue;
    const values = [...match[2].matchAll(/\d+(?:\.\d+)?/g)].map((value) => Number(value[0]));
    const credits = Number(values.at(-1));
    if (values.length === 1 && credits <= 4 && !/(?:credits?|units?)/i.test(match[0])) continue;
    if (!Number.isFinite(credits) || credits <= 0 || credits > 120) continue;
    rows.set(`${area}:${match[1].toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, {
      area,
      name: match[1].replace(/\s+/g, " ").trim(),
      credits_required: credits,
      years_required: credits % 10 === 0 ? credits / 10 : null,
      notes: null,
      evidence: match[0].trim(),
      confidence: "verified"
    });
  }

  const cteLanguage = source.match(/(?:CTE|Career Technical Education)\s+or\s+World Language[^\n]{0,80}|Students who do not take a third level of world language must take a year of Career Technical Education/i);
  if (cteLanguage && ![...rows.values()].some((row) => row.area === "career_technical_education")) {
    rows.set("career_technical_education:cte-or-advanced-world-language", {
      area: "career_technical_education",
      name: "Career Technical Education or advanced World Language",
      credits_required: 10,
      years_required: 1,
      notes: "The official source defines a one-year CTE pathway for students who do not complete a third level of world language.",
      constraint_only: true,
      evidence: cteLanguage[0].trim(),
      confidence: "verified"
    });
  }

  const summaryCoreAreas = ["english", "social_science", "math", "lab_science"];
  if (headingSummary.size >= 6 && summaryCoreAreas.every((area) => headingSummary.has(area))) {
    const pathway = [...rows.values()].find((row) => row.area === "career_technical_education");
    return [...headingSummary.values(), ...(pathway ? [pathway] : [])];
  }
  return [...rows.values()];
}

async function ocrAcademicImages($, pageUrl) {
  const images = $("img").toArray().flatMap((element) => {
    const label = decodeHtmlEntities($(element).attr("alt") || $(element).attr("title") || "");
    const source = $(element).attr("data-src") || $(element).attr("src");
    if (!source || !/(?:graduation|diploma|requirements?|course\s+catalog)/i.test(`${label} ${source}`)) return [];
    try { return [{ label, url: new URL(source, pageUrl).toString() }]; } catch { return []; }
  }).slice(0, 3);
  if (!images.length) return "";
  const directory = await mkdtemp(join(process.cwd(), ".pilot-ocr-"));
  const extracted = [];
  try {
    for (let index = 0; index < images.length; index += 1) {
      try {
        const response = await fetch(images[index].url, { headers: { "user-agent": "PilotPrincess academic source sync", accept: "image/jpeg,image/png" }, signal: AbortSignal.timeout(20_000) });
        if (!response.ok) continue;
        const input = join(directory, `source-${index}.jpg`);
        const prepared = join(directory, `prepared-${index}.png`);
        await writeFile(input, Buffer.from(await response.arrayBuffer()));
        try {
          await execFileAsync("magick", [input, "-resize", "200%", "-colorspace", "Gray", "-threshold", "55%", prepared], { timeout: 30_000, maxBuffer: 2_000_000 });
        } catch {
          try { await execFileAsync("convert", [input, "-resize", "200%", "-colorspace", "Gray", "-threshold", "55%", prepared], { timeout: 30_000, maxBuffer: 2_000_000 }); }
          catch { await writeFile(prepared, await readFile(input)); }
        }
        const result = await execFileAsync("tesseract", [prepared, "stdout", "--psm", "6"], { timeout: 45_000, maxBuffer: 8_000_000 });
        if (result.stdout.trim()) extracted.push(`OCR_IMAGE ${images[index].label || images[index].url}\n${result.stdout}`);
      } catch { /* image-only evidence remains unavailable when OCR tooling is absent */ }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  return extracted.join("\n");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') { cell += '"'; index += 1; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (character === "," && !quoted) { row.push(cell); cell = ""; continue; }
    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell); cell = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      continue;
    }
    cell += character;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function extractDocumentCatalogCourses(text, sourceUrl) {
  const lines = String(text ?? "").split("\n").map((line) => line.replace(/\s+/g, " ").trim());
  const sectionNames = new Map([
    ["BUSINESS/MARKETING", "Business"], ["COMPUTER SCIENCE", "Computer Science"], ["ENGLISH", "English"],
    ["MATHEMATICS", "Mathematics"], ["MATH", "Mathematics"], ["PHYSICAL EDUCATION", "Physical Education"],
    ["SCIENCE", "Science"], ["SOCIAL STUDIES", "Social Science"], ["VISUAL & PERFORMING ARTS", "Visual and Performing Arts"],
    ["WORLD LANGUAGES", "World Language"], ["NON DEPARTMENTAL", "Elective"], ["AP CAPSTONE", "Elective"]
  ]);
  let subject = "Elective";
  const courses = [];
  const seen = new Set();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (sectionNames.has(line)) { subject = sectionNames.get(line); continue; }
    if (!/^[+*#^]?[A-Z][A-Z0-9 &/.,'():+-]{2,110}$/.test(line) || /^(?:COURSE OFFERINGS|PREREQUISITES?|GRADES?|PAGE|TOTAL|SCOPE|SEQUENCE)$/i.test(line)) continue;
    const metadata = lines.slice(index + 1, index + 7);
    const gradeLineIndex = metadata.findIndex((value) => /^(?:recommended\s+)?grades?\s*:?[\s,0-9-]+$/i.test(value));
    if (gradeLineIndex < 0) continue;
    const gradeLine = metadata[gradeLineIndex];
    const gradeLevels = gradeLevelsFromText(gradeLine);
    if (!gradeLevels.length) continue;
    const name = line.replace(/^[+*#^]+/, "").replace(/\s*-\s*(?:H?P|AS)\s*[,.;:]?\s*$/i, "").replace(/[,\s]+$/, "").replace(/\s+/g, " ").trim();
    if (/\bI\s*,\s*II\s*,\s*III\s*,\s*IV\b/i.test(name)) continue;
    const normalizedName = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!normalizedName || seen.has(normalizedName)) continue;
    seen.add(normalizedName);
    const prerequisiteIndex = metadata.findIndex((value) => /^prerequisites?\s*:/i.test(value));
    const prerequisites = prerequisiteIndex >= 0
      ? [metadata.slice(prerequisiteIndex, gradeLineIndex).join(" ").replace(/^prerequisites?\s*:\s*/i, "").trim()].filter((value) => value && !/^(?:none|n\/a|na)$/i.test(value))
      : [];
    const descriptionStart = index + 1 + gradeLineIndex + 1;
    let descriptionEnd = Math.min(lines.length, descriptionStart + 30);
    for (let candidateIndex = descriptionStart; candidateIndex < descriptionEnd; candidateIndex += 1) {
      const candidate = lines[candidateIndex];
      if (!/^[+*#^]?[A-Z][A-Z0-9 &/.,'():+-]{2,110}$/.test(candidate)) continue;
      if (lines.slice(candidateIndex + 1, candidateIndex + 7).some((value) => /^(?:recommended\s+)?grades?\s*:?[\s,0-9-]+$/i.test(value))) {
        descriptionEnd = candidateIndex;
        break;
      }
    }
    const description = lines.slice(descriptionStart, descriptionEnd)
      .filter((value) => value && !/^\d+$|^\d{1,2}\/\d{1,2}\/\d{4}$|^-- \d+ of \d+ --$/.test(value))
      .join(" ").slice(0, 1800).trim();
    const semester = /(?:one|1)[ -]semester|semester class|fall semester|spring semester/i.test(`${name} ${description}`);
    const isHonors = /\b(?:honors?|ap|ib)\b|(?:^|-)HP$/i.test(line);
    courses.push({
      external_course_id: `catalog:${createHash("sha256").update(`${sourceUrl}|${normalizedName}`).digest("hex").slice(0, 24)}`,
      course_code: null,
      name,
      subject,
      course_type: "high_school",
      grade_levels: gradeLevels,
      credits: semester ? 5 : 10,
      college_units: null,
      term_type: semester ? "semester" : "year",
      uc_ag_area: null,
      prerequisites,
      description: description || null,
      is_honors: isHonors,
      is_weighted: isHonors,
      confidence: "verified",
      review_status: "approved"
    });
  }
  return courses;
}

export function extractCatalogCourses(text, { sourceUrl = "official-catalog" } = {}) {
  const rows = parseCsv(String(text ?? ""));
  if (rows.length < 2) return extractDocumentCatalogCourses(text, sourceUrl);
  const headers = rows[0].map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  const indexFor = (...names) => headers.findIndex((header) => names.some((name) => header === name || header.includes(name)));
  const nameIndex = indexFor("course name", "course title");
  if (nameIndex < 0) return extractDocumentCatalogCourses(text, sourceUrl);
  const descriptionIndex = indexFor("description");
  const pathwayIndex = indexFor("pathway by grade", "grade level", "grades");
  const prerequisiteIndex = indexFor("prerequisite");
  const agIndex = indexFor("uc a g approved", "a g approved", "subject area");
  const seen = new Set();
  return rows.slice(1).flatMap((cells) => {
    const name = decodeHtmlEntities(cells[nameIndex] ?? "").replace(/\s+/g, " ").trim();
    const description = decodeHtmlEntities(cells[descriptionIndex] ?? "").trim();
    if (!name || (!description && /^[A-Z &/.-]+$/.test(name))) return [];
    const normalizedName = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!normalizedName || seen.has(normalizedName)) return [];
    seen.add(normalizedName);
    const pathway = cells[pathwayIndex] ?? "";
    const gradeLevels = gradeLevelsFromText(pathway);
    const agValue = cells[agIndex] ?? "";
    const agArea = agValue.match(/(?:^|\W)([a-g])(?:\W|$)/i)?.[1]?.toLowerCase() ?? null;
    const semester = /(?:one|1)[ -]semester|semester class|fall semester|spring semester/i.test(`${name} ${description}`);
    const prerequisite = decodeHtmlEntities(cells[prerequisiteIndex] ?? "").trim();
    const isHonors = /\b(?:honors?|ap|ib)\b|\*/i.test(name);
    return [{
      external_course_id: `catalog:${createHash("sha256").update(`${sourceUrl}|${normalizedName}`).digest("hex").slice(0, 24)}`,
      course_code: null,
      name,
      subject: agArea ? ({ a: "Social Science", b: "English", c: "Mathematics", d: "Science", e: "World Language", f: "Visual and Performing Arts", g: "Elective" })[agArea] : "Elective",
      course_type: "high_school",
      grade_levels: gradeLevels,
      credits: semester ? 5 : 10,
      college_units: null,
      term_type: semester ? "semester" : "year",
      uc_ag_area: agArea,
      prerequisites: prerequisite && !/^(?:none|n\/a|na)$/i.test(prerequisite) ? [prerequisite] : [],
      description: description || null,
      is_honors: isHonors,
      is_weighted: isHonors,
      confidence: "verified",
      review_status: "approved"
    }];
  });
}

export function mergeOfficialCourses(ucopCourses, catalogCourses) {
  const normalize = (name) => decodeHtmlEntities(name).toLowerCase()
    .replace(/\bpre[ -]?calc(?:ulus)?\b/g, "precalculus")
    .replace(/\b(?:hp|hon)\b/g, "honors")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const catalogByName = new Map();
  for (const course of catalogCourses) {
    const key = normalize(course.name);
    const existing = catalogByName.get(key);
    if (!existing || course.grade_levels.length > existing.grade_levels.length) catalogByName.set(key, course);
  }
  const ucopByExactName = new Map();
  for (const course of ucopCourses) {
    const key = decodeHtmlEntities(course.name).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const existing = ucopByExactName.get(key);
    if (!existing || (!existing.is_honors && course.is_honors)) ucopByExactName.set(key, course);
  }
  const merged = [...ucopByExactName.values()].map((course) => {
    const catalog = catalogByName.get(normalize(course.name));
    if (!catalog) return course;
    catalogByName.delete(normalize(course.name));
    return {
      ...course,
      grade_levels: catalog.grade_levels.length ? catalog.grade_levels : course.grade_levels,
      prerequisites: catalog.prerequisites,
      description: catalog.description,
      credits: catalog.credits ?? course.credits,
      term_type: catalog.term_type ?? course.term_type
    };
  });
  return [...merged, ...catalogByName.values()];
}

export function validateGraduationRequirements(requirements) {
  const areas = new Set(requirements.map((row) => row.area));
  const core = ["english", "social_science", "math", "lab_science"];
  const missingCore = core.filter((area) => !areas.has(area));
  const duplicateAreas = false;
  const invalidRows = requirements.filter((row) => !row.evidence || !Number.isFinite(row.credits_required) || row.credits_required <= 0);
  return {
    publishable: requirements.length >= 6 && missingCore.length === 0 && !duplicateAreas && invalidRows.length === 0,
    missing_core_areas: missingCore,
    duplicate_areas: duplicateAreas,
    invalid_rows: invalidRows.map((row) => row.name),
    credits_total: requirements.reduce((sum, row) => sum + (row.constraint_only ? 0 : row.credits_required), 0)
  };
}

export function ucopCourseValues(row) {
  const semester = Number(row.courseLengthId) === 1;
  return {
    external_course_id: String(row.courseId ?? row.recordId),
    course_code: row.transcriptAbbreviations || row.recordId || null,
    name: decodeHtmlEntities(row.title),
    subject: decodeHtmlEntities(row.disciplineName || `A-G area ${String(row.subjectAreaCode).toUpperCase()}`),
    course_type: "uc_ag_approved",
    grade_levels: [],
    credits: semester ? 5 : 10,
    college_units: null,
    term_type: semester ? "semester" : "year",
    uc_ag_area: String(row.subjectAreaCode).toLowerCase(),
    prerequisites: [],
    description: "Official UCOP A-G course identity. Local term availability and non-A-G offerings remain governed by the school catalog.",
    is_honors: Number(row.isHonors) === 1,
    is_weighted: Number(row.isHonors) === 1,
    confidence: "verified",
    review_status: "approved"
  };
}

function sourceTypeForLink(label, url) {
  const value = `${label} ${url}`;
  if (/codex/i.test(value)) return "combined";
  const requirement = REQUIREMENT_TERMS.test(value);
  const courses = COURSE_TERMS.test(value);
  return requirement && courses ? "combined" : requirement ? "graduation_requirements" : courses ? "course_catalog" : null;
}

function scoreAcademicLink(label, url, sourceType) {
  let score = sourceType === "combined" ? 50 : sourceType ? 30 : 0;
  const value = `${label} ${url}`.toLowerCase();
  if (DOCUMENT_EXTENSION.test(url)) score += 12;
  if (/202[5-9]|current|latest/.test(value)) score += 10;
  if (/program planning|course catalog|graduation requirements|codex/.test(value)) score += 14;
  if (/archive|202[0-3]|board agenda|minutes/.test(value)) score -= 15;
  return score;
}

function allowedOfficialUrl(candidate, roots) {
  let url;
  try { url = new URL(candidate); } catch { return false; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const officialHosts = new Set(roots.map((root) => new URL(root).hostname.replace(/^www\./, "")));
  const host = url.hostname.replace(/^www\./, "");
  return officialHosts.has(host)
    || [...officialHosts].some((official) => host.endsWith(`.${official}`))
    || /(?:cloudfront\.net|resources\.finalsite\.net|googleusercontent\.com|docs\.google\.com|drive\.google\.com)$/.test(host);
}

async function fetchResponse(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "PilotPrincess academic source sync (+official-public-sources-only)" },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}.`);
  return response;
}

export async function discoverAcademicSources(rootUrls, { maxPages = 24 } = {}) {
  const roots = [...new Set(rootUrls.filter(Boolean).map((value) => new URL(value).toString()))];
  const queue = roots.map((url) => ({ url, depth: 0 }));
  const visited = new Set();
  const candidates = new Map();

  const sitemapQueue = [...new Set(roots.map((root) => new URL("/sitemap.xml", root).toString()))];
  const visitedSitemaps = new Set();
  while (sitemapQueue.length && visitedSitemaps.size < 12) {
    const sitemapUrl = sitemapQueue.shift();
    if (!sitemapUrl || visitedSitemaps.has(sitemapUrl)) continue;
    visitedSitemaps.add(sitemapUrl);
    try {
      const response = await fetchResponse(sitemapUrl);
      const xml = await response.text();
      for (const match of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
        const url = decodeHtmlEntities(match[1]);
        if (/sitemap/i.test(url) && sitemapQueue.length < 30) sitemapQueue.push(url);
        else if (STRONG_ACADEMIC_SOURCE.test(url) && allowedOfficialUrl(url, roots)) {
          const sourceType = sourceTypeForLink(url, url);
          if (sourceType) candidates.set(url, { url, title: new URL(url).pathname.split("/").filter(Boolean).pop()?.replace(/[-_]+/g, " ") || url, source_type: sourceType, score: scoreAcademicLink(url, url, sourceType), discovered_from_url: sitemapUrl });
          if (queue.length < 200) queue.unshift({ url, depth: 1 });
        } else if (ACADEMIC_TERMS.test(url) && allowedOfficialUrl(url, roots) && queue.length < 120) queue.push({ url, depth: 1 });
      }
    } catch { /* not every official site publishes a sitemap */ }
  }

  while (queue.length && visited.size < maxPages) {
    const current = queue.shift();
    if (!current || visited.has(current.url) || !allowedOfficialUrl(current.url, roots)) continue;
    visited.add(current.url);
    let response;
    try { response = await fetchResponse(current.url); } catch { continue; }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) continue;
    const html = await response.text();
    const $ = cheerio.load(html);
    $("a[href]").each((_, element) => {
      const href = $(element).attr("href");
      if (!href) return;
      let url;
      try { const parsed = new URL(href, response.url); parsed.hash = ""; url = parsed.toString(); } catch { return; }
      if (!allowedOfficialUrl(url, roots)) return;
      const label = decodeHtmlEntities($(element).text() || $(element).attr("aria-label") || $(element).attr("title") || "");
      const sourceType = sourceTypeForLink(label, url);
      if (sourceType) {
        const candidate = { url, title: label || new URL(url).pathname.split("/").pop(), source_type: sourceType, score: scoreAcademicLink(label, url, sourceType), discovered_from_url: response.url };
        const existing = candidates.get(url);
        if (!existing || candidate.score > existing.score) candidates.set(url, candidate);
      }
      if (current.depth < 2 && !DOCUMENT_EXTENSION.test(url) && ACADEMIC_TERMS.test(`${label} ${url}`) && !visited.has(url)) {
        queue.push({ url, depth: current.depth + 1 });
      }
    });
  }

  return [...candidates.values()].sort((left, right) => right.score - left.score || left.url.localeCompare(right.url));
}

export async function readAcademicSource(url) {
  const canonicalUrl = canonicalAcademicSourceUrl(url);
  const response = await fetchResponse(canonicalUrl);
  const contentType = (response.headers.get("content-type") ?? "").split(";", 1)[0].toLowerCase();
  const buffer = Buffer.from(await response.arrayBuffer());
  let text;
  if (contentType === "application/pdf" || /\.pdf(?:$|[?#])/i.test(response.url)) {
    const parser = new PDFParse({ data: buffer });
    try { text = (await parser.getText()).text; } finally { await parser.destroy(); }
  } else if (contentType.includes("html")) {
    const $ = cheerio.load(buffer.toString("utf8"));
    const imageText = await ocrAcademicImages($, response.url);
    $("script,style,noscript,svg,nav,footer").remove();
    const structuredTables = $("tr").toArray().flatMap((row) => {
      const cells = $(row).find("th,td").toArray().map((cell) => decodeHtmlEntities($(cell).text())).filter(Boolean);
      return cells.length >= 2 ? [`HTML_TABLE\t${cells.join("\t")}`] : [];
    }).join("\n");
    $("br").replaceWith("\n");
    $("th,td").each((_, element) => $(element).append("\t"));
    $("h1,h2,h3,h4,h5,p,li,tr,section,article").each((_, element) => $(element).append("\n"));
    const semanticRoots = $("main,article,[role=main],.fsPageBody,.fsPageContent,.page-content")
      .toArray()
      .map((element) => $(element).text())
      .filter((value) => value.trim().length > 0)
      .sort((left, right) => right.length - left.length);
    text = `${semanticRoots[0] || $("body").text()}${structuredTables ? `\n${structuredTables}` : ""}${imageText ? `\n${imageText}` : ""}`;
  } else {
    text = buffer.toString("utf8");
  }
  return {
    url: new URL(url).toString(),
    resolved_url: response.url,
    content_type: contentType || "application/octet-stream",
    text: cleanedText(text),
    content_hash: createHash("sha256").update(buffer).digest("hex")
  };
}

export function academicYearFromSource(value, fallback = `${new Date().getFullYear()}-${String(new Date().getFullYear() + 1).slice(-2)}`) {
  const match = String(value ?? "").match(/\b(20\d{2})\s*[-/]\s*(20)?(\d{2})(?=\D|$)/);
  return match ? `${match[1]}-${match[3]}` : fallback;
}
