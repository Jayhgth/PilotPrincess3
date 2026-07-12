import {
  ArrowSquareOutIcon as ArrowSquareOut,
  BookmarkSimpleIcon as BookmarkSimple,
  BookOpenIcon as BookOpen,
  CaretRightIcon as CaretRight,
  MagnifyingGlassIcon as MagnifyingGlass,
  PlusIcon as Plus,
  TrashIcon as Trash,
  WarningIcon as Warning
} from "@phosphor-icons/react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { useDeferredValue, useEffect, useMemo, useState, type SyntheticEvent } from "react";
import CourseCatalogBrowser from "@/components/CourseCatalogBrowser";
import InstitutionMark from "@/components/InstitutionMark";
import PrerequisiteReadout, { prerequisiteDisplay } from "@/components/PrerequisiteReadout";
import FadeContent from "@/components/reactbits/FadeContent";
import {
  calculateSmccdGeProgress,
  calculateSmccdProgramProgressWithContext,
  createSmccdProgramProgressContext,
  normalizeSmccdCourseCode,
  SMCCD_LOCAL_GE_SOURCE_URLS,
  SMCCD_COLLEGE_NAMES
} from "@/lib/smccd";
import { schoolYearForGrade, selectedPlanGrades } from "@/lib/planning";
import { createSmccdPlannerPrerequisiteEvaluator } from "@/lib/prerequisites";
import { normalizeCollegeCourseCode } from "@/lib/transcript";
import { createSmccdPlanCourseIndex, smccdCourseAlreadyInPlanIndex } from "@/lib/catalog-eligibility";
import type {
  GradeLevel,
  PlanCourse,
  PlanVersion,
  SmccdCollege,
  SmccdCourse,
  SmccdHighSchoolEquivalency,
  SmccdProgram,
  SmccdProgramRequirement,
  SmccdRequirementCourse,
  StudentSettings,
  StudentSmccdGoal
} from "@/lib/models";

interface Props {
  embedded?: boolean;
  surface?: SmccdSection;
  supabase: SupabaseClient;
  session: Session;
  settings: StudentSettings;
  activeVersion: PlanVersion;
  planCourses: PlanCourse[];
  equivalencies: SmccdHighSchoolEquivalency[];
  focusCourseId?: string | null;
  onCourseAdded?: (course: PlanCourse, catalogCourse?: SmccdCourse) => void;
  onCourseRemoved?: (id: string) => void;
  onOpenMyCourses?: () => void;
  onFindCourse?: (course: SmccdCourse) => void;
}

type CollegeFilter = "all" | SmccdCollege["code"];
type SmccdSection = "courses" | "degree";

interface SmccdCourseCatalog {
  colleges: SmccdCollege[];
  courses: SmccdCourse[];
}

interface SmccdDegreeCatalog {
  programs: SmccdProgram[];
  requirements: SmccdProgramRequirement[];
  requirementCourses: SmccdRequirementCourse[];
}

let courseCatalogRequest: Promise<SmccdCourseCatalog> | null = null;
let degreeCatalogRequest: Promise<SmccdDegreeCatalog> | null = null;

function loadCourseCatalog(supabase: SupabaseClient) {
  if (!courseCatalogRequest) {
    courseCatalogRequest = (async () => {
      const [collegeResult, csmCourses, skylineCourses, canadaCourses] = await Promise.all([
        supabase.from("smccd_colleges").select("*").order("code"),
        supabase.from("smccd_courses").select("*").eq("college_code", "CSM").order("course_code").limit(1500),
        supabase.from("smccd_courses").select("*").eq("college_code", "SKY").order("course_code").limit(1500),
        supabase.from("smccd_courses").select("*").eq("college_code", "CAN").order("course_code").limit(1500)
      ]);
      const firstError = [collegeResult, csmCourses, skylineCourses, canadaCourses]
        .map((result) => result.error)
        .find(Boolean);
      if (firstError) throw firstError;
      return {
        colleges: (collegeResult.data ?? []) as unknown as SmccdCollege[],
        courses: [...(csmCourses.data ?? []), ...(skylineCourses.data ?? []), ...(canadaCourses.data ?? [])] as unknown as SmccdCourse[]
      };
    })().catch((caught) => {
      courseCatalogRequest = null;
      throw caught;
    });
  }
  return courseCatalogRequest;
}

function loadDegreeCatalog(supabase: SupabaseClient) {
  if (!degreeCatalogRequest) {
    degreeCatalogRequest = (async () => {
      const [programResult, requirementResult, optionCountResult] = await Promise.all([
        supabase.from("smccd_programs").select("*").order("college_code").order("title").limit(500),
        supabase.from("smccd_program_requirements").select("*").order("program_id").order("sort_order").limit(1000),
        supabase.from("smccd_requirement_courses").select("id", { count: "exact", head: true })
      ]);
      const firstError = [programResult, requirementResult, optionCountResult]
        .map((result) => result.error)
        .find(Boolean);
      if (firstError) throw firstError;

      const optionCount = optionCountResult.count ?? 0;
      const optionPages = await Promise.all(Array.from({ length: Math.ceil(optionCount / 1000) }, (_, page) => supabase
        .from("smccd_requirement_courses")
        .select("*")
        .order("requirement_id")
        .range(page * 1000, (page + 1) * 1000 - 1)));
      const optionError = optionPages.map((result) => result.error).find(Boolean);
      if (optionError) throw optionError;

      return {
        programs: (programResult.data ?? []) as unknown as SmccdProgram[],
        requirements: (requirementResult.data ?? []) as unknown as SmccdProgramRequirement[],
        requirementCourses: optionPages.flatMap((result) => result.data ?? []) as unknown as SmccdRequirementCourse[]
      };
    })().catch((caught) => {
      degreeCatalogRequest = null;
      throw caught;
    });
  }
  return degreeCatalogRequest;
}

export default function SmccdPlanner({
  embedded = false,
  surface = "courses",
  supabase,
  session,
  settings,
  activeVersion,
  planCourses,
  equivalencies,
  focusCourseId,
  onCourseAdded,
  onCourseRemoved,
  onOpenMyCourses,
  onFindCourse
}: Props) {
  const [courseCatalogReady, setCourseCatalogReady] = useState(false);
  const [degreeCatalogReady, setDegreeCatalogReady] = useState(false);
  const [goalsReady, setGoalsReady] = useState(surface === "courses");
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
  const [programSearch, setProgramSearch] = useState("");
  const [selectedCourse, setSelectedCourse] = useState<SmccdCourse | null>(null);
  const availablePlanGrades = selectedPlanGrades(settings);
  const [targetGrade, setTargetGrade] = useState<GradeLevel>(availablePlanGrades[0] ?? (settings.grade_level ?? 11) as GradeLevel);
  const [courseDraft, setCourseDraft] = useState({
    term: "fall" as PlanCourse["term"]
  });
  const [manualDraft, setManualDraft] = useState({
    name: "",
    collegeUnits: 3,
    dtechCredits: 0,
    gradeLevel: (settings.grade_level ?? 11) as GradeLevel
  });

  useEffect(() => {
    let active = true;
    void loadCourseCatalog(supabase).then((catalog) => {
      if (!active) return;
      setColleges(catalog.colleges);
      setCourses(catalog.courses);
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : "SMCCD courses could not be loaded.");
    }).finally(() => {
      if (active) setCourseCatalogReady(true);
    });
    return () => { active = false; };
  }, [supabase]);

  useEffect(() => {
    if (surface !== "degree") return;
    let active = true;
    void (async () => {
      try {
        const goalResult = await supabase.from("student_smccd_goals").select("*").eq("user_id", session.user.id);
        if (goalResult.error) throw goalResult.error;
        if (!active) return;
        const loadedGoals = (goalResult.data ?? []) as unknown as StudentSmccdGoal[];
        setGoals(loadedGoals);
        setGoalProgramId(loadedGoals[0]?.program_id ?? "");
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Saved degree goals could not be loaded.");
      } finally {
        if (active) setGoalsReady(true);
      }
    })();
    return () => { active = false; };
  }, [session.user.id, supabase, surface]);

  useEffect(() => {
    if (surface !== "degree" || degreeCatalogReady) return;
    let active = true;
    void loadDegreeCatalog(supabase).then((catalog) => {
      if (!active) return;
      setPrograms(catalog.programs);
      setRequirements(catalog.requirements);
      setRequirementCourses(catalog.requirementCourses);
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : "SMCCD degree requirements could not be loaded.");
    }).finally(() => {
      if (active) setDegreeCatalogReady(true);
    });
    return () => { active = false; };
  }, [degreeCatalogReady, surface, supabase]);

  const deferredSearch = useDeferredValue(search);
  const courseSearchIndex = useMemo(() => courses.map((course) => ({
    course,
    code: course.course_code.toLowerCase(),
    text: `${course.course_code} ${course.title} ${course.subject} ${(course.attributes ?? []).join(" ")}`.toLowerCase()
  })), [courses]);
  const searchedCourses = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    const tokens = query.split(/\s+/).filter(Boolean);
    return courseSearchIndex
      .filter(({ course }) => collegeFilter === "all" || course.college_code === collegeFilter)
      .filter(({ course }) => transferFilter === "all" || (transferFilter === "uc" ? course.transfer_credit?.includes("UC") : Boolean(course.transfer_credit)))
      .filter(({ text }) => tokens.length === 0 || tokens.every((token) => text.includes(token)))
      .sort((left, right) => {
        if (!query) return left.course.course_code.localeCompare(right.course.course_code);
        const leftRank = Number(left.code === query) * 3 + Number(left.code.startsWith(query)) * 2 + Number(left.course.title.toLowerCase().startsWith(query));
        const rightRank = Number(right.code === query) * 3 + Number(right.code.startsWith(query)) * 2 + Number(right.course.title.toLowerCase().startsWith(query));
        return rightRank - leftRank || left.course.course_code.localeCompare(right.course.course_code);
      })
      .slice(0, query ? 140 : 90)
      .map(({ course }) => course);
  }, [collegeFilter, courseSearchIndex, deferredSearch, transferFilter]);
  const prerequisiteEvaluator = useMemo(
    () => createSmccdPlannerPrerequisiteEvaluator(courses, planCourses, []),
    [courses, planCourses]
  );
  const planCourseIndex = useMemo(
    () => createSmccdPlanCourseIndex(planCourses, courses),
    [courses, planCourses]
  );
  const smccdUnavailable = useMemo(() => searchedCourses.reduce((counts, course) => {
    if (smccdCourseAlreadyInPlanIndex(course, planCourseIndex)) {
      counts.already += 1;
      return counts;
    }
    const evaluation = prerequisiteEvaluator(course, { gradeLevel: targetGrade, term: "fall" });
    if (evaluation.result.status === "blocked") counts.prerequisite += 1;
    else counts.visible.push({ course, evaluation });
    return counts;
  }, { already: 0, prerequisite: 0, visible: [] as Array<{ course: SmccdCourse; evaluation: ReturnType<typeof prerequisiteEvaluator> }> }), [planCourseIndex, prerequisiteEvaluator, searchedCourses, targetGrade]);
  const visibleCourses = smccdUnavailable.visible.slice(0, 80);
  const equivalencyMap = useMemo(
    () => new Map(equivalencies.map((equivalency) => [equivalency.normalized_course_code, equivalency])),
    [equivalencies]
  );
  const selectedEquivalency = selectedCourse
    ? equivalencyMap.get(normalizeCollegeCourseCode(selectedCourse.course_code) ?? "") ?? null
    : null;
  const selectedPrerequisiteEvaluation = useMemo(
    () => selectedCourse
      ? prerequisiteEvaluator(selectedCourse, { gradeLevel: targetGrade, term: courseDraft.term })
      : null,
    [courseDraft.term, prerequisiteEvaluator, selectedCourse, targetGrade]
  );

  useEffect(() => {
    if (!focusCourseId || courses.length === 0) return;
    const course = courses.find((candidate) => candidate.id === focusCourseId);
    if (!course) return;
    const timeout = window.setTimeout(() => {
      setSearch(course.course_code);
      setSelectedCourse(course);
      setCourseDraft({
        term: "fall"
      });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [courses, focusCourseId]);

  const visibleCourseResults = useMemo(() => visibleCourses.map(({ course, evaluation }) => {
    const readiness = prerequisiteDisplay(evaluation);
    const units = course.units_max && course.units_max !== course.units_min
      ? `${course.units_min}-${course.units_max} units`
      : `${course.units_min} units`;
    return {
      id: course.id,
      code: course.course_code,
      title: course.title,
      metadata: [SMCCD_COLLEGE_NAMES[course.college_code], units, course.transfer_credit ?? "Transfer not listed"],
      readinessLabel: readiness.label,
      readinessTone: readiness.tone,
      institution: course.college_code
    };
  }), [visibleCourses]);

  const progressContext = useMemo(
    () => createSmccdProgramProgressContext(requirements, requirementCourses, planCourses, courses),
    [courses, planCourses, requirementCourses, requirements]
  );
  const programProgress = useMemo(() => new Map(programs.map((program) => [
    program.id,
    calculateSmccdProgramProgressWithContext(program, progressContext)
  ])), [programs, progressContext]);
  const markedProgramIds = useMemo(() => new Set(goals.map((goal) => goal.program_id)), [goals]);
  const selectedProgram = programs.find((program) => program.id === goalProgramId) ?? null;
  const generalEducationProgress = useMemo(
    () => calculateSmccdGeProgress(progressContext, selectedProgram?.college_code ?? "CSM"),
    [progressContext, selectedProgram?.college_code]
  );
  const selectedGoal = goals.find((goal) => goal.program_id === goalProgramId) ?? null;
  const selectedProgramProgress = selectedProgram ? programProgress.get(selectedProgram.id) ?? null : null;
  const deferredProgramSearch = useDeferredValue(programSearch);
  const visiblePrograms = useMemo(() => {
    const query = deferredProgramSearch.trim().toLowerCase();
    return programs
      .map((program) => ({ program, progress: programProgress.get(program.id)! }))
      .filter((row) => !query || `${row.program.title} ${row.program.award_type} ${SMCCD_COLLEGE_NAMES[row.program.college_code]}`.toLowerCase().includes(query))
      .sort((a, b) => Number(markedProgramIds.has(b.program.id)) - Number(markedProgramIds.has(a.program.id))
        || b.progress.projectedMajorUnits - a.progress.projectedMajorUnits
        || a.program.title.localeCompare(b.program.title))
      .slice(0, 60);
  }, [deferredProgramSearch, markedProgramIds, programProgress, programs]);
  useEffect(() => {
    if (surface !== "degree" || goalProgramId || visiblePrograms.length === 0) return;
    setGoalProgramId(goals[0]?.program_id ?? visiblePrograms[0].program.id);
  }, [goalProgramId, goals, surface, visiblePrograms]);
  const nextDegreeOptions = useMemo(() => {
    if (!selectedProgramProgress) return [];
    const seen = new Set<string>();
    return selectedProgramProgress.requirements
      .filter((requirement) => requirement.status !== "satisfied" && requirement.status !== "manual_review")
      .flatMap((requirement) => requirement.remainingOptions.map((course) => ({ course, requirement: requirement.requirement.label })))
      .filter(({ course }) => {
        const code = normalizeSmccdCourseCode(course.courseCode);
        if (seen.has(code)) return false;
        seen.add(code);
        return true;
      })
      .slice(0, 6);
  }, [selectedProgramProgress]);
  const districtRows = planCourses.filter((row) => Number(row.college_units ?? 0) > 0 || row.smccd_course_id);
  const smccdCourseMap = new Map(courses.map((course) => [course.id, course]));
  function chooseCourse(course: SmccdCourse) {
    setSelectedCourse(course);
    setCourseDraft({
      term: "fall"
    });
    setError(null);
    setNotice(null);
  }

  function findDegreeCourse(courseCode: string, collegeCode: SmccdCourse["college_code"]) {
    const exactCourse = courses.find((course) => course.college_code === collegeCode && normalizeSmccdCourseCode(course.course_code) === normalizeSmccdCourseCode(courseCode));
    if (exactCourse) onFindCourse?.(exactCourse);
    else setError(`${courseCode} could not be opened in the current district catalog.`);
  }

  async function saveGoal(programId = goalProgramId) {
    if (!programId) {
      setError("Choose an AA or AS program first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const existing = goals.find((goal) => goal.program_id === programId);
      if (existing) {
        setNotice("This degree is already bookmarked.");
        return;
      }
      const { data, error: mutationError } = await supabase.from("student_smccd_goals").insert({
        user_id: session.user.id,
        program_id: programId,
        is_primary: false
      }).select("*").single();
      if (mutationError) throw mutationError;
      setGoals((current) => [...current, data as unknown as StudentSmccdGoal]);
      setNotice("Degree bookmarked. It stays at the front of the degree list.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The degree could not be bookmarked.");
    } finally {
      setBusy(false);
    }
  }

  async function removeGoal(goal: StudentSmccdGoal) {
    setBusy(true);
    setError(null);
    try {
      const { error } = await supabase.from("student_smccd_goals").delete().eq("id", goal.id);
      if (error) throw error;
      setGoals((current) => current.filter((item) => item.id !== goal.id));
      setNotice("Bookmark removed. Your course plan was not changed.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The bookmark could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  async function addCatalogCourse(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (!selectedCourse) return;
    if (smccdCourseAlreadyInPlanIndex(selectedCourse, planCourseIndex)) {
      setError("That SMCCD course is already represented in the active plan.");
      return;
    }
    if (selectedPrerequisiteEvaluation?.result.status === "blocked") {
      setError("Complete the listed prerequisite before adding this course for the selected year.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data, error: insertError } = await supabase.from("plan_courses").insert({
        plan_version_id: activeVersion.id,
        user_id: session.user.id,
        smccd_course_id: selectedCourse.id,
        college_provider_code: "SMCCD",
        custom_course_name: `${selectedCourse.course_code} ${selectedCourse.title}`,
        grade_level: targetGrade,
        school_year: schoolYearForGrade(settings.graduation_year ?? new Date().getFullYear() + 3, targetGrade),
        term: courseDraft.term,
        status: "planned",
        credits: selectedEquivalency?.high_school_credits ?? 0,
        college_units: Number(selectedCourse.units_max ?? selectedCourse.units_min),
        is_weighted: true,
        mapping_verified: Boolean(selectedEquivalency),
        user_edited: true,
        notes: selectedEquivalency
          ? `${SMCCD_COLLEGE_NAMES[selectedCourse.college_code]} ${selectedCourse.source_year} catalog. The official d.tech equivalency chart (updated 2021) lists ${selectedEquivalency.high_school_credits} high-school credits as ${selectedEquivalency.high_school_equivalent}. Confirm current approval, prerequisites, schedule, and transcript delivery.`
          : `${SMCCD_COLLEGE_NAMES[selectedCourse.college_code]} ${selectedCourse.source_year} catalog. Verify schedule availability, prerequisites, d.tech approval, and transcript delivery.`,
        requirement_area_override: selectedEquivalency?.requirement_area ?? null,
        sort_order: planCourses.length
      }).select("*").single();
      if (insertError) throw insertError;
      onCourseAdded?.(data as unknown as PlanCourse, selectedCourse);
      setSelectedCourse(null);
      setNotice(selectedEquivalency
        ? `${selectedCourse.course_code} added with the source-backed d.tech equivalency. Confirm that the 2021 chart is still current.`
        : `${selectedCourse.course_code} added to the academic plan as unverified.`);
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
        school_year: schoolYearForGrade(settings.graduation_year ?? new Date().getFullYear() + 3, manualDraft.gradeLevel),
        term: "fall",
        status: "planned",
        credits: manualDraft.dtechCredits,
        college_units: manualDraft.collegeUnits,
        is_weighted: true,
        mapping_verified: false,
        user_edited: true,
        notes: "Manual SMCCD entry. Verify the exact catalog record, schedule, prerequisites, d.tech approval, and transcript delivery.",
        sort_order: planCourses.length
      }).select("*").single();
      if (insertError) throw insertError;
      onCourseAdded?.(data as unknown as PlanCourse);
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
      onCourseRemoved?.(row.id);
      setNotice("College course removed from the active plan.");
    }
    setBusy(false);
  }

  if (!courseCatalogReady || (surface === "degree" && !goalsReady)) return <div className="smccd-loading" role="status">Loading SMCCD courses...</div>;

  return (
    <div className="smccd-workspace">
      {!embedded && <header className="page-header">
        <div>
          <h1>SMCCD concurrent enrollment</h1>
          <p>Search district catalogs, add exact courses, and track a source-backed AA or AS goal.</p>
        </div>
        <a className="secondary-button" href="https://smccd.edu/k-12/" target="_blank" rel="noreferrer">Official K-12 steps <ArrowSquareOut size={16} /></a>
      </header>}

      {surface === "courses" && <div className="smccd-catalog-notice"><Warning size={17} /><span>Catalog entry does not confirm enrollment, schedule, or d.tech credit.</span></div>}
      {error && <div className="inline-alert error" role="alert">{error}</div>}
      {notice && <div className="inline-alert success smccd-notice" role="status"><span>{notice}</span>{embedded && onOpenMyCourses && <button className="quiet-button" type="button" onClick={onOpenMyCourses}>View My courses</button>}</div>}

      {surface === "courses" && <CourseCatalogBrowser
        source="smccd"
        title="SMCCD course catalog"
        description="College courses you can still add to this planning year."
        countLabel={search !== deferredSearch ? "Updating results" : !search.trim() ? `${visibleCourses.length} eligible courses` : visibleCourses.length === 80 ? "First 80 eligible matches" : `${visibleCourses.length} eligible ${visibleCourses.length === 1 ? "course" : "courses"}`}
        planningContext={`Planning Grade ${targetGrade}`}
        hiddenSummary={search.trim() ? `${smccdUnavailable.already + smccdUnavailable.prerequisite} unavailable matches hidden` : "Taken and prerequisite-blocked courses stay out of results"}
        filters={<>
          <label className="catalog-search-field"><span>Search district courses</span><div className="catalog-search-input"><MagnifyingGlass size={17} aria-hidden /><input aria-label="Search SMCCD courses" value={search} onChange={(event) => { setSearch(event.target.value); setSelectedCourse(null); }} placeholder="Try ENGL C1000, statistics, or biology" /></div></label>
          <label><span>Planning year</span><select value={targetGrade} onChange={(event) => { setTargetGrade(Number(event.target.value) as GradeLevel); setSelectedCourse(null); }}>{availablePlanGrades.map((grade) => <option key={grade} value={grade}>Grade {grade}</option>)}</select></label>
          <label><span>Transfer credit</span><select value={transferFilter} onChange={(event) => { setTransferFilter(event.target.value); setSelectedCourse(null); }}><option value="all">Any status</option><option value="transferable">CSU or UC</option><option value="uc">UC transferable</option></select></label>
          <fieldset className="catalog-college-filter"><legend>College</legend><div><button className={collegeFilter === "all" ? "active" : ""} type="button" onClick={() => { setCollegeFilter("all"); setSelectedCourse(null); }}><InstitutionMark institution="smccd" decorative /><span>All three</span></button>{colleges.map((college) => <button className={`${collegeFilter === college.code ? "active" : ""} institution-${college.code.toLowerCase()}`} type="button" onClick={() => { setCollegeFilter(college.code); setSelectedCourse(null); }} key={college.code}><InstitutionMark institution={college.code} decorative /><span>{college.name.replace("College of ", "")}</span></button>)}</div></fieldset>
        </>}
        results={visibleCourseResults}
        selectedId={selectedCourse?.id ?? null}
        onSelect={(id) => { const course = courses.find((candidate) => candidate.id === id); if (course) chooseCourse(course); }}
        emptyTitle={search.trim() ? "No matching courses" : "No eligible courses in this view"}
        emptyBody={search.trim() ? "Try another code or title. Courses already taken or blocked by an unmet prerequisite stay hidden." : "Change the college, transfer, or planning-year filters."}
        sourceAction={<a className="secondary-button small" href="https://smccd.edu/k-12/" target="_blank" rel="noreferrer">K-12 enrollment <ArrowSquareOut size={14} /></a>}
        footer={visibleCourses.length === 80 ? <p className="catalog-limit-note">Refine the search to narrow these results.</p> : undefined}
        detail={selectedCourse && selectedPrerequisiteEvaluation ? <div className="catalog-course-detail">
          <header className="catalog-detail-heading">
            <span className="catalog-detail-institution"><InstitutionMark institution={selectedCourse.college_code} decorative />{SMCCD_COLLEGE_NAMES[selectedCourse.college_code]}</span>
            <h3><b>{selectedCourse.course_code}</b>{selectedCourse.title}</h3>
            <a href={selectedCourse.catalog_url} target="_blank" rel="noreferrer">Official course page <ArrowSquareOut size={13} /></a>
          </header>
          <dl className="catalog-fact-grid">
            <div><dt>Units</dt><dd>{selectedCourse.units_max && selectedCourse.units_max !== selectedCourse.units_min ? `${selectedCourse.units_min}-${selectedCourse.units_max}` : selectedCourse.units_min}</dd></div>
            <div><dt>Transfer</dt><dd>{selectedCourse.transfer_credit ?? "Not listed"}</dd></div>
            <div><dt>Degree credit</dt><dd>{selectedCourse.degree_applicable ? "Yes" : "No"}</dd></div>
            <div><dt>Source</dt><dd>{selectedCourse.detail_status === "verified" ? "Course page" : "Needs review"}</dd></div>
          </dl>
          {(selectedCourse.attributes ?? []).length > 0 && <div className="catalog-attribute-list"><strong>General education</strong>{selectedCourse.attributes.map((attribute) => <span key={attribute}>{attribute}</span>)}</div>}
          {selectedEquivalency && <dl className="catalog-equivalency-summary"><div><dt>d.tech credit</dt><dd>{selectedEquivalency.high_school_credits} credits</dd></div><div><dt>Counts as</dt><dd>{selectedEquivalency.high_school_equivalent}</dd></div></dl>}
          <PrerequisiteReadout evaluation={selectedPrerequisiteEvaluation} recommendedPreparation={selectedCourse.recommended_preparation ?? []} />
          <form className="catalog-plan-controls smccd-course-draft" onSubmit={addCatalogCourse}>
            <label><span>School year</span><select value={targetGrade} onChange={(event) => setTargetGrade(Number(event.target.value) as GradeLevel)}>{availablePlanGrades.map((grade) => <option key={grade} value={grade}>Grade {grade}</option>)}</select></label>
            <label><span>Term</span><select value={courseDraft.term} onChange={(event) => setCourseDraft({ ...courseDraft, term: event.target.value as PlanCourse["term"] })}><option value="fall">Fall</option><option value="spring">Spring</option><option value="summer">Summer</option></select></label>
            <button className="primary-button" type="submit" disabled={busy}><Plus size={16} /> Add to plan</button>
          </form>
        </div> : <div className="catalog-detail-empty"><BookOpen size={20} aria-hidden /><strong>Select an SMCCD course</strong><p>Review transfer status, general education, d.tech credit, and prerequisite evidence.</p></div>}
      />}

      {!embedded && <section className="content-section smccd-plan-section">
        <header className="section-heading"><div><h2>College courses in this plan</h2><p>Transcript imports and planned catalog courses use the same district record when matched.</p></div></header>
        {districtRows.length ? <div className="source-list">{districtRows.map((row) => { const catalogCourse = row.smccd_course_id ? smccdCourseMap.get(row.smccd_course_id) : null; return <article className="source-row dual-enrollment-row" key={row.id}>{catalogCourse ? <InstitutionMark institution={catalogCourse.college_code} decorative /> : <InstitutionMark institution="smccd" decorative />}<div><strong>{row.custom_course_name ?? "SMCCD course"}</strong><span>{row.college_units ?? 0} college units, {row.credits ?? 0} proposed d.tech credits, grade {row.grade_level}</span></div><span className="confidence-tag uncertain">Verify</span><button className="icon-button danger" type="button" onClick={() => void removeCourse(row)} aria-label={`Remove ${row.custom_course_name ?? "college course"}`}><Trash size={16} /></button>{row.notes && <p>{row.notes}</p>}</article>; })}</div> : <div className="empty-state"><BookOpen size={23} weight="duotone" /><strong>No college courses planned</strong><p>Search the district catalog or import a transcript to add exact SMCCD courses.</p></div>}
      </section>}

      {surface === "degree" && !degreeCatalogReady && <div className="smccd-loading smccd-degree-loading" role="status">Loading degree requirements...</div>}

      {surface === "degree" && degreeCatalogReady && <FadeContent className="smccd-degree-transition"><section className="content-section smccd-goal-section">
        <header className="section-heading"><div><h2>Associate degree planner</h2><p>Compare official AA and AS programs against completed work and the active plan.</p></div></header>
        <div className="smccd-program-filters smccd-program-toolbar">
          <label className="search-box"><MagnifyingGlass size={17} /><input aria-label="Search associate degrees" value={programSearch} onChange={(event) => setProgramSearch(event.target.value)} placeholder="Search degrees by program, award, or college" /></label>
          <span>{programSearch !== deferredProgramSearch ? "Updating" : `${visiblePrograms.length} programs`} · {goals.length} marked</span>
        </div>

        <div className="smccd-degree-browser">
          <nav className="smccd-program-strip" aria-label="Associate degree results">
            {visiblePrograms.length ? visiblePrograms.map(({ program, progress: programResult }) => {
              const markedGoal = goals.find((goal) => goal.program_id === program.id);
              const isMarked = Boolean(markedGoal);
              return <article className={`${goalProgramId === program.id ? "selected" : ""} ${isMarked ? "marked" : ""} institution-${program.college_code.toLowerCase()}`} key={program.id}>
                <button className="smccd-program-card-main" type="button" aria-pressed={goalProgramId === program.id} onClick={() => setGoalProgramId(program.id)}>
                  <span className="smccd-program-card-meta"><InstitutionMark institution={program.college_code} decorative /><span>{program.award_type} · {SMCCD_COLLEGE_NAMES[program.college_code]}</span></span>
                  <strong>{program.title}</strong>
                  <span className="smccd-program-card-progress"><b>{programResult.requiredMajorUnits ? Math.min(programResult.completedMajorUnits, programResult.requiredMajorUnits) : programResult.completedMajorUnits} completed</b><small>{programResult.requiredMajorUnits ? Math.min(programResult.projectedMajorUnits, programResult.requiredMajorUnits) : programResult.projectedMajorUnits} / {programResult.requiredMajorUnits || "review"} major units planned</small></span>
                </button>
                <button className="smccd-program-bookmark" type="button" aria-pressed={isMarked} aria-label={isMarked ? `Remove bookmark from ${program.title}` : `Bookmark ${program.title}`} title={isMarked ? "Remove bookmark" : "Bookmark degree"} disabled={busy} onClick={() => { setGoalProgramId(program.id); if (markedGoal) void removeGoal(markedGoal); else void saveGoal(program.id); }}><BookmarkSimple size={20} weight={isMarked ? "fill" : "regular"} /></button>
              </article>;
            }) : <div className="smccd-program-empty"><strong>No matching degrees</strong><p>Try another program name, award, or college.</p></div>}
          </nav>

          <article className="smccd-degree-detail" aria-live="polite">
            {selectedProgram && selectedProgramProgress ? <FadeContent key={selectedProgram.id} className="smccd-degree-detail-inner">
              <header className={`smccd-degree-heading institution-${selectedProgram.college_code.toLowerCase()}`}>
                <InstitutionMark institution={selectedProgram.college_code} size="rail" decorative />
                <div><span>{SMCCD_COLLEGE_NAMES[selectedProgram.college_code]} · {selectedProgram.award_type}</span><h3>{selectedProgram.title}</h3><small>{selectedProgram.source_year} catalog</small></div>
                <div className="smccd-degree-goal-actions">
                  {!selectedGoal && <button className="smccd-detail-bookmark" type="button" onClick={() => void saveGoal()} disabled={busy}><BookmarkSimple size={17} /> Bookmark degree</button>}
                  {selectedGoal && <button className="smccd-detail-bookmark marked" type="button" onClick={() => void removeGoal(selectedGoal)} disabled={busy}><BookmarkSimple size={17} weight="fill" /> Marked</button>}
                </div>
              </header>

              <dl className="smccd-degree-facts">
                <div><dt>Major requirement units</dt><dd>{selectedProgramProgress.requiredMajorUnits ? Math.min(selectedProgramProgress.completedMajorUnits, selectedProgramProgress.requiredMajorUnits) : selectedProgramProgress.completedMajorUnits} covered</dd><small>{selectedProgramProgress.requiredMajorUnits ? Math.min(selectedProgramProgress.projectedMajorUnits, selectedProgramProgress.requiredMajorUnits) : selectedProgramProgress.projectedMajorUnits} projected of {selectedProgramProgress.requiredMajorUnits || "manual review"}{selectedProgramProgress.completedMajorUnits > selectedProgramProgress.requiredMajorUnits ? ` · ${selectedProgramProgress.completedMajorUnits} relevant` : ""}</small></div>
                <div><dt>Degree-applicable units</dt><dd>{selectedProgramProgress.completedDegreeApplicableUnits} completed</dd><small>{selectedProgramProgress.projectedDegreeApplicableUnits} projected of {selectedProgramProgress.totalDegreeUnits}</small></div>
                <div><dt>Parsed requirement groups</dt><dd>{selectedProgramProgress.completedRequirements} completed</dd><small>{selectedProgramProgress.satisfiedRequirements} projected of {selectedProgramProgress.totalRequirements}</small></div>
              </dl>

              <section className="smccd-degree-section">
                <header><div><h4>Major requirements</h4><p>Open a group to see what counts, what is applied, and what remains.</p></div><span>{selectedProgramProgress.manualReviewRequirements ? `${selectedProgramProgress.manualReviewRequirements} need manual review` : "Parsed catalog rules"}</span></header>
                <div className="smccd-requirement-audit">{selectedProgramProgress.requirements.map((item) => {
                  const stateLabel = item.manualReviewReason ? "Rule review" : item.completedStatus === "satisfied" ? "Completed" : item.status === "satisfied" ? "Covered by plan" : item.status === "manual_review" ? "Manual review" : item.status === "partial" ? "In progress" : "Not started";
                  const visualState = item.manualReviewReason || item.status === "manual_review" ? "manual_review" : item.completedStatus === "satisfied" ? "completed" : item.status === "satisfied" ? "planned" : item.status;
                  return <details className={`status-${visualState}`} key={item.requirement.id} open={item.status !== "satisfied" || Boolean(item.manualReviewReason)}>
                    <summary><span><strong>{item.requirement.label}</strong><small>{item.missingSummary}</small></span><b className={`requirement-state ${visualState}`}>{stateLabel}</b></summary>
                    <div className="smccd-requirement-body">
                      {item.selectedCourses.length > 0 && <div><h5>Applied from your plan</h5><ul>{item.selectedCourses.map((course) => <li key={`${item.requirement.id}-${course.courseCode}`}><span><strong>{course.courseCode}</strong> {course.title}</span><small>{course.status} · {course.units} units · Grade {course.gradeLevel}{course.letterGrade ? ` · ${course.letterGrade}` : ""}</small></li>)}</ul></div>}
                      {item.remainingOptions.length > 0 && item.status !== "satisfied" && <div><h5>Still needed: {item.missingSummary}</h5><ul>{item.remainingOptions.map((course) => <li key={`${item.requirement.id}-${course.collegeCode}-${course.courseCode}`}><button type="button" onClick={() => findDegreeCourse(course.courseCode, course.collegeCode)}><span><strong>{course.courseCode}</strong> {course.title}</span><small>{course.units} units · Open in course planner</small></button></li>)}</ul></div>}
                      {item.requirement.kind === "text_rule" && <p className="smccd-manual-rule">{item.requirement.raw_text ?? "This rule could not be reduced to a reliable course list."}</p>}
                      {item.manualReviewReason && item.requirement.kind !== "text_rule" && <p className="smccd-manual-rule">{item.manualReviewReason}</p>}
                    </div>
                  </details>;
                })}</div>
              </section>

              {nextDegreeOptions.length > 0 && <section className="smccd-degree-section smccd-next-options"><header><div><h4>Useful next course options</h4><p>Unplanned catalog courses that appear in unresolved major groups.</p></div></header><div>{nextDegreeOptions.map(({ course, requirement }) => <button type="button" onClick={() => findDegreeCourse(course.courseCode, course.collegeCode)} key={`${course.collegeCode}-${course.courseCode}`}><InstitutionMark institution={course.collegeCode} decorative /><span><strong>{course.courseCode}</strong><small>{course.title}</small><small>{requirement}</small></span><CaretRight size={14} /></button>)}</div></section>}

              <footer className="smccd-degree-source"><Warning size={16} /><p>This major audit does not verify residency, catalog rights, grades, or substitutions. Confirm the final degree petition with an SMCCD counselor.</p><a href={selectedProgram.catalog_url} target="_blank" rel="noreferrer">Official requirements <ArrowSquareOut size={14} /></a></footer>
            </FadeContent> : <div className="catalog-detail-empty"><BookOpen size={20} aria-hidden /><strong>Select an associate degree</strong><p>See completed work, projected coverage, missing requirement options, and official source links.</p></div>}
          </article>
        </div>
        <section className="smccd-general-education" aria-labelledby="smccd-general-education-title">
          <header><div><h3 id="smccd-general-education-title">{selectedProgram ? `${SMCCD_COLLEGE_NAMES[selectedProgram.college_code]} local general education` : "Local general education"}</h3><p>Every requirement stays visible, including communication and physical activity.</p></div><span>{generalEducationProgress.filter((area) => area.status === "completed" || area.status === "planned").length} of {generalEducationProgress.length} covered</span></header>
          <div className="smccd-ge-audit">{generalEducationProgress.map((area) => {
            const planned = area.projectedCourseCodes.filter((code) => !area.completedCourseCodes.includes(code));
            const statusLabel = area.status === "completed" ? "Completed" : area.status === "planned" ? "Covered by plan" : area.status === "partial" ? "In progress" : "Missing";
            return <article className={`status-${area.status}`} key={area.area}>
              <header><span><b>{area.label}</b><strong>{area.description}</strong></span><em>{statusLabel}</em></header>
              <div><span>{area.projectedUnits} / {area.requiredUnits} units</span><b>{area.missingSummary}</b></div>
              {area.completedCourseCodes.length > 0 && <small><strong>{area.completedCourseCodes.join(", ")}</strong> completed</small>}
              {planned.length > 0 && <small><strong>{planned.join(", ")}</strong> planned</small>}
            </article>;
          })}</div>
          <footer><Warning size={15} /><p>Courses are assigned to one local GE area at a time. Catalog rights, waivers, substitutions, residency, information literacy, and transfer-pattern rules still need official review.</p>{selectedProgram && <a href={SMCCD_LOCAL_GE_SOURCE_URLS[selectedProgram.college_code]} target="_blank" rel="noreferrer">Official {selectedProgram.source_year} pattern <ArrowSquareOut size={13} /></a>}</footer>
        </section>
      </section></FadeContent>}

      {surface === "courses" && <details className="smccd-manual-entry">
        <summary>Course missing from the catalog?</summary>
        <form className="form-section compact-form" onSubmit={addManualCourse}>
          <h2>Add a manual course</h2>
          <label className="form-field"><span>Exact course code and title</span><input value={manualDraft.name} onChange={(event) => setManualDraft({ ...manualDraft, name: event.target.value })} required /></label>
          <div className="form-grid three"><label className="form-field"><span>College units</span><input type="number" min={0.5} max={19} step={0.5} value={manualDraft.collegeUnits} onChange={(event) => setManualDraft({ ...manualDraft, collegeUnits: Number(event.target.value) })} /></label><label className="form-field"><span>Proposed d.tech credits</span><input type="number" min={0} max={30} step={0.5} value={manualDraft.dtechCredits} onChange={(event) => setManualDraft({ ...manualDraft, dtechCredits: Number(event.target.value) })} /></label><label className="form-field"><span>Grade</span><select value={manualDraft.gradeLevel} onChange={(event) => setManualDraft({ ...manualDraft, gradeLevel: Number(event.target.value) as GradeLevel })}>{availablePlanGrades.map((grade) => <option key={grade} value={grade}>Grade {grade}</option>)}</select></label></div>
          <button className="secondary-button" type="submit" disabled={busy}><Plus size={17} /> Add manual course</button>
        </form>
      </details>}
    </div>
  );
}
