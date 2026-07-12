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
import type { UiVariant } from "@/ui-lab/variants";

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
  variant?: UiVariant;
  data: OverviewPathData;
  onOpenGraduation: () => void;
  onOpenCourses: () => void;
  onOpenProfile: () => void;
  onGenerateTimeline: () => void;
  onCompleteTask: (id: string) => void;
  onAddTask: (draft: OverviewTaskDraft) => boolean | Promise<boolean>;
  onDeleteTask: (id: string) => void | Promise<void>;
}

export default function OverviewPath(props: Props) {
  const { variant = "current", data } = props;
  const completedAreas = data.requirements.filter((item) => item.remaining === 0);
  const openAreas = data.requirements.filter((item) => item.remaining > 0);

  if (variant === "t3code") return <T3Workbench {...props} completedAreas={completedAreas} openAreas={openAreas} />;
  if (variant === "material") return <MaterialJourney {...props} completedAreas={completedAreas} openAreas={openAreas} />;
  if (variant === "mantine") return <MantineStudio {...props} completedAreas={completedAreas} openAreas={openAreas} />;
  if (variant === "chakra") return <ChakraFocus {...props} completedAreas={completedAreas} openAreas={openAreas} />;
  if (variant === "ant") return <CampusLedger {...props} completedAreas={completedAreas} openAreas={openAreas} />;
  if (variant === "radix") return <RadixBrief {...props} completedAreas={completedAreas} openAreas={openAreas} />;
  if (variant === "aria") return <AccessibleChecklist {...props} completedAreas={completedAreas} openAreas={openAreas} />;
  if (variant === "reactbits") return <KineticMap {...props} completedAreas={completedAreas} openAreas={openAreas} />;

  const { onOpenGraduation, onOpenCourses, onOpenProfile, onGenerateTimeline, onCompleteTask, onAddTask, onDeleteTask } = props;

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
        <header><GraduationCap size={20} /><span><h2>Next</h2><p>{openAreas.length} requirement {openAreas.length === 1 ? "area" : "areas"} open</p></span></header>
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

type VariantOverviewProps = Props & {
  completedAreas: OverviewRequirementItem[];
  openAreas: OverviewRequirementItem[];
};

function WorkloadCallout({ data, onOpenProfile }: Pick<Props, "data" | "onOpenProfile">) {
  if (!data.workloadWarning) return null;
  return <button className="overview-input-callout" type="button" onClick={onOpenProfile}><Warning size={18} weight="fill" /><span>{data.workloadWarning}</span><ArrowRight size={15} /></button>;
}

function ProgressNumber({ data }: Pick<Props, "data">) {
  return <strong className="overview-progress-number"><CountUp from={data.earnedPercent} to={data.earnedPercent} suffix="%" /></strong>;
}

function NextRequirementList({ openAreas, onOpenGraduation }: Pick<VariantOverviewProps, "openAreas" | "onOpenGraduation">) {
  return <div className="overview-path-gaps">{openAreas.slice(0, 3).map((item) => <button type="button" onClick={onOpenGraduation} key={item.id}><span>{item.name}</span><b>{item.remaining} cr</b></button>)}</div>;
}

function T3Workbench(props: VariantOverviewProps) {
  const { data, completedAreas, openAreas, onOpenCourses, onOpenGraduation } = props;
  return <div className="overview-t3-workbench">
    <dl className="t3-status-strip">
      <div><dt>Diploma</dt><dd>{data.earnedPercent}%</dd></div>
      <div><dt>Earned</dt><dd>{data.completedCredits} cr</dd></div>
      <div><dt>Scheduled</dt><dd>{data.scheduledCredits} cr</dd></div>
      <div><dt>Weighted GPA</dt><dd>{data.projectedWeightedGpa}</dd></div>
      <div><dt>Known time</dt><dd>{data.knownWeeklyHours === null ? "Unset" : `${data.knownWeeklyHours}h`}</dd></div>
    </dl>
    <WorkloadCallout {...props} />
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

function MaterialJourney(props: VariantOverviewProps) {
  const { data, completedAreas, openAreas, onOpenGraduation, onOpenCourses } = props;
  return <div className="overview-material-journey">
    <section className="material-progress-panel">
      <div><span>Diploma progress</span><ProgressNumber data={data} /><p>{data.completedCredits} earned, {data.scheduledCredits} scheduled</p></div>
      <dl><div><dt>Weighted GPA</dt><dd>{data.projectedWeightedGpa}</dd></div><div><dt>Weekly time</dt><dd>{data.knownWeeklyHours === null ? "Not set" : `${data.knownWeeklyHours}h`}</dd></div></dl>
    </section>
    <WorkloadCallout {...props} />
    <div className="material-journey-grid">
      <section className="material-route" aria-label="Course journey">
        <article className="material-route-stop complete"><span className="material-step-marker"><CheckCircle size={20} weight="fill" /></span><div><h2>Finished</h2><p>{data.courseCounts.completed} records, {completedAreas.length} requirement areas complete</p><button className="quiet-button" type="button" onClick={onOpenCourses}>Review completed work</button></div></article>
        <article className="material-route-stop current"><span className="material-step-marker"><Clock size={20} /></span><div><h2>In progress</h2><p>{data.currentCourses.length} courses this term</p><CourseNameList rows={data.currentCourses} empty="No courses are marked In progress." /><button className="quiet-button" type="button" onClick={onOpenCourses}>Open current schedule</button></div></article>
        <article className="material-route-stop next"><span className="material-step-marker"><GraduationCap size={20} /></span><div><h2>Next decision</h2><p>{openAreas.length} requirement {openAreas.length === 1 ? "area remains" : "areas remain"} open</p>{data.plannedCourses.length ? <CourseNameList rows={data.plannedCourses} empty="" /> : <NextRequirementList openAreas={openAreas} onOpenGraduation={onOpenGraduation} />}<button className="primary-button" type="button" onClick={data.plannedCourses.length ? onOpenCourses : onOpenGraduation}>Plan next courses <ArrowRight size={15} /></button></div></article>
      </section>
      <section className="material-action-panel"><header><h2>Action queue</h2><p>Keep the plan moving.</p></header><TaskList {...props} /></section>
    </div>
    <PlanNote summary={data.summary} />
  </div>;
}

function MantineStudio(props: VariantOverviewProps) {
  const { data, completedAreas, openAreas, onOpenCourses, onOpenGraduation } = props;
  return <div className="overview-mantine-studio">
    <WorkloadCallout {...props} />
    <section className="mantine-current-board">
      <header><div><h2>This term</h2><p>{data.currentCourses.length} active courses</p></div><button className="secondary-button" type="button" onClick={onOpenCourses}>Open schedule</button></header>
      <CourseNameList rows={data.currentCourses} empty="No courses are marked In progress." />
    </section>
    <section className="mantine-progress-band">
      <div><span>Diploma</span><ProgressNumber data={data} /><p>{completedAreas.length} of {data.requirements.length} areas complete</p></div>
      <div><span>Weighted GPA</span><strong>{data.projectedWeightedGpa}</strong><p>Projected from saved work</p></div>
      <div><span>Known time</span><strong>{data.knownWeeklyHours === null ? "Not set" : `${data.knownWeeklyHours}h`}</strong><p>Weekly commitments</p></div>
    </section>
    <section className="mantine-next-board"><header><div><h2>Planning bench</h2><p>{openAreas.length} requirement {openAreas.length === 1 ? "area still needs" : "areas still need"} a decision.</p></div><button className="primary-button" type="button" onClick={onOpenGraduation}>Review requirements</button></header>{data.plannedCourses.length ? <CourseNameList rows={data.plannedCourses} empty="" /> : <NextRequirementList openAreas={openAreas} onOpenGraduation={onOpenGraduation} />}</section>
    <section className="mantine-task-board"><header><h2>To do</h2></header><TaskList {...props} /></section>
    <button className="mantine-history-link" type="button" onClick={onOpenCourses}><CheckCircle size={17} /> {data.courseCounts.completed} completed course records</button>
  </div>;
}

function ChakraFocus(props: VariantOverviewProps) {
  const { data, completedAreas, openAreas, onOpenCourses, onOpenGraduation } = props;
  const nextArea = openAreas[0];
  return <div className="overview-chakra-focus">
    <section className="chakra-next-decision">
      <span>Next decision</span>
      <h2>{nextArea?.name ?? "Your graduation plan is covered"}</h2>
      <p>{nextArea ? `${nextArea.remaining} credits remain in this requirement area.` : "Review the saved schedule before registration."}</p>
      <button className="primary-button" type="button" onClick={onOpenGraduation}>{nextArea ? "Choose a course" : "Review graduation"} <ArrowRight size={15} /></button>
    </section>
    <WorkloadCallout {...props} />
    <section className="chakra-at-a-glance">
      <div className="chakra-progress"><ProgressNumber data={data} /><span>Diploma earned</span><p>{completedAreas.length} requirement areas complete</p></div>
      <div className="chakra-current"><header><h2>Right now</h2><button type="button" onClick={onOpenCourses}>View courses</button></header><CourseNameList rows={data.currentCourses} empty="No courses are marked In progress." /></div>
    </section>
    <section className="chakra-checklist"><header><h2>My checklist</h2><p>Small actions tied to the plan.</p></header><TaskList {...props} /></section>
    <dl className="chakra-facts"><div><dt>Weighted GPA</dt><dd>{data.projectedWeightedGpa}</dd></div><div><dt>Scheduled</dt><dd>{data.scheduledCredits} credits</dd></div><div><dt>Weekly time</dt><dd>{data.knownWeeklyHours === null ? "Not set" : `${data.knownWeeklyHours} hours`}</dd></div></dl>
  </div>;
}

function CampusLedger(props: VariantOverviewProps) {
  const { data, completedAreas, openAreas, onOpenCourses, onOpenGraduation } = props;
  const lifecycleRows = [
    { label: "Completed", value: `${data.courseCounts.completed} records`, detail: `${completedAreas.length} requirement areas complete`, action: onOpenCourses },
    { label: "Current term", value: `${data.currentCourses.length} courses`, detail: data.currentCourses.map((course) => course.name).join(", ") || "No active courses", action: onOpenCourses },
    { label: "Planning", value: `${openAreas.length} ${openAreas.length === 1 ? "area" : "areas"} open`, detail: openAreas.map((area) => area.name).join(", ") || "No open requirement areas", action: onOpenGraduation }
  ];
  return <div className="overview-campus-ledger">
    <section className="campus-stat-row"><div><span>Diploma completion</span><ProgressNumber data={data} /></div><div><span>Earned credits</span><strong>{data.completedCredits}</strong></div><div><span>Scheduled credits</span><strong>{data.scheduledCredits}</strong></div><div><span>Weighted GPA</span><strong>{data.projectedWeightedGpa}</strong></div><div><span>Weekly time</span><strong>{data.knownWeeklyHours === null ? "Not set" : `${data.knownWeeklyHours}h`}</strong></div></section>
    <WorkloadCallout {...props} />
    <section className="campus-ledger-table" aria-label="Academic planning status">
      <header><span>Status</span><span>Count</span><span>Details</span><span>Action</span></header>
      {lifecycleRows.map((row) => <article key={row.label}><strong>{row.label}</strong><span>{row.value}</span><p>{row.detail}</p><button type="button" onClick={row.action}>Open <ArrowRight size={14} /></button></article>)}
    </section>
    <div className="campus-lower-grid"><section><header><h2>Action queue</h2></header><TaskList {...props} /></section><section><header><h2>Planned courses</h2><button type="button" onClick={onOpenCourses}>Manage</button></header>{data.plannedCourses.length ? <CourseNameList rows={data.plannedCourses} empty="" /> : <p>No courses are planned yet.</p>}</section></div>
  </div>;
}

function RadixBrief(props: VariantOverviewProps) {
  const { data, completedAreas, openAreas, onOpenCourses, onOpenGraduation } = props;
  return <article className="overview-radix-brief">
    <header className="radix-brief-lead"><div><ProgressNumber data={data} /><p>of the d.tech diploma is earned</p></div><dl><div><dt>Weighted GPA</dt><dd>{data.projectedWeightedGpa}</dd></div><div><dt>Credits scheduled</dt><dd>{data.scheduledCredits}</dd></div><div><dt>Weekly time</dt><dd>{data.knownWeeklyHours === null ? "Not set" : `${data.knownWeeklyHours} hours`}</dd></div></dl></header>
    <WorkloadCallout {...props} />
    <section className="radix-brief-section"><header><h2>Now</h2><p>{data.currentCourses.length} courses are in progress.</p></header><CourseNameList rows={data.currentCourses} empty="No courses are marked In progress." /><button type="button" onClick={onOpenCourses}>Open the current plan</button></section>
    <section className="radix-brief-section next"><header><h2>What comes next</h2><p>{openAreas.length} requirement {openAreas.length === 1 ? "area remains" : "areas remain"} open.</p></header>{data.plannedCourses.length ? <CourseNameList rows={data.plannedCourses} empty="" /> : <NextRequirementList openAreas={openAreas} onOpenGraduation={onOpenGraduation} />}<button type="button" onClick={onOpenGraduation}>Read the graduation evidence</button></section>
    <section className="radix-brief-section tasks"><header><h2>Actions</h2><p>{completedAreas.length} requirement areas are already complete.</p></header><TaskList {...props} /></section>
  </article>;
}

function AccessibleChecklist(props: VariantOverviewProps) {
  const { data, completedAreas, openAreas, onOpenCourses, onOpenGraduation } = props;
  return <div className="overview-accessible-checklist">
    <section className="aria-progress-summary" aria-labelledby="aria-progress-title"><h2 id="aria-progress-title">Graduation status</h2><ProgressNumber data={data} /><p>{data.completedCredits} credits earned. {data.scheduledCredits} credits scheduled. {completedAreas.length} requirement areas complete.</p><dl><div><dt>Weighted GPA</dt><dd>{data.projectedWeightedGpa}</dd></div><div><dt>Known weekly time</dt><dd>{data.knownWeeklyHours === null ? "Not set" : `${data.knownWeeklyHours} hours`}</dd></div></dl></section>
    <WorkloadCallout {...props} />
    <ol className="aria-planning-steps">
      <li><span aria-hidden>1</span><div><h2>Review completed courses</h2><p>{data.courseCounts.completed} records are saved.</p><button type="button" onClick={onOpenCourses}>Open completed courses</button></div></li>
      <li><span aria-hidden>2</span><div><h2>Check this term</h2><CourseNameList rows={data.currentCourses} empty="No courses are marked In progress." /><button type="button" onClick={onOpenCourses}>Open current courses</button></div></li>
      <li><span aria-hidden>3</span><div><h2>Plan the remaining requirements</h2><p>{openAreas.length} {openAreas.length === 1 ? "area remains" : "areas remain"} open.</p><NextRequirementList openAreas={openAreas} onOpenGraduation={onOpenGraduation} /><button type="button" onClick={onOpenGraduation}>Open graduation tracker</button></div></li>
    </ol>
    <section className="aria-action-list"><header><h2>Next actions</h2></header><TaskList {...props} /></section>
  </div>;
}

function KineticMap(props: VariantOverviewProps) {
  const { data, completedAreas, openAreas, onOpenCourses, onOpenGraduation } = props;
  return <div className="overview-kinetic-map">
    <WorkloadCallout {...props} />
    <section className="kinetic-map-progress"><span>Diploma route</span><ProgressNumber data={data} /><p>{data.completedCredits} credits earned</p></section>
    <div className="kinetic-route-line" aria-hidden />
    <section className="kinetic-map-stop finished"><header><CheckCircle size={22} weight="fill" /><h2>Finished</h2></header><strong>{data.courseCounts.completed} records</strong><p>{completedAreas.length} requirement areas complete.</p><button type="button" onClick={onOpenCourses}>Review history</button></section>
    <section className="kinetic-map-stop current"><header><Clock size={22} /><h2>In motion</h2></header><CourseNameList rows={data.currentCourses} empty="No courses are marked In progress." /><button type="button" onClick={onOpenCourses}>Open this term</button></section>
    <section className="kinetic-map-stop next"><header><GraduationCap size={22} /><h2>Next turn</h2></header>{data.plannedCourses.length ? <CourseNameList rows={data.plannedCourses} empty="" /> : <NextRequirementList openAreas={openAreas} onOpenGraduation={onOpenGraduation} />}<button className="primary-button" type="button" onClick={onOpenGraduation}>Build the next move <ArrowRight size={15} /></button></section>
    <section className="kinetic-map-tasks"><header><h2>Loose ends</h2></header><TaskList {...props} /></section>
    <dl className="kinetic-map-facts"><div><dt>GPA</dt><dd>{data.projectedWeightedGpa}</dd></div><div><dt>Scheduled</dt><dd>{data.scheduledCredits} cr</dd></div><div><dt>Weekly time</dt><dd>{data.knownWeeklyHours === null ? "Unset" : `${data.knownWeeklyHours}h`}</dd></div></dl>
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
