import { auditPrerequisiteGraph } from "./audit";
import { referenceFromCatalogCourse, resolveCatalogCourse } from "./normalize";
import { parsePrerequisites } from "./parser";
import type {
  AuditIssue,
  CatalogCourse,
  ParseConfidence,
  ParsedPrerequisites,
  PrerequisiteClearanceInput,
  PrerequisiteDecisionStatus,
  PrerequisiteEquivalencyInput,
  PrerequisiteRule,
  SourceConfidence
} from "./types";

export type SmccdCollegeCode = "CSM" | "SKY" | "CAN";

export interface SmccdPrerequisiteCourseInput {
  id: string;
  collegeCode: SmccdCollegeCode;
  courseCode: string;
  title: string;
  prerequisites: readonly string[];
  corequisites: readonly string[];
  recommendedPreparation: readonly string[];
  catalogUrl: string;
  sourceYear: string;
  detailStatus: "verified" | "partial" | "unavailable";
}

export interface StoredSmccdClearanceInput {
  id: string;
  targetCourseId: string;
  clearanceType: PrerequisiteClearanceInput["type"];
  status: PrerequisiteDecisionStatus;
  verificationStatus: "pending" | "approved" | "rejected";
  authority: string;
  evidenceSummary?: string | null;
  decidedAt?: string | null;
  expiresAt?: string | null;
  sourceUrl?: string | null;
}

export interface ReviewedDtechToSmccdEquivalencyInput {
  id: string;
  from: PrerequisiteEquivalencyInput["from"];
  toSmccdCourseId: string;
  appliesToTargetCourseId?: string;
  status: PrerequisiteDecisionStatus;
  verificationStatus: "pending" | "approved" | "rejected";
  authority: string;
  evidenceSummary?: string;
  sourceId?: string;
  sourceUrl?: string;
}

export interface DtechSmccdEquivalencyInput {
  normalizedCourseCode: string;
  highSchoolEquivalent: string;
  confidence: SourceConfidence;
  sourceId?: string;
  sourceUrl?: string;
}

export interface SmccdPrerequisiteAuditResult {
  courseCount: number;
  referenceCount: number;
  unresolvedClauseCount: number;
  issues: AuditIssue[];
  byCollege: Record<SmccdCollegeCode, { courseCount: number; issueCount: number }>;
}

const COLLEGE_LABELS: Record<SmccdCollegeCode, string> = {
  CSM: "College of San Mateo",
  SKY: "Skyline College",
  CAN: "Cañada College"
};

function catalogReference(course: SmccdPrerequisiteCourseInput): CatalogCourse {
  return {
    id: course.id,
    code: course.courseCode,
    name: course.title,
    aliases: [`${course.courseCode} ${course.title}`],
    sourceId: course.catalogUrl,
    sourceLabel: `${COLLEGE_LABELS[course.collegeCode]} course catalog`,
    sourceYear: course.sourceYear,
    confidence: course.detailStatus === "verified" ? "verified" : "uncertain"
  };
}

function combineRules(
  prerequisite: ParsedPrerequisites,
  corequisite: ParsedPrerequisites,
  course: SmccdPrerequisiteCourseInput
): ParsedPrerequisites {
  const prerequisiteRules = prerequisite.rule.kind === "all_of" ? prerequisite.rule.rules : [prerequisite.rule];
  const corequisiteRules = corequisite.rule.kind === "all_of" ? corequisite.rule.rules : [corequisite.rule];
  const rules = [...prerequisiteRules, ...corequisiteRules];
  const originalTexts = [...prerequisite.originalTexts, ...corequisite.originalTexts];
  const source = {
    originalText: originalTexts.join("; "),
    sourceId: course.catalogUrl,
    sourceLabel: `${COLLEGE_LABELS[course.collegeCode]} course catalog`,
    sourceYear: course.sourceYear,
    confidence: course.detailStatus === "verified" ? "verified" as const : "uncertain" as const
  };
  const rule: PrerequisiteRule = { kind: "all_of", clauseText: originalTexts.join("; "), source, rules };
  const unresolvedClauses = [...prerequisite.unresolvedClauses, ...corequisite.unresolvedClauses];
  const confidences = [prerequisite.parseConfidence, corequisite.parseConfidence];
  const parseConfidence: ParseConfidence = unresolvedClauses.length === 0
    ? "exact"
    : confidences.every((confidence) => confidence === "unresolved")
      ? "unresolved"
      : "partial";
  return { rule, parseConfidence, originalTexts, unresolvedClauses };
}

export function parseSmccdCoursePrerequisites(
  course: SmccdPrerequisiteCourseInput,
  courses: readonly SmccdPrerequisiteCourseInput[]
): ParsedPrerequisites {
  const campusCatalog = courses
    .filter((candidate) => candidate.collegeCode === course.collegeCode)
    .map(catalogReference);
  const sourceOptions = {
    catalog: campusCatalog,
    sourceId: course.catalogUrl,
    sourceLabel: `${COLLEGE_LABELS[course.collegeCode]} course catalog`,
    sourceYear: course.sourceYear,
    confidence: course.detailStatus === "verified" ? "verified" as const : "uncertain" as const
  };
  const prerequisite = parsePrerequisites(course.prerequisites, sourceOptions);
  const corequisite = parsePrerequisites(course.corequisites, { ...sourceOptions, defaultTiming: "concurrent" });
  return combineRules(prerequisite, corequisite, course);
}

export function buildSmccdPrerequisiteCatalog(
  courses: readonly SmccdPrerequisiteCourseInput[]
): CatalogCourse[] {
  return courses.map((course) => ({
    ...catalogReference(course),
    prerequisites: parseSmccdCoursePrerequisites(course, courses)
  }));
}

export function auditSmccdPrerequisites(
  courses: readonly SmccdPrerequisiteCourseInput[]
): SmccdPrerequisiteAuditResult {
  const issues: AuditIssue[] = [];
  let referenceCount = 0;
  let unresolvedClauseCount = 0;
  const byCollege = {} as SmccdPrerequisiteAuditResult["byCollege"];

  for (const collegeCode of ["CSM", "SKY", "CAN"] as const) {
    const campusCourses = courses.filter((course) => course.collegeCode === collegeCode);
    const audit = auditPrerequisiteGraph(buildSmccdPrerequisiteCatalog(campusCourses));
    issues.push(...audit.issues);
    referenceCount += audit.referenceCount;
    unresolvedClauseCount += audit.unresolvedClauseCount;
    byCollege[collegeCode] = { courseCount: campusCourses.length, issueCount: audit.issues.length };
  }

  return { courseCount: courses.length, referenceCount, unresolvedClauseCount, issues, byCollege };
}

export function clearanceFromStoredRecord(
  record: StoredSmccdClearanceInput,
  targetCourse: SmccdPrerequisiteCourseInput
): PrerequisiteClearanceInput {
  if (record.targetCourseId !== targetCourse.id) {
    throw new Error(`Clearance ${record.id} targets ${record.targetCourseId}, not ${targetCourse.id}.`);
  }
  return {
    id: record.id,
    type: record.clearanceType,
    target: { id: targetCourse.id, code: targetCourse.courseCode, name: targetCourse.title },
    status: record.verificationStatus === "approved" ? record.status : "pending",
    authority: record.authority,
    ...(record.evidenceSummary ? { evidenceSummary: record.evidenceSummary } : {}),
    ...(record.decidedAt ? { decidedAt: record.decidedAt } : {}),
    ...(record.expiresAt ? { expiresAt: record.expiresAt } : {}),
    ...(record.sourceUrl ? { sourceUrl: record.sourceUrl } : {})
  };
}

export function buildReviewedDtechToSmccdPrerequisiteEquivalencies(
  rows: readonly ReviewedDtechToSmccdEquivalencyInput[],
  courses: readonly SmccdPrerequisiteCourseInput[]
): PrerequisiteEquivalencyInput[] {
  const byId = new Map(courses.map((course) => [course.id, course]));
  return rows.flatMap((row): PrerequisiteEquivalencyInput[] => {
    const prerequisiteCourse = byId.get(row.toSmccdCourseId);
    const targetCourse = row.appliesToTargetCourseId ? byId.get(row.appliesToTargetCourseId) : undefined;
    if (!prerequisiteCourse || (row.appliesToTargetCourseId && !targetCourse)) return [];
    return [{
      id: row.id,
      from: row.from,
      to: { id: prerequisiteCourse.id, code: prerequisiteCourse.courseCode, name: prerequisiteCourse.title },
      ...(targetCourse
        ? { appliesToTarget: { id: targetCourse.id, code: targetCourse.courseCode, name: targetCourse.title } }
        : {}),
      status: row.verificationStatus === "approved" ? row.status : "pending",
      authority: row.authority,
      ...(row.evidenceSummary ? { evidenceSummary: row.evidenceSummary } : {}),
      ...(row.sourceId ? { sourceId: row.sourceId } : {}),
      ...(row.sourceUrl ? { sourceUrl: row.sourceUrl } : {})
    }];
  });
}

export function buildDtechPrerequisiteEquivalencies(
  rows: readonly DtechSmccdEquivalencyInput[],
  dtechCatalog: readonly CatalogCourse[]
): PrerequisiteEquivalencyInput[] {
  return rows.flatMap((row, index): PrerequisiteEquivalencyInput[] => {
    const target = resolveCatalogCourse({ name: row.highSchoolEquivalent }, dtechCatalog);
    if (!target) return [];
    return [
      {
        id: `dtech-smccd-prerequisite-${index + 1}`,
        from: { code: row.normalizedCourseCode, name: row.normalizedCourseCode },
        to: referenceFromCatalogCourse(target),
        status: row.confidence === "verified" ? "approved" : "pending",
        authority: "Design Tech High School equivalency chart",
        evidenceSummary: `${row.normalizedCourseCode} maps to ${row.highSchoolEquivalent}.`,
        ...(row.sourceId ? { sourceId: row.sourceId } : {}),
        ...(row.sourceUrl ? { sourceUrl: row.sourceUrl } : {})
      }
    ];
  });
}
