import {
  ArrowRightIcon as ArrowRight,
  BookOpenIcon as BookOpen,
  ChartLineUpIcon as ChartLineUp,
  CheckCircleIcon as CheckCircle,
  FileTextIcon as FileText,
  GraduationCapIcon as GraduationCap
} from "@phosphor-icons/react";
import type { CSSProperties } from "react";

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

export interface OverviewPathData {
  earnedPercent: number;
  completedCredits: number;
  scheduledCredits: number;
  remainingCredits: number;
  projectedWeightedGpa: string;
  currentUnweightedGpa: string;
  gradedCredits: number;
  weightedCredits: number;
  transcriptBackedCourseCount: number;
  completedCollegeUnits: number;
  requirements: OverviewRequirementItem[];
  currentCourses: OverviewCourseItem[];
  plannedCourses: OverviewCourseItem[];
  courseCounts: { completed: number; current: number; planned: number };
}

interface Props {
  data: OverviewPathData;
  onOpenGraduation: () => void;
  onOpenCourses: () => void;
  onOpenGpa: () => void;
}

export default function OverviewPath({ data, onOpenCourses, onOpenGraduation, onOpenGpa }: Props) {
  const completedAreas = data.requirements.filter((item) => item.remaining === 0);
  const openAreas = data.requirements.filter((item) => item.remaining > 0);
  const nextRequirement = openAreas[0] ?? null;
  const totalCredits = data.completedCredits + data.scheduledCredits + data.remainingCredits;
  const completedAngle = totalCredits > 0 ? (data.completedCredits / totalCredits) * 360 : 0;
  const scheduledAngle = totalCredits > 0 ? ((data.completedCredits + data.scheduledCredits) / totalCredits) * 360 : 0;
  const chartStyle = {
    "--completed-angle": `${completedAngle}deg`,
    "--scheduled-angle": `${scheduledAngle}deg`
  } as CSSProperties;

  return <div className="overview-t3-workbench">
    <div className="t3-overview-primary">
      <section className="t3-credit-composition">
        <header className="t3-panel-heading">
          <div>
            <span className="t3-eyebrow"><GraduationCap size={14} weight="duotone" /> Diploma progress</span>
            <h2>Credit composition</h2>
          </div>
          <span className="t3-coverage-count">{completedAreas.length} of {data.requirements.length} areas covered</span>
        </header>

        <div className="t3-credit-body">
          <div
            className="t3-credit-donut"
            style={chartStyle}
            role="img"
            aria-label={`${data.completedCredits} credits earned, ${data.scheduledCredits} scheduled, and ${data.remainingCredits} remaining`}
          >
            <div><strong>{data.earnedPercent}%</strong><span>earned</span></div>
          </div>
          <dl className="t3-credit-legend">
            <div className="earned"><dt>Earned</dt><dd>{data.completedCredits}<span> cr</span></dd></div>
            <div className="scheduled"><dt>Scheduled</dt><dd>{data.scheduledCredits}<span> cr</span></dd></div>
            <div className="remaining"><dt>Remaining</dt><dd>{data.remainingCredits}<span> cr</span></dd></div>
          </dl>
        </div>

        <button className="t3-next-requirement" type="button" onClick={onOpenGraduation}>
          <span>
            <small>{nextRequirement ? "Next requirement to solve" : "Requirements covered"}</small>
            <strong>{nextRequirement?.name ?? "Review graduation evidence"}</strong>
          </span>
          <span className="t3-next-requirement-meta">{nextRequirement ? `${nextRequirement.remaining} credits` : "Open review"}<ArrowRight size={15} /></span>
        </button>
      </section>

      <section className="t3-gpa-focus">
        <header className="t3-panel-heading">
          <div>
            <span className="t3-eyebrow"><ChartLineUp size={14} weight="duotone" /> GPA outlook</span>
            <h2>Saved schedule projection</h2>
          </div>
          <button className="t3-text-action" type="button" onClick={onOpenGpa}>Open planner <ArrowRight size={14} /></button>
        </header>
        <div className="t3-gpa-primary">
          <span>Projected weighted GPA</span>
          <strong>{data.projectedWeightedGpa}</strong>
          <p>Includes saved courses with grades. Use the planner to test a different schedule.</p>
        </div>
        <dl className="t3-gpa-details">
          <div><dt>Current unweighted</dt><dd>{data.currentUnweightedGpa}</dd></div>
          <div><dt>Graded credits</dt><dd>{data.gradedCredits}</dd></div>
          <div><dt>Weighted credits</dt><dd>{data.weightedCredits}</dd></div>
        </dl>
      </section>
    </div>

    <div className="t3-overview-secondary">
      <section className="t3-course-horizon">
        <header className="t3-panel-heading">
          <div>
            <span className="t3-eyebrow"><BookOpen size={14} weight="duotone" /> Course horizon</span>
            <h2>What you are taking and what comes next</h2>
          </div>
          <button className="t3-text-action" type="button" onClick={onOpenCourses}>Open courses <ArrowRight size={14} /></button>
        </header>
        <div className="t3-course-columns">
          <div className="t3-course-column current">
            <div className="t3-course-column-heading"><span>Now</span><strong>{data.courseCounts.current}</strong></div>
            <CourseNameList rows={data.currentCourses} empty="No courses are marked In progress." />
          </div>
          <div className="t3-course-column planned">
            <div className="t3-course-column-heading"><span>Planned</span><strong>{data.courseCounts.planned}</strong></div>
            {data.plannedCourses.length
              ? <CourseNameList rows={data.plannedCourses} empty="" />
              : <NextRequirementList openAreas={openAreas} onOpenGraduation={onOpenGraduation} />}
          </div>
        </div>
      </section>

      <section className="t3-plan-evidence">
        <header className="t3-panel-heading">
          <div>
            <span className="t3-eyebrow"><FileText size={14} weight="duotone" /> Plan evidence</span>
            <h2>What supports this view</h2>
          </div>
        </header>
        <dl>
          <div><dt><CheckCircle size={16} weight="fill" /> Transcript-backed records</dt><dd>{data.transcriptBackedCourseCount}</dd></div>
          <div><dt><GraduationCap size={16} weight="duotone" /> Completed college units</dt><dd>{data.completedCollegeUnits}</dd></div>
          <div><dt><BookOpen size={16} weight="duotone" /> Completed course records</dt><dd>{data.courseCounts.completed}</dd></div>
        </dl>
        <p>d.tech credits and SMCCD units stay separate so each number matches its official source.</p>
      </section>
    </div>
  </div>;
}

function NextRequirementList({ openAreas, onOpenGraduation }: { openAreas: OverviewRequirementItem[]; onOpenGraduation: () => void }) {
  if (!openAreas.length) return <p className="overview-course-empty">Your saved plan covers every tracked requirement.</p>;
  return <div className="overview-path-gaps">{openAreas.slice(0, 3).map((item) => <button type="button" onClick={onOpenGraduation} key={item.id}><span>{item.name}</span><b>{item.remaining} cr</b></button>)}</div>;
}

function CourseNameList({ rows, empty }: { rows: OverviewCourseItem[]; empty: string }) {
  if (!rows.length) return <p className="overview-course-empty">{empty}</p>;
  return <div className="overview-course-name-list">{rows.slice(0, 4).map((course) => <span key={course.id}><strong>{course.name}</strong><small className={`overview-course-source institution-${course.institution.toLowerCase()}`}>{course.source}</small></span>)}{rows.length > 4 && <b>+{rows.length - 4} more</b>}</div>;
}
