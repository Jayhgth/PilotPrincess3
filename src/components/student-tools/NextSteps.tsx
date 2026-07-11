import {
  ArrowRightIcon as ArrowRight,
  ArrowClockwiseIcon as ArrowClockwise,
  CheckIcon as Check,
  PlusIcon as Plus,
  TrashIcon as Trash,
  WarningIcon as Warning
} from "@phosphor-icons/react";
import type { Session } from "@supabase/supabase-js";
import { useMemo, useState, type SyntheticEvent } from "react";
import FadeContent from "@/components/reactbits/FadeContent";
import type { TimelineTask } from "@/lib/models";
import styles from "./student-tools.module.css";

export interface NextStepDraft {
  title: string;
  category: TimelineTask["category"];
  dueLabel: string;
}

export interface CourseCheck {
  id: string;
  name: string;
  status: "blocked" | "needs_review";
  message: string;
  source: "dtech" | "smccd";
  courseId: string;
}

export interface OpenRequirement {
  id: string;
  name: string;
  remainingCredits: number;
}

interface NextStepsProps {
  session: Session;
  tasks: TimelineTask[];
  currentGrade: number;
  graduationYear: number | null;
  openRequirements: OpenRequirement[];
  courseChecks: CourseCheck[];
  busy: boolean;
  onSync: () => void | Promise<void>;
  onAdd: (draft: NextStepDraft) => boolean | Promise<boolean>;
  onUpdate: (id: string, patch: Partial<TimelineTask>) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onOpenCourseCheck: (check: CourseCheck) => void;
  onNavigate: (destination: "courses" | "graduation") => void;
}

const emptyDraft: NextStepDraft = { title: "", category: "admin", dueLabel: "" };

export default function NextSteps({
  session,
  tasks,
  currentGrade,
  graduationYear,
  openRequirements,
  courseChecks,
  busy,
  onSync,
  onAdd,
  onUpdate,
  onDelete,
  onOpenCourseCheck,
  onNavigate
}: NextStepsProps) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState<NextStepDraft>(emptyDraft);
  const openTasks = useMemo(() => tasks
    .filter((task) => !task.is_completed)
    .sort((a, b) => {
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return Number(b.is_generated) - Number(a.is_generated);
    }), [tasks]);
  const completedTasks = useMemo(() => tasks.filter((task) => task.is_completed), [tasks]);
  const canEdit = Boolean(session.user.id) && !busy;

  async function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const added = await onAdd(draft);
    if (!added) return;
    setDraft(emptyDraft);
    setComposerOpen(false);
  }

  const queueSize = courseChecks.length + openRequirements.length + openTasks.length;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1>Next steps</h1>
          <p>One queue ordered by course blockers, uncovered requirements, then saved dates.</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.secondaryButton} type="button" onClick={() => void onSync()} disabled={!canEdit}>
            <ArrowClockwise size={16} /> Sync from plan
          </button>
          <button className={styles.primaryButton} type="button" onClick={() => setComposerOpen(true)} disabled={!canEdit} aria-expanded={composerOpen} aria-controls="next-step-composer">
            <Plus size={16} /> Add step
          </button>
        </div>
      </header>

      <p className={styles.contextLine}>
        <span>Grade {currentGrade}{graduationYear ? `, graduating ${graduationYear}` : ""}.</span>
        <strong>{queueSize} open {queueSize === 1 ? "item" : "items"}</strong>
      </p>

      {composerOpen && (
        <FadeContent className={styles.editor} duration={0.16}>
          <form onSubmit={submit} id="next-step-composer">
            <div className={styles.editorHeading}>
              <div><h2>Add a step</h2><p>Use a clear verb and one checkable outcome.</p></div>
              <button className={styles.textButton} type="button" onClick={() => setComposerOpen(false)}>Cancel</button>
            </div>
            <div className={styles.formGrid}>
              <label className={`${styles.field} ${styles.wideField}`}><span>Step</span><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required autoFocus placeholder="Confirm summer registration date" /></label>
              <label className={styles.field}><span>Type</span><select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as TimelineTask["category"] })}><option value="academics">Academics</option><option value="college">College</option><option value="activities">Activities</option><option value="summer">Summer</option><option value="admin">Admin</option></select></label>
              <label className={styles.field}><span>When</span><input value={draft.dueLabel} onChange={(event) => setDraft({ ...draft, dueLabel: event.target.value })} placeholder="Before registration" /></label>
            </div>
            <div className={styles.formActions}><button className={styles.primaryButton} type="submit" disabled={!canEdit}>Add step</button></div>
          </form>
        </FadeContent>
      )}

      <section className={styles.queue} aria-labelledby="next-step-queue-heading">
        <div className={styles.sectionHeading}>
          <h2 id="next-step-queue-heading">Open queue</h2>
          <span>{queueSize}</span>
        </div>
        {queueSize > 0 ? (
          <ol className={styles.queueList}>
            {courseChecks.map((check, index) => (
              <li className={styles.queueItem} key={`course-${check.id}`}>
                <span className={`${styles.queueIndex} ${styles.blockedIndex}`}><Warning size={16} weight="fill" /><span className={styles.srOnly}>{index + 1}</span></span>
                <button className={styles.queueBodyButton} type="button" onClick={() => onOpenCourseCheck(check)}>
                  <span><strong>{check.name}</strong><small>{check.message}</small></span>
                  <span>{check.status === "blocked" ? "Blocked" : "Review"} <ArrowRight size={14} /></span>
                </button>
              </li>
            ))}
            {openRequirements.map((requirement, index) => (
              <li className={styles.queueItem} key={`requirement-${requirement.id}`}>
                <span className={styles.queueIndex}>{courseChecks.length + index + 1}</span>
                <button className={styles.queueBodyButton} type="button" onClick={() => onNavigate("graduation")}>
                  <span><strong>Plan {requirement.name}</strong><small>{requirement.remainingCredits} credits still need verified coverage.</small></span>
                  <span>Graduation <ArrowRight size={14} /></span>
                </button>
              </li>
            ))}
            {openTasks.map((task, index) => (
              <li className={styles.queueItem} key={task.id}>
                <span className={styles.queueIndex}>{courseChecks.length + openRequirements.length + index + 1}</span>
                <label className={styles.taskCheck}>
                  <input type="checkbox" checked={false} onChange={() => void onUpdate(task.id, { is_completed: true })} aria-label={`Complete ${task.title}`} />
                  <span><strong>{task.title}</strong><small>{task.due_label ?? task.category}{task.explanation ? `: ${task.explanation}` : ""}</small></span>
                </label>
                <button className={`${styles.iconButton} ${styles.dangerButton}`} type="button" onClick={() => { if (window.confirm(`Delete ${task.title}?`)) void onDelete(task.id); }} disabled={!canEdit} aria-label={`Delete ${task.title}`}><Trash size={15} /></button>
              </li>
            ))}
          </ol>
        ) : (
          <div className={styles.emptyState}>
            <Check size={24} weight="bold" aria-hidden />
            <h3>Nothing is waiting</h3>
            <p>Sync the plan after course changes, or add a decision you want to track.</p>
            <button className={styles.secondaryButton} type="button" onClick={() => void onSync()} disabled={!canEdit}><ArrowClockwise size={16} /> Sync from plan</button>
          </div>
        )}
      </section>

      {completedTasks.length > 0 && (
        <details className={styles.collapsedGroup}>
          <summary>{completedTasks.length} completed {completedTasks.length === 1 ? "step" : "steps"}</summary>
          <div className={styles.completedList}>
            {completedTasks.map((task) => (
              <div key={task.id}>
                <label className={styles.taskCheck}><input type="checkbox" checked onChange={() => void onUpdate(task.id, { is_completed: false })} /><span><strong>{task.title}</strong><small>{task.due_label ?? task.category}</small></span></label>
                <button className={`${styles.iconButton} ${styles.dangerButton}`} type="button" onClick={() => { if (window.confirm(`Delete ${task.title}?`)) void onDelete(task.id); }} aria-label={`Delete ${task.title}`}><Trash size={15} /></button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
