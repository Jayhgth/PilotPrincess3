import {
  ArrowRightIcon as ArrowRight,
  CheckCircleIcon as CheckCircle,
  InfoIcon as Info,
  SlidersHorizontalIcon as SlidersHorizontal,
  WarningIcon as Warning
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import AnimatedContent from "@/components/reactbits/AnimatedContent";
import InstitutionMark from "@/components/InstitutionMark";
import { evaluateGpaScenario, initialGpaScenarioChoices, type GpaScenarioChoice } from "@/lib/gpa-planner";
import type { InstitutionKey } from "@/lib/institutions";
import { courseDisplayName, LETTER_GRADES } from "@/lib/planning";
import type {
  Course,
  PlanCourse,
  SmccdCourse,
} from "@/lib/models";
import styles from "./gpa-planning-lab.module.css";

interface Props {
  rows: PlanCourse[];
  courses: Course[];
  smccdCourses: SmccdCourse[];
  onOpenCourses: () => void;
  onScenarioChange: (context: Record<string, unknown>) => void;
}

function displayGpa(value: number | null) {
  return value === null ? "Not available" : value.toFixed(2);
}

function termLabel(term: PlanCourse["term"]) {
  return term === "full_year" ? "Full year" : `${term[0].toUpperCase()}${term.slice(1)}`;
}

function institutionFor(row: PlanCourse, smccdMap: Map<string, SmccdCourse>): { code: InstitutionKey; label: string } {
  if (!row.smccd_course_id) return { code: "dtech", label: "High school" };
  const code = smccdMap.get(row.smccd_course_id)?.college_code ?? "smccd";
  return { code: code as InstitutionKey, label: code === "smccd" ? "College" : code };
}

export default function GpaPlanningLab({
  rows,
  courses,
  smccdCourses,
  onOpenCourses,
  onScenarioChange
}: Props) {
  const [choices, setChoices] = useState<GpaScenarioChoice[]>(() => initialGpaScenarioChoices(rows));
  const [target, setTarget] = useState(4);
  const courseMap = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);
  const smccdMap = useMemo(() => new Map(smccdCourses.map((course) => [course.id, course])), [smccdCourses]);
  const effectiveChoices = useMemo(() => {
    const currentMap = new Map(choices.map((choice) => [choice.planCourseId, choice]));
    return initialGpaScenarioChoices(rows).map((choice) => currentMap.get(choice.planCourseId) ?? choice);
  }, [rows, choices]);
  const result = useMemo(() => evaluateGpaScenario(rows, effectiveChoices, target), [rows, effectiveChoices, target]);
  const openRows = rows.filter((row) => row.status !== "completed");

  useEffect(() => {
    onScenarioChange({
      current_weighted_gpa: result.baseline.projectedWeighted,
      scenario_weighted_gpa: result.scenario.projectedWeighted,
      all_a_schedule_ceiling: result.bestCase.projectedWeighted,
      target_weighted_gpa: target,
      target_uniform_grade: result.targetGrade,
      missing_grade_assumptions: result.missingExpectedGrades
    });
  }, [result, target, onScenarioChange]);

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

  return (
    <div className={styles.lab}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}><SlidersHorizontal size={15} /> Schedule calculator</span>
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
          <label className={styles.targetField}><span>Target weighted GPA</span><input type="number" min={0} max={5} step={0.05} value={target} onChange={(event) => setTarget(Number(event.target.value))} /></label>
        </div>
        {openRows.length ? <div className={styles.courseList}>{openRows.map((row) => {
          const choice = effectiveChoices.find((candidate) => candidate.planCourseId === row.id);
          const institution = institutionFor(row, smccdMap);
          return <article className={styles.courseRow} key={row.id} data-excluded={row.status === "planned" && choice?.included === false}>
            <InstitutionMark institution={institution.code} decorative />
            <div className={styles.courseIdentity}>
              <strong>{courseDisplayName(row, courseMap)}</strong>
              <span>{row.status === "current" ? "In progress" : "Planned"} · Grade {row.grade_level} · {termLabel(row.term)} · {institution.label}</span>
            </div>
            {row.status === "planned" && <label className={styles.includeControl}><input type="checkbox" checked={choice?.included ?? true} onChange={(event) => updateChoice(row.id, { included: event.target.checked })} /><span>Include</span></label>}
            <label className={styles.gradeControl}><span>Expected grade</span><select value={choice?.expectedGrade ?? ""} disabled={choice?.included === false} onChange={(event) => updateChoice(row.id, { expectedGrade: event.target.value || null })}>{LETTER_GRADES.filter((grade) => !["IP", "P"].includes(grade)).map((grade) => <option value={grade} key={grade || "unset"}>{grade || "Choose"}</option>)}</select></label>
          </article>;
        })}</div> : <div className={styles.empty}><Info size={19} /><span><strong>No current or planned courses</strong><small>Add courses before comparing a schedule.</small></span></div>}
        <div className={styles.targetReadout} data-reachable={result.targetReachable}>
          {result.targetReachable ? <CheckCircle size={19} weight="fill" /> : <Warning size={19} weight="fill" />}
          <span>{result.targetAlreadyReached
            ? `The completed transcript already meets ${target.toFixed(2)}.`
            : result.targetReachable
            ? `A uniform ${result.targetGrade} across the included open courses reaches ${target.toFixed(2)}.`
            : `Even all A grades in this saved schedule do not reach ${target.toFixed(2)}.`}
          {result.missingExpectedGrades > 0 && <small>{result.missingExpectedGrades} included {result.missingExpectedGrades === 1 ? "course still needs" : "courses still need"} an expected grade for the selected result.</small>}</span>
        </div>
      </section>

      <aside className={styles.aiNote}><Info size={17} /><p><strong>Pilot can compare this calculator from the global chat.</strong> It reads these deterministic results and must ask before changing the saved schedule.</p></aside>
    </div>
  );
}
