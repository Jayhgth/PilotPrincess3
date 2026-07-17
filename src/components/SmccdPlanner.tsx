import {
  ArrowSquareOutIcon as ArrowSquareOut,
  BookmarkSimpleIcon as BookmarkSimple,
  BookOpenIcon as BookOpen,
  CheckCircleIcon as CheckCircle,
  CircleIcon as Circle,
  ClockIcon as Clock,
  MagnifyingGlassIcon as MagnifyingGlass,
  PlusIcon as Plus,
  TrashIcon as Trash,
  WarningIcon as Warning
} from "@phosphor-icons/react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { Fragment, useDeferredValue, useEffect, useMemo, useState, type SyntheticEvent } from "react";
import CourseCatalogBrowser from "@/components/CourseCatalogBrowser";
import CourseDetailLayout from "@/components/CourseDetailLayout";
import InstitutionMark from "@/components/InstitutionMark";
import PrerequisiteReadout from "@/components/PrerequisiteReadout";
import { prerequisiteDisplay } from "@/lib/prerequisite-display";
import FadeContent from "@/components/reactbits/FadeContent";
import {
  calculateSmccdLocalDegreeProgress,
  calculateSmccdProgramProgressWithContext,
  createSmccdProgramProgressContext,
  normalizeSmccdCourseCode,
  smccdDegreeOverallPercent,
  SMCCD_LOCAL_GE_SOURCE_URLS,
  SMCCD_COLLEGE_NAMES
} from "@/lib/smccd";
import type { SmccdLocalDegreeProgress, SmccdProgramProgress } from "@/lib/smccd";
import { schoolYearForGrade, selectedPlanGrades } from "@/lib/planning";
import { createSmccdPlannerPrerequisiteEvaluator } from "@/lib/prerequisites";
import { normalizeCollegeCourseCode } from "@/lib/transcript";
import { createSmccdPlanCourseIndex, smccdCourseAlreadyInPlanIndex } from "@/lib/catalog-eligibility";
import { resolveCollegeHighSchoolCredits } from "@/lib/college-credits";
import { cachedStudentSmccdGoals, cacheStudentSmccdGoals, loadStudentSmccdGoals } from "@/lib/smccd-goals";
import type {
  GradeLevel,
  PlanCourse,
  PlanVersion,
  School,
  SmccdCollege,
  SmccdCourse,
  SmccdHighSchoolEquivalency,
  SmccdProgram,
  SmccdProgramRequirement,
  SmccdRequirementCourse,
  StudentSmccdGeCompletion,
  StudentSettings,
  StudentSmccdGoal
} from "@/lib/models";

interface Props {
  embedded?: boolean;
  surface?: SmccdSection;
  school: School;
  supabase: SupabaseClient;
  session: Session;
  settings: StudentSettings;
  activeVersion: PlanVersion;
  planCourses: PlanCourse[];
  equivalencies: SmccdHighSchoolEquivalency[];
  manualCompletions?: StudentSmccdGeCompletion[];
  onManualCompletionsChanged?: (completions: StudentSmccdGeCompletion[]) => void;
  focusCourseId?: string | null;
  onCourseAdded?: (course: PlanCourse, catalogCourse?: SmccdCourse) => void;
  onCourseRemoved?: (id: string) => void;
  onOpenMyCourses?: () => void;
  onFindCourse?: (course: SmccdCourse) => void;
}

type CollegeFilter = "all" | SmccdCollege["code"];
type SmccdSection = "courses" | "degree" | "general_education";

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
let courseCatalogCache: SmccdCourseCatalog | null = null;
let degreeCatalogCache: SmccdDegreeCatalog | null = null;
const geCompletionsCache = new Map<string, StudentSmccdGeCompletion[]>();

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
      const catalog = {
        colleges: (collegeResult.data ?? []) as unknown as SmccdCollege[],
        courses: [...(csmCourses.data ?? []), ...(skylineCourses.data ?? []), ...(canadaCourses.data ?? [])] as unknown as SmccdCourse[]
      };
      courseCatalogCache = catalog;
      return catalog;
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

      const catalog = {
        programs: (programResult.data ?? []) as unknown as SmccdProgram[],
        requirements: (requirementResult.data ?? []) as unknown as SmccdProgramRequirement[],
        requirementCourses: optionPages.flatMap((result) => result.data ?? []) as unknown as SmccdRequirementCourse[]
      };
      degreeCatalogCache = catalog;
      return catalog;
    })().catch((caught) => {
      degreeCatalogRequest = null;
      throw caught;
    });
  }
  return degreeCatalogRequest;
}

export async function preloadSmccdPlannerData(supabase: SupabaseClient) {
  await Promise.all([loadCourseCatalog(supabase), loadDegreeCatalog(supabase)]);
}

export default function SmccdPlanner({
  embedded = false,
  surface = "courses",
  school,
  supabase,
  session,
  settings,
  activeVersion,
  planCourses,
  equivalencies,
  manualCompletions,
  onManualCompletionsChanged,
  focusCourseId,
  onCourseAdded,
  onCourseRemoved,
  onOpenMyCourses,
  onFindCourse
}: Props) {
  const [courseCatalogReady, setCourseCatalogReady] = useState(Boolean(courseCatalogCache));
  const [degreeCatalogReady, setDegreeCatalogReady] = useState(Boolean(degreeCatalogCache));
  const [goalsReady, setGoalsReady] = useState(surface === "courses" || cachedStudentSmccdGoals(session.user.id) !== null);
  const [geCompletionsReady, setGeCompletionsReady] = useState(surface === "courses" || manualCompletions !== undefined || geCompletionsCache.has(session.user.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [colleges, setColleges] = useState<SmccdCollege[]>(() => courseCatalogCache?.colleges ?? []);
  const [courses, setCourses] = useState<SmccdCourse[]>(() => courseCatalogCache?.courses ?? []);
  const [programs, setPrograms] = useState<SmccdProgram[]>(() => degreeCatalogCache?.programs ?? []);
  const [requirements, setRequirements] = useState<SmccdProgramRequirement[]>(() => degreeCatalogCache?.requirements ?? []);
  const [requirementCourses, setRequirementCourses] = useState<SmccdRequirementCourse[]>(() => degreeCatalogCache?.requirementCourses ?? []);
  const [goals, setGoals] = useState<StudentSmccdGoal[]>(() => cachedStudentSmccdGoals(session.user.id) ?? []);
  const [geCompletions, setGeCompletions] = useState<StudentSmccdGeCompletion[]>(() => manualCompletions ?? geCompletionsCache.get(session.user.id) ?? []);
  const effectiveGeCompletions = manualCompletions ?? geCompletions;
  const [geCollegeCode, setGeCollegeCode] = useState<SmccdCourse["college_code"]>("CSM");
  const [search, setSearch] = useState("");
  const [collegeFilter, setCollegeFilter] = useState<CollegeFilter>("all");
  const [goalProgramId, setGoalProgramId] = useState("");
  const deferredGoalProgramId = useDeferredValue(goalProgramId);
  const [programSearch, setProgramSearch] = useState("");
  const [programRenderLimit, setProgramRenderLimit] = useState(24);
  const [selectedCourse, setSelectedCourse] = useState<SmccdCourse | null>(null);
  const availablePlanGrades = useMemo(() => selectedPlanGrades(settings), [settings]);
  const [targetGrade, setTargetGrade] = useState<GradeLevel>(availablePlanGrades[0] ?? (settings.grade_level ?? 11) as GradeLevel);
  const [courseDraft, setCourseDraft] = useState({
    term: "fall" as PlanCourse["term"]
  });
  const [manualDraft, setManualDraft] = useState({
    name: "",
    collegeUnits: 3,
    dtechCredits: 0,
    gradeLevel: (settings.grade_level ?? 11) as GradeLevel,
    term: "fall" as PlanCourse["term"]
  });

  function selectTargetGrade(grade: GradeLevel) {
    setTargetGrade(grade);
    if (grade === 12) {
      setCourseDraft((current) => current.term === "summer" ? { ...current, term: "fall" } : current);
    }
  }

  function selectManualGrade(gradeLevel: GradeLevel) {
    setManualDraft((current) => ({
      ...current,
      gradeLevel,
      term: gradeLevel === 12 && current.term === "summer" ? "fall" : current.term
    }));
  }

  useEffect(() => {
    if (courseCatalogCache) return;
    let active = true;
    void loadCourseCatalog(supabase).then((catalog) => {
      if (!active) return;
      setColleges(catalog.colleges);
      setCourses(catalog.courses);
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : "College courses could not be loaded.");
    }).finally(() => {
      if (active) setCourseCatalogReady(true);
    });
    return () => { active = false; };
  }, [supabase]);

  useEffect(() => {
    if (surface !== "degree") return;
    const cachedGoals = cachedStudentSmccdGoals(session.user.id);
    if (cachedGoals) return;
    let active = true;
    void (async () => {
      try {
        const loadedGoals = await loadStudentSmccdGoals(supabase, session.user.id);
        if (!active) return;
        setGoals(loadedGoals);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Saved degree goals could not be loaded.");
      } finally {
        if (active) setGoalsReady(true);
      }
    })();
    return () => { active = false; };
  }, [session.user.id, supabase, surface]);

  useEffect(() => {
    if (surface === "courses") return;
    if (manualCompletions !== undefined) return;
    const cachedCompletions = geCompletionsCache.get(session.user.id);
    if (cachedCompletions) return;
    let active = true;
    void (async () => {
      try {
        const { data, error: completionError } = await supabase.from("student_smccd_ge_completions")
          .select("user_id,college_code,area,completion_source")
          .eq("user_id", session.user.id);
        if (completionError) throw completionError;
        if (active) {
          const loadedCompletions = (data ?? []) as unknown as StudentSmccdGeCompletion[];
          geCompletionsCache.set(session.user.id, loadedCompletions);
          setGeCompletions(loadedCompletions);
        }
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "Manual general-education completions could not be loaded.");
      } finally {
        if (active) setGeCompletionsReady(true);
      }
    })();
    return () => { active = false; };
  }, [manualCompletions, session.user.id, supabase, surface]);

  useEffect(() => {
    if (surface !== "degree" || degreeCatalogReady) return;
    let active = true;
    void loadDegreeCatalog(supabase).then((catalog) => {
      if (!active) return;
      setPrograms(catalog.programs);
      setRequirements(catalog.requirements);
      setRequirementCourses(catalog.requirementCourses);
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : "College degree requirements could not be loaded.");
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
      .filter(({ text }) => tokens.length === 0 || tokens.every((token) => text.includes(token)))
      .sort((left, right) => {
        if (!query) return left.course.course_code.localeCompare(right.course.course_code);
        const leftRank = Number(left.code === query) * 3 + Number(left.code.startsWith(query)) * 2 + Number(left.course.title.toLowerCase().startsWith(query));
        const rightRank = Number(right.code === query) * 3 + Number(right.code.startsWith(query)) * 2 + Number(right.course.title.toLowerCase().startsWith(query));
        return rightRank - leftRank || left.course.course_code.localeCompare(right.course.course_code);
      })
      .slice(0, query ? 140 : 90)
      .map(({ course }) => course);
  }, [collegeFilter, courseSearchIndex, deferredSearch]);
  const prerequisiteEvaluator = useMemo(
    () => createSmccdPlannerPrerequisiteEvaluator(courses, planCourses, []),
    [courses, planCourses]
  );
  const planCourseIndex = useMemo(
    () => createSmccdPlanCourseIndex(planCourses, courses),
    [courses, planCourses]
  );
  const visibleCourses = useMemo(() => searchedCourses.flatMap((course) => {
    if (smccdCourseAlreadyInPlanIndex(course, planCourseIndex)) return [];
    return [{ course, evaluation: prerequisiteEvaluator(course, { gradeLevel: targetGrade, term: "fall" }) }];
  }).slice(0, 80), [planCourseIndex, prerequisiteEvaluator, searchedCourses, targetGrade]);
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
      metadata: [units, course.transfer_credit ?? "Transfer not listed"],
      readinessLabel: readiness.label,
      readinessTone: readiness.tone,
      institution: course.college_code
    };
  }), [visibleCourses]);

  const progressContext = useMemo(
    () => {
      if (surface === "courses") return null;
      return createSmccdProgramProgressContext(requirements, requirementCourses, planCourses, courses);
    },
    [courses, planCourses, requirementCourses, requirements, surface]
  );
  const programProgress = useMemo(() => {
    if (surface !== "degree" || !progressContext) return new Map<string, SmccdProgramProgress>();
    return new Map(programs.map((program) => [
        program.id,
        calculateSmccdProgramProgressWithContext(program, progressContext)
      ]));
  }, [programs, progressContext, surface]);
  const localDegreeProgressByCollege = useMemo(() => new Map<SmccdCourse["college_code"], SmccdLocalDegreeProgress>(
    surface === "courses" || !progressContext ? [] : (["CSM", "SKY", "CAN"] as const).map((collegeCode) => [
      collegeCode,
      calculateSmccdLocalDegreeProgress(
        progressContext,
        collegeCode,
        new Set(effectiveGeCompletions.filter((completion) => completion.college_code === collegeCode || completion.area === "information_literacy").map((completion) => completion.area))
      )
    ])
  ), [effectiveGeCompletions, progressContext, surface]);
  const selectedProgram = programs.find((program) => program.id === goalProgramId) ?? null;
  const generalEducationCollege = surface === "general_education" ? geCollegeCode : selectedProgram?.college_code ?? "CSM";
  const generalEducationPattern = localDegreeProgressByCollege.get(generalEducationCollege) ?? null;
  const generalEducationProgress = generalEducationPattern?.geAreas ?? [];
  const deferredProgramSearch = useDeferredValue(programSearch);
  const visiblePrograms = useMemo(() => {
    if (surface !== "degree") return [];
    const query = deferredProgramSearch.trim().toLowerCase();
    return programs
      .map((program) => ({ program, progress: programProgress.get(program.id)! }))
      .filter((row) => !query || `${row.program.title} ${row.program.award_type} ${SMCCD_COLLEGE_NAMES[row.program.college_code]}`.toLowerCase().includes(query))
      .sort((a, b) => smccdDegreeOverallPercent(b.progress, localDegreeProgressByCollege.get(b.program.college_code)!) - smccdDegreeOverallPercent(a.progress, localDegreeProgressByCollege.get(a.program.college_code)!)
        || b.progress.projectedMajorUnits - a.progress.projectedMajorUnits
        || a.program.title.localeCompare(b.program.title))
      .slice(0, 60);
  }, [deferredProgramSearch, localDegreeProgressByCollege, programProgress, programs, surface]);
  const renderedPrograms = visiblePrograms.slice(0, programRenderLimit);
  useEffect(() => {
    if (surface !== "degree" || visiblePrograms.length <= 24) return;
    if ("requestIdleCallback" in window) {
      const idleId = window.requestIdleCallback(() => setProgramRenderLimit(60), { timeout: 400 });
      return () => window.cancelIdleCallback(idleId);
    }
    const timeout = setTimeout(() => setProgramRenderLimit(60), 80);
    return () => clearTimeout(timeout);
  }, [deferredProgramSearch, surface, visiblePrograms.length]);
  const districtRows = useMemo(() => planCourses.filter((row) => Number(row.college_units ?? 0) > 0 || row.smccd_course_id), [planCourses]);
  const smccdCourseMap = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);
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
      setGoals((current) => {
        const next = [...current, data as unknown as StudentSmccdGoal];
        cacheStudentSmccdGoals(session.user.id, next);
        return next;
      });
      setNotice("Degree bookmarked.");
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
      setGoals((current) => {
        const next = current.filter((item) => item.id !== goal.id);
        cacheStudentSmccdGoals(session.user.id, next);
        return next;
      });
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
    if (targetGrade === 12 && courseDraft.term === "summer") {
      setError("Senior year does not include a summer term. Choose fall or spring.");
      return;
    }
    if (smccdCourseAlreadyInPlanIndex(selectedCourse, planCourseIndex)) {
      setError("That college course is already represented in the active plan.");
      return;
    }
    if (selectedPrerequisiteEvaluation?.result.status === "blocked") {
      setError("Complete the listed prerequisite before adding this course for the selected year.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const collegeUnits = Number(selectedCourse.units_max ?? selectedCourse.units_min);
      const creditResolution = resolveCollegeHighSchoolCredits({
        collegeUnits,
        storedHighSchoolCredits: null,
        equivalencyHighSchoolCredits: selectedEquivalency?.high_school_credits,
        normalizedCourseCode: normalizeCollegeCourseCode(selectedCourse.course_code)
      });
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
        credits: creditResolution.credits,
        college_units: collegeUnits,
        is_weighted: true,
        mapping_verified: Boolean(selectedEquivalency),
        user_edited: true,
        notes: selectedEquivalency
          ? `${SMCCD_COLLEGE_NAMES[selectedCourse.college_code]} ${selectedCourse.source_year} catalog. The official ${school.short_name} equivalency source lists ${selectedEquivalency.high_school_credits} high-school credits as ${selectedEquivalency.high_school_equivalent}. Confirm current approval, prerequisites, schedule, and transcript delivery.`
          : `${SMCCD_COLLEGE_NAMES[selectedCourse.college_code]} ${selectedCourse.source_year} catalog. ${creditResolution.credits > 0 ? `${collegeUnits} college units are provisionally represented as ${creditResolution.credits} high-school credits for GPA calculations. ` : "High-school credit is unresolved. "}Verify schedule availability, prerequisites, high school approval, and transcript delivery.`,
        requirement_area_override: selectedEquivalency?.requirement_area ?? null,
        sort_order: planCourses.length
      }).select("*").single();
      if (insertError) throw insertError;
      onCourseAdded?.(data as unknown as PlanCourse, selectedCourse);
      setSelectedCourse(null);
      setNotice(selectedEquivalency
        ? `${selectedCourse.course_code} added with the source-backed ${school.short_name} equivalency. Confirm that the source is still current.`
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
    if (manualDraft.gradeLevel === 12 && manualDraft.term === "summer") {
      setError("Senior year does not include a summer term. Choose fall or spring.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data, error: insertError } = await supabase.from("plan_courses").insert({
        plan_version_id: activeVersion.id,
        user_id: session.user.id,
        custom_course_name: manualDraft.name.trim(),
        grade_level: manualDraft.gradeLevel,
        school_year: schoolYearForGrade(settings.graduation_year ?? new Date().getFullYear() + 3, manualDraft.gradeLevel),
        term: manualDraft.term,
        status: "planned",
        credits: manualDraft.dtechCredits,
        college_units: manualDraft.collegeUnits,
        is_weighted: true,
        mapping_verified: false,
        user_edited: true,
        notes: "Manual college entry. Verify the exact catalog record, schedule, prerequisites, high school approval, and transcript delivery.",
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

  async function toggleManualDegreeCompletion(area: "7A" | "information_literacy") {
    const completionCollege = area === "information_literacy" ? "SKY" : geCollegeCode;
    const existing = effectiveGeCompletions.find((completion) => completion.college_code === completionCollege && completion.area === area);
    setBusy(true);
    setError(null);
    try {
      if (existing) {
        const { error: deleteError } = await supabase.from("student_smccd_ge_completions")
          .delete()
          .eq("user_id", session.user.id)
          .eq("college_code", completionCollege)
          .eq("area", area);
        if (deleteError) throw deleteError;
        const next = effectiveGeCompletions.filter((completion) => completion !== existing);
        geCompletionsCache.set(session.user.id, next);
        setGeCompletions(next);
        onManualCompletionsChanged?.(next);
        setNotice(area === "7A" ? "Manual PE completion removed." : "Information-literacy confirmation removed.");
      } else {
        const completion: StudentSmccdGeCompletion = {
          user_id: session.user.id,
          college_code: completionCollege,
          area,
          completion_source: "manual"
        };
        const { error: insertError } = await supabase.from("student_smccd_ge_completions").upsert(completion, { onConflict: "user_id,college_code,area" });
        if (insertError) throw insertError;
        const next = [...effectiveGeCompletions.filter((item) => !(item.college_code === completionCollege && item.area === area)), completion];
        geCompletionsCache.set(session.user.id, next);
        setGeCompletions(next);
        onManualCompletionsChanged?.(next);
        setNotice(area === "7A" ? "PE marked complete for this college pattern." : "Skyline information literacy marked complete.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The manual degree completion could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  if (!courseCatalogReady || (surface === "degree" && !goalsReady) || (surface !== "courses" && !geCompletionsReady)) return <div className="smccd-loading" role="status">Loading college courses...</div>;

  return (
    <div className="smccd-workspace">
      {!embedded && <header className="page-header">
        <div>
          <h1>College concurrent enrollment</h1>
          <p>Search college catalogs, add exact courses, and track a source-backed AA or AS goal.</p>
        </div>
        <a className="secondary-button" href="https://smccd.edu/k-12/" target="_blank" rel="noreferrer">Official K-12 steps <ArrowSquareOut size={16} /></a>
      </header>}

      {error && <div className="inline-alert error" role="alert">{error}</div>}
      {notice && <div className="inline-alert success smccd-notice" role="status"><span>{notice}</span>{embedded && onOpenMyCourses && <button className="quiet-button" type="button" onClick={onOpenMyCourses}>View My courses</button>}</div>}

      {surface === "courses" && <CourseCatalogBrowser
        source="smccd"
        title="Full college catalog"
        countLabel={search !== deferredSearch ? "Updating results" : !search.trim() ? `${visibleCourses.length} courses` : visibleCourses.length === 80 ? "First 80 matches" : `${visibleCourses.length} ${visibleCourses.length === 1 ? "course" : "courses"}`}
        filters={<>
          <label className="catalog-search-field"><span>Search college courses</span><div className="catalog-search-input"><MagnifyingGlass size={17} aria-hidden /><input aria-label="Search college courses" value={search} onChange={(event) => { setSearch(event.target.value); setSelectedCourse(null); }} placeholder="Try ENGL C1000, statistics, or biology" /></div></label>
          <label className="catalog-college-select"><span>College</span><select value={collegeFilter} onChange={(event) => { setCollegeFilter(event.target.value as CollegeFilter); setSelectedCourse(null); }}><option value="all">All colleges</option>{colleges.map((college) => <option value={college.code} key={college.code}>{college.name}</option>)}</select></label>
        </>}
        results={visibleCourseResults}
        selectedId={selectedCourse?.id ?? null}
        onSelect={(id) => { const course = courses.find((candidate) => candidate.id === id); if (course) chooseCourse(course); }}
        emptyTitle={search.trim() ? "No matching courses" : "No eligible courses in this view"}
        emptyBody={search.trim() ? "Try another code or title. Courses already in your plan stay hidden." : "Choose another college."}
        detail={selectedCourse && selectedPrerequisiteEvaluation ? <CourseDetailLayout
          identity={<span className="catalog-detail-institution"><InstitutionMark institution={selectedCourse.college_code} decorative />{SMCCD_COLLEGE_NAMES[selectedCourse.college_code]}</span>}
          code={selectedCourse.course_code}
          title={selectedCourse.title}
          sourceUrl={selectedCourse.catalog_url}
          facts={[
            { label: "Units", value: selectedCourse.units_max && selectedCourse.units_max !== selectedCourse.units_min ? `${selectedCourse.units_min}-${selectedCourse.units_max}` : selectedCourse.units_min },
            { label: "Transfer", value: selectedCourse.transfer_credit ?? "Not listed" },
            { label: "Degree credit", value: selectedCourse.degree_applicable ? "Yes" : "No" }
          ]}
          controls={<form className="catalog-plan-controls smccd-course-draft" onSubmit={addCatalogCourse}>
            <label><span>School year</span><select value={targetGrade} onChange={(event) => selectTargetGrade(Number(event.target.value) as GradeLevel)}>{availablePlanGrades.map((grade) => <option key={grade} value={grade}>Grade {grade}</option>)}</select></label>
            <label><span>Term</span><select value={courseDraft.term} onChange={(event) => setCourseDraft({ ...courseDraft, term: event.target.value as PlanCourse["term"] })}><option value="fall">Fall</option><option value="spring">Spring</option>{targetGrade < 12 && <option value="summer">Summer</option>}</select></label>
            <button className="primary-button" type="submit" disabled={busy || selectedPrerequisiteEvaluation.result.status === "blocked"}><Plus size={16} /> Add to plan</button>
          </form>}
        >
          {(selectedCourse.attributes ?? []).length > 0 && <section className="catalog-detail-section"><strong>College gen-ed</strong><ul>{selectedCourse.attributes.map((attribute) => <li key={attribute}>{attribute}</li>)}</ul></section>}
          {selectedEquivalency && <section className="catalog-detail-section catalog-equivalency-section"><strong>High school credit</strong><dl><div><dt>Credits</dt><dd>{selectedEquivalency.high_school_credits}</dd></div><div><dt>Counts as</dt><dd>{selectedEquivalency.high_school_equivalent}</dd></div></dl></section>}
          <PrerequisiteReadout evaluation={selectedPrerequisiteEvaluation} recommendedPreparation={selectedCourse.recommended_preparation ?? []} />
        </CourseDetailLayout> : <div className="catalog-detail-empty"><BookOpen size={20} aria-hidden /><strong>Select a college course</strong><p>Review the course and choose its term before adding it.</p></div>}
      />}

      {!embedded && <section className="content-section smccd-plan-section">
        <header className="section-heading"><div><h2>College courses in this plan</h2><p>Transcript imports and planned catalog courses use the same district record when matched.</p></div></header>
        {districtRows.length ? <div className="source-list">{districtRows.map((row) => { const catalogCourse = row.smccd_course_id ? smccdCourseMap.get(row.smccd_course_id) : null; return <article className="source-row dual-enrollment-row" key={row.id}>{catalogCourse ? <InstitutionMark institution={catalogCourse.college_code} decorative /> : <InstitutionMark institution="smccd" decorative />}<div><strong>{row.custom_course_name ?? "College course"}</strong><span>{row.college_units ?? 0} college units, {row.credits ?? 0} proposed high school credits, grade {row.grade_level}</span></div><span className="confidence-tag uncertain">Verify</span><button className="icon-button danger" type="button" onClick={() => void removeCourse(row)} aria-label={`Remove ${row.custom_course_name ?? "college course"}`}><Trash size={16} /></button>{row.notes && <p>{row.notes}</p>}</article>; })}</div> : <div className="empty-state"><BookOpen size={23} weight="duotone" /><strong>No college courses planned</strong><p>Search the college catalog or import a transcript to add exact courses.</p></div>}
      </section>}

      {surface === "degree" && !degreeCatalogReady && <div className="smccd-loading smccd-degree-loading" role="status">Loading degree requirements...</div>}

      {surface === "degree" && degreeCatalogReady && <section className="content-section smccd-goal-section smccd-degree-transition">
        <header className="section-heading smccd-degree-section-heading">
          <div><h2>Associate degree planner</h2><p>Compare official AA and AS programs against completed work and the active plan.</p></div>
          <div className="smccd-program-filters smccd-program-toolbar">
            <label className="search-box"><MagnifyingGlass size={15} /><input aria-label="Search associate degrees" value={programSearch} onChange={(event) => { setProgramSearch(event.target.value); setProgramRenderLimit(24); }} placeholder="Search degrees" /></label>
            <span>{programSearch !== deferredProgramSearch ? "Updating" : `${visiblePrograms.length} programs, ${goals.length} marked`}</span>
          </div>
        </header>

        <div className="smccd-degree-browser" aria-label="Associate degree progress">
          {visiblePrograms.length ? <table className="smccd-degree-table">
            <colgroup><col className="smccd-degree-column" /><col className="smccd-progress-column" /><col className="smccd-major-column" /></colgroup>
            <thead><tr><th>Degree</th><th>Progress</th><th>Major units</th></tr></thead>
            <tbody>{renderedPrograms.map(({ program, progress: programResult }) => {
              const markedGoal = goals.find((goal) => goal.program_id === program.id);
              const isMarked = Boolean(markedGoal);
              const isSelected = goalProgramId === program.id;
              const localDegreeProgress = localDegreeProgressByCollege.get(program.college_code)!;
              const geProgress = localDegreeProgress.geAreas;
              const geSatisfied = geProgress.filter((area) => area.status === "completed" || area.status === "planned").length;
              const graduationSatisfied = localDegreeProgress.graduationRequirements.filter((requirement) => requirement.status === "completed" || requirement.status === "planned").length;
              const overallPercent = smccdDegreeOverallPercent(programResult, localDegreeProgress);
              const previewCodes = [...new Set(programResult.requirements.flatMap((item) => item.optionCourseCodes))].slice(0, 4);
              return <Fragment key={program.id}>
                <tr className={`${isSelected ? `selected award-${program.award_type.toLowerCase()}` : ""} ${isMarked ? "marked" : ""}`}>
                  <th className="smccd-degree-row-heading" scope="row">
                    <div className="smccd-degree-title-line">
                      <button className="smccd-degree-title-button" type="button" aria-expanded={isSelected} onClick={() => setGoalProgramId(isSelected ? "" : program.id)}>{program.title}</button>
                      <span className={`smccd-degree-award award-${program.award_type.toLowerCase()}`}>{program.award_type}</span>
                      <button className="smccd-degree-bookmark" type="button" aria-pressed={isMarked} aria-label={isMarked ? `Remove bookmark from ${program.title}` : `Bookmark ${program.title}`} title={isMarked ? "Remove bookmark" : "Bookmark degree"} disabled={busy} onClick={(event) => { event.stopPropagation(); if (markedGoal) void removeGoal(markedGoal); else void saveGoal(program.id); }}><BookmarkSimple size={18} weight={isMarked ? "fill" : "regular"} /></button>
                    </div>
                    <p title={`${SMCCD_COLLEGE_NAMES[program.college_code]}. ${previewCodes.length ? `Core: ${previewCodes.join(", ")}` : "See catalog for course requirements."}`}>{SMCCD_COLLEGE_NAMES[program.college_code]} · {previewCodes.length ? `Core: ${previewCodes.join(", ")}` : "See catalog for course requirements."}</p>
                  </th>
                  <td data-label="Progress"><div className="smccd-progress-cell"><strong>{overallPercent}%</strong><div className="smccd-progress-track" aria-hidden="true"><div style={{ width: `${overallPercent}%` }} /></div></div></td>
                  <td className={programResult.projectedMajorUnits >= programResult.requiredMajorUnits ? "complete" : ""} data-label="Major units">{formatPlannerNumber(Math.min(programResult.projectedMajorUnits, programResult.requiredMajorUnits || programResult.projectedMajorUnits))} / {programResult.requiredMajorUnits ? formatPlannerNumber(programResult.requiredMajorUnits) : "Review"}</td>
                </tr>
                {isSelected && deferredGoalProgramId === goalProgramId && <tr className="smccd-degree-analysis-row"><td colSpan={3}><FadeContent className="smccd-degree-analysis">
                  <header className="smccd-degree-analysis-header">
                    <div><h3>{program.title} <span className={`smccd-degree-award award-${program.award_type.toLowerCase()}`}>{program.award_type}</span></h3><p>Catalog year {program.source_year}. Major requirements are sourced from {SMCCD_COLLEGE_NAMES[program.college_code]} and evaluated with completed, current, and planned coursework.</p></div>
                    <a href={program.catalog_url} target="_blank" rel="noreferrer">Open official catalog <ArrowSquareOut size={13} /></a>
                  </header>
                  <dl className="smccd-degree-analysis-summary">
                    <div><dt>Major Units</dt><dd className={programResult.projectedMajorUnits >= programResult.requiredMajorUnits ? "complete" : ""}>{formatPlannerNumber(programResult.projectedMajorUnits)} / {formatPlannerNumber(programResult.requiredMajorUnits)}</dd></div>
                    <div><dt>Degree Units</dt><dd className={programResult.projectedDegreeApplicableUnits >= programResult.totalDegreeUnits ? "complete" : ""}>{formatPlannerNumber(programResult.projectedDegreeApplicableUnits)} / {formatPlannerNumber(programResult.totalDegreeUnits)}</dd></div>
                    <div><dt>GE Areas</dt><dd className={geSatisfied >= geProgress.length ? "complete" : ""}>{geSatisfied} / {geProgress.length}</dd></div>
                    <div><dt>Other Requirements</dt><dd className={graduationSatisfied >= localDegreeProgress.graduationRequirements.length ? "complete" : ""}>{localDegreeProgress.graduationRequirements.length ? `${graduationSatisfied} / ${localDegreeProgress.graduationRequirements.length}` : "None"}</dd></div>
                    <div><dt>Requirements</dt><dd className={programResult.satisfiedRequirements >= programResult.totalRequirements ? "complete" : ""}>{programResult.satisfiedRequirements} / {programResult.totalRequirements}</dd></div>
                  </dl>
                  <div className="smccd-degree-requirements">{programResult.requirements.map((item) => {
                    const visualState = item.status === "satisfied" ? "satisfied" : item.status === "partial" ? "partial" : "unsatisfied";
                    return <article className={`smccd-degree-requirement ${visualState}`} key={item.requirement.id}>
                      <header><h4>{item.requirement.label}</h4><span>{visualState === "satisfied" ? "Complete" : visualState === "partial" ? "Partial" : item.status === "manual_review" ? "Review" : "Missing"}</span></header>
                      <div className="smccd-degree-course-section"><b>Fulfills</b>{item.selectedCourses.length ? <ul>{item.selectedCourses.map((course) => <li key={`${item.requirement.id}-${course.courseCode}`}><strong>{course.courseCode}</strong><span>{course.title}</span><em>{formatPlannerNumber(course.units)} units{course.letterGrade ? `, ${course.status} ${course.letterGrade}` : `, ${course.status}`}{course.term ? `, ${course.term}` : ""}</em></li>)}</ul> : <p>No matching coursework yet.</p>}</div>
                      <div className="smccd-degree-course-section"><b>Still Needed: {item.status === "satisfied" ? "0 units" : item.missingSummary}</b>{item.remainingOptions.length && item.status !== "satisfied" ? <ul>{item.remainingOptions.map((course) => <li key={`${item.requirement.id}-${course.collegeCode}-${course.courseCode}`}><button type="button" onClick={() => findDegreeCourse(course.courseCode, course.collegeCode)}>{course.courseCode}</button><span>{course.title}</span><em>{formatPlannerNumber(course.units)} units</em></li>)}</ul> : <p>No remaining courses needed.</p>}</div>
                      {item.requirement.kind === "text_rule" && <p className="smccd-degree-requirement-note">{item.requirement.raw_text ?? "This rule needs official review."}</p>}
                      {item.manualReviewReason && item.requirement.kind !== "text_rule" && <p className="smccd-degree-requirement-note">{item.manualReviewReason}</p>}
                    </article>;
                  })}</div>
                  <footer className="smccd-degree-source"><Warning size={16} /><p>This audit does not verify residency, catalog rights, waivers, or substitutions. Confirm the final degree petition with an SMCCD counselor.</p><a href={program.catalog_url} target="_blank" rel="noreferrer">Official requirements <ArrowSquareOut size={14} /></a></footer>
                </FadeContent></td></tr>}
              </Fragment>;
            })}</tbody>
          </table> : <div className="smccd-program-empty"><strong>No matching degrees</strong><p>Try another program name, award, or college.</p></div>}
        </div>
      </section>}

      {surface === "general_education" && <section className="content-section smccd-goal-section smccd-ge-page smccd-degree-transition">
        <header className="section-heading smccd-ge-page-heading">
          <div><h2>College gen-ed</h2><p>Each college's local AA and AS pattern is evaluated separately.</p></div>
          <label><span className="sr-only">College pattern</span><select value={geCollegeCode} onChange={(event) => setGeCollegeCode(event.target.value as SmccdCourse["college_code"])}><option value="CSM">College of San Mateo</option><option value="SKY">Skyline College</option><option value="CAN">Cañada College</option></select></label>
        </header>
        {school.slug === "design-tech-high-school" && <aside className="enrollment-policy-callout" role="status">
          <Warning size={16} weight="fill" aria-hidden />
          <div>
            <strong>Physical education credit may be missing from the high school transcript</strong>
            <p>SMCCD physical education credits do not appear on d.tech transcripts. Check the <a href={SMCCD_LOCAL_GE_SOURCE_URLS[generalEducationCollege]} target="_blank" rel="noreferrer">official college source</a> and your DegreeWorks audit before relying on the Area 7A progress shown here.</p>
          </div>
        </aside>}
        <section className="smccd-general-education" aria-labelledby="smccd-general-education-title">
          <header><div><h3 id="smccd-general-education-title">{SMCCD_COLLEGE_NAMES[generalEducationCollege]} gen-ed requirements</h3><p>{generalEducationPattern?.minimumGeUnits ?? 0} units in this college's local pattern.</p></div><span>{generalEducationProgress.filter((area) => area.status === "completed" || area.status === "planned").length} of {generalEducationProgress.length} GE areas covered</span></header>
          <div className="smccd-ge-list">{generalEducationProgress.map((area) => {
            const planned = area.projectedCourseCodes.filter((code) => !area.completedCourseCodes.includes(code));
            const isSatisfied = area.status === "completed" || area.status === "planned";
            const examples = area.eligibleCourseCodes.slice(0, 8);
            return <article className="smccd-ge-row" key={area.area}>
              {area.area === "7A"
                ? <input className="smccd-ge-manual-checkbox" type="checkbox" checked={isSatisfied} disabled={busy || (isSatisfied && !area.manuallyCompleted)} onChange={() => void toggleManualDegreeCompletion("7A")} aria-label="Physical education requirement completed" title={isSatisfied && !area.manuallyCompleted ? "Covered by a course in the plan" : "Confirm physical education completion"} />
                : <span className={`smccd-ge-check ${area.status === "completed" ? "completed" : area.status === "planned" ? "planned" : ""}`} role="img" aria-label={`${area.label}: ${isSatisfied ? "satisfied" : "not satisfied"}`}>{area.status === "completed" ? <CheckCircle size={18} weight="fill" /> : area.status === "planned" ? <Clock size={18} weight="fill" /> : <Circle size={18} />}</span>}
              <div><h4>{area.label}: {area.description}</h4><p>{examples.length ? `Courses include ${examples.join(", ")}${area.eligibleCourseCodes.length > examples.length ? ", and more." : "."}` : area.missingSummary}</p></div>
              <div className="smccd-ge-courses">
                {area.completedCourseCodes.map((code) => <span className="completed" key={`completed-${area.area}-${code}`}>{code}</span>)}
                {planned.map((code) => <span className="planned" key={`planned-${area.area}-${code}`}>{code}</span>)}
              </div>
            </article>;
          })}</div>
          {generalEducationPattern?.graduationRequirements.length ? <>
            <div className="smccd-ge-section-heading"><h4>Separate graduation requirements</h4><p>These are outside the {generalEducationPattern.minimumGeUnits}-unit GE pattern.</p></div>
            <div className="smccd-ge-list">{generalEducationPattern.graduationRequirements.map((requirement) => {
              const planned = requirement.projectedCourseCodes.filter((code) => !requirement.completedCourseCodes.includes(code));
              const isSatisfied = requirement.status === "completed" || requirement.status === "planned";
              const examples = requirement.eligibleCourseCodes.slice(0, 8);
              return <article className="smccd-ge-row" key={requirement.id}>
                {requirement.manualCompletionAvailable
                  ? <input className="smccd-ge-manual-checkbox" type="checkbox" checked={isSatisfied} disabled={busy || (isSatisfied && !requirement.manuallyCompleted)} onChange={() => void toggleManualDegreeCompletion("information_literacy")} aria-label={`${requirement.label} completed`} title={isSatisfied && !requirement.manuallyCompleted ? "Covered by coursework" : "Confirm completion"} />
                  : <span className={`smccd-ge-check ${requirement.status === "completed" ? "completed" : requirement.status === "planned" ? "planned" : ""}`} role="img" aria-label={`${requirement.label}: ${isSatisfied ? "satisfied" : "not satisfied"}`}>{requirement.status === "completed" ? <CheckCircle size={18} weight="fill" /> : requirement.status === "planned" ? <Clock size={18} weight="fill" /> : <Circle size={18} />}</span>}
                <div><h4>{requirement.label}</h4><p>{examples.length ? `Courses include ${examples.join(", ")}${requirement.eligibleCourseCodes.length > examples.length ? ", and more." : "."}` : requirement.description}</p></div>
                <div className="smccd-ge-courses">
                  {requirement.completedCourseCodes.map((code) => <span className="completed" key={`completed-${requirement.id}-${code}`}>{code}</span>)}
                  {planned.map((code) => <span className="planned" key={`planned-${requirement.id}-${code}`}>{code}</span>)}
                </div>
              </article>;
            })}</div>
          </> : null}
          <footer><Warning size={15} /><p>Each college keeps its own local pattern. District reciprocity can carry qualifying source-college credit into the corresponding requirement, but it does not replace the selected college's GE structure or separate graduation requirements.</p><a href={SMCCD_LOCAL_GE_SOURCE_URLS[generalEducationCollege]} target="_blank" rel="noreferrer">Official 2025-2026 pattern <ArrowSquareOut size={13} /></a></footer>
        </section>
      </section>}

      {surface === "courses" && <details className="smccd-manual-entry">
        <summary>Course missing from the catalog?</summary>
        <form className="form-section compact-form" onSubmit={addManualCourse}>
          <h2>Add a manual course</h2>
          <label className="form-field"><span>Exact course code and title</span><input value={manualDraft.name} onChange={(event) => setManualDraft({ ...manualDraft, name: event.target.value })} required /></label>
          <div className="form-grid four">
            <label className="form-field"><span>College units</span><input type="number" min={0.5} max={19} step={0.5} value={manualDraft.collegeUnits} onChange={(event) => setManualDraft({ ...manualDraft, collegeUnits: Number(event.target.value) })} /></label>
            <label className="form-field"><span>Proposed high school credits</span><input type="number" min={0} max={30} step={0.5} value={manualDraft.dtechCredits} onChange={(event) => setManualDraft({ ...manualDraft, dtechCredits: Number(event.target.value) })} /></label>
            <label className="form-field"><span>School year</span><select value={manualDraft.gradeLevel} onChange={(event) => selectManualGrade(Number(event.target.value) as GradeLevel)}>{availablePlanGrades.map((grade) => <option key={grade} value={grade}>Grade {grade} · {schoolYearForGrade(settings.graduation_year ?? new Date().getFullYear() + 3, grade)}</option>)}</select></label>
            <label className="form-field"><span>Term</span><select value={manualDraft.term} onChange={(event) => setManualDraft({ ...manualDraft, term: event.target.value as PlanCourse["term"] })}><option value="fall">Fall</option><option value="spring">Spring</option>{manualDraft.gradeLevel < 12 ? <option value="summer">Summer</option> : null}</select></label>
          </div>
          <button className="secondary-button" type="submit" disabled={busy}><Plus size={17} /> Add manual course</button>
        </form>
      </details>}
    </div>
  );
}


function formatPlannerNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
