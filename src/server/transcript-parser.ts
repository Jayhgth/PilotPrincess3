import type { ParsedTranscriptResult } from "@/server/ai-schemas";

const SECTION_PATTERN = /^(\d{2}-\d{2})\s+(.+)$/;
const COURSE_ROW_PATTERN = /^(9|10|11|12)\s+(\*)?\s*(.+)$/;
const GRADE_CREDIT_PATTERN = /\b(A\+|A-|A|B\+|B-|B|C\+|C-|C|D\+|D-|D|F|P|I|IP|NP|W)\s+(\d{1,3}(?:\.\d+)?)\b/g;
const COLLEGE_CODE_PATTERN = /^([A-Z]{2,5}\.?)\s+([A-Z]?\d{2,4}(?:\.\d)?[A-Z]?)\b/;
const DISTRICT_COLLEGES = ["College of San Mateo", "Skyline College", "Cañada College", "Canada College"];
const PDF_PAGE_MARKER_PATTERN = /^\[\[PILOT_PDF_PAGE:\d+\]\]$/;
const TRANSCRIPT_COLUMN_MARKER = "[[PILOT_TRANSCRIPT_COLUMN]]";

export const TRANSCRIPT_PARSER_VERSION = "dtech-layout-text-1.6.0";

type TranscriptTerm = "fall" | "spring" | "summer" | "full_year";

interface TermColumns {
  summer: number;
  fall: number;
  spring: number;
}

interface TranscriptSection {
  schoolYear: string;
  institution: string;
  isCollege: boolean;
}

interface PendingCourse {
  gradeLevel: number;
  ucApproved: boolean;
  section: TranscriptSection;
  lines: string[];
  rawLines: string[];
  termColumns: TermColumns | null;
}

function isDistrictCollege(value: string) {
  return DISTRICT_COLLEGES.some((college) => value.toLowerCase().includes(college.toLowerCase()));
}

function fullSchoolYear(shortYear: string) {
  const [start, end] = shortYear.split("-").map(Number);
  return `${2000 + start}-${2000 + end}`;
}

function termColumnsFromHeader(line: string): TermColumns | null {
  const summer = line.search(/\bS0\b/i);
  const fall = line.search(/\bS1\b/i);
  const spring = line.search(/\bS2\b/i);
  return summer >= 0 && fall >= 0 && spring >= 0 ? { summer, fall, spring } : null;
}

function explicitTermForTitle(title: string): TranscriptTerm | null {
  if (/\b(?:summer|semester\s*0|S0)\b/i.test(title)) return "summer";
  if (/\b(?:fall|semester\s*1|S1)\b/i.test(title)) return "fall";
  if (/\b(?:spring|semester\s*2|S2)\b/i.test(title)) return "spring";
  if (/\b(?:full[ -]?year|annual)\b/i.test(title)) return "full_year";
  return null;
}

function termsFromLayout(lines: string[], columns: TermColumns | null) {
  if (!columns) return [];
  const terms: TranscriptTerm[] = [];
  const entries = Object.entries(columns) as Array<[Exclude<TranscriptTerm, "full_year">, number]>;

  for (const line of lines) {
    for (const match of line.matchAll(GRADE_CREDIT_PATTERN)) {
      const position = match.index ?? -1;
      const nearest = entries
        .map(([term, column]) => ({ term, distance: Math.abs(column - position) }))
        .sort((left, right) => left.distance - right.distance)[0];
      if (nearest && nearest.distance <= 5) terms.push(nearest.term);
    }
  }
  return terms;
}

function resolveCourseTerm(title: string, rawLines: string[], columns: TermColumns | null, gradeCount: number) {
  const explicit = explicitTermForTitle(title);
  if (explicit) return { term: explicit, verified: true, evidence: "printed term label" };

  const layoutTerms = [...new Set(termsFromLayout(rawLines, columns))];
  if (layoutTerms.includes("fall") && layoutTerms.includes("spring")) {
    return { term: "full_year" as const, verified: true, evidence: "S1 and S2 transcript columns" };
  }
  if (layoutTerms.length === 1) {
    return { term: layoutTerms[0], verified: true, evidence: `${layoutTerms[0]} transcript column` };
  }
  if (/^Q[12]\b/i.test(title)) return { term: "fall" as const, verified: true, evidence: "printed intersession quarter" };
  if (/^Q[34]\b/i.test(title)) return { term: "spring" as const, verified: true, evidence: "printed intersession quarter" };
  if (gradeCount > 1) {
    return { term: "full_year" as const, verified: true, evidence: "multiple semester grade columns" };
  }
  return { term: "full_year" as const, verified: false, evidence: "term column unavailable" };
}

function cleanedCourseName(title: string) {
  return title.replace(/^Q[1-4]\s+/i, "").replace(/\s+/g, " ").trim();
}

function dtechGradeBand(grade: string) {
  return /^[A-D]/.test(grade) ? grade[0] : grade;
}

function linearizeTranscriptColumns(layoutText: string) {
  const output: string[] = [];
  let pageLines: string[] = [];

  const flushPage = () => {
    if (pageLines.length === 0) return;
    const repeatedHeader = pageLines
      .map((line) => [...line.matchAll(/\bGR\s+Course\b/gi)])
      .find((matches) => matches.length > 1);
    const rightColumnStart = repeatedHeader?.[1]?.index;

    if (rightColumnStart === undefined) {
      output.push(...pageLines);
      pageLines = [];
      return;
    }

    const leftColumn = pageLines.map((line) => line.slice(0, rightColumnStart).trimEnd());
    const rightColumn = pageLines.map((line) => line.slice(rightColumnStart).trimEnd());
    output.push(...leftColumn, TRANSCRIPT_COLUMN_MARKER, ...rightColumn);
    pageLines = [];
  };

  for (const line of layoutText.split(/\r?\n/)) {
    if (PDF_PAGE_MARKER_PATTERN.test(line.trim())) {
      flushPage();
      output.push(line.trim());
      continue;
    }
    pageLines.push(line);
  }
  flushPage();
  return output.join("\n");
}

function parseTranscriptRepresentation(parserInput: string): ParsedTranscriptResult {
  const lines = parserInput
    .split(/\r?\n/)
    .map((raw) => ({ raw: raw.replace(/\t/g, "    ").trimEnd(), normalized: raw.replace(/\s+/g, " ").trim() }))
    .filter((line) => Boolean(line.normalized));
  const academicYears = new Set<string>();
  const institutions = new Set<string>();
  const conflicts: string[] = [];
  const courses: ParsedTranscriptResult["courses"] = [];
  let section: TranscriptSection | null = null;
  let pending: PendingCourse | null = null;
  let termColumns: TermColumns | null = null;
  let ignoringMetadata = false;

  const flush = () => {
    if (!pending) return;
    const content = pending.lines.join(" ").replace(/\s+/g, " ").trim();
    const gradeMatches = [...content.matchAll(GRADE_CREDIT_PATTERN)];
    if (gradeMatches.length === 0) {
      conflicts.push(`No final grade and credit pair was found for: ${content.slice(0, 160)}`);
      pending = null;
      return;
    }

    const rawTitle = content.slice(0, gradeMatches[0].index).trim();
    const courseName = cleanedCourseName(rawTitle);
    if (!courseName) {
      conflicts.push(`A graded row did not contain a readable course name: ${content.slice(0, 160)}`);
      pending = null;
      return;
    }

    const grades = gradeMatches.map((match) => match[1]);
    const credits = gradeMatches.reduce((total, match) => total + Number(match[2]), 0);
    const collegeCode = pending.section.isCollege ? courseName.match(COLLEGE_CODE_PATTERN) : null;
    const differentGpaBands = new Set(grades.map(dtechGradeBand)).size > 1;
    const termResolution = resolveCourseTerm(rawTitle, pending.rawLines, pending.termColumns, gradeMatches.length);
    if (differentGpaBands) {
      conflicts.push(`${courseName} lists semester grades in different GPA bands (${grades.join(", ")}); the latest printed grade is used for planning.`);
    }
    if (!termResolution.verified) {
      conflicts.push(`${courseName} has one printed grade, but its semester column was not available in the extracted text. Review the term before importing it.`);
    }
    const isIntersession = !pending.section.isCollege
      && /^Q[1-4]\b/i.test(rawTitle)
      && grades.every((grade) => grade === "P" || grade === "F");

    courses.push({
      course_name: courseName,
      course_code: collegeCode ? `${collegeCode[1]} ${collegeCode[2]}` : null,
      subject: collegeCode?.[1]?.replace(/\.$/, "") ?? (isIntersession ? "Personal Development" : null),
      grade_level: pending.gradeLevel,
      school_year: fullSchoolYear(pending.section.schoolYear),
      term: termResolution.term,
      letter_grade: grades.at(-1) ?? null,
      credits,
      weighted: pending.section.isCollege || /\bhonors?\b/i.test(courseName),
      institution_name: pending.section.institution,
      college_units: null,
      confidence: differentGpaBands || !termResolution.verified ? "uncertain" : gradeMatches.length > 1 ? "likely" : "verified",
      evidence: `${pending.section.schoolYear} ${pending.section.institution}: grade ${grades.join("/")}, ${gradeMatches.map((match) => match[2]).join("+")} credits, ${termResolution.evidence}${pending.section.isCollege ? ", weighted college course" : ""}${isIntersession ? ", intersession pass/fail course" : ""}${isIntersession && grades.every((grade) => grade === "P") ? ", Personal Development credit" : ""}${pending.ucApproved ? ", UC-approved marker" : ""}.`
    });
    pending = null;
  };

  for (const line of lines) {
    if (PDF_PAGE_MARKER_PATTERN.test(line.normalized) || line.normalized === TRANSCRIPT_COLUMN_MARKER) {
      flush();
      termColumns = null;
      ignoringMetadata = false;
      continue;
    }
    if (/^GR\s+Course\b/i.test(line.normalized)) {
      flush();
      termColumns = termColumnsFromHeader(line.raw);
      ignoringMetadata = false;
      continue;
    }

    const sectionMatch = line.normalized.match(SECTION_PATTERN);
    if (sectionMatch && /(High School|College)/i.test(sectionMatch[2])) {
      flush();
      ignoringMetadata = false;
      const institution = sectionMatch[2].replace(/^Canada College$/i, "Cañada College");
      section = {
        schoolYear: sectionMatch[1],
        institution,
        isCollege: isDistrictCollege(institution)
      };
      academicYears.add(fullSchoolYear(sectionMatch[1]));
      institutions.add(institution);
      continue;
    }

    if (/^(Comments|Legend)/i.test(line.normalized)) {
      flush();
      ignoringMetadata = true;
      continue;
    }
    if (ignoringMetadata) continue;
    if (/^(P\s*=|I\s*=|S0\s*=|Signature|Director|--\s*\d+\s+of)/i.test(line.normalized)) {
      flush();
      continue;
    }

    const courseMatch = line.normalized.match(COURSE_ROW_PATTERN);
    if (courseMatch && section) {
      flush();
      pending = {
        gradeLevel: Number(courseMatch[1]),
        ucApproved: Boolean(courseMatch[2]),
        section,
        lines: [courseMatch[3]],
        rawLines: [line.raw],
        termColumns
      };
      continue;
    }

    if (pending) {
      pending.lines.push(line.normalized);
      pending.rawLines.push(line.raw);
    }
  }
  flush();

  const collegeCourseCount = courses.filter((course) => course.institution_name && isDistrictCollege(course.institution_name)).length;
  return {
    summary: courses.length
      ? `Deterministically extracted ${courses.length} completed course rows across ${academicYears.size} school years, including ${collegeCourseCount} SMCCD course rows.`
      : "No completed course rows were detected in the transcript text.",
    student_name: null,
    school_name: [...institutions].find((institution) => !isDistrictCollege(institution)) ?? null,
    academic_years: [...academicYears].sort(),
    courses,
    conflicts,
    counselor_questions: conflicts.length > 0
      ? ["Confirm any course with multiple semester grades or an uncertain term before relying on GPA estimates."]
      : []
  };
}

function normalizedTitle(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function titlesReferToSameCourse(left: string, right: string) {
  const normalizedLeft = normalizedTitle(left);
  const normalizedRight = normalizedTitle(right);
  if (normalizedLeft === normalizedRight) return true;
  const shorter = normalizedLeft.length <= normalizedRight.length ? normalizedLeft : normalizedRight;
  const longer = shorter === normalizedLeft ? normalizedRight : normalizedLeft;
  return shorter.length >= 12 && longer.startsWith(shorter);
}

function mergeTranscriptRepresentations(
  flattened: ParsedTranscriptResult,
  positioned: ParsedTranscriptResult
): ParsedTranscriptResult {
  const claimed = new Set<number>();
  const courses = flattened.courses.map((course) => {
    const matchIndex = positioned.courses.findIndex((candidate, index) =>
      !claimed.has(index)
      && candidate.grade_level === course.grade_level
      && candidate.school_year === course.school_year
      && titlesReferToSameCourse(candidate.course_name, course.course_name)
    );
    if (matchIndex < 0) return course;
    claimed.add(matchIndex);
    const positionedCourse = positioned.courses[matchIndex];
    return {
      ...course,
      term: positionedCourse.term,
      confidence: positionedCourse.confidence,
      evidence: `${course.evidence} Semester placement was read from the positioned S0/S1/S2 columns.`
    };
  });
  const collegeCourseCount = courses.filter((course) => course.institution_name && isDistrictCollege(course.institution_name)).length;
  return {
    ...flattened,
    summary: courses.length
      ? `Deterministically extracted ${courses.length} completed course rows across ${flattened.academic_years.length} school years, including ${collegeCourseCount} SMCCD course rows.`
      : flattened.summary,
    courses,
    conflicts: [...new Set([
      ...positioned.conflicts,
      ...flattened.conflicts.filter((conflict) => !conflict.includes("semester column was not available"))
    ])]
  };
}

export function parseDtechTranscriptText(text: string, layoutText = ""): ParsedTranscriptResult {
  const flattened = parseTranscriptRepresentation(text);
  if (!layoutText.trim()) return flattened;
  const positioned = parseTranscriptRepresentation(linearizeTranscriptColumns(layoutText));
  if (flattened.courses.length === 0) return positioned;
  return mergeTranscriptRepresentations(flattened, positioned);
}
