import {
  ArrowSquareOutIcon as ArrowSquareOut,
  BookOpenIcon as BookOpen,
  MagnifyingGlassIcon as MagnifyingGlass,
  PlusIcon as Plus,
  TrashIcon as Trash,
  WarningIcon as Warning
} from "@phosphor-icons/react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState, type SyntheticEvent } from "react";
import { calculateSmccdProgramProgress, SMCCD_COLLEGE_NAMES } from "@/lib/smccd";
import { schoolYearForGrade } from "@/lib/planning";
import type {
  GradeLevel,
  PlanCourse,
  PlanVersion,
  SmccdCollege,
  SmccdCourse,
  SmccdProgram,
  SmccdProgramRequirement,
  SmccdRequirementCourse,
  StudentProfile,
  StudentSmccdGoal
} from "@/lib/models";

interface Props {
  supabase: SupabaseClient;
  session: Session;
  profile: StudentProfile;
  activeVersion: PlanVersion;
  planCourses: PlanCourse[];
  onCourseAdded: (course: PlanCourse) => void;
  onCourseRemoved: (id: string) => void;
}

type CourseStatus = "completed" | "current" | "planned";
type CollegeFilter = "all" | SmccdCollege["code"];

export default function SmccdPlanner({
  supabase,
  session,
  profile,
  activeVersion,
  planCourses,
  onCourseAdded,
  onCourseRemoved
}: Props) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [colleges, setColleges] = useState<SmccdCollege[]>([]);
  const [courses, setCourses] = useState<SmccdCourse[]>([]);
  const [programs, setPrograms] = useState<SmccdProgram[]>([]);
  const [requirements, setRequirements] = useState<SmccdProgramRequirement[]>([]);
  const [requirementCourses, setRequirementCourses] = useState<SmccdRequirementCourse[]>([]);
  const [goals, setGoals] = useState<StudentSmccdGoal[]>([]);
  const [search, setSearch] = useState("");
  const [collegeFilter, setCollegeFilter] = useState<CollegeFilter>("all");
  const [transferFilter, setTransferFilter] = useState("all");
  const [goalProgramId, setGoalProgramId] = useState("");
  const [selectedCourse, setSelectedCourse] = useState<SmccdCourse | null>(null);
  const [courseDraft, setCourseDraft] = useState({
    gradeLevel: (profile.grade_level ?? 11) as GradeLevel,
    status: "planned" as CourseStatus,
    term: "fall" as PlanCourse["term"],
    collegeUnits: 3,
    dtechCredits: 0
  });
  const [manualDraft, setManualDraft] = useState({
    name: "",
    collegeUnits: 3,
    dtechCredits: 0,
    gradeLevel: (profile.grade_level ?? 11) as GradeLevel
  });

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [collegeResult, csmCourses, skylineCourses, canadaCourses, programResult, requirementResult, goalResult] = await Promise.all([
          supabase.from("smccd_colleges").select("*").order("code"),
          supabase.from("smccd_courses").select("*").eq("college_code", "CSM").order("course_code").limit(1500),
          supabase.from("smccd_courses").select("*").eq("college_code", "SKY").order("course_code").limit(1500),
          supabase.from("smccd_courses").select("*").eq("college_code", "CAN").order("course_code").limit(1500),
          supabase.from("smccd_programs").select("*").order("college_code").order("title").limit(500),
          supabase.from("smccd_program_requirements").select("*").order("program_id").order("sort_order").limit(1000),
          supabase.from("student_smccd_goals").select("*").eq("user_id", session.user.id)
        ]);
        const firstError = [collegeResult, csmCourses, skylineCourses, canadaCourses, programResult, requirementResult, goalResult]
          .map((result) => result.error)
          .find(Boolean);
        if (firstError) throw firstError;

        const allOptions: SmccdRequirementCourse[] = [];
        for (let offset = 0; ; offset += 1000) {
          const optionResult = await supabase
            .from("smccd_requirement_courses")
            .select("*")
            .order("requirement_id")
            .range(offset, offset + 999);
          if (optionResult.error) throw optionResult.error;
          allOptions.push(...((optionResult.data ?? []) as unknown as SmccdRequirementCourse[]));
          if ((optionResult.data ?? []).length < 1000) break;
        }

        if (!active) return;
        const loadedGoals = (goalResult.data ?? []) as unknown as StudentSmccdGoal[];
        setColleges((collegeResult.data ?? []) as unknown as SmccdCollege[]);
        setCourses([...(csmCourses.data ?? []), ...(skylineCourses.data ?? []), ...(canadaCourses.data ?? [])] as unknown as SmccdCourse[]);
        setPrograms((programResult.data ?? []) as unknown as SmccdProgram[]);
        setRequirements((requirementResult.data ?? []) as unknown as SmccdProgramRequirement[]);
        setRequirementCourses(allOptions);
        setGoals(loadedGoals);
        setGoalProgramId(loadedGoals.find((goal) => goal.is_primary)?.program_id ?? "");
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "SMCCD curriculum could not be loaded.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [session.user.id, supabase]);

  const visibleCourses = useMemo(() => {
    const query = search.trim().toLowerCase();
    return courses
      .filter((course) => collegeFilter === "all" || course.college_code === collegeFilter)
      .filter((course) => transferFilter === "all" || (transferFilter === "uc" ? course.transfer_credit?.includes("UC") : Boolean(course.transfer_credit)))
      .filter((course) => !query || `${course.course_code} ${course.title} ${course.subject}`.toLowerCase().includes(query))
      .slice(0, 80);
  }, [collegeFilter, courses, search, transferFilter]);

  const primaryGoal = goals.find((goal) => goal.is_primary) ?? null;
  const goalProgram = programs.find((program) => program.id === primaryGoal?.program_id) ?? null;
  const progress = useMemo(() => goalProgram
    ? calculateSmccdProgramProgress(goalProgram, requirements, requirementCourses, planCourses, courses)
    : null, [courses, goalProgram, planCourses, requirementCourses, requirements]);
  const districtRows = planCourses.filter((row) => Number(row.college_units ?? 0) > 0 || row.smccd_course_id);

  function chooseCourse(course: SmccdCourse) {
    setSelectedCourse(course);
    setCourseDraft({
      gradeLevel: (profile.grade_level ?? 11) as GradeLevel,
      status: "planned",
      term: "fall",
      collegeUnits: Number(course.units_max ?? course.units_min),
      dtechCredits: 0
    });
    setError(null);
    setNotice(null);
  }

  async function saveGoal() {
    if (!goalProgramId) {
      setError("Choose an AA or AS program first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const goalMutation = primaryGoal
        ? supabase.from("student_smccd_goals").update({ program_id: goalProgramId }).eq("id", primaryGoal.id)
        : supabase.from("student_smccd_goals").insert({
            user_id: session.user.id,
            program_id: goalProgramId,
            is_primary: true
          });
      const { data, error: mutationError } = await goalMutation.select("*").single();
      if (mutationError) throw mutationError;
      setGoals([data as unknown as StudentSmccdGoal]);
      setNotice("Associate-degree goal saved. Progress uses catalog rules and still requires counselor verification.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The SMCCD goal could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function addCatalogCourse(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (!selectedCourse) return;
    if (planCourses.some((row) => row.smccd_course_id === selectedCourse.id && row.status !== "completed")) {
      setError("That SMCCD course is already in the active plan.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data, error: insertError } = await supabase.from("plan_courses").insert({
        plan_version_id: activeVersion.id,
        user_id: session.user.id,
        smccd_course_id: selectedCourse.id,
        custom_course_name: `${selectedCourse.course_code} ${selectedCourse.title}`,
        grade_level: courseDraft.gradeLevel,
        school_year: schoolYearForGrade(profile.graduation_year ?? new Date().getFullYear() + 3, courseDraft.gradeLevel),
        term: courseDraft.term,
        status: courseDraft.status,
        credits: courseDraft.dtechCredits,
        college_units: courseDraft.collegeUnits,
        is_weighted: false,
        mapping_verified: false,
        user_edited: true,
        notes: `${SMCCD_COLLEGE_NAMES[selectedCourse.college_code]} ${selectedCourse.source_year} catalog. Verify schedule availability, prerequisites, d.tech approval, and transcript delivery.`,
        sort_order: planCourses.length
      }).select("*").single();
      if (insertError) throw insertError;
      onCourseAdded(data as unknown as PlanCourse);
      setSelectedCourse(null);
      setNotice(`${selectedCourse.course_code} added to the academic plan as unverified.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The course could not be added.");
    } finally {
      setBusy(false);
    }
  }

  async function addManualCourse(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (!manualDraft.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: insertError } = await supabase.from("plan_courses").insert({
        plan_version_id: activeVersion.id,
        user_id: session.user.id,
        custom_course_name: manualDraft.name.trim(),
        grade_level: manualDraft.gradeLevel,
        school_year: schoolYearForGrade(profile.graduation_year ?? new Date().getFullYear() + 3, manualDraft.gradeLevel),
        term: "fall",
        status: "planned",
        credits: manualDraft.dtechCredits,
        college_units: manualDraft.collegeUnits,
        is_weighted: false,
        mapping_verified: false,
        user_edited: true,
        notes: "Manual SMCCD entry. Verify the exact catalog record, schedule, prerequisites, d.tech approval, and transcript delivery.",
        sort_order: planCourses.length
      }).select("*").single();
      if (insertError) throw insertError;
      onCourseAdded(data as unknown as PlanCourse);
      setManualDraft((current) => ({ ...current, name: "", dtechCredits: 0 }));
      setNotice("Manual college course added as unverified.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The manual course could not be added.");
    } finally {
      setBusy(false);
    }
  }

  async function removeCourse(row: PlanCourse) {
    setBusy(true);
    setError(null);
    const { error: removeError } = await supabase.from("plan_courses").delete().eq("id", row.id);
    if (removeError) setError(removeError.message);
    else {
      onCourseRemoved(row.id);
      setNotice("College course removed from the active plan.");
    }
    setBusy(false);
  }

  if (loading) return <div className="smccd-loading" role="status">Loading 2025-2026 SMCCD curriculum...</div>;

  return (
    <>
      <header className="page-header">
        <div>
          <h1>SMCCD concurrent enrollment</h1>
          <p>Search district catalogs, plan exact courses, and track a source-backed AA or AS goal.</p>
        </div>
        <a className="secondary-button" href="https://smccd.edu/k-12/" target="_blank" rel="noreferrer">Official K-12 steps <ArrowSquareOut size={16} /></a>
      </header>

      <div className="notice-strip warning"><Warning size={19} /><span>Catalog inclusion is not approval or a live course offering. Confirm parent and counselor permission, prerequisites, schedule availability, d.tech credit, and transcript delivery.</span></div>
      {error && <div className="inline-alert error" role="alert">{error}</div>}
      {notice && <div className="inline-alert success" role="status">{notice}</div>}

      <section className="smccd-source-line" aria-label="SMCCD source catalogs">
        {colleges.map((college) => (
          <a href={college.courses_url} target="_blank" rel="noreferrer" key={college.code}>
            <strong>{college.name}</strong>
            <span>{courses.filter((course) => course.college_code === college.code).length} courses</span>
            <ArrowSquareOut size={14} />
          </a>
        ))}
      </section>

      <section className="content-section smccd-goal-section">
        <header className="section-heading"><div><h2>Associate-degree goal</h2><p>Choose one official AA or AS program. Major progress excludes GE, residency, waivers, and substitutions.</p></div></header>
        <div className="smccd-goal-controls">
          <label className="form-field"><span>Program</span><select value={goalProgramId} onChange={(event) => setGoalProgramId(event.target.value)}><option value="">Choose a program</option>{Object.entries(SMCCD_COLLEGE_NAMES).map(([code, name]) => <optgroup label={name} key={code}>{programs.filter((program) => program.college_code === code).map((program) => <option value={program.id} key={program.id}>{program.title} ({program.award_type})</option>)}</optgroup>)}</select></label>
          <button className="primary-button" type="button" onClick={() => void saveGoal()} disabled={busy || !goalProgramId}>Save goal</button>
        </div>
        {goalProgram && progress && (
          <div className="smccd-progress">
            <div className="smccd-progress-summary">
              <div><span>Program</span><strong>{goalProgram.title} {goalProgram.award_type}</strong><small>{SMCCD_COLLEGE_NAMES[goalProgram.college_code]}</small></div>
              <div><span>Projected major units</span><strong>{progress.projectedMajorUnits} / {progress.requiredMajorUnits || "review"}</strong><small>{progress.majorPercent}% of parsed major-unit rules</small></div>
              <div><span>College units</span><strong>{progress.completedCollegeUnits} completed</strong><small>{progress.projectedCollegeUnits} including current and planned</small></div>
              <div><span>Requirement groups</span><strong>{progress.satisfiedRequirements} / {progress.totalRequirements}</strong><small>Catalog rules only</small></div>
            </div>
            <div className="smccd-requirement-list">
              {progress.requirements.map((item) => (
                <article key={item.requirement.id}>
                  <div><strong>{item.requirement.label}</strong><span>{item.selectedCourseCodes.length ? item.selectedCourseCodes.join(", ") : item.requirement.raw_text ?? "No matching planned course"}</span></div>
                  <b className={`requirement-state ${item.status}`}>{item.status === "manual_review" ? "Manual review" : item.status}</b>
                </article>
              ))}
            </div>
            <a className="quiet-button smccd-catalog-link" href={goalProgram.catalog_url} target="_blank" rel="noreferrer">Open official program requirements <ArrowSquareOut size={15} /></a>
          </div>
        )}
      </section>

      <section className="content-section smccd-catalog-section">
        <header className="section-heading"><div><h2>District course catalog</h2><p>2,461 source-backed course records from CSM, Skyline, and Cañada for 2025-2026.</p></div></header>
        <div className="smccd-filters">
          <label className="search-box"><MagnifyingGlass size={17} /><input aria-label="Search SMCCD courses" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search course code or title" /></label>
          <label className="form-field"><span>College</span><select value={collegeFilter} onChange={(event) => setCollegeFilter(event.target.value as CollegeFilter)}><option value="all">All colleges</option>{Object.entries(SMCCD_COLLEGE_NAMES).map(([code, name]) => <option value={code} key={code}>{name}</option>)}</select></label>
          <label className="form-field"><span>Transfer</span><select value={transferFilter} onChange={(event) => setTransferFilter(event.target.value)}><option value="all">All courses</option><option value="transferable">CSU or UC transferable</option><option value="uc">UC transferable</option></select></label>
        </div>
        <div className="smccd-course-table" role="table" aria-label="SMCCD courses">
          <div className="smccd-course-row smccd-course-head" role="row"><span role="columnheader">Course</span><span role="columnheader">College</span><span role="columnheader">Units</span><span role="columnheader">Transfer</span><span role="columnheader">Action</span></div>
          {visibleCourses.map((course) => (
            <div className="smccd-course-row" role="row" key={course.id}>
              <div role="cell"><a href={course.catalog_url} target="_blank" rel="noreferrer"><strong>{course.course_code}</strong> {course.title} <ArrowSquareOut size={13} /></a>{course.attributes.length > 0 && <small>{course.attributes.slice(0, 2).join(", ")}</small>}</div>
              <span role="cell">{course.college_code}</span>
              <span role="cell">{course.units_max && course.units_max !== course.units_min ? `${course.units_min}-${course.units_max}` : course.units_min}</span>
              <span role="cell">{course.transfer_credit ?? "Not listed"}</span>
              <button className="secondary-button small" type="button" onClick={() => chooseCourse(course)}>Select</button>
            </div>
          ))}
        </div>
        {visibleCourses.length === 80 && <p className="catalog-limit-note">Showing the first 80 matches. Refine the search to narrow the list.</p>}
      </section>

      {selectedCourse && (
        <form className="form-section smccd-course-draft" onSubmit={addCatalogCourse}>
          <div className="smccd-selected-heading"><BookOpen size={20} weight="duotone" /><div><h2>{selectedCourse.course_code} {selectedCourse.title}</h2><p>{SMCCD_COLLEGE_NAMES[selectedCourse.college_code]}, {selectedCourse.source_year} catalog</p></div></div>
          <div className="form-grid four"><label className="form-field"><span>Plan status</span><select value={courseDraft.status} onChange={(event) => setCourseDraft({ ...courseDraft, status: event.target.value as CourseStatus })}><option value="planned">Planned</option><option value="current">Current</option><option value="completed">Completed</option></select></label><label className="form-field"><span>High-school grade</span><select value={courseDraft.gradeLevel} onChange={(event) => setCourseDraft({ ...courseDraft, gradeLevel: Number(event.target.value) as GradeLevel })}>{[9, 10, 11, 12].map((grade) => <option key={grade} value={grade}>Grade {grade}</option>)}</select></label><label className="form-field"><span>College units</span><input type="number" min={0.5} max={19} step={0.5} value={courseDraft.collegeUnits} onChange={(event) => setCourseDraft({ ...courseDraft, collegeUnits: Number(event.target.value) })} /></label><label className="form-field"><span>Proposed d.tech credits</span><input type="number" min={0} max={30} step={0.5} value={courseDraft.dtechCredits} onChange={(event) => setCourseDraft({ ...courseDraft, dtechCredits: Number(event.target.value) })} /><small>Leave at 0 until d.tech confirms the conversion.</small></label></div>
          <div className="form-actions"><button className="primary-button" type="submit" disabled={busy}><Plus size={17} /> Add to plan</button><button className="quiet-button" type="button" onClick={() => setSelectedCourse(null)}>Cancel</button></div>
        </form>
      )}

      <section className="content-section smccd-plan-section">
        <header className="section-heading"><div><h2>College courses in this plan</h2><p>Transcript imports and planned catalog courses use the same district record when matched.</p></div></header>
        {districtRows.length ? <div className="source-list">{districtRows.map((row) => <article className="source-row" key={row.id}><div><strong>{row.custom_course_name ?? "SMCCD course"}</strong><span>{row.college_units ?? 0} college units, {row.credits ?? 0} proposed d.tech credits, grade {row.grade_level}</span></div><span className="confidence-tag uncertain">Verify</span><button className="icon-button danger" type="button" onClick={() => void removeCourse(row)} aria-label={`Remove ${row.custom_course_name ?? "college course"}`}><Trash size={16} /></button>{row.notes && <p>{row.notes}</p>}</article>)}</div> : <div className="empty-state"><BookOpen size={23} weight="duotone" /><strong>No college courses planned</strong><p>Search the district catalog or import a transcript to add exact SMCCD courses.</p></div>}
      </section>

      <details className="smccd-manual-entry">
        <summary>Course missing from the catalog?</summary>
        <form className="form-section compact-form" onSubmit={addManualCourse}>
          <h2>Add a manual course</h2>
          <label className="form-field"><span>Exact course code and title</span><input value={manualDraft.name} onChange={(event) => setManualDraft({ ...manualDraft, name: event.target.value })} required /></label>
          <div className="form-grid three"><label className="form-field"><span>College units</span><input type="number" min={0.5} max={19} step={0.5} value={manualDraft.collegeUnits} onChange={(event) => setManualDraft({ ...manualDraft, collegeUnits: Number(event.target.value) })} /></label><label className="form-field"><span>Proposed d.tech credits</span><input type="number" min={0} max={30} step={0.5} value={manualDraft.dtechCredits} onChange={(event) => setManualDraft({ ...manualDraft, dtechCredits: Number(event.target.value) })} /></label><label className="form-field"><span>Grade</span><select value={manualDraft.gradeLevel} onChange={(event) => setManualDraft({ ...manualDraft, gradeLevel: Number(event.target.value) as GradeLevel })}>{[9, 10, 11, 12].map((grade) => <option key={grade} value={grade}>Grade {grade}</option>)}</select></label></div>
          <button className="secondary-button" type="submit" disabled={busy}><Plus size={17} /> Add manual course</button>
        </form>
      </details>
    </>
  );
}
