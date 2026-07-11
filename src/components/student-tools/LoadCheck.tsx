import {
  ArrowRightIcon as ArrowRight,
  CheckCircleIcon as CheckCircle,
  ScalesIcon as Scales,
  WarningIcon as Warning
} from "@phosphor-icons/react";
import type { Session } from "@supabase/supabase-js";
import type { SimulationConfig, SimulationResult, StudentProfile, WorkloadSummary } from "@/lib/models";
import FadeContent from "@/components/reactbits/FadeContent";
import styles from "./student-tools.module.css";

interface LoadCheckProps {
  session: Session;
  profile: StudentProfile;
  workload: WorkloadSummary | null;
  config: SimulationConfig;
  result: SimulationResult | null;
  busy: boolean;
  onConfigChange: (config: SimulationConfig) => void;
  onCompare: () => void | Promise<void>;
  onNavigate: (destination: "profile" | "courses") => void;
}

type LoadConfig = SimulationConfig & {
  collegeUnits: number;
  activityHoursChange: number;
};

function hours(value: number) {
  return `${Math.round(value * 10) / 10}h`;
}

export default function LoadCheck({
  session,
  profile,
  workload,
  config,
  result,
  busy,
  onConfigChange,
  onCompare,
  onNavigate
}: LoadCheckProps) {
  const loadConfig = config as LoadConfig;
  const collegeUnits = Number(loadConfig.collegeUnits ?? 0);
  const activityHoursChange = Number(loadConfig.activityHoursChange ?? 0);
  const currentHours = workload?.knownWeeklyHours ?? 0;
  const proposedHours = result?.simulated.workloadScore ?? Math.max(0, currentHours + collegeUnits * 3 + activityHoursChange);
  const weeklyLimit = profile.weekly_commitment_limit;
  const proposedRemaining = weeklyLimit === null ? null : weeklyLimit - proposedHours;
  const canRun = Boolean(session.user.id) && !busy;
  const resultState = proposedRemaining === null ? "unknown" : proposedRemaining < 0 ? "over" : "inside";

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1>Load check</h1>
          <p>Test one question: how would added college units and activity hours change a typical week?</p>
        </div>
      </header>

      <div className={styles.safetyNote}>
        <CheckCircle size={18} weight="duotone" aria-hidden />
        <span>This comparison does not change courses, activities, grades, or profile answers.</span>
      </div>

      <div className={styles.loadLayout}>
        <section className={styles.loadControls} aria-labelledby="load-inputs-heading">
          <div className={styles.sectionHeading}>
            <h2 id="load-inputs-heading">Proposed change</h2>
          </div>
          <label className={styles.numberControl}>
            <span><strong>Additional SMCCD units</strong><small>Each unit adds about three weekly class and study hours.</small></span>
            <input type="number" min={0} max={6} step={1} value={collegeUnits} onChange={(event) => onConfigChange({ ...config, collegeUnits: Number(event.target.value) } as SimulationConfig)} />
          </label>
          <label className={styles.numberControl}>
            <span><strong>Change in activity hours</strong><small>Use a negative number when dropping or reducing a commitment.</small></span>
            <input type="number" min={-20} max={20} step={0.5} value={activityHoursChange} onChange={(event) => onConfigChange({ ...config, activityHoursChange: Number(event.target.value) } as SimulationConfig)} />
          </label>
          <button className={styles.primaryButton} type="button" onClick={() => void onCompare()} disabled={!canRun}>
            <Scales size={17} /> Compare week
          </button>
          <p className={styles.methodNote}>This is deterministic. It uses saved course, activity, and capacity data. No AI is used.</p>
        </section>

        <section className={styles.loadResult} aria-live="polite" aria-labelledby="load-result-heading">
          <div className={styles.sectionHeading}>
            <h2 id="load-result-heading">Weekly comparison</h2>
          </div>
          {result ? (
            <FadeContent duration={0.18}>
              <div className={styles.comparison}>
                <div className={styles.comparisonHead}><span>Measure</span><strong>Current</strong><strong>Proposed</strong></div>
                <div><span>Known hours</span><strong>{hours(currentHours)}</strong><strong>{hours(proposedHours)}</strong></div>
                <div><span>Activity hours</span><strong>{hours(result.current.activityHours)}</strong><strong>{hours(result.simulated.activityHours)}</strong></div>
                <div><span>SMCCD units added</span><strong>0</strong><strong>{collegeUnits}</strong></div>
                {weeklyLimit !== null && <div><span>Hours left in limit</span><strong>{hours(weeklyLimit - currentHours)}</strong><strong className={proposedRemaining !== null && proposedRemaining < 0 ? styles.dangerText : ""}>{proposedRemaining === null ? "Not set" : hours(proposedRemaining)}</strong></div>}
              </div>
              <div className={resultState === "over" ? styles.resultWarning : resultState === "inside" ? styles.resultOkay : styles.resultNeutral}>
                {resultState === "inside" ? <CheckCircle size={18} weight="fill" /> : <Warning size={18} weight="fill" />}
                <span>
                  <strong>{resultState === "over" ? "This week exceeds the saved limit." : resultState === "inside" ? "This week stays inside the saved limit." : "Add a weekly limit to judge this change."}</strong>
                  <small>{result.risks[0] ?? result.changes[0] ?? "Review the actual course schedule before committing."}</small>
                </span>
              </div>
              <button className={styles.textButton} type="button" onClick={() => onNavigate("courses")}>Review courses <ArrowRight size={14} /></button>
            </FadeContent>
          ) : (
            <div className={styles.emptyState}>
              <Scales size={24} aria-hidden />
              <h3>No comparison yet</h3>
              <p>Enter the change you are considering, then compare it with the current week.</p>
            </div>
          )}
          {weeklyLimit === null && (
            <button className={styles.inlineNotice} type="button" onClick={() => onNavigate("profile")}>
              <Warning size={17} weight="fill" />
              <span><strong>Add a weekly limit</strong><small>A saved limit makes the result easier to judge.</small></span>
              <ArrowRight size={15} />
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
