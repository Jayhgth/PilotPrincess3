import { courseEquivalenceKeys, normalizeCourseName } from "@/lib/course-names";
import type {
  Course,
  CourseStatus,
  GradeLevel,
  PlanCourse,
  SmccdCollege,
  SmccdCourse,
  SmccdHighSchoolEquivalency
} from "@/lib/models";
import { courseDisplayName } from "@/lib/planning";
import { normalizeSmccdCourseCode } from "@/lib/smccd";

export type AgArea = "a" | "b" | "c" | "d" | "e" | "f" | "g";

export const AG_REQUIREMENTS: Array<{ area: AgArea; name: string; requiredYears: number; rule: string }> = [
  { area: "a", name: "History", requiredYears: 2, rule: "World history plus U.S. history or government coursework." },
  { area: "b", name: "English", requiredYears: 4, rule: "Four years of UC-approved college-preparatory English." },
  { area: "c", name: "Mathematics", requiredYears: 3, rule: "Three years including algebra and geometry; a fourth year is recommended." },
  { area: "d", name: "Science", requiredYears: 2, rule: "Two years covering at least two of biology, chemistry, or physics; a third year is recommended." },
  { area: "e", name: "Language other than English", requiredYears: 2, rule: "Two years or verified second-level proficiency in the same language." },
  { area: "f", name: "Visual and performing arts", requiredYears: 1, rule: "One year in one approved arts discipline." },
  { area: "g", name: "College-preparatory elective", requiredYears: 1, rule: "One approved elective year or verified coursework beyond the A-F minimums." }
];

export interface AgCourseEvidence {
  planCourseId: string;
  courseName: string;
  area: AgArea;
  status: CourseStatus;
  yearsApplied: number;
  yearsAvailable: number;
  gradeLevel: GradeLevel;
  letterGrade: string | null;
  institution: "dtech" | "smccd" | SmccdCollege["code"];
  source: string;
  note: string | null;
}

export interface AgIssue {
  planCourseId: string;
  courseName: string;
  institution: AgCourseEvidence["institution"];
  reason: string;
}

export interface AgAreaProgress {
  area: AgArea;
  name: string;
  requiredYears: number;
  completedYears: number;
  currentYears: number;
  plannedYears: number;
  remainingYears: number;
  status: "complete" | "covered" | "missing";
  rule: string;
  contributions: AgCourseEvidence[];
  unusedCourses: AgCourseEvidence[];
}

export interface AgProgress {
  areas: AgAreaProgress[];
  completedYears: number;
  projectedYears: number;
  requiredYears: number;
  completedPercent: number;
  projectedPercent: number;
  completedBeforeSeniorYears: number;
  projectedBeforeSeniorYears: number;
  unresolved: AgIssue[];
  duplicates: AgIssue[];
  notApplicableCount: number;
}

interface Candidate extends Omit<AgCourseEvidence, "yearsApplied" | "note"> {
  canonicalKey: string;
  qualificationNote: string | null;
}

export function calculateAgProgress(
  planCourses: PlanCourse[],
  courses: Course[],
  smccdCourses: SmccdCourse[],
  equivalencies: SmccdHighSchoolEquivalency[]
): AgProgress {
  const courseMap = new Map(courses.map((course) => [course.id, course]));
  const smccdMap = new Map(smccdCourses.map((course) => [course.id, course]));
  const equivalencyMap = new Map(equivalencies.map((equivalency) => [normalizeSmccdCourseCode(equivalency.normalized_course_code), equivalency]));
  const agCourseByKey = new Map<string, Course>();
  for (const course of courses.filter((candidate) => parseAgArea(candidate.uc_ag_area))) {
    for (const key of courseEquivalenceKeys(course.name)) if (!agCourseByKey.has(key)) agCourseByKey.set(key, course);
  }

  const candidates: Candidate[] = [];
  const unresolved: AgIssue[] = [];
  let notApplicableCount = 0;

  for (const row of planCourses) {
    const courseName = courseDisplayName(row, courseMap);
    const institution = institutionForRow(row);
    if (!row.mapping_verified) {
      if (row.smccd_course_id || row.course_id) unresolved.push({ planCourseId: row.id, courseName, institution, reason: "The catalog match is not verified." });
      continue;
    }

    let area: AgArea;
    let years = Number(row.credits ?? 0) / 10;
    let source = "Official d.tech A-G course list";
    let identityName = courseName;

    if (row.course_id) {
      const catalogCourse = courseMap.get(row.course_id);
      const catalogArea = parseAgArea(catalogCourse?.uc_ag_area);
      if (!catalogArea) {
        if (catalogCourse?.confidence !== "verified") {
          unresolved.push({ planCourseId: row.id, courseName, institution, reason: "The official catalog does not yet show an approved A-G area." });
        } else {
          notApplicableCount += 1;
        }
        continue;
      }
      area = catalogArea;
    } else if (row.smccd_course_id) {
      const smccdCourse = smccdMap.get(row.smccd_course_id);
      const equivalency = smccdCourse ? equivalencyMap.get(normalizeSmccdCourseCode(smccdCourse.course_code)) : null;
      const equivalentCourse = equivalency ? findEquivalentAgCourse(equivalency.high_school_equivalent, agCourseByKey) : null;
      const equivalentArea = parseAgArea(equivalentCourse?.uc_ag_area);
      if (!smccdCourse || !equivalency || !equivalentCourse || !equivalentArea) {
        unresolved.push({
          planCourseId: row.id,
          courseName,
          institution,
          reason: "This college course has no exact reviewed link to a d.tech A-G-approved course."
        });
        continue;
      }
      area = equivalentArea;
      if (!smccdCourse.transfer_credit?.includes("UC") || Number(row.college_units ?? 0) < 3) {
        unresolved.push({
          planCourseId: row.id,
          courseName,
          institution,
          reason: "UC requires an eligible college course worth at least 3 semester units."
        });
        continue;
      }
      years = Number(equivalency.high_school_credits) / 10;
      identityName = equivalency.high_school_equivalent;
      source = "Reviewed d.tech-SMCCD equivalency plus UC transfer status";
    } else {
      if (row.requirement_area_override !== "personal_development" && row.letter_grade?.toUpperCase() !== "P") {
        unresolved.push({ planCourseId: row.id, courseName, institution, reason: "No official A-G catalog course is linked." });
      } else {
        notApplicableCount += 1;
      }
      continue;
    }

    if (years <= 0) continue;
    const qualificationNote = area === "e" && isSecondLevelLanguage(identityName)
      ? "Verified second-level or higher language coursework satisfies the two-year sequence."
      : null;
    if (qualificationNote) years = Math.max(years, 2);
    if (!gradeCanProject(row)) {
      unresolved.push({
        planCourseId: row.id,
        courseName,
        institution,
        reason: row.status === "completed" ? "A-G requires a final grade of C or better." : "The entered projected grade is below C."
      });
      continue;
    }

    candidates.push({
      planCourseId: row.id,
      courseName,
      area,
      status: row.status,
      yearsAvailable: round(years),
      gradeLevel: row.grade_level,
      letterGrade: row.letter_grade,
      institution,
      source,
      canonicalKey: `${area}:${normalizeCourseName(identityName)}`,
      qualificationNote
    });
  }

  const deduped: Candidate[] = [];
  const duplicates: AgIssue[] = [];
  for (const candidate of [...candidates].sort(compareCandidatePriority)) {
    if (deduped.some((existing) => existing.canonicalKey === candidate.canonicalKey)) {
      duplicates.push({
        planCourseId: candidate.planCourseId,
        courseName: candidate.courseName,
        institution: candidate.institution,
        reason: "A stronger or more advanced copy of this same course is already counted."
      });
    } else {
      deduped.push(candidate);
    }
  }

  const overflowForG: Candidate[] = [];
  const areaResults = new Map<AgArea, AgAreaProgress>();
  for (const requirement of AG_REQUIREMENTS.filter((item) => item.area !== "g")) {
    const allocation = allocateArea(deduped.filter((candidate) => candidate.area === requirement.area), requirement.requiredYears, requirement.area);
    overflowForG.push(...allocation.overflow);
    areaResults.set(requirement.area, buildAreaProgress(requirement, allocation.applied, allocation.unused));
  }

  const gRequirement = AG_REQUIREMENTS.find((item) => item.area === "g")!;
  const directG = deduped.filter((candidate) => candidate.area === "g");
  const gAllocation = allocateArea([...directG, ...overflowForG], gRequirement.requiredYears, "g", true);
  areaResults.set("g", buildAreaProgress(gRequirement, gAllocation.applied, gAllocation.unused));

  const areas = AG_REQUIREMENTS.map((requirement) => areaResults.get(requirement.area)!);
  const completedYears = round(areas.reduce((sum, area) => sum + area.completedYears, 0));
  const projectedYears = round(areas.reduce((sum, area) => sum + area.completedYears + area.currentYears + area.plannedYears, 0));
  const requiredYears = AG_REQUIREMENTS.reduce((sum, area) => sum + area.requiredYears, 0);
  const applied = areas.flatMap((area) => area.contributions);
  const completedBeforeSeniorYears = round(applied.filter((course) => course.status === "completed" && course.gradeLevel <= 11).reduce((sum, course) => sum + course.yearsApplied, 0));
  const projectedBeforeSeniorYears = round(applied.filter((course) => course.gradeLevel <= 11).reduce((sum, course) => sum + course.yearsApplied, 0));

  return {
    areas,
    completedYears,
    projectedYears,
    requiredYears,
    completedPercent: Math.min(100, Math.round((completedYears / requiredYears) * 100)),
    projectedPercent: Math.min(100, Math.round((projectedYears / requiredYears) * 100)),
    completedBeforeSeniorYears,
    projectedBeforeSeniorYears,
    unresolved,
    duplicates,
    notApplicableCount
  };
}

function allocateArea(candidates: Candidate[], requiredYears: number, area: AgArea, fromOverflow = false) {
  let remaining = requiredYears;
  const applied: AgCourseEvidence[] = [];
  const overflow: Candidate[] = [];
  const unused: AgCourseEvidence[] = [];

  for (const candidate of [...candidates].sort(compareCandidatePriority)) {
    const yearsApplied = Math.min(candidate.yearsAvailable, remaining);
    if (yearsApplied > 0) {
      applied.push({
        ...candidate,
        area,
        yearsApplied: round(yearsApplied),
        note: fromOverflow && candidate.area !== "g"
          ? `Additional ${candidate.area.toUpperCase()} coursework is applied to G.`
          : candidate.qualificationNote
      });
      remaining -= yearsApplied;
    }
    const yearsUnused = round(candidate.yearsAvailable - yearsApplied);
    if (yearsUnused > 0) {
      const unusedCandidate = { ...candidate, yearsAvailable: yearsUnused };
      if (!fromOverflow && candidate.area !== "g") overflow.push(unusedCandidate);
      else unused.push({ ...unusedCandidate, area, yearsApplied: 0, note: "Approved coursework beyond the required minimum." });
    }
  }

  return { applied, overflow, unused };
}

function buildAreaProgress(
  requirement: (typeof AG_REQUIREMENTS)[number],
  contributions: AgCourseEvidence[],
  unusedCourses: AgCourseEvidence[]
): AgAreaProgress {
  const completedYears = sumStatus(contributions, "completed");
  const currentYears = sumStatus(contributions, "current");
  const plannedYears = sumStatus(contributions, "planned");
  const projected = completedYears + currentYears + plannedYears;
  return {
    ...requirement,
    completedYears,
    currentYears,
    plannedYears,
    remainingYears: round(Math.max(0, requirement.requiredYears - projected)),
    status: completedYears >= requirement.requiredYears ? "complete" : projected >= requirement.requiredYears ? "covered" : "missing",
    contributions,
    unusedCourses
  };
}

function sumStatus(courses: AgCourseEvidence[], status: CourseStatus) {
  return round(courses.filter((course) => course.status === status).reduce((sum, course) => sum + course.yearsApplied, 0));
}

function parseAgArea(value: string | null | undefined): AgArea | null {
  const area = value?.trim().match(/^([a-g])\b/i)?.[1]?.toLowerCase();
  return area && "abcdefg".includes(area) ? area as AgArea : null;
}

function findEquivalentAgCourse(value: string, courseByKey: Map<string, Course>) {
  for (const key of courseEquivalenceKeys(value)) {
    const course = courseByKey.get(key);
    if (course) return course;
  }
  return null;
}

function gradeCanProject(row: PlanCourse) {
  const grade = row.letter_grade?.trim().toUpperCase() ?? "";
  if (row.status !== "completed" && (!grade || grade === "IP")) return true;
  return ["A+", "A", "A-", "B+", "B", "B-", "C+", "C"].includes(grade);
}

function isSecondLevelLanguage(value: string) {
  return /\b(?:2|ii|3|iii|4|iv)\b/i.test(value);
}

function institutionForRow(row: PlanCourse): AgCourseEvidence["institution"] {
  const prefix = row.smccd_course_id?.split(":", 1)[0];
  return prefix === "CSM" || prefix === "SKY" || prefix === "CAN" ? prefix : row.smccd_course_id ? "smccd" : "dtech";
}

function compareCandidatePriority(a: Candidate, b: Candidate) {
  return statusRank(b.status) - statusRank(a.status) || a.gradeLevel - b.gradeLevel || a.courseName.localeCompare(b.courseName);
}

function statusRank(status: CourseStatus) {
  return status === "completed" ? 3 : status === "current" ? 2 : 1;
}

function round(value: number) {
  return Math.round(value * 10) / 10;
}
