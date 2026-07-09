import type { ParsedTranscriptResult } from "@/server/ai-schemas";

const SECTION_PATTERN = /^(\d{2}-\d{2})\s+(.+)$/;
const COURSE_ROW_PATTERN = /^(9|10|11|12)\s+(\*)?\s*(.+)$/;
const GRADE_CREDIT_PATTERN = /\b(A\+|A-|A|B\+|B-|B|C\+|C-|C|D\+|D-|D|F|P|I|IP|NP|W)\s+(\d{1,3}(?:\.\d+)?)\b/g;
const COLLEGE_CODE_PATTERN = /^([A-Z]{2,5}\.?)\s+([A-Z]?\d{2,4}(?:\.\d)?[A-Z]?)\b/;
const DISTRICT_COLLEGES = ["College of San Mateo", "Skyline College", "Cañada College", "Canada College"];

export const TRANSCRIPT_PARSER_VERSION = "dtech-layout-text-1.1.0";

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
}

function isDistrictCollege(value: string) {
  return DISTRICT_COLLEGES.some((college) => value.toLowerCase().includes(college.toLowerCase()));
}

function fullSchoolYear(shortYear: string) {
  const [start, end] = shortYear.split("-").map(Number);
  return `${2000 + start}-${2000 + end}`;
}

function termForTitle(title: string, gradeCount: number): "fall" | "spring" | "summer" | "full_year" {
  if (/^Q1\b/i.test(title)) return "fall";
  if (/^Q[23]\b/i.test(title)) return "spring";
  if (/\bsummer\b/i.test(title)) return "summer";
  return gradeCount > 1 ? "full_year" : "full_year";
}

function cleanedCourseName(title: string) {
  return title.replace(/^Q[1-4]\s+/i, "").replace(/\s+/g, " ").trim();
}

function dtechGradeBand(grade: string) {
  return /^[A-D]/.test(grade) ? grade[0] : grade;
}

export function parseDtechTranscriptText(text: string): ParsedTranscriptResult {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const academicYears = new Set<string>();
  const institutions = new Set<string>();
  const conflicts: string[] = [];
  const courses: ParsedTranscriptResult["courses"] = [];
  let section: TranscriptSection | null = null;
  let pending: PendingCourse | null = null;

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
    if (differentGpaBands) {
      conflicts.push(`${courseName} lists semester grades in different d.tech GPA bands (${grades.join(", ")}); the latest printed grade is used for planning.`);
    }
    const isIntersessionPass = !pending.section.isCollege && /^Q[1-4]\b/i.test(rawTitle) && grades.every((grade) => grade === "P");

    courses.push({
      course_name: courseName,
      course_code: collegeCode ? `${collegeCode[1]} ${collegeCode[2]}` : null,
      subject: collegeCode?.[1]?.replace(/\.$/, "") ?? (isIntersessionPass ? "Personal Development" : null),
      grade_level: pending.gradeLevel,
      school_year: fullSchoolYear(pending.section.schoolYear),
      term: termForTitle(rawTitle, gradeMatches.length),
      letter_grade: grades.at(-1) ?? null,
      credits,
      weighted: pending.section.isCollege || /\bhonors?\b/i.test(courseName) ? true : null,
      institution_name: pending.section.institution,
      college_units: null,
      confidence: differentGpaBands ? "uncertain" : gradeMatches.length > 1 ? "likely" : "verified",
      evidence: `${pending.section.schoolYear} ${pending.section.institution}: grade ${grades.join("/")}, ${gradeMatches.map((match) => match[2]).join("+")} credits${pending.section.isCollege ? ", weighted college course" : ""}${isIntersessionPass ? ", intersession Personal Development credit" : ""}${pending.ucApproved ? ", UC-approved marker" : ""}.`
    });
    pending = null;
  };

  for (const line of lines) {
    if (/^(Comments|Legend|P\s*=|I\s*=|S0\s*=|Signature|Director|--\s*\d+\s+of)/i.test(line)) {
      flush();
      if (/^(Comments|Legend)/i.test(line)) break;
      continue;
    }
    if (/^GR\s+Course\b/i.test(line)) continue;

    const sectionMatch = line.match(SECTION_PATTERN);
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

    const courseMatch = line.match(COURSE_ROW_PATTERN);
    if (courseMatch && section) {
      flush();
      pending = {
        gradeLevel: Number(courseMatch[1]),
        ucApproved: Boolean(courseMatch[2]),
        section,
        lines: [courseMatch[3]]
      };
      continue;
    }

    if (pending) pending.lines.push(line);
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
