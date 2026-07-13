import {
  ArrowClockwiseIcon as ArrowClockwise,
  BookOpenIcon as BookOpen,
  ChartLineUpIcon as ChartLineUp,
  ChatCircleDotsIcon as ChatCircleDots,
  CheckIcon as Check,
  FileArrowUpIcon as FileArrowUp,
  FloppyDiskIcon as FloppyDisk,
  GearSixIcon as GearSix,
  GraduationCapIcon as GraduationCap,
  HouseIcon as House,
  PlusIcon as Plus,
  ShieldCheckIcon as ShieldCheck,
  WarningIcon as Warning
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
  calculateRequirementProgress,
  courseDisplayName,
  generateSuggestedPlan,
  overallCompletedPercent,
  overallGraduationPercent,
  selectedPlanGrades,
  schoolYearForGrade
} from "@/lib/planning";
import { requirementsForSettings } from "@/lib/planning";
import {
  findExistingTranscriptPlanCourse,
  resolveTranscriptCourse,
  transcriptPlanCourseDraft,
  visibleTranscriptUncertaintyNotes,
  type TranscriptCoursePayload
} from "@/lib/transcript";
import AdminSettingsPanel from "@/components/AdminSettingsPanel";
import CourseCatalogBrowser from "@/components/CourseCatalogBrowser";
import CourseDetailLayout from "@/components/CourseDetailLayout";
import CourseKanban, { type CoursePlacement } from "@/components/CourseKanban";
import OverviewPath, { type OverviewPathData } from "@/components/OverviewPath";
import PrerequisiteReadout, { prerequisiteDisplay } from "@/components/PrerequisiteReadout";
import TranscriptAiRunDetails, { type TranscriptAiTransparency } from "@/components/TranscriptAiRunDetails";
import TranscriptCourseEditor from "@/components/TranscriptCourseEditor";
import StudentSettingsPanel, { type NextStepDraft, type StudentSettingsPatch } from "@/components/StudentSettingsPanel";
import WorkspaceTabs from "@/components/WorkspaceTabs";
import type {
  CatalogReviewItem,
  Course,
  CourseRequirementMapping,
  EnrollmentPolicy,
  FourYearPlan,
  GraduationRequirement,
  GradeLevel,
  OfficialSource,
  PlanCourse,
  PlanVersion,
  School,
  SmccdCourse,
  SmccdHighSchoolEquivalency,
  StudentEnrollmentPreference,
  StudentSettings,
  TimelineTask
} from "@/lib/workspace-types";
import { defaultEnrollmentPreference, evaluateEnrollmentSchedule, policyForPreference } from "@/lib/enrollment-policy";
import { hasPublicEnv } from "@/lib/env";
import { institutionKeyFromName } from "@/lib/institutions";
import { evaluateDtechPlannerPrerequisites } from "@/lib/prerequisites";
import { dtechCatalogEligibility } from "@/lib/catalog-eligibility";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import AppChrome from "@/components/AppChrome";

const OnboardingFlow = lazy(() => import("@/components/OnboardingFlow"));
const GlobalAssistant = lazy(() => import("@/components/GlobalAssistant"));
const GraduationWorkspace = lazy(() => import("@/components/GraduationWorkspace"));
const SmccdPlanner = lazy(() => import("@/components/SmccdPlanner"));
const GpaPlanningLab = lazy(() => import("@/components/GpaPlanningLab"));

type ViewId =
  | "dashboard"
  | "courses"
  | "sources"
  | "graduation"
  | "gpa"
  | "settings";

const PRIMARY_NAV_ITEMS: Array<{ id: ViewId; label: string; icon: Icon }> = [
  { id: "dashboard", label: "Overview", icon: House },
  { id: "courses", label: "Courses", icon: BookOpen },
  { id: "graduation", label: "Graduation", icon: GraduationCap },
  { id: "gpa", label: "GPA planner", icon: ChartLineUp }
];

const NAV_ITEMS = [...PRIMARY_NAV_ITEMS, { id: "settings" as const, label: "Settings", icon: GearSix }, { id: "sources" as const, label: "Transcript import", icon: FileArrowUp }];

type CourseArea = "mine" | "dtech" | "smccd";
type SettingsArea = "general" | "planning" | "pilot" | "admin";
type SourceAiTransparency = TranscriptAiTransparency;

const SETTINGS_NAV_ITEMS: Array<{ id: SettingsArea; label: string; icon: Icon }> = [
  { id: "general", label: "General", icon: GearSix },
  { id: "planning", label: "Planning", icon: GraduationCap },
  { id: "pilot", label: "Pilot", icon: ChatCircleDots },
  { id: "admin", label: "Admin", icon: ShieldCheck }
];

const VIEW_IDS = new Set<ViewId>(["dashboard", "courses", "sources", "graduation", "gpa", "settings"]);
const COURSE_AREAS = new Set<CourseArea>(["mine", "dtech", "smccd"]);
const SETTINGS_AREAS = new Set<SettingsArea>(["general", "planning", "pilot", "admin"]);

function locationState() {
  if (typeof window === "undefined") return { view: "dashboard" as ViewId, courseArea: "mine" as CourseArea, settingsArea: "general" as SettingsArea };
  const params = new URLSearchParams(window.location.search);
  const requestedView = params.get("view") as ViewId | null;
  const requestedArea = params.get("course") as CourseArea | null;
  const requestedSettingsArea = params.get("settings") as SettingsArea | null;
  const legacyDegreeLink = params.get("college") === "degree";
  return {
    view: legacyDegreeLink ? "graduation" : requestedView && VIEW_IDS.has(requestedView) ? requestedView : "dashboard",
    courseArea: requestedArea && COURSE_AREAS.has(requestedArea) ? requestedArea : "mine",
    settingsArea: requestedSettingsArea && SETTINGS_AREAS.has(requestedSettingsArea) ? requestedSettingsArea : "general"
  };
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
  const [toastAction, setToastAction] = useState<{ label: string; run: () => Promise<void> } | null>(null);
  const [view, setView] = useState<ViewId>(() => locationState().view);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [replayingOnboarding, setReplayingOnboarding] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light"
  );
  const [courseArea, setCourseArea] = useState<CourseArea>(() => locationState().courseArea);
  const [settingsArea, setSettingsArea] = useState<SettingsArea>(() => locationState().settingsArea);
  const [gpaScenarioContext, setGpaScenarioContext] = useState<Record<string, unknown>>({});
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null);
  const [selectedDtechCourseId, setSelectedDtechCourseId] = useState<string | null>(null);
  const [focusedSmccdCourseId, setFocusedSmccdCourseId] = useState<string | null>(null);
  const [dtechDraft, setDtechDraft] = useState<{ gradeLevel: GradeLevel; term: PlanCourse["term"] }>({ gradeLevel: 9, term: "full_year" });

  const [school, setSchool] = useState<School | null>(null);
  const [settings, setSettings] = useState<StudentSettings | null>(null);
  const [sources, setSources] = useState<OfficialSource[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [requirements, setRequirements] = useState<GraduationRequirement[]>([]);
  const [mappings, setMappings] = useState<CourseRequirementMapping[]>([]);
  const [equivalencies, setEquivalencies] = useState<SmccdHighSchoolEquivalency[]>([]);
  const [plannedSmccdCourses, setPlannedSmccdCourses] = useState<SmccdCourse[]>([]);
  const [plan, setPlan] = useState<FourYearPlan | null>(null);
  const [versions, setVersions] = useState<PlanVersion[]>([]);
  const [planCourses, setPlanCourses] = useState<PlanCourse[]>([]);
  const [reviewItems, setReviewItems] = useState<CatalogReviewItem[]>([]);
  const [enrollmentPolicies, setEnrollmentPolicies] = useState<EnrollmentPolicy[]>([]);
  const [enrollmentPreference, setEnrollmentPreference] = useState<StudentEnrollmentPreference | null>(null);
  const [timelineTasks, setTimelineTasks] = useState<TimelineTask[]>([]);

  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogSubject, setCatalogSubject] = useState("all");
  const [catalogGrade, setCatalogGrade] = useState<GradeLevel | "all">("all");
  const [catalogPage, setCatalogPage] = useState(0);
  const [sourceForm, setSourceForm] = useState({ file: null as File | null });
  const [sourceAiTransparency, setSourceAiTransparency] = useState<SourceAiTransparency | null>(null);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, string>>({});
  const [selectedTranscriptIds, setSelectedTranscriptIds] = useState<Set<string>>(new Set());
  const [planExplanation, setPlanExplanation] = useState<string | null>(null);
  const [suggestedPlan, setSuggestedPlan] = useState<ReturnType<typeof generateSuggestedPlan>>([]);
  const [planGenerationPromptOpen, setPlanGenerationPromptOpen] = useState(false);
  const [respectUnitCapDraft, setRespectUnitCapDraft] = useState(true);
  const [compareVersionId, setCompareVersionId] = useState("");
  const [compareCourses, setCompareCourses] = useState<PlanCourse[]>([]);
  const [compareLoading, setCompareLoading] = useState(false);
  const compareRequestRef = useRef(0);

  useEffect(() => {
    if (!supabase) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "SIGNED_OUT") {
        setSession(null);
        window.location.assign("/");
        return;
      }
      if (nextSession) setSession(nextSession);
    });
    return () => subscription.unsubscribe();
  }, [supabase]);

  const activeVersion = versions.find((candidate) => candidate.kind === "active") ?? null;
  const courseMap = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);
  const trackedRequirements = useMemo(
    () => settings ? requirementsForSettings(requirements, settings) : requirements,
    [settings, requirements]
  );
  const overviewProgress = useMemo(
    () => calculateRequirementProgress(trackedRequirements, planCourses, mappings, courses, equivalencies),
    [trackedRequirements, planCourses, mappings, courses, equivalencies]
  );
  const fullProgress = useMemo(
    () => calculateRequirementProgress(requirements, planCourses, mappings, courses, equivalencies),
    [requirements, planCourses, mappings, courses, equivalencies]
  );
  const gpa = useMemo(() => calculateGpa(planCourses), [planCourses]);
  const graduationPercent = useMemo(() => overallGraduationPercent(fullProgress), [fullProgress]);
  const graduationEarnedPercent = useMemo(() => overallCompletedPercent(fullProgress), [fullProgress]);
  const availableCatalogGrades = useMemo(() => settings ? selectedPlanGrades(settings) : [], [settings]);
  const activeCatalogGrade = (catalogGrade !== "all" && availableCatalogGrades.includes(catalogGrade)
    ? catalogGrade
    : availableCatalogGrades[0] ?? settings?.grade_level ?? 9) as GradeLevel;
  const catalogAvailability = useMemo(() => {
    const eligibilityById = new Map(courses.map((course) => [
      course.id,
      dtechCatalogEligibility(course, activeCatalogGrade, planCourses, courses)
    ]));
    const structurallyEligible = courses.filter((course) => eligibilityById.get(course.id)?.eligible);
    const hiddenCounts = [...eligibilityById.values()].reduce((counts, eligibility) => {
      if (eligibility.reason) counts[eligibility.reason] += 1;
      return counts;
    }, { already_in_plan: 0, outside_grade: 0, below_math_level: 0 });
    return {
      eligibleCourses: structurallyEligible,
      hiddenTotal: hiddenCounts.already_in_plan + hiddenCounts.outside_grade + hiddenCounts.below_math_level,
      subjects: [...new Set(courses.map((course) => course.subject))]
    };
  }, [activeCatalogGrade, courses, planCourses]);
  const filteredCourses = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase();
    return catalogAvailability.eligibleCourses.filter((course) => (
      (!query || [course.name, course.subject, course.description ?? "", course.prerequisites.join(" ")].join(" ").toLowerCase().includes(query)) &&
      (catalogSubject === "all" || course.subject === catalogSubject)
    )).sort((a, b) => a.name.localeCompare(b.name));
  }, [catalogAvailability.eligibleCourses, catalogSearch, catalogSubject]);
  const courseCounts = useMemo(() => ({
    completed: planCourses.filter((row) => row.status === "completed").length,
    current: planCourses.filter((row) => row.status === "current").length,
    planned: planCourses.filter((row) => row.status === "planned").length
  }), [planCourses]);
  const selectedDtechCourse = selectedDtechCourseId ? courseMap.get(selectedDtechCourseId) ?? null : null;
  const selectedDtechEvaluation = useMemo(() => selectedDtechCourse
    ? evaluateDtechPlannerPrerequisites(
        selectedDtechCourse,
        dtechDraft,
        courses,
        planCourses,
        plannedSmccdCourses,
        equivalencies
      )
    : null, [courses, dtechDraft, equivalencies, planCourses, plannedSmccdCourses, selectedDtechCourse]);
  const plannedSmccdMap = useMemo(() => new Map(plannedSmccdCourses.map((course) => [course.id, course])), [plannedSmccdCourses]);
  const assistantPageContext = useMemo(() => ({
    view,
    label: NAV_ITEMS.find((item) => item.id === view)?.label ?? "workspace",
    ...(view === "courses" ? { course_area: courseArea } : {}),
    ...(view === "gpa" ? { gpa_scenario: gpaScenarioContext } : {}),
    ...(view === "graduation" ? { graduation_earned_percent: graduationEarnedPercent } : {})
  }), [courseArea, gpaScenarioContext, graduationEarnedPercent, view]);
  const loadWorkspace = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!supabase) return;
    if (!options.silent) {
      setLoading(true);
      setFatalError(null);
    }
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
        settingsResult,
        sourceResult,
        courseResult,
        requirementResult,
        mappingResult,
        equivalencyResult,
        planResult,
        reviewResult,
        enrollmentPolicyResult,
        enrollmentPreferenceResult,
        timelineResult,
        adminResult
      ] = await Promise.all([
        supabase.from("schools").select("*").eq("slug", "design-tech-high-school").single(),
        supabase.from("student_settings").select("*").eq("id", userId).single(),
        supabase.from("official_sources").select("*").order("is_official", { ascending: false }).order("created_at", { ascending: false }),
        supabase.from("courses").select("*").eq("review_status", "approved").order("subject").order("name"),
        supabase.from("graduation_requirements").select("*").eq("review_status", "approved").order("name"),
        supabase.from("course_requirement_mappings").select("*"),
        supabase.from("smccd_high_school_equivalencies").select("*").order("normalized_course_code"),
        supabase.from("four_year_plans").select("*").eq("user_id", userId).eq("is_active", true).single(),
        supabase.from("catalog_review_items").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
        supabase.from("enrollment_policies").select("*").order("provider_code").order("program_type"),
        supabase.from("student_enrollment_preferences").select("*").eq("user_id", userId).eq("provider_code", "SMCCD").maybeSingle(),
        supabase.from("timeline_tasks").select("*").eq("user_id", userId).order("is_completed").order("due_date"),
        supabase.rpc("is_app_admin")
      ]);
      const firstError = [
        schoolResult.error,
        settingsResult.error,
        courseResult.error,
        requirementResult.error,
        mappingResult.error,
        equivalencyResult.error,
        planResult.error,
        enrollmentPolicyResult.error,
        enrollmentPreferenceResult.error,
        timelineResult.error
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

      const rawSettings = settingsResult.data as unknown as StudentSettings;
      const loadedSettings: StudentSettings = {
        ...rawSettings,
        ai_enabled: rawSettings.ai_enabled ?? false,
        ai_model: rawSettings.ai_model ?? "gpt-5.6-luna",
        ai_reasoning_effort: rawSettings.ai_reasoning_effort ?? "low",
        ai_review_mode: rawSettings.ai_review_mode ?? "manual",
        ai_connection_approved_at: rawSettings.ai_connection_approved_at ?? null,
        ai_setup_tested_at: rawSettings.ai_setup_tested_at ?? null
      };
      setSchool(schoolResult.data as unknown as School);
      setSettings(loadedSettings);
      const loadedSources = (sourceResult.data ?? []) as unknown as OfficialSource[];
      setSources(loadedSources);
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
      setReviewItems(loadedReviewItems);
      setEnrollmentPolicies((enrollmentPolicyResult.data ?? []) as unknown as EnrollmentPolicy[]);
      setEnrollmentPreference(
        enrollmentPreferenceResult.data
          ? {
              ...enrollmentPreferenceResult.data as unknown as StudentEnrollmentPreference,
              limit_mode: "recommended",
              custom_unit_limit: null,
              respect_recommended_limit: enrollmentPreferenceResult.data.respect_recommended_limit !== false
            }
          : defaultEnrollmentPreference(userId)
      );
      setTimelineTasks((timelineResult.data ?? []) as unknown as TimelineTask[]);
      setIsAdmin(adminResult.data === true && !adminResult.error);
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
      const message = caught instanceof Error ? caught.message : "The workspace could not be loaded.";
      if (options.silent) {
        setToastKind("error");
        setToast(`The change was handled, but the workspace could not refresh: ${message}`);
      } else {
        setFatalError(message);
      }
    } finally {
      if (!options.silent) setLoading(false);
    }
  }, [supabase]);

  const refreshWorkspaceSilently = useCallback(() => loadWorkspace({ silent: true }), [loadWorkspace]);

  async function refreshAfterAssistantChange() {
    if (!supabase || !activeVersion) return refreshWorkspaceSilently();
    try {
      const { data, error } = await supabase.from("plan_courses").select("*").eq("plan_version_id", activeVersion.id).order("grade_level").order("sort_order");
      if (!error) {
        const nextRows = (data ?? []) as unknown as PlanCourse[];
        const signature = (rows: PlanCourse[]) => JSON.stringify(rows.map((row) => ({
          id: row.id,
          course_id: row.course_id,
          name: row.custom_course_name,
          grade: row.grade_level,
          term: row.term,
          status: row.status,
          credits: row.credits,
          units: row.college_units,
          letter: row.letter_grade
        })).sort((a, b) => a.id.localeCompare(b.id)));
        if (signature(nextRows) !== signature(planCourses)) {
          await createSnapshot(`Before Pilot change ${new Date().toLocaleString()}`, planCourses);
        }
      }
    } catch {
      notify("Pilot applied the change, but the automatic backup could not be saved.", "error");
    } finally {
      await refreshWorkspaceSilently();
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadWorkspace(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadWorkspace]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("college") === "degree") {
      url.searchParams.set("view", "graduation");
      url.searchParams.set("graduation", "degree");
      url.searchParams.delete("course");
      url.searchParams.delete("college");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const next = locationState();
      setView(next.view);
      setCourseArea(next.courseArea);
      setSettingsArea(next.settingsArea);
      setEditingCourseId(null);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => {
      setToast(null);
      setToastAction(null);
    }, toastAction ? 8000 : 3500);
    return () => window.clearTimeout(timeout);
  }, [toast, toastAction]);

  function notify(message: string, kind: "info" | "success" | "error" = "info") {
    setToastKind(kind);
    setToast(message);
    setToastAction(null);
  }

  function notifyUndo(message: string, action: () => Promise<void>) {
    setToastKind("success");
    setToast(message);
    setToastAction({ label: "Undo", run: action });
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
        setToastAction(null);
      }
      return result;
    } catch (caught) {
      setToastKind("error");
      setToast(caught instanceof Error ? caught.message : "That action could not be completed.");
      setToastAction(null);
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

  function syncLocation(nextView: ViewId, nextCourseArea = courseArea, nextSettingsArea = settingsArea) {
    const url = new URL(window.location.href);
    if (nextView === "dashboard") url.searchParams.delete("view");
    else url.searchParams.set("view", nextView);
    if (nextView === "courses") {
      if (nextCourseArea === "mine") url.searchParams.delete("course");
      else url.searchParams.set("course", nextCourseArea);
      url.searchParams.delete("college");
    } else {
      url.searchParams.delete("course");
      url.searchParams.delete("college");
    }
    if (nextView === "settings" && nextSettingsArea !== "general") url.searchParams.set("settings", nextSettingsArea);
    else url.searchParams.delete("settings");
    if (nextView !== "graduation") url.searchParams.delete("graduation");
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function navigate(nextView: ViewId) {
    setView(nextView);
    setMobileNavOpen(false);
    syncLocation(nextView);
    void logEvent("view_opened", { view: nextView });
  }

  function openSettings(area: SettingsArea = "general") {
    setSettingsArea(area);
    setView("settings");
    setMobileNavOpen(false);
    syncLocation("settings", courseArea, area);
    void logEvent("view_opened", { view: "settings", settings_area: area });
  }

  function openCourses(area: CourseArea = "mine") {
    setCourseArea(area);
    setEditingCourseId(null);
    setView("courses");
    setMobileNavOpen(false);
    syncLocation("courses", area);
    void logEvent("view_opened", { view: "courses", course_area: area });
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

  function applyTheme(nextTheme: "light" | "dark") {
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem("pilot-princess-theme", nextTheme);
  }

  function toggleTheme() {
    applyTheme(theme === "light" ? "dark" : "light");
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    window.location.assign("/");
  }

  async function saveEnrollmentProgramType(programType: StudentEnrollmentPreference["program_type"]) {
    if (!supabase || !session || !enrollmentPreference) return;
    await runAction(
      "Saving college enrollment type",
      async () => {
        const { data, error } = await supabase.from("student_enrollment_preferences").upsert({
          user_id: session.user.id,
          provider_code: enrollmentPreference.provider_code,
          program_type: programType,
          limit_mode: "recommended",
          custom_unit_limit: null,
          respect_recommended_limit: enrollmentPreference.respect_recommended_limit
        }, { onConflict: "user_id,provider_code" }).select("*").single();
        if (error) throw error;
        setEnrollmentPreference({
          ...data as unknown as StudentEnrollmentPreference,
          limit_mode: "recommended",
          custom_unit_limit: null,
          respect_recommended_limit: data.respect_recommended_limit !== false
        });
        await logEvent("enrollment_program_updated", { provider_code: enrollmentPreference.provider_code, program_type: programType });
      },
      "College enrollment type saved."
    );
  }

  function defaultDtechPlacement(course: Course, preferredGrade?: GradeLevel) {
    const allowedGrades = course.grade_levels.filter((grade): grade is GradeLevel => grade >= 9 && grade <= 12);
    const currentGrade = preferredGrade ?? (catalogGrade === "all" ? undefined : catalogGrade) ?? (settings?.grade_level ?? 9) as GradeLevel;
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
    if (!supabase || !session || !activeVersion || !settings) return;
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
    const added = await runAction(
      `Adding ${course.name}`,
      async () => {
        const { data, error } = await supabase
          .from("plan_courses")
          .insert({
            plan_version_id: activeVersion.id,
            user_id: session.user.id,
            course_id: course.id,
            grade_level: grade,
            school_year: schoolYearForGrade(settings.graduation_year ?? new Date().getFullYear() + 3, grade),
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
        return data as unknown as PlanCourse;
      }
    );
    if (added) notifyUndo(`${course.name} added to ${status === "completed" ? "Done" : status === "current" ? "In progress" : "Planned"}.`, async () => {
      const { error } = await supabase.from("plan_courses").delete().eq("id", added.id);
      if (error) throw error;
      setPlanCourses((current) => current.filter((row) => row.id !== added.id));
    });
  }

  async function updatePlanCourse(id: string, patch: Partial<PlanCourse>) {
    if (!supabase) return;
    const previous = planCourses.find((row) => row.id === id);
    if (!previous) return;
    const updated = await runAction("Updating course", async () => {
      const safePatch = { ...patch, user_edited: true };
      const { error } = await supabase.from("plan_courses").update(safePatch).eq("id", id);
      if (error) throw error;
      setPlanCourses((current) => current.map((row) => (row.id === id ? { ...row, ...safePatch } : row)));
      await logEvent("plan_edited", { plan_course_id: id });
      return true;
    });
    if (updated) notifyUndo("Course updated.", async () => {
      const { id: _id, ...restore } = previous;
      const { error } = await supabase.from("plan_courses").update(restore).eq("id", id);
      if (error) throw error;
      setPlanCourses((current) => current.map((row) => row.id === id ? previous : row));
    });
  }

  function movePlanCourse(row: PlanCourse, placement: CoursePlacement) {
    if (!settings) return;
    if (row.source_review_item_id || row.status === "completed" || row.grade_level < Number(settings.grade_level ?? 9)) {
      notify("Completed and transcript-backed courses stay locked in their recorded term.");
      return;
    }
    const patch: Partial<PlanCourse> = {
      status: placement.status,
      grade_level: placement.gradeLevel,
      school_year: schoolYearForGrade(settings.graduation_year ?? new Date().getFullYear() + 3, placement.gradeLevel),
      term: placement.term,
      sort_order: planCourses.filter((candidate) => candidate.grade_level === placement.gradeLevel && candidate.term === placement.term).length,
      ...(placement.status === "completed" ? {} : { letter_grade: null })
    };
    void updatePlanCourse(row.id, patch);
  }

  async function removePlanCourse(id: string) {
    if (!supabase) return;
    const removed = planCourses.find((row) => row.id === id);
    if (!removed) return;
    const succeeded = await runAction(
      "Removing course",
      async () => {
        const { error } = await supabase.from("plan_courses").delete().eq("id", id);
        if (error) throw error;
        setPlanCourses((current) => current.filter((row) => row.id !== id));
        await logEvent("plan_edited", { action: "remove_course" });
        return true;
      }
    );
    if (succeeded) notifyUndo("Course removed.", async () => {
      const { error } = await supabase.from("plan_courses").insert(removed);
      if (error) throw error;
      setPlanCourses((current) => [...current, removed]);
    });
  }

  function openPlanGenerationPrompt() {
    setRespectUnitCapDraft(enrollmentPreference?.respect_recommended_limit !== false);
    setPlanGenerationPromptOpen(true);
  }

  async function generatePlan(respectRecommendedLimit: boolean) {
    if (!settings || !supabase || !session || !enrollmentPreference) return;
    const enrollmentPolicy = enrollmentPreference ? policyForPreference(enrollmentPolicies, enrollmentPreference) : null;
    const { data: savedPreference, error: preferenceError } = await supabase.from("student_enrollment_preferences").upsert({
      user_id: session.user.id,
      provider_code: enrollmentPreference.provider_code,
      program_type: enrollmentPreference.program_type,
      limit_mode: "recommended",
      custom_unit_limit: null,
      respect_recommended_limit: respectRecommendedLimit
    }, { onConflict: "user_id,provider_code" }).select("*").single();
    if (preferenceError) {
      notify(preferenceError.message, "error");
      return;
    }
    setEnrollmentPreference({
      ...savedPreference as unknown as StudentEnrollmentPreference,
      limit_mode: "recommended",
      custom_unit_limit: null,
      respect_recommended_limit: savedPreference.respect_recommended_limit !== false
    });
    setPlanGenerationPromptOpen(false);
    const generated = generateSuggestedPlan(settings, courses, planCourses, enrollmentPolicy, respectRecommendedLimit);
    if (generated.length === 0) {
      notify("The current plan already contains the available high school flow courses.");
      return;
    }
    setSuggestedPlan(generated);
    notify(`${generated.length} suggested ${generated.length === 1 ? "course is" : "courses are"} ready to review.`);
  }

  async function confirmSuggestedPlan() {
    if (!supabase || !session || !activeVersion || suggestedPlan.length === 0) return;
    const generated = suggestedPlan;
    const inserted = await runAction(
      "Adding suggested courses",
      async () => {
        const rows = generated.map((row, index) => ({
          ...row,
          plan_version_id: activeVersion.id,
          user_id: session.user.id,
          sort_order: index
        }));
        const { data, error } = await supabase.from("plan_courses").insert(rows).select("*");
        if (error) throw error;
        const inserted = (data ?? []) as unknown as PlanCourse[];
        setPlanCourses((current) => [...current, ...inserted]);
        setSuggestedPlan([]);
        const explanation = "Suggested courses were added from the official high school flow. Verify each placement and prerequisite before registration.";
        setPlanExplanation(explanation);
        await supabase.from("plan_versions").update({ ai_summary: null }).eq("id", activeVersion.id);
        await logEvent("plan_generated", { course_count: inserted.length, ai_used: false });
        return inserted;
      }
    );
    if (inserted) notifyUndo(`${generated.length} suggested courses added.`, async () => {
      const ids = inserted.map((row) => row.id);
      const { error } = await supabase.from("plan_courses").delete().in("id", ids);
      if (error) throw error;
      setPlanCourses((current) => current.filter((row) => !ids.includes(row.id)));
    });
  }

  async function createSnapshot(label: string, rows: PlanCourse[]) {
    if (!supabase || !session || !plan || !activeVersion) throw new Error("The active plan is unavailable.");
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
    if (rows.length > 0) {
      const copies = rows.map(({ id: _id, ...row }) => ({ ...row, plan_version_id: snapshot.id }));
      const { error: copyError } = await supabase.from("plan_courses").insert(copies);
      if (copyError) {
        await supabase.from("plan_versions").delete().eq("id", snapshot.id);
        throw copyError;
      }
    }
    setVersions((current) => [snapshot as unknown as PlanVersion, ...current]);
    return snapshot as unknown as PlanVersion;
  }

  async function saveSnapshot() {
    if (!supabase || !session || !plan || !activeVersion) return;
    await runAction(
      "Saving snapshot",
      async () => {
        await createSnapshot(`Snapshot ${new Date().toLocaleDateString()}`, planCourses);
      },
      "Plan snapshot saved."
    );
  }

  async function restoreSnapshot(version: PlanVersion, rows: PlanCourse[]) {
    if (!supabase || !activeVersion || rows.length === 0) return;
    await runAction("Restoring saved plan", async () => {
      await createSnapshot(`Before restoring ${version.label}`, planCourses);
      const copies = rows.map(({ id: _id, ...row }) => ({ ...row, plan_version_id: activeVersion.id }));
      const { data: inserted, error: insertError } = await supabase.from("plan_courses").insert(copies).select("id");
      if (insertError) throw insertError;
      const previousIds = planCourses.map((row) => row.id);
      const { error: deleteError } = previousIds.length
        ? await supabase.from("plan_courses").delete().in("id", previousIds)
        : { error: null };
      if (deleteError) {
        const insertedIds = (inserted ?? []).map((row) => row.id);
        if (insertedIds.length > 0) await supabase.from("plan_courses").delete().in("id", insertedIds);
        throw deleteError;
      }
      await loadWorkspace({ silent: true });
    }, `${version.label} restored. A backup of the previous plan was saved.`);
  }

  async function submitTranscript(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (!supabase || !session || !school) return;
    const file = sourceForm.file;
    if (!file) {
      notify("Choose a transcript file.", "error");
      return;
    }
    const existingTranscript = sources.find((source) => !source.is_official && source.document_type === "transcript") ?? null;
    const form = event.currentTarget;
    await runAction(
      existingTranscript ? "Replacing transcript" : "Reading transcript",
      async () => {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        const storagePath = `${session.user.id}/${crypto.randomUUID()}-${safeName}`;
        const mimeType = file.type || "application/octet-stream";
        const kind: "upload" | "screenshot" = mimeType.startsWith("image/") ? "screenshot" : "upload";
        const { error: uploadError } = await supabase.storage
          .from("source-uploads")
          .upload(storagePath, file, { contentType: mimeType, upsert: false });
        if (uploadError) throw uploadError;

        const sourceValues = {
            school_id: school.id,
            user_id: session.user.id,
            title: file.name,
            kind,
            storage_path: storagePath,
            raw_text: null,
            mime_type: mimeType,
            source_year: new Date().getFullYear().toString(),
            is_official: false,
            parse_status: "pending",
            confidence: "uncertain",
            document_type: "transcript" as const,
            error_message: null
        };
        const sourceMutation = existingTranscript
          ? supabase.from("official_sources").update(sourceValues).eq("id", existingTranscript.id)
          : supabase.from("official_sources").insert(sourceValues);
        const { data, error } = await sourceMutation
          .select("*")
          .single();
        if (error) {
          await supabase.storage.from("source-uploads").remove([storagePath]);
          throw error;
        }
        setSourceForm({ file: null });
        form.reset();
        await logEvent(existingTranscript ? "transcript_replaced" : "source_added", { kind });
        let payload: Record<string, unknown>;
        try {
          payload = await authorizedPost("/api/ai/parse-transcript", { sourceId: data.id });
        } finally {
          await loadWorkspace();
        }
        if (existingTranscript?.storage_path && existingTranscript.storage_path !== storagePath) {
          await supabase.storage.from("source-uploads").remove([existingTranscript.storage_path]);
        }
        const parsedItems = ((payload.reviewItems ?? []) as CatalogReviewItem[])
          .filter((item) => item.entity_type === "transcript_course");
        setSelectedTranscriptIds(new Set(parsedItems.map((item) => item.id)));
        const parserNote = payload.aiUsed === true
          ? " Codex vision was used because the file had no readable text layer."
          : " Parsed from document text without Codex.";
        notify(`${String(payload.summary ?? "Transcript review ready.")}${parserNote}${existingTranscript ? " Existing imported courses were refreshed without creating a second transcript." : ""}`, "success");
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
    if (!supabase || !session || !activeVersion || !settings) return;
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
        await createSnapshot(`Before transcript import ${new Date().toLocaleDateString()}`, planCourses);
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

        const claimedPlanCourseIds = new Set<string>();
        let nextSortOrder = planCourses.reduce((maximum, row) => Math.max(maximum, row.sort_order), -1) + 1;
        const planUpserts: Array<Record<string, unknown>> = [];
        for (const { item, payload } of prepared) {
          const draft = transcriptPlanCourseDraft(payload as unknown as TranscriptCoursePayload, settings, courses, mappings, item.id, equivalencies);
          const existing = findExistingTranscriptPlanCourse(draft, planCourses, claimedPlanCourseIds);
          if (existing) claimedPlanCourseIds.add(existing.id);
          planUpserts.push({
            id: existing?.id ?? crypto.randomUUID(),
            ...draft,
            plan_version_id: activeVersion.id,
            user_id: session.user.id,
            sort_order: existing?.sort_order ?? nextSortOrder++
          });
        }
        if (planUpserts.length > 0) {
          const { error: upsertError } = await supabase.from("plan_courses").upsert(planUpserts);
          if (upsertError) throw upsertError;
        }
        await logEvent("transcript_courses_imported", { review_item_ids: ids, course_count: prepared.length });
        await loadWorkspace();
        setSelectedTranscriptIds(new Set());
      },
      `${prepared.length} ${prepared.length === 1 ? "course" : "courses"} imported to Done.`
    );
  }

  async function saveStudentSettings(patch: StudentSettingsPatch) {
    if (!supabase || !session || !settings || Object.keys(patch).length === 0) return;
    const normalizedPatch: Record<string, unknown> = { ...patch };
    const { data, error } = await supabase.from("student_settings").update(normalizedPatch).eq("id", session.user.id).select("*").single();
    if (error) throw error;
    setSettings(data as unknown as StudentSettings);
    await logEvent("student_settings_updated", { fields: Object.keys(normalizedPatch) });
  }

  async function refreshAiPreferences() {
    if (!supabase || !session) return;
    const { data, error } = await supabase.from("student_settings").select("ai_enabled, ai_model, ai_reasoning_effort, ai_review_mode, ai_connection_approved_at, ai_setup_tested_at").eq("id", session.user.id).single();
    if (error) throw error;
    setSettings((current) => current ? {
      ...current,
      ai_enabled: data.ai_enabled,
      ai_model: data.ai_model as StudentSettings["ai_model"],
      ai_reasoning_effort: data.ai_reasoning_effort as "low",
      ai_review_mode: data.ai_review_mode as StudentSettings["ai_review_mode"],
      ai_connection_approved_at: data.ai_connection_approved_at,
      ai_setup_tested_at: data.ai_setup_tested_at
    } : current);
  }

  async function addTimelineTask(draft: NextStepDraft) {
    if (!supabase || !session) return false;
    const { data, error } = await supabase.from("timeline_tasks").insert({
      user_id: session.user.id,
      plan_version_id: activeVersion?.id ?? null,
      title: draft.title,
      category: draft.category,
      due_label: draft.dueLabel || null,
      due_date: draft.dueDate || null,
      is_completed: false,
      is_generated: false
    }).select("*").single();
    if (error) throw error;
    setTimelineTasks((current) => [...current, data as unknown as TimelineTask]);
    return true;
  }

  async function updateTimelineTask(id: string, patch: Partial<TimelineTask>) {
    if (!supabase) return;
    const { error } = await supabase.from("timeline_tasks").update(patch).eq("id", id);
    if (error) throw error;
    setTimelineTasks((current) => current.map((task) => task.id === id ? { ...task, ...patch } : task));
  }

  async function deleteTimelineTask(id: string) {
    if (!supabase) return;
    const { error } = await supabase.from("timeline_tasks").delete().eq("id", id);
    if (error) throw error;
    setTimelineTasks((current) => current.filter((task) => task.id !== id));
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
  if (fatalError || !session || !settings || !school || !plan || !activeVersion || !supabase) {
    return (
      <main className="fatal-state">
        <Warning size={28} weight="duotone" />
        <h1>Workspace unavailable</h1>
        <p>{fatalError ?? "The planning settings is missing."}</p>
        <div className="fatal-actions"><button className="secondary-button" onClick={() => void loadWorkspace()} type="button"><ArrowClockwise size={17} /> Try again</button><button className="quiet-button" onClick={() => void signOut()} type="button">Sign out</button></div>
      </main>
    );
  }

  if (!settings.onboarding_complete || replayingOnboarding) {
    return (
      <Suspense fallback={<LoadingWorkspace />}>
        <OnboardingFlow
          supabase={supabase}
          session={session}
          school={school}
          settings={settings}
          requirements={requirements}
          courses={courses}
          mappings={mappings}
          equivalencies={equivalencies}
          activeVersion={activeVersion}
          existingPlanCourses={planCourses}
          enrollmentPolicies={enrollmentPolicies}
          enrollmentPreference={enrollmentPreference ?? defaultEnrollmentPreference(session.user.id)}
          mode={replayingOnboarding ? "replay" : "initial"}
          onComplete={async () => {
            await loadWorkspace();
            if (replayingOnboarding) {
              setReplayingOnboarding(false);
              setView("dashboard");
              syncLocation("dashboard");
              notify("Onboarding changes saved.", "success");
            }
          }}
          onExit={replayingOnboarding ? () => {
            setReplayingOnboarding(false);
            setView("dashboard");
            syncLocation("dashboard");
            notify("Onboarding exited without saving changes.");
          } : undefined}
          onSignOut={signOut}
        />
      </Suspense>
    );
  }

  const catalogPageSize = 12;
  const catalogPageCount = Math.max(1, Math.ceil(filteredCourses.length / catalogPageSize));
  const visibleCatalogCourses = filteredCourses.slice(catalogPage * catalogPageSize, (catalogPage + 1) * catalogPageSize);
  function renderDashboard() {
    if (!settings) return null;
    const requirementSnapshot = overviewProgress.map((item) => {
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
        source: collegeCode ?? (row.smccd_course_id ? "College" : "High school"),
        institution: collegeCode ?? (row.smccd_course_id ? "smccd" : "dtech")
      };
    };
    const overviewData: OverviewPathData = {
      earnedPercent: graduationEarnedPercent,
      completedCredits: dashboardCredits.completed,
      scheduledCredits: dashboardCredits.scheduled,
      remainingCredits: dashboardCredits.remaining,
      projectedWeightedGpa: formatGpa(gpa.projectedWeighted),
      currentUnweightedGpa: formatGpa(gpa.currentUnweighted),
      gradedCredits: gpa.gradedCredits,
      weightedCredits: gpa.weightedCredits,
      transcriptBackedCourseCount: planCourses.filter((row) => row.status === "completed" && row.source_review_item_id).length,
      completedCollegeUnits: Number(planCourses
        .filter((row) => row.status === "completed")
        .reduce((sum, row) => sum + Number(row.college_units ?? 0), 0)
        .toFixed(1)),
      requirements: overviewRequirements,
      currentCourses: planCourses.filter((row) => row.status === "current").map(overviewCourse),
      plannedCourses: planCourses.filter((row) => row.status === "planned").map(overviewCourse),
      courseCounts
    };
    return (
      <div className="dashboard-page page-frame">
        <PageHeader title={settings.preferred_name ? `Good to see you, ${settings.preferred_name}` : "Planning overview"} description="What is done, what needs attention, and how the current plan fits." />
        <OverviewPath
          data={overviewData}
          onOpenGraduation={() => navigate("graduation")}
          onOpenCourses={() => openCourses("mine")}
          onOpenGpa={() => navigate("gpa")}
        />
      </div>
    );
  }

  function renderSources() {
    const selectedTranscript = sources.find((source) => !source.is_official && source.document_type === "transcript") ?? null;
    const importedIds = new Set(planCourses.map((row) => row.source_review_item_id).filter(Boolean));
    const transcriptItems = reviewItems.filter(
      (item) => item.entity_type === "transcript_course"
        && item.status !== "rejected"
        && (!selectedTranscript || item.source_id === selectedTranscript.id)
    );
    const transcriptNote = reviewItems.find(
      (item) => item.entity_type === "transcript_note" && item.source_id === selectedTranscript?.id
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
              <span className="transcript-file-name">{sourceForm.file?.name ?? (selectedTranscript ? "Choose an updated transcript" : "Drop transcript here")}</span>
              <span className="transcript-file-action">Choose file</span>
              <input aria-label="Transcript file" type="file" accept=".pdf,.docx,.txt,.csv,.png,.jpg,.jpeg,.webp" onChange={(event) => setSourceForm((current) => ({ ...current, file: event.target.files?.[0] ?? null }))} />
            </label>
            <button className="primary-button transcript-read-button" type="submit" disabled={Boolean(busyLabel) || !sourceForm.file}>
              <FileArrowUp size={17} /> {busyLabel === "Reading transcript" || busyLabel === "Replacing transcript" ? "Reading" : selectedTranscript ? "Replace transcript" : "Read transcript"}
            </button>
          </div>
          <p className="transcript-parser-note">{selectedTranscript ? "Replacing the file refreshes this transcript and preserves links to imported courses. " : "Readable document text is parsed locally. "}Codex is only used for image-only files after you approve the connection. <button type="button" onClick={() => setAssistantOpen(true)}>Open Pilot setup</button></p>
        </form>
        {selectedTranscript && <div className={`transcript-source-status ${selectedTranscript.error_message ? "error" : ""}`}>
          <span><strong>{selectedTranscript.title}</strong><small>{selectedTranscript.parse_status === "processing" ? "Reading transcript" : selectedTranscript.parse_status === "needs_review" || selectedTranscript.parse_status === "complete" ? "Ready to review" : titleCase(selectedTranscript.parse_status)}</small></span>
          {selectedTranscript.error_message && <small>{selectedTranscript.error_message}</small>}
          {selectedTranscript.parse_status !== "processing" && transcriptItems.length === 0 && <button className="secondary-button small" type="button" onClick={() => void parseSource(selectedTranscript)} disabled={Boolean(busyLabel)}><ArrowClockwise size={15} /> Read again</button>}
        </div>}
        {sourceAiTransparency && <TranscriptAiRunDetails run={sourceAiTransparency} />}
        {transcriptItems.length > 0 ? <section className="transcript-results" aria-labelledby="transcript-results-title">
          {transcriptSummary && <p className="transcript-result-summary">{transcriptSummary}</p>}
          <header className="transcript-results-heading">
            <div><h2 id="transcript-results-title">Courses found</h2><p>{availableItems.length ? `${selectedCount} of ${availableItems.length} selected` : "All courses imported"}</p></div>
            {availableItems.length > 0
              ? <button className="primary-button" type="button" onClick={() => void importSelectedTranscriptCourses(selectedTranscript?.id ?? null)} disabled={Boolean(busyLabel) || selectedCount === 0}><Check size={17} /> {busyLabel === "Importing transcript courses" ? "Importing" : "Import selected"}</button>
              : <button className="secondary-button" type="button" onClick={() => openCourses("mine")}><BookOpen size={17} /> Open Done</button>}
          </header>
          <div className="transcript-course-table" role="table" aria-label="Extracted transcript courses">
            <div className="transcript-course-head" role="row">
              <span role="columnheader"><input type="checkbox" aria-label="Select all courses" checked={allSelected} onChange={toggleAll} disabled={availableItems.length === 0} /> Course</span>
              <span role="columnheader">Grade</span><span role="columnheader">Credits</span><span role="columnheader">Year</span><span role="columnheader">Status</span>
            </div>
            <div className="transcript-course-rows">{transcriptItems.map((item) => {
            const draft = reviewDrafts[item.id] ?? JSON.stringify(item.corrected_payload ?? item.proposed_payload);
            let displayPayload = item.corrected_payload ?? item.proposed_payload;
            try {
              displayPayload = JSON.parse(draft) as Record<string, unknown>;
            } catch {
              // Drafts are produced by the field editor, so this only protects older local state.
            }
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
                ? `Catalog match: ${resolution.matchedCourse?.name ?? "high school course"}`
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
              {!imported && <details className="transcript-row-editor"><summary>Edit extracted data</summary><TranscriptCourseEditor value={displayPayload as unknown as TranscriptCoursePayload} onChange={(next) => setReviewDrafts((current) => ({ ...current, [item.id]: JSON.stringify(next) }))} onIgnore={() => void saveReview(item, "rejected")} disabled={Boolean(busyLabel)} /></details>}
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
          course.credits ? formatCredits(course.credits) : "Credits to verify"
        ],
        readinessLabel: readiness.label,
        readinessTone: readiness.tone
      };
    });
    return (
      <CourseCatalogBrowser
        source="dtech"
        title="Course catalog"
        description="Courses you can still add in the selected school year."
        countLabel={filteredCourses.length ? `${catalogPage * catalogPageSize + 1}-${Math.min((catalogPage + 1) * catalogPageSize, filteredCourses.length)} of ${filteredCourses.length}` : "No courses"}
        planningContext={`Planning Grade ${activeCatalogGrade}`}
        hiddenSummary={`${catalogAvailability.hiddenTotal} unavailable courses hidden from this view`}
        filters={<>
          <label className="catalog-search-field"><span>Search courses</span><div className="catalog-search-input"><BookOpen size={16} aria-hidden /><input value={catalogSearch} onChange={(event) => { setCatalogSearch(event.target.value); setCatalogPage(0); }} placeholder="Name, subject, or prerequisite" /></div></label>
          <label><span>Subject</span><select value={catalogSubject} onChange={(event) => { setCatalogSubject(event.target.value); setCatalogPage(0); }}><option value="all">All subjects</option>{catalogAvailability.subjects.map((subject) => <option value={subject} key={subject}>{subject}</option>)}</select></label>
          <label><span>Planning year</span><select value={activeCatalogGrade} onChange={(event) => { setCatalogGrade(Number(event.target.value) as GradeLevel); setSelectedDtechCourseId(null); setCatalogPage(0); }}>{availableCatalogGrades.map((grade) => <option value={grade} key={grade}>Grade {grade}</option>)}</select></label>
        </>}
        results={results}
        selectedId={selectedDtechCourseId}
        onSelect={(id) => { const course = courseMap.get(id); if (course) chooseDtechCourse(course); }}
        emptyTitle="No matching courses"
        emptyBody="Try another search or subject. Courses already taken, below your demonstrated math level, or outside this grade stay hidden."
        sourceAction={<strong className="catalog-source-count">Official 2025-26</strong>}
        footer={<PaginationControls page={catalogPage} pageCount={catalogPageCount} onChange={setCatalogPage} label="Course catalog pages" />}
        detail={selectedDtechCourse && selectedDtechEvaluation ? <CourseDetailLayout
          identity={<span>High school</span>}
          title={selectedDtechCourse.name}
          facts={[
            { label: "Subject", value: selectedDtechCourse.subject },
            { label: "Credits", value: selectedDtechCourse.credits ? formatCredits(selectedDtechCourse.credits) : "Verify" },
            { label: "Offered", value: selectedDtechCourse.grade_levels.length ? selectedDtechCourse.grade_levels.map((grade) => `Grade ${grade}`).join(", ") : "Verify" }
          ]}
          description={selectedDtechCourse.description}
          controls={<form className="catalog-plan-controls" onSubmit={(event) => { event.preventDefault(); void addCatalogCourse(selectedDtechCourse, "planned", dtechDraft); }}>
            <label><span>School year</span><select value={dtechDraft.gradeLevel} disabled><option value={dtechDraft.gradeLevel}>Grade {dtechDraft.gradeLevel}</option></select></label>
            <label><span>Term</span><select value={dtechDraft.term} onChange={(event) => setDtechDraft({ ...dtechDraft, term: event.target.value as PlanCourse["term"] })} disabled={selectedDtechCourse.term_type !== "semester"}>{selectedDtechCourse.term_type === "semester" ? <><option value="fall">Fall</option><option value="spring">Spring</option></> : <option value="full_year">Full year</option>}</select></label>
            <button className="primary-button" type="submit" disabled={selectedDtechEvaluation.result.status === "blocked"}><Plus size={16} /> Add to plan</button>
          </form>}
        >
          <PrerequisiteReadout evaluation={selectedDtechEvaluation} />
        </CourseDetailLayout> : <div className="catalog-detail-empty"><BookOpen size={20} aria-hidden /><strong>Select a high school course</strong><p>Review the course and choose its term before adding it.</p></div>}
      />
    );
  }

  function renderGraduation() {
    if (!settings || !supabase || !session || !activeVersion) return null;
    return (
      <div className="graduation-page page-frame">
        <PageHeader title="Graduation" description="Source-backed high school diploma progress, associate-degree plans, and college gen-ed." />
        <GraduationWorkspace
          progress={fullProgress}
          onFindDtechCourses={openRequirementCourses}
          degreePlanner={<SmccdPlanner
            embedded
            surface="degree"
            supabase={supabase}
            session={session}
            settings={settings}
            activeVersion={activeVersion}
            planCourses={planCourses}
            equivalencies={equivalencies}
            onFindCourse={(course) => {
              setFocusedSmccdCourseId(course.id);
              openCourses("smccd");
            }}
          />}
          generalEducationPlanner={<SmccdPlanner
            embedded
            surface="general_education"
            supabase={supabase}
            session={session}
            settings={settings}
            activeVersion={activeVersion}
            planCourses={planCourses}
            equivalencies={equivalencies}
            onFindCourse={(course) => {
              setFocusedSmccdCourseId(course.id);
              openCourses("smccd");
            }}
          />}
        />
      </div>
    );
  }

  function renderGpa() {
    return <div className="gpa-page page-frame"><GpaPlanningLab
      rows={planCourses}
      courses={courses}
      smccdCourses={plannedSmccdCourses}
      onOpenCourses={() => openCourses("mine")}
      onScenarioChange={setGpaScenarioContext}
    /></div>;
  }

  function renderSettings() {
    if (!settings || !session) return null;
    const activeSettingsArea = settingsArea === "admin" && !isAdmin ? "general" : settingsArea;
    const descriptions: Record<SettingsArea, string> = {
      general: "Account, appearance, and student details.",
      planning: "Planning scope, college policy, and saved next steps.",
      pilot: "Pilot connection, model, review, and conversation settings.",
      admin: "Account-specific testing and workspace reset controls."
    };
    return <div className="settings-page page-frame">
      <PageHeader title="Settings" description={descriptions[activeSettingsArea]} />
      {activeSettingsArea === "admin" ? <AdminSettingsPanel
        accessToken={session.access_token}
        email={session.user.email ?? "Administrator account"}
        onReplayOnboarding={() => { setMobileNavOpen(false); setReplayingOnboarding(true); }}
        onViewLogin={() => { setMobileNavOpen(false); window.location.assign("/?demo=login"); }}
        onResetComplete={() => window.location.assign("/app?reset=1")}
      /> : <StudentSettingsPanel
        key={activeSettingsArea}
        section={activeSettingsArea}
        session={session}
        settings={settings}
        theme={theme}
        requirements={requirements}
        tasks={timelineTasks}
        enrollmentPolicies={enrollmentPolicies}
        enrollmentPreference={enrollmentPreference}
        busy={Boolean(busyLabel)}
        onSave={saveStudentSettings}
        onThemeChange={applyTheme}
        onSaveEnrollmentProgram={saveEnrollmentProgramType}
        onAiPreferencesChanged={refreshAiPreferences}
        onAddTask={addTimelineTask}
        onUpdateTask={updateTimelineTask}
        onDeleteTask={deleteTimelineTask}
      />}
    </div>;
  }

  function renderMineCourses() {
    if (!settings) return null;
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
    const generationPolicy = enrollmentPreference ? policyForPreference(enrollmentPolicies, enrollmentPreference) : null;

    return (
      <>
        {planExplanation && <p className="plan-explanation">{planExplanation}</p>}
        {planGenerationPromptOpen && <section className="plan-generation-prompt" aria-labelledby="plan-generation-heading">
          <div><h2 id="plan-generation-heading">Suggest a course plan</h2><p>Should college coursework stay at or below the district planning limit for each term?</p></div>
          <label><input type="checkbox" checked={respectUnitCapDraft} onChange={(event) => setRespectUnitCapDraft(event.target.checked)} /><span><strong>Yes, respect the limit</strong><small>{generationPolicy ? `${generationPolicy.recommended_max_units} units per term from the saved ${generationPolicy.provider_name} policy. Recommended.` : "Use the saved district policy. Recommended."}</small></span></label>
          <div><button className="secondary-button small" type="button" onClick={() => setPlanGenerationPromptOpen(false)}>Cancel</button><button className="primary-button small" type="button" onClick={() => void generatePlan(respectUnitCapDraft)} disabled={Boolean(busyLabel)}>Generate suggestions</button></div>
        </section>}
        {suggestedPlan.length > 0 && <section className="suggested-plan-preview" aria-label="Suggested plan preview">
          <div><strong>Review suggested courses</strong><p>Nothing has been added yet. Check the placements before applying this set.</p></div>
          <ul>{suggestedPlan.map((row) => <li key={`${row.course_id}-${row.grade_level}`}><span><strong>{courseMap.get(row.course_id)?.name ?? "Course"}</strong><small>Grade {row.grade_level} · {row.term === "full_year" ? "Full year" : row.term[0].toUpperCase() + row.term.slice(1)}</small></span></li>)}</ul>
          <div className="suggested-plan-actions"><button className="secondary-button small" type="button" onClick={() => setSuggestedPlan([])}>Cancel</button><button className="primary-button small" type="button" onClick={() => void confirmSuggestedPlan()} disabled={Boolean(busyLabel)}><Check size={15} /> Add {suggestedPlan.length} courses</button></div>
        </section>}
        <CourseKanban
          rows={planCourses}
          courses={courses}
          smccdCourses={plannedSmccdCourses}
          settings={settings}
          editingCourseId={editingCourseId}
          busy={Boolean(busyLabel)}
          onEditingChange={setEditingCourseId}
          onMove={movePlanCourse}
          onUpdate={(id, patch) => void updatePlanCourse(id, patch)}
          onRemove={(id) => void removePlanCourse(id)}
          onGeneratePlan={openPlanGenerationPrompt}
        />
        <details className="course-version-section">
          <summary><span><strong>Plan versions</strong><small>Save a read-only copy before a major change.</small></span><span>{snapshots.length} saved</span></summary>
          <div className="course-version-body"><button className="secondary-button small" onClick={() => void saveSnapshot()} disabled={Boolean(busyLabel)}><FloppyDisk size={15} /> Save snapshot</button>
          {snapshots.length ? <>
            <div className="compare-controls"><label className="form-field"><span>Saved version</span><select value={compareVersionId} onChange={(event) => void selectComparisonVersion(event.target.value)}><option value="">Choose a snapshot</option>{snapshots.map((version) => <option value={version.id} key={version.id}>{version.label}</option>)}</select></label><p>{compareVersionId ? "Differences below are measured against your active plan. Restoring creates a backup first." : "Choose a saved snapshot."}</p>{selectedSnapshot && <button className="secondary-button small" type="button" onClick={() => void restoreSnapshot(selectedSnapshot, compareCourses)} disabled={Boolean(busyLabel) || compareLoading || compareCourses.length === 0}>Restore as active plan</button>}</div>
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
    if (!supabase || !session || !settings || !activeVersion) return null;
    const activeEnrollmentPolicy = enrollmentPreference ? policyForPreference(enrollmentPolicies, enrollmentPreference) : null;
    const enrollmentWarnings = activeEnrollmentPolicy
      ? evaluateEnrollmentSchedule(planCourses, activeEnrollmentPolicy).filter((term) => term.state !== "within")
      : [];
    return <div className="courses-page page-frame wide">
      <PageHeader title="Courses" description="A four-year schedule for completed, current, and planned classes." actions={courseArea === "mine" && <><button className="secondary-button" type="button" onClick={() => navigate("sources")}><FileArrowUp size={17} /> Import transcript</button><button className="primary-button" type="button" onClick={() => setCourseArea("dtech")}><Plus size={17} /> Add courses</button></>} />
      <WorkspaceTabs className="course-workspace-tabs" items={[{ id: "mine", label: "My plan" }, { id: "dtech", label: "High school courses" }, { id: "smccd", label: "College courses" }]} value={courseArea} onChange={(area) => openCourses(area)} label="Courses workspace" />
      {enrollmentWarnings.length > 0 && activeEnrollmentPolicy && <aside className="enrollment-policy-callout" role="status">
        <Warning size={18} weight="fill" aria-hidden />
        <div>
          <strong>{activeEnrollmentPolicy.provider_name} unit limit needs attention</strong>
          {enrollmentWarnings.map((term) => <p key={term.key}><b>{term.term[0].toUpperCase() + term.term.slice(1)} {term.schoolYear}:</b> {term.message}</p>)}
          <small>Your saved enrollment type is {activeEnrollmentPolicy.program_type} enrollment. <a href={activeEnrollmentPolicy.source_url} target="_blank" rel="noreferrer">Review the district source</a> or change the enrollment type in Settings.</small>
        </div>
      </aside>}
      {courseArea === "mine" ? renderMineCourses() : courseArea === "dtech" ? renderDtechCatalog() : <SmccdPlanner
        embedded
        surface="courses"
        supabase={supabase}
        session={session}
        settings={settings}
        activeVersion={activeVersion}
        planCourses={planCourses}
        equivalencies={equivalencies}
        focusCourseId={focusedSmccdCourseId}
        onCourseAdded={(course, catalogCourse) => {
          setPlanCourses((current) => [...current, course]);
          if (catalogCourse) setPlannedSmccdCourses((current) => current.some((item) => item.id === catalogCourse.id) ? current : [...current, catalogCourse]);
          notifyUndo(`${course.custom_course_name ?? "College course"} added.`, async () => {
            const { error } = await supabase.from("plan_courses").delete().eq("id", course.id);
            if (error) throw error;
            setPlanCourses((current) => current.filter((row) => row.id !== course.id));
          });
        }}
        onCourseRemoved={(id) => {
          const removed = planCourses.find((row) => row.id === id);
          setPlanCourses((current) => current.filter((row) => row.id !== id));
          if (removed) notifyUndo(`${removed.custom_course_name ?? "College course"} removed.`, async () => {
            const { error } = await supabase.from("plan_courses").insert(removed);
            if (error) throw error;
            setPlanCourses((current) => [...current, removed]);
          });
        }}
        onOpenMyCourses={() => setCourseArea("mine")}
      />}
    </div>;
  }

  function renderView() {
    switch (view) {
      case "dashboard": return renderDashboard();
      case "courses": return renderCourses();
      case "sources": return renderSources();
      case "graduation": return renderGraduation();
      case "gpa": return renderGpa();
      case "settings": return renderSettings();
    }
  }

  const activeView = NAV_ITEMS.find((item) => item.id === view);
  const activeSettingsArea = settingsArea === "admin" && !isAdmin ? "general" : settingsArea;
  const visibleSettingsNavItems = isAdmin ? SETTINGS_NAV_ITEMS : SETTINGS_NAV_ITEMS.filter((item) => item.id !== "admin");
  return (
      <div className={`app-shell t3code-app ${assistantOpen ? "assistant-docked" : ""}`}>
      <AppChrome
        view={view}
        activeLabel={activeView?.label ?? "Workspace"}
        navItems={PRIMARY_NAV_ITEMS}
        school={school}
        theme={theme}
        aiEnabled={settings.ai_enabled}
        assistantOpen={assistantOpen}
        mobileNavOpen={mobileNavOpen}
        settingsNavigation={view === "settings" ? {
          activeId: activeSettingsArea,
          items: visibleSettingsNavItems,
          onNavigate: (id) => openSettings(id as SettingsArea),
          onBack: () => navigate("dashboard")
        } : undefined}
        onNavigate={navigate}
        onSettings={() => openSettings("general")}
        onMobileNavChange={setMobileNavOpen}
        onAssistantToggle={() => settings.ai_enabled ? setAssistantOpen((current) => !current) : openSettings("pilot")}
        onThemeToggle={toggleTheme}
        onSignOut={() => void signOut()}
      >
        <Suspense fallback={<LoadingWorkspace />}>{renderView()}</Suspense>
      </AppChrome>
      {assistantOpen && <Suspense fallback={null}><GlobalAssistant
        key={`${settings.ai_enabled}:${settings.ai_model}:${settings.ai_connection_approved_at ?? "off"}`}
        session={session}
        open={assistantOpen}
        pageContext={assistantPageContext}
        preferences={{ enabled: settings.ai_enabled, reviewMode: settings.ai_review_mode }}
        onClose={() => setAssistantOpen(false)}
        onDataChanged={refreshAfterAssistantChange}
      /></Suspense>}
      {toast && <div className={`toast ${toastKind}`} role={toastKind === "error" ? "alert" : "status"}>{busyLabel ? <ArrowClockwise size={16} className="spin" /> : toastKind === "success" ? <Check size={16} /> : toastKind === "error" ? <Warning size={16} /> : null}<span>{toast}</span>{toastAction && <button type="button" onClick={() => void (async () => { const action = toastAction; setToastAction(null); try { await action.run(); setToastKind("success"); setToast("Change undone."); } catch (caught) { setToastKind("error"); setToast(caught instanceof Error ? caught.message : "The change could not be undone."); } })()}>{toastAction.label}</button>}</div>}
      {busyLabel && <div className="busy-bar" role="status">{busyLabel}</div>}
      </div>
  );
}
