import {
  AirplaneTiltIcon as AirplaneTilt,
  ArrowClockwiseIcon as ArrowClockwise,
  BookOpenIcon as BookOpen,
  BriefcaseIcon as Briefcase,
  CaretDownIcon as CaretDown,
  ChartLineUpIcon as ChartLineUp,
  CheckIcon as Check,
  CpuIcon as Cpu,
  FileArrowUpIcon as FileArrowUp,
  FlagIcon as Flag,
  FloppyDiskIcon as FloppyDisk,
  GaugeIcon as Gauge,
  GraduationCapIcon as GraduationCap,
  HouseIcon as House,
  ListChecksIcon as ListChecks,
  MoonIcon as Moon,
  PlusIcon as Plus,
  ScalesIcon as Scales,
  SignOutIcon as SignOut,
  SparkleIcon as Sparkle,
  SunIcon as Sun,
  UserCircleIcon as UserCircle,
  WarningIcon as Warning,
  XIcon as X
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import type { Session } from "@supabase/supabase-js";
import BrandMark from "@/components/BrandMark";
import InstitutionMark from "@/components/InstitutionMark";
import {
  useCallback,
  useEffect,
  lazy,
  useMemo,
  useRef,
  Suspense,
  useState,
  type ReactNode,
  type SyntheticEvent
} from "react";
import {
  appliedCreditBreakdown,
  calculateGpa,
  calculateUcGpaEstimate,
  calculateRequirementProgress,
  calculateWorkload,
  courseDisplayName,
  dtechGradePoint,
  generateSuggestedPlan,
  generateTimeline,
  overallCompletedPercent,
  overallGraduationPercent,
  planCourseMovePatch,
  reconcileGeneratedTimelineTasks,
  selectedPlanGrades,
  schoolYearForGrade,
  simulatePlan
} from "@/lib/planning";
import { requirementsForProfile } from "@/lib/planning";
import { courseProfileFit } from "@/lib/profile-planning";
import {
  resolveTranscriptCourse,
  transcriptPlanCourseDraft,
  visibleTranscriptUncertaintyNotes,
  type TranscriptCoursePayload
} from "@/lib/transcript";
import CodexReviewPanel, { type ReviewDestination } from "@/components/CodexReviewPanel";
import AnimatedContent from "@/components/reactbits/AnimatedContent";
import CourseCatalogBrowser from "@/components/CourseCatalogBrowser";
import CourseKanban from "@/components/CourseKanban";
import OverviewPath, { type OverviewPathData } from "@/components/OverviewPath";
import PrerequisiteReadout, { prerequisiteDisplay } from "@/components/PrerequisiteReadout";
import TranscriptAiRunDetails, { type TranscriptAiTransparency } from "@/components/TranscriptAiRunDetails";
import WorkspaceTabs from "@/components/WorkspaceTabs";
import type { ExperienceDraft } from "@/components/student-tools/ExperienceLog";
import type { CourseCheck, NextStepDraft } from "@/components/student-tools/NextSteps";
import type {
  Activity,
  CatalogReviewItem,
  Course,
  CourseRequirementMapping,
  FourYearPlan,
  GraduationRequirement,
  GradeLevel,
  OfficialSource,
  PlanCourse,
  PlanVersion,
  School,
  SmccdCourse,
  SmccdHighSchoolEquivalency,
  SimulationConfig,
  SimulationResult,
  StudentProfile,
  TimelineTask
} from "@/lib/workspace-types";
import { hasPublicEnv } from "@/lib/env";
import { institutionKeyFromName } from "@/lib/institutions";
import { evaluateDtechPlannerPrerequisites, evaluateSmccdPlannerPrerequisites } from "@/lib/prerequisites";
import { dtechCatalogEligibility } from "@/lib/catalog-eligibility";
import { getBrowserSupabase } from "@/lib/supabase/browser";

const OnboardingFlow = lazy(() => import("@/components/OnboardingFlow"));
const AiStatusPanel = lazy(() => import("@/components/AiStatusPanel"));
const GraduationWorkspace = lazy(() => import("@/components/GraduationWorkspace"));
const SmccdPlanner = lazy(() => import("@/components/SmccdPlanner"));
const ExperienceLog = lazy(() => import("@/components/student-tools/ExperienceLog"));
const NextSteps = lazy(() => import("@/components/student-tools/NextSteps"));
const LoadCheck = lazy(() => import("@/components/student-tools/LoadCheck"));
const PlanningPreferences = lazy(() => import("@/components/student-tools/PlanningPreferences"));

type ViewId =
  | "dashboard"
  | "courses"
  | "profile"
  | "sources"
  | "graduation"
  | "gpa"
  | "activities"
  | "timeline"
  | "simulator"
  | "ai_status";

const PRIMARY_NAV_ITEMS: Array<{ id: ViewId; label: string; icon: Icon }> = [
  { id: "dashboard", label: "Overview", icon: House },
  { id: "courses", label: "Courses", icon: BookOpen },
  { id: "graduation", label: "Graduation", icon: GraduationCap }
];

const SECONDARY_NAV_ITEMS: Array<{ id: ViewId; label: string; icon: Icon }> = [
  { id: "sources", label: "Transcript import", icon: FileArrowUp },
  { id: "gpa", label: "GPA", icon: ChartLineUp },
  { id: "activities", label: "Experiences", icon: Briefcase },
  { id: "timeline", label: "Next steps", icon: ListChecks },
  { id: "simulator", label: "Load check", icon: Scales },
  { id: "profile", label: "Planning preferences", icon: UserCircle },
  { id: "ai_status", label: "AI connection", icon: Cpu }
];

const NAV_ITEMS = [...PRIMARY_NAV_ITEMS, ...SECONDARY_NAV_ITEMS];

// Demo-only placement metadata. The durable product entry point is the
// Planning preferences "Review setup" action; remove this sidebar shortcut after demos.
const DEMO_ONBOARDING_SHORTCUT = {
  label: "Replay onboarding",
  currentPlacement: "sidebar-footer",
  intendedPlacement: "student-profile-review-setup"
} as const;

// Demo-only placement metadata. This shortcut previews the public entry screen
// without ending the current session; remove it with the other demo controls.
const DEMO_LOGIN_SHORTCUT = {
  label: "View login page",
  currentPlacement: "sidebar-footer",
  intendedPlacement: "demo-controls"
} as const;

type CourseArea = "mine" | "dtech" | "smccd";
type GpaLens = "transcript" | "uc";
type SourceAiTransparency = TranscriptAiTransparency;
const DEFAULT_SIMULATION: SimulationConfig = {
  collegeUnits: 3,
  activityHoursChange: 0
};

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatCredits(value: number) {
  return `${Number(value).toFixed(value % 1 === 0 ? 0 : 1)} credits`;
}

function formatGpa(value: number | null) {
  return value === null ? "Not available" : value.toFixed(2);
}

function PageHeader({
  title,
  description,
  actions
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <Flag size={23} weight="duotone" aria-hidden />
      <strong>{title}</strong>
      <p>{body}</p>
      {action}
    </div>
  );
}

function PaginationControls({
  page,
  pageCount,
  onChange,
  label
}: {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  label: string;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav className="pagination-controls" aria-label={label}>
      <button className="secondary-button small" type="button" onClick={() => onChange(page - 1)} disabled={page === 0}>Previous</button>
      <span>Page {page + 1} of {pageCount}</span>
      <button className="secondary-button small" type="button" onClick={() => onChange(page + 1)} disabled={page >= pageCount - 1}>Next</button>
    </nav>
  );
}

function LoadingWorkspace() {
  return (
    <main className="workspace-loading" aria-live="polite">
      <div className="loading-brand"><BrandMark /> Pilot Princess</div>
      <div className="skeleton-line wide" />
      <div className="skeleton-line" />
      <div className="skeleton-grid">
        <div /><div /><div />
      </div>
      <span>Preparing your planning workspace</span>
    </main>
  );
}

export default function PlanningWorkspace() {
  const configured = hasPublicEnv();
  const supabase = useMemo(() => (configured ? getBrowserSupabase() : null), [configured]);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [toastKind, setToastKind] = useState<"info" | "success" | "error">("info");
  const [view, setView] = useState<ViewId>("dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [moreNavOpen, setMoreNavOpen] = useState(false);
  const [replayingOnboarding, setReplayingOnboarding] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light"
  );
  const [courseArea, setCourseArea] = useState<CourseArea>("mine");
  const [smccdInitialSection, setSmccdInitialSection] = useState<"courses" | "degree">("courses");
  const [gpaLens, setGpaLens] = useState<GpaLens>("transcript");
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const [selectedDtechCourseId, setSelectedDtechCourseId] = useState<string | null>(null);
  const [focusedSmccdCourseId, setFocusedSmccdCourseId] = useState<string | null>(null);
  const [dtechDraft, setDtechDraft] = useState<{ gradeLevel: GradeLevel; term: PlanCourse["term"] }>({ gradeLevel: 9, term: "full_year" });

  const [school, setSchool] = useState<School | null>(null);
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [sources, setSources] = useState<OfficialSource[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [requirements, setRequirements] = useState<GraduationRequirement[]>([]);
  const [mappings, setMappings] = useState<CourseRequirementMapping[]>([]);
  const [equivalencies, setEquivalencies] = useState<SmccdHighSchoolEquivalency[]>([]);
  const [plannedSmccdCourses, setPlannedSmccdCourses] = useState<SmccdCourse[]>([]);
  const [plan, setPlan] = useState<FourYearPlan | null>(null);
  const [versions, setVersions] = useState<PlanVersion[]>([]);
  const [planCourses, setPlanCourses] = useState<PlanCourse[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [tasks, setTasks] = useState<TimelineTask[]>([]);
  const [reviewItems, setReviewItems] = useState<CatalogReviewItem[]>([]);

  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogSubject, setCatalogSubject] = useState("all");
  const [catalogGrade, setCatalogGrade] = useState<GradeLevel | "all">("all");
  const [catalogPage, setCatalogPage] = useState(0);
  const [sourceForm, setSourceForm] = useState({
    rawText: "",
    file: null as File | null
  });
  const [sourceAiTransparency, setSourceAiTransparency] = useState<SourceAiTransparency | null>(null);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, string>>({});
  const [selectedTranscriptIds, setSelectedTranscriptIds] = useState<Set<string>>(new Set());
  const [simulationConfig, setSimulationConfig] = useState<SimulationConfig>(DEFAULT_SIMULATION);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [simulationBasis, setSimulationBasis] = useState("");
  const [planExplanation, setPlanExplanation] = useState<string | null>(null);
  const [compareVersionId, setCompareVersionId] = useState("");
  const [compareCourses, setCompareCourses] = useState<PlanCourse[]>([]);
  const [compareLoading, setCompareLoading] = useState(false);
  const compareRequestRef = useRef(0);

  const activeVersion = versions.find((candidate) => candidate.kind === "active") ?? null;
  const courseMap = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);
  const trackedRequirements = useMemo(
    () => profile ? requirementsForProfile(requirements, profile) : requirements,
    [profile, requirements]
  );
  const progress = useMemo(
    () => calculateRequirementProgress(trackedRequirements, planCourses, mappings, courses, equivalencies),
    [trackedRequirements, planCourses, mappings, courses, equivalencies]
  );
  const gpa = useMemo(() => calculateGpa(planCourses), [planCourses]);
  const ucGpa = useMemo(() => calculateUcGpaEstimate(planCourses, courses), [planCourses, courses]);
  const workload = useMemo(
    () => (profile ? calculateWorkload(profile, planCourses, courses, activities) : null),
    [profile, planCourses, courses, activities]
  );
  const graduationPercent = useMemo(() => overallGraduationPercent(progress), [progress]);
  const graduationEarnedPercent = useMemo(() => overallCompletedPercent(progress), [progress]);
  const desiredGeneratedTimelineTasks = useMemo(
    () => profile
      ? generateTimeline(profile, progress).filter((task) => !task.title.startsWith("Choose a course for "))
      : [],
    [profile, progress]
  );
  const timelineTaskSync = useMemo(
    () => reconcileGeneratedTimelineTasks(tasks, desiredGeneratedTimelineTasks),
    [tasks, desiredGeneratedTimelineTasks]
  );
  const currentSimulationBasis = [
    workload?.knownWeeklyHours ?? "unknown",
    workload?.weeklyActivityHours ?? "unknown",
    workload?.demandingCourseCount ?? "unknown",
    workload?.demandingCourseLimit ?? "unknown",
    profile?.weekly_commitment_limit ?? "unset",
    profile?.stress_level ?? "unknown"
  ].join("|");

  const loadWorkspace = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setFatalError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        window.location.assign("/");
        return;
      }
      setSession(sessionData.session);
      const userId = sessionData.session.user.id;
      const [
        schoolResult,
        profileResult,
        sourceResult,
        courseResult,
        requirementResult,
        mappingResult,
        equivalencyResult,
        planResult,
        activityResult,
        taskResult,
        reviewResult
      ] = await Promise.all([
        supabase.from("schools").select("*").eq("slug", "design-tech-high-school").single(),
        supabase.from("student_profiles").select("*").eq("id", userId).single(),
        supabase.from("official_sources").select("*").order("is_official", { ascending: false }).order("created_at", { ascending: false }),
        supabase.from("courses").select("*").eq("review_status", "approved").order("subject").order("name"),
        supabase.from("graduation_requirements").select("*").eq("review_status", "approved").order("name"),
        supabase.from("course_requirement_mappings").select("*"),
        supabase.from("smccd_high_school_equivalencies").select("*").order("normalized_course_code"),
        supabase.from("four_year_plans").select("*").eq("user_id", userId).eq("is_active", true).single(),
        supabase.from("activities").select("*").eq("user_id", userId).order("created_at"),
        supabase.from("timeline_tasks").select("*").eq("user_id", userId).order("is_completed").order("due_date"),
        supabase.from("catalog_review_items").select("*").eq("user_id", userId).order("created_at", { ascending: false })
      ]);
      const firstError = [
        schoolResult.error,
        profileResult.error,
        courseResult.error,
        requirementResult.error,
        mappingResult.error,
        equivalencyResult.error,
        planResult.error
      ].find(Boolean);
      if (firstError) throw firstError;

      const loadedPlan = planResult.data as unknown as FourYearPlan;
      const versionResult = await supabase
        .from("plan_versions")
        .select("*")
        .eq("plan_id", loadedPlan.id)
        .order("created_at", { ascending: false });
      if (versionResult.error) throw versionResult.error;
      const loadedVersions = versionResult.data as unknown as PlanVersion[];
      const loadedActiveVersion = loadedVersions.find((candidate) => candidate.kind === "active");
      const planCourseResult = loadedActiveVersion
        ? await supabase
            .from("plan_courses")
            .select("*")
            .eq("plan_version_id", loadedActiveVersion.id)
            .order("grade_level")
            .order("sort_order")
        : { data: [], error: null };
      if (planCourseResult.error) throw planCourseResult.error;

      const rawProfile = profileResult.data as unknown as StudentProfile;
      const loadedProfile: StudentProfile = {
        ...rawProfile,
        career_interest_areas: rawProfile.career_interest_areas ?? [],
        work_values: rawProfile.work_values ?? [],
        exploration_questions: rawProfile.exploration_questions ?? []
      };
      setSchool(schoolResult.data as unknown as School);
      setProfile(loadedProfile);
      setSources((sourceResult.data ?? []) as unknown as OfficialSource[]);
      setCourses((courseResult.data ?? []) as unknown as Course[]);
      setRequirements((requirementResult.data ?? []) as unknown as GraduationRequirement[]);
      setMappings((mappingResult.data ?? []) as unknown as CourseRequirementMapping[]);
      setEquivalencies((equivalencyResult.data ?? []) as unknown as SmccdHighSchoolEquivalency[]);
      setPlan(loadedPlan);
      setVersions(loadedVersions);
      const loadedPlanCourses = (planCourseResult.data ?? []) as unknown as PlanCourse[];
      const plannedSmccdIds = [...new Set(loadedPlanCourses.map((row) => row.smccd_course_id).filter((id): id is string => Boolean(id)))];
      const plannedSmccdResult = plannedSmccdIds.length > 0
        ? await supabase.from("smccd_courses").select("*").in("id", plannedSmccdIds)
        : { data: [], error: null };
      if (plannedSmccdResult.error) throw plannedSmccdResult.error;
      const loadedReviewItems = (reviewResult.data ?? []) as unknown as CatalogReviewItem[];
      setPlanCourses(loadedPlanCourses);
      setPlannedSmccdCourses((plannedSmccdResult.data ?? []) as unknown as SmccdCourse[]);
      setActivities((activityResult.data ?? []) as unknown as Activity[]);
      setTasks((taskResult.data ?? []) as unknown as TimelineTask[]);
      setReviewItems(loadedReviewItems);
      setSelectedTranscriptIds((current) => {
        const importedIds = new Set(loadedPlanCourses.map((row) => row.source_review_item_id).filter(Boolean));
        const availableIds = loadedReviewItems
          .filter((item) => item.entity_type === "transcript_course" && item.status !== "rejected" && !importedIds.has(item.id))
          .map((item) => item.id);
        const availableSet = new Set(availableIds);
        const preserved = new Set([...current].filter((id) => availableSet.has(id)));
        return preserved.size > 0 || current.size > 0 ? preserved : new Set(availableIds);
      });
    } catch (caught) {
      setFatalError(caught instanceof Error ? caught.message : "The workspace could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadWorkspace(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadWorkspace]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  function notify(message: string, kind: "info" | "success" | "error" = "info") {
    setToastKind(kind);
    setToast(message);
  }

  async function selectComparisonVersion(versionId: string) {
    const requestId = ++compareRequestRef.current;
    setCompareVersionId(versionId);
    setCompareCourses([]);
    if (!supabase || !versionId) {
      setCompareLoading(false);
      return;
    }
    setCompareLoading(true);
    const { data, error } = await supabase
      .from("plan_courses")
      .select("*")
      .eq("plan_version_id", versionId)
      .order("grade_level")
      .order("sort_order");
    if (requestId !== compareRequestRef.current) return;
    if (error) notify(error.message, "error");
    else setCompareCourses((data ?? []) as unknown as PlanCourse[]);
    setCompareLoading(false);
  }

  async function runAction<T>(label: string, action: () => Promise<T>, successMessage?: string) {
    setBusyLabel(label);
    try {
      const result = await action();
      if (successMessage) {
        setToastKind("success");
        setToast(successMessage);
      }
      return result;
    } catch (caught) {
      setToastKind("error");
      setToast(caught instanceof Error ? caught.message : "That action could not be completed.");
      return null;
    } finally {
      setBusyLabel(null);
    }
  }

  async function logEvent(eventName: string, properties: Record<string, unknown> = {}) {
    if (!supabase) return;
    await supabase.rpc("log_app_event", { event_name: eventName, properties });
  }

  async function authorizedPost(path: string, body: Record<string, unknown>) {
    if (!supabase) throw new Error("Supabase is not configured.");
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error("Your session has expired.");
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${data.session.access_token}`
      },
      body: JSON.stringify(body)
    });
    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) throw new Error(String(payload.error ?? "Request failed."));
    return payload;
  }

  function navigate(nextView: ViewId) {
    setView(nextView);
    if (SECONDARY_NAV_ITEMS.some((item) => item.id === nextView)) setMoreNavOpen(true);
    setMobileNavOpen(false);
    void logEvent("view_opened", { view: nextView });
  }

  function navigateFromReview(destination: ReviewDestination) {
    if (destination === "simulator") navigate("simulator");
    else navigate(destination);
  }

  function openCourses(area: CourseArea = "mine", smccdSection: "courses" | "degree" = "courses") {
    setCourseArea(area);
    if (area === "smccd") setSmccdInitialSection(smccdSection);
    setEditingCourseId(null);
    navigate("courses");
  }

  function openRequirementCourses(area: GraduationRequirement["area"]) {
    const subjectByArea: Record<GraduationRequirement["area"], string> = {
      english: "English",
      social_science: "Social Science",
      math: "Mathematics",
      lab_science: "Laboratory Science",
      world_language: "World Language",
      design_lab: "Design Lab",
      visual_performing_arts: "Visual and Performing Arts",
      personal_development: "Personal Development"
    };
    setCatalogSubject(subjectByArea[area]);
    setCatalogSearch("");
    setCatalogPage(0);
    openCourses("dtech");
  }

  function toggleTheme() {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem("pilot-princess-theme", nextTheme);
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    window.location.assign("/");
  }

  async function savePlanningPreferences() {
    if (!supabase || !profile) return;
    await runAction(
      "Saving planning preferences",
      async () => {
        const { error } = await supabase
          .from("student_profiles")
          .update({
            academic_interests: profile.academic_interests,
            career_interest_areas: profile.career_interest_areas,
            work_values: profile.work_values,
            exploration_questions: profile.exploration_questions,
            major_direction: profile.major_direction,
            career_direction: profile.career_direction,
            goal_intensity: profile.goal_intensity,
            workload_tolerance: profile.workload_tolerance,
            weekly_commitment_limit: profile.weekly_commitment_limit,
            stress_level: profile.stress_level
          })
          .eq("id", profile.id);
        if (error) throw error;
        await logEvent("planning_preferences_updated");
      },
      "Planning preferences saved."
    );
  }

  function defaultDtechPlacement(course: Course, preferredGrade?: GradeLevel) {
    const allowedGrades = course.grade_levels.filter((grade): grade is GradeLevel => grade >= 9 && grade <= 12);
    const currentGrade = preferredGrade ?? (catalogGrade === "all" ? undefined : catalogGrade) ?? (profile?.grade_level ?? 9) as GradeLevel;
    const gradeLevel = allowedGrades.find((grade) => grade >= currentGrade) ?? allowedGrades.at(-1) ?? currentGrade;
    return { gradeLevel, term: (course.term_type === "semester" ? "fall" : "full_year") as PlanCourse["term"] };
  }

  function chooseDtechCourse(course: Course) {
    setSelectedDtechCourseId(course.id);
    setDtechDraft(defaultDtechPlacement(course));
  }

  async function addCatalogCourse(
    course: Course,
    status: "completed" | "current" | "planned",
    placement = defaultDtechPlacement(course)
  ) {
    if (!supabase || !session || !activeVersion || !profile) return;
    if (planCourses.some((row) => row.course_id === course.id)) {
      notify("That course is already in the current plan.");
      return;
    }
    const grade = placement.gradeLevel;
    const eligibility = dtechCatalogEligibility(course, grade, planCourses, courses);
    if (!eligibility.eligible) {
      notify(eligibility.reason === "outside_grade"
        ? `${course.name} is not offered for grade ${grade}.`
        : eligibility.reason === "below_math_level"
          ? `${course.name} is below the math level already demonstrated in this plan.`
          : "That course is already represented in the current plan.");
      return;
    }
    const evaluation = evaluateDtechPlannerPrerequisites(course, placement, courses, planCourses, plannedSmccdCourses, equivalencies);
    if (evaluation.result.status === "blocked") {
      notify("Complete the listed prerequisite before adding this course in that year.");
      return;
    }
    const mappingVerified = mappings.some(
      (mapping) => mapping.course_id === course.id && mapping.confidence === "verified"
    );
    await runAction(
      `Adding ${course.name}`,
      async () => {
        const { data, error } = await supabase
          .from("plan_courses")
          .insert({
            plan_version_id: activeVersion.id,
            user_id: session.user.id,
            course_id: course.id,
            grade_level: grade,
            school_year: schoolYearForGrade(profile.graduation_year ?? new Date().getFullYear() + 3, grade),
            term: placement.term,
            status,
            credits: course.credits,
            college_units: course.college_units,
            is_weighted: course.is_weighted,
            mapping_verified: mappingVerified,
            user_edited: true,
            sort_order: planCourses.filter((row) => row.grade_level === grade).length
          })
          .select("*")
          .single();
        if (error) throw error;
        setPlanCourses((current) => [...current, data as unknown as PlanCourse]);
        setSelectedDtechCourseId(null);
        await logEvent("course_selected", { course_id: course.id, status });
      },
      `${course.name} added to ${status === "completed" ? "Done" : status === "current" ? "In progress" : "Planned"}.`
    );
  }

  async function updatePlanCourse(id: string, patch: Partial<PlanCourse>) {
    if (!supabase) return;
    await runAction("Updating course", async () => {
      const safePatch = { ...patch, user_edited: true };
      const { error } = await supabase.from("plan_courses").update(safePatch).eq("id", id);
      if (error) throw error;
      setPlanCourses((current) => current.map((row) => (row.id === id ? { ...row, ...safePatch } : row)));
      await logEvent("plan_edited", { plan_course_id: id });
    });
  }

  function movePlanCourse(row: PlanCourse, status: PlanCourse["status"]) {
    if (!profile) return;
    if (row.source_review_item_id) {
      notify("Transcript records stay in Done. Correct the transcript review instead of moving them.");
      return;
    }
    const patch = planCourseMovePatch(profile, row, status, planCourses.filter((candidate) => candidate.status === status).length);
    if (patch) void updatePlanCourse(row.id, patch);
  }

  async function removePlanCourse(id: string) {
    if (!supabase) return;
    await runAction(
      "Removing course",
      async () => {
        const { error } = await supabase.from("plan_courses").delete().eq("id", id);
        if (error) throw error;
        setPlanCourses((current) => current.filter((row) => row.id !== id));
        await logEvent("plan_edited", { action: "remove_course" });
      },
      "Course removed."
    );
  }

  async function generatePlan() {
    if (!supabase || !session || !activeVersion || !profile) return;
    const generated = generateSuggestedPlan(profile, courses, planCourses);
    if (generated.length === 0) {
      notify("The current plan already contains the available d.tech flow courses.");
      return;
    }
    await runAction(
      "Generating plan",
      async () => {
        const rows = generated.map((row, index) => ({
          ...row,
          plan_version_id: activeVersion.id,
          user_id: session.user.id,
          term: "full_year",
          sort_order: index
        }));
        const { data, error } = await supabase.from("plan_courses").insert(rows).select("*");
        if (error) throw error;
        const inserted = (data ?? []) as unknown as PlanCourse[];
        setPlanCourses((current) => [...current, ...inserted]);
        const explanation = "Suggested courses were added from the official d.tech flow. Verify each placement and prerequisite before registration.";
        setPlanExplanation(explanation);
        await supabase.from("plan_versions").update({ ai_summary: null }).eq("id", activeVersion.id);
        await logEvent("plan_generated", { course_count: inserted.length, ai_used: false });
      },
      `${generated.length} suggested courses added.`
    );
  }

  async function saveSnapshot() {
    if (!supabase || !session || !plan || !activeVersion) return;
    await runAction(
      "Saving snapshot",
      async () => {
        const label = `Snapshot ${new Date().toLocaleDateString()}`;
        const { data: snapshot, error } = await supabase
          .from("plan_versions")
          .insert({
            plan_id: plan.id,
            user_id: session.user.id,
            label,
            kind: "snapshot",
            generation_config: { source_version_id: activeVersion.id }
          })
          .select("*")
          .single();
        if (error) throw error;
        if (planCourses.length > 0) {
          const copies = planCourses.map(({ id: _id, ...row }) => ({
            ...row,
            plan_version_id: snapshot.id
          }));
          const { error: copyError } = await supabase.from("plan_courses").insert(copies);
          if (copyError) throw copyError;
        }
        setVersions((current) => [snapshot as unknown as PlanVersion, ...current]);
      },
      "Plan snapshot saved."
    );
  }

  async function submitTranscript(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (!supabase || !session || !school) return;
    if (!sourceForm.file && !sourceForm.rawText.trim()) {
      notify("Choose a transcript file or paste its text.", "error");
      return;
    }
    const form = event.currentTarget;
    await runAction(
      "Reading transcript",
      async () => {
        let storagePath: string | null = null;
        let mimeType: string | null = null;
        let kind: "upload" | "screenshot" | "pasted_text" = "pasted_text";
        if (sourceForm.file) {
          const safeName = sourceForm.file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
          storagePath = `${session.user.id}/${crypto.randomUUID()}-${safeName}`;
          mimeType = sourceForm.file.type || "application/octet-stream";
          kind = mimeType.startsWith("image/") ? "screenshot" : "upload";
          const { error: uploadError } = await supabase.storage
            .from("source-uploads")
            .upload(storagePath, sourceForm.file, { contentType: mimeType, upsert: false });
          if (uploadError) throw uploadError;
        }
        const { data, error } = await supabase
          .from("official_sources")
          .insert({
            school_id: school.id,
            user_id: session.user.id,
            title: sourceForm.file?.name || "Pasted transcript",
            kind,
            storage_path: storagePath,
            raw_text: sourceForm.rawText.trim() || null,
            mime_type: mimeType,
            source_year: new Date().getFullYear().toString(),
            is_official: false,
            parse_status: "pending",
            confidence: "uncertain",
            document_type: "transcript"
          })
          .select("*")
          .single();
        if (error) throw error;
        setSourceForm({ rawText: "", file: null });
        form.reset();
        await logEvent("source_added", { kind });
        let payload: Record<string, unknown>;
        try {
          payload = await authorizedPost("/api/ai/parse-transcript", { sourceId: data.id });
        } finally {
          await loadWorkspace();
        }
        const parsedItems = ((payload.reviewItems ?? []) as CatalogReviewItem[])
          .filter((item) => item.entity_type === "transcript_course");
        setSelectedTranscriptIds(new Set(parsedItems.map((item) => item.id)));
        const parserNote = payload.aiUsed === true
          ? " Codex vision was used because the file had no readable text layer."
          : " Parsed from document text without Codex.";
        notify(`${String(payload.summary ?? "Transcript review ready.")}${parserNote}`, "success");
        setSourceAiTransparency(payload.aiUsed === true ? payload.aiTransparency as SourceAiTransparency : null);
      },
    );
  }

  async function parseSource(source: OfficialSource) {
    await runAction(
      "Parsing source",
      async () => {
        const payload = await authorizedPost(
          source.document_type === "transcript" ? "/api/ai/parse-transcript" : "/api/ai/parse-source",
          { sourceId: source.id }
        );
        await loadWorkspace();
        const parserNote = source.document_type === "transcript"
          ? payload.aiUsed === true ? " Codex vision was used because no text layer was available." : " Parsed from text without Codex."
          : "";
        notify(`${String(payload.summary ?? "Source parsing completed.")}${parserNote}`, "success");
        setSourceAiTransparency(payload.aiUsed === true ? payload.aiTransparency as SourceAiTransparency : null);
      }
    );
  }

  async function saveReview(item: CatalogReviewItem, status: "approved" | "rejected") {
    if (!supabase) return;
    await runAction(
      "Saving review",
      async () => {
        const draft = reviewDrafts[item.id] ?? JSON.stringify(item.corrected_payload ?? item.proposed_payload, null, 2);
        const corrected = JSON.parse(draft) as Record<string, unknown>;
        const { error } = await supabase
          .from("catalog_review_items")
          .update({ corrected_payload: corrected, status })
          .eq("id", item.id);
        if (error) throw error;
        setReviewItems((current) =>
          current.map((candidate) =>
            candidate.id === item.id ? { ...candidate, corrected_payload: corrected, status } : candidate
          )
        );
        if (status === "rejected") {
          setSelectedTranscriptIds((current) => {
            const next = new Set(current);
            next.delete(item.id);
            return next;
          });
        }
      },
      status === "approved" ? "Correction approved." : "Item rejected."
    );
  }

  async function importSelectedTranscriptCourses(sourceId: string | null) {
    if (!supabase || !session || !activeVersion || !profile) return;
    const importedIds = new Set(planCourses.map((row) => row.source_review_item_id).filter(Boolean));
    const candidates = reviewItems.filter(
      (item) => item.entity_type === "transcript_course"
        && item.status !== "rejected"
        && (!sourceId || item.source_id === sourceId)
        && selectedTranscriptIds.has(item.id)
        && !importedIds.has(item.id)
    );
    if (candidates.length === 0) {
      notify("Select at least one course to import.");
      return;
    }

    let prepared: Array<{ item: CatalogReviewItem; payload: Record<string, unknown> }>;
    try {
      prepared = candidates.map((item) => {
        const payload = reviewDrafts[item.id]
          ? JSON.parse(reviewDrafts[item.id]) as Record<string, unknown>
          : item.corrected_payload ?? item.proposed_payload;
        if (!String(payload.course_name ?? "").trim()) {
          throw new Error("Every selected row needs a course name before import.");
        }
        return { item, payload };
      });
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : "One corrected row is not valid JSON.", "error");
      return;
    }

    await runAction(
      "Importing transcript courses",
      async () => {
        const ids = prepared.map(({ item }) => item.id);
        const { error: approveError } = await supabase
          .from("catalog_review_items")
          .update({ status: "approved" })
          .in("id", ids);
        if (approveError) throw approveError;

        for (const { item, payload } of prepared) {
          if (!reviewDrafts[item.id]) continue;
          const { error: correctionError } = await supabase
            .from("catalog_review_items")
            .update({ corrected_payload: payload })
            .eq("id", item.id);
          if (correctionError) throw correctionError;
        }

        const inserts: Array<Record<string, unknown>> = [];
        for (const { item, payload } of prepared) {
          const draft = transcriptPlanCourseDraft(payload as unknown as TranscriptCoursePayload, profile, courses, mappings, item.id, equivalencies);
          const existing = draft.course_id
            ? planCourses.find((row) => row.course_id === draft.course_id)
            : null;
          if (existing) {
            const { error } = await supabase
              .from("plan_courses")
              .update(draft)
              .eq("id", existing.id);
            if (error) throw error;
            continue;
          }
          inserts.push({
            ...draft,
            plan_version_id: activeVersion.id,
            user_id: session.user.id,
            sort_order: planCourses.length + inserts.length
          });
        }
        if (inserts.length > 0) {
          const { error: insertError } = await supabase.from("plan_courses").insert(inserts);
          if (insertError) throw insertError;
        }
        await logEvent("transcript_courses_imported", { review_item_ids: ids, course_count: prepared.length });
        await loadWorkspace();
        setSelectedTranscriptIds(new Set());
      },
      `${prepared.length} ${prepared.length === 1 ? "course" : "courses"} imported to Done.`
    );
  }

  async function saveActivity(draft: ExperienceDraft, editingId: string | null) {
    if (!supabase || !session) return false;
    if (!draft.name.trim()) {
      notify("Add an experience name before saving.", "error");
      return false;
    }
    const record = {
      user_id: session.user.id,
      name: draft.name.trim(),
      kind: draft.kind,
      role: draft.role.trim() || null,
      organization: draft.organization.trim() || null,
      weekly_hours: draft.weeklyHours,
      weeks_per_year: draft.weeksPerYear,
      start_grade: draft.startGrade,
      end_grade: draft.endGrade,
      impact: draft.impact.trim() || null,
      description: draft.description.trim() || null,
      is_active: draft.isActive
    };
    const saved = await runAction(
      editingId ? "Updating experience" : "Adding experience",
      async () => {
        const query = editingId
          ? supabase.from("activities").update(record).eq("id", editingId)
          : supabase.from("activities").insert(record);
        const { data, error } = await query.select("*").single();
        if (error) throw error;
        const saved = data as unknown as Activity;
        setActivities((current) => editingId ? current.map((activity) => activity.id === saved.id ? saved : activity) : [...current, saved]);
        await logEvent(editingId ? "activity_updated" : "activity_added");
        return true;
      },
      editingId ? "Experience updated." : "Experience added."
    );
    return saved === true;
  }

  async function removeActivity(id: string) {
    if (!supabase) return;
    await runAction("Removing activity", async () => {
      const { error } = await supabase.from("activities").delete().eq("id", id);
      if (error) throw error;
      setActivities((current) => current.filter((activity) => activity.id !== id));
    }, "Activity removed.");
  }

  async function generateTasks() {
    if (!supabase || !session || !profile) return;
    const { obsoleteIds, updateTasks, insertTasks } = timelineTaskSync;
    const changeCount = obsoleteIds.length + updateTasks.length + insertTasks.length;
    if (changeCount === 0) {
      notify("The next-step queue is already up to date.");
      return;
    }
    await runAction(
      "Syncing next steps",
      async () => {
        if (obsoleteIds.length > 0) {
          const { error } = await supabase.from("timeline_tasks").delete().in("id", obsoleteIds);
          if (error) throw error;
        }
        for (const update of updateTasks) {
          const { error } = await supabase.from("timeline_tasks").update(update.patch).eq("id", update.id);
          if (error) throw error;
        }
        let insertedTasks: TimelineTask[] = [];
        if (insertTasks.length > 0) {
          const { data, error } = await supabase
            .from("timeline_tasks")
            .insert(insertTasks.map((task) => ({
              ...task,
              user_id: session.user.id,
              plan_version_id: activeVersion?.id ?? null,
              is_generated: true
            })))
            .select("*");
          if (error) throw error;
          insertedTasks = (data ?? []) as unknown as TimelineTask[];
        }
        const obsolete = new Set(obsoleteIds);
        const updates = new Map(updateTasks.map((update) => [update.id, update.patch]));
        setTasks((current) => [
          ...current
            .filter((task) => !obsolete.has(task.id))
            .map((task) => updates.has(task.id) ? { ...task, ...updates.get(task.id) } : task),
          ...insertedTasks
        ]);
        await logEvent("timeline_synced", {
          inserted_count: insertTasks.length,
          updated_count: updateTasks.length,
          removed_count: obsoleteIds.length
        });
      },
      `${changeCount} next-step ${changeCount === 1 ? "change" : "changes"} synced.`
    );
  }

  async function addCustomTask(draft: NextStepDraft) {
    if (!supabase || !session) return false;
    if (!draft.title.trim()) {
      notify("Add a clear next step before saving.", "error");
      return false;
    }
    const added = await runAction(
      "Adding task",
      async () => {
        const { data, error } = await supabase
          .from("timeline_tasks")
          .insert({
            user_id: session.user.id,
            plan_version_id: activeVersion?.id ?? null,
            title: draft.title.trim(),
            category: draft.category,
            due_label: draft.dueLabel.trim() || null,
            is_generated: false
          })
          .select("*")
          .single();
        if (error) throw error;
        setTasks((current) => [...current, data as unknown as TimelineTask]);
        return true;
      },
      "Task added."
    );
    return added === true;
  }

  async function deleteTask(id: string) {
    if (!supabase) return;
    const { error } = await supabase.from("timeline_tasks").delete().eq("id", id);
    if (error) {
      notify(error.message, "error");
      return;
    }
    setTasks((current) => current.filter((task) => task.id !== id));
  }

  async function updateTask(id: string, patch: Partial<TimelineTask>) {
    if (!supabase) return;
    const { error } = await supabase.from("timeline_tasks").update(patch).eq("id", id);
    if (error) {
      notify(error.message, "error");
      return;
    }
    setTasks((current) => current.map((task) => (task.id === id ? { ...task, ...patch } : task)));
    if (patch.is_completed) await logEvent("timeline_task_completed", { task_id: id });
  }

  async function runSimulation() {
    if (!profile || !workload) return;
    const result = simulatePlan(simulationConfig, profile, progress, gpa, workload);
    setSimulationResult(result);
    setSimulationBasis(currentSimulationBasis);
    await logEvent("simulation_started", { ai_used: false });
  }

  if (!configured) {
    return (
      <main className="fatal-state">
        <Warning size={28} weight="duotone" />
        <h1>Environment setup required</h1>
        <p>Add the Supabase values from <code>.env.example</code>, then restart the app.</p>
        <a className="secondary-button" href="/">Return to sign in</a>
      </main>
    );
  }
  if (loading) return <LoadingWorkspace />;
  if (fatalError || !session || !profile || !school || !plan || !activeVersion || !supabase) {
    return (
      <main className="fatal-state">
        <Warning size={28} weight="duotone" />
        <h1>Workspace unavailable</h1>
        <p>{fatalError ?? "The planning profile is missing."}</p>
        <div className="fatal-actions"><button className="secondary-button" onClick={() => void loadWorkspace()} type="button"><ArrowClockwise size={17} /> Try again</button><button className="quiet-button" onClick={() => void signOut()} type="button">Sign out</button></div>
      </main>
    );
  }

  if (!profile.onboarding_complete || replayingOnboarding) {
    return (
      <Suspense fallback={<LoadingWorkspace />}>
        <OnboardingFlow
          supabase={supabase}
          session={session}
          school={school}
          profile={profile}
          requirements={requirements}
          courses={courses}
          mappings={mappings}
          equivalencies={equivalencies}
          activeVersion={activeVersion}
          existingPlanCourses={planCourses}
          mode={replayingOnboarding ? "replay" : "initial"}
          onComplete={async () => {
            await loadWorkspace();
            if (replayingOnboarding) {
              setReplayingOnboarding(false);
              setView("profile");
              notify("Onboarding changes saved.", "success");
            }
          }}
          onExit={replayingOnboarding ? () => {
            setReplayingOnboarding(false);
            setView("profile");
            notify("Onboarding exited without saving changes.");
          } : undefined}
          onSignOut={signOut}
        />
      </Suspense>
    );
  }

  const courseFits = new Map(courses.map((course) => [course.id, courseProfileFit(course, profile)]));
  const availableCatalogGrades = selectedPlanGrades(profile);
  const activeCatalogGrade = (catalogGrade !== "all" && availableCatalogGrades.includes(catalogGrade)
    ? catalogGrade
    : availableCatalogGrades[0] ?? profile.grade_level ?? 9) as GradeLevel;
  const catalogEligibilityById = new Map(courses.map((course) => [
    course.id,
    dtechCatalogEligibility(course, activeCatalogGrade, planCourses, courses)
  ]));
  const structurallyEligibleCourses = courses.filter((course) => catalogEligibilityById.get(course.id)?.eligible);
  const prerequisiteBlockedIds = new Set(structurallyEligibleCourses.filter((course) =>
    evaluateDtechPlannerPrerequisites(
      course,
      defaultDtechPlacement(course, activeCatalogGrade),
      courses,
      planCourses,
      plannedSmccdCourses,
      equivalencies
    ).result.status === "blocked"
  ).map((course) => course.id));
  const eligibleCatalogCourses = structurallyEligibleCourses.filter((course) => !prerequisiteBlockedIds.has(course.id));
  const filteredCourses = eligibleCatalogCourses.filter((course) => {
    const query = catalogSearch.trim().toLowerCase();
    return (
      (!query || [course.name, course.subject, course.description ?? "", course.prerequisites.join(" ")].join(" ").toLowerCase().includes(query)) &&
      (catalogSubject === "all" || course.subject === catalogSubject)
    );
  }).sort((a, b) => (courseFits.get(b.id)?.score ?? 0) - (courseFits.get(a.id)?.score ?? 0) || a.name.localeCompare(b.name));
  const hiddenCatalogCounts = [...catalogEligibilityById.values()].reduce((counts, eligibility) => {
    if (eligibility.reason) counts[eligibility.reason] += 1;
    return counts;
  }, { already_in_plan: 0, outside_grade: 0, below_math_level: 0 });
  const hiddenCatalogTotal = hiddenCatalogCounts.already_in_plan + hiddenCatalogCounts.outside_grade
    + hiddenCatalogCounts.below_math_level + prerequisiteBlockedIds.size;
  const subjects = [...new Set(courses.map((course) => course.subject))];
  const latestTranscriptSource = sources.find(
    (source) => !source.is_official && source.document_type === "transcript"
  );
  const pendingReviewCount = reviewItems.filter(
    (item) => item.entity_type === "transcript_course"
      && item.status === "pending"
      && item.source_id === latestTranscriptSource?.id
  ).length;
  const courseCounts = {
    completed: planCourses.filter((row) => row.status === "completed").length,
    current: planCourses.filter((row) => row.status === "current").length,
    planned: planCourses.filter((row) => row.status === "planned").length
  };
  const catalogPageSize = 12;
  const catalogPageCount = Math.max(1, Math.ceil(filteredCourses.length / catalogPageSize));
  const visibleCatalogCourses = filteredCourses.slice(catalogPage * catalogPageSize, (catalogPage + 1) * catalogPageSize);
  const selectedDtechCourse = selectedDtechCourseId ? courseMap.get(selectedDtechCourseId) ?? null : null;
  const selectedDtechEvaluation = selectedDtechCourse
    ? evaluateDtechPlannerPrerequisites(
        selectedDtechCourse,
        dtechDraft,
        courses,
        planCourses,
        plannedSmccdCourses,
        equivalencies
      )
    : null;
  const plannedSmccdMap = new Map(plannedSmccdCourses.map((course) => [course.id, course]));
  const prerequisitePlanChecks = planCourses
    .filter((row) => row.status !== "completed")
    .flatMap((row) => {
      const dtech = row.course_id ? courseMap.get(row.course_id) : null;
      const smccd = row.smccd_course_id ? plannedSmccdMap.get(row.smccd_course_id) : null;
      const evaluation = dtech
        ? evaluateDtechPlannerPrerequisites(
            dtech,
            { gradeLevel: row.grade_level, term: row.term, instanceId: row.id },
            courses,
            planCourses,
            plannedSmccdCourses,
            equivalencies
          )
        : smccd
          ? evaluateSmccdPlannerPrerequisites(
              smccd,
              { gradeLevel: row.grade_level, term: row.term, instanceId: row.id },
              plannedSmccdCourses,
              planCourses,
              courses
            )
          : null;
      if (!evaluation || evaluation.originalTexts.length === 0 || evaluation.result.status === "satisfied") return [];
      const message = evaluation.result.missingCourses[0]?.message
        ?? evaluation.result.orderingViolations[0]?.message
        ?? evaluation.result.evidence.find((item) => item.satisfied !== true)?.message
        ?? "The prerequisite needs review.";
      return [{
        row,
        source: dtech ? "dtech" as const : "smccd" as const,
        courseId: dtech?.id ?? smccd!.id,
        name: dtech?.name ?? `${smccd!.course_code} ${smccd!.title}`,
        status: evaluation.result.status,
        message
      }];
    });

  function renderDashboard() {
    if (!profile) return null;
    const nextTasks = timelineTaskSync.visibleTasks.filter((task) => !task.is_completed).slice(0, 4);
    const requirementSnapshot = progress.map((item) => {
      const applied = appliedCreditBreakdown({ required: Number(item.requirement.credits_required), completed: item.completedCredits, current: item.currentCredits, planned: item.plannedCredits });
      return { item, applied };
    });
    const dashboardCredits = requirementSnapshot.reduce((sum, { applied }) => {
      return { completed: sum.completed + applied.completed, scheduled: sum.scheduled + applied.current + applied.planned, remaining: sum.remaining + applied.remaining };
    }, { completed: 0, scheduled: 0, remaining: 0 });
    const overviewRequirements = requirementSnapshot
      .map(({ item, applied }) => ({
        id: item.requirement.id,
        name: item.requirement.name,
        remaining: applied.remaining
      }))
      .sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name));
    const overviewCourse = (row: PlanCourse) => {
      const collegeCode = row.smccd_course_id ? plannedSmccdMap.get(row.smccd_course_id)?.college_code : null;
      return {
        id: row.id,
        name: courseDisplayName(row, courseMap),
        source: collegeCode ?? (row.smccd_course_id ? "SMCCD" : "d.tech"),
        institution: collegeCode ?? (row.smccd_course_id ? "smccd" : "dtech")
      };
    };
    const overviewData: OverviewPathData = {
      earnedPercent: graduationEarnedPercent,
      completedCredits: dashboardCredits.completed,
      scheduledCredits: dashboardCredits.scheduled,
      projectedWeightedGpa: formatGpa(gpa.projectedWeighted),
      knownWeeklyHours: workload?.knownWeeklyHours ?? null,
      workloadWarning: workload?.warning ?? null,
      requirements: overviewRequirements,
      currentCourses: planCourses.filter((row) => row.status === "current").map(overviewCourse),
      plannedCourses: planCourses.filter((row) => row.status === "planned").map(overviewCourse),
      courseCounts,
      tasks: nextTasks.map((task) => ({ id: task.id, title: task.title, detail: task.due_label ?? titleCase(task.category) })),
      summary: null
    };
    return (
      <div className="dashboard-page page-frame">
        <PageHeader title={profile.preferred_name ? `Good to see you, ${profile.preferred_name}` : "Planning overview"} description="What is done, what needs attention, and how the current plan fits." />
        <OverviewPath
          data={overviewData}
          onOpenGraduation={() => navigate("graduation")}
          onOpenCourses={() => openCourses("mine")}
          onOpenTimeline={() => navigate("timeline")}
          onOpenProfile={() => navigate("profile")}
          onGenerateTimeline={() => void generateTasks()}
          onCompleteTask={(id) => void updateTask(id, { is_completed: true })}
        />
        {session && <CodexReviewPanel session={session} focus="plan" title="Review the whole path" description="Codex can connect the deterministic trackers into a readable review. Every input and event remains inspectable below." question="Review my current academic and workload path. Identify the most important gap, one sequencing risk, one capacity concern, and the next actions I should review." context={{ overview: overviewData, profile: { grade: profile.grade_level, graduation_year: profile.graduation_year, direction: profile.major_direction, interests: profile.academic_interests, work_values: profile.work_values }, prerequisite_checks: prerequisitePlanChecks.map((check) => ({ course: check.name, status: check.status, message: check.message })) }} onNavigate={navigateFromReview} />}
      </div>
    );
  }

  function renderProfile() {
    if (!profile || !school || !session) return null;
    const matchingGrade = profile.grade_level as GradeLevel;
    const matchingCourseCount = courses.filter((course) => {
      if ((courseFits.get(course.id)?.score ?? 0) <= 0) return false;
      if (!dtechCatalogEligibility(course, matchingGrade, planCourses, courses).eligible) return false;
      return evaluateDtechPlannerPrerequisites(
        course,
        defaultDtechPlacement(course, matchingGrade),
        courses,
        planCourses,
        plannedSmccdCourses,
        equivalencies
      ).result.status !== "blocked";
    }).length;
    const profileContext = {
      broad_direction: profile.major_direction,
      academic_interests: profile.academic_interests,
      career_interest_areas: profile.career_interest_areas,
      work_values: profile.work_values,
      career_ideas: profile.career_direction,
      exploration_questions: profile.exploration_questions,
      planning_limits: {
        priority: profile.goal_intensity,
        demanding_course_limit: workload?.demandingCourseLimit ?? null,
        weekly_commitment_limit: profile.weekly_commitment_limit,
        current_stress: profile.stress_level,
        known_weekly_hours: workload?.knownWeeklyHours ?? null
      }
    };
    return (
      <div className="profile-page page-frame">
        <PlanningPreferences
          session={session}
          profile={profile}
          schoolName={school.name}
          matchingCourseCount={matchingCourseCount}
          workload={workload}
          busy={Boolean(busyLabel)}
          onChange={setProfile}
          onSave={savePlanningPreferences}
          onReviewSetup={() => setReplayingOnboarding(true)}
          onNavigate={(destination) => navigate(destination)}
        />
        <details className="focused-ai-review">
          <summary><Sparkle size={15} /> Optional Codex review</summary>
          <CodexReviewPanel
            session={session}
            focus="profile"
            title="Check the planning brief"
            description="Codex can surface one useful experiment or one missing constraint. It does not diagnose interests or choose a major."
            question="Review this planning brief. Give one direct interpretation, up to three evidence-backed observations, and one low-risk next experiment."
            context={profileContext}
            onNavigate={navigateFromReview}
            compact
          />
        </details>
      </div>
    );
  }
  function renderSources() {
    const latestTranscript = sources.find((source) => !source.is_official && source.document_type === "transcript") ?? null;
    const importedIds = new Set(planCourses.map((row) => row.source_review_item_id).filter(Boolean));
    const transcriptItems = reviewItems.filter(
      (item) => item.entity_type === "transcript_course"
        && item.status !== "rejected"
        && (!latestTranscript || item.source_id === latestTranscript.id)
    );
    const transcriptNote = reviewItems.find(
      (item) => item.entity_type === "transcript_note" && item.source_id === latestTranscript?.id
    );
    const transcriptSummary = String((transcriptNote?.corrected_payload ?? transcriptNote?.proposed_payload)?.summary ?? "").trim();
    const availableItems = transcriptItems.filter((item) => !importedIds.has(item.id));
    const selectedCount = availableItems.filter((item) => selectedTranscriptIds.has(item.id)).length;
    const allSelected = availableItems.length > 0 && selectedCount === availableItems.length;
    const toggleAll = () => setSelectedTranscriptIds((current) => {
      const next = new Set(current);
      if (allSelected) availableItems.forEach((item) => next.delete(item.id));
      else availableItems.forEach((item) => next.add(item.id));
      return next;
    });
    return (
      <div className="transcript-import-page">
        <PageHeader title="Transcript import" description="Upload a transcript, check the courses, then import them to Done." />
        <form className="transcript-upload" onSubmit={submitTranscript}>
          <div className="transcript-upload-row">
            <label className="transcript-upload-control" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setSourceForm((current) => ({ ...current, file: event.dataTransfer.files.item(0) })); }}>
              <span className="transcript-file-name">{sourceForm.file?.name ?? "Drop transcript here"}</span>
              <span className="transcript-file-action">Choose file</span>
              <input aria-label="Transcript file" type="file" accept=".pdf,.docx,.txt,.csv,.png,.jpg,.jpeg,.webp" onChange={(event) => setSourceForm((current) => ({ ...current, file: event.target.files?.[0] ?? null }))} />
            </label>
            <button className="primary-button transcript-read-button" type="submit" disabled={Boolean(busyLabel) || (!sourceForm.file && !sourceForm.rawText.trim())}>
              <FileArrowUp size={17} /> {busyLabel === "Reading transcript" ? "Reading" : "Read transcript"}
            </button>
          </div>
          <details className="transcript-paste">
            <summary>Paste transcript text instead</summary>
            <label className="form-field"><span>Transcript text</span><textarea value={sourceForm.rawText} onChange={(event) => setSourceForm((current) => ({ ...current, rawText: event.target.value }))} placeholder="Paste completed course rows, grades, credits, and school years." /></label>
          </details>
          <p className="transcript-parser-note">Readable document text is parsed locally. Codex is only used for image-only files. <button type="button" onClick={() => navigate("ai_status")}>Check AI connection</button></p>
        </form>

        {latestTranscript && <div className={`transcript-source-status ${latestTranscript.error_message ? "error" : ""}`}>
          <span><strong>{latestTranscript.title}</strong><small>{latestTranscript.parse_status === "processing" ? "Reading transcript" : latestTranscript.parse_status === "needs_review" || latestTranscript.parse_status === "complete" ? "Ready to review" : titleCase(latestTranscript.parse_status)}</small></span>
          {latestTranscript.error_message && <small>{latestTranscript.error_message}</small>}
          {latestTranscript.parse_status !== "processing" && transcriptItems.length === 0 && <button className="secondary-button small" type="button" onClick={() => void parseSource(latestTranscript)} disabled={Boolean(busyLabel)}><ArrowClockwise size={15} /> Read again</button>}
        </div>}
        {sourceAiTransparency && <TranscriptAiRunDetails run={sourceAiTransparency} />}
        {transcriptItems.length > 0 ? <section className="transcript-results" aria-labelledby="transcript-results-title">
          {transcriptSummary && <p className="transcript-result-summary">{transcriptSummary}</p>}
          <header className="transcript-results-heading">
            <div><h2 id="transcript-results-title">Courses found</h2><p>{availableItems.length ? `${selectedCount} of ${availableItems.length} selected` : "All courses imported"}</p></div>
            {availableItems.length > 0
              ? <button className="primary-button" type="button" onClick={() => void importSelectedTranscriptCourses(latestTranscript?.id ?? null)} disabled={Boolean(busyLabel) || selectedCount === 0}><Check size={17} /> Import selected</button>
              : <button className="secondary-button" type="button" onClick={() => openCourses("mine")}><BookOpen size={17} /> Open Done</button>}
          </header>
          <div className="transcript-course-table" role="table" aria-label="Extracted transcript courses">
            <div className="transcript-course-head" role="row">
              <span role="columnheader"><input type="checkbox" aria-label="Select all courses" checked={allSelected} onChange={toggleAll} disabled={availableItems.length === 0} /> Course</span>
              <span role="columnheader">Grade</span><span role="columnheader">Credits</span><span role="columnheader">Year</span><span role="columnheader">Status</span>
            </div>
            <div className="transcript-course-rows">{transcriptItems.map((item) => {
            const draft = reviewDrafts[item.id] ?? JSON.stringify(item.corrected_payload ?? item.proposed_payload, null, 2);
            const displayPayload = item.corrected_payload ?? item.proposed_payload;
            const transcriptPayload = displayPayload as unknown as TranscriptCoursePayload;
            const resolution = resolveTranscriptCourse(transcriptPayload, courses);
            const visibleNotes = visibleTranscriptUncertaintyNotes(transcriptPayload, item.uncertainty_notes, courses);
            const imported = importedIds.has(item.id);
            const selected = selectedTranscriptIds.has(item.id);
            const name = String(displayPayload.matched_course_name ?? displayPayload.matched_smccd_course_name ?? displayPayload.course_name ?? "Course name needs review");
            const institution = String(displayPayload.institution_name ?? "").trim();
            const institutionKey = institutionKeyFromName(institution);
            const classificationDetail = resolution.classification === "dtech_intersession"
              ? "Intersession · Pass/fail · Personal Development"
              : resolution.classification === "dtech_catalog" && !displayPayload.matched_course_id
                ? `Catalog match: ${resolution.matchedCourse?.name ?? "d.tech course"}`
                : "";
            const courseDetail = [institution, classificationDetail].filter(Boolean).join(" · ");
            const grade = String(displayPayload.letter_grade ?? "Review");
            const credits = displayPayload.credits ?? displayPayload.college_units ?? "Review";
            const year = String(displayPayload.school_year ?? (displayPayload.grade_level ? `Grade ${displayPayload.grade_level}` : "Review"));
            const needsReview = visibleNotes.length > 0 || (item.confidence === "uncertain" && !resolution.identityResolved);
            const status = imported ? "Imported" : resolution.classification === "dtech_intersession" ? "Intersession" : needsReview ? "Review" : "Ready";
            return <article className="transcript-course-item" role="rowgroup" key={item.id}>
              <div className="transcript-course-row" role="row">
                <span className="transcript-course-name" role="cell"><input type="checkbox" aria-label={`Select ${name}`} checked={imported || selected} disabled={imported} onChange={() => setSelectedTranscriptIds((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} />{institutionKey && <InstitutionMark institution={institutionKey} decorative />}<span><strong>{name}</strong>{courseDetail && <small>{courseDetail}</small>}</span></span>
                <span role="cell" data-label="Grade">{grade}</span><span role="cell" data-label="Credits">{String(credits)}</span><span role="cell" data-label="Year">{year}</span><span role="cell" data-label="Status" className={imported ? "transcript-imported" : needsReview ? "transcript-review-needed" : resolution.classification === "dtech_intersession" ? "transcript-intersession-ready" : ""}>{status}</span>
              </div>
              {visibleNotes.length > 0 && <p className="transcript-row-warning">{visibleNotes.join(" ")}</p>}
              {!imported && <details className="transcript-row-editor"><summary>Edit extracted data</summary><label className="form-field"><span>Structured transcript data</span><textarea className="code-editor" value={draft} onChange={(event) => setReviewDrafts((current) => ({ ...current, [item.id]: event.target.value }))} spellCheck={false} /><small className="form-hint">Changes are saved when this row is imported.</small></label><button className="quiet-button small" type="button" onClick={() => void saveReview(item, "rejected")} disabled={Boolean(busyLabel)}><X size={15} /> Ignore row</button></details>}
            </article>;
          })}</div>
          </div>
        </section> : <p className="transcript-empty">Upload a transcript to review completed courses here.</p>}
      </div>
    );
  }

  function renderDtechCatalog() {
    const results = visibleCatalogCourses.map((course) => {
      const placement = course.id === selectedDtechCourse?.id ? dtechDraft : defaultDtechPlacement(course, activeCatalogGrade);
      const evaluation = evaluateDtechPlannerPrerequisites(
        course,
        placement,
        courses,
        planCourses,
        plannedSmccdCourses,
        equivalencies
      );
      const readiness = prerequisiteDisplay(evaluation);
      return {
        id: course.id,
        title: course.name,
        metadata: [
          course.subject,
          `Grade ${activeCatalogGrade}`,
          course.credits ? formatCredits(course.credits) : "Credits to verify"
        ],
        readinessLabel: readiness.label,
        readinessTone: readiness.tone
      };
    });
    const selectedReasons = selectedDtechCourse
      ? (courseFits.get(selectedDtechCourse.id)?.reasons ?? []).filter((reason) => !reason.toLowerCase().includes("subject match"))
      : [];

    return (
      <CourseCatalogBrowser
        source="dtech"
        title="Course catalog"
        description="Courses you can still add in the selected school year."
        countLabel={filteredCourses.length ? `${catalogPage * catalogPageSize + 1}-${Math.min((catalogPage + 1) * catalogPageSize, filteredCourses.length)} of ${filteredCourses.length}` : "No courses"}
        planningContext={`Planning Grade ${activeCatalogGrade}`}
        hiddenSummary={`${hiddenCatalogTotal} unavailable courses hidden from this view`}
        filters={<>
          <label className="catalog-search-field"><span>Search courses</span><div className="catalog-search-input"><BookOpen size={16} aria-hidden /><input value={catalogSearch} onChange={(event) => { setCatalogSearch(event.target.value); setCatalogPage(0); }} placeholder="Name, subject, or prerequisite" /></div></label>
          <label><span>Subject</span><select value={catalogSubject} onChange={(event) => { setCatalogSubject(event.target.value); setCatalogPage(0); }}><option value="all">All subjects</option>{subjects.map((subject) => <option value={subject} key={subject}>{subject}</option>)}</select></label>
          <label><span>Planning year</span><select value={activeCatalogGrade} onChange={(event) => { setCatalogGrade(Number(event.target.value) as GradeLevel); setSelectedDtechCourseId(null); setCatalogPage(0); }}>{availableCatalogGrades.map((grade) => <option value={grade} key={grade}>Grade {grade}</option>)}</select></label>
        </>}
        results={results}
        selectedId={selectedDtechCourseId}
        onSelect={(id) => { const course = courseMap.get(id); if (course) chooseDtechCourse(course); }}
        emptyTitle="No matching courses"
        emptyBody="Try another search or subject. Courses already taken, below your demonstrated math level, outside this grade, or blocked by prerequisites stay hidden."
        sourceAction={<strong className="catalog-source-count">Official 2025-26</strong>}
        footer={<PaginationControls page={catalogPage} pageCount={catalogPageCount} onChange={setCatalogPage} label="Course catalog pages" />}
        detail={selectedDtechCourse && selectedDtechEvaluation ? <div className="catalog-course-detail">
          <header className="catalog-detail-heading"><span>d.tech</span><h3>{selectedDtechCourse.name}</h3></header>
          <dl className="catalog-fact-grid">
            <div><dt>Subject</dt><dd>{selectedDtechCourse.subject}</dd></div>
            <div><dt>Credits</dt><dd>{selectedDtechCourse.credits ? formatCredits(selectedDtechCourse.credits) : "Verify"}</dd></div>
            <div><dt>Grades</dt><dd>{selectedDtechCourse.grade_levels.join(", ") || "Verify"}</dd></div>
            <div><dt>Course type</dt><dd>{selectedDtechCourse.is_honors ? "Honors option" : selectedDtechCourse.is_weighted ? "Weighted" : "Standard"}</dd></div>
          </dl>
          {selectedReasons.length > 0 && <p className="catalog-fit-note"><strong>Profile fit</strong>{selectedReasons.join("; ")}</p>}
          {selectedDtechCourse.description && <p className="catalog-course-description">{selectedDtechCourse.description}</p>}
          <PrerequisiteReadout evaluation={selectedDtechEvaluation} />
          <form className="catalog-plan-controls" onSubmit={(event) => { event.preventDefault(); void addCatalogCourse(selectedDtechCourse, "planned", dtechDraft); }}>
            <label><span>School year</span><select value={dtechDraft.gradeLevel} disabled><option value={dtechDraft.gradeLevel}>Grade {dtechDraft.gradeLevel}</option></select></label>
            <label><span>Term</span><select value={dtechDraft.term} onChange={(event) => setDtechDraft({ ...dtechDraft, term: event.target.value as PlanCourse["term"] })} disabled={selectedDtechCourse.term_type !== "semester"}>{selectedDtechCourse.term_type === "semester" ? <><option value="fall">Fall</option><option value="spring">Spring</option></> : <option value="full_year">Full year</option>}</select></label>
            <button className="primary-button" type="submit"><Plus size={16} /> Add to plan</button>
          </form>
        </div> : <div className="catalog-detail-empty"><BookOpen size={20} aria-hidden /><strong>Select a d.tech course</strong><p>Review description, fit, prerequisite evidence, and placement before adding it.</p></div>}
      />
    );
  }

  function renderGraduation() {
    if (!profile || !supabase || !session) return null;
    return (
      <div className="graduation-page page-frame">
        <PageHeader title="Graduation" description="One source-backed view of diploma progress, A-G readiness, and the selected associate degree." />
        <GraduationWorkspace
          supabase={supabase}
          session={session}
          progress={progress}
          planCourses={planCourses}
          courses={courses}
          smccdCourses={plannedSmccdCourses}
          equivalencies={equivalencies}
          onFindDtechCourses={openRequirementCourses}
          onOpenDtechCatalog={() => openCourses("dtech")}
          onOpenSmccdDegree={() => openCourses("smccd", "degree")}
        />
      </div>
    );
  }

  function renderGpa() {
    const gradedRows = planCourses.filter((row) => row.letter_grade && !["IP", "P"].includes(row.letter_grade.toUpperCase()));
    const gpaContext = {
      lens: gpaLens,
      dtech_transcript_method: { current_unweighted: gpa.currentUnweighted, current_weighted: gpa.currentWeighted, projected_unweighted: gpa.projectedUnweighted, projected_weighted: gpa.projectedWeighted, graded_credits: gpa.gradedCredits, weighted_credits: gpa.weightedCredits, pass_credits_excluded: gpa.passCredits },
      uc_planning_method: ucGpa,
      graded_courses: gradedRows.map((row) => ({ name: courseDisplayName(row, courseMap), grade_level: row.grade_level, status: row.status, grade: row.letter_grade, credits: row.credits, weighted: row.is_weighted || Boolean(row.smccd_course_id), verified: row.mapping_verified }))
    };
    return (
      <div className="gpa-page page-frame">
        <PageHeader title="GPA lenses" description="See the same coursework through the transcript method and a conservative UC planning method." />
        <WorkspaceTabs items={[{ id: "transcript", label: "d.tech transcript" }, { id: "uc", label: "UC planning estimate" }]} value={gpaLens} onChange={setGpaLens} label="GPA calculation methods" layoutId="gpa-lens-indicator" className="gpa-lens-tabs" />
        {gpaLens === "transcript" ? <AnimatedContent className="gpa-lens-workspace" key="transcript">
          <section className="gpa-answer" aria-label="d.tech transcript GPA">
            <div><span>Current weighted GPA</span><strong>{formatGpa(gpa.currentWeighted)}</strong><p>Matches completed graded coursework using the transcript legend.</p></div>
            <dl><div><dt>Current unweighted</dt><dd>{formatGpa(gpa.currentUnweighted)}</dd></div><div><dt>Projected weighted</dt><dd>{formatGpa(gpa.projectedWeighted)}</dd></div><div><dt>Projected unweighted</dt><dd>{formatGpa(gpa.projectedUnweighted)}</dd></div></dl>
          </section>
          <div className="gpa-evidence-strip"><Gauge size={18} /><span><strong>Method:</strong> plus and minus marks do not change grade points. d.tech Honors and SMCCD courses receive one added point. Pass marks do not enter GPA.</span><small>{gpa.gradedCredits} graded credits · {gpa.weightedCredits} weighted · {gpa.passCredits} pass credits excluded</small></div>
        </AnimatedContent> : <AnimatedContent className="gpa-lens-workspace" key="uc">
          <section className="gpa-answer uc" aria-label="UC GPA planning estimate">
            <div><span>UC capped weighted estimate</span><strong>{formatGpa(ucGpa.cappedWeighted)}</strong><p>Completed, verified d.tech A-G courses from grades 10 and 11 only.</p></div>
            <dl><div><dt>Unweighted</dt><dd>{formatGpa(ucGpa.unweighted)}</dd></div><div><dt>Course semesters</dt><dd>{ucGpa.courseSemesters}</dd></div><div><dt>Honors semesters used</dt><dd>{ucGpa.honorsSemestersUsed} / 8</dd></div></dl>
          </section>
          <div className={`gpa-evidence-strip ${ucGpa.unresolvedCourses ? "warning" : ""}`}><Warning size={18} /><span><strong>Conservative by design:</strong> custom and college courses stay out until an exact reviewed A-G link exists. UC honors points are capped at eight semesters, with no more than four from grade 10.</span><small>{ucGpa.unresolvedCourses} graded {ucGpa.unresolvedCourses === 1 ? "course needs" : "courses need"} A-G verification</small></div>
        </AnimatedContent>}
        <details className="gpa-course-details">
          <summary><span><strong>Course calculation details</strong><small>{gradedRows.length} graded courses with exact transcript marks</small></span><CaretDown size={16} /></summary>
          <div className="gpa-course-details-body">
            <div className="gpa-course-details-action"><p>Review the grades, credits, and weighting used in the calculation.</p><button className="secondary-button small" type="button" onClick={() => openCourses("mine")}>Open Done courses</button></div>
            {gradedRows.length ? <div className="grade-table"><div className="grade-table-head"><span>Course</span><span>Status</span><span>Grade points</span><span>Credits</span><span>Weight</span></div>{gradedRows.map((row) => { const points = dtechGradePoint(row.letter_grade); return <div className="grade-table-row" key={row.id}><strong>{courseDisplayName(row, courseMap)}</strong><span>{titleCase(row.status)}</span><span>{row.letter_grade} = {points?.toFixed(1)}</span><span>{row.credits ?? "Verify"}</span><span>{row.is_weighted || row.smccd_course_id || Number(row.college_units ?? 0) > 0 ? "Weighted" : "Standard"}</span></div>; })}</div> : <EmptyState title="No graded courses" body="Add completed or current courses and enter grades in the planner." />}
          </div>
        </details>
        {session && <CodexReviewPanel session={session} focus="gpa" title="Audit this GPA lens" description="Ask Codex to look for missing evidence or confusing assumptions. The calculation itself remains deterministic." question={`Audit the ${gpaLens === "transcript" ? "d.tech transcript" : "UC planning"} GPA lens. Explain what is supported, what is excluded, and what I should verify.`} context={gpaContext} onNavigate={navigateFromReview} compact />}
      </div>
    );
  }

  function renderMineCourses() {
    if (!profile) return null;
    const snapshots = versions.filter((version) => version.kind === "snapshot");
    const selectedSnapshot = snapshots.find((version) => version.id === compareVersionId) ?? null;
    const comparisonKey = (row: PlanCourse) => `${row.course_id ?? row.custom_course_name ?? row.id}:${row.grade_level}`;
    const activeByKey = new Map(planCourses.map((row) => [comparisonKey(row), row]));
    const snapshotByKey = new Map(compareCourses.map((row) => [comparisonKey(row), row]));
    const addedSinceSnapshot = planCourses.filter((row) => !snapshotByKey.has(comparisonKey(row)));
    const removedSinceSnapshot = compareCourses.filter((row) => !activeByKey.has(comparisonKey(row)));
    const changedSinceSnapshot = planCourses.filter((row) => {
      const previous = snapshotByKey.get(comparisonKey(row));
      return previous && (
        previous.status !== row.status ||
        previous.letter_grade !== row.letter_grade ||
        previous.is_weighted !== row.is_weighted ||
        Number(previous.credits ?? 0) !== Number(row.credits ?? 0)
      );
    });
    const snapshotGpa = calculateGpa(compareCourses);
    const snapshotProgress = calculateRequirementProgress(requirements, compareCourses, mappings, courses, equivalencies);

    return (
      <>
        {planExplanation && <p className="plan-explanation">{planExplanation}</p>}
        <CourseKanban
          rows={planCourses}
          courses={courses}
          smccdCourses={plannedSmccdCourses}
          profile={profile}
          editingCourseId={editingCourseId}
          busy={Boolean(busyLabel)}
          onEditingChange={setEditingCourseId}
          onMove={movePlanCourse}
          onUpdate={(id, patch) => void updatePlanCourse(id, patch)}
          onRemove={(id) => void removePlanCourse(id)}
          onGeneratePlan={() => void generatePlan()}
          onImportTranscript={() => navigate("sources")}
          onBrowseCourses={() => setCourseArea("dtech")}
        />
        <details className="course-version-section">
          <summary><span><strong>Plan versions</strong><small>Save a read-only copy before a major change.</small></span><span>{snapshots.length} saved</span></summary>
          <div className="course-version-body"><button className="secondary-button small" onClick={() => void saveSnapshot()} disabled={Boolean(busyLabel)}><FloppyDisk size={15} /> Save snapshot</button>
          {snapshots.length ? <>
            <div className="compare-controls"><label className="form-field"><span>Saved version</span><select value={compareVersionId} onChange={(event) => void selectComparisonVersion(event.target.value)}><option value="">Choose a snapshot</option>{snapshots.map((version) => <option value={version.id} key={version.id}>{version.label}</option>)}</select></label><p>{compareVersionId ? "The saved copy stays read-only. Differences below are measured against your active plan." : "Choose a saved snapshot."}</p></div>
            {selectedSnapshot && !compareLoading && <div className="snapshot-comparison" aria-live="polite">
              <div className="snapshot-metrics"><div><span>Saved courses</span><strong>{compareCourses.length}</strong></div><div><span>Active courses</span><strong>{planCourses.length}</strong></div><div><span>Saved coverage</span><strong>{overallGraduationPercent(snapshotProgress)}%</strong></div><div><span>Active coverage</span><strong>{graduationPercent}%</strong></div><div><span>Saved projected GPA</span><strong>{formatGpa(snapshotGpa.projectedWeighted)}</strong></div><div><span>Active projected GPA</span><strong>{formatGpa(gpa.projectedWeighted)}</strong></div></div>
              <div className="snapshot-differences">
                <div><h3>Added since snapshot <span>{addedSinceSnapshot.length}</span></h3>{addedSinceSnapshot.length ? <ul>{addedSinceSnapshot.map((row) => <li key={row.id}>{courseDisplayName(row, courseMap)} <small>Grade {row.grade_level}</small></li>)}</ul> : <p>None</p>}</div>
                <div><h3>Removed since snapshot <span>{removedSinceSnapshot.length}</span></h3>{removedSinceSnapshot.length ? <ul>{removedSinceSnapshot.map((row) => <li key={row.id}>{courseDisplayName(row, courseMap)} <small>Grade {row.grade_level}</small></li>)}</ul> : <p>None</p>}</div>
                <div><h3>Changed since snapshot <span>{changedSinceSnapshot.length}</span></h3>{changedSinceSnapshot.length ? <ul>{changedSinceSnapshot.map((row) => <li key={row.id}>{courseDisplayName(row, courseMap)} <small>Status, grade, credits, or weighting</small></li>)}</ul> : <p>None</p>}</div>
              </div>
            </div>}
            {compareLoading && <p className="compare-loading"><ArrowClockwise className="spin" size={16} /> Loading saved courses</p>}
          </> : <p className="course-version-empty">No saved versions yet.</p>}</div>
        </details>
      </>
    );
  }

  function renderCourses() {
    if (!supabase || !session || !profile || !activeVersion) return null;
    return <div className="courses-page page-frame wide">
      <PageHeader title="Courses" description="A board for finished work, current classes, and what comes next." actions={courseArea === "mine" && <><button className="secondary-button" type="button" onClick={() => navigate("sources")}><FileArrowUp size={17} /> Import transcript</button><button className="primary-button" type="button" onClick={() => setCourseArea("dtech")}><Plus size={17} /> Add courses</button></>} />
      <WorkspaceTabs className="course-workspace-tabs" items={[{ id: "mine", label: "My plan" }, { id: "dtech", label: "d.tech courses" }, { id: "smccd", label: "College courses" }]} value={courseArea} onChange={(area) => { setCourseArea(area); if (area === "smccd") setSmccdInitialSection("courses"); setEditingCourseId(null); }} label="Courses workspace" layoutId="course-area-indicator" />
      {courseArea === "mine" ? renderMineCourses() : courseArea === "dtech" ? renderDtechCatalog() : <SmccdPlanner
        embedded
        supabase={supabase}
        session={session}
        profile={profile}
        activeVersion={activeVersion}
        planCourses={planCourses}
        equivalencies={equivalencies}
        initialSection={smccdInitialSection}
        focusCourseId={focusedSmccdCourseId}
        onCourseAdded={(course, catalogCourse) => {
          setPlanCourses((current) => [...current, course]);
          if (catalogCourse) setPlannedSmccdCourses((current) => current.some((item) => item.id === catalogCourse.id) ? current : [...current, catalogCourse]);
        }}
        onCourseRemoved={(id) => setPlanCourses((current) => current.filter((row) => row.id !== id))}
        onOpenMyCourses={() => setCourseArea("mine")}
      />}
    </div>;
  }

  function renderAiStatus() {
    return session ? <AiStatusPanel session={session} /> : null;
  }

  function renderActivities() {
    if (!session || !profile) return null;
    const activitiesContext = {
      capacity: {
        weekly_limit: profile.weekly_commitment_limit,
        known_weekly_hours: workload?.knownWeeklyHours ?? null,
        activity_hours: workload?.weeklyActivityHours ?? null
      },
      experiences: activities.map((activity) => ({
        name: activity.name,
        type: activity.kind,
        role: activity.role,
        organization: activity.organization,
        hours_per_week: activity.weekly_hours,
        weeks_per_year: activity.weeks_per_year,
        grades: [activity.start_grade, activity.end_grade],
        active: activity.is_active,
        description: activity.description,
        contribution_or_growth: activity.impact
      }))
    };
    return (
      <div className="activities-page page-frame">
        <ExperienceLog
          session={session}
          activities={activities}
          currentGrade={profile.grade_level ?? 9}
          workload={workload}
          busy={Boolean(busyLabel)}
          onSave={saveActivity}
          onRemove={removeActivity}
          onNavigate={() => navigate("profile")}
        />
        <details className="focused-ai-review">
          <summary><Sparkle size={15} /> Optional Codex review</summary>
          <CodexReviewPanel
            session={session}
            focus="activities"
            title="Check the experience record"
            description="Codex can identify one missing fact or one workload concern. It never ranks the student or inflates an experience."
            question="Review this experience record. Give one direct answer, up to three evidence-backed observations, and one useful next edit."
            context={activitiesContext}
            onNavigate={navigateFromReview}
            compact
          />
        </details>
      </div>
    );
  }
  function renderTimeline() {
    if (!session || !profile) return null;
    const courseChecks: CourseCheck[] = prerequisitePlanChecks.map((check) => ({
      id: check.row.id,
      name: check.name,
      status: check.status === "blocked" ? "blocked" : "needs_review",
      message: check.message,
      source: check.source,
      courseId: check.courseId
    }));
    const openRequirements = progress
      .filter((item) => item.status === "missing")
      .map((item) => ({
        id: item.requirement.id,
        name: item.requirement.name,
        remainingCredits: Math.max(0, item.requirement.credits_required - item.verifiedProjectedCredits)
      }));
    const visibleTasks = timelineTaskSync.visibleTasks;
    const openTasks = visibleTasks.filter((task) => !task.is_completed);
    const timelineContext = {
      current_grade: profile.grade_level,
      graduation_year: profile.graduation_year,
      open_requirement_areas: openRequirements,
      prerequisite_checks: courseChecks.map(({ name, status, message }) => ({ name, status, message })),
      open_steps: openTasks.map((task) => ({
        title: task.title,
        timing: task.due_label,
        source: task.is_generated ? "current plan" : "student",
        rationale: task.explanation
      }))
    };
    const openCourseCheck = (check: CourseCheck) => {
      if (check.source === "dtech") {
        const course = courseMap.get(check.courseId);
        if (course) chooseDtechCourse(course);
      } else {
        setFocusedSmccdCourseId(check.courseId);
      }
      setCourseArea(check.source);
      setView("courses");
    };
    return (
      <div className="timeline-page page-frame">
        <NextSteps
          session={session}
          tasks={visibleTasks}
          currentGrade={profile.grade_level ?? 9}
          graduationYear={profile.graduation_year}
          openRequirements={openRequirements}
          courseChecks={courseChecks}
          busy={Boolean(busyLabel)}
          onSync={generateTasks}
          onAdd={addCustomTask}
          onUpdate={updateTask}
          onDelete={deleteTask}
          onOpenCourseCheck={openCourseCheck}
          onNavigate={(destination) => navigate(destination)}
        />
        <details className="focused-ai-review">
          <summary><Sparkle size={15} /> Optional Codex review</summary>
          <CodexReviewPanel
            session={session}
            focus="timeline"
            title="Check the order"
            description="Codex can point out one dependency or one vague step. The saved queue stays under your control."
            question="Review this next-step queue. Give one direct priority judgment, up to three evidence-backed observations, and one next action."
            context={timelineContext}
            onNavigate={navigateFromReview}
            compact
          />
        </details>
      </div>
    );
  }
  function renderSimulator() {
    if (!profile || !session) return null;
    const freshSimulationResult = simulationBasis === currentSimulationBasis ? simulationResult : null;
    const scenarioContext = freshSimulationResult ? {
      proposed_change: {
        additional_smccd_units: simulationConfig.collegeUnits,
        activity_hours_change: simulationConfig.activityHoursChange
      },
      current_week: freshSimulationResult.current,
      proposed_week: freshSimulationResult.simulated,
      deterministic_changes: freshSimulationResult.changes,
      deterministic_limits: freshSimulationResult.risks,
      saved_weekly_limit: profile.weekly_commitment_limit
    } : null;
    return (
      <div className="simulator-page page-frame">
        <LoadCheck
          session={session}
          profile={profile}
          workload={workload}
          config={simulationConfig}
          result={freshSimulationResult}
          busy={Boolean(busyLabel)}
          onConfigChange={(next) => {
            setSimulationConfig(next);
            setSimulationResult(null);
            setSimulationBasis("");
          }}
          onCompare={runSimulation}
          onNavigate={(destination) => navigate(destination)}
        />
        {scenarioContext && <details className="focused-ai-review">
          <summary><Sparkle size={15} /> Optional Codex review</summary>
          <CodexReviewPanel
            session={session}
            focus="scenario"
            title="Check the tradeoff"
            description="The comparison above remains deterministic. Codex can challenge one assumption or identify one question to verify."
            question="Review this weekly load comparison. Give one direct interpretation, up to three evidence-backed observations, and one verification step."
            context={scenarioContext}
            onNavigate={navigateFromReview}
            compact
          />
        </details>}
      </div>
    );
  }
  function renderView() {
    switch (view) {
      case "dashboard": return renderDashboard();
      case "courses": return renderCourses();
      case "profile": return renderProfile();
      case "sources": return renderSources();
      case "graduation": return renderGraduation();
      case "gpa": return renderGpa();
      case "activities": return renderActivities();
      case "timeline": return renderTimeline();
      case "simulator": return renderSimulator();
      case "ai_status": return renderAiStatus();
    }
  }

  return (
    <div className="app-shell">
      <aside className={`app-sidebar ${mobileNavOpen ? "open" : ""}`}>
        <div className="sidebar-top">
          <a className="wordmark" href="/app"><BrandMark /><span>Pilot Princess</span></a>
          <button className="mobile-close icon-button" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>
        <nav className="sidebar-nav" aria-label="Planning workspace">
          {PRIMARY_NAV_ITEMS.map((item) => {
            const NavIcon = item.icon;
            const badge = item.id === "sources" && pendingReviewCount > 0 ? pendingReviewCount : null;
            return <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)} type="button"><NavIcon size={18} weight={view === item.id ? "fill" : "regular"} aria-hidden /><span>{item.label}</span>{badge && <b>{badge}</b>}</button>;
          })}
          <button className={`sidebar-more-toggle ${moreNavOpen ? "open" : ""}`} onClick={() => setMoreNavOpen((current) => !current)} type="button" aria-expanded={moreNavOpen}><CaretDown size={17} /><span>More tools</span></button>
          {moreNavOpen && <div className="sidebar-secondary">{SECONDARY_NAV_ITEMS.map((item) => {
            const NavIcon = item.icon;
            const badge = item.id === "sources" && pendingReviewCount > 0 ? pendingReviewCount : null;
            return <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)} type="button"><NavIcon size={17} weight={view === item.id ? "fill" : "regular"} aria-hidden /><span>{item.label}</span>{badge && <b>{badge}</b>}</button>;
          })}</div>}
        </nav>
        <div className="sidebar-footer">
          <div className="school-chip"><GraduationCap size={18} weight="duotone" /><span><strong>{school.short_name}</strong><small>{school.source_year} sources</small></span></div>
          <button
            className="sidebar-utility"
            data-demo-only="true"
            data-current-placement={DEMO_ONBOARDING_SHORTCUT.currentPlacement}
            data-intended-placement={DEMO_ONBOARDING_SHORTCUT.intendedPlacement}
            onClick={() => {
              setMobileNavOpen(false);
              setReplayingOnboarding(true);
            }}
            type="button"
          >
            <ArrowClockwise size={17} />
            <span>{DEMO_ONBOARDING_SHORTCUT.label}</span>
          </button>
          <button
            className="sidebar-utility"
            data-demo-only="true"
            data-current-placement={DEMO_LOGIN_SHORTCUT.currentPlacement}
            data-intended-placement={DEMO_LOGIN_SHORTCUT.intendedPlacement}
            onClick={() => {
              setMobileNavOpen(false);
              window.location.assign("/?demo=login");
            }}
            type="button"
          >
            <House size={17} />
            <span>{DEMO_LOGIN_SHORTCUT.label}</span>
          </button>
          <button className="sidebar-utility" onClick={toggleTheme} type="button">{theme === "light" ? <Moon size={17} /> : <Sun size={17} />}<span>{theme === "light" ? "Dark mode" : "Light mode"}</span></button>
          <button className="sidebar-utility" onClick={() => void signOut()} type="button"><SignOut size={17} /><span>Sign out</span></button>
        </div>
      </aside>
      {mobileNavOpen && <button className="nav-backdrop" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation overlay" />}
      <main className="app-main">
        <div className="mobile-bar"><button className="icon-button" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><AirplaneTilt size={20} /></button><span>{NAV_ITEMS.find((item) => item.id === view)?.label}</span><button className="icon-button" onClick={toggleTheme} aria-label="Toggle theme">{theme === "light" ? <Moon size={18} /> : <Sun size={18} />}</button></div>
        <div className="app-content"><Suspense fallback={<LoadingWorkspace />}>{renderView()}</Suspense></div>
      </main>
      {toast && <div className={`toast ${toastKind}`} role={toastKind === "error" ? "alert" : "status"}>{busyLabel ? <ArrowClockwise size={16} className="spin" /> : toastKind === "success" ? <Check size={16} /> : toastKind === "error" ? <Warning size={16} /> : null}{toast}</div>}
      {busyLabel && <div className="busy-bar" role="status">{busyLabel}</div>}
    </div>
  );
}
