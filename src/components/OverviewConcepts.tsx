import {
  ArrowRightIcon as ArrowRight,
  BookOpenIcon as BookOpen,
  CheckCircleIcon as CheckCircle,
  ClockIcon as Clock,
  GaugeIcon as Gauge,
  GraduationCapIcon as GraduationCap,
  ListChecksIcon as ListChecks,
  SparkleIcon as Sparkle,
  WarningIcon as Warning
} from "@phosphor-icons/react";
import { useState } from "react";
import InstitutionMark from "@/components/InstitutionMark";
import AnimatedContent from "@/components/reactbits/AnimatedContent";
import CountUp from "@/components/reactbits/CountUp";
import FadeContent from "@/components/reactbits/FadeContent";
import WorkspaceTabs from "@/components/WorkspaceTabs";

type OverviewOption = "priority" | "scorecard" | "path" | "advisor" | "dual";

export interface OverviewRequirementItem {
  id: string;
  name: string;
  required: number;
  completed: number;
  scheduled: number;
  remaining: number;
  status: "complete" | "on_track" | "missing";
}

export interface OverviewCourseItem {
  id: string;
  name: string;
  source: string;
}

export interface OverviewTaskItem {
  id: string;
  title: string;
  detail: string;
}

export interface OverviewConceptData {
  trackerLabel: string;
  earnedPercent: number;
  completedCredits: number;
  scheduledCredits: number;
  requiredCredits: number;
  projectedWeightedGpa: string;
  gradedCredits: number;
  workloadLabel: string;
  knownWeeklyHours: number | null;
  workloadWarning: string | null;
  requirements: OverviewRequirementItem[];
  currentCourses: OverviewCourseItem[];
  plannedCourses: OverviewCourseItem[];
  courseCounts: { completed: number; current: number; planned: number };
  smccdCounts: { completed: number; current: number; planned: number };
  tasks: OverviewTaskItem[];
  summary: string | null;
}

interface Props {
  data: OverviewConceptData;
  onOpenGraduation: () => void;
  onOpenCourses: () => void;
  onOpenSmccd: () => void;
  onOpenTimeline: () => void;
  onOpenProfile: () => void;
  onGenerateTimeline: () => void;
  onCompleteTask: (id: string) => void;
}

const OPTION_NOTES: Record<OverviewOption, { label: string; title: string; note: string }> = {
  priority: { label: "Priority", title: "Option A: Priority brief", note: "Recommended. Leads with the next decision and hides completed detail until it is useful." },
  scorecard: { label: "Scorecard", title: "Option B: Academic scorecard", note: "Best for exact comparison. Keeps all eight requirements visible in one compact ledger." },
  path: { label: "Path", title: "Option C: Four-year path", note: "Best for temporal clarity. Organizes the plan as finished work, current work, and what comes next." },
  advisor: { label: "Advisor", title: "Option D: Advisor questions", note: "Simplest reading model. Answers the questions a student is most likely to ask in plain language." },
  dual: { label: "Two systems", title: "Option E: d.tech and SMCCD", note: "Best for concurrent enrollment. Separates high-school progress from college-course planning." }
};

export default function OverviewConcepts(props: Props) {
  const [option, setOption] = useState<OverviewOption>("priority");
  const note = OPTION_NOTES[option];
  return <>
    <section
      className="overview-review-toolbar"
      data-demo-only="overview-concept-review"
      data-intended-placement="Remove after Jay selects the production Overview composition."
      aria-label="Overview design concepts"
    >
      <WorkspaceTabs
        className="overview-option-tabs"
        items={(Object.entries(OPTION_NOTES) as Array<[OverviewOption, (typeof OPTION_NOTES)[OverviewOption]]>).map(([id, item]) => ({ id, label: item.label }))}
        value={option}
        onChange={setOption}
        label="Choose an Overview concept"
        layoutId="overview-option-indicator"
      />
      <p><strong>{note.title}</strong><span>{note.note}</span></p>
    </section>
    <FadeContent key={option} className={`overview-concept overview-concept-${option}`}>
      {option === "priority" && <PriorityBrief {...props} />}
      {option === "scorecard" && <AcademicScorecard {...props} />}
      {option === "path" && <FourYearPath {...props} />}
      {option === "advisor" && <AdvisorQuestions {...props} />}
      {option === "dual" && <DualSystemView {...props} />}
    </FadeContent>
  </>;
}

function PriorityBrief({ data, onOpenGraduation, onOpenCourses, onOpenTimeline, onOpenProfile, onGenerateTimeline, onCompleteTask }: Props) {
  const gaps = data.requirements.filter((item) => item.remaining > 0);
  const largestGap = gaps[0];
  const coveredCount = data.requirements.length - gaps.length;
  return <div className="overview-priority-layout">
    <AnimatedContent className="overview-priority-answer">
      <div>
        <span>{data.trackerLabel}</span>
        <h2>{data.completedCredits === data.requiredCredits ? "Your tracked requirements are complete." : `${data.requiredCredits - data.completedCredits} earned credits remain.`}</h2>
        <p>{largestGap ? `${largestGap.name} is the largest open requirement. ${data.scheduledCredits} additional credits are already scheduled.` : "Every tracked area has verified coverage."}</p>
      </div>
      <strong><CountUp from={data.earnedPercent} to={data.earnedPercent} suffix="%" /></strong>
      <button className="primary-button" type="button" onClick={onOpenGraduation}>Review graduation <ArrowRight size={16} /></button>
    </AnimatedContent>

    {data.workloadWarning && <button className="overview-input-callout" type="button" onClick={onOpenProfile}><Warning size={18} weight="fill" /><span>{data.workloadWarning}</span><ArrowRight size={15} /></button>}

    <div className="overview-priority-columns">
      <AnimatedContent className="overview-attention-list" delay={0.04}>
        <header><h2>What needs attention</h2><p>{coveredCount} of {data.requirements.length} requirement areas are already covered.</p></header>
        {gaps.length ? <div>{gaps.slice(0, 4).map((item) => <button type="button" onClick={onOpenGraduation} key={item.id}>
          <span><strong>{item.name}</strong><small>{item.scheduled ? `${item.scheduled} scheduled` : "No course scheduled"}</small></span>
          <b>{item.remaining} cr open</b><ArrowRight size={14} />
        </button>)}</div> : <p className="overview-complete-message"><CheckCircle size={18} weight="fill" /> No graduation gaps are open.</p>}
      </AnimatedContent>
      <AnimatedContent className="overview-action-list" delay={0.08}>
        <header><h2>Next actions</h2><button className="quiet-button small" type="button" onClick={onOpenTimeline}>Timeline</button></header>
        <TaskList data={data} onCompleteTask={onCompleteTask} onGenerateTimeline={onGenerateTimeline} />
      </AnimatedContent>
    </div>

    <AnimatedContent className="overview-priority-footer" delay={0.1}>
      <button type="button" onClick={onOpenCourses}><BookOpen size={18} /><span><strong>Course plan</strong><small>{data.courseCounts.completed} done, {data.courseCounts.current} in progress, {data.courseCounts.planned} planned</small></span><ArrowRight size={16} /></button>
      <PlanNote summary={data.summary} />
    </AnimatedContent>
  </div>;
}

function AcademicScorecard({ data, onOpenGraduation, onOpenCourses, onOpenTimeline, onOpenProfile, onGenerateTimeline, onCompleteTask }: Props) {
  return <div className="overview-scorecard-layout">
    <AnimatedContent className="overview-scorecard-metrics">
      <div><span>{data.trackerLabel}</span><strong><CountUp from={data.earnedPercent} to={data.earnedPercent} suffix="%" /></strong><small>{data.completedCredits} of {data.requiredCredits} credits earned</small></div>
      <dl>
        <div><dt>Scheduled</dt><dd>{data.scheduledCredits} cr</dd></div>
        <div><dt>Weighted GPA</dt><dd>{data.projectedWeightedGpa}</dd></div>
        <div><dt>Workload</dt><dd>{data.workloadLabel}</dd></div>
      </dl>
    </AnimatedContent>
    <div className="overview-scorecard-grid">
      <AnimatedContent className="overview-scorecard-ledger" delay={0.04}>
        <header><div><h2>Requirement scorecard</h2><p>Earned, scheduled, and still open.</p></div><button className="quiet-button small" type="button" onClick={onOpenGraduation}>Open details</button></header>
        <div className="overview-scorecard-head" aria-hidden><span>Requirement</span><span>Earned</span><span>Scheduled</span><span>Open</span></div>
        <div>{data.requirements.map((item) => <button type="button" onClick={onOpenGraduation} key={item.id}>
          <span><strong>{item.name}</strong><small>{item.required} required</small></span><b>{item.completed}</b><b>{item.scheduled}</b><b className={item.remaining ? "open" : "complete"}>{item.remaining}</b>
        </button>)}</div>
      </AnimatedContent>
      <aside className="overview-scorecard-side">
        {data.workloadWarning && <button className="overview-input-callout" type="button" onClick={onOpenProfile}><Warning size={18} weight="fill" /><span>{data.workloadWarning}</span><ArrowRight size={15} /></button>}
        <button className="overview-scorecard-course" type="button" onClick={onOpenCourses}><BookOpen size={18} /><span><strong>Courses</strong><small>{data.courseCounts.completed} done / {data.courseCounts.current} current / {data.courseCounts.planned} planned</small></span><ArrowRight size={16} /></button>
        <section className="overview-scorecard-tasks"><header><h2>Next actions</h2><button className="quiet-button small" type="button" onClick={onOpenTimeline}>Timeline</button></header><TaskList data={data} onCompleteTask={onCompleteTask} onGenerateTimeline={onGenerateTimeline} /></section>
        <PlanNote summary={data.summary} compact />
      </aside>
    </div>
  </div>;
}

function FourYearPath({ data, onOpenGraduation, onOpenCourses, onOpenTimeline, onOpenProfile, onGenerateTimeline, onCompleteTask }: Props) {
  const completedAreas = data.requirements.filter((item) => item.remaining === 0);
  const openAreas = data.requirements.filter((item) => item.remaining > 0);
  return <div className="overview-path-layout">
    <AnimatedContent className="overview-path-summary">
      <div><h2>Your plan from finished work to graduation</h2><p>{data.completedCredits} credits are earned and {data.scheduledCredits} more are scheduled.</p></div>
      <dl><div><dt>Weighted GPA</dt><dd>{data.projectedWeightedGpa}</dd></div><div><dt>Known weekly time</dt><dd>{data.knownWeeklyHours === null ? "Not set" : `${data.knownWeeklyHours} hours`}</dd></div></dl>
    </AnimatedContent>
    {data.workloadWarning && <button className="overview-input-callout" type="button" onClick={onOpenProfile}><Warning size={18} weight="fill" /><span>{data.workloadWarning}</span><ArrowRight size={15} /></button>}
    <div className="overview-path-stages">
      <AnimatedContent className="overview-path-stage completed" delay={0.03}>
        <header><CheckCircle size={19} weight="fill" /><span><h2>Finished</h2><p>{data.courseCounts.completed} course records</p></span></header>
        <strong><CountUp from={data.earnedPercent} to={data.earnedPercent} suffix="%" /></strong>
        <p>{completedAreas.length} requirement areas are complete.</p>
        <button className="quiet-button" type="button" onClick={onOpenCourses}>Review Done courses</button>
      </AnimatedContent>
      <AnimatedContent className="overview-path-stage current" delay={0.06}>
        <header><Clock size={19} /><span><h2>In progress</h2><p>{data.currentCourses.length} courses now</p></span></header>
        <CourseNameList rows={data.currentCourses} empty="No courses are marked In progress." />
        <button className="quiet-button" type="button" onClick={onOpenCourses}>Open current courses</button>
      </AnimatedContent>
      <AnimatedContent className="overview-path-stage next" delay={0.09}>
        <header><GraduationCap size={20} /><span><h2>Next</h2><p>{openAreas.length} requirement areas open</p></span></header>
        {data.plannedCourses.length ? <CourseNameList rows={data.plannedCourses} empty="" /> : <div className="overview-path-gaps">{openAreas.slice(0, 3).map((item) => <button type="button" onClick={onOpenGraduation} key={item.id}><span>{item.name}</span><b>{item.remaining} cr</b></button>)}</div>}
        <button className="primary-button" type="button" onClick={data.plannedCourses.length ? onOpenCourses : onOpenGraduation}>{data.plannedCourses.length ? "Review planned courses" : "Plan open requirements"} <ArrowRight size={15} /></button>
      </AnimatedContent>
    </div>
    <div className="overview-path-lower"><section><header><h2>Timeline</h2><button className="quiet-button small" type="button" onClick={onOpenTimeline}>Open timeline</button></header><TaskList data={data} onCompleteTask={onCompleteTask} onGenerateTimeline={onGenerateTimeline} /></section><PlanNote summary={data.summary} /></div>
  </div>;
}

function AdvisorQuestions({ data, onOpenGraduation, onOpenCourses, onOpenTimeline, onOpenProfile, onGenerateTimeline, onCompleteTask }: Props) {
  const gaps = data.requirements.filter((item) => item.remaining > 0);
  const coverageAnswer = gaps.length === 0 ? "Yes. Every tracked area has verified coverage." : `${data.earnedPercent}% is earned. ${gaps.length} ${gaps.length === 1 ? "area remains" : "areas remain"} open.`;
  return <div className="overview-advisor-layout">
    <AnimatedContent className="overview-advisor-questions">
      <h2>Your plan, answered directly</h2>
      <div>
        <button type="button" onClick={onOpenGraduation}><span>Am I on track to graduate?</span><strong>{coverageAnswer}</strong><ArrowRight size={16} /></button>
        <button type="button" onClick={onOpenGraduation}><span>What is unfinished?</span><strong>{gaps.length ? gaps.map((item) => item.name).join(", ") : "No tracked requirements are open."}</strong><ArrowRight size={16} /></button>
        <button type="button" onClick={onOpenCourses}><span>What am I taking next?</span><strong>{data.courseCounts.current} in progress and {data.courseCounts.planned} planned.</strong><ArrowRight size={16} /></button>
        <button type="button" onClick={onOpenProfile}><span>Is the workload realistic?</span><strong>{data.workloadWarning ?? `${data.workloadLabel}. ${data.knownWeeklyHours ?? 0} known hours each week.`}</strong><ArrowRight size={16} /></button>
        <button type="button" onClick={onOpenTimeline}><span>What should I do now?</span><strong>{data.tasks.length ? data.tasks[0].title : "Generate a timeline from the current plan."}</strong><ArrowRight size={16} /></button>
      </div>
    </AnimatedContent>
    <aside className="overview-advisor-side">
      <AnimatedContent><section className="overview-advisor-facts"><h2>Numbers behind the answers</h2><dl><div><dt>Credits earned</dt><dd>{data.completedCredits} / {data.requiredCredits}</dd></div><div><dt>Weighted GPA</dt><dd>{data.projectedWeightedGpa}</dd></div><div><dt>Graded credits</dt><dd>{data.gradedCredits}</dd></div></dl></section></AnimatedContent>
      <AnimatedContent delay={0.05}><section className="overview-advisor-tasks"><header><h2>Open tasks</h2><button className="quiet-button small" type="button" onClick={onOpenTimeline}>Timeline</button></header><TaskList data={data} onCompleteTask={onCompleteTask} onGenerateTimeline={onGenerateTimeline} /></section></AnimatedContent>
      <PlanNote summary={data.summary} compact />
    </aside>
  </div>;
}

function DualSystemView({ data, onOpenGraduation, onOpenCourses, onOpenSmccd, onOpenTimeline, onOpenProfile, onGenerateTimeline, onCompleteTask }: Props) {
  const highSchoolGaps = data.requirements.filter((item) => item.remaining > 0);
  const smccdTotal = data.smccdCounts.completed + data.smccdCounts.current + data.smccdCounts.planned;
  return <div className="overview-dual-layout">
    <div className="overview-dual-columns">
      <AnimatedContent className="overview-system-column dtech">
        <header><InstitutionMark institution="dtech" size="rail" decorative /><span><h2>d.tech path</h2><p>High-school graduation and course plan</p></span></header>
        <div className="overview-system-result"><strong><CountUp from={data.earnedPercent} to={data.earnedPercent} suffix="%" /></strong><span>{data.completedCredits} of {data.requiredCredits} credits earned</span></div>
        <div className="overview-system-list">{highSchoolGaps.length ? highSchoolGaps.slice(0, 4).map((item) => <button type="button" onClick={onOpenGraduation} key={item.id}><span>{item.name}</span><b>{item.remaining} open</b></button>) : <p><CheckCircle size={17} weight="fill" /> Every tracked area is covered.</p>}</div>
        <button className="primary-button dtech-action" type="button" onClick={onOpenGraduation}>Open graduation <ArrowRight size={15} /></button>
      </AnimatedContent>
      <AnimatedContent className="overview-system-column smccd" delay={0.05}>
        <header><InstitutionMark institution="smccd" size="rail" decorative /><span><h2>College path</h2><p>SMCCD concurrent enrollment</p></span></header>
        <div className="overview-system-result"><strong>{smccdTotal}</strong><span>SMCCD courses in the saved plan</span></div>
        <dl className="overview-system-counts"><div><dt>Done</dt><dd>{data.smccdCounts.completed}</dd></div><div><dt>In progress</dt><dd>{data.smccdCounts.current}</dd></div><div><dt>Planned</dt><dd>{data.smccdCounts.planned}</dd></div></dl>
        <p className="overview-system-context"><Gauge size={17} /> Projected weighted GPA: <strong>{data.projectedWeightedGpa}</strong></p>
        <button className="primary-button college-action" type="button" onClick={onOpenSmccd}>Open SMCCD planner <ArrowRight size={15} /></button>
      </AnimatedContent>
    </div>
    {data.workloadWarning && <button className="overview-input-callout" type="button" onClick={onOpenProfile}><Warning size={18} weight="fill" /><span>{data.workloadWarning}</span><ArrowRight size={15} /></button>}
    <div className="overview-dual-lower">
      <button className="overview-dual-course-action" type="button" onClick={onOpenCourses}><BookOpen size={18} /><span><strong>One course board</strong><small>{data.courseCounts.completed} done, {data.courseCounts.current} in progress, {data.courseCounts.planned} planned across both systems</small></span><ArrowRight size={16} /></button>
      <section><header><h2>Next actions</h2><button className="quiet-button small" type="button" onClick={onOpenTimeline}>Timeline</button></header><TaskList data={data} onCompleteTask={onCompleteTask} onGenerateTimeline={onGenerateTimeline} /></section>
      <PlanNote summary={data.summary} compact />
    </div>
  </div>;
}

function TaskList({ data, onCompleteTask, onGenerateTimeline }: Pick<Props, "data" | "onCompleteTask" | "onGenerateTimeline">) {
  if (!data.tasks.length) return <div className="overview-task-empty"><ListChecks size={20} /><span><strong>No open tasks</strong><small>Build a timeline from the current grade and plan.</small></span><button className="secondary-button small" type="button" onClick={onGenerateTimeline}>Generate timeline</button></div>;
  return <div className="overview-concept-tasks">{data.tasks.map((task) => <label key={task.id}><input type="checkbox" onChange={() => onCompleteTask(task.id)} /><span><strong>{task.title}</strong><small>{task.detail}</small></span></label>)}</div>;
}

function CourseNameList({ rows, empty }: { rows: OverviewCourseItem[]; empty: string }) {
  if (!rows.length) return <p className="overview-course-empty">{empty}</p>;
  return <div className="overview-course-name-list">{rows.slice(0, 4).map((course) => <span key={course.id}><strong>{course.name}</strong><small>{course.source}</small></span>)}{rows.length > 4 && <b>+{rows.length - 4} more</b>}</div>;
}

function PlanNote({ summary, compact = false }: { summary: string | null; compact?: boolean }) {
  if (!summary) return null;
  return <section className={`overview-concept-note ${compact ? "compact" : ""}`}><Sparkle size={17} /><div><h2>Latest plan note</h2><p>{summary}</p></div></section>;
}
