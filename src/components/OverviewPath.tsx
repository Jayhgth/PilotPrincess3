import {
  ArrowRightIcon as ArrowRight,
  ListChecksIcon as ListChecks,
  PlusIcon as Plus,
  TrashIcon as Trash
} from "@phosphor-icons/react";
import { useState, type SyntheticEvent } from "react";

export interface OverviewRequirementItem {
  id: string;
  name: string;
  remaining: number;
}

export interface OverviewCourseItem {
  id: string;
  name: string;
  source: string;
  institution: string;
}

export interface OverviewTaskItem {
  id: string;
  title: string;
  detail: string;
  generated: boolean;
}

export interface OverviewTaskDraft {
  title: string;
  category: "academics" | "activities" | "college" | "summer" | "admin";
  dueLabel: string;
}

export interface OverviewPathData {
  earnedPercent: number;
  completedCredits: number;
  scheduledCredits: number;
  projectedWeightedGpa: string;
  requirements: OverviewRequirementItem[];
  currentCourses: OverviewCourseItem[];
  plannedCourses: OverviewCourseItem[];
  courseCounts: { completed: number; current: number; planned: number };
  tasks: OverviewTaskItem[];
}

interface Props {
  data: OverviewPathData;
  onOpenGraduation: () => void;
  onOpenCourses: () => void;
  onGenerateTimeline: () => void;
  onCompleteTask: (id: string) => void;
  onAddTask: (draft: OverviewTaskDraft) => boolean | Promise<boolean>;
  onDeleteTask: (id: string) => void | Promise<void>;
}

export default function OverviewPath(props: Props) {
  const { data, onOpenCourses, onOpenGraduation } = props;
  const completedAreas = data.requirements.filter((item) => item.remaining === 0);
  const openAreas = data.requirements.filter((item) => item.remaining > 0);

  return <div className="overview-t3-workbench">
    <dl className="t3-status-strip">
      <div><dt>Diploma</dt><dd>{data.earnedPercent}%</dd></div>
      <div><dt>Earned</dt><dd>{data.completedCredits} cr</dd></div>
      <div><dt>Scheduled</dt><dd>{data.scheduledCredits} cr</dd></div>
      <div><dt>Weighted GPA</dt><dd>{data.projectedWeightedGpa}</dd></div>
    </dl>
    <div className="t3-workbench-grid">
      <section className="t3-plan-log">
        <header><h2>Plan state</h2><span>{completedAreas.length}/{data.requirements.length} requirement areas complete</span></header>
        <article><span className="t3-log-code complete">Done</span><div><strong>{data.courseCounts.completed} saved course records</strong><p>Transcript-backed history and completed work.</p></div><button type="button" onClick={onOpenCourses}>Review</button></article>
        <article><span className="t3-log-code current">Now</span><div><strong>{data.currentCourses.length} active courses</strong><CourseNameList rows={data.currentCourses} empty="No courses are marked In progress." /></div><button type="button" onClick={onOpenCourses}>Open</button></article>
        <article><span className="t3-log-code next">Next</span><div><strong>{openAreas.length} requirement {openAreas.length === 1 ? "area" : "areas"} open</strong>{data.plannedCourses.length ? <CourseNameList rows={data.plannedCourses} empty="" /> : <NextRequirementList openAreas={openAreas} onOpenGraduation={onOpenGraduation} />}</div><button type="button" onClick={onOpenGraduation}>Plan</button></article>
      </section>
      <aside className="t3-workbench-rail">
        <section><header><h2>Action queue</h2></header><TaskList {...props} /></section>
        <section className="t3-next-gap"><span>First open requirement</span><strong>{openAreas[0]?.name ?? "Plan covered"}</strong><p>{openAreas[0] ? `${openAreas[0].remaining} credits remain.` : "Review the saved schedule before registration."}</p><button className="primary-button" type="button" onClick={onOpenGraduation}>Open evidence <ArrowRight size={14} /></button></section>
      </aside>
    </div>
  </div>;
}

function NextRequirementList({ openAreas, onOpenGraduation }: { openAreas: OverviewRequirementItem[]; onOpenGraduation: () => void }) {
  return <div className="overview-path-gaps">{openAreas.slice(0, 3).map((item) => <button type="button" onClick={onOpenGraduation} key={item.id}><span>{item.name}</span><b>{item.remaining} cr</b></button>)}</div>;
}

function TaskList({ data, onCompleteTask, onGenerateTimeline, onAddTask, onDeleteTask }: Pick<Props, "data" | "onCompleteTask" | "onGenerateTimeline" | "onAddTask" | "onDeleteTask">) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<OverviewTaskDraft>({ title: "", category: "academics", dueLabel: "" });
  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!await onAddTask(draft)) return;
    setDraft({ title: "", category: "academics", dueLabel: "" });
    setAdding(false);
  }
  return <div className="overview-task-workspace">
    {!data.tasks.length ? <div className="overview-task-empty"><ListChecks size={20} /><span><strong>No open tasks</strong><small>Sync plan-based steps or add your own.</small></span><button className="secondary-button small" type="button" onClick={onGenerateTimeline}>Sync plan steps</button></div> : <div className="overview-concept-tasks">{data.tasks.map((task) => <div className="overview-task-row" key={task.id}><label><input type="checkbox" onChange={() => onCompleteTask(task.id)} /><span><strong>{task.title}</strong><small>{task.detail}</small></span></label>{!task.generated && <button className="icon-button" type="button" onClick={() => void onDeleteTask(task.id)} aria-label={`Delete ${task.title}`}><Trash size={15} /></button>}</div>)}</div>}
    {adding ? <form className="overview-task-form" onSubmit={submit}><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Add a clear next action" required autoFocus /><div><select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as OverviewTaskDraft["category"] })}><option value="academics">Academics</option><option value="activities">Activities</option><option value="college">College</option><option value="summer">Summer</option><option value="admin">Admin</option></select><input value={draft.dueLabel} onChange={(event) => setDraft({ ...draft, dueLabel: event.target.value })} placeholder="Timing, optional" /><button className="primary-button small" type="submit">Add</button><button className="quiet-button small" type="button" onClick={() => setAdding(false)}>Cancel</button></div></form> : <button className="quiet-button small" type="button" onClick={() => setAdding(true)}><Plus size={15} /> Add action</button>}
  </div>;
}

function CourseNameList({ rows, empty }: { rows: OverviewCourseItem[]; empty: string }) {
  if (!rows.length) return <p className="overview-course-empty">{empty}</p>;
  return <div className="overview-course-name-list">{rows.slice(0, 4).map((course) => <span key={course.id}><strong>{course.name}</strong><small className={`overview-course-source institution-${course.institution.toLowerCase()}`}>{course.source}</small></span>)}{rows.length > 4 && <b>+{rows.length - 4} more</b>}</div>;
}
