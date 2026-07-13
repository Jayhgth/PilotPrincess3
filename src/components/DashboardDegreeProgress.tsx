import { ArrowRightIcon as ArrowRight, BookmarkSimpleIcon as BookmarkSimple } from "@phosphor-icons/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import InstitutionMark from "@/components/InstitutionMark";
import { createSmccdProgramProgressContext, calculateSmccdProgramProgressWithContext, SMCCD_COLLEGE_NAMES } from "@/lib/smccd";
import type {
  PlanCourse,
  SmccdCourse,
  SmccdProgram,
  SmccdProgramRequirement,
  SmccdRequirementCourse,
  StudentSmccdGoal
} from "@/lib/models";

interface Props {
  supabase: SupabaseClient;
  userId: string;
  planCourses: PlanCourse[];
  plannedSmccdCourses: SmccdCourse[];
  onOpen: () => void;
}

interface DegreeCatalogSlice {
  programs: SmccdProgram[];
  requirements: SmccdProgramRequirement[];
  requirementCourses: SmccdRequirementCourse[];
}

const degreeSliceCache = new Map<string, DegreeCatalogSlice>();
const degreeSliceRequests = new Map<string, Promise<DegreeCatalogSlice>>();

async function loadDegreeSlice(supabase: SupabaseClient, programIds: string[]) {
  const key = [...programIds].sort().join(":");
  const cached = degreeSliceCache.get(key);
  if (cached) return cached;
  const pending = degreeSliceRequests.get(key);
  if (pending) return pending;

  const request = (async () => {
    const [programResult, requirementResult] = await Promise.all([
      supabase.from("smccd_programs").select("*").in("id", programIds),
      supabase.from("smccd_program_requirements").select("*").in("program_id", programIds).order("sort_order")
    ]);
    const firstError = programResult.error ?? requirementResult.error;
    if (firstError) throw firstError;
    const requirements = (requirementResult.data ?? []) as unknown as SmccdProgramRequirement[];
    const requirementIds = requirements.map((requirement) => requirement.id);
    const optionResult = requirementIds.length
      ? await supabase.from("smccd_requirement_courses").select("*").in("requirement_id", requirementIds).limit(1000)
      : { data: [], error: null };
    if (optionResult.error) throw optionResult.error;
    const slice = {
      programs: (programResult.data ?? []) as unknown as SmccdProgram[],
      requirements,
      requirementCourses: (optionResult.data ?? []) as unknown as SmccdRequirementCourse[]
    };
    degreeSliceCache.set(key, slice);
    return slice;
  })().finally(() => degreeSliceRequests.delete(key));

  degreeSliceRequests.set(key, request);
  return request;
}

export default function DashboardDegreeProgress({ supabase, userId, planCourses, plannedSmccdCourses, onOpen }: Props) {
  const [goals, setGoals] = useState<StudentSmccdGoal[] | null>(null);
  const [catalog, setCatalog] = useState<DegreeCatalogSlice | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const goalResult = await supabase.from("student_smccd_goals").select("*").eq("user_id", userId);
        if (goalResult.error) throw goalResult.error;
        const loadedGoals = (goalResult.data ?? []) as unknown as StudentSmccdGoal[];
        if (!active) return;
        setGoals(loadedGoals);
        if (!loadedGoals.length) {
          setCatalog({ programs: [], requirements: [], requirementCourses: [] });
          return;
        }
        const loadedCatalog = await loadDegreeSlice(supabase, loadedGoals.map((goal) => goal.program_id));
        if (active) setCatalog(loadedCatalog);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Degree progress could not be loaded.");
      }
    })();
    return () => { active = false; };
  }, [supabase, userId]);

  const rows = useMemo(() => {
    if (!catalog || !goals) return [];
    const progressContext = createSmccdProgramProgressContext(
      catalog.requirements,
      catalog.requirementCourses,
      planCourses,
      plannedSmccdCourses
    );
    const programById = new Map(catalog.programs.map((program) => [program.id, program]));
    return goals.flatMap((goal) => {
      const program = programById.get(goal.program_id);
      if (!program) return [];
      const progress = calculateSmccdProgramProgressWithContext(program, progressContext);
      return [{ program, progress }];
    }).slice(0, 3);
  }, [catalog, goals, planCourses, plannedSmccdCourses]);

  if (error) return <div className="degree-dashboard-state error"><strong>Degree progress unavailable</strong><button type="button" onClick={onOpen}>Open degrees <ArrowRight size={14} /></button></div>;
  if (!catalog || !goals) return <div className="degree-dashboard-loading" aria-label="Loading degree progress"><span /><span /><span /></div>;
  if (!goals.length) return <div className="degree-dashboard-state"><BookmarkSimple size={20} aria-hidden /><strong>No degrees bookmarked</strong><button type="button" onClick={onOpen}>Browse degrees <ArrowRight size={14} /></button></div>;

  return <div className="degree-dashboard-chart" role="img" aria-label={rows.map(({ program, progress }) => `${program.title}: ${progress.majorPercent}% complete`).join(". ")}>
    {rows.map(({ program, progress }) => <button type="button" className="degree-chart-row" onClick={onOpen} key={program.id}>
      <span className="degree-chart-identity"><InstitutionMark institution={program.college_code} decorative /><span><strong>{program.title}</strong><small>{program.award_type}, {SMCCD_COLLEGE_NAMES[program.college_code]}</small></span></span>
      <span className="degree-chart-bars" aria-hidden>
        <span style={{ "--degree-progress": `${progress.majorPercent}%` } as CSSProperties} />
      </span>
      <b className="degree-chart-value">{progress.majorPercent}%</b>
    </button>)}
    {goals.length > rows.length && <button className="degree-chart-more" type="button" onClick={onOpen}>+{goals.length - rows.length} more <ArrowRight size={13} /></button>}
  </div>;
}
