import { courseIdentityMatch, plannedCourseIdentity } from "./normalize";
import type {
  ClearanceRule,
  CourseRule,
  GradeLevelConstraint,
  LetterGrade,
  MissingCourse,
  OrderingViolation,
  PlannedCourseInput,
  PrerequisiteEvaluationInput,
  PrerequisiteEvaluationResult,
  PrerequisiteEvidence,
  PrerequisiteRule
} from "./types";

type NodeState = "pass" | "fail" | "review";

interface NodeResult {
  state: NodeState;
  missingCourses: MissingCourse[];
  orderingViolations: OrderingViolation[];
  evidence: PrerequisiteEvidence[];
  questions: string[];
}

type TermRelation = "prior" | "same" | "future" | "unknown";

interface MatchedCourse {
  course: PlannedCourseInput;
  match: {
    matched: true;
    matchedBy: "id" | "code" | "name" | "alias" | "equivalency";
  };
  equivalencyAuthority?: string;
}

function targetIdentity(input: PrerequisiteEvaluationInput) {
  return {
    ...(input.target.courseId ? { id: input.target.courseId } : {}),
    code: input.target.code,
    name: input.target.name
  };
}

function equivalencyAppliesToTarget(
  equivalency: NonNullable<PrerequisiteEvaluationInput["equivalencies"]>[number],
  input: PrerequisiteEvaluationInput
): boolean {
  return !equivalency.appliesToTarget || courseIdentityMatch(equivalency.appliesToTarget, targetIdentity(input)).matched;
}

const GRADE_RANK: Record<LetterGrade, number> = {
  "A+": 12,
  A: 11,
  "A-": 10,
  "B+": 9,
  B: 8,
  "B-": 7,
  "C+": 6,
  C: 5,
  "C-": 4,
  "D+": 3,
  D: 2,
  "D-": 1,
  F: 0
};

function normalizeGrade(value: string | null | undefined): LetterGrade | undefined {
  if (!value) return undefined;
  const grade = value.trim().toUpperCase() as LetterGrade;
  return grade in GRADE_RANK ? grade : undefined;
}

function relationToTarget(course: PlannedCourseInput, targetTermIndex: number): TermRelation {
  if (course.termIndex === undefined) return course.status === "completed" ? "prior" : "unknown";
  if (course.termIndex < targetTermIndex) return "prior";
  if (course.termIndex === targetTermIndex) return "same";
  return "future";
}

function timingAllows(rule: CourseRule, relation: TermRelation): boolean {
  if (rule.timing === "prior") return relation === "prior";
  if (rule.timing === "concurrent") return relation === "same";
  return relation === "prior" || relation === "same";
}

function timingLabel(rule: CourseRule): string {
  if (rule.timing === "prior") return "in an earlier term";
  if (rule.timing === "concurrent") return "in the same term";
  return "in an earlier or the same term";
}

function evaluateCourseRule(rule: CourseRule, input: PrerequisiteEvaluationInput): NodeResult {
  const matching = input.courses
    .filter((course) => !input.target.instanceId || course.instanceId !== input.target.instanceId)
    .map((course): MatchedCourse | null => {
      const direct = courseIdentityMatch(rule.course, plannedCourseIdentity(course));
      if (direct.matched && direct.matchedBy) {
        return { course, match: { matched: true, matchedBy: direct.matchedBy } };
      }
      const approvedEquivalency = input.equivalencies?.find(
        (equivalency) =>
          equivalency.status === "approved" &&
          equivalencyAppliesToTarget(equivalency, input) &&
          courseIdentityMatch(equivalency.from, plannedCourseIdentity(course)).matched &&
          courseIdentityMatch(equivalency.to, rule.course).matched
      );
      return approvedEquivalency
        ? {
            course,
            match: { matched: true, matchedBy: "equivalency" },
            equivalencyAuthority: approvedEquivalency.authority
          }
        : null;
    })
    .filter((match): match is MatchedCourse => match !== null);

  if (matching.length === 0) {
    const pendingEquivalency = input.equivalencies?.find(
      (equivalency) =>
        equivalency.status === "pending" &&
        equivalencyAppliesToTarget(equivalency, input) &&
        courseIdentityMatch(equivalency.to, rule.course).matched &&
        input.courses.some((course) => courseIdentityMatch(equivalency.from, plannedCourseIdentity(course)).matched)
    );
    if (pendingEquivalency) {
      return {
        state: "review",
        missingCourses: [],
        orderingViolations: [],
        evidence: [
          {
            kind: "clearance",
            satisfied: null,
            message: `${pendingEquivalency.authority} has not yet approved the directional equivalency from ${pendingEquivalency.from.name} to ${pendingEquivalency.to.name}.`,
            clauseText: rule.clauseText,
            source: rule.source,
            matchedBy: "equivalency"
          }
        ],
        questions: [`Has ${pendingEquivalency.authority} approved ${pendingEquivalency.from.name} as satisfying ${rule.course.name}?`]
      };
    }
    const gradeText = rule.minimumGrade ? ` with ${rule.minimumGrade} or better` : "";
    return {
      state: "fail",
      missingCourses: [
        {
          course: rule.course,
          timing: rule.timing,
          ...(rule.minimumGrade ? { minimumGrade: rule.minimumGrade } : {}),
          reason: "not_in_plan",
          message: `${rule.course.name}${gradeText} is not present ${timingLabel(rule)}.`
        }
      ],
      orderingViolations: [],
      evidence: [
        {
          kind: "course",
          satisfied: false,
          message: `No exact identifier, code, name, or declared alias matched ${rule.course.name}.`,
          clauseText: rule.clauseText,
          source: rule.source
        }
      ],
      questions: [`Does ${input.target.name} require ${rule.course.name} ${timingLabel(rule)}, or is another course accepted?`]
    };
  }

  const acceptable = matching.filter(({ course }) => timingAllows(rule, relationToTarget(course, input.target.termIndex)));
  const wrongOrder = matching.filter(({ course }) => {
    const relation = relationToTarget(course, input.target.termIndex);
    return relation !== "unknown" && !timingAllows(rule, relation);
  });
  const unknownOrder = matching.filter(
    ({ course }) => relationToTarget(course, input.target.termIndex) === "unknown"
  );

  const orderingViolations: OrderingViolation[] = wrongOrder.length
    ? [
        {
          course: rule.course,
          requiredTiming: rule.timing,
          targetTermIndex: input.target.termIndex,
          foundTermIndexes: wrongOrder
            .map(({ course }) => course.termIndex)
            .filter((term): term is number => term !== undefined),
          courseInstanceIds: wrongOrder.map(({ course }) => course.instanceId).filter((id): id is string => Boolean(id)),
          message: `${rule.course.name} is in the plan, but not ${timingLabel(rule)} for ${input.target.name}.`
        }
      ]
    : [];

  if (acceptable.length === 0) {
    if (unknownOrder.length > 0) {
      return {
        state: "review",
        missingCourses: [],
        orderingViolations,
        evidence: unknownOrder.map(({ course, match }) => ({
          kind: "course",
          satisfied: null,
          message: `${course.name} matches, but its term is not known.`,
          clauseText: rule.clauseText,
          source: rule.source,
          courseInstanceId: course.instanceId,
          matchedBy: match.matchedBy
        })),
        questions: [`Which term was ${rule.course.name} taken, and was it ${timingLabel(rule)} for ${input.target.name}?`]
      };
    }
    return {
      state: "fail",
      missingCourses: [],
      orderingViolations,
      evidence: wrongOrder.map(({ course, match }) => ({
        kind: "course",
        satisfied: false,
        message: `${course.name} matches but is ordered incorrectly.`,
        clauseText: rule.clauseText,
        source: rule.source,
        courseInstanceId: course.instanceId,
        matchedBy: match.matchedBy,
        ...(course.termIndex !== undefined ? { observedTermIndex: course.termIndex } : {})
      })),
      questions: [`May ${rule.course.name} be taken in the planned term shown for ${input.target.name}, or must the order change?`]
    };
  }

  if (!rule.minimumGrade) {
    const [{ course, match, equivalencyAuthority }] = acceptable;
    return {
      state: "pass",
      missingCourses: [],
      orderingViolations: [],
      evidence: [
        {
          kind: "course",
          satisfied: true,
          message: equivalencyAuthority
            ? `${course.name} satisfies the ${timingLabel(rule)} course requirement through the approved mapping from ${equivalencyAuthority}.`
            : `${course.name} satisfies the ${timingLabel(rule)} course requirement.`,
          clauseText: rule.clauseText,
          source: rule.source,
          courseInstanceId: course.instanceId,
          matchedBy: match.matchedBy,
          ...(course.termIndex !== undefined ? { observedTermIndex: course.termIndex } : {})
        }
      ],
      questions: []
    };
  }

  const graded = acceptable.map(({ course, match }) => ({ course, match, grade: normalizeGrade(course.grade) }));
  const passing = graded.find(({ grade }) => grade !== undefined && GRADE_RANK[grade] >= GRADE_RANK[rule.minimumGrade!]);
  if (passing) {
    return {
      state: "pass",
      missingCourses: [],
      orderingViolations: [],
      evidence: [
        {
          kind: "course",
          satisfied: true,
          message: `${passing.course.name} with ${passing.grade} meets the explicit ${rule.minimumGrade} minimum.`,
          clauseText: rule.clauseText,
          source: rule.source,
          courseInstanceId: passing.course.instanceId,
          matchedBy: passing.match.matchedBy,
          observedGrade: passing.course.grade ?? undefined,
          ...(passing.course.termIndex !== undefined ? { observedTermIndex: passing.course.termIndex } : {})
        }
      ],
      questions: []
    };
  }

  const unknownGrades = graded.filter(({ grade }) => grade === undefined);
  if (unknownGrades.length > 0) {
    return {
      state: "review",
      missingCourses: [],
      orderingViolations: [],
      evidence: unknownGrades.map(({ course, match }) => ({
        kind: "course",
        satisfied: null,
        message: `${course.name} matches, but its grade does not establish the ${rule.minimumGrade} minimum.`,
        clauseText: rule.clauseText,
        source: rule.source,
        courseInstanceId: course.instanceId,
        matchedBy: match.matchedBy,
        ...(course.grade ? { observedGrade: course.grade } : {}),
        ...(course.termIndex !== undefined ? { observedTermIndex: course.termIndex } : {})
      })),
      questions: [`What verified grade was earned in ${rule.course.name}, and does it meet the ${rule.minimumGrade} minimum?`]
    };
  }

  const observed = graded.map(({ grade }) => grade).filter((grade): grade is LetterGrade => grade !== undefined);
  return {
    state: "fail",
    missingCourses: [
      {
        course: rule.course,
        timing: rule.timing,
        minimumGrade: rule.minimumGrade,
        reason: "minimum_grade_not_met",
        message: `${rule.course.name} is present, but ${observed.join("/")} does not meet the ${rule.minimumGrade} minimum.`
      }
    ],
    orderingViolations: [],
    evidence: graded.map(({ course, match, grade }) => ({
      kind: "course",
      satisfied: false,
      message: `${course.name} with ${grade} is below the explicit ${rule.minimumGrade} minimum.`,
      clauseText: rule.clauseText,
      source: rule.source,
      courseInstanceId: course.instanceId,
      matchedBy: match.matchedBy,
      observedGrade: course.grade ?? undefined,
      ...(course.termIndex !== undefined ? { observedTermIndex: course.termIndex } : {})
    })),
    questions: [`Does d.tech accept any grade or evidence other than ${rule.minimumGrade} or better for ${rule.course.name}?`]
  };
}

function evaluateClearanceRule(rule: ClearanceRule, input: PrerequisiteEvaluationInput): NodeResult {
  const clearance = input.clearances?.find(
    (candidate) => candidate.type === rule.clearanceType && courseIdentityMatch(candidate.target, targetIdentity(input)).matched
  );
  const typeLabel = rule.clearanceType.replaceAll("_", " ");
  if (!clearance) {
    return {
      state: "review",
      missingCourses: [],
      orderingViolations: [],
      evidence: [
        {
          kind: "clearance",
          satisfied: null,
          message: `No official ${typeLabel} decision is recorded for ${input.target.name}.`,
          clauseText: rule.clauseText,
          source: rule.source
        }
      ],
      questions: [`Has the college recorded an approved ${typeLabel} decision for ${input.target.name}?`]
    };
  }

  const parsedExpiry = clearance.expiresAt ? Date.parse(clearance.expiresAt) : undefined;
  const invalidExpiry = parsedExpiry !== undefined && Number.isNaN(parsedExpiry);
  const expired = parsedExpiry !== undefined && !invalidExpiry && parsedExpiry < Date.now();
  if (invalidExpiry) {
    return {
      state: "review",
      missingCourses: [],
      orderingViolations: [],
      evidence: [
        {
          kind: "clearance",
          satisfied: null,
          message: `${clearance.authority} supplied an invalid expiration date for the ${typeLabel} decision.`,
          clauseText: rule.clauseText,
          source: rule.source
        }
      ],
      questions: [`What is the verified expiration date for the ${typeLabel} decision for ${input.target.name}?`]
    };
  }
  if (clearance.status === "approved" && !expired) {
    return {
      state: "pass",
      missingCourses: [],
      orderingViolations: [],
      evidence: [
        {
          kind: "clearance",
          satisfied: true,
          message: `${clearance.authority} approved the ${typeLabel} requirement${clearance.evidenceSummary ? `: ${clearance.evidenceSummary}` : "."}`,
          clauseText: rule.clauseText,
          source: rule.source
        }
      ],
      questions: []
    };
  }

  if (clearance.status === "denied") {
    return {
      state: "fail",
      missingCourses: [],
      orderingViolations: [],
      evidence: [
        {
          kind: "clearance",
          satisfied: false,
          message: `${clearance.authority} denied the ${typeLabel} requirement${clearance.evidenceSummary ? `: ${clearance.evidenceSummary}` : "."}`,
          clauseText: rule.clauseText,
          source: rule.source
        }
      ],
      questions: [`What approved alternate path is available after the denied ${typeLabel} decision for ${input.target.name}?`]
    };
  }

  return {
    state: "review",
    missingCourses: [],
    orderingViolations: [],
    evidence: [
      {
        kind: "clearance",
        satisfied: null,
        message: expired
          ? `${clearance.authority}'s ${typeLabel} approval has expired.`
          : `${clearance.authority}'s ${typeLabel} decision is still pending.`,
        clauseText: rule.clauseText,
        source: rule.source
      }
    ],
    questions: [`What is the current approved ${typeLabel} status for ${input.target.name}?`]
  };
}

function gradeLevelPasses(constraint: GradeLevelConstraint, grade: number): boolean {
  if (constraint.kind === "minimum") return grade >= constraint.grade;
  if (constraint.kind === "maximum") return grade <= constraint.grade;
  return constraint.grades.includes(grade as (typeof constraint.grades)[number]);
}

function constraintLabel(constraint: GradeLevelConstraint): string {
  if (constraint.kind === "minimum") return `grade ${constraint.grade} or higher`;
  if (constraint.kind === "maximum") return `grade ${constraint.grade} or lower`;
  return `grade ${constraint.grades.join(" or ")}`;
}

function combine(results: NodeResult[], state: NodeState): NodeResult {
  return {
    state,
    missingCourses: results.flatMap((result) => result.missingCourses),
    orderingViolations: results.flatMap((result) => result.orderingViolations),
    evidence: results.flatMap((result) => result.evidence),
    questions: results.flatMap((result) => result.questions)
  };
}

function evaluateRule(rule: PrerequisiteRule, input: PrerequisiteEvaluationInput): NodeResult {
  if (rule.kind === "course") return evaluateCourseRule(rule, input);
  if (rule.kind === "clearance") return evaluateClearanceRule(rule, input);
  if (rule.kind === "unresolved") {
    return {
      state: "review",
      missingCourses: [],
      orderingViolations: [],
      evidence: [
        {
          kind: "manual_review",
          satisfied: null,
          message: rule.explanation,
          clauseText: rule.clauseText,
          source: rule.source
        }
      ],
      questions: [rule.counselorQuestion]
    };
  }
  if (rule.kind === "grade_level") {
    const grade = input.target.gradeLevel;
    if (grade === undefined) {
      return {
        state: "review",
        missingCourses: [],
        orderingViolations: [],
        evidence: [
          {
            kind: "grade_level",
            satisfied: null,
            message: `The target grade is missing; ${constraintLabel(rule.constraint)} cannot be checked.`,
            clauseText: rule.clauseText,
            source: rule.source
          }
        ],
        questions: [`Which grade level applies when taking ${input.target.name}?`]
      };
    }
    const passes = gradeLevelPasses(rule.constraint, grade);
    return {
      state: passes ? "pass" : "fail",
      missingCourses: [],
      orderingViolations: [],
      evidence: [
        {
          kind: "grade_level",
          satisfied: passes,
          message: passes
            ? `Grade ${grade} satisfies the ${constraintLabel(rule.constraint)} constraint.`
            : `Grade ${grade} does not satisfy the ${constraintLabel(rule.constraint)} constraint.`,
          clauseText: rule.clauseText,
          source: rule.source
        }
      ],
      questions: passes ? [] : [`Can a grade ${grade} student enroll in ${input.target.name} despite the catalog grade constraint?`]
    };
  }

  const childResults = rule.rules.map((child) => evaluateRule(child, input));
  if (rule.kind === "all_of") {
    const state = childResults.some((result) => result.state === "fail")
      ? "fail"
      : childResults.some((result) => result.state === "review")
        ? "review"
        : "pass";
    return combine(childResults, state);
  }

  const passing = childResults.filter((result) => result.state === "pass");
  if (passing.length > 0) return combine(passing, "pass");
  const state = childResults.some((result) => result.state === "review") ? "review" : "fail";
  return combine(childResults, state);
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

export function evaluatePrerequisites(
  rule: PrerequisiteRule,
  input: PrerequisiteEvaluationInput
): PrerequisiteEvaluationResult {
  const result = evaluateRule(rule, input);
  return {
    status: result.state === "pass" ? "satisfied" : result.state === "fail" ? "blocked" : "needs_review",
    missingCourses: uniqueBy(
      result.missingCourses,
      (missing) => `${missing.course.id ?? missing.course.code ?? missing.course.name}:${missing.timing}:${missing.minimumGrade ?? ""}:${missing.reason}`
    ),
    orderingViolations: uniqueBy(
      result.orderingViolations,
      (violation) => `${violation.course.id ?? violation.course.code ?? violation.course.name}:${violation.requiredTiming}:${violation.foundTermIndexes.join(",")}`
    ),
    evidence: uniqueBy(
      result.evidence,
      (evidence) => `${evidence.kind}:${evidence.clauseText}:${evidence.courseInstanceId ?? ""}:${evidence.message}`
    ),
    suggestedCounselorQuestions: [...new Set(result.questions)]
  };
}

export function evaluateParsedPrerequisites(
  parsed: { rule: PrerequisiteRule },
  input: PrerequisiteEvaluationInput
): PrerequisiteEvaluationResult {
  return evaluatePrerequisites(parsed.rule, input);
}
