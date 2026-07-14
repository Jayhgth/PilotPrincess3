import type {
  AcademicFramework,
  AcademicRequirementRule,
  Course,
  CourseFrameworkMapping,
  PlanCourse
} from "@/lib/models";

export interface AcademicRuleProgress {
  rule: AcademicRequirementRule;
  requiredCredits: number;
  completedCredits: number;
  scheduledCredits: number;
  coveredCredits: number;
  remainingCredits: number;
  status: "complete" | "on_track" | "missing";
  appliedCourseIds: string[];
  excludedCourseIds: string[];
  mappingAvailable: boolean;
}

export interface AcademicFrameworkProgress {
  framework: AcademicFramework;
  rules: AcademicRuleProgress[];
  completedRules: number;
  coveredRules: number;
  totalRules: number;
  completedCredits: number;
  scheduledCredits: number;
  requiredCredits: number;
  remainingCredits: number;
  mappingCoverage: "available" | "partial" | "missing";
}

const GRADE_ORDER: Record<string, number> = {
  A: 4, "A-": 3.7, "B+": 3.3, B: 3, "B-": 2.7,
  "C+": 2.3, C: 2, "C-": 1.7, "D+": 1.3, D: 1, "D-": 0.7,
  F: 0, P: 2, CR: 2
};

export function frameworkRuleCredits(rule: AcademicRequirementRule) {
  if (rule.credits_required != null) return Number(rule.credits_required);
  if (rule.years_required != null) return Number(rule.years_required) * 10;
  if (rule.courses_required != null) return Number(rule.courses_required) * 10;
  return 0;
}

export function ruleAppliesToStudent(rule: AcademicRequirementRule, graduationYear: number | null) {
  if (graduationYear == null) return rule.effective_graduation_year_start == null && rule.effective_graduation_year_end == null;
  if (rule.effective_graduation_year_start != null && graduationYear < rule.effective_graduation_year_start) return false;
  if (rule.effective_graduation_year_end != null && graduationYear > rule.effective_graduation_year_end) return false;
  return true;
}

function meetsMinimumGrade(letterGrade: string | null, minimumGrade: string | null) {
  if (!minimumGrade || !letterGrade) return true;
  const actual = GRADE_ORDER[letterGrade.toUpperCase()];
  const required = GRADE_ORDER[minimumGrade.toUpperCase()];
  return actual == null || required == null ? false : actual >= required;
}

export function calculateAcademicFrameworkProgress({
  frameworks,
  rules,
  mappings,
  courses,
  planCourses,
  graduationYear
}: {
  frameworks: AcademicFramework[];
  rules: AcademicRequirementRule[];
  mappings: CourseFrameworkMapping[];
  courses: Course[];
  planCourses: PlanCourse[];
  graduationYear: number | null;
}): AcademicFrameworkProgress[] {
  const courseById = new Map(courses.map((course) => [course.id, course]));
  const planByCatalogCourse = new Map<string, PlanCourse[]>();
  for (const row of planCourses) {
    if (!row.course_id) continue;
    const current = planByCatalogCourse.get(row.course_id) ?? [];
    current.push(row);
    planByCatalogCourse.set(row.course_id, current);
  }

  return frameworks.map((framework) => {
    const frameworkMappings = mappings.filter((mapping) => mapping.framework_id === framework.id && mapping.review_status === "approved");
    const applicableRules = rules
      .filter((rule) => rule.framework_id === framework.id && ruleAppliesToStudent(rule, graduationYear))
      .sort((left, right) => left.sort_order - right.sort_order || left.title.localeCompare(right.title));
    const ruleRows = applicableRules.map((rule): AcademicRuleProgress => {
      const requiredCredits = frameworkRuleCredits(rule);
      const ruleMappings = frameworkMappings.filter((mapping) => mapping.requirement_rule_id === rule.id);
      const matchingPlanRows = frameworkMappings
        .filter((mapping) => mapping.requirement_rule_id === rule.id)
        .flatMap((mapping) => planByCatalogCourse.get(mapping.course_id) ?? []);
      const uniqueRows = [...new Map(matchingPlanRows.map((row) => [row.id, row])).values()];
      const eligibleRows = uniqueRows.filter((row) => row.status !== "completed" || meetsMinimumGrade(row.letter_grade, rule.minimum_grade));
      const excludedRows = uniqueRows.filter((row) => !eligibleRows.includes(row));
      const creditsFor = (row: PlanCourse) => Number(row.credits ?? (row.course_id ? courseById.get(row.course_id)?.credits : null) ?? 0);
      const completedCredits = eligibleRows.filter((row) => row.status === "completed").reduce((sum, row) => sum + creditsFor(row), 0);
      const scheduledCredits = eligibleRows.filter((row) => row.status !== "completed").reduce((sum, row) => sum + creditsFor(row), 0);
      const coveredCredits = Math.min(requiredCredits, completedCredits + scheduledCredits);
      const remainingCredits = Math.max(0, requiredCredits - coveredCredits);
      return {
        rule,
        requiredCredits,
        completedCredits: Math.min(requiredCredits, completedCredits),
        scheduledCredits: Math.min(Math.max(0, requiredCredits - completedCredits), scheduledCredits),
        coveredCredits,
        remainingCredits,
        status: completedCredits >= requiredCredits ? "complete" : remainingCredits === 0 ? "on_track" : "missing",
        appliedCourseIds: eligibleRows.map((row) => row.id),
        excludedCourseIds: excludedRows.map((row) => row.id),
        mappingAvailable: ruleMappings.length > 0
      };
    });
    const mappedRuleCount = ruleRows.filter((row) => row.mappingAvailable).length;
    return {
      framework,
      rules: ruleRows,
      completedRules: ruleRows.filter((row) => row.status === "complete").length,
      coveredRules: ruleRows.filter((row) => row.status !== "missing").length,
      totalRules: ruleRows.length,
      completedCredits: ruleRows.reduce((sum, row) => sum + row.completedCredits, 0),
      scheduledCredits: ruleRows.reduce((sum, row) => sum + row.scheduledCredits, 0),
      requiredCredits: ruleRows.reduce((sum, row) => sum + row.requiredCredits, 0),
      remainingCredits: ruleRows.reduce((sum, row) => sum + row.remainingCredits, 0),
      mappingCoverage: mappedRuleCount === 0 ? "missing" : mappedRuleCount === ruleRows.length ? "available" : "partial"
    };
  });
}
