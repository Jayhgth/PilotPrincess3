import { ArrowClockwiseIcon as ArrowClockwise } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { BookOpenIcon as BookOpen } from "@phosphor-icons/react/dist/csr/BookOpen";
import { BuildingsIcon as Buildings } from "@phosphor-icons/react/dist/csr/Buildings";
import { ChartLineUpIcon as ChartLineUp } from "@phosphor-icons/react/dist/csr/ChartLineUp";
import { ChatCircleDotsIcon as ChatCircleDots } from "@phosphor-icons/react/dist/csr/ChatCircleDots";
import { CheckIcon as Check } from "@phosphor-icons/react/dist/csr/Check";
import { FileArrowUpIcon as FileArrowUp } from "@phosphor-icons/react/dist/csr/FileArrowUp";
import { GearSixIcon as GearSix } from "@phosphor-icons/react/dist/csr/GearSix";
import { GraduationCapIcon as GraduationCap } from "@phosphor-icons/react/dist/csr/GraduationCap";
import { HouseIcon as House } from "@phosphor-icons/react/dist/csr/House";
import { LifebuoyIcon as Lifebuoy } from "@phosphor-icons/react/dist/csr/Lifebuoy";
import { PlusIcon as Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { ShieldCheckIcon as ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { WarningIcon as Warning } from "@phosphor-icons/react/dist/csr/Warning";
import { XIcon as X } from "@phosphor-icons/react/dist/csr/X";
import type { Icon } from "@phosphor-icons/react";
import type { Session } from "@supabase/supabase-js";
import InstitutionMark from "@/components/InstitutionMark";
import InstitutionIdentityMark from "@/components/InstitutionIdentityMark";
import {
  useCallback,
  useEffect,
  lazy,
  useMemo,
  useRef,
  Suspense,
  useState,
  type SyntheticEvent
} from "react";
import {
  appliedCreditBreakdown,
  academicPeriodForDate,
  calculateGpa,
  calculateRequirementProgress,
  courseOccursInAcademicPeriod,
  courseDisplayName,
  GRADE_LEVELS,
  REQUIREMENT_LABELS,
  overallCompletedPercent,
  nextAcademicPeriod,
  selectedPlanGrades,
  schoolYearForGrade
} from "@/lib/planning";

import { orderedCourseIdsForAutomaticBoardSort } from "@/lib/course-board";
import type { GpaScenarioChoice } from "@/lib/gpa-planner";
import { COLLEGE_COURSE_SELECT, COLLEGE_DATA } from "@/lib/college-provider-contract";
import { requirementsForSettings } from "@/lib/planning";
import {
  findExistingTranscriptPlanCourse,
  resolveTranscriptCourse,
  transcriptPlanCourseDraft,
  visibleTranscriptUncertaintyNotes,
  type TranscriptCoursePayload
} from "@/lib/transcript";
import type { CoursePlacement } from "@/components/CourseKanban";
import DashboardDegreeProgress from "@/components/DashboardDegreeProgress";
import OverviewPath, { type OverviewPathData } from "@/components/OverviewPath";
import { prerequisiteDisplay } from "@/lib/prerequisite-display";
import type { TranscriptAiTransparency } from "@/components/TranscriptAiRunDetails";
import type { StudentSettingsPatch } from "@/components/StudentSettingsPanel";
import WorkspaceTabs from "@/components/WorkspaceTabs";
import type {
  CatalogReviewItem,
  Course,
  CourseDesignation,
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
  SmccdProgram,
  SmccdProgramRequirement,
  SmccdRequirementCourse,
  StudentEnrollmentPreference,
  StudentSmccdGeCompletion,
  StudentSmccdGoal,
  StudentSettings
} from "@/lib/models";
import { defaultEnrollmentPreference, evaluateEnrollmentSchedule, policyForPreference } from "@/lib/enrollment-policy";
import { hasPublicEnv } from "@/lib/env";
import { institutionKeyFromName } from "@/lib/institutions";
import { evaluateSelectedSchoolPlannerPrerequisites, evaluateSmccdPlannerPrerequisites } from "@/lib/prerequisites";
import {
  selectedSchoolCatalogEligibility,
  selectedSchoolCourseAllowsGradePlacement,
  selectedSchoolCourseGradeOptions,
  selectedSchoolCourseTermOptions
} from "@/lib/catalog-eligibility";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { normalizeWorkspaceBootstrap } from "@/lib/workspace-bootstrap";
import type { WorkspaceDomain } from "@/lib/app-capabilities";
import { cachedPlanWorkspaceSlice, loadDegreeWorkspaceSlice, loadEnrollmentWorkspaceSlice, loadPlanWorkspaceSlice, loadSettingsWorkspaceSlice } from "@/lib/workspace-refresh";
import { applyPlanCourseUpdates, commitTranscriptImport } from "@/lib/workspace-commands";
import { transcriptMimeType } from "@/lib/transcript-file";
import AppChrome from "@/components/AppChrome";
import PilotErrorBoundary from "@/components/PilotErrorBoundary";
import WorkspaceErrorBoundary from "@/components/WorkspaceErrorBoundary";
import SchoolSupportNotice from "@/components/SchoolSupportNotice";
import { LoadingView, LoadingWorkspace, PageHeader } from "@/components/workspace/WorkspaceScaffold";
import type { SchoolSupportReadiness } from "@/lib/workspace-bootstrap";

const THEME_STORAGE_KEY = "pilot-princess-theme";
const PENDING_THEME_STORAGE_KEY = "pilot-princess-theme-pending";

const loadOnboardingFlow = () => import("@/components/OnboardingFlow");
const loadGraduationWorkspace = () => import("@/components/GraduationWorkspace");
const loadSmccdPlanner = () => import("@/components/SmccdPlanner");
const loadGpaPlanningLab = () => import("@/components/GpaPlanningLab");
const loadGlobalAssistant = () => import("@/components/GlobalAssistant");
const loadCustomHighSchoolCourseForm = () => import("@/components/CustomHighSchoolCourseForm");

const OnboardingFlow = lazy(loadOnboardingFlow);
const GraduationWorkspace = lazy(loadGraduationWorkspace);
const SmccdPlanner = lazy(loadSmccdPlanner);
const GpaPlanningLab = lazy(loadGpaPlanningLab);
const GlobalAssistant = lazy(loadGlobalAssistant);
const CustomHighSchoolCourseForm = lazy(loadCustomHighSchoolCourseForm);
const SettingsDialog = lazy(() => import("@/components/SettingsDialog"));
const AdminSettingsPanel = lazy(() => import("@/components/AdminSettingsPanel"));
const CourseCatalogBrowser = lazy(() => import("@/components/CourseCatalogBrowser"));
const CourseDetailLayout = lazy(() => import("@/components/CourseDetailLayout"));
const CourseKanban = lazy(() => import("@/components/CourseKanban"));
const PlanVersionManager = lazy(() => import("@/components/PlanVersionManager"));
const TranscriptAiRunDetails = lazy(() => import("@/components/TranscriptAiRunDetails"));
const TranscriptCourseEditor = lazy(() => import("@/components/TranscriptCourseEditor"));
const StudentSettingsPanel = lazy(() => import("@/components/StudentSettingsPanel"));
const SupportSettingsPanel = lazy(() => import("@/components/SupportSettingsPanel"));
const PrerequisiteReadout = lazy(() => import("@/components/PrerequisiteReadout"));

function preloadWorkspaceView(view: WorkspaceViewId) {
  if (view === "courses") void Promise.all([import("@/components/CourseKanban"), import("@/components/PlanVersionManager"), import("@/components/CourseCatalogBrowser"), import("@/components/SmccdPlanner")]);
  if (view === "graduation") void Promise.all([loadGraduationWorkspace(), loadSmccdPlanner()]);
  if (view === "gpa") void loadGpaPlanningLab();
}

type ViewId =
  | "dashboard"
  | "courses"
  | "sources"
  | "graduation"
  | "gpa"
  | "settings";

type WorkspaceViewId = Exclude<ViewId, "settings">;

const PRIMARY_NAV_ITEMS: Array<{ id: WorkspaceViewId; label: string; icon: Icon }> = [
  { id: "dashboard", label: "Overview", icon: House },
  { id: "courses", label: "Courses", icon: BookOpen },
  { id: "graduation", label: "Graduation", icon: GraduationCap },
  { id: "gpa", label: "GPA planner", icon: ChartLineUp }
];

const NAV_ITEMS = [...PRIMARY_NAV_ITEMS, { id: "settings" as const, label: "Settings", icon: GearSix }, { id: "sources" as const, label: "Transcript import", icon: FileArrowUp }];

type CourseArea = "mine" | "dtech" | "smccd";
type SettingsArea = "general" | "pilot" | "support" | "admin";
type SourceAiTransparency = TranscriptAiTransparency;

const SETTINGS_NAV_ITEMS: Array<{ id: SettingsArea; label: string; icon: Icon }> = [
  { id: "general", label: "General", icon: GearSix },
  { id: "pilot", label: "Pilot", icon: ChatCircleDots },
  { id: "support", label: "Support", icon: Lifebuoy },
  { id: "admin", label: "Admin", icon: ShieldCheck }
];

const SETTINGS_DESCRIPTIONS: Record<SettingsArea, string> = {
  general: "Account and student details.",
  pilot: "Model, reasoning, change access, and conversation settings.",
  support: "Contact administrators about support, bugs, or course data.",
  admin: "Account-specific testing and workspace reset controls."
};

const VIEW_IDS = new Set<ViewId>(["dashboard", "courses", "sources", "graduation", "gpa", "settings"]);
const COURSE_AREAS = new Set<CourseArea>(["mine", "dtech", "smccd"]);
const SETTINGS_AREAS = new Set<SettingsArea>(["general", "pilot", "support", "admin"]);

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

function mergeRowsById<T extends { id: string }>(current: T[], incoming: T[]) {
  const incomingById = new Map(incoming.map((row) => [row.id, row]));
  const currentIds = new Set(current.map((row) => row.id));
  return [
    ...current.map((row) => incomingById.get(row.id) ?? row),
    ...incoming.filter((row) => !currentIds.has(row.id))
  ];
}

export default function PlanningWorkspace() {
  const configured = hasPublicEnv();
  const supabase = useMemo(() => (configured && typeof window !== "undefined" ? getBrowserSupabase() : null), [configured]);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [toastKind, setToastKind] = useState<"info" | "success" | "error">("info");
  const [toastAction, setToastAction] = useState<{ label: string; run: () => Promise<void> } | null>(null);
  const [view, setView] = useState<ViewId>(() => locationState().view);
  const [lastWorkspaceView, setLastWorkspaceView] = useState<WorkspaceViewId>(() => {
    const initialView = locationState().view;
    return initialView === "settings" ? "dashboard" : initialView;
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [replayingOnboarding, setReplayingOnboarding] = useState(false);
  const [unitWarningHidden, setUnitWarningHidden] = useState(() => typeof window !== "undefined" && sessionStorage.getItem("pilot-hide-unit-warning") === "true");
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light"
  );
  const themeWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const gpaSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const themeIntentVersion = useRef(0);
  const [courseArea, setCourseArea] = useState<CourseArea>(() => locationState().courseArea);
  const [settingsArea, setSettingsArea] = useState<SettingsArea>(() => locationState().settingsArea);
  const [gpaScenarioChoices, setGpaScenarioChoices] = useState<GpaScenarioChoice[]>([]);
  const [selectedDtechCourseId, setSelectedDtechCourseId] = useState<string | null>(null);
  const [focusedSmccdCourseId, setFocusedSmccdCourseId] = useState<string | null>(null);
  const [dtechDraft, setDtechDraft] = useState<{ gradeLevel: GradeLevel; term: PlanCourse["term"] }>({ gradeLevel: 9, term: "full_year" });

  const [school, setSchool] = useState<School | null>(null);
  const [schoolSupport, setSchoolSupport] = useState<SchoolSupportReadiness>({ level: "discovery", catalog_supported: false, diploma_supported: false, planning_supported: false, last_source_update: null });
  const [settings, setSettings] = useState<StudentSettings | null>(null);
  const [sources, setSources] = useState<OfficialSource[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [requirements, setRequirements] = useState<GraduationRequirement[]>([]);
  const [courseDesignations, setCourseDesignations] = useState<CourseDesignation[]>([]);
  const [mappings, setMappings] = useState<CourseRequirementMapping[]>([]);
  const [equivalencies, setEquivalencies] = useState<SmccdHighSchoolEquivalency[]>([]);
  const [plannedSmccdCourses, setPlannedSmccdCourses] = useState<SmccdCourse[]>([]);
  const [plan, setPlan] = useState<FourYearPlan | null>(null);
  const [activeVersion, setActiveVersion] = useState<PlanVersion | null>(null);
  const [planVersionRevision, setPlanVersionRevision] = useState(0);
  const [planCourses, setPlanCourses] = useState<PlanCourse[]>([]);
  const [reviewItems, setReviewItems] = useState<CatalogReviewItem[]>([]);
  const [enrollmentPolicies, setEnrollmentPolicies] = useState<EnrollmentPolicy[]>([]);
  const [enrollmentPreference, setEnrollmentPreference] = useState<StudentEnrollmentPreference | null>(null);
  const [degreeGoals, setDegreeGoals] = useState<StudentSmccdGoal[]>([]);
  const [degreePrograms, setDegreePrograms] = useState<SmccdProgram[]>([]);
  const [degreeRequirements, setDegreeRequirements] = useState<SmccdProgramRequirement[]>([]);
  const [degreeRequirementCourses, setDegreeRequirementCourses] = useState<SmccdRequirementCourse[]>([]);
  const [manualSmccdCompletions, setManualSmccdCompletions] = useState<StudentSmccdGeCompletion[]>([]);

  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogSubject, setCatalogSubject] = useState("all");
  const [catalogGrade, setCatalogGrade] = useState<GradeLevel | "all">("all");
  const [sourceForm, setSourceForm] = useState({ file: null as File | null });
  const [sourceAiTransparency, setSourceAiTransparency] = useState<SourceAiTransparency | null>(null);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, string>>({});
  const [selectedTranscriptIds, setSelectedTranscriptIds] = useState<Set<string>>(new Set());
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
  const gpa = useMemo(() => calculateGpa(planCourses, equivalencies), [planCourses, equivalencies]);
  const graduationEarnedPercent = useMemo(() => overallCompletedPercent(fullProgress), [fullProgress]);
  const availableCatalogGrades = useMemo(() => settings ? selectedPlanGrades(settings) : [], [settings]);
  const activeCatalogGrade = (catalogGrade !== "all" && availableCatalogGrades.includes(catalogGrade)
    ? catalogGrade
    : availableCatalogGrades[0] ?? settings?.grade_level ?? 9) as GradeLevel;
  const catalogAvailability = useMemo(() => {
    const eligibilityById = new Map(courses.map((course) => [
      course.id,
      selectedSchoolCatalogEligibility(course, activeCatalogGrade, planCourses, courses, { schoolSlug: school?.slug })
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
  }, [activeCatalogGrade, courses, planCourses, school?.slug]);
  const filteredCourses = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase();
    return catalogAvailability.eligibleCourses.filter((course) => (
      (!query || [course.name, course.subject, course.description ?? "", course.prerequisites.join(" ")].join(" ").toLowerCase().includes(query)) &&
      (catalogSubject === "all" || course.subject === catalogSubject)
    )).sort((a, b) => a.name.localeCompare(b.name));
  }, [catalogAvailability.eligibleCourses, catalogSearch, catalogSubject]);
  const defaultDtechPlacement = useCallback((course: Course, preferredGrade?: GradeLevel) => {
    const currentGrade = preferredGrade ?? (catalogGrade === "all" ? undefined : catalogGrade) ?? (settings?.grade_level ?? 9) as GradeLevel;
    const allowedGrades = selectedSchoolCourseGradeOptions(course, availableCatalogGrades);
    const gradeLevel = allowedGrades.find((grade) => grade >= currentGrade) ?? allowedGrades.at(-1) ?? currentGrade;
    const term = selectedSchoolCourseTermOptions(course, gradeLevel)[0] ?? "full_year";
    return { gradeLevel, term };
  }, [availableCatalogGrades, catalogGrade, settings?.grade_level]);
  const selectedDtechCourse = selectedDtechCourseId ? courseMap.get(selectedDtechCourseId) ?? null : null;
  const selectedDtechGradeOptions = selectedDtechCourse
    ? selectedSchoolCourseGradeOptions(selectedDtechCourse, availableCatalogGrades)
    : [];
  const selectedDtechTermOptions = selectedDtechCourse
    ? selectedSchoolCourseTermOptions(selectedDtechCourse, dtechDraft.gradeLevel)
    : [];
  const selectedDtechEvaluation = selectedDtechCourse
    ? evaluateSelectedSchoolPlannerPrerequisites(
        selectedDtechCourse,
        dtechDraft,
        courses,
        planCourses,
        plannedSmccdCourses,
        equivalencies
      )
    : null;
  const dtechCatalogResults = useMemo(() => filteredCourses.map((course) => {
    const evaluation = evaluateSelectedSchoolPlannerPrerequisites(
      course,
      defaultDtechPlacement(course, activeCatalogGrade),
      courses,
      planCourses,
      plannedSmccdCourses,
      equivalencies
    );
    const readiness = prerequisiteDisplay(evaluation);
    const designationLabels = courseDesignations
      .filter((designation) => designation.course_id === course.id)
      .map((designation) => designation.designation === "ap" ? "AP" : designation.designation === "ib" ? "IB" : designation.designation === "uc_honors" ? "UC honors" : designation.designation === "school_honors" ? "Honors" : designation.designation === "cte" ? "CTE" : "Dual enrollment");
    return {
      id: course.id,
      title: course.name,
      metadata: [
        course.subject,
        course.credits ? formatCredits(course.credits) : "Credits to verify",
        ...designationLabels
      ],
      readinessLabel: readiness.label,
      readinessTone: readiness.tone
    };
  }), [activeCatalogGrade, courseDesignations, courses, defaultDtechPlacement, equivalencies, filteredCourses, planCourses, plannedSmccdCourses]);
  const plannedSmccdMap = useMemo(() => new Map(plannedSmccdCourses.map((course) => [course.id, course])), [plannedSmccdCourses]);
  useEffect(() => () => {
    if (gpaSaveTimer.current) clearTimeout(gpaSaveTimer.current);
  }, []);
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
      let snapshotResult = await supabase.rpc("get_workspace_snapshot_v1");
      if (snapshotResult.error) throw snapshotResult.error;
      let bootstrap = normalizeWorkspaceBootstrap(snapshotResult.data);
      if (!bootstrap.settings || !bootstrap.plan || !bootstrap.school || !bootstrap.active_version) {
        const provision = await supabase.rpc("ensure_current_user_workspace_v1");
        if (provision.error) throw provision.error;
        snapshotResult = await supabase.rpc("get_workspace_snapshot_v1");
        if (snapshotResult.error) throw snapshotResult.error;
        bootstrap = normalizeWorkspaceBootstrap(snapshotResult.data);
      }
      const userId = sessionData.session.user.id;
      const loadedPlan = bootstrap.plan;
      const rawSettings = bootstrap.settings;
      if (!rawSettings || !loadedPlan || !bootstrap.school) {
        throw new Error("Choose a California high school before opening the workspace.");
      }
      const loadedActiveVersion = bootstrap.active_version;

      const loadedSettings: StudentSettings = {
        ...rawSettings,
        ai_enabled: rawSettings.ai_enabled ?? false,
        ai_model: rawSettings.ai_model ?? "gpt-5.6-luna",
        ai_reasoning_effort: rawSettings.ai_reasoning_effort ?? "low",
        ai_connection_approved_at: rawSettings.ai_connection_approved_at ?? null,
        ai_setup_tested_at: rawSettings.ai_setup_tested_at ?? null
      };
      const pendingTheme = localStorage.getItem(PENDING_THEME_STORAGE_KEY);
      const hasPendingTheme = pendingTheme === "light" || pendingTheme === "dark";
      const loadedTheme = hasPendingTheme ? pendingTheme : loadedSettings.ui_theme ?? "light";
      if (hasPendingTheme && loadedSettings.ui_theme !== loadedTheme) {
        const pendingUpdate = await supabase.from("student_settings").update({ ui_theme: loadedTheme }).eq("id", userId).select("ui_theme").single();
        if (!pendingUpdate.error) {
          loadedSettings.ui_theme = loadedTheme;
          localStorage.removeItem(PENDING_THEME_STORAGE_KEY);
        }
      } else if (hasPendingTheme) {
        localStorage.removeItem(PENDING_THEME_STORAGE_KEY);
      }
      setTheme(loadedTheme);
      document.documentElement.dataset.theme = loadedTheme;
      localStorage.setItem(THEME_STORAGE_KEY, loadedTheme);
      setSchool(bootstrap.school);
      setSchoolSupport(bootstrap.school_support);
      setSettings(loadedSettings);
      const loadedSources = bootstrap.sources;
      setSources(loadedSources);
      setCourses(bootstrap.courses);
      setRequirements(bootstrap.requirements);
      setCourseDesignations(bootstrap.course_designations);
      setMappings(bootstrap.mappings);
      setEquivalencies(bootstrap.equivalencies);
      setPlan(loadedPlan);
      setActiveVersion(loadedActiveVersion);
      const loadedPlanCourses = bootstrap.plan_courses;
      const loadedReviewItems = bootstrap.review_items;
      setPlanCourses(loadedPlanCourses);
      setGpaScenarioChoices(bootstrap.gpa_scenario_choices.map((choice) => ({
        planCourseId: choice.plan_course_id,
        included: choice.included,
        expectedGrade: choice.expected_grade
      })));
      setPlannedSmccdCourses(bootstrap.planned_smccd_courses);
      setReviewItems(loadedReviewItems);
      setEnrollmentPolicies(bootstrap.enrollment_policies);
      setEnrollmentPreference(
        bootstrap.enrollment_preference
          ? {
              ...bootstrap.enrollment_preference,
              limit_mode: "recommended",
              custom_unit_limit: null,
              respect_recommended_limit: bootstrap.enrollment_preference.respect_recommended_limit !== false
            }
          : defaultEnrollmentPreference(
              userId,
              bootstrap.college_district?.policy_provider_code
                ?? bootstrap.college_district_preference?.district_code
                ?? "SMCCD"
            )
      );
      setIsAdmin(bootstrap.is_admin);
      setDegreeGoals(bootstrap.degree_goals);
      setDegreePrograms(bootstrap.degree_programs);
      setDegreeRequirements(bootstrap.degree_requirements);
      setDegreeRequirementCourses(bootstrap.degree_requirement_courses);
      setManualSmccdCompletions(bootstrap.manual_smccd_completions);
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

  const openActivePlanVersion = useCallback(async (nextVersion: PlanVersion) => {
    if (!supabase || !session) return;
    setActiveVersion(nextVersion);
    setPlanVersionRevision((current) => current + 1);
    const cached = cachedPlanWorkspaceSlice(nextVersion.id);
    if (cached) {
      setPlanCourses(cached.planCourses);
      if (!cached.collegeCatalogError) setPlannedSmccdCourses(cached.plannedCollegeCourses);
      setGpaScenarioChoices(cached.gpaChoices as GpaScenarioChoice[]);
    }
    try {
      const slice = await loadPlanWorkspaceSlice(supabase, session.user.id, nextVersion.id);
      setPlanCourses(slice.planCourses);
      if (!slice.collegeCatalogError) setPlannedSmccdCourses(slice.plannedCollegeCourses);
      setGpaScenarioChoices(slice.gpaChoices as GpaScenarioChoice[]);
      if (slice.collegeCatalogError) {
        setToastKind("info");
        setToast("The plan opened. College catalog details will refresh automatically when the provider is available.");
      }
    } catch {
      await refreshWorkspaceSilently();
    }
  }, [refreshWorkspaceSilently, session, supabase]);

  async function refreshAfterAssistantChange(domains: WorkspaceDomain[] = []) {
    if (!supabase || !session || !activeVersion) return;
    const requested = new Set(domains);
    if (requested.has("history") || requested.has("plan")) setPlanVersionRevision((current) => current + 1);
    if (requested.size === 0 || requested.has("institution") || requested.has("transcript") || requested.has("active_plan")) {
      await refreshWorkspaceSilently();
      return;
    }
    try {
      const tasks: Promise<void>[] = [];
      if (["plan", "graduation", "gpa", "college"].some((domain) => requested.has(domain as WorkspaceDomain))) {
        tasks.push(loadPlanWorkspaceSlice(supabase, session.user.id, activeVersion.id).then((slice) => {
          setPlanCourses(slice.planCourses);
          // The owned plan is the source of truth for immediate UI state. A
          // transient provider-catalog failure must not make an applied Pilot
          // change look missing until reload; retain the previous course
          // metadata and refresh it on the next successful read instead.
          if (!slice.collegeCatalogError) setPlannedSmccdCourses(slice.plannedCollegeCourses);
          setGpaScenarioChoices(slice.gpaChoices as GpaScenarioChoice[]);
          if (slice.collegeCatalogError) {
            setToastKind("info");
            setToast("The plan updated. College catalog details will refresh automatically when the provider is available.");
          }
        }));
      }
      if (["identity", "settings", "pilot"].some((domain) => requested.has(domain as WorkspaceDomain))) {
        tasks.push(loadSettingsWorkspaceSlice(supabase, session.user.id).then((nextSettings) => {
          setSettings(nextSettings);
          if (nextSettings.ui_theme && nextSettings.ui_theme !== theme) {
            localStorage.removeItem(PENDING_THEME_STORAGE_KEY);
            applyTheme(nextSettings.ui_theme);
          }
        }));
      }
      if (requested.has("degree")) {
        tasks.push(loadDegreeWorkspaceSlice(supabase, session.user.id, activeVersion.plan_id).then((slice) => {
          setDegreeGoals(slice.goals);
          setDegreePrograms(slice.programs);
          setDegreeRequirements(slice.requirements);
          setDegreeRequirementCourses(slice.requirementCourses);
          setManualSmccdCompletions(slice.manualCompletions);
        }));
      }
      if (requested.has("enrollment")) {
        const providerCode = enrollmentPreference?.provider_code ?? "SMCCD";
        tasks.push(loadEnrollmentWorkspaceSlice(supabase, session.user.id, providerCode).then((preference) => {
          if (preference) setEnrollmentPreference({ ...preference, limit_mode: "recommended", custom_unit_limit: null });
        }));
      }
      await Promise.all(tasks);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The changed workspace area could not refresh.";
      setToastKind("error");
      setToast(`The change was applied, but the workspace could not refresh: ${message}`);
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
      if (next.view !== "settings") setLastWorkspaceView(next.view);
      setCourseArea(next.courseArea);
      setSettingsArea(next.settingsArea);
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

  async function refreshTranscriptState(sourceId: string) {
    if (!supabase || !activeVersion) return;
    const [sourceResult, reviewResult, planCourseResult] = await Promise.all([
      supabase.from("official_sources").select("*").eq("id", sourceId).single(),
      supabase.from("catalog_review_items").select("*").eq("source_id", sourceId).order("created_at", { ascending: false }),
      supabase.from("plan_courses").select("*").eq("plan_version_id", activeVersion.id).order("grade_level").order("sort_order")
    ]);
    const error = sourceResult.error ?? reviewResult.error ?? planCourseResult.error;
    if (error) throw error;
    const refreshedSource = sourceResult.data as unknown as OfficialSource;
    const refreshedReviewItems = (reviewResult.data ?? []) as unknown as CatalogReviewItem[];
    setSources((current) => current.some((source) => source.id === sourceId)
      ? current.map((source) => source.id === sourceId ? refreshedSource : source)
      : [...current, refreshedSource]);
    setReviewItems((current) => [
      ...current.filter((item) => item.source_id !== sourceId),
      ...refreshedReviewItems
    ]);
    setPlanCourses((planCourseResult.data ?? []) as unknown as PlanCourse[]);
  }

  function syncLocation(nextView: ViewId, nextCourseArea = courseArea, nextSettingsArea = settingsArea, mode: "push" | "replace" = "push") {
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
    window.history[mode === "replace" ? "replaceState" : "pushState"]({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function navigate(nextView: ViewId) {
    setView(nextView);
    if (nextView !== "settings") setLastWorkspaceView(nextView);
    setMobileNavOpen(false);
    syncLocation(nextView);
    void logEvent("view_opened", { view: nextView });
  }

  function openSettings(area: SettingsArea = "general") {
    const settingsWereOpen = view === "settings";
    setSettingsArea(area);
    setView("settings");
    setMobileNavOpen(false);
    syncLocation("settings", courseArea, area, settingsWereOpen ? "replace" : "push");
    void logEvent("view_opened", { view: "settings", settings_area: area });
  }

  function closeSettings() {
    setView(lastWorkspaceView);
    setMobileNavOpen(false);
    syncLocation(lastWorkspaceView, courseArea, settingsArea, "replace");
  }

  function openCourses(area: CourseArea = "mine") {
    setCourseArea(area);
    setView("courses");
    setLastWorkspaceView("courses");
    setMobileNavOpen(false);
    syncLocation("courses", area);
    void logEvent("view_opened", { view: "courses", course_area: area });
  }

  function openGraduationView(area: "diploma" | "degree" = "diploma") {
    setView("graduation");
    setLastWorkspaceView("graduation");
    setMobileNavOpen(false);
    const url = new URL(window.location.href);
    url.searchParams.set("view", "graduation");
    if (area === "degree") url.searchParams.set("graduation", "degree");
    else url.searchParams.delete("graduation");
    url.searchParams.delete("course");
    url.searchParams.delete("college");
    url.searchParams.delete("settings");
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
    void logEvent("view_opened", { view: "graduation", graduation_area: area });
  }

  function openRequirementCourses(area: GraduationRequirement["area"]) {
    setCatalogSubject(REQUIREMENT_LABELS[area]);
    setCatalogSearch("");
    openCourses("dtech");
  }

  function applyTheme(nextTheme: "light" | "dark") {
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  }

  function toggleTheme() {
    const nextTheme = theme === "light" ? "dark" : "light";
    const intentVersion = ++themeIntentVersion.current;
    localStorage.setItem(PENDING_THEME_STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
    setSettings((current) => current ? { ...current, ui_theme: nextTheme } : current);
    if (!supabase || !session) return;
    const userId = session.user.id;
    const write = themeWriteQueue.current.then(async () => {
      const result = await supabase.from("student_settings").update({ ui_theme: nextTheme }).eq("id", userId).select("ui_theme").single();
      if (result.error) throw result.error;
      if (themeIntentVersion.current === intentVersion) {
        localStorage.removeItem(PENDING_THEME_STORAGE_KEY);
        setSettings((current) => current ? { ...current, ui_theme: result.data.ui_theme as "light" | "dark" } : current);
      }
    });
    themeWriteQueue.current = write.catch((caught) => {
      if (themeIntentVersion.current !== intentVersion) return;
      // Keep the newest local choice when a reload aborts the request. The
      // pending value is retried during the next workspace bootstrap.
      applyTheme(nextTheme);
      setSettings((current) => current ? { ...current, ui_theme: nextTheme } : current);
      notify(caught instanceof Error ? `${caught.message} The theme will retry when the app reopens.` : "The theme will retry when the app reopens.", "info");
    });
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    window.location.assign("/");
  }

  function chooseDtechCourse(course: Course) {
    setSelectedDtechCourseId(course.id);
    setDtechDraft(defaultDtechPlacement(course));
  }

  function selectDtechGrade(gradeLevel: GradeLevel) {
    if (!selectedDtechCourse) return;
    const terms = selectedSchoolCourseTermOptions(selectedDtechCourse, gradeLevel);
    setDtechDraft((current) => ({
      gradeLevel,
      term: terms.includes(current.term) ? current.term : terms[0] ?? "full_year"
    }));
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
    const eligibility = selectedSchoolCatalogEligibility(course, grade, planCourses, courses, { schoolSlug: school?.slug });
    if (!eligibility.eligible) {
      notify(eligibility.reason === "outside_grade"
        ? `${course.name} is not offered for grade ${grade}.`
        : eligibility.reason === "below_math_level"
          ? `${course.name} is below the math level already demonstrated in this plan.`
          : "That course is already represented in the current plan.");
      return;
    }
    const evaluation = evaluateSelectedSchoolPlannerPrerequisites(course, placement, courses, planCourses, plannedSmccdCourses, equivalencies);
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

  function movePlanCourse(row: PlanCourse, placement: CoursePlacement) {
    if (!settings || !supabase) return false;
    if (row.source_review_item_id || row.status === "completed") {
      notify("Completed and transcript-backed courses stay locked in their recorded term.");
      return false;
    }
    const dtechCourse = row.course_id ? courseMap.get(row.course_id) : null;
    if (dtechCourse && !selectedSchoolCourseAllowsGradePlacement(dtechCourse, placement.gradeLevel)) {
      notify(`${dtechCourse.name} is not offered for grade ${placement.gradeLevel}.`);
      return false;
    }
    if (dtechCourse) {
      const evaluation = evaluateSelectedSchoolPlannerPrerequisites(
        dtechCourse,
        { gradeLevel: placement.gradeLevel, term: placement.term, instanceId: row.id },
        courses,
        planCourses,
        plannedSmccdCourses,
        equivalencies
      );
      if (evaluation.result.status === "blocked") {
        notify("That year would place this course before its prerequisite.");
        return false;
      }
    }
    const smccdCourse = row.smccd_course_id ? plannedSmccdCourses.find((course) => course.id === row.smccd_course_id) : null;
    if (smccdCourse) {
      const evaluation = evaluateSmccdPlannerPrerequisites(
        smccdCourse,
        { gradeLevel: placement.gradeLevel, term: placement.term, instanceId: row.id },
        plannedSmccdCourses,
        planCourses,
        courses
      );
      if (evaluation.result.status === "blocked") {
        notify("That year would place this course before its prerequisite.");
        return false;
      }
    }
    const previousRows = planCourses;
    const orderById = new Map(placement.orderedCourseIds.map((id, index) => [id, index]));
    const activePatch: Partial<PlanCourse> = {
      status: placement.status,
      grade_level: placement.gradeLevel,
      school_year: schoolYearForGrade(settings.graduation_year ?? new Date().getFullYear() + 3, placement.gradeLevel),
      term: placement.term,
      sort_order: orderById.get(row.id) ?? placement.orderedCourseIds.length,
      ...(placement.status === "completed" ? {} : { letter_grade: null })
    };
    const nextRows = previousRows.map((candidate) => {
      const sortOrder = orderById.get(candidate.id);
      if (candidate.id === row.id) return { ...candidate, ...activePatch, user_edited: true };
      return sortOrder === undefined ? candidate : { ...candidate, sort_order: sortOrder };
    });
    const previousById = new Map(previousRows.map((candidate) => [candidate.id, candidate]));
    const changedRows = nextRows.filter((candidate) => {
      const previous = previousById.get(candidate.id);
      return previous && (
        previous.grade_level !== candidate.grade_level
        || previous.school_year !== candidate.school_year
        || previous.term !== candidate.term
        || previous.status !== candidate.status
        || previous.sort_order !== candidate.sort_order
        || previous.letter_grade !== candidate.letter_grade
        || previous.user_edited !== candidate.user_edited
      );
    });
    if (changedRows.length === 0) return false;

    setPlanCourses(nextRows);
    void runAction(`Moving ${courseDisplayName(row, courseMap)}`, async () => {
      await applyPlanCourseUpdates(supabase, changedRows);
      void logEvent("plan_edited", {
        action: "move_course",
        plan_course_id: row.id,
        grade_level: placement.gradeLevel,
        term: placement.term
      });
      return true;
    }).then((succeeded) => {
      if (!succeeded) {
        setPlanCourses(previousRows);
        return;
      }
      const placementTerm = placement.term === "full_year"
        ? "full year"
        : `${placement.term.charAt(0).toUpperCase()}${placement.term.slice(1)}`;
      notifyUndo(`${courseDisplayName(row, courseMap)} moved to Grade ${placement.gradeLevel}, ${placementTerm}.`, async () => {
        const restoreRows = changedRows.flatMap((candidate) => {
          const previous = previousById.get(candidate.id);
          return previous ? [previous] : [];
        });
        await applyPlanCourseUpdates(supabase, restoreRows);
        const restoreById = new Map(restoreRows.map((candidate) => [candidate.id, candidate]));
        setPlanCourses((current) => current.map((candidate) => restoreById.get(candidate.id) ?? candidate));
      });
    });
    return true;
  }

  function sortPlanCourses() {
    if (!supabase) return;
    const previousRows = planCourses;
    const previousById = new Map(previousRows.map((row) => [row.id, row]));
    const orderById = new Map<string, number>();
    for (const grade of GRADE_LEVELS) {
      orderedCourseIdsForAutomaticBoardSort(previousRows, grade).forEach((id, index) => orderById.set(id, index));
    }
    const nextRows = previousRows.map((row) => ({ ...row, sort_order: orderById.get(row.id) ?? row.sort_order }));
    const changedRows = nextRows.filter((row) => previousById.get(row.id)?.sort_order !== row.sort_order);
    if (changedRows.length === 0) {
      notify("Courses are already sorted with college courses first and pass/fail courses last.");
      return;
    }

    setPlanCourses(nextRows);
    void runAction("Sorting courses", async () => {
      await applyPlanCourseUpdates(supabase, changedRows);
      void logEvent("plan_edited", { action: "sort_courses", order: "college_first_pass_fail_last" });
      return true;
    }).then((succeeded) => {
      if (!succeeded) {
        setPlanCourses(previousRows);
        return;
      }
      notifyUndo("Courses sorted with college courses first and pass/fail courses last.", async () => {
        const changedIds = new Set(changedRows.map((row) => row.id));
        const restoreRows = changedRows.flatMap((row) => {
          const previous = previousById.get(row.id);
          return previous ? [previous] : [];
        });
        await applyPlanCourseUpdates(supabase, restoreRows);
        setPlanCourses((current) => current.map((row) => changedIds.has(row.id) ? previousById.get(row.id) ?? row : row));
      });
    });
  }

  async function removePlanCourse(id: string) {
    if (!supabase) return;
    const removed = planCourses.find((row) => row.id === id);
    if (!removed) return;
    if (removed.source_review_item_id) {
      notify("Transcript-backed courses must be corrected through transcript review.");
      return;
    }
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
        const mimeType = transcriptMimeType(file.type, file.name);
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
          await refreshTranscriptState(data.id);
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
        await refreshTranscriptState(source.id);
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
        const ids = prepared.map(({ item }) => item.id);
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
        const committed = await commitTranscriptImport(supabase, {
          planVersionId: activeVersion.id,
          approvedIds: ids,
          corrections: prepared.filter(({ item }) => Boolean(reviewDrafts[item.id])).map(({ item, payload }) => ({ id: item.id, payload })),
          planRows: planUpserts
        });
        const savedPlanRows = committed.rows;
        await logEvent("transcript_courses_imported", { review_item_ids: ids, course_count: prepared.length });
        setPlanCourses((current) => mergeRowsById(current, savedPlanRows));
        setReviewItems((current) => current.map((item) => {
          const preparedItem = prepared.find((candidate) => candidate.item.id === item.id);
          return preparedItem ? { ...item, corrected_payload: reviewDrafts[item.id] ? preparedItem.payload : item.corrected_payload, status: "approved" } : item;
        }));
        const smccdIds = [...new Set(savedPlanRows.map((row) => row.smccd_course_id).filter((id): id is string => Boolean(id)))];
        if (smccdIds.length > 0) {
          const { data: smccdRows, error: smccdError } = await supabase.from(COLLEGE_DATA.courses).select(COLLEGE_COURSE_SELECT).in("id", smccdIds);
          if (smccdError) throw smccdError;
          setPlannedSmccdCourses((current) => mergeRowsById(current, (smccdRows ?? []) as unknown as SmccdCourse[]));
        }
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
    const nextSettings = data as unknown as StudentSettings;
    setSettings(nextSettings);
    if (nextSettings.ui_theme && nextSettings.ui_theme !== theme) {
      localStorage.removeItem(PENDING_THEME_STORAGE_KEY);
      applyTheme(nextSettings.ui_theme);
    }
    await logEvent("student_settings_updated", { fields: Object.keys(normalizedPatch) });
  }

  async function refreshAiPreferences() {
    if (!supabase || !session) return;
    const { data, error } = await supabase.from("student_settings").select("ai_enabled, ai_model, ai_reasoning_effort, ai_connection_approved_at, ai_setup_tested_at").eq("id", session.user.id).single();
    if (error) throw error;
    setSettings((current) => current ? {
      ...current,
      ai_enabled: data.ai_enabled,
      ai_model: data.ai_model as StudentSettings["ai_model"],
      ai_reasoning_effort: data.ai_reasoning_effort as StudentSettings["ai_reasoning_effort"],
      ai_connection_approved_at: data.ai_connection_approved_at,
      ai_setup_tested_at: data.ai_setup_tested_at
    } : current);
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
          courses={courses}
          mappings={mappings}
          equivalencies={equivalencies}
          activeVersion={activeVersion}
          existingPlanCourses={planCourses}
          theme={theme}
          mode={replayingOnboarding ? "replay" : "initial"}
          onComplete={async () => {
            await refreshWorkspaceSilently();
            if (replayingOnboarding) {
              setReplayingOnboarding(false);
              setView("dashboard");
              setLastWorkspaceView("dashboard");
              syncLocation("dashboard");
              notify("Onboarding changes saved.", "success");
            }
          }}
          onExit={replayingOnboarding ? () => {
            setReplayingOnboarding(false);
            setView("dashboard");
            setLastWorkspaceView("dashboard");
            syncLocation("dashboard");
            notify("Onboarding exited without saving changes.");
          } : undefined}
          onSignOut={signOut}
          onThemeToggle={toggleTheme}
        />
      </Suspense>
    );
  }

  function renderDashboard() {
    if (!settings || !supabase || !session || !school) return null;
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
    const earnedPercent = graduationEarnedPercent;
    const overviewCourse = (row: PlanCourse) => {
      const collegeCode = row.smccd_course_id ? plannedSmccdMap.get(row.smccd_course_id)?.college_code : null;
      const isCollegeCourse = Boolean(row.smccd_course_id || row.college_provider_code || Number(row.college_units ?? 0) > 0);
      const isMissingSelectedSchoolCourse = Boolean(row.course_id && !courseMap.has(row.course_id));
      return {
        id: row.id,
        name: courseDisplayName(row, courseMap),
        source: collegeCode ?? (isCollegeCourse ? "College" : isMissingSelectedSchoolCourse ? "Needs review" : school?.short_name ?? "High school"),
        institution: collegeCode ?? (isCollegeCourse ? "smccd" : isMissingSelectedSchoolCourse ? "unverified" : "high-school")
      };
    };
    const currentPeriod = academicPeriodForDate();
    const upcomingPeriod = nextAcademicPeriod(currentPeriod);
    const periodCourses = (period: typeof currentPeriod) => planCourses
      .filter((row) => row.status !== "completed" && courseOccursInAcademicPeriod(row, period))
      .sort((left, right) => Number(Boolean(right.smccd_course_id)) - Number(Boolean(left.smccd_course_id)) || left.sort_order - right.sort_order)
      .map(overviewCourse);
    const overviewData: OverviewPathData = {
      earnedPercent,
      completedCredits: dashboardCredits.completed,
      scheduledCredits: dashboardCredits.scheduled,
      remainingCredits: dashboardCredits.remaining,
      currentWeightedGpa: formatGpa(gpa.currentWeighted),
      currentUnweightedGpa: formatGpa(gpa.currentUnweighted),
      currentGradedCredits: gpa.currentGradedCredits,
      currentWeightedCredits: gpa.currentWeightedCredits,
      requirements: overviewRequirements,
      requirementsVerified: overviewRequirements.length > 0,
      currentPeriodLabel: currentPeriod.label,
      nextPeriodLabel: upcomingPeriod.label,
      currentCourses: periodCourses(currentPeriod),
      plannedCourses: periodCourses(upcomingPeriod)
    };
    return (
      <div className="dashboard-page page-frame">
        <PageHeader title={settings.preferred_name ? `Good to see you, ${settings.preferred_name}` : "Planning overview"} />
        <SchoolSupportNotice support={schoolSupport} schoolName={school.name} onOpenSettings={() => openSettings("general")} />
        <OverviewPath
          data={overviewData}
          degreeProgress={<DashboardDegreeProgress
            planCourses={planCourses}
            plannedSmccdCourses={plannedSmccdCourses}
            goals={degreeGoals}
            programs={degreePrograms}
            requirements={degreeRequirements}
            requirementCourses={degreeRequirementCourses}
            manualCompletions={manualSmccdCompletions}
            onOpen={() => openGraduationView("degree")}
          />}
          onOpenGraduation={() => openGraduationView("diploma")}
          onOpenCourses={() => openCourses("mine")}
          onOpenGpa={() => navigate("gpa")}
          onOpenDegrees={() => openGraduationView("degree")}
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
              : (resolution.classification === "dtech_catalog" || resolution.classification === "high_school_catalog") && !displayPayload.matched_course_id
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
              {!imported && <details className="transcript-row-editor"><summary>Edit extracted data</summary><TranscriptCourseEditor value={displayPayload as unknown as TranscriptCoursePayload} schoolName={school?.short_name ?? "the selected school"} isDtechSchool={school?.slug === "design-tech-high-school"} onChange={(next) => setReviewDrafts((current) => ({ ...current, [item.id]: JSON.stringify(next) }))} onIgnore={() => void saveReview(item, "rejected")} disabled={Boolean(busyLabel)} /></details>}
            </article>;
          })}</div>
          </div>
        </section> : <p className="transcript-empty">Upload a transcript to review completed courses here.</p>}
      </div>
    );
  }

  function renderDtechCatalog() {
    return (
      <>
      <CourseCatalogBrowser
        source={school?.slug === "design-tech-high-school" ? "dtech" : "high_school"}
        sourceIdentity={school ? <InstitutionIdentityMark name={school.name} websiteUrl={school.website_url} size="header" decorative /> : <Buildings size={25} aria-hidden />}
        title="Course catalog"
        description="Courses you can still add in the selected school year."
        countLabel={filteredCourses.length ? `${filteredCourses.length} ${filteredCourses.length === 1 ? "course" : "courses"}` : "No courses"}
        planningContext={`Planning Grade ${activeCatalogGrade}`}
        hiddenSummary={`${catalogAvailability.hiddenTotal} unavailable courses hidden from this view`}
        filters={<>
          <label className="catalog-search-field"><span>Search courses</span><div className="catalog-search-input"><BookOpen size={16} aria-hidden /><input value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} placeholder="Name, subject, or prerequisite" /></div></label>
          <label><span>Subject</span><select value={catalogSubject} onChange={(event) => setCatalogSubject(event.target.value)}><option value="all">All subjects</option>{catalogAvailability.subjects.map((subject) => <option value={subject} key={subject}>{subject}</option>)}</select></label>
          <label><span>Planning year</span><select value={activeCatalogGrade} onChange={(event) => { setCatalogGrade(Number(event.target.value) as GradeLevel); setSelectedDtechCourseId(null); }}>{availableCatalogGrades.map((grade) => <option value={grade} key={grade}>Grade {grade}</option>)}</select></label>
        </>}
        results={dtechCatalogResults}
        selectedId={selectedDtechCourseId}
        onSelect={(id) => { const course = courseMap.get(id); if (course) chooseDtechCourse(course); }}
        emptyTitle="No matching courses"
        emptyBody="Try another search or subject. Courses already taken, below your demonstrated math level, or outside this grade stay hidden."
        sourceAction={<strong className="catalog-source-count">Official 2025-26</strong>}
        detail={selectedDtechCourse && selectedDtechEvaluation ? <CourseDetailLayout
          identity={<span>High school</span>}
          title={selectedDtechCourse.name}
          facts={[
            { label: "Subject", value: selectedDtechCourse.subject },
            { label: "Credits", value: selectedDtechCourse.credits ? formatCredits(selectedDtechCourse.credits) : "Verify" },
            { label: "Offered", value: selectedDtechCourse.grade_levels.length ? selectedDtechCourse.grade_levels.join(", ") : "Verify" },
            ...(() => {
              const labels = courseDesignations.filter((designation) => designation.course_id === selectedDtechCourse.id).map((designation) => designation.designation === "ap" ? "AP" : designation.designation === "ib" ? "IB" : designation.designation === "uc_honors" ? "UC honors" : designation.designation === "school_honors" ? "Honors" : designation.designation === "cte" ? "CTE" : "Dual enrollment");
              return labels.length ? [{ label: "Designations", value: labels.join(", ") }] : [];
            })()
          ]}
          description={selectedDtechCourse.description}
          controls={<form className="catalog-plan-controls" onSubmit={(event) => { event.preventDefault(); void addCatalogCourse(selectedDtechCourse, "planned", dtechDraft); }}>
            <label><span>School year</span><select value={dtechDraft.gradeLevel} onChange={(event) => selectDtechGrade(Number(event.target.value) as GradeLevel)}>{selectedDtechGradeOptions.map((grade) => <option value={grade} key={grade}>Grade {grade}</option>)}</select></label>
            <label><span>Term</span><select value={dtechDraft.term} onChange={(event) => setDtechDraft({ ...dtechDraft, term: event.target.value as PlanCourse["term"] })}>{selectedDtechTermOptions.map((term) => <option value={term} key={term}>{term === "full_year" ? "Full year" : term[0].toUpperCase() + term.slice(1)}</option>)}</select></label>
            <button className="primary-button" type="submit" disabled={selectedDtechEvaluation.result.status === "blocked"}><Plus size={16} /> Add to plan</button>
          </form>}
        >
          <PrerequisiteReadout evaluation={selectedDtechEvaluation} />
        </CourseDetailLayout> : <div className="catalog-detail-empty"><BookOpen size={20} aria-hidden /><strong>Select a high school course</strong><p>Review the course and choose its term before adding it.</p></div>}
      />
      {supabase && session && activeVersion && settings && <Suspense fallback={<div className="smccd-loading" role="status">Loading custom course form…</div>}>
        <CustomHighSchoolCourseForm
          supabase={supabase}
          session={session}
          activeVersion={activeVersion}
          settings={settings}
          availableGrades={availableCatalogGrades}
          planCourses={planCourses}
          onAdded={(row) => {
            setPlanCourses((current) => [...current, row]);
            notifyUndo(`${row.custom_course_name ?? "Custom course"} added as an unverified custom course.`, async () => {
              const { error } = await supabase.from("plan_courses").delete().eq("id", row.id);
              if (error) throw error;
              setPlanCourses((current) => current.filter((candidate) => candidate.id !== row.id));
            });
          }}
        />
      </Suspense>}
      </>
    );
  }

  function renderGraduation() {
    if (!settings || !supabase || !session || !activeVersion || !school) return null;
    return (
      <div className="graduation-page page-frame">
        <PageHeader title="Graduation" description="Source-backed high school diploma progress, associate-degree plans, and college gen-ed." />
        <GraduationWorkspace
          progress={fullProgress}
          school={school}
          requirementSourceUrl={sources.find((source) => source.document_type === "graduation_requirements")?.source_url}
          onFindDtechCourses={openRequirementCourses}
          degreePlanner={<SmccdPlanner
            embedded
            surface="degree"
            school={school}
            supabase={supabase}
            session={session}
            settings={settings}
            activeVersion={activeVersion}
            planCourses={planCourses}
            equivalencies={equivalencies}
            manualCompletions={manualSmccdCompletions}
            onManualCompletionsChanged={setManualSmccdCompletions}
            onFindCourse={(course) => {
              setFocusedSmccdCourseId(course.id);
              openCourses("smccd");
            }}
          />}
          generalEducationPlanner={<SmccdPlanner
            embedded
            surface="general_education"
            school={school}
            supabase={supabase}
            session={session}
            settings={settings}
            activeVersion={activeVersion}
            planCourses={planCourses}
            equivalencies={equivalencies}
            manualCompletions={manualSmccdCompletions}
            onManualCompletionsChanged={setManualSmccdCompletions}
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
    if (!school) return null;
    return <div className="gpa-page page-frame"><GpaPlanningLab
      rows={planCourses}
      courses={courses}
      school={school}
      smccdCourses={plannedSmccdCourses}
      equivalencies={equivalencies}
      choices={gpaScenarioChoices}
      onOpenCourses={() => openCourses("mine")}
      onChoicesChange={(choices) => {
        setGpaScenarioChoices(choices);
        if (!supabase || !session) return;
        if (gpaSaveTimer.current) clearTimeout(gpaSaveTimer.current);
        gpaSaveTimer.current = setTimeout(() => {
          void supabase.from("student_gpa_scenario_choices").upsert(choices.map((choice) => ({
            user_id: session.user.id,
            plan_course_id: choice.planCourseId,
            included: choice.included,
            expected_grade: choice.expectedGrade
          })), { onConflict: "user_id,plan_course_id" }).then(({ error }) => {
            if (error) notify(`GPA assumptions could not be saved: ${error.message}`, "error");
          });
        }, 350);
      }}
    /></div>;
  }

  function renderSettings() {
    if (!settings || !session || !school) return null;
    const activeSettingsArea = settingsArea === "admin" && !isAdmin ? "general" : settingsArea;
    return <>
      {activeSettingsArea === "admin" ? <AdminSettingsPanel
        accessToken={session.access_token}
        email={session.user.email ?? "Administrator account"}
        onReplayOnboarding={() => { setMobileNavOpen(false); setReplayingOnboarding(true); }}
        onViewLogin={() => { setMobileNavOpen(false); window.location.assign("/?demo=login"); }}
        onResetComplete={() => window.location.assign("/app?reset=1")}
      /> : activeSettingsArea === "support" ? <SupportSettingsPanel session={session} school={school} /> : <StudentSettingsPanel
        key={activeSettingsArea}
        section={activeSettingsArea}
        session={session}
        settings={settings}
        school={school}
        schoolSupport={schoolSupport}
        busy={Boolean(busyLabel)}
        onSave={saveStudentSettings}
        onAiPreferencesChanged={refreshAiPreferences}
        onInstitutionChanged={refreshWorkspaceSilently}
        onAccountDeleted={async () => {
          await supabase?.auth.signOut({ scope: "local" });
          window.location.assign("/");
        }}
      />}
    </>;
  }

  function renderMineCourses() {
    if (!settings) return null;
    return (
      <CourseKanban
        rows={planCourses}
        courses={courses}
        smccdCourses={plannedSmccdCourses}
        equivalencies={equivalencies}
        requirements={requirements}
        mappings={mappings}
        goals={degreeGoals}
        programs={degreePrograms}
        degreeRequirements={degreeRequirements}
        degreeRequirementCourses={degreeRequirementCourses}
        settings={settings}
        busy={Boolean(busyLabel)}
        onMove={movePlanCourse}
        onRemove={(id) => void removePlanCourse(id)}
      />
    );
  }

  function renderCourses() {
    if (!supabase || !session || !settings || !activeVersion || !school) return null;
    const activeEnrollmentPolicy = enrollmentPreference ? policyForPreference(enrollmentPolicies, enrollmentPreference) : null;
    const enrollmentWarnings = activeEnrollmentPolicy
      ? evaluateEnrollmentSchedule(planCourses, activeEnrollmentPolicy).filter((term) => term.state !== "within")
      : [];
    return <div className="courses-page page-frame wide">
      <PageHeader title="Courses" description="A four-year schedule for completed, current, and planned classes." actions={courseArea === "mine" && <><button className="secondary-button" type="button" onClick={() => navigate("sources")}><FileArrowUp size={17} /> Import transcript</button><button className="primary-button" type="button" onClick={() => setCourseArea("dtech")}><Plus size={17} /> Add courses</button></>} />
      <WorkspaceTabs className="course-workspace-tabs" items={[{ id: "mine", label: "My plan" }, { id: "dtech", label: "High school catalog" }, { id: "smccd", label: "College catalog" }]} value={courseArea} onChange={(area) => openCourses(area)} label="Courses workspace" />
      {courseArea === "mine" && <PlanVersionManager
        supabase={supabase}
        userId={session.user.id}
        activeVersion={activeVersion}
        courses={courses}
        requirements={requirements}
        mappings={mappings}
        equivalencies={equivalencies}
        goals={degreeGoals}
        programs={degreePrograms}
        degreeRequirements={degreeRequirements}
        degreeRequirementCourses={degreeRequirementCourses}
        manualCompletions={manualSmccdCompletions}
        refreshToken={planVersionRevision}
        onSort={sortPlanCourses}
        sortDisabled={Boolean(busyLabel) || planCourses.length < 2}
        onActiveVersionChanged={openActivePlanVersion}
      />}
      {enrollmentWarnings.length > 0 && activeEnrollmentPolicy && !unitWarningHidden && <aside className="enrollment-policy-callout" role="status">
        <Warning size={16} weight="fill" aria-hidden />
        <div>
          <strong>{activeEnrollmentPolicy.provider_name} unit limit needs attention</strong>
          {enrollmentWarnings.map((term) => <p key={term.key}><b>{term.term[0].toUpperCase() + term.term.slice(1)} {term.schoolYear}:</b> {term.message}</p>)}
          <small>Your saved enrollment type is {activeEnrollmentPolicy.program_type} enrollment. <a href={activeEnrollmentPolicy.source_url} target="_blank" rel="noreferrer">Review the district source</a> or change the enrollment type in Settings.</small>
        </div>
        <button className="enrollment-policy-dismiss" type="button" aria-label="Hide unit limit warning" onClick={() => { sessionStorage.setItem("pilot-hide-unit-warning", "true"); setUnitWarningHidden(true); }}><X size={15} weight="bold" /></button>
      </aside>}
      {courseArea === "mine" ? renderMineCourses() : courseArea === "dtech" ? renderDtechCatalog() : <SmccdPlanner
        embedded
        surface="courses"
        school={school}
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

  function renderView(activeViewId: WorkspaceViewId) {
    switch (activeViewId) {
      case "dashboard": return renderDashboard();
      case "courses": return renderCourses();
      case "sources": return renderSources();
      case "graduation": return renderGraduation();
      case "gpa": return renderGpa();
    }
  }

  const contentView = view === "settings" ? lastWorkspaceView : view;
  const activeView = NAV_ITEMS.find((item) => item.id === contentView);
  const activeSettingsArea = settingsArea === "admin" && !isAdmin ? "general" : settingsArea;
  const visibleSettingsNavItems = isAdmin ? SETTINGS_NAV_ITEMS : SETTINGS_NAV_ITEMS.filter((item) => item.id !== "admin");
  return (
      <div className={`app-shell t3code-app ${assistantOpen ? "assistant-docked" : ""}`}>
      <AppChrome
        view={contentView}
        activeLabel={activeView?.label ?? "Workspace"}
        navItems={PRIMARY_NAV_ITEMS}
        school={school}
        theme={theme}
        aiEnabled={settings.ai_enabled}
        assistantOpen={assistantOpen}
        mobileNavOpen={mobileNavOpen}
        onNavigate={navigate}
        onPreload={preloadWorkspaceView}
        onSettings={() => openSettings("general")}
        onMobileNavChange={setMobileNavOpen}
        onAssistantToggle={() => settings.ai_enabled ? setAssistantOpen((current) => !current) : openSettings("pilot")}
        onThemeToggle={toggleTheme}
        onSignOut={() => void signOut()}
      >
        <WorkspaceErrorBoundary resetKey={contentView}><Suspense fallback={<LoadingView />}>{renderView(contentView)}</Suspense></WorkspaceErrorBoundary>
      </AppChrome>
      {view === "settings" && <Suspense fallback={null}>
        <SettingsDialog
          open
          activeId={activeSettingsArea}
          description={SETTINGS_DESCRIPTIONS[activeSettingsArea]}
          items={visibleSettingsNavItems}
          onNavigate={(id) => openSettings(id as SettingsArea)}
          onClose={closeSettings}
        >
          <Suspense fallback={<LoadingView />}>{renderSettings()}</Suspense>
        </SettingsDialog>
      </Suspense>}
      {assistantOpen && <Suspense fallback={null}><PilotErrorBoundary onFailure={() => {
        setAssistantOpen(false);
        notify("Pilot could not open. Your workspace is still available; try opening Pilot again.", "error");
      }}>
        <GlobalAssistant
          key={`${settings.ai_enabled}:${settings.ai_connection_approved_at ?? "off"}`}
          session={session}
          open={assistantOpen}
          preferences={{ enabled: settings.ai_enabled, model: settings.ai_model, reasoningEffort: settings.ai_reasoning_effort }}
          onPreferencesChanged={refreshAiPreferences}
          onClose={() => setAssistantOpen(false)}
          onDataChanged={refreshAfterAssistantChange}
        />
      </PilotErrorBoundary></Suspense>}
      {toast && <div className={`toast ${toastKind}`} role={toastKind === "error" ? "alert" : "status"}>{busyLabel ? <ArrowClockwise size={16} className="spin" /> : toastKind === "success" ? <Check size={16} /> : toastKind === "error" ? <Warning size={16} /> : null}<span>{toast}</span>{toastAction && <button type="button" onClick={() => void (async () => { const action = toastAction; setToastAction(null); try { await action.run(); setToastKind("success"); setToast("Change undone."); } catch (caught) { setToastKind("error"); setToast(caught instanceof Error ? caught.message : "The change could not be undone."); } })()}>{toastAction.label}</button>}</div>}
      {busyLabel && <div className="busy-bar" role="status">{busyLabel}</div>}
      </div>
  );
}
