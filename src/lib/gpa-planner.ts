import type { Course, PlanCourse } from "@/lib/models";
import { calculateGpa, calculateUcGpaEstimate } from "@/lib/planning";

export interface GpaScenarioChoice {
  planCourseId: string;
  included: boolean;
  expectedGrade: string | null;
}

export interface GpaScenarioResult {
  baseline: ReturnType<typeof calculateGpa>;
  scenario: ReturnType<typeof calculateGpa>;
  bestCase: ReturnType<typeof calculateGpa>;
  ucScenario: ReturnType<typeof calculateUcGpaEstimate>;
  missingExpectedGrades: number;
  targetGrade: string | null;
  targetReachable: boolean;
  targetAlreadyReached: boolean;
}

const TARGET_GRADES = ["F", "D", "C", "B", "A"] as const;

export function scenarioRows(rows: readonly PlanCourse[], choices: readonly GpaScenarioChoice[]) {
  const choiceMap = new Map(choices.map((choice) => [choice.planCourseId, choice]));
  return rows.flatMap((row) => {
    if (row.status === "completed") return [row];
    const choice = choiceMap.get(row.id);
    if (row.status === "planned" && choice?.included === false) return [];
    return [{ ...row, letter_grade: choice?.expectedGrade?.trim() || row.letter_grade }];
  });
}

function withUniformOpenGrade(rows: readonly PlanCourse[], choices: readonly GpaScenarioChoice[], grade: string) {
  return scenarioRows(rows, choices).map((row) => row.status === "completed" ? row : { ...row, letter_grade: grade });
}

export function evaluateGpaScenario(
  rows: readonly PlanCourse[],
  choices: readonly GpaScenarioChoice[],
  courses: readonly Course[],
  targetWeighted: number
): GpaScenarioResult {
  const baselineRows = rows.filter((row) => row.status === "completed");
  const projectedRows = scenarioRows(rows, choices);
  const openRows = projectedRows.filter((row) => row.status !== "completed");
  const bestCaseRows = projectedRows.map((row) => row.status === "completed" ? row : { ...row, letter_grade: "A" });
  const baseline = calculateGpa(baselineRows);
  const targetAlreadyReached = baseline.projectedWeighted !== null && baseline.projectedWeighted >= targetWeighted;
  const targetGrade = targetAlreadyReached ? null : TARGET_GRADES.find((grade) => {
    const result = calculateGpa(withUniformOpenGrade(rows, choices, grade));
    return result.projectedWeighted !== null && result.projectedWeighted >= targetWeighted;
  }) ?? null;

  return {
    baseline,
    scenario: calculateGpa(projectedRows),
    bestCase: calculateGpa(bestCaseRows),
    ucScenario: calculateUcGpaEstimate(projectedRows, [...courses]),
    missingExpectedGrades: openRows.filter((row) => !row.letter_grade || ["IP", "P"].includes(row.letter_grade.toUpperCase())).length,
    targetGrade,
    targetReachable: targetAlreadyReached || targetGrade !== null,
    targetAlreadyReached
  };
}

export function initialGpaScenarioChoices(rows: readonly PlanCourse[]): GpaScenarioChoice[] {
  return rows
    .filter((row) => row.status !== "completed")
    .map((row) => ({
      planCourseId: row.id,
      included: true,
      expectedGrade: row.letter_grade && !["IP", "P"].includes(row.letter_grade.toUpperCase()) ? row.letter_grade : null
    }));
}
