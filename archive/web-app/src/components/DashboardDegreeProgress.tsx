import { ArrowRightIcon as ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { BookmarkSimpleIcon as BookmarkSimple } from "@phosphor-icons/react/dist/csr/BookmarkSimple";
import { useMemo, type CSSProperties } from "react";
import InstitutionMark from "@/components/InstitutionMark";
import {
  calculateSmccdLocalDegreeProgress,
  calculateSmccdProgramProgressWithContext,
  createSmccdProgramProgressContext,
  smccdDegreeOverallPercent,
  SMCCD_COLLEGE_NAMES
} from "@/lib/smccd";
import type {
  PlanCourse,
  SmccdCourse,
  SmccdProgram,
  SmccdProgramRequirement,
  SmccdRequirementCourse,
  StudentSmccdGeCompletion,
  StudentSmccdGoal
} from "@/lib/models";

interface Props {
  planCourses: PlanCourse[];
  plannedSmccdCourses: SmccdCourse[];
  goals: StudentSmccdGoal[];
  programs: SmccdProgram[];
  requirements: SmccdProgramRequirement[];
  requirementCourses: SmccdRequirementCourse[];
  manualCompletions: StudentSmccdGeCompletion[];
  onOpen: () => void;
}
export default function DashboardDegreeProgress({ planCourses, plannedSmccdCourses, goals, programs, requirements, requirementCourses, manualCompletions, onOpen }: Props) {

  const rows = useMemo(() => {
    const progressContext = createSmccdProgramProgressContext(
      requirements,
      requirementCourses,
      planCourses,
      plannedSmccdCourses
    );
    const programById = new Map(programs.map((program) => [program.id, program]));
    return goals.flatMap((goal) => {
      const program = programById.get(goal.program_id);
      if (!program) return [];
      const progress = calculateSmccdProgramProgressWithContext(program, progressContext);
      const localDegreeProgress = calculateSmccdLocalDegreeProgress(
        progressContext,
        program.college_code,
        new Set(manualCompletions
          .filter((completion) => completion.college_code === program.college_code || completion.area === "information_literacy")
          .map((completion) => completion.area))
      );
      return [{ program, percent: smccdDegreeOverallPercent(progress, localDegreeProgress) }];
    }).slice(0, 3);
  }, [goals, manualCompletions, planCourses, plannedSmccdCourses, programs, requirementCourses, requirements]);

  if (!goals.length) return <div className="degree-dashboard-state"><BookmarkSimple size={20} aria-hidden /><strong>No degrees bookmarked</strong><button type="button" onClick={onOpen}>Browse degrees <ArrowRight size={14} /></button></div>;

  return <div className="degree-dashboard-chart" role="img" aria-label={rows.map(({ program, percent }) => `${program.title}: ${percent}% complete`).join(". ")}>
    {rows.map(({ program, percent }) => <button type="button" className="degree-chart-row" onClick={onOpen} key={program.id}>
      <span className="degree-chart-identity"><InstitutionMark institution={program.college_code} decorative /><span><strong>{program.title}</strong><small>{program.award_type}, {SMCCD_COLLEGE_NAMES[program.college_code]}</small></span></span>
      <span className="degree-chart-bars" aria-hidden>
        <span style={{ "--degree-progress": `${percent}%` } as CSSProperties} />
      </span>
      <b className="degree-chart-value">{percent}%</b>
    </button>)}
    {goals.length > rows.length && <button className="degree-chart-more" type="button" onClick={onOpen}>+{goals.length - rows.length} more <ArrowRight size={13} /></button>}
  </div>;
}
