import {
  ArrowRightIcon as ArrowRight,
  CheckCircleIcon as CheckCircle,
  ClockIcon as Clock,
  GraduationCapIcon as GraduationCap,
  ListChecksIcon as ListChecks,
  SparkleIcon as Sparkle,
  WarningIcon as Warning
} from "@phosphor-icons/react";
import { PlusIcon as Plus, TrashIcon as Trash } from "@phosphor-icons/react";
import { useState, type SyntheticEvent } from "react";
import AnimatedContent from "@/components/reactbits/AnimatedContent";
import CountUp from "@/components/reactbits/CountUp";
import FadeContent from "@/components/reactbits/FadeContent";

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
  knownWeeklyHours: number | null;
  workloadWarning: string | null;
  requirements: OverviewRequirementItem[];
  currentCourses: OverviewCourseItem[];
  plannedCourses: OverviewCourseItem[];
  courseCounts: { completed: number; current: number; planned: number };
  tasks: OverviewTaskItem[];
  summary: string | null;
}

interface Props {
  data: OverviewPathData;
  onOpenGraduation: () => void;
  onOpenCourses: () => void;
  onOpenProfile: () => void;
  onGenerateTimeline: () => void;
  onCompleteTask: (id: string) => void;
  onAddTask: (draft: OverviewTaskDraft) => boolean | Promise<boolean>;
  onDeleteTask: (id: string) => void | Promise<void>;
}

export default function OverviewPath({ data, onOpenGraduation, onOpenCourses, onOpenProfile, onGenerateTimeline, onCompleteTask, onAddTask, onDeleteTask }: Props) {
  const completedAreas = data.requirements.filter((item) => item.remaining === 0);
  const openAreas = data.requirements.filter((item) => item.remaining > 0);

  return <div className="overview-path-layout">
    <AnimatedContent className="overview-path-summary">
      <div><h2>Your path to graduation</h2><p>{data.completedCredits} credits are earned and {data.scheduledCredits} more are scheduled.</p></div>
      <dl><div><dt>Weighted GPA</dt><dd>{data.projectedWeightedGpa}</dd></div><div><dt>Known weekly time</dt><dd>{data.knownWeeklyHours === null ? "Not set" : `${data.knownWeeklyHours} hours`}</dd></div></dl>
    </AnimatedContent>

    {data.workloadWarning && <button className="overview-input-callout" type="button" onClick={onOpenProfile}><Warning size={18} weight="fill" /><span>{data.workloadWarning}</span><ArrowRight size={15} /></button>}

    <div className="overview-path-stages" aria-label="Course path">
      <FadeContent className="overview-path-stage completed">
        <header><CheckCircle size={19} weight="fill" /><span><h2>Finished</h2><p>{data.courseCounts.completed} course records</p></span></header>
        <strong><CountUp from={data.earnedPercent} to={data.earnedPercent} suffix="%" /></strong>
        <p>{completedAreas.length} requirement areas are complete.</p>
        <button className="quiet-button" type="button" onClick={onOpenCourses}>Review Done courses</button>
      </FadeContent>

      <FadeContent className="overview-path-stage current">
        <header><Clock size={19} /><span><h2>In progress</h2><p>{data.currentCourses.length} courses now</p></span></header>
        <CourseNameList rows={data.currentCourses} empty="No courses are marked In progress." />
        <button className="quiet-button" type="button" onClick={onOpenCourses}>Open current courses</button>
      </FadeContent>

      <FadeContent className="overview-path-stage next">
        <header><GraduationCap size={20} /><span><h2>Next</h2><p>{openAreas.length} requirement areas open</p></span></header>
        {data.plannedCourses.length
          ? <CourseNameList rows={data.plannedCourses} empty="" />
          : <div className="overview-path-gaps">{openAreas.slice(0, 3).map((item) => <button type="button" onClick={onOpenGraduation} key={item.id}><span>{item.name}</span><b>{item.remaining} cr</b></button>)}</div>}
        <button className="primary-button" type="button" onClick={data.plannedCourses.length ? onOpenCourses : onOpenGraduation}>{data.plannedCourses.length ? "Review planned courses" : "Plan open requirements"} <ArrowRight size={15} /></button>
      </FadeContent>
    </div>

    <div className="overview-path-lower">
      <section><header><h2>Next actions</h2></header><TaskList data={data} onCompleteTask={onCompleteTask} onGenerateTimeline={onGenerateTimeline} onAddTask={onAddTask} onDeleteTask={onDeleteTask} /></section>
      <PlanNote summary={data.summary} />
    </div>
  </div>;
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

function PlanNote({ summary }: { summary: string | null }) {
  if (!summary) return null;
  return <section className="overview-concept-note"><Sparkle size={17} /><div><h2>Latest plan note</h2><p>{summary}</p></div></section>;
}
