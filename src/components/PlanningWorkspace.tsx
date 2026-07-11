import {
  ActivityIcon,
  AirplaneTiltIcon as AirplaneTilt,
  ArrowClockwiseIcon as ArrowClockwise,
  BookOpenIcon as BookOpen,
  CaretDownIcon as CaretDown,
  ChartLineUpIcon as ChartLineUp,
  CheckIcon as Check,
  CheckCircleIcon as CheckCircle,
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
  TrashIcon as Trash,
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
  useMemo,
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
  GRADE_LEVELS,
  overallCompletedPercent,
  overallGraduationPercent,
  planCourseMovePatch,
  selectedPlanGrades,
  schoolYearForGrade,
  simulatePlan
} from "@/lib/planning";
import { requirementsForProfile } from "@/lib/planning";
import {
  ACADEMIC_INTEREST_OPTIONS,
  CAREER_INTEREST_AREA_OPTIONS,
  courseProfileFit,
  MAJOR_DIRECTION_OPTIONS,
  majorDirectionLabel,
  WORK_VALUE_OPTIONS
} from "@/lib/profile-planning";
import {
  resolveTranscriptCourse,
  transcriptPlanCourseDraft,
  visibleTranscriptUncertaintyNotes,
  type TranscriptCoursePayload
} from "@/lib/transcript";
import OnboardingFlow from "@/components/OnboardingFlow";
import AiStatusPanel from "@/components/AiStatusPanel";
import CodexReviewPanel, { type ReviewDestination } from "@/components/CodexReviewPanel";
import AnimatedContent from "@/components/reactbits/AnimatedContent";
import CourseCatalogBrowser from "@/components/CourseCatalogBrowser";
import CourseKanban from "@/components/CourseKanban";
import GraduationWorkspace from "@/components/GraduationWorkspace";
import OverviewPath, { type OverviewPathData } from "@/components/OverviewPath";
import PrerequisiteReadout, { prerequisiteDisplay } from "@/components/PrerequisiteReadout";
import SmccdPlanner from "@/components/SmccdPlanner";
import WorkspaceTabs from "@/components/WorkspaceTabs";
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
  { id: "activities", label: "Activities", icon: ActivityIcon },
  { id: "timeline", label: "Timeline", icon: ListChecks },
  { id: "simulator", label: "Simulator", icon: Scales },
  { id: "profile", label: "Student profile", icon: UserCircle },
  { id: "ai_status", label: "AI connection", icon: Cpu }
];

const NAV_ITEMS = [...PRIMARY_NAV_ITEMS, ...SECONDARY_NAV_ITEMS];

// Demo-only placement metadata. The durable product entry point is the
// Student profile "Review setup" action; remove this sidebar shortcut after demos.
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
type ProfileSection = "basics" | "direction" | "capacity";
type GpaLens = "transcript" | "uc";
interface SourceAiTransparency {
  model: string;
  reasoningEffort: string;
  instruction: string;
  input: string;
  toolsUsed: string[];
  filesChanged: string[];
  mutations: string;
}
const DEFAULT_SIMULATION: SimulationConfig = {
  majorDirection: "undecided",
  pathIntensity: "balanced",
  courseStyle: "more_regular",
  activityLoad: "same"
};

function numberValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

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
  const [view, setView] = useState<ViewId>("dashboard");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [moreNavOpen, setMoreNavOpen] = useState(false);
  const [replayingOnboarding, setReplayingOnboarding] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [courseArea, setCourseArea] = useState<CourseArea>("mine");
  const [smccdInitialSection, setSmccdInitialSection] = useState<"courses" | "degree">("courses");
  const [profileSection, setProfileSection] = useState<ProfileSection>("basics");
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
  const [activityForm, setActivityForm] = useState({ name: "", kind: "club", role: "", organization: "", weeklyHours: 2, weeksPerYear: 20, startGrade: 9, endGrade: 12, impact: "", description: "", isActive: true });
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null);
  const [taskForm, setTaskForm] = useState({ title: "", category: "admin", dueLabel: "" });
  const [simulationConfig, setSimulationConfig] = useState<SimulationConfig>(DEFAULT_SIMULATION);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [simulationExplanation, setSimulationExplanation] = useState<string | null>(null);
  const [planExplanation, setPlanExplanation] = useState<string | null>(null);
  const [compareVersionId, setCompareVersionId] = useState("");
  const [compareCourses, setCompareCourses] = useState<PlanCourse[]>([]);
  const [compareLoading, setCompareLoading] = useState(false);

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
      setSimulationConfig((current) => ({
        ...current,
        majorDirection: (MAJOR_DIRECTION_OPTIONS.some((option) => option.value === loadedProfile.major_direction)
          ? loadedProfile.major_direction
          : "undecided") as SimulationConfig["majorDirection"],
        pathIntensity: loadedProfile.goal_intensity
      }));
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
    const currentTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    setTheme(currentTheme);
    void loadWorkspace();
  }, [loadWorkspace]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!supabase || !compareVersionId) {
      setCompareCourses([]);
      return;
    }
    let active = true;
    setCompareLoading(true);
    void supabase
      .from("plan_courses")
      .select("*")
      .eq("plan_version_id", compareVersionId)
      .order("grade_level")
      .order("sort_order")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setToast(error.message);
          setCompareCourses([]);
        } else {
          setCompareCourses((data ?? []) as unknown as PlanCourse[]);
        }
        setCompareLoading(false);
      });
    return () => {
      active = false;
    };
  }, [compareVersionId, supabase]);

  async function runAction<T>(label: string, action: () => Promise<T>, successMessage?: string) {
    setBusyLabel(label);
    try {
      const result = await action();
      if (successMessage) setToast(successMessage);
      return result;
    } catch (caught) {
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

  async function saveProfile() {
    if (!supabase || !profile || !school) return;
    if (!profile.age || !profile.grade_level || !profile.graduation_year || !profile.school_confirmed || !profile.plan_end_grade || !profile.weekly_commitment_limit) {
      setToast("Complete age, grade, graduation year, plan window, weekly commitment limit, and school confirmation.");
      return;
    }
    if (profile.tracker_mode === "selected" && profile.tracked_requirement_areas.length === 0) {
      setToast("Choose at least one graduation requirement area.");
      return;
    }
    await runAction(
      "Saving profile",
      async () => {
        const { error } = await supabase
          .from("student_profiles")
          .update({ ...profile, school_id: school.id, plan_start_grade: profile.grade_level, onboarding_complete: true })
          .eq("id", profile.id);
        if (error) throw error;
        setProfile({ ...profile, school_id: school.id, plan_start_grade: profile.grade_level as GradeLevel, onboarding_complete: true });
        await logEvent("profile_completed");
      },
      "Profile saved."
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
      setToast("That course is already in the current plan.");
      return;
    }
    const grade = placement.gradeLevel;
    const eligibility = dtechCatalogEligibility(course, grade, planCourses, courses);
    if (!eligibility.eligible) {
      setToast(eligibility.reason === "outside_grade"
        ? `${course.name} is not offered for grade ${grade}.`
        : eligibility.reason === "below_math_level"
          ? `${course.name} is below the math level already demonstrated in this plan.`
          : "That course is already represented in the current plan.");
      return;
    }
    const evaluation = evaluateDtechPlannerPrerequisites(course, placement, courses, planCourses, plannedSmccdCourses, equivalencies);
    if (evaluation.result.status === "blocked") {
      setToast("Complete the listed prerequisite before adding this course in that year.");
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
      setToast("Transcript records stay in Done. Correct the transcript review instead of moving them.");
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
      setToast("The current plan already contains the available d.tech flow courses.");
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
      setToast("Choose a transcript file or paste its text.");
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
        setToast(`${String(payload.summary ?? "Transcript review ready.")}${parserNote}`);
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
        setToast(`${String(payload.summary ?? "Source parsing completed.")}${parserNote}`);
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
      setToast("Select at least one course to import.");
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
      setToast(caught instanceof Error ? caught.message : "One corrected row is not valid JSON.");
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

  async function saveActivity(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (!supabase || !session) return;
    const record = {
      user_id: session.user.id,
      name: activityForm.name.trim(),
      kind: activityForm.kind,
      role: activityForm.role.trim() || null,
      organization: activityForm.organization.trim() || null,
      weekly_hours: activityForm.weeklyHours,
      weeks_per_year: activityForm.weeksPerYear,
      start_grade: activityForm.startGrade,
      end_grade: activityForm.endGrade,
      impact: activityForm.impact.trim() || null,
      description: activityForm.description.trim() || null,
      is_active: activityForm.isActive
    };
    await runAction(
      editingActivityId ? "Updating experience" : "Adding experience",
      async () => {
        const query = editingActivityId
          ? supabase.from("activities").update(record).eq("id", editingActivityId)
          : supabase.from("activities").insert(record);
        const { data, error } = await query.select("*").single();
        if (error) throw error;
        const saved = data as unknown as Activity;
        setActivities((current) => editingActivityId ? current.map((activity) => activity.id === saved.id ? saved : activity) : [...current, saved]);
        setActivityForm({ name: "", kind: "club", role: "", organization: "", weeklyHours: 2, weeksPerYear: 20, startGrade: profile?.grade_level ?? 9, endGrade: profile?.grade_level ?? 12, impact: "", description: "", isActive: true });
        setEditingActivityId(null);
        await logEvent(editingActivityId ? "activity_updated" : "activity_added");
      },
      editingActivityId ? "Experience updated." : "Experience added."
    );
  }

  function editActivity(activity: Activity) {
    setEditingActivityId(activity.id);
    setActivityForm({
      name: activity.name,
      kind: activity.kind,
      role: activity.role ?? "",
      organization: activity.organization ?? "",
      weeklyHours: Number(activity.weekly_hours),
      weeksPerYear: Number(activity.weeks_per_year ?? 20),
      startGrade: activity.start_grade ?? profile?.grade_level ?? 9,
      endGrade: activity.end_grade ?? activity.start_grade ?? profile?.grade_level ?? 12,
      impact: activity.impact ?? "",
      description: activity.description ?? "",
      isActive: activity.is_active ?? true
    });
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
    const generated = generateTimeline(profile, progress);
    const existingTitles = new Set(tasks.map((task) => task.title));
    const newTasks = generated.filter((task) => !existingTitles.has(task.title));
    if (newTasks.length === 0) {
      setToast("The generated timeline is already up to date.");
      return;
    }
    await runAction(
      "Generating timeline",
      async () => {
        const { data, error } = await supabase
          .from("timeline_tasks")
          .insert(
            newTasks.map((task) => ({
              ...task,
              user_id: session.user.id,
              plan_version_id: activeVersion?.id ?? null,
              is_generated: true
            }))
          )
          .select("*");
        if (error) throw error;
        setTasks((current) => [...current, ...((data ?? []) as unknown as TimelineTask[])]);
        await logEvent("timeline_generated", { task_count: newTasks.length });
      },
      `${newTasks.length} timeline tasks added.`
    );
  }

  async function addCustomTask(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (!supabase || !session) return;
    await runAction(
      "Adding task",
      async () => {
        const { data, error } = await supabase
          .from("timeline_tasks")
          .insert({
            user_id: session.user.id,
            plan_version_id: activeVersion?.id ?? null,
            title: taskForm.title.trim(),
            category: taskForm.category,
            due_label: taskForm.dueLabel.trim() || null,
            is_generated: false
          })
          .select("*")
          .single();
        if (error) throw error;
        setTasks((current) => [...current, data as unknown as TimelineTask]);
        setTaskForm({ title: "", category: "admin", dueLabel: "" });
      },
      "Task added."
    );
  }

  async function updateTask(id: string, patch: Partial<TimelineTask>) {
    if (!supabase) return;
    const { error } = await supabase.from("timeline_tasks").update(patch).eq("id", id);
    if (error) {
      setToast(error.message);
      return;
    }
    setTasks((current) => current.map((task) => (task.id === id ? { ...task, ...patch } : task)));
    if (patch.is_completed) await logEvent("timeline_task_completed", { task_id: id });
  }

  async function runSimulation() {
    if (!profile || !workload) return;
    const result = simulatePlan(simulationConfig, profile, progress, gpa, workload);
    setSimulationResult(result);
    setSimulationExplanation(null);
    await logEvent("simulation_started", { ai_used: false });
  }

  async function saveSimulation() {
    if (!supabase || !session || !activeVersion || !simulationResult) return;
    await runAction(
      "Saving simulation",
      async () => {
        const { data: config, error: configError } = await supabase
          .from("simulation_configs")
          .insert({
            user_id: session.user.id,
            major_direction: simulationConfig.majorDirection,
            path_intensity: simulationConfig.pathIntensity,
            course_style: simulationConfig.courseStyle,
            activity_load: simulationConfig.activityLoad
          })
          .select("id")
          .single();
        if (configError) throw configError;
        const { error } = await supabase.from("simulations").insert({
          user_id: session.user.id,
          plan_version_id: activeVersion.id,
          config_id: config.id,
          current_result: simulationResult.current,
          simulated_result: simulationResult.simulated,
          explanation: simulationExplanation,
          risks: simulationResult.risks,
          is_saved: true
        });
        if (error) throw error;
        await logEvent("simulation_saved");
      },
      "Simulation saved. Your current plan was not changed."
    );
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
            setToast("Onboarding changes saved.");
          }
        }}
        onExit={replayingOnboarding ? () => {
          setReplayingOnboarding(false);
          setView("profile");
          setToast("Onboarding exited without saving changes.");
        } : undefined}
        onSignOut={signOut}
      />
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
    const nextTasks = tasks.filter((task) => !task.is_completed).slice(0, 4);
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
    if (!profile || !school) return null;
    const standardInterests = new Set<string>(ACADEMIC_INTEREST_OPTIONS);
    const otherInterests = profile.academic_interests.filter((interest) => !standardInterests.has(interest));
    const matchingCourseCount = courses.filter((course) => courseProfileFit(course, profile).score > 0).length;
    const toggleInterest = (interest: string) => {
      const selected = new Set(profile.academic_interests);
      if (selected.has(interest)) selected.delete(interest);
      else selected.add(interest);
      setProfile({ ...profile, academic_interests: [...selected] });
    };
    const toggleProfileList = (field: "career_interest_areas" | "work_values", value: string) => {
      const selected = new Set(profile[field] ?? []);
      if (selected.has(value)) selected.delete(value);
      else selected.add(value);
      setProfile({ ...profile, [field]: [...selected] });
    };
    const profileContext = {
      current_grade: profile.grade_level,
      plan_through_grade: profile.plan_end_grade,
      broad_direction: profile.major_direction,
      academic_interests: profile.academic_interests,
      career_interest_areas: profile.career_interest_areas,
      work_values: profile.work_values,
      career_ideas: profile.career_direction,
      exploration_questions: profile.exploration_questions,
      capacity: { planning_priority: profile.goal_intensity, demanding_course_limit: workload?.demandingCourseLimit ?? null, weekly_commitment_limit: profile.weekly_commitment_limit, current_stress: profile.stress_level, known_weekly_hours: workload?.knownWeeklyHours ?? null }
    };
    const impactRows = profileSection === "basics"
      ? [
          { label: "Plan range", value: `Grade ${profile.grade_level ?? "not set"} through grade ${profile.plan_end_grade ?? 12}.` },
          { label: "Graduation tracker", value: profile.tracker_mode === "full" ? "All eight d.tech requirement areas are tracked." : `${profile.tracked_requirement_areas.length} selected areas are tracked.` }
        ]
      : profileSection === "direction"
        ? [
            { label: "Course discovery", value: `${matchingCourseCount} catalog courses currently match these answers and sort first.` },
            { label: "Degree discovery", value: "Transcript overlap ranks first, followed by direction, interest, and career keyword matches." }
          ]
        : [
            { label: "Workload", value: workload ? `${workload.knownWeeklyHours} known weekly hours and ${workload.demandingCourseCount} demanding ${workload.demandingCourseCount === 1 ? "course is" : "courses are"} compared with these limits.` : "Calculated from active courses and activities." },
            { label: "Simulator", value: `Scenarios start from ${majorDirectionLabel(profile.major_direction)}, stress ${profile.stress_level}, and the saved capacity limits.` }
          ];
    return (
      <div className="profile-page page-frame">
        <PageHeader title="Student compass" description="Record what interests you, what matters to you, and the limits a useful plan must respect." actions={<button className="secondary-button" type="button" onClick={() => setReplayingOnboarding(true)}><ArrowClockwise size={17} /> Review setup</button>} />
        <WorkspaceTabs
          items={[{ id: "basics", label: "School context" }, { id: "direction", label: "Interests and values" }, { id: "capacity", label: "Capacity" }]}
          value={profileSection}
          onChange={setProfileSection}
          label="Student profile sections"
          layoutId="profile-section-indicator"
          className="profile-section-tabs"
        />
        <div className="profile-editor-layout">
          <AnimatedContent className="profile-editor" key={profileSection}>
            {profileSection === "basics" && <>
              <header className="profile-editor-heading"><h2>Student and school</h2><p>These fields set the years and graduation requirements used throughout the plan.</p></header>
              <div className="form-grid two">
                <label className="form-field"><span>Preferred name</span><input value={profile.preferred_name} onChange={(event) => setProfile({ ...profile, preferred_name: event.target.value })} /></label>
                <label className="form-field"><span>School</span><input value={school.name} readOnly aria-readonly="true" /></label>
                <label className="form-field"><span>Age</span><input type="number" min={12} max={22} value={profile.age ?? ""} onChange={(event) => setProfile({ ...profile, age: numberValue(event.target.value) })} /></label>
                <label className="form-field"><span>Current grade</span><select value={profile.grade_level ?? ""} onChange={(event) => { const grade = Number(event.target.value) as GradeLevel; setProfile({ ...profile, grade_level: grade, plan_start_grade: grade, plan_end_grade: Math.max(grade, profile.plan_end_grade ?? 12) as GradeLevel }); }}><option value="">Select grade</option>{GRADE_LEVELS.map((grade) => <option value={grade} key={grade}>Grade {grade}</option>)}</select></label>
                <label className="form-field"><span>Graduation year</span><input type="number" min={2025} max={2040} value={profile.graduation_year ?? ""} onChange={(event) => setProfile({ ...profile, graduation_year: numberValue(event.target.value) })} /></label>
                <label className="form-field"><span>Plan through</span><select value={profile.plan_end_grade ?? 12} onChange={(event) => setProfile({ ...profile, plan_start_grade: (profile.grade_level ?? 9) as GradeLevel, plan_end_grade: Number(event.target.value) as GradeLevel })}>{GRADE_LEVELS.filter((grade) => grade >= (profile.grade_level ?? 9)).map((grade) => <option value={grade} key={grade}>Grade {grade}{grade === 12 ? " (graduation)" : ""}</option>)}</select></label>
              </div>
              <label className="confirmation-field"><input type="checkbox" checked={profile.school_confirmed} onChange={(event) => setProfile({ ...profile, school_confirmed: event.target.checked })} /><span><strong>I confirm this plan is for Design Tech High School.</strong><small>Course and graduation data use the labeled 2025-26 source year.</small></span></label>
            </>}
            {profileSection === "direction" && <>
              <header className="profile-editor-heading"><h2>Direction without locking in</h2><p>Use interests, work values, and open questions to test possibilities. This is not an assessment or a major commitment.</p></header>
              <fieldset className="profile-choice-grid"><legend>Broad academic direction</legend>{MAJOR_DIRECTION_OPTIONS.map((option) => <label className={profile.major_direction === option.value ? "selected" : ""} key={option.value}><input type="radio" name="major-direction" value={option.value} checked={profile.major_direction === option.value} onChange={() => setProfile({ ...profile, major_direction: option.value })} /><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}</fieldset>
              <fieldset className="profile-interest-areas"><legend>What kinds of work sound energizing?</legend><p>Select the descriptions that feel worth testing. These six areas are inspired by the widely used RIASEC exploration model.</p><div>{CAREER_INTEREST_AREA_OPTIONS.map((option) => <label className={profile.career_interest_areas.includes(option.value) ? "selected" : ""} key={option.value}><input type="checkbox" checked={profile.career_interest_areas.includes(option.value)} onChange={() => toggleProfileList("career_interest_areas", option.value)} /><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}</div></fieldset>
              <fieldset className="profile-interest-grid"><legend>Academic subjects to explore</legend>{ACADEMIC_INTEREST_OPTIONS.map((interest) => <label className={profile.academic_interests.includes(interest) ? "selected" : ""} key={interest}><input type="checkbox" checked={profile.academic_interests.includes(interest)} onChange={() => toggleInterest(interest)} /><span>{interest}</span></label>)}</fieldset>
              <fieldset className="profile-interest-grid work-values"><legend>Conditions that matter</legend>{WORK_VALUE_OPTIONS.map((value) => <label className={profile.work_values.includes(value) ? "selected" : ""} key={value}><input type="checkbox" checked={profile.work_values.includes(value)} onChange={() => toggleProfileList("work_values", value)} /><span>{value}</span></label>)}</fieldset>
              <div className="form-grid two">
                <label className="form-field"><span>Other interests</span><input value={otherInterests.join(", ")} onChange={(event) => setProfile({ ...profile, academic_interests: [...profile.academic_interests.filter((interest) => standardInterests.has(interest)), ...event.target.value.split(",").map((item) => item.trim()).filter(Boolean)] })} placeholder="Specific subjects, separated by commas" /></label>
                <label className="form-field"><span>Career ideas to test</span><input value={profile.career_direction} onChange={(event) => setProfile({ ...profile, career_direction: event.target.value })} placeholder="Software engineering, public health" /><small className="form-hint">Used for discovery, never treated as a final decision.</small></label>
              </div>
              <label className="form-field"><span>Questions I want experiences to answer</span><textarea rows={3} value={profile.exploration_questions.join("\n")} onChange={(event) => setProfile({ ...profile, exploration_questions: event.target.value.split("\n").map((item) => item.trim()).filter(Boolean) })} placeholder={"Do I enjoy open-ended technical problems?\nDo I want work centered on people or systems?"} /><small className="form-hint">One question per line. Use courses, projects, work, and conversations to gather evidence.</small></label>
            </>}
            {profileSection === "capacity" && <>
              <header className="profile-editor-heading"><h2>Workload and limits</h2><p>These settings power workload warnings and provide the simulator baseline.</p></header>
              <fieldset className="profile-choice-grid three"><legend>Planning priority</legend>{[
                { value: "lower_stress", label: "Protect capacity", body: "Prefer fewer simultaneous demanding courses." },
                { value: "balanced", label: "Balanced", body: "Mix rigor with activities and recovery." },
                { value: "competitive", label: "More rigorous", body: "Prefer honors when the plan still fits your limits." }
              ].map((option) => <label className={profile.goal_intensity === option.value ? "selected" : ""} key={option.value}><input type="radio" name="goal-intensity" checked={profile.goal_intensity === option.value} onChange={() => setProfile({ ...profile, goal_intensity: option.value as StudentProfile["goal_intensity"] })} /><span><strong>{option.label}</strong><small>{option.body}</small></span></label>)}</fieldset>
              <div className="form-grid two">
                <label className="form-field"><span>Demanding-course limit</span><select value={profile.workload_tolerance} onChange={(event) => setProfile({ ...profile, workload_tolerance: event.target.value as StudentProfile["workload_tolerance"] })}><option value="light">Up to 2 at once</option><option value="balanced">Up to 4 at once</option><option value="high">Up to 6 at once</option></select><small className="form-hint">Weighted and college courses count toward this limit.</small></label>
                <label className="form-field"><span>Weekly commitment limit</span><input type="number" min={1} max={80} step={0.5} value={profile.weekly_commitment_limit ?? ""} onChange={(event) => setProfile({ ...profile, weekly_commitment_limit: numberValue(event.target.value) })} placeholder="24" /><small className="form-hint">Activities and SMCCD class and study time outside d.tech.</small></label>
                <label className="form-field"><span>Current stress baseline</span><select value={profile.stress_level} onChange={(event) => setProfile({ ...profile, stress_level: Number(event.target.value) })}><option value={1}>1 - Low</option><option value={2}>2 - Manageable</option><option value={3}>3 - Stretched</option><option value={4}>4 - High</option><option value={5}>5 - Overloaded</option></select><small className="form-hint">Used for warnings only, never to predict grades.</small></label>
                <label className="form-field"><span>Graduation tracker</span><select value={profile.tracker_mode} onChange={(event) => setProfile({ ...profile, tracker_mode: event.target.value as StudentProfile["tracker_mode"], tracked_requirement_areas: event.target.value === "full" ? requirements.map((requirement) => requirement.area) : [] })}><option value="full">Full d.tech diploma</option><option value="selected">Selected requirement areas</option></select></label>
              </div>
              {profile.tracker_mode === "selected" && <fieldset className="profile-requirements"><legend>Tracked requirement areas</legend>{requirements.map((requirement) => <label key={requirement.id}><input type="checkbox" checked={profile.tracked_requirement_areas.includes(requirement.area)} onChange={() => { const selected = new Set(profile.tracked_requirement_areas); if (selected.has(requirement.area)) selected.delete(requirement.area); else selected.add(requirement.area); setProfile({ ...profile, tracked_requirement_areas: [...selected] }); }} /><span>{requirement.name}</span></label>)}</fieldset>}
            </>}
          </AnimatedContent>
          <aside className="profile-impact" aria-label="How these answers change planning">
            <h2>Planning impact</h2>
            <p>Only the current section's downstream effects are shown.</p>
            <dl>{impactRows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
          </aside>
        </div>
        <div className="profile-save-bar"><span>Save before leaving to apply these changes.</span><button className="primary-button" onClick={() => void saveProfile()} disabled={Boolean(busyLabel)}><FloppyDisk size={17} /> Save profile</button></div>
        {session && <CodexReviewPanel session={session} focus="profile" title="Turn answers into experiments" description="Codex can suggest low-risk ways to test a direction using the answers above. It will not diagnose an interest type or choose a major." question="Review my interests, values, open questions, and capacity. Suggest specific low-risk experiments that could confirm or challenge my current directions." context={profileContext} onNavigate={navigateFromReview} compact />}
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
        {sourceAiTransparency && <details className="transcript-ai-inspector">
          <summary><Sparkle size={15} /> Codex vision run details</summary>
          <div><dl><div><dt>Model</dt><dd>{sourceAiTransparency.model}</dd></div><div><dt>Reasoning</dt><dd>{sourceAiTransparency.reasoningEffort === "low" ? "Light (SDK: low)" : titleCase(sourceAiTransparency.reasoningEffort)}</dd></div><div><dt>Input</dt><dd>{sourceAiTransparency.input}</dd></div><div><dt>Tools</dt><dd>{sourceAiTransparency.toolsUsed.length || "None"}</dd></div><div><dt>Files changed</dt><dd>{sourceAiTransparency.filesChanged.length || "None"}</dd></div></dl><p>{sourceAiTransparency.mutations}</p><strong>Exact extraction instruction</strong><pre>{sourceAiTransparency.instruction}</pre></div>
        </details>}
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
            <div className="compare-controls"><label className="form-field"><span>Saved version</span><select value={compareVersionId} onChange={(event) => setCompareVersionId(event.target.value)}><option value="">Choose a snapshot</option>{snapshots.map((version) => <option value={version.id} key={version.id}>{version.label}</option>)}</select></label><p>{compareVersionId ? "The saved copy stays read-only. Differences below are measured against your active plan." : "Choose a saved snapshot."}</p></div>
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
    const activityHours = workload?.weeklyActivityHours ?? 0;
    const activeActivities = activities.filter((activity) => activity.is_active ?? true);
    const pastActivities = activities.filter((activity) => !(activity.is_active ?? true));
    const annualHours = activities.reduce((total, activity) => total + Number(activity.weekly_hours) * Number(activity.weeks_per_year ?? 0), 0);
    const needsStory = activities.filter((activity) => !activity.impact?.trim() || !activity.description?.trim()).length;
    const activitiesContext = {
      weekly_activity_hours: activityHours,
      known_weekly_workload: workload?.knownWeeklyHours ?? null,
      weekly_limit: profile?.weekly_commitment_limit ?? null,
      experiences: activities.map((activity) => ({ name: activity.name, type: activity.kind, role: activity.role, organization: activity.organization, hours_per_week: activity.weekly_hours, weeks_per_year: activity.weeks_per_year, grades: [activity.start_grade, activity.end_grade], active: activity.is_active, description: activity.description, impact: activity.impact }))
    };
    return (
      <div className="activity-page page-frame">
        <PageHeader title="Experience portfolio" description="Keep the commitments that shape your time, growth, and application stories in one place." />
        <AnimatedContent className="experience-balance">
          <div><span>Typical week</span><strong>{activityHours} hours</strong><p>{profile?.weekly_commitment_limit ? `${Math.max(0, profile.weekly_commitment_limit - (workload?.knownWeeklyHours ?? 0))} hours remain inside your saved outside-school limit.` : "Set a weekly limit in Student profile to see remaining capacity."}</p></div>
          <dl><div><dt>Active experiences</dt><dd>{activeActivities.length}</dd></div><div><dt>Estimated annual time</dt><dd>{Math.round(annualHours)}h</dd></div><div><dt>Stories to finish</dt><dd>{needsStory}</dd></div></dl>
        </AnimatedContent>
        <div className="experience-layout">
          <section className="experience-register">
            <header className="register-heading"><div><h2>Your experiences</h2><p>Hours power workload checks. Description and impact preserve what actually mattered.</p></div></header>
            {activities.length ? <div className="experience-list">
              {activeActivities.map((activity) => <article className="experience-row" key={activity.id}>
                <div className="experience-row-main"><span>{titleCase(activity.kind)}{activity.organization ? ` · ${activity.organization}` : ""}</span><h3>{activity.name}</h3><p>{activity.role || "Role not recorded"} · {activity.weekly_hours}h/week · {activity.weeks_per_year ?? "?"} weeks/year</p>{activity.impact ? <blockquote>{activity.impact}</blockquote> : <em>Add one concrete contribution, result, or lesson.</em>}</div>
                <div className="experience-row-actions"><button type="button" onClick={() => editActivity(activity)}>Edit</button><button type="button" className="danger" onClick={() => void removeActivity(activity.id)} aria-label={`Remove ${activity.name}`}><Trash size={15} /></button></div>
              </article>)}
              {pastActivities.length > 0 && <details className="past-experiences"><summary>{pastActivities.length} past {pastActivities.length === 1 ? "experience" : "experiences"}</summary><div>{pastActivities.map((activity) => <button type="button" onClick={() => editActivity(activity)} key={activity.id}><span><strong>{activity.name}</strong><small>{activity.role ?? titleCase(activity.kind)}</small></span><span>Grades {activity.start_grade ?? "?"}-{activity.end_grade ?? "?"}</span></button>)}</div></details>}
            </div> : <EmptyState title="No experiences recorded" body="Start with anything that regularly uses your time: a club, job, sport, family responsibility, project, service, or internship." />}
          </section>
          <form className="tool-rail activity-composer" onSubmit={saveActivity}>
            <header className="tool-rail-heading"><h2>{editingActivityId ? "Edit experience" : "Add an experience"}</h2><p>Capture enough detail to make this useful later.</p></header>
            <label className="form-field"><span>Activity name</span><input value={activityForm.name} onChange={(event) => setActivityForm({ ...activityForm, name: event.target.value })} required /></label>
            <label className="form-field"><span>Type</span><select value={activityForm.kind} onChange={(event) => setActivityForm({ ...activityForm, kind: event.target.value })}><option value="club">Club</option><option value="athletics">Athletics</option><option value="service">Service</option><option value="work">Work</option><option value="family">Family responsibility</option><option value="internship">Internship</option><option value="other">Other</option></select></label>
            <div className="form-grid two"><label className="form-field"><span>Role</span><input value={activityForm.role} onChange={(event) => setActivityForm({ ...activityForm, role: event.target.value })} placeholder="Member, captain, caregiver" /></label><label className="form-field"><span>Organization</span><input value={activityForm.organization} onChange={(event) => setActivityForm({ ...activityForm, organization: event.target.value })} placeholder="Optional" /></label></div>
            <div className="form-grid two"><label className="form-field"><span>Hours per week</span><input type="number" min={0} max={80} step={0.5} value={activityForm.weeklyHours} onChange={(event) => setActivityForm({ ...activityForm, weeklyHours: Number(event.target.value) })} /></label><label className="form-field"><span>Weeks per year</span><input type="number" min={0} max={52} step={1} value={activityForm.weeksPerYear} onChange={(event) => setActivityForm({ ...activityForm, weeksPerYear: Number(event.target.value) })} /></label></div>
            <div className="form-grid two"><label className="form-field"><span>Start grade</span><select value={activityForm.startGrade} onChange={(event) => setActivityForm({ ...activityForm, startGrade: Number(event.target.value) })}>{GRADE_LEVELS.map((grade) => <option value={grade} key={grade}>Grade {grade}</option>)}</select></label><label className="form-field"><span>End grade</span><select value={activityForm.endGrade} onChange={(event) => setActivityForm({ ...activityForm, endGrade: Number(event.target.value) })}>{GRADE_LEVELS.filter((grade) => grade >= activityForm.startGrade).map((grade) => <option value={grade} key={grade}>Grade {grade}</option>)}</select></label></div>
            <label className="form-field"><span>What you did</span><textarea rows={3} value={activityForm.description} onChange={(event) => setActivityForm({ ...activityForm, description: event.target.value })} placeholder="Responsibilities, projects, or regular work" /></label>
            <label className="form-field"><span>Contribution or growth</span><textarea rows={3} value={activityForm.impact} onChange={(event) => setActivityForm({ ...activityForm, impact: event.target.value })} placeholder="A result, change, responsibility, or lesson you can support" /></label>
            <label className="toggle-field"><input type="checkbox" checked={activityForm.isActive} onChange={(event) => setActivityForm({ ...activityForm, isActive: event.target.checked })} /><span>Currently active</span></label>
            <div className="activity-form-actions"><button className="primary-button" type="submit"><Plus size={17} /> {editingActivityId ? "Save changes" : "Add experience"}</button>{editingActivityId && <button className="text-button" type="button" onClick={() => { setEditingActivityId(null); setActivityForm({ name: "", kind: "club", role: "", organization: "", weeklyHours: 2, weeksPerYear: 20, startGrade: profile?.grade_level ?? 9, endGrade: profile?.grade_level ?? 12, impact: "", description: "", isActive: true }); }}>Cancel</button>}</div>
          </form>
        </div>
        {session && <CodexReviewPanel session={session} focus="activities" title="Review the portfolio" description="Find missing context, workload conflicts, and experience details worth preserving. Codex does not score the student or rewrite entries silently." question="Review these experiences for workload balance, missing evidence, and useful reflection questions. Suggest specific improvements without exaggerating impact." context={activitiesContext} onNavigate={navigateFromReview} compact />}
      </div>
    );
  }

  function renderTimeline() {
    const openTasks = tasks.filter((task) => !task.is_completed);
    const completedTasks = tasks.filter((task) => task.is_completed);
    const academicTasks = openTasks.filter((task) => task.category === "academics" || task.category === "admin");
    const explorationTasks = openTasks.filter((task) => task.category === "college" || task.category === "activities" || task.category === "summer");
    const timelineContext = {
      current_grade: profile?.grade_level ?? null,
      graduation_year: profile?.graduation_year ?? null,
      open_requirement_areas: progress.filter((item) => item.status === "missing").map((item) => ({ name: item.requirement.name, verified_projected_credits: item.verifiedProjectedCredits, required_credits: item.requirement.credits_required })),
      prerequisite_checks: prerequisitePlanChecks.map((check) => ({ course: check.name, status: check.status, message: check.message })),
      open_tasks: openTasks.map((task) => ({ title: task.title, category: task.category, timing: task.due_label, generated_from_plan: task.is_generated, rationale: task.explanation }))
    };
    const taskRow = (task: TimelineTask) => <article className={`decision-task ${task.is_completed ? "completed" : ""}`} key={task.id}>
      <input type="checkbox" checked={task.is_completed} onChange={(event) => void updateTask(task.id, { is_completed: event.target.checked })} aria-label={`Mark ${task.title} complete`} />
      <div><input className="task-title-input" value={task.title} onChange={(event) => setTasks((current) => current.map((candidate) => candidate.id === task.id ? { ...candidate, title: event.target.value } : candidate))} onBlur={() => void updateTask(task.id, { title: task.title })} /><span>{task.due_label ?? titleCase(task.category)}{task.is_generated ? " · From current plan" : " · Added by you"}</span>{task.explanation && <p>{task.explanation}</p>}</div>
      <button className="icon-button danger" onClick={async () => { if (!supabase) return; await supabase.from("timeline_tasks").delete().eq("id", task.id); setTasks((current) => current.filter((candidate) => candidate.id !== task.id)); }} aria-label={`Delete ${task.title}`}><Trash size={16} /></button>
    </article>;
    return (
      <div className="timeline-page page-frame">
        <PageHeader title="Decision timeline" description="Turn plan gaps, prerequisites, and your own goals into a short sequence of next actions." actions={<button className="secondary-button" onClick={() => void generateTasks()} disabled={Boolean(busyLabel)}><Sparkle size={17} /> Sync from plan</button>} />
        <AnimatedContent className="timeline-focus">
          <div><span>Do next</span><strong>{openTasks[0]?.title ?? "Nothing urgent"}</strong><p>{openTasks[0]?.explanation ?? "Sync from the plan or add a decision you want to remember."}</p></div>
          <dl><div><dt>Open decisions</dt><dd>{openTasks.length}</dd></div><div><dt>Course checks</dt><dd>{prerequisitePlanChecks.length}</dd></div><div><dt>Finished</dt><dd>{completedTasks.length}</dd></div></dl>
        </AnimatedContent>
        {prerequisitePlanChecks.length > 0 && <section className="timeline-course-checks">
          <header><div><span>Blocking evidence</span><h2>Course checks before registration</h2></div><strong>{prerequisitePlanChecks.length}</strong></header>
          <div>{prerequisitePlanChecks.slice(0, 6).map((check) => <button className={`prerequisite-followup-row ${check.status}`} key={check.row.id} type="button" onClick={() => {
            if (check.source === "dtech") {
              const course = courseMap.get(check.courseId);
              if (course) chooseDtechCourse(course);
            } else {
              setFocusedSmccdCourseId(check.courseId);
            }
            setCourseArea(check.source);
            setView("courses");
          }}><span><strong>{check.name}</strong><small>{check.message}</small></span><span>{check.status === "blocked" ? "Missing requirement" : "Needs review"}</span></button>)}</div>
        </section>}
        <div className="decision-timeline-layout">
          <section className="decision-track">
            <header className="register-heading"><div><h2>Academic and admin</h2><p>Requirements, registration, prerequisites, and verification.</p></div><span>{academicTasks.length}</span></header>
            {academicTasks.length ? <div className="decision-task-list">{academicTasks.map(taskRow)}</div> : <p className="decision-track-empty">No academic actions are waiting.</p>}
          </section>
          <section className="decision-track">
            <header className="register-heading"><div><h2>Explore and build</h2><p>Interests, activities, college exploration, and summer choices.</p></div><span>{explorationTasks.length}</span></header>
            {explorationTasks.length ? <div className="decision-task-list">{explorationTasks.map(taskRow)}</div> : <p className="decision-track-empty">No exploration actions are waiting.</p>}
          </section>
          <form className="tool-rail task-composer" onSubmit={addCustomTask}><header className="tool-rail-heading"><h2>Add a task</h2><p>For anything not already on the checklist.</p></header><label className="form-field"><span>Task</span><input value={taskForm.title} onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })} required /></label><label className="form-field"><span>Category</span><select value={taskForm.category} onChange={(event) => setTaskForm({ ...taskForm, category: event.target.value })}><option value="academics">Academics</option><option value="activities">Activities</option><option value="college">College readiness</option><option value="summer">Summer</option><option value="admin">Admin</option></select></label><label className="form-field"><span>When <small>(optional)</small></span><input value={taskForm.dueLabel} onChange={(event) => setTaskForm({ ...taskForm, dueLabel: event.target.value })} placeholder="Before registration" /></label><button className="primary-button" type="submit"><Plus size={17} /> Add task</button></form>
        </div>
        {completedTasks.length > 0 && <details className="completed-decisions"><summary>{completedTasks.length} completed {completedTasks.length === 1 ? "task" : "tasks"}</summary><div>{completedTasks.map(taskRow)}</div></details>}
        {session && <CodexReviewPanel session={session} focus="timeline" title="Prioritize the next moves" description="Codex can explain dependencies and point out vague tasks while the saved checklist stays under your control." question="Review this decision timeline. Identify the three most useful next actions, explain dependencies, and flag any task that is vague or unsupported." context={timelineContext} onNavigate={navigateFromReview} compact />}
      </div>
    );
  }

  function renderSimulator() {
    if (!profile) return null;
    const scenarioContext = simulationResult ? {
      assumptions: simulationConfig,
      current: simulationResult.current,
      scenario: simulationResult.simulated,
      deterministic_changes: simulationResult.changes,
      deterministic_risks: simulationResult.risks,
      saved_capacity: { weekly_limit: profile.weekly_commitment_limit, demanding_course_limit: workload?.demandingCourseLimit ?? null, stress_baseline: profile.stress_level }
    } : null;
    return (
      <div className="simulator-page page-frame">
        <PageHeader title="Scenario lab" description="Make one hypothetical tradeoff visible before changing the real course plan." actions={simulationResult && <button className="secondary-button" onClick={() => void saveSimulation()} disabled={Boolean(busyLabel)}><FloppyDisk size={17} /> Save comparison</button>} />
        <div className="scenario-contract"><ShieldCheckIcon /><span><strong>Safe sandbox:</strong> the comparison changes assumptions only. It never edits courses, grades, activities, or profile answers.</span></div>
        <div className="simulator-layout">
          <section className="tool-rail sim-controls">
            <header className="tool-rail-heading"><h2>Change the assumptions</h2><p>Each control states exactly what the deterministic model adds or removes.</p></header>
            <label className="form-field"><span>Planning direction</span><select value={simulationConfig.majorDirection} onChange={(event) => setSimulationConfig({ ...simulationConfig, majorDirection: event.target.value as SimulationConfig["majorDirection"] })}>{MAJOR_DIRECTION_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select><small className="form-hint">Changes profile matching only. It does not invent major requirements.</small></label>
            <label className="form-field"><span>Path intensity</span><select value={simulationConfig.pathIntensity} onChange={(event) => setSimulationConfig({ ...simulationConfig, pathIntensity: event.target.value as SimulationConfig["pathIntensity"] })}><option value="lower_stress">One fewer demanding course</option><option value="balanced">Keep current target</option><option value="competitive">One more demanding course</option></select></label>
            <label className="form-field"><span>Course style</span><select value={simulationConfig.courseStyle} onChange={(event) => setSimulationConfig({ ...simulationConfig, courseStyle: event.target.value as SimulationConfig["courseStyle"] })}><option value="more_regular">One fewer weighted course</option><option value="more_honors">Add one Honors course</option><option value="more_dual_enrollment">Add one 3-unit SMCCD course</option></select><small className="form-hint">The SMCCD scenario adds 9 weekly student-work hours.</small></label>
            <label className="form-field"><span>Activity load</span><select value={simulationConfig.activityLoad} onChange={(event) => setSimulationConfig({ ...simulationConfig, activityLoad: event.target.value as SimulationConfig["activityLoad"] })}><option value="lower">3 fewer hours per week</option><option value="same">No change</option><option value="higher">4 more hours per week</option></select></label>
            <button className="primary-button" onClick={() => void runSimulation()} disabled={Boolean(busyLabel)}><Scales size={17} /> Compare with current plan</button>
          </section>
          <section className="scenario-output">
            {simulationResult ? <><header className="scenario-output-heading"><span>Deterministic result</span><h2>What the assumption changes</h2><p>No AI is used for these values.</p></header><div className="comparison-table"><div className="comparison-head"><span>Measure</span><strong>Current</strong><strong>Scenario</strong></div><div><span>Planning direction</span><strong>{majorDirectionLabel(profile.major_direction)}</strong><strong>{majorDirectionLabel(simulationConfig.majorDirection)}</strong></div><div><span>{profile.tracker_mode === "selected" ? "Tracked coverage" : "Graduation coverage"}</span><strong>{simulationResult.current.graduationPercent}%</strong><strong>{simulationResult.simulated.graduationPercent}%</strong></div><div><span>Projected weighted GPA</span><strong>{formatGpa(simulationResult.current.projectedWeightedGpa)}</strong><strong>{formatGpa(simulationResult.simulated.projectedWeightedGpa)}</strong></div><div><span>Known weekly hours</span><strong>{simulationResult.current.workloadScore}</strong><strong>{simulationResult.simulated.workloadScore}</strong></div><div><span>Demanding courses</span><strong>{simulationResult.current.demandingCourseCount}</strong><strong>{simulationResult.simulated.demandingCourseCount}</strong></div><div><span>Stress baseline</span><strong>{simulationResult.current.stressLevel} / 5</strong><strong>{simulationResult.simulated.stressLevel} / 5</strong></div><div><span>Activity hours</span><strong>{simulationResult.current.activityHours}</strong><strong>{simulationResult.simulated.activityHours}</strong></div></div><div className="simulation-notes"><div><h3>Assumptions applied</h3><ul>{simulationResult.changes.map((change) => <li key={change}>{change}</li>)}</ul></div><div><h3>Limits and checks</h3><ul>{simulationResult.risks.length ? simulationResult.risks.map((risk) => <li key={risk}>{risk}</li>) : <li>The scenario stays inside the limits currently saved in the profile.</li>}</ul></div></div></> : <EmptyState title="No comparison yet" body="Choose a few explicit assumptions, then compare them with the current plan." />}
          </section>
        </div>
        {session && scenarioContext && <CodexReviewPanel session={session} focus="scenario" title="Ask for a tradeoff review" description="After the math runs, Codex can explain the tradeoffs and questions worth checking. Its review remains separate from the scenario values." question="Review this scenario comparison. Explain the tradeoffs, challenge unsupported assumptions, and give me questions to resolve before changing my real plan." context={scenarioContext} onNavigate={navigateFromReview} compact />}
      </div>
    );
  }

  function ShieldCheckIcon() {
    return <CheckCircle size={19} weight="duotone" aria-hidden />;
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
        <div className="app-content">{renderView()}</div>
      </main>
      {toast && <div className="toast" role="status">{busyLabel ? <ArrowClockwise size={16} className="spin" /> : <Check size={16} />}{toast}</div>}
      {busyLabel && <div className="busy-bar" role="status">{busyLabel}</div>}
    </div>
  );
}
