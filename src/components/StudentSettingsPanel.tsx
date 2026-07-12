import {
  CheckIcon as Check,
  PencilSimpleIcon as PencilSimple,
  PlusIcon as Plus,
  TrashIcon as Trash,
  XIcon as X
} from "@phosphor-icons/react";
import { useEffect, useMemo, useState, type SyntheticEvent } from "react";
import { AI_MODEL_OPTIONS } from "@/lib/ai-preferences";
import type {
  GradeLevel,
  GraduationRequirement,
  RequirementArea,
  StudentSettings,
  TimelineTask
} from "@/lib/models";
import styles from "./StudentSettingsPanel.module.css";

const GRADE_LEVELS: GradeLevel[] = [9, 10, 11, 12];
const TASK_CATEGORIES: Array<{ value: TimelineTask["category"]; label: string }> = [
  { value: "academics", label: "Academics" },
  { value: "activities", label: "Activities" },
  { value: "college", label: "College" },
  { value: "summer", label: "Summer" },
  { value: "admin", label: "Admin" }
];

export type StudentSettingsPatch = Partial<Pick<
  StudentSettings,
  | "preferred_name"
  | "age"
  | "grade_level"
  | "graduation_year"
  | "plan_start_grade"
  | "plan_end_grade"
  | "tracker_mode"
  | "tracked_requirement_areas"
  | "ai_enabled"
  | "ai_review_mode"
  | "ai_model"
>>;

export interface NextStepDraft {
  title: string;
  category: TimelineTask["category"];
  dueLabel: string;
  dueDate: string;
}

interface StudentSettingsPanelProps {
  settings: StudentSettings;
  requirements: GraduationRequirement[];
  tasks: TimelineTask[];
  busy?: boolean;
  onSave: (patch: StudentSettingsPatch) => void | Promise<void>;
  onAddTask: (draft: NextStepDraft) => boolean | void | Promise<boolean | void>;
  onUpdateTask: (id: string, patch: Partial<TimelineTask>) => void | Promise<void>;
  onDeleteTask: (id: string) => void | Promise<void>;
}

interface SettingsDraft {
  preferredName: string;
  age: number | null;
  gradeLevel: GradeLevel | null;
  graduationYear: number | null;
  planStartGrade: GradeLevel | null;
  planEndGrade: GradeLevel | null;
  trackerMode: StudentSettings["tracker_mode"];
  trackedAreas: RequirementArea[];
  aiEnabled: boolean;
  aiReviewMode: StudentSettings["ai_review_mode"];
  aiModel: StudentSettings["ai_model"];
}

interface TaskEditDraft {
  title: string;
  category: TimelineTask["category"];
  dueLabel: string;
  dueDate: string;
}

const EMPTY_TASK: NextStepDraft = {
  title: "",
  category: "admin",
  dueLabel: "",
  dueDate: ""
};

function settingsDraft(settings: StudentSettings): SettingsDraft {
  return {
    preferredName: settings.preferred_name,
    age: settings.age,
    gradeLevel: settings.grade_level as GradeLevel | null,
    graduationYear: settings.graduation_year,
    planStartGrade: settings.plan_start_grade,
    planEndGrade: settings.plan_end_grade,
    trackerMode: settings.tracker_mode,
    trackedAreas: settings.tracked_requirement_areas,
    aiEnabled: settings.ai_enabled,
    aiReviewMode: settings.ai_review_mode,
    aiModel: settings.ai_model
  };
}

function taskDraft(task: TimelineTask): TaskEditDraft {
  return {
    title: task.title,
    category: task.category,
    dueLabel: task.due_label ?? "",
    dueDate: task.due_date?.slice(0, 10) ?? ""
  };
}

function sameAreas(left: RequirementArea[], right: RequirementArea[]) {
  return left.length === right.length && left.every((area) => right.includes(area));
}

function dueText(task: TimelineTask) {
  const parts = [TASK_CATEGORIES.find((item) => item.value === task.category)?.label ?? task.category];
  if (task.due_label) parts.push(task.due_label);
  if (task.due_date) {
    const date = new Date(`${task.due_date.slice(0, 10)}T00:00:00`);
    if (!Number.isNaN(date.getTime())) {
      parts.push(date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }));
    }
  }
  if (task.is_generated) parts.push("Generated from your plan");
  return parts.join(" · ");
}

function NextStepsManager({
  tasks,
  busy = false,
  onAddTask,
  onUpdateTask,
  onDeleteTask
}: Pick<StudentSettingsPanelProps, "tasks" | "busy" | "onAddTask" | "onUpdateTask" | "onDeleteTask">) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [newTask, setNewTask] = useState<NextStepDraft>(EMPTY_TASK);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<TaskEditDraft | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openTasks = useMemo(() => tasks
    .filter((task) => !task.is_completed)
    .sort((left, right) => {
      if (left.due_date && right.due_date) return left.due_date.localeCompare(right.due_date);
      if (left.due_date) return -1;
      if (right.due_date) return 1;
      return left.title.localeCompare(right.title);
    }), [tasks]);
  const completedTasks = useMemo(() => tasks.filter((task) => task.is_completed), [tasks]);

  async function runTaskAction(id: string, action: () => void | Promise<void>) {
    setError(null);
    setWorkingId(id);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The next step could not be saved.");
    } finally {
      setWorkingId(null);
    }
  }

  async function addTask(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (!newTask.title.trim()) return;
    setError(null);
    setWorkingId("new");
    try {
      const added = await onAddTask({ ...newTask, title: newTask.title.trim(), dueLabel: newTask.dueLabel.trim() });
      if (added === false) return;
      setNewTask(EMPTY_TASK);
      setComposerOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The next step could not be added.");
    } finally {
      setWorkingId(null);
    }
  }

  function beginEdit(task: TimelineTask) {
    setEditingId(task.id);
    setEditDraft(taskDraft(task));
    setError(null);
  }

  async function saveEdit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>, task: TimelineTask) {
    event.preventDefault();
    if (!editDraft?.title.trim()) return;
    await runTaskAction(task.id, async () => {
      await onUpdateTask(task.id, {
        title: editDraft.title.trim(),
        category: editDraft.category,
        due_label: editDraft.dueLabel.trim() || null,
        due_date: editDraft.dueDate || null
      });
      setEditingId(null);
      setEditDraft(null);
    });
  }

  async function deleteTask(task: TimelineTask) {
    if (task.is_generated) return;
    if (!window.confirm(`Delete “${task.title}”?`)) return;
    await runTaskAction(task.id, () => onDeleteTask(task.id));
  }

  const controlsDisabled = busy || workingId !== null;

  return (
    <section className={`content-section ${styles.section}`} aria-labelledby="settings-next-steps-heading">
      <header className={styles.sectionHeading}>
        <div>
          <h2 id="settings-next-steps-heading">Next steps</h2>
          <p>Review the steps saved by you or Pilot.</p>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => setComposerOpen((current) => !current)}
          disabled={controlsDisabled}
          aria-expanded={composerOpen}
          aria-controls="next-step-composer"
        >
          {composerOpen ? <X size={16} /> : <Plus size={16} />}
          {composerOpen ? "Cancel" : "Add step"}
        </button>
      </header>

      {composerOpen && (
        <form className={styles.taskEditor} id="next-step-composer" onSubmit={addTask}>
          <label className={`form-field ${styles.taskTitleField}`}>
            <span>Step</span>
            <input autoFocus required value={newTask.title} onChange={(event) => setNewTask({ ...newTask, title: event.target.value })} placeholder="Confirm registration date" />
          </label>
          <label className="form-field">
            <span>Category</span>
            <select value={newTask.category} onChange={(event) => setNewTask({ ...newTask, category: event.target.value as TimelineTask["category"] })}>
              {TASK_CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
            </select>
          </label>
          <label className="form-field">
            <span>Due label <small>(optional)</small></span>
            <input value={newTask.dueLabel} onChange={(event) => setNewTask({ ...newTask, dueLabel: event.target.value })} placeholder="Before registration" />
          </label>
          <label className="form-field">
            <span>Due date <small>(optional)</small></span>
            <input type="date" value={newTask.dueDate} onChange={(event) => setNewTask({ ...newTask, dueDate: event.target.value })} />
          </label>
          <div className={styles.taskEditorActions}>
            <button className="primary-button" type="submit" disabled={controlsDisabled || !newTask.title.trim()}>Add step</button>
          </div>
        </form>
      )}

      {error && <p className={styles.error} role="alert">{error}</p>}

      {openTasks.length > 0 ? (
        <div className={styles.taskList} aria-label="Open next steps">
          {openTasks.map((task) => editingId === task.id && editDraft ? (
            <form className={styles.taskEditRow} key={task.id} onSubmit={(event) => void saveEdit(event, task)}>
              <label className={`form-field ${styles.taskTitleField}`}><span>Step</span><input autoFocus required value={editDraft.title} onChange={(event) => setEditDraft({ ...editDraft, title: event.target.value })} /></label>
              <label className="form-field"><span>Category</span><select value={editDraft.category} onChange={(event) => setEditDraft({ ...editDraft, category: event.target.value as TimelineTask["category"] })}>{TASK_CATEGORIES.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label>
              <label className="form-field"><span>Due label</span><input value={editDraft.dueLabel} onChange={(event) => setEditDraft({ ...editDraft, dueLabel: event.target.value })} /></label>
              <label className="form-field"><span>Due date</span><input type="date" value={editDraft.dueDate} onChange={(event) => setEditDraft({ ...editDraft, dueDate: event.target.value })} /></label>
              <div className={styles.taskEditActions}>
                <button className="primary-button" type="submit" disabled={controlsDisabled}>Save</button>
                <button className="quiet-button" type="button" onClick={() => { setEditingId(null); setEditDraft(null); }} disabled={controlsDisabled}>Cancel</button>
              </div>
            </form>
          ) : (
            <div className={styles.taskRow} key={task.id}>
              <label className={styles.taskCheck}>
                <input
                  type="checkbox"
                  checked={false}
                  disabled={controlsDisabled}
                  onChange={() => void runTaskAction(task.id, () => onUpdateTask(task.id, { is_completed: true }))}
                  aria-label={`Complete ${task.title}`}
                />
                <span><strong>{task.title}</strong><small>{dueText(task)}</small></span>
              </label>
              <div className={styles.rowActions}>
                <button className="icon-button" type="button" onClick={() => beginEdit(task)} disabled={controlsDisabled || task.is_generated} title={task.is_generated ? "Generated steps update from the plan" : "Edit step"} aria-label={`Edit ${task.title}`}><PencilSimple size={15} /></button>
                <button className="icon-button danger" type="button" onClick={() => void deleteTask(task)} disabled={controlsDisabled || task.is_generated} title={task.is_generated ? "Generated steps update from the plan" : "Delete step"} aria-label={`Delete ${task.title}`}><Trash size={15} /></button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.emptyState}><Check size={19} weight="bold" /><span><strong>No open next steps</strong><small>Add one when you have a decision or deadline to track.</small></span></div>
      )}

      {completedTasks.length > 0 && (
        <details className={styles.completedSteps}>
          <summary>{completedTasks.length} completed {completedTasks.length === 1 ? "step" : "steps"}</summary>
          <div className={styles.taskList}>
            {completedTasks.map((task) => (
              <div className={`${styles.taskRow} ${styles.completedTask}`} key={task.id}>
                <label className={styles.taskCheck}>
                  <input type="checkbox" checked disabled={controlsDisabled} onChange={() => void runTaskAction(task.id, () => onUpdateTask(task.id, { is_completed: false }))} aria-label={`Reopen ${task.title}`} />
                  <span><strong>{task.title}</strong><small>{dueText(task)}</small></span>
                </label>
                <button className="icon-button danger" type="button" onClick={() => void deleteTask(task)} disabled={controlsDisabled || task.is_generated} title={task.is_generated ? "Generated steps update from the plan" : "Delete step"} aria-label={`Delete ${task.title}`}><Trash size={15} /></button>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

export default function StudentSettingsPanel({
  settings,
  requirements,
  tasks,
  busy = false,
  onSave,
  onAddTask,
  onUpdateTask,
  onDeleteTask
}: StudentSettingsPanelProps) {
  const [draft, setDraft] = useState<SettingsDraft>(() => settingsDraft(settings));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const allAreas = useMemo(() => requirements.map((requirement) => requirement.area), [requirements]);
  const dirty = draft.preferredName !== settings.preferred_name
    || draft.age !== settings.age
    || draft.gradeLevel !== settings.grade_level
    || draft.graduationYear !== settings.graduation_year
    || draft.planStartGrade !== settings.plan_start_grade
    || draft.planEndGrade !== settings.plan_end_grade
    || draft.trackerMode !== settings.tracker_mode
    || !sameAreas(draft.trackedAreas, settings.tracked_requirement_areas)
    || draft.aiEnabled !== settings.ai_enabled
    || draft.aiReviewMode !== settings.ai_review_mode
    || draft.aiModel !== settings.ai_model;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDraft(settingsDraft(settings));
      setSaved(false);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [settings]);

  function toggleArea(area: RequirementArea) {
    setDraft((current) => ({
      ...current,
      trackedAreas: current.trackedAreas.includes(area)
        ? current.trackedAreas.filter((candidate) => candidate !== area)
        : [...current.trackedAreas, area]
    }));
  }

  async function save(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    const preferredName = draft.preferredName.trim();
    if (!preferredName) {
      setError("Enter a preferred name.");
      return;
    }
    if (draft.planStartGrade && draft.planEndGrade && draft.planStartGrade > draft.planEndGrade) {
      setError("The planning window must end at or after its starting grade.");
      return;
    }
    if (draft.trackerMode === "selected" && draft.trackedAreas.length === 0) {
      setError("Choose at least one requirement area for a focused tracker.");
      return;
    }

    const normalizedAreas = draft.trackerMode === "full"
      ? (allAreas.length > 0 ? allAreas : settings.tracked_requirement_areas)
      : draft.trackedAreas;
    const normalizedReviewMode = draft.aiEnabled ? draft.aiReviewMode : "manual";
    const patch: StudentSettingsPatch = {};
    if (preferredName !== settings.preferred_name) patch.preferred_name = preferredName;
    if (draft.age !== settings.age) patch.age = draft.age;
    if (draft.gradeLevel !== settings.grade_level) patch.grade_level = draft.gradeLevel;
    if (draft.graduationYear !== settings.graduation_year) patch.graduation_year = draft.graduationYear;
    if (draft.planStartGrade !== settings.plan_start_grade) patch.plan_start_grade = draft.planStartGrade;
    if (draft.planEndGrade !== settings.plan_end_grade) patch.plan_end_grade = draft.planEndGrade;
    if (draft.trackerMode !== settings.tracker_mode) patch.tracker_mode = draft.trackerMode;
    if (!sameAreas(normalizedAreas, settings.tracked_requirement_areas)) patch.tracked_requirement_areas = normalizedAreas;
    if (draft.aiEnabled !== settings.ai_enabled) patch.ai_enabled = draft.aiEnabled;
    if (normalizedReviewMode !== settings.ai_review_mode) patch.ai_review_mode = normalizedReviewMode;
    if (draft.aiModel !== settings.ai_model) patch.ai_model = draft.aiModel;

    setSaving(true);
    try {
      await onSave(patch);
      setDraft((current) => ({ ...current, preferredName, trackedAreas: normalizedAreas, aiReviewMode: normalizedReviewMode }));
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const controlsDisabled = busy || saving;
  const currentYear = new Date().getFullYear();

  return (
    <div className={styles.settingsPanel}>
      <section className={`content-section ${styles.section}`} aria-labelledby="student-settings-heading">
        <header className={styles.sectionHeading}>
          <div>
            <h2 id="student-settings-heading">Student and plan</h2>
            <p>These values set school years, the planning window, and progress shown on the overview.</p>
          </div>
        </header>
        <form onSubmit={save}>
          <div className={`form-grid two ${styles.settingsGrid}`}>
            <label className="form-field"><span>Preferred name</span><input value={draft.preferredName} onChange={(event) => setDraft({ ...draft, preferredName: event.target.value })} required /></label>
            <label className="form-field"><span>Age</span><input type="number" min={12} max={22} value={draft.age ?? ""} onChange={(event) => setDraft({ ...draft, age: event.target.value ? Number(event.target.value) : null })} /></label>
            <label className="form-field"><span>Current grade</span><select value={draft.gradeLevel ?? ""} onChange={(event) => setDraft({ ...draft, gradeLevel: event.target.value ? Number(event.target.value) as GradeLevel : null })}><option value="">Not set</option>{GRADE_LEVELS.map((grade) => <option key={grade} value={grade}>Grade {grade}</option>)}</select></label>
            <label className="form-field"><span>Expected graduation year</span><input type="number" min={currentYear} max={currentYear + 12} value={draft.graduationYear ?? ""} onChange={(event) => setDraft({ ...draft, graduationYear: event.target.value ? Number(event.target.value) : null })} /></label>
            <label className="form-field"><span>Plan starts</span><select value={draft.planStartGrade ?? ""} onChange={(event) => setDraft({ ...draft, planStartGrade: event.target.value ? Number(event.target.value) as GradeLevel : null })}><option value="">Not set</option>{GRADE_LEVELS.map((grade) => <option key={grade} value={grade}>Grade {grade}</option>)}</select></label>
            <label className="form-field"><span>Plan ends</span><select value={draft.planEndGrade ?? ""} onChange={(event) => setDraft({ ...draft, planEndGrade: event.target.value ? Number(event.target.value) as GradeLevel : null })}><option value="">Not set</option>{GRADE_LEVELS.map((grade) => <option key={grade} value={grade}>Grade {grade}</option>)}</select></label>
          </div>

          <fieldset className={styles.fieldset}>
            <legend>Graduation tracker</legend>
            <div className={styles.radioRows}>
              <label><input type="radio" name="tracker-mode" checked={draft.trackerMode === "full"} onChange={() => setDraft({ ...draft, trackerMode: "full", trackedAreas: allAreas.length > 0 ? allAreas : draft.trackedAreas })} /><span><strong>Full diploma</strong><small>Keep all official d.tech requirement areas in the graduation view.</small></span></label>
              <label><input type="radio" name="tracker-mode" checked={draft.trackerMode === "selected"} onChange={() => setDraft({ ...draft, trackerMode: "selected" })} /><span><strong>Focused overview</strong><small>Show selected areas in the overview while the graduation view keeps the full diploma audit.</small></span></label>
            </div>
          </fieldset>

          {draft.trackerMode === "selected" && (
            <fieldset className={styles.fieldset}>
              <legend>Overview requirement areas</legend>
              <div className={styles.requirementOptions}>
                {requirements.map((requirement) => (
                  <label key={requirement.id}>
                    <input type="checkbox" checked={draft.trackedAreas.includes(requirement.area)} onChange={() => toggleArea(requirement.area)} />
                    <span><strong>{requirement.name}</strong><small>{requirement.credits_required} credits required</small></span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <fieldset className={styles.fieldset}>
            <legend>Pilot Assistant</legend>
            <label className={styles.switchRow}><input type="checkbox" checked={draft.aiEnabled} disabled={!settings.ai_connection_approved_at && !draft.aiEnabled} onChange={(event) => setDraft({ ...draft, aiEnabled: event.target.checked, aiReviewMode: event.target.checked ? draft.aiReviewMode : "manual" })} /><span><strong>Enable Pilot</strong><small>{settings.ai_connection_approved_at ? "Pilot stays off unless you choose to enable it." : "Approve and test the connection from Pilot setup before enabling it."}</small></span></label>
            <div className={`form-grid two ${styles.pilotFields}`}>
              <label className="form-field"><span>Model</span><select disabled={!draft.aiEnabled} value={draft.aiModel} onChange={(event) => setDraft({ ...draft, aiModel: event.target.value as StudentSettings["ai_model"] })}>{AI_MODEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>Changing models may require a connection test before Pilot can be enabled.</small></label>
              <label className="form-field"><span>Change review</span><select disabled={!draft.aiEnabled} value={draft.aiReviewMode} onChange={(event) => setDraft({ ...draft, aiReviewMode: event.target.value as StudentSettings["ai_review_mode"] })}><option value="manual">Manual approval</option><option value="auto_review">Independent auto-review</option></select><small>{draft.aiReviewMode === "auto_review" ? "A separate reviewer applies approved changes and declines unsafe ones." : "You approve each proposed change before it is applied."}</small></label>
            </div>
          </fieldset>

          {error && <p className={styles.error} role="alert">{error}</p>}
          <div className={styles.saveRow}>
            {saved && <span className={styles.savedStatus} role="status"><Check size={15} weight="bold" /> Settings saved</span>}
            <button className="primary-button" type="submit" disabled={controlsDisabled || !dirty}>{saving ? "Saving" : "Save settings"}</button>
          </div>
        </form>
      </section>

      <NextStepsManager tasks={tasks} busy={busy} onAddTask={onAddTask} onUpdateTask={onUpdateTask} onDeleteTask={onDeleteTask} />
    </div>
  );
}
