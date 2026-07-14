import {
  ArrowRightIcon as ArrowRight,
  CheckIcon as Check,
  InfoIcon as Info
} from "@phosphor-icons/react";
import { Checkbox } from "@base-ui/react/checkbox";
import { useEffect, useMemo, useState } from "react";
import AnimatedContent from "@/components/reactbits/AnimatedContent";
import AnimatedList from "@/components/reactbits/AnimatedList";
import InstitutionMark from "@/components/InstitutionMark";
import { COLLEGE_HIGH_SCHOOL_CREDIT_POLICY, resolvePlanCourseHighSchoolCredits } from "@/lib/college-credits";
import { calculateGpaScenario, initialGpaScenarioChoices, setAllGpaScenarioGrades, type GpaScenarioChoice } from "@/lib/gpa-planner";
import type { InstitutionKey } from "@/lib/institutions";
import { courseDisplayName, LETTER_GRADES } from "@/lib/planning";
import type {
  Course,
  PlanCourse,
  SmccdCourse,
  SmccdHighSchoolEquivalency,
} from "@/lib/models";
import styles from "./gpa-planning-lab.module.css";

interface Props {
  rows: PlanCourse[];
  courses: Course[];
  smccdCourses: SmccdCourse[];
  equivalencies: SmccdHighSchoolEquivalency[];
  onOpenCourses: () => void;
  onScenarioChange: (context: Record<string, unknown>) => void;
}

function displayGpa(value: number | null) {
  return value === null ? "Not available" : value.toFixed(2);
}

function termLabel(term: PlanCourse["term"]) {
  return term === "full_year" ? "Full year" : `${term[0].toUpperCase()}${term.slice(1)}`;
}

function displayNumber(value: number) {
  return value.toFixed(Number.isInteger(value) ? 0 : 1);
}

function institutionFor(row: PlanCourse, smccdMap: Map<string, SmccdCourse>): { code: InstitutionKey; label: string } {
  if (!row.smccd_course_id && !row.college_provider_code && Number(row.college_units ?? 0) <= 0) return { code: "dtech", label: "High school" };
  const code = (row.smccd_course_id ? smccdMap.get(row.smccd_course_id)?.college_code : null) ?? "smccd";
  return { code: code as InstitutionKey, label: code === "smccd" ? "College" : code };
}

export default function GpaPlanningLab({
  rows,
  courses,
  smccdCourses,
  equivalencies,
  onOpenCourses,
  onScenarioChange
}: Props) {
  const [choices, setChoices] = useState<GpaScenarioChoice[]>(() => initialGpaScenarioChoices(rows));
  const [bulkGrade, setBulkGrade] = useState("A");
  const courseMap = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);
  const smccdMap = useMemo(() => new Map(smccdCourses.map((course) => [course.id, course])), [smccdCourses]);
  const effectiveChoices = useMemo(() => {
    const currentMap = new Map(choices.map((choice) => [choice.planCourseId, choice]));
    return initialGpaScenarioChoices(rows).map((choice) => currentMap.get(choice.planCourseId) ?? choice);
  }, [rows, choices]);
  const result = useMemo(() => calculateGpaScenario(rows, effectiveChoices, equivalencies), [rows, effectiveChoices, equivalencies]);
  const openRows = rows.filter((row) => row.status !== "completed");
  const collegeCreditContext = useMemo(() => rows.filter((row) => row.smccd_course_id || row.college_provider_code || Number(row.college_units ?? 0) > 0).map((row) => {
    const resolution = resolvePlanCourseHighSchoolCredits(row, equivalencies);
    return {
      plan_course_id: row.id,
      college_units: resolution.collegeUnits,
      high_school_gpa_credits: resolution.credits,
      credit_basis: resolution.basis
    };
  }), [rows, equivalencies]);
  const courseGroups = [
    { id: "high-school", label: "High school", rows: openRows.filter((row) => !row.smccd_course_id && !row.college_provider_code && Number(row.college_units ?? 0) <= 0) },
    { id: "college", label: "College", rows: openRows.filter((row) => Boolean(row.smccd_course_id || row.college_provider_code || Number(row.college_units ?? 0) > 0)) }
  ];

  useEffect(() => {
    onScenarioChange({
      current_weighted_gpa: result.baseline.projectedWeighted,
      scenario_weighted_gpa: result.scenario.projectedWeighted,
      all_a_schedule_ceiling: result.bestCase.projectedWeighted,
      missing_grade_assumptions: result.missingExpectedGrades,
      college_credit_policy: COLLEGE_HIGH_SCHOOL_CREDIT_POLICY,
      college_credit_conversions: collegeCreditContext
    });
  }, [collegeCreditContext, result, onScenarioChange]);

  function updateChoice(id: string, patch: Partial<GpaScenarioChoice>) {
    setChoices((current) => {
      const existing = current.find((choice) => choice.planCourseId === id)
        ?? initialGpaScenarioChoices(rows).find((choice) => choice.planCourseId === id);
      if (!existing) return current;
      return current.some((choice) => choice.planCourseId === id)
        ? current.map((choice) => choice.planCourseId === id ? { ...choice, ...patch } : choice)
        : [...current, { ...existing, ...patch }];
    });
  }

  function setAllExpectedGrades() {
    setChoices(setAllGpaScenarioGrades(effectiveChoices, bulkGrade));
  }

  return (
    <div className={styles.lab}>
      <header className={styles.header}>
        <div>
          <h1>GPA planner</h1>
          <p>Try grade assumptions against the courses already in your plan. Completed transcript grades never change here.</p>
        </div>
        <button className="secondary-button" type="button" onClick={onOpenCourses}>Edit course plan <ArrowRight size={15} /></button>
      </header>

      <AnimatedContent className={styles.resultPanel}>
        <div className={styles.primaryResult} data-incomplete={result.missingExpectedGrades > 0}>
          <span>Selected schedule</span>
          <strong>{result.missingExpectedGrades > 0 ? "Incomplete" : displayGpa(result.scenario.projectedWeighted)}</strong>
          <small>{result.missingExpectedGrades > 0 ? `${result.missingExpectedGrades} expected grades needed` : "projected weighted GPA"}</small>
        </div>
        <dl className={styles.comparison}>
          <div><dt>Transcript now</dt><dd>{displayGpa(result.baseline.projectedWeighted)}</dd></div>
          <div><dt>Unweighted scenario</dt><dd>{result.missingExpectedGrades > 0 ? "Not set" : displayGpa(result.scenario.projectedUnweighted)}</dd></div>
          <div><dt>All-A schedule ceiling</dt><dd>{displayGpa(result.bestCase.projectedWeighted)}</dd></div>
        </dl>
      </AnimatedContent>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div><h2>Test this schedule</h2><p>Use realistic expected grades. This changes only the calculator, not your saved courses.</p></div>
          {openRows.length > 0 && <div className={styles.bulkGradeControl}>
            <label><span>Grade for all</span><select value={bulkGrade} onChange={(event) => setBulkGrade(event.target.value)}>{LETTER_GRADES.filter((grade) => grade && !["IP", "P"].includes(grade)).map((grade) => <option value={grade} key={grade}>{grade}</option>)}</select></label>
            <button className="secondary-button small" type="button" onClick={setAllExpectedGrades}>Set all</button>
          </div>}
        </div>
        {openRows.length ? <div className={styles.courseGroups}>{courseGroups.map((group) => <section className={styles.courseGroup} aria-labelledby={`gpa-${group.id}-heading`} key={group.id}>
          <header><h3 id={`gpa-${group.id}-heading`}>{group.label}</h3><span>{group.rows.length} {group.rows.length === 1 ? "course" : "courses"}</span></header>
          <AnimatedList
            ariaLabel={`${group.label} GPA assumptions`}
            className={styles.courseList}
            items={group.rows}
            itemKey={(row) => row.id}
            renderItem={(row) => {
              const choice = effectiveChoices.find((candidate) => candidate.planCourseId === row.id);
              const institution = institutionFor(row, smccdMap);
              const displayName = courseDisplayName(row, courseMap);
              const highSchoolCredits = resolvePlanCourseHighSchoolCredits(row, equivalencies);
              return <article className={styles.courseRow} data-excluded={choice?.included === false}>
              <div className={styles.courseIdentity}>
                <InstitutionMark institution={institution.code} decorative />
                <div>
                  <strong>{displayName}</strong>
                  <span>{row.status === "current" ? "In progress" : "Planned"} · Grade {row.grade_level} · {termLabel(row.term)}{highSchoolCredits.collegeUnits > 0 ? ` · ${institution.label} · ${displayNumber(highSchoolCredits.collegeUnits)} units` : ""}</span>
                </div>
              </div>
              <div className={styles.courseControls}>
                <label className={styles.includeControl} title={choice?.included === false ? "Include in GPA scenario" : "Exclude from GPA scenario"}>
                  <span className="sr-only">Include {displayName} in GPA scenario</span>
                  <Checkbox.Root
                    aria-label={`Include ${displayName} in GPA scenario`}
                    checked={choice?.included ?? true}
                    className={styles.scenarioCheckbox}
                    onCheckedChange={(checked) => updateChoice(row.id, { included: checked })}
                  >
                    <Checkbox.Indicator className={styles.checkboxIndicator}><Check aria-hidden size={11} weight="bold" /></Checkbox.Indicator>
                  </Checkbox.Root>
                </label>
                <label className={styles.gradeControl}><span className="sr-only">Expected grade for {displayName}</span><select aria-label={`Expected grade for ${displayName}`} value={choice?.expectedGrade ?? ""} disabled={choice?.included === false} onChange={(event) => updateChoice(row.id, { expectedGrade: event.target.value || null })}>{LETTER_GRADES.filter((grade) => !["IP", "P"].includes(grade)).map((grade) => <option value={grade} key={grade || "unset"}>{grade || "Grade"}</option>)}</select></label>
              </div>
            </article>;
            }}
          />
        </section>)}</div> : <div className={styles.empty}><Info size={19} /><span><strong>No current or planned courses</strong><small>Add courses before comparing a schedule.</small></span></div>}
      </section>
    </div>
  );
}
