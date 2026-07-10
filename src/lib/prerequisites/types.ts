export type GradeLevel = 9 | 10 | 11 | 12;

export type SourceConfidence = "verified" | "likely" | "uncertain" | "unknown";

export type ParseConfidence = "exact" | "partial" | "unresolved";

export interface PrerequisiteSourceContext {
  originalText: string;
  sourceId?: string;
  sourceLabel?: string;
  sourceYear?: string;
  confidence: SourceConfidence;
}

interface RuleBase {
  clauseText: string;
  source: PrerequisiteSourceContext;
}

export interface AllOfRule extends RuleBase {
  kind: "all_of";
  rules: PrerequisiteRule[];
}

export interface AnyOfRule extends RuleBase {
  kind: "any_of";
  rules: PrerequisiteRule[];
}

export interface CourseReference {
  id?: string;
  code?: string;
  name: string;
  aliases?: string[];
}

export type CourseTiming = "prior" | "prior_or_concurrent" | "concurrent";

export type LetterGrade =
  | "A+"
  | "A"
  | "A-"
  | "B+"
  | "B"
  | "B-"
  | "C+"
  | "C"
  | "C-"
  | "D+"
  | "D"
  | "D-"
  | "F";

export interface CourseRule extends RuleBase {
  kind: "course";
  course: CourseReference;
  timing: CourseTiming;
  minimumGrade?: LetterGrade;
}

export type PrerequisiteClearanceType =
  | "placement"
  | "approved_equivalency"
  | "prerequisite_challenge"
  | "instructor_approval"
  | "program_admission"
  | "audition_or_portfolio";

export interface ClearanceRule extends RuleBase {
  kind: "clearance";
  clearanceType: PrerequisiteClearanceType;
  authorityText: string;
}

export type GradeLevelConstraint =
  | { kind: "minimum"; grade: GradeLevel }
  | { kind: "maximum"; grade: GradeLevel }
  | { kind: "one_of"; grades: GradeLevel[] };

export interface GradeLevelRule extends RuleBase {
  kind: "grade_level";
  constraint: GradeLevelConstraint;
}

export type UnresolvedReason =
  | "approval_required"
  | "ambiguous_boolean"
  | "ambiguous_recommendation"
  | "equivalency_not_defined"
  | "placement_not_defined"
  | "unsupported_language"
  | "unknown_clause";

export interface UnresolvedRule extends RuleBase {
  kind: "unresolved";
  reason: UnresolvedReason;
  explanation: string;
  counselorQuestion: string;
}

export type PrerequisiteRule = AllOfRule | AnyOfRule | CourseRule | ClearanceRule | GradeLevelRule | UnresolvedRule;

export interface ParsedPrerequisites {
  rule: PrerequisiteRule;
  parseConfidence: ParseConfidence;
  originalTexts: string[];
  unresolvedClauses: UnresolvedRule[];
}

export interface CatalogCourse {
  id: string;
  code?: string | null;
  name: string;
  aliases?: readonly string[];
  gradeLevels?: readonly GradeLevel[];
  prerequisites?: readonly string[] | ParsedPrerequisites | PrerequisiteRule;
  sourceId?: string;
  sourceLabel?: string;
  sourceYear?: string;
  confidence?: SourceConfidence;
}

export interface ParsePrerequisiteOptions {
  catalog?: readonly CatalogCourse[];
  sourceId?: string;
  sourceLabel?: string;
  sourceYear?: string;
  confidence?: SourceConfidence;
  defaultTiming?: CourseTiming;
}

export type PlannedCourseStatus = "completed" | "current" | "planned";

export interface PlannedCourseInput {
  instanceId?: string;
  courseId?: string;
  code?: string | null;
  name: string;
  aliases?: readonly string[];
  status: PlannedCourseStatus;
  termIndex?: number;
  gradeLevel?: GradeLevel;
  grade?: string | null;
  source?: "transcript" | "manual" | "catalog";
}

export interface PrerequisiteEvaluationInput {
  target: {
    instanceId?: string;
    courseId?: string;
    code?: string | null;
    name: string;
    termIndex: number;
    gradeLevel?: GradeLevel;
  };
  courses: readonly PlannedCourseInput[];
  clearances?: readonly PrerequisiteClearanceInput[];
  equivalencies?: readonly PrerequisiteEquivalencyInput[];
}

export type PrerequisiteDecisionStatus = "approved" | "pending" | "denied";

export interface PrerequisiteClearanceInput {
  id: string;
  type: PrerequisiteClearanceType;
  target: CourseReference;
  status: PrerequisiteDecisionStatus;
  authority: string;
  evidenceSummary?: string;
  decidedAt?: string;
  expiresAt?: string;
  sourceUrl?: string;
}

export interface PrerequisiteEquivalencyInput {
  id: string;
  from: CourseReference;
  to: CourseReference;
  appliesToTarget?: CourseReference;
  status: PrerequisiteDecisionStatus;
  authority: string;
  evidenceSummary?: string;
  sourceId?: string;
  sourceUrl?: string;
}

export type PrerequisiteEvaluationStatus = "satisfied" | "blocked" | "needs_review";

export interface MissingCourse {
  course: CourseReference;
  timing: CourseTiming;
  minimumGrade?: LetterGrade;
  reason: "not_in_plan" | "minimum_grade_not_met";
  message: string;
}

export interface OrderingViolation {
  course: CourseReference;
  requiredTiming: CourseTiming;
  targetTermIndex: number;
  foundTermIndexes: number[];
  courseInstanceIds: string[];
  message: string;
}

export type EvidenceKind = "course" | "clearance" | "grade_level" | "manual_review";

export interface PrerequisiteEvidence {
  kind: EvidenceKind;
  satisfied: boolean | null;
  message: string;
  clauseText: string;
  source: PrerequisiteSourceContext;
  courseInstanceId?: string;
  matchedBy?: "id" | "code" | "name" | "alias" | "equivalency";
  observedGrade?: string;
  observedTermIndex?: number;
}

export interface PrerequisiteEvaluationResult {
  status: PrerequisiteEvaluationStatus;
  missingCourses: MissingCourse[];
  orderingViolations: OrderingViolation[];
  evidence: PrerequisiteEvidence[];
  suggestedCounselorQuestions: string[];
}

export type AuditIssue =
  | {
      kind: "missing_catalog_reference";
      severity: "error";
      courseId: string;
      courseName: string;
      reference: CourseReference;
      sourceText: string;
      message: string;
    }
  | {
      kind: "cycle";
      severity: "error" | "warning";
      courseIds: string[];
      courseNames: string[];
      includesPriorRequirement: boolean;
      message: string;
    }
  | {
      kind: "impossible_grade_sequence";
      severity: "error";
      courseId: string;
      courseName: string;
      prerequisiteName?: string;
      sourceText: string;
      message: string;
    }
  | {
      kind: "unresolved_prerequisite";
      severity: "warning";
      courseId: string;
      courseName: string;
      sourceText: string;
      reason: UnresolvedReason;
      message: string;
    };

export interface PrerequisiteGraphAudit {
  courseCount: number;
  parsedCourseCount: number;
  referenceCount: number;
  unresolvedClauseCount: number;
  issues: AuditIssue[];
}
