import {
  ArrowSquareOutIcon as ArrowSquareOut,
  BookOpenIcon as BookOpen,
  BuildingsIcon as Buildings,
  WarningIcon as Warning
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import InstitutionMark from "@/components/InstitutionMark";
import WorkspaceTabs from "@/components/WorkspaceTabs";
import type { AcademicFrameworkProgress } from "@/lib/academic-frameworks";
import type {
  AcademicFrameworkConstraint,
  PlanCourse,
  RequirementCourseEvidence,
  RequirementProgress,
  School
} from "@/lib/models";

type GraduationView = "diploma" | "degree" | "general_education";

function graduationViewFromLocation() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("graduation") === "general-education") return "general_education";
  return params.get("graduation") === "degree" || params.get("college") === "degree" ? "degree" : "diploma";
}

interface Props {
  progress: RequirementProgress[];
  academicProgress: AcademicFrameworkProgress[];
  academicConstraints: AcademicFrameworkConstraint[];
  school: School;
  onFindDtechCourses: (area: RequirementProgress["requirement"]["area"]) => void;
  degreePlanner: ReactNode;
  generalEducationPlanner: ReactNode;
}

const DTECH_REQUIREMENTS_URL = "https://docs.google.com/document/d/1N351ZQzwGakGiFf5ax7i7NE1BEA2k_civOL9atMWXJo/edit?usp=sharing";

export default function GraduationWorkspace({
  progress,
  academicProgress,
  academicConstraints,
  school,
  onFindDtechCourses,
  degreePlanner,
  generalEducationPlanner
}: Props) {
  const [view, setView] = useState<GraduationView>(() => typeof window !== "undefined" ? graduationViewFromLocation() : "diploma");
  const firstDiplomaGap = progress.find((item) => item.status === "missing") ?? progress[0] ?? null;
  const [selectedDiplomaId, setSelectedDiplomaId] = useState(firstDiplomaGap?.requirement.id ?? "");

  useEffect(() => {
    const handlePopState = () => setView(graduationViewFromLocation());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const diplomaMissing = progress.filter((item) => item.status === "missing").length;

  function changeView(next: GraduationView) {
    setView(next);
    const url = new URL(window.location.href);
    if (next === "degree") url.searchParams.set("graduation", "degree");
    else if (next === "general_education") url.searchParams.set("graduation", "general-education");
    else url.searchParams.delete("graduation");
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  return (
    <div className="graduation-workspace">
      <WorkspaceTabs
        className="graduation-workspace-tabs"
        items={[
          { id: "diploma", label: "High school diploma", count: diplomaMissing },
          { id: "degree", label: "Associate degree" },
          { id: "general_education", label: "College gen-ed" }
        ]}
        value={view}
        onChange={changeView}
        label="Graduation and eligibility views"
      />

      <div className="graduation-view-transition">
        {view === "diploma" && <DiplomaView
          progress={progress}
          academicProgress={academicProgress}
          academicConstraints={academicConstraints}
          school={school}
          selectedId={selectedDiplomaId || firstDiplomaGap?.requirement.id || ""}
          onSelect={setSelectedDiplomaId}
          onFindCourses={onFindDtechCourses}
        />}
        {view === "degree" && degreePlanner}
        {view === "general_education" && generalEducationPlanner}
      </div>
    </div>
  );
}

function DiplomaView({
  progress,
  academicProgress,
  academicConstraints,
  school,
  selectedId,
  onSelect,
  onFindCourses
}: {
  progress: RequirementProgress[];
  academicProgress: AcademicFrameworkProgress[];
  academicConstraints: AcademicFrameworkConstraint[];
  school: School;
  selectedId: string;
  onSelect: (id: string) => void;
  onFindCourses: Props["onFindDtechCourses"];
}) {
  const localFramework = academicProgress.find((item) => item.framework.framework_type === "local_graduation") ?? null;
  const stateFramework = academicProgress.find((item) => item.framework.framework_type === "state_graduation") ?? null;
  const agFramework = academicProgress.find((item) => item.framework.framework_type === "uc_ag") ?? null;
  const availableLayers = [
    ...(progress.length ? [{ id: "local", label: "School diploma" }] : []),
    ...(stateFramework ? [{ id: "state", label: "California minimum" }] : []),
    ...(agFramework ? [{ id: "ag", label: "UC A–G" }] : [])
  ];
  const [layer, setLayer] = useState(() => progress.length ? "local" : stateFramework ? "state" : "ag");
  const activeFramework = layer === "state" ? stateFramework : layer === "ag" ? agFramework : localFramework;
  const required = progress.reduce((sum, item) => sum + Number(item.requirement.credits_required), 0);
  const completed = progress.reduce((sum, item) => sum + Math.min(item.completedCredits, Number(item.requirement.credits_required)), 0);
  const projected = progress.reduce((sum, item) => sum + Math.min(item.verifiedProjectedCredits, Number(item.requirement.credits_required)), 0);
  const current = progress.reduce((sum, item) => sum + item.currentCredits, 0);
  const unverified = progress.reduce((sum, item) => sum + item.unverifiedCredits, 0);
  const open = Math.max(0, required - projected);
  const selected = progress.find((item) => item.requirement.id === selectedId) ?? progress[0];
  const missing = progress.filter((item) => item.status === "missing");

  return <>
    <WorkspaceTabs
      className="graduation-layer-tabs"
      items={availableLayers}
      value={availableLayers.some((item) => item.id === layer) ? layer : availableLayers[0]?.id ?? "local"}
      onChange={setLayer}
      label="Academic requirement layer"
    />
    {layer !== "local" && activeFramework ? <AcademicFrameworkView
      progress={activeFramework}
      constraints={academicConstraints.filter((constraint) => constraint.framework_id === activeFramework.framework.id)}
    /> : progress.length ? <>
    <EligibilitySummary
      identity={school.slug === "design-tech-high-school" ? <InstitutionMark institution="dtech" size="header" decorative /> : <Buildings size={25} aria-hidden />}
      label="High school diploma"
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
    <p className="graduation-source-note">Official {school.short_name} rules. <a href={localFramework?.framework.source_url ?? DTECH_REQUIREMENTS_URL} target="_blank" rel="noreferrer">Open source <ArrowSquareOut size={13} /></a></p>
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
    </div></> : activeFramework ? <AcademicFrameworkView progress={activeFramework} constraints={[]} /> : <section className="framework-unavailable"><Warning size={18} /><div><strong>Requirement sources need review</strong><p>This school is selected, but its local graduation policy has not been published in Pilot yet.</p></div></section>}
  </>;
}

function AcademicFrameworkView({ progress, constraints }: { progress: AcademicFrameworkProgress; constraints: AcademicFrameworkConstraint[] }) {
  const percent = progress.requiredCredits ? Math.round(((progress.completedCredits + progress.scheduledCredits) / progress.requiredCredits) * 100) : 0;
  return <>
    <EligibilitySummary
      identity={<Buildings size={25} aria-hidden />}
      label={progress.framework.framework_type === "uc_ag" ? "College eligibility" : "Graduation floor"}
      answer={progress.mappingCoverage === "missing"
        ? "Course mappings still need verification."
        : progress.remainingCredits === 0 ? "The saved plan covers this framework." : `${formatValue(progress.remainingCredits / 10)} course-years remain open.`}
      body={progress.mappingCoverage === "missing"
        ? "The official requirements are loaded, but Pilot will not claim progress until this school's catalog is connected to them."
        : progress.mappingCoverage === "partial"
          ? "Verified course matches are counted. Requirements without a published local match stay marked for verification."
        : `${progress.completedRules} of ${progress.totalRules} areas are earned; scheduled courses are shown separately.`}
      tone="degree"
      metrics={[
        ["Earned", `${formatValue(progress.completedCredits / 10)} yr`],
        ["Scheduled", `${formatValue(progress.scheduledCredits / 10)} yr`],
        ["Plan coverage", `${percent}%`],
        ["Areas covered", `${progress.coveredRules}/${progress.totalRules}`]
      ]}
      action={null}
    />
    <p className="graduation-source-note">{progress.framework.source_label} · {progress.framework.academic_year}. <a href={progress.framework.source_url} target="_blank" rel="noreferrer">Open source <ArrowSquareOut size={13} /></a></p>
    {constraints.length > 0 && <div className="framework-constraints">{constraints.map((constraint) => <span key={constraint.id}><strong>{formatValue(constraint.numeric_value)} courses before grade {constraint.before_grade}</strong>{constraint.notes && <small>{constraint.notes}</small>}</span>)}</div>}
    <section className="graduation-requirement-index framework-requirement-index">
      <header><h2>{progress.framework.name}</h2><p>Earned and scheduled work only appears after an approved course-to-requirement match.</p></header>
      <div className="requirement-index-head" aria-hidden><span>Requirement</span><span>Earned</span><span>Scheduled</span><span>Open</span><span>Status</span></div>
      <div className="requirement-index-list">{progress.rules.map((row) => <div className="framework-requirement-row" key={row.rule.id}>
        <span><strong>{row.rule.title}</strong><small>{formatValue(row.requiredCredits / 10)} course-years{row.rule.minimum_grade ? ` · ${row.rule.minimum_grade} or better` : ""}</small></span>
        <b data-label="Earned">{formatValue(row.completedCredits / 10)} yr</b>
        <b data-label="Scheduled">{formatValue(row.scheduledCredits / 10)} yr</b>
        <b data-label="Open">{formatValue(row.remainingCredits / 10)} yr</b>
        <em className={statusClass(row.status)}>{row.status === "complete" ? "Complete" : row.status === "on_track" ? "Covered" : !row.mappingAvailable ? "Verify" : "Gap"}</em>
      </div>)}</div>
    </section>
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
  tone: "dtech" | "degree";
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


function statusLabel(status: PlanCourse["status"]) {
  return status === "completed" ? "Done" : status === "current" ? "In progress" : "Planned";
}

function statusClass(status: string) {
  return /complete|covered|satisfied/i.test(status) ? "complete" : /gap|missing/i.test(status) ? "missing" : "partial";
}

function formatValue(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatRequirementValue(value: number | string, unit: string) {
  if (typeof value === "string") return value;
  return `${formatValue(value)}${unit ? ` ${unit}` : ""}`;
}
