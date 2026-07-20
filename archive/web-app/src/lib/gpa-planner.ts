import type { PlanCourse, SmccdHighSchoolEquivalency } from "@/lib/models";
import { calculateGpa } from "@/lib/planning";

export interface GpaScenarioChoice {
  planCourseId: string;
  included: boolean;
  expectedGrade: string | null;
}

export interface GpaScenarioResult {
  baseline: ReturnType<typeof calculateGpa>;
  scenario: ReturnType<typeof calculateGpa>;
  bestCase: ReturnType<typeof calculateGpa>;
  missingExpectedGrades: number;
  targetGrade: string | null;
  targetReachable: boolean;
  targetAlreadyReached: boolean;
}

export interface GpaScenarioSummary {
  baseline: ReturnType<typeof calculateGpa>;
  scenario: ReturnType<typeof calculateGpa>;
  bestCase: ReturnType<typeof calculateGpa>;
  missingExpectedGrades: number;
}

const TARGET_GRADES = ["F", "D", "C", "B", "A"] as const;

export function scenarioRows(rows: readonly PlanCourse[], choices: readonly GpaScenarioChoice[]) {
  const choiceMap = new Map(choices.map((choice) => [choice.planCourseId, choice]));
  return rows.flatMap((row) => {
    if (row.status === "completed") return [row];
    const choice = choiceMap.get(row.id);
    if (choice?.included === false) return [];
    return [{ ...row, letter_grade: choice?.expectedGrade?.trim() || row.letter_grade }];
  });
}

function withUniformOpenGrade(rows: readonly PlanCourse[], choices: readonly GpaScenarioChoice[], grade: string) {
  return scenarioRows(rows, choices).map((row) => row.status === "completed" ? row : { ...row, letter_grade: grade });
}

export function calculateGpaScenario(
  rows: readonly PlanCourse[],
  choices: readonly GpaScenarioChoice[],
  equivalencies: readonly SmccdHighSchoolEquivalency[] = []
): GpaScenarioSummary {
  const baselineRows = rows.filter((row) => row.status === "completed");
  const projectedRows = scenarioRows(rows, choices);
  const openRows = projectedRows.filter((row) => row.status !== "completed");
  const bestCaseRows = projectedRows.map((row) => row.status === "completed" ? row : { ...row, letter_grade: "A" });
  return {
    baseline: calculateGpa(baselineRows, equivalencies),
    scenario: calculateGpa(projectedRows, equivalencies),
    bestCase: calculateGpa(bestCaseRows, equivalencies),
    missingExpectedGrades: openRows.filter((row) => !row.letter_grade || ["IP", "P"].includes(row.letter_grade.toUpperCase())).length
  };
}

export function evaluateGpaScenario(
  rows: readonly PlanCourse[],
  choices: readonly GpaScenarioChoice[],
  targetWeighted: number,
  equivalencies: readonly SmccdHighSchoolEquivalency[] = []
): GpaScenarioResult {
  const summary = calculateGpaScenario(rows, choices, equivalencies);
  const baseline = summary.baseline;
  const targetAlreadyReached = baseline.projectedWeighted !== null && baseline.projectedWeighted >= targetWeighted;
  const targetGrade = targetAlreadyReached ? null : TARGET_GRADES.find((grade) => {
    const result = calculateGpa(withUniformOpenGrade(rows, choices, grade), equivalencies);
    return result.projectedWeighted !== null && result.projectedWeighted >= targetWeighted;
  }) ?? null;

  return {
    baseline,
    scenario: summary.scenario,
    bestCase: summary.bestCase,
    missingExpectedGrades: summary.missingExpectedGrades,
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

export function setAllGpaScenarioGrades(choices: readonly GpaScenarioChoice[], grade: string): GpaScenarioChoice[] {
  return choices.map((choice) => ({ ...choice, expectedGrade: grade }));
}
