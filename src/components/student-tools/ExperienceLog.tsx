import {
  ArrowRightIcon as ArrowRight,
  ClockIcon as Clock,
  PencilSimpleIcon as PencilSimple,
  PlusIcon as Plus,
  TrashIcon as Trash
} from "@phosphor-icons/react";
import type { Session } from "@supabase/supabase-js";
import { useMemo, useState, type SyntheticEvent } from "react";
import FadeContent from "@/components/reactbits/FadeContent";
import type { Activity, WorkloadSummary } from "@/lib/models";
import styles from "./student-tools.module.css";

export interface ExperienceDraft {
  name: string;
  kind: Activity["kind"];
  role: string;
  organization: string;
  weeklyHours: number;
  weeksPerYear: number;
  startGrade: number;
  endGrade: number;
  description: string;
  impact: string;
  isActive: boolean;
}

interface ExperienceLogProps {
  session: Session;
  activities: Activity[];
  currentGrade: number;
  workload: WorkloadSummary | null;
  busy: boolean;
  onSave: (draft: ExperienceDraft, id: string | null) => boolean | Promise<boolean>;
  onRemove: (id: string) => void | Promise<void>;
  onNavigate: (destination: "profile") => void;
}

const activityKinds: Array<{ value: Activity["kind"]; label: string }> = [
  { value: "club", label: "Club" },
  { value: "athletics", label: "Athletics" },
  { value: "service", label: "Service" },
  { value: "work", label: "Work" },
  { value: "family", label: "Family responsibility" },
  { value: "internship", label: "Internship" },
  { value: "other", label: "Other" }
];

function emptyDraft(currentGrade: number): ExperienceDraft {
  const grade = Math.max(9, Math.min(12, currentGrade || 9));
  return {
    name: "",
    kind: "club",
    role: "",
    organization: "",
    weeklyHours: 2,
    weeksPerYear: 20,
    startGrade: grade,
    endGrade: grade,
    description: "",
    impact: "",
    isActive: true
  };
}

function draftFromActivity(activity: Activity): ExperienceDraft {
  return {
    name: activity.name,
    kind: activity.kind,
    role: activity.role ?? "",
    organization: activity.organization ?? "",
    weeklyHours: Number(activity.weekly_hours),
    weeksPerYear: Number(activity.weeks_per_year ?? 20),
    startGrade: activity.start_grade ?? 9,
    endGrade: activity.end_grade ?? activity.start_grade ?? 9,
    description: activity.description ?? "",
    impact: activity.impact ?? "",
    isActive: activity.is_active ?? true
  };
}

function kindLabel(kind: Activity["kind"]) {
  return activityKinds.find((option) => option.value === kind)?.label ?? "Experience";
}

export default function ExperienceLog({
  session,
  activities,
  currentGrade,
  workload,
  busy,
  onSave,
  onRemove,
  onNavigate
}: ExperienceLogProps) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ExperienceDraft>(() => emptyDraft(currentGrade));
  const active = useMemo(() => activities.filter((activity) => activity.is_active ?? true), [activities]);
  const past = useMemo(() => activities.filter((activity) => !(activity.is_active ?? true)), [activities]);
  const canEdit = Boolean(session.user.id) && !busy;

  function startNew() {
    setEditingId(null);
    setDraft(emptyDraft(currentGrade));
    setEditorOpen(true);
  }

  function startEdit(activity: Activity) {
    setEditingId(activity.id);
    setDraft(draftFromActivity(activity));
    setEditorOpen(true);
  }

  async function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const saved = await onSave(draft, editingId);
    if (!saved) return;
    setEditorOpen(false);
    setEditingId(null);
    setDraft(emptyDraft(currentGrade));
  }

  const workloadSentence = workload?.capacityRemaining === null || workload?.capacityRemaining === undefined
    ? null
    : workload.capacityRemaining >= 0
      ? `${workload.capacityRemaining} hours remain inside your saved weekly limit.`
      : `${Math.abs(workload.capacityRemaining)} hours exceed your saved weekly limit.`;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <h1>Experiences</h1>
          <p>Keep a factual record of the work, activities, and responsibilities that use your time.</p>
        </div>
        <button className={styles.primaryButton} type="button" onClick={startNew} disabled={!canEdit} aria-expanded={editorOpen} aria-controls="experience-editor">
          <Plus size={17} /> Add experience
        </button>
      </header>

      <p className={styles.contextLine}>
        <Clock size={17} aria-hidden />
        <span>{active.length} active {active.length === 1 ? "commitment" : "commitments"}, {workload?.weeklyActivityHours ?? 0} hours in a typical week.</span>
        {workloadSentence
          ? <strong className={(workload?.capacityRemaining ?? 0) < 0 ? styles.dangerText : ""}>{workloadSentence}</strong>
          : <button className={styles.textButton} type="button" onClick={() => onNavigate("profile")}>Set a weekly limit <ArrowRight size={14} /></button>}
      </p>

      {editorOpen && (
        <FadeContent className={styles.editor} duration={0.16}>
          <form onSubmit={submit} id="experience-editor">
            <div className={styles.editorHeading}>
              <div>
                <h2>{editingId ? "Edit experience" : "Add experience"}</h2>
                <p>Start with the facts. Add a result only when you can support it.</p>
              </div>
              <button className={styles.textButton} type="button" onClick={() => setEditorOpen(false)}>Cancel</button>
            </div>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span>Name</span>
                <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required autoFocus />
              </label>
              <label className={styles.field}>
                <span>Type</span>
                <select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as Activity["kind"] })}>
                  {activityKinds.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label className={styles.field}>
                <span>Hours each week</span>
                <input type="number" min={0} max={80} step={0.5} value={draft.weeklyHours} onChange={(event) => setDraft({ ...draft, weeklyHours: Number(event.target.value) })} />
              </label>
              <label className={styles.checkField}>
                <input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} />
                <span>Currently active</span>
              </label>
            </div>

            <details className={styles.formDetails}>
              <summary>Add role, dates, and evidence</summary>
              <div className={styles.formGrid}>
                <label className={styles.field}><span>Role</span><input value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} placeholder="Captain, member, caregiver" /></label>
                <label className={styles.field}><span>Organization</span><input value={draft.organization} onChange={(event) => setDraft({ ...draft, organization: event.target.value })} placeholder="Optional" /></label>
                <label className={styles.field}><span>Weeks each year</span><input type="number" min={0} max={52} value={draft.weeksPerYear} onChange={(event) => setDraft({ ...draft, weeksPerYear: Number(event.target.value) })} /></label>
                <label className={styles.field}><span>Start grade</span><select value={draft.startGrade} onChange={(event) => { const startGrade = Number(event.target.value); setDraft({ ...draft, startGrade, endGrade: Math.max(startGrade, draft.endGrade) }); }}>{[9, 10, 11, 12].map((grade) => <option value={grade} key={grade}>Grade {grade}</option>)}</select></label>
                <label className={styles.field}><span>End grade</span><select value={draft.endGrade} onChange={(event) => setDraft({ ...draft, endGrade: Number(event.target.value) })}>{[9, 10, 11, 12].filter((grade) => grade >= draft.startGrade).map((grade) => <option value={grade} key={grade}>Grade {grade}</option>)}</select></label>
                <label className={`${styles.field} ${styles.fullField}`}><span>What you did</span><textarea rows={3} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
                <label className={`${styles.field} ${styles.fullField}`}><span>Contribution or growth</span><textarea rows={3} value={draft.impact} onChange={(event) => setDraft({ ...draft, impact: event.target.value })} placeholder="A result, responsibility, or lesson you can explain" /></label>
              </div>
            </details>
            <div className={styles.formActions}>
              <button className={styles.primaryButton} type="submit" disabled={!canEdit}>{editingId ? "Save changes" : "Add experience"}</button>
            </div>
          </form>
        </FadeContent>
      )}

      <section className={styles.register} aria-labelledby="active-experiences-heading">
        <div className={styles.sectionHeading}>
          <h2 id="active-experiences-heading">Current commitments</h2>
          <span>{active.length}</span>
        </div>
        {active.length > 0 ? (
          <div className={styles.rowList}>
            {active.map((activity) => (
              <article className={styles.experienceRow} key={activity.id}>
                <div className={styles.rowBody}>
                  <div className={styles.rowTitle}>
                    <h3>{activity.name}</h3>
                    <span>{kindLabel(activity.kind)}</span>
                  </div>
                  <p>{[activity.role, activity.organization].filter(Boolean).join(", ") || "Role not recorded"}</p>
                  <small>{activity.weekly_hours} {Number(activity.weekly_hours) === 1 ? "hour" : "hours"} weekly, grade {activity.start_grade ?? "?"} to present</small>
                  {activity.impact && <p className={styles.impactText}>{activity.impact}</p>}
                </div>
                <div className={styles.rowActions}>
                  <button className={styles.iconButton} type="button" onClick={() => startEdit(activity)} aria-label={`Edit ${activity.name}`}><PencilSimple size={16} /></button>
                  <button className={`${styles.iconButton} ${styles.dangerButton}`} type="button" onClick={() => { if (window.confirm(`Remove ${activity.name}?`)) void onRemove(activity.id); }} disabled={!canEdit} aria-label={`Remove ${activity.name}`}><Trash size={16} /></button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <h3>No current experiences</h3>
            <p>Add one recurring commitment so workload checks use real hours.</p>
            <button className={styles.secondaryButton} type="button" onClick={startNew}><Plus size={16} /> Add the first one</button>
          </div>
        )}
      </section>

      {past.length > 0 && (
        <details className={styles.collapsedGroup}>
          <summary>{past.length} past {past.length === 1 ? "experience" : "experiences"}</summary>
          <div className={styles.compactList}>
            {past.map((activity) => (
              <button type="button" onClick={() => startEdit(activity)} key={activity.id}>
                <span><strong>{activity.name}</strong><small>{activity.role ?? kindLabel(activity.kind)}</small></span>
                <span>Grades {activity.start_grade ?? "?"}-{activity.end_grade ?? "?"}</span>
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
