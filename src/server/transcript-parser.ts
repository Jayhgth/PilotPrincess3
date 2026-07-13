import type { ParsedTranscriptResult } from "@/server/ai-schemas";

const SECTION_PATTERN = /^(\d{2}-\d{2})\s+(.+)$/;
const COURSE_ROW_PATTERN = /^(9|10|11|12)\s+(\*)?\s*(.+)$/;
const GRADE_CREDIT_PATTERN = /\b(A\+|A-|A|B\+|B-|B|C\+|C-|C|D\+|D-|D|F|P|I|IP|NP|W)\s+(\d{1,3}(?:\.\d+)?)\b/g;
const COLLEGE_CODE_PATTERN = /^([A-Z]{2,5}\.?)\s+([A-Z]?\d{2,4}(?:\.\d)?[A-Z]?)\b/;
const DISTRICT_COLLEGES = ["College of San Mateo", "Skyline College", "Cañada College", "Canada College"];

export const TRANSCRIPT_PARSER_VERSION = "dtech-layout-text-1.4.0";

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

export function parseDtechTranscriptText(text: string, layoutText = ""): ParsedTranscriptResult {
  const lines = (layoutText.trim() || text)
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
      conflicts.push(`${courseName} lists semester grades in different d.tech GPA bands (${grades.join(", ")}); the latest printed grade is used for planning.`);
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
    if (/^(Comments|Legend|P\s*=|I\s*=|S0\s*=|Signature|Director|--\s*\d+\s+of)/i.test(line.normalized)) {
      flush();
      if (/^(Comments|Legend)/i.test(line.normalized)) break;
      continue;
    }
    if (/^GR\s+Course\b/i.test(line.normalized)) {
      termColumns = termColumnsFromHeader(line.raw);
      continue;
    }

    const sectionMatch = line.normalized.match(SECTION_PATTERN);
    if (sectionMatch && /(High School|College)/i.test(sectionMatch[2])) {
      flush();
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
    school_name: institutions.has("Design Tech High School") ? "Design Tech High School" : null,
    academic_years: [...academicYears].sort(),
    courses,
    conflicts,
    counselor_questions: conflicts.length > 0
      ? ["Confirm any course with multiple semester grades or an uncertain term before relying on GPA estimates."]
      : []
  };
}
