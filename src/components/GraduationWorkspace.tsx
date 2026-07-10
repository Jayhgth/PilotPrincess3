import {
  ArrowSquareOutIcon as ArrowSquareOut,
  BookOpenIcon as BookOpen,
  GraduationCapIcon as GraduationCap,
  WarningIcon as Warning
} from "@phosphor-icons/react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import InstitutionMark from "@/components/InstitutionMark";
import FadeContent from "@/components/reactbits/FadeContent";
import WorkspaceTabs from "@/components/WorkspaceTabs";
import { calculateAgProgress, type AgArea, type AgCourseEvidence } from "@/lib/college-readiness";
import type {
  Course,
  PlanCourse,
  RequirementCourseEvidence,
  RequirementProgress,
  SmccdCourse,
  SmccdHighSchoolEquivalency,
  SmccdProgram,
  SmccdProgramRequirement,
  SmccdRequirementCourse,
  StudentSmccdGoal
} from "@/lib/models";
import { calculateSmccdProgramProgress, normalizeSmccdCourseCode, SMCCD_COLLEGE_NAMES } from "@/lib/smccd";

type GraduationView = "diploma" | "ag" | "degree";

interface Props {
  supabase: SupabaseClient;
  session: Session;
  progress: RequirementProgress[];
  planCourses: PlanCourse[];
  courses: Course[];
  smccdCourses: SmccdCourse[];
  equivalencies: SmccdHighSchoolEquivalency[];
  onFindDtechCourses: (area: RequirementProgress["requirement"]["area"]) => void;
  onOpenDtechCatalog: () => void;
  onOpenSmccdDegree: () => void;
}

const DTECH_REQUIREMENTS_URL = "https://docs.google.com/document/d/1N351ZQzwGakGiFf5ax7i7NE1BEA2k_civOL9atMWXJo/edit?usp=sharing";
const DTECH_AG_URL = "https://hs-articulation.ucop.edu/agcourselist/institution/574";
const UC_AG_RULES_URL = "https://admission.universityofcalifornia.edu/admission-requirements/first-year-requirements/subject-requirement-a-g.html";

export default function GraduationWorkspace({
  supabase,
  session,
  progress,
  planCourses,
  courses,
  smccdCourses,
  equivalencies,
  onFindDtechCourses,
  onOpenDtechCatalog,
  onOpenSmccdDegree
}: Props) {
  const [view, setView] = useState<GraduationView>("diploma");
  const firstDiplomaGap = progress.find((item) => item.status === "missing") ?? progress[0] ?? null;
  const [selectedDiplomaId, setSelectedDiplomaId] = useState(firstDiplomaGap?.requirement.id ?? "");
  const agProgress = useMemo(
    () => calculateAgProgress(planCourses, courses, smccdCourses, equivalencies),
    [courses, equivalencies, planCourses, smccdCourses]
  );
  const firstAgGap = agProgress.areas.find((item) => item.status === "missing") ?? agProgress.areas[0];
  const [selectedAgArea, setSelectedAgArea] = useState<AgArea>(firstAgGap.area);
  const [degreeLoading, setDegreeLoading] = useState(true);
  const [degreeError, setDegreeError] = useState<string | null>(null);
  const [goal, setGoal] = useState<StudentSmccdGoal | null>(null);
  const [program, setProgram] = useState<SmccdProgram | null>(null);
  const [programRequirements, setProgramRequirements] = useState<SmccdProgramRequirement[]>([]);
  const [programOptions, setProgramOptions] = useState<SmccdRequirementCourse[]>([]);
  const [selectedProgramRequirementId, setSelectedProgramRequirementId] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      setDegreeLoading(true);
      setDegreeError(null);
      try {
        const goalResult = await supabase
          .from("student_smccd_goals")
          .select("*")
          .eq("user_id", session.user.id)
          .eq("is_primary", true)
          .maybeSingle();
        if (goalResult.error) throw goalResult.error;
        if (!goalResult.data) {
          if (active) setGoal(null);
          return;
        }
        const loadedGoal = goalResult.data as unknown as StudentSmccdGoal;
        const [programResult, requirementResult] = await Promise.all([
          supabase.from("smccd_programs").select("*").eq("id", loadedGoal.program_id).single(),
          supabase.from("smccd_program_requirements").select("*").eq("program_id", loadedGoal.program_id).order("sort_order")
        ]);
        if (programResult.error) throw programResult.error;
        if (requirementResult.error) throw requirementResult.error;
        const loadedRequirements = (requirementResult.data ?? []) as unknown as SmccdProgramRequirement[];
        const requirementIds = loadedRequirements.map((requirement) => requirement.id);
        const optionResult = requirementIds.length
          ? await supabase.from("smccd_requirement_courses").select("*").in("requirement_id", requirementIds)
          : { data: [], error: null };
        if (optionResult.error) throw optionResult.error;
        if (!active) return;
        setGoal(loadedGoal);
        setProgram(programResult.data as unknown as SmccdProgram);
        setProgramRequirements(loadedRequirements);
        setProgramOptions((optionResult.data ?? []) as unknown as SmccdRequirementCourse[]);
        const firstActionable = loadedRequirements.find((requirement) => requirement.kind !== "text_rule") ?? loadedRequirements[0];
        setSelectedProgramRequirementId(firstActionable?.id ?? "");
      } catch (error) {
        if (active) setDegreeError(error instanceof Error ? error.message : "The degree goal could not be loaded.");
      } finally {
        if (active) setDegreeLoading(false);
      }
    })();
    return () => { active = false; };
  }, [session.user.id, supabase]);

  const degreeProgress = useMemo(
    () => program ? calculateSmccdProgramProgress(program, programRequirements, programOptions, planCourses, smccdCourses) : null,
    [planCourses, program, programOptions, programRequirements, smccdCourses]
  );

  const diplomaMissing = progress.filter((item) => item.status === "missing").length;
  const agMissing = agProgress.areas.filter((item) => item.status === "missing").length;

  return (
    <div className="graduation-workspace">
      <WorkspaceTabs
        className="graduation-workspace-tabs"
        items={[
          { id: "diploma", label: "d.tech diploma", count: diplomaMissing },
          { id: "ag", label: "UC/CSU A-G", count: agMissing },
          { id: "degree", label: "Associate degree", count: degreeProgress?.requirements.filter((item) => item.status === "missing").length }
        ]}
        value={view}
        onChange={setView}
        label="Graduation and eligibility views"
        layoutId="graduation-view-indicator"
      />

      <FadeContent key={view} className="graduation-view-transition">
        {view === "diploma" && <DiplomaView
          progress={progress}
          selectedId={selectedDiplomaId || firstDiplomaGap?.requirement.id || ""}
          onSelect={setSelectedDiplomaId}
          onFindCourses={onFindDtechCourses}
        />}
        {view === "ag" && <AgView
          progress={agProgress}
          selectedArea={selectedAgArea}
          onSelect={setSelectedAgArea}
          onFindCourses={(area) => area === "g" ? onOpenDtechCatalog() : onFindDtechCourses(agToRequirementArea(area))}
        />}
        {view === "degree" && <DegreeView
          loading={degreeLoading}
          error={degreeError}
          goal={goal}
          program={program}
          progress={degreeProgress}
          planCourses={planCourses}
          smccdCourses={smccdCourses}
          selectedRequirementId={selectedProgramRequirementId}
          onSelectRequirement={setSelectedProgramRequirementId}
          onOpenPlanner={onOpenSmccdDegree}
        />}
      </FadeContent>
    </div>
  );
}

function DiplomaView({
  progress,
  selectedId,
  onSelect,
  onFindCourses
}: {
  progress: RequirementProgress[];
  selectedId: string;
  onSelect: (id: string) => void;
  onFindCourses: Props["onFindDtechCourses"];
}) {
  const required = progress.reduce((sum, item) => sum + Number(item.requirement.credits_required), 0);
  const completed = progress.reduce((sum, item) => sum + Math.min(item.completedCredits, Number(item.requirement.credits_required)), 0);
  const projected = progress.reduce((sum, item) => sum + Math.min(item.verifiedProjectedCredits, Number(item.requirement.credits_required)), 0);
  const current = progress.reduce((sum, item) => sum + item.currentCredits, 0);
  const unverified = progress.reduce((sum, item) => sum + item.unverifiedCredits, 0);
  const open = Math.max(0, required - projected);
  const selected = progress.find((item) => item.requirement.id === selectedId) ?? progress[0];
  const missing = progress.filter((item) => item.status === "missing");

  return <>
    <EligibilitySummary
      identity={<InstitutionMark institution="dtech" size="header" decorative />}
      label="d.tech diploma"
      answer={open === 0 ? "The saved plan covers the diploma." : `${formatValue(open)} credits still need a course.`}
      body={`${formatValue(completed)} of ${formatValue(required)} required credits are earned. Scheduled work is shown separately.`}
      tone="dtech"
      metrics={[
        ["Earned", `${formatValue(completed)} cr`],
        ["In progress", `${formatValue(current)} cr`],
        ["Plan coverage", `${required ? Math.round((projected / required) * 100) : 0}%`],
        ["Needs verification", `${formatValue(unverified)} cr`]
      ]}
      action={missing[0] ? <button className="secondary-button small" type="button" onClick={() => onSelect(missing[0].requirement.id)}>Review first gap</button> : null}
    />
    <p className="graduation-source-note">Official 2025-26 d.tech rules. <a href={DTECH_REQUIREMENTS_URL} target="_blank" rel="noreferrer">Open source <ArrowSquareOut size={13} /></a></p>
    <div className="graduation-evidence-layout">
      <RequirementIndex
        title="Diploma requirements"
        description="Select a requirement to see every applied and excluded course."
        rows={progress.map((item) => ({
          id: item.requirement.id,
          title: item.requirement.name,
          requirement: `${formatValue(Number(item.requirement.credits_required))} credits`,
          completed: item.completedCredits,
          scheduled: item.currentCredits + item.plannedCredits,
          remaining: Math.max(0, Number(item.requirement.credits_required) - item.verifiedProjectedCredits),
          status: item.status === "complete" ? "Complete" : item.status === "on_track" ? "Covered" : "Gap"
        }))}
        selectedId={selected?.requirement.id ?? ""}
        onSelect={onSelect}
        unit="cr"
      />
      {selected && <EvidencePanel
        title={selected.requirement.name}
        description={selected.requirement.notes ?? `${selected.requirement.credits_required} verified credits required.`}
        status={selected.status === "complete" ? "Complete" : selected.status === "on_track" ? "Covered by plan" : `${formatValue(Math.max(0, Number(selected.requirement.credits_required) - selected.verifiedProjectedCredits))} credits open`}
        tone={selected.status}
        contributions={selected.contributions}
        unused={selected.unusedCourses}
        unverified={selected.unverifiedCourses}
        warnings={selected.ruleWarnings}
        action={<button className="primary-button small dtech-action" type="button" onClick={() => onFindCourses(selected.requirement.area)}><BookOpen size={15} /> Find courses</button>}
      />}
    </div>
  </>;
}

function AgView({
  progress,
  selectedArea,
  onSelect,
  onFindCourses
}: {
  progress: ReturnType<typeof calculateAgProgress>;
  selectedArea: AgArea;
  onSelect: (area: AgArea) => void;
  onFindCourses: (area: AgArea) => void;
}) {
  const selected = progress.areas.find((item) => item.area === selectedArea) ?? progress.areas[0];
  const open = Math.max(0, progress.requiredYears - progress.projectedYears);
  const firstGap = progress.areas.find((item) => item.status === "missing");
  return <>
    <EligibilitySummary
      identity={<span className="ag-identity" aria-hidden>A-G</span>}
      label="UC and CSU minimum subject preparation"
      answer={open === 0 ? "The saved plan covers the A-G course-year minimums." : `${formatValue(open)} ${open === 1 ? "course-year remains" : "course-years remain"} open.`}
      body={`${formatValue(progress.completedYears)} of 15 course-years are complete with eligible grades. Sequence details and admission eligibility still require official review.`}
      tone="ag"
      metrics={[
        ["Earned", `${formatValue(progress.completedYears)} yrs`],
        ["Plan coverage", `${progress.projectedPercent}%`],
        ["Before grade 12", `${formatValue(progress.projectedBeforeSeniorYears)} / 11`],
        ["Needs evidence", String(progress.unresolved.length)]
      ]}
      action={firstGap ? <button className="secondary-button small" type="button" onClick={() => onSelect(firstGap.area)}>Review first gap</button> : null}
    />
    <p className="graduation-source-note">Uses d.tech's official UC-approved course list and current UC rules. <a href={DTECH_AG_URL} target="_blank" rel="noreferrer">d.tech A-G list <ArrowSquareOut size={13} /></a><a href={UC_AG_RULES_URL} target="_blank" rel="noreferrer">UC rules <ArrowSquareOut size={13} /></a></p>
    <div className="graduation-evidence-layout">
      <RequirementIndex
        title="A-G subject areas"
        description="Current and planned courses are projections until completed with C or better."
        rows={progress.areas.map((item) => ({
          id: item.area,
          title: `${item.area.toUpperCase()}. ${item.name}`,
          requirement: formatYears(item.requiredYears),
          completed: item.completedYears,
          scheduled: item.currentYears + item.plannedYears,
          remaining: item.remainingYears,
          status: item.status === "complete" ? "Complete" : item.status === "covered" ? "Covered" : "Gap"
        }))}
        selectedId={selected.area}
        onSelect={(id) => onSelect(id as AgArea)}
        unit="yr"
      />
      <AgEvidencePanel
        area={selected}
        duplicateCount={progress.duplicates.length}
        onFindCourses={() => onFindCourses(selected.area)}
      />
    </div>
    {(progress.unresolved.length > 0 || progress.duplicates.length > 0) && <details className="graduation-global-evidence">
      <summary>Review {progress.unresolved.length + progress.duplicates.length} excluded or duplicate course records</summary>
      <div>{[...progress.unresolved, ...progress.duplicates].map((issue) => <div className="graduation-issue-row" key={`${issue.planCourseId}-${issue.reason}`}><InstitutionMark institution={issue.institution} decorative /><span><strong>{issue.courseName}</strong><small>{issue.reason}</small></span></div>)}</div>
    </details>}
  </>;
}

function DegreeView({
  loading,
  error,
  goal,
  program,
  progress,
  planCourses,
  smccdCourses,
  selectedRequirementId,
  onSelectRequirement,
  onOpenPlanner
}: {
  loading: boolean;
  error: string | null;
  goal: StudentSmccdGoal | null;
  program: SmccdProgram | null;
  progress: ReturnType<typeof calculateSmccdProgramProgress> | null;
  planCourses: PlanCourse[];
  smccdCourses: SmccdCourse[];
  selectedRequirementId: string;
  onSelectRequirement: (id: string) => void;
  onOpenPlanner: () => void;
}) {
  if (loading) return <div className="graduation-loading" role="status"><span /><span /><span /></div>;
  if (error) return <div className="inline-alert error" role="alert">{error}</div>;
  if (!goal || !program || !progress) return <section className="graduation-degree-empty">
    <InstitutionMark institution="smccd" size="header" decorative />
    <div><h2>No associate-degree goal selected</h2><p>Choose an AA or AS program to compare its major requirements with exact SMCCD courses in your plan.</p></div>
    <button className="primary-button college-action" type="button" onClick={onOpenPlanner}><GraduationCap size={17} /> Choose a degree</button>
  </section>;

  const selected = progress.requirements.find((item) => item.requirement.id === selectedRequirementId) ?? progress.requirements[0];
  const scheduledMajorUnits = Math.max(0, progress.projectedMajorUnits - progress.completedMajorUnits);
  const openMajorUnits = Math.max(0, progress.requiredMajorUnits - progress.projectedMajorUnits);
  const courseById = new Map(smccdCourses.map((course) => [course.id, course]));
  const requirementRows = progress.requirements.map((item) => degreeRequirementRow(item, planCourses, courseById));
  const selectedCourseRows = selected ? planCourses.filter((row) => {
    const code = row.smccd_course_id ? courseById.get(row.smccd_course_id)?.course_code : null;
    return code ? selected.selectedCourseCodes.includes(normalizeSmccdCourseCode(code)) : false;
  }) : [];

  return <>
    <EligibilitySummary
      identity={<InstitutionMark institution={program.college_code} size="rail" decorative />}
      label={`${SMCCD_COLLEGE_NAMES[program.college_code]} ${program.award_type}`}
      answer={openMajorUnits === 0 ? "The saved plan covers the parsed major-unit target." : `${formatValue(openMajorUnits)} major units remain open.`}
      body={`${program.title}. General education, residency, substitutions, and final award eligibility are not included in this estimate.`}
      tone="degree"
      metrics={[
        ["Major units done", formatValue(progress.completedMajorUnits)],
        ["Scheduled", formatValue(scheduledMajorUnits)],
        ["Parsed major target", formatValue(progress.requiredMajorUnits)],
        ["Award total", `${formatValue(program.total_degree_units)} units`]
      ]}
      action={<button className="secondary-button small" type="button" onClick={onOpenPlanner}>Change degree</button>}
    />
    <p className="graduation-source-note">Official 2025-26 program requirements. <a href={program.catalog_url} target="_blank" rel="noreferrer">Open program source <ArrowSquareOut size={13} /></a></p>
    <div className="graduation-evidence-layout">
      <RequirementIndex
        title="Major requirements"
        description="Parsed catalog groups only. Manual catalog rules stay visibly unresolved."
        rows={requirementRows}
        selectedId={selected?.requirement.id ?? ""}
        onSelect={onSelectRequirement}
      />
      {selected && <section className="graduation-evidence-panel degree-evidence-panel" aria-live="polite">
        <header><div><span>Major requirement</span><h2>{degreeRequirementTitle(selected.requirement.label)}</h2><p>{selected.requirement.raw_text ?? degreeRequirementLabel(selected)}</p></div><strong className={`eligibility-status ${selected.status}`}>{degreeStatusLabel(selected.status)}</strong></header>
        <div className="evidence-section">
          <h3>Courses in your plan</h3>
          {selectedCourseRows.length ? <div className="evidence-course-list">{selectedCourseRows.map((row) => {
            const course = row.smccd_course_id ? courseById.get(row.smccd_course_id) : null;
            return <div className="evidence-course-row" key={row.id}>{course ? <InstitutionMark institution={course.college_code} decorative /> : <InstitutionMark institution="smccd" decorative />}<span><strong>{course ? `${course.course_code} ${course.title}` : row.custom_course_name}</strong><small>{statusLabel(row.status)} · {formatValue(Number(row.college_units ?? 0))} units</small></span><b>{statusLabel(row.status)}</b></div>;
          })}</div> : <p className="evidence-empty">No exact course from this group is in the saved plan.</p>}
        </div>
        <div className="evidence-section">
          <h3>Eligible catalog options</h3>
          {selected.optionCourseCodes.length ? <div className="degree-option-list">{selected.optionCourseCodes.slice(0, 16).map((code) => <span key={code}>{code}</span>)}{selected.optionCourseCodes.length > 16 && <span>+{selected.optionCourseCodes.length - 16} more</span>}</div> : <p className="evidence-empty">This rule cannot be reduced to an exact course list. Use the official program page.</p>}
        </div>
        <button className="primary-button college-action" type="button" onClick={onOpenPlanner}><BookOpen size={15} /> Open degree planner</button>
      </section>}
    </div>
  </>;
}

function EligibilitySummary({
  identity,
  label,
  answer,
  body,
  tone,
  metrics,
  action
}: {
  identity: ReactNode;
  label: string;
  answer: string;
  body: string;
  tone: "dtech" | "ag" | "degree";
  metrics: Array<[string, string]>;
  action: ReactNode;
}) {
  return <section className={`eligibility-summary ${tone}`}>
    <div className="eligibility-answer"><div className="eligibility-identity">{identity}<span>{label}</span></div><h2>{answer}</h2><p>{body}</p>{action}</div>
    <dl>{metrics.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
  </section>;
}

function RequirementIndex({
  title,
  description,
  rows,
  selectedId,
  onSelect,
  unit = ""
}: {
  title: string;
  description: string;
  rows: Array<{ id: string; title: string; requirement: string; completed: number | string; scheduled: number | string; remaining: number | string; status: string }>;
  selectedId: string;
  onSelect: (id: string) => void;
  unit?: string;
}) {
  return <section className="graduation-requirement-index">
    <header><h2>{title}</h2><p>{description}</p></header>
    <div className="requirement-index-head" aria-hidden><span>Requirement</span><span>Done</span><span>Scheduled</span><span>Open</span><span>Status</span></div>
    <div className="requirement-index-list">{rows.map((row) => <button className={row.id === selectedId ? "selected" : ""} type="button" aria-pressed={row.id === selectedId} onClick={() => onSelect(row.id)} key={row.id}>
      <span><strong>{row.title}</strong><small>{row.requirement}</small></span>
      <b data-label="Done">{formatRequirementValue(row.completed, unit)}</b>
      <b data-label="Scheduled">{formatRequirementValue(row.scheduled, unit)}</b>
      <b data-label="Open">{formatRequirementValue(row.remaining, unit)}</b>
      <em className={statusClass(row.status)}>{row.status}</em>
    </button>)}</div>
  </section>;
}

function EvidencePanel({
  title,
  description,
  status,
  tone,
  contributions,
  unused,
  unverified,
  warnings,
  action
}: {
  title: string;
  description: string;
  status: string;
  tone: string;
  contributions: RequirementCourseEvidence[];
  unused: RequirementCourseEvidence[];
  unverified: RequirementCourseEvidence[];
  warnings: string[];
  action: ReactNode;
}) {
  return <section className="graduation-evidence-panel" aria-live="polite">
    <header><div><span>Selected requirement</span><h2>{title}</h2><p>{description}</p></div><strong className={`eligibility-status ${tone}`}>{status}</strong></header>
    {warnings.length > 0 && <div className="evidence-warning"><Warning size={16} /><span>{warnings.join(" ")}</span></div>}
    <EvidenceCourseSection title="Credits that count" rows={contributions} mode="applied" />
    {unverified.length > 0 && <EvidenceCourseSection title="Needs verification" rows={unverified} mode="unverified" />}
    {unused.length > 0 && <EvidenceCourseSection title="Verified but not needed here" rows={unused} mode="unused" />}
    {action}
  </section>;
}

function EvidenceCourseSection({ title, rows, mode }: { title: string; rows: RequirementCourseEvidence[]; mode: "applied" | "unverified" | "unused" }) {
  return <div className="evidence-section"><h3>{title}</h3>{rows.length ? <div className="evidence-course-list">{rows.map((row) => <div className="evidence-course-row" key={`${mode}-${row.planCourseId}`}>
    <InstitutionMark institution={row.institution} decorative />
    <span><strong>{row.courseName}</strong><small>Grade {row.gradeLevel} · {statusLabel(row.status)}{row.note ? ` · ${row.note}` : ""}</small></span>
    <b>{mode === "applied" ? `${formatValue(row.creditsApplied)} cr` : mode === "unused" ? `${formatValue(row.creditsAvailable - row.creditsApplied)} unused` : "Excluded"}</b>
  </div>)}</div> : <p className="evidence-empty">No course currently contributes to this requirement.</p>}</div>;
}

function AgEvidencePanel({ area, duplicateCount, onFindCourses }: {
  area: ReturnType<typeof calculateAgProgress>["areas"][number];
  duplicateCount: number;
  onFindCourses: () => void;
}) {
  return <section className="graduation-evidence-panel" aria-live="polite">
    <header><div><span>A-G area {area.area.toUpperCase()}</span><h2>{area.name}</h2><p>{area.rule}</p></div><strong className={`eligibility-status ${area.status}`}>{area.status === "complete" ? "Complete" : area.status === "covered" ? "Covered by plan" : `${formatYears(area.remainingYears)} open`}</strong></header>
    <div className="evidence-section"><h3>Approved coursework applied</h3>{area.contributions.length ? <div className="evidence-course-list">{area.contributions.map((course) => <AgCourseRow course={course} key={`${course.planCourseId}-${course.area}`} />)}</div> : <p className="evidence-empty">No approved course currently contributes to this area.</p>}</div>
    {area.unusedCourses.length > 0 && <div className="evidence-section"><h3>Approved coursework beyond the minimum</h3><div className="evidence-course-list">{area.unusedCourses.map((course) => <AgCourseRow course={course} unused key={`unused-${course.planCourseId}-${course.area}`} />)}</div></div>}
    {duplicateCount > 0 && <p className="evidence-context-note">Duplicate attempts are excluded globally and listed below the requirement workspace.</p>}
    <button className="primary-button small dtech-action" type="button" onClick={onFindCourses}><BookOpen size={15} /> Find approved courses</button>
  </section>;
}

function AgCourseRow({ course, unused = false }: { course: AgCourseEvidence; unused?: boolean }) {
  return <div className="evidence-course-row"><InstitutionMark institution={course.institution} decorative /><span><strong>{course.courseName}</strong><small>Grade {course.gradeLevel} · {statusLabel(course.status)}{course.note ? ` · ${course.note}` : ""}</small></span><b>{unused ? "Extra" : `${formatValue(course.yearsApplied)} yr`}</b></div>;
}

function degreeRequirementLabel(item: ReturnType<typeof calculateSmccdProgramProgress>["requirements"][number]) {
  if (item.requiredUnits !== null) return `${formatValue(item.requiredUnits)} units`;
  if (item.requirement.min_count) return `${item.requirement.min_count} courses`;
  if (item.requirement.kind === "all") return `${item.optionCourseCodes.length} required courses`;
  return "Catalog rule";
}

function degreeRequirementRow(
  item: ReturnType<typeof calculateSmccdProgramProgress>["requirements"][number],
  planCourses: PlanCourse[],
  courseById: Map<string, SmccdCourse>
) {
  const selectedCodes = new Set(item.selectedCourseCodes);
  const rowsByCode = new Map<string, PlanCourse[]>();
  for (const row of planCourses) {
    const code = row.smccd_course_id ? courseById.get(row.smccd_course_id)?.course_code : null;
    const normalized = code ? normalizeSmccdCourseCode(code) : null;
    if (!normalized || !selectedCodes.has(normalized)) continue;
    rowsByCode.set(normalized, [...(rowsByCode.get(normalized) ?? []), row]);
  }
  const bestRows = [...rowsByCode.values()].map((rows) => [...rows].sort((a, b) => statusRank(b.status) - statusRank(a.status))[0]);
  const usesUnits = item.requiredUnits !== null || item.requirement.kind === "choose_units";
  const completed = usesUnits
    ? sumDegreeUnits(bestRows.filter((row) => row.status === "completed"))
    : bestRows.filter((row) => row.status === "completed").length;
  const scheduled = usesUnits
    ? sumDegreeUnits(bestRows.filter((row) => row.status !== "completed"))
    : bestRows.filter((row) => row.status !== "completed").length;
  const target = usesUnits
    ? Number(item.requiredUnits ?? 0)
    : item.requirement.kind === "all"
      ? item.optionCourseCodes.length
      : Number(item.requirement.min_count ?? 1);
  const suffix = usesUnits ? "u" : "course";
  return {
    id: item.requirement.id,
    title: degreeRequirementTitle(item.requirement.label),
    requirement: degreeRequirementLabel(item),
    completed: degreeValue(completed, suffix),
    scheduled: degreeValue(scheduled, suffix),
    remaining: item.status === "manual_review" ? "Review" : degreeValue(Math.max(0, target - completed - scheduled), suffix),
    status: item.status === "satisfied" ? "Covered" : item.status === "partial" ? "Partial" : item.status === "manual_review" ? "Manual rule" : "Gap"
  };
}

function degreeRequirementTitle(label: string) {
  return label.replace(/:\s*\d+(?:\.\d+)?\s+units?\s*$/i, "").trim();
}

function degreeStatusLabel(status: ReturnType<typeof calculateSmccdProgramProgress>["requirements"][number]["status"]) {
  return status === "satisfied" ? "Covered" : status === "partial" ? "Partial" : status === "manual_review" ? "Manual rule" : "Gap";
}

function sumDegreeUnits(rows: PlanCourse[]) {
  return Math.round(rows.reduce((sum, row) => sum + Number(row.college_units ?? 0), 0) * 10) / 10;
}

function degreeValue(value: number, suffix: string) {
  const amount = formatValue(value);
  if (suffix === "course") return `${amount} ${value === 1 ? "course" : "courses"}`;
  return `${amount} ${suffix}`;
}

function statusRank(status: PlanCourse["status"]) {
  return status === "completed" ? 3 : status === "current" ? 2 : 1;
}

function agToRequirementArea(area: AgArea): RequirementProgress["requirement"]["area"] {
  return area === "a" ? "social_science"
    : area === "b" ? "english"
      : area === "c" ? "math"
        : area === "d" ? "lab_science"
          : area === "e" ? "world_language"
            : area === "f" ? "visual_performing_arts"
              : "design_lab";
}

function statusLabel(status: PlanCourse["status"]) {
  return status === "completed" ? "Done" : status === "current" ? "In progress" : "Planned";
}

function statusClass(status: string) {
  return /complete|covered|satisfied/i.test(status) ? "complete" : /gap|missing/i.test(status) ? "missing" : "partial";
}

function formatValue(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatYears(value: number) {
  return `${formatValue(value)} ${value === 1 ? "year" : "years"}`;
}

function formatRequirementValue(value: number | string, unit: string) {
  if (typeof value === "string") return value;
  return `${formatValue(value)}${unit ? ` ${unit}` : ""}`;
}
