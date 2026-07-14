import {
  ArrowRightIcon as ArrowRight,
  BookOpenIcon as BookOpen,
  ChartLineUpIcon as ChartLineUp,
  GraduationCapIcon as GraduationCap
} from "@phosphor-icons/react";
import type { CSSProperties, ReactNode } from "react";
import { BentoCard, BentoGrid } from "@/components/magicui/BentoGrid";

interface OverviewRequirementItem {
  id: string;
  name: string;
  remaining: number;
}

interface OverviewCourseItem {
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
  currentWeightedGpa: string;
  currentUnweightedGpa: string;
  currentGradedCredits: number;
  currentWeightedCredits: number;
  requirements: OverviewRequirementItem[];
  requirementsVerified: boolean;
  currentPeriodLabel: string;
  nextPeriodLabel: string;
  currentCourses: OverviewCourseItem[];
  plannedCourses: OverviewCourseItem[];
}

interface Props {
  data: OverviewPathData;
  degreeProgress: ReactNode;
  onOpenGraduation: () => void;
  onOpenCourses: () => void;
  onOpenGpa: () => void;
  onOpenDegrees: () => void;
}

export default function OverviewPath({ data, degreeProgress, onOpenCourses, onOpenGraduation, onOpenGpa, onOpenDegrees }: Props) {
  const completedAreas = data.requirements.filter((item) => item.remaining === 0);
  const openAreas = data.requirements.filter((item) => item.remaining > 0);
  const nextRequirement = openAreas[0] ?? null;
  const totalCredits = data.completedCredits + data.scheduledCredits + data.remainingCredits;
  const completedPercent = totalCredits > 0 ? (data.completedCredits / totalCredits) * 100 : 0;
  const scheduledPercent = totalCredits > 0 ? (data.scheduledCredits / totalCredits) * 100 : 0;
  const creditStyle = {
    "--earned-width": `${completedPercent}%`,
    "--scheduled-width": `${scheduledPercent}%`
  } as CSSProperties;

  return <BentoGrid className="overview-bento-grid">
    <BentoCard
      className="overview-bento-diploma"
      title="High school diploma"
      Icon={GraduationCap}
      action={<button className="bento-card-action" type="button" onClick={onOpenGraduation}>Open graduation <ArrowRight size={14} /></button>}
    >
      <div className="dashboard-credit-summary">
        <div className="dashboard-credit-total"><strong>{data.earnedPercent}%</strong><span>{data.requirementsVerified ? `${completedAreas.length} of ${data.requirements.length} areas complete` : "Catalog mapping needed"}</span></div>
        <dl>
          <div><dt>Earned</dt><dd>{data.completedCredits}<span> cr</span></dd></div>
          <div><dt>Scheduled</dt><dd>{data.scheduledCredits}<span> cr</span></dd></div>
          <div><dt>Open</dt><dd>{data.remainingCredits}<span> cr</span></dd></div>
        </dl>
      </div>
      <div className="dashboard-credit-chart" style={creditStyle} role="img" aria-label={`${data.completedCredits} credits earned, ${data.scheduledCredits} scheduled, and ${data.remainingCredits} remaining`}>
        <span className="earned" /><span className="scheduled" />
      </div>
      <button className="dashboard-next-requirement" type="button" onClick={onOpenGraduation}>
        <span><small>{data.requirementsVerified ? nextRequirement ? "Next requirement" : "Requirements" : "Requirements"}</small><strong>{data.requirementsVerified ? nextRequirement?.name ?? "All covered" : "Verify school catalog"}</strong></span>
        <span>{data.requirementsVerified && nextRequirement ? `${nextRequirement.remaining} credits open` : "Review"}<ArrowRight size={14} /></span>
      </button>
    </BentoCard>

    <BentoCard
      className="overview-bento-gpa"
      title="Current GPA"
      Icon={ChartLineUp}
      action={<button className="bento-card-action" type="button" onClick={onOpenGpa}>Open GPA <ArrowRight size={14} /></button>}
    >
      <div className="dashboard-gpa-primary"><span>Weighted</span><strong>{data.currentWeightedGpa}</strong></div>
      <dl className="dashboard-gpa-stats">
        <div><dt>Unweighted</dt><dd>{data.currentUnweightedGpa}</dd></div>
        <div><dt>Graded credits</dt><dd>{data.currentGradedCredits}</dd></div>
        <div><dt>Weighted credits</dt><dd>{data.currentWeightedCredits}</dd></div>
      </dl>
    </BentoCard>

    <BentoCard
      className="overview-bento-courses"
      title="Courses"
      Icon={BookOpen}
      action={<button className="bento-card-action" type="button" onClick={onOpenCourses}>Open courses <ArrowRight size={14} /></button>}
    >
      <div className="dashboard-course-periods">
        <section>
          <header><h3>{data.currentPeriodLabel}</h3><span>{data.currentCourses.length}</span></header>
          <CourseNameList rows={data.currentCourses} empty={`No courses placed in ${data.currentPeriodLabel}.`} />
        </section>
        <section>
          <header><h3>{data.nextPeriodLabel}</h3><span>{data.plannedCourses.length}</span></header>
          <CourseNameList rows={data.plannedCourses} empty={`No courses placed in ${data.nextPeriodLabel}.`} />
        </section>
      </div>
    </BentoCard>

    <BentoCard
      className="overview-bento-degrees"
      title="Associate degrees"
      Icon={GraduationCap}
      action={<button className="bento-card-action" type="button" onClick={onOpenDegrees}>Open degrees <ArrowRight size={14} /></button>}
    >
      {degreeProgress}
    </BentoCard>
  </BentoGrid>;
}

function CourseNameList({ rows, empty }: { rows: OverviewCourseItem[]; empty: string }) {
  if (!rows.length) return <p className="overview-course-empty">{empty}</p>;
  return <div className="overview-course-name-list">{rows.slice(0, 4).map((course) => <span key={course.id}><strong>{course.name}</strong><small className={`overview-course-source institution-${course.institution.toLowerCase()}`}>{course.source}</small></span>)}{rows.length > 4 && <b>+{rows.length - 4} more</b>}</div>;
}
