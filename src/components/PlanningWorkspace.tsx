import {
  ActivityIcon,
  AirplaneTiltIcon as AirplaneTilt,
  ArrowClockwiseIcon as ArrowClockwise,
  BookOpenIcon as BookOpen,
  CalendarCheckIcon as CalendarCheck,
  CaretDownIcon as CaretDown,
  ChartLineUpIcon as ChartLineUp,
  CheckIcon as Check,
  CheckCircleIcon as CheckCircle,
  CompassIcon as Compass,
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
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type SyntheticEvent
} from "react";
import {
  calculateGpa,
  calculateRequirementProgress,
  calculateWorkload,
  courseDisplayName,
  dtechGradePoint,
  fallbackSummary,
  generateSuggestedPlan,
  generateTimeline,
  GRADE_LEVELS,
  LETTER_GRADES,
  overallGraduationPercent,
  schoolYearForGrade,
  simulatePlan
} from "@/lib/planning";
import { requirementsForProfile, selectedPlanGrades } from "@/lib/planning";
import {
  ACADEMIC_INTEREST_OPTIONS,
  courseProfileFit,
  MAJOR_DIRECTION_OPTIONS,
  majorDirectionLabel
} from "@/lib/profile-planning";
import { transcriptPlanCourseDraft, type TranscriptCoursePayload } from "@/lib/transcript";
import OnboardingFlow from "@/components/OnboardingFlow";
import AiStatusPanel from "@/components/AiStatusPanel";
import SmccdPlanner from "@/components/SmccdPlanner";
import type {
  Activity,
  CatalogReviewItem,
  Confidence,
  Course,
  CourseRequirementMapping,
  FourYearPlan,
  GeneratedSummary,
  GraduationRequirement,
  GradeLevel,
  OfficialSource,
  PlanCourse,
  PlanVersion,
  School,
  SimulationConfig,
  SimulationResult,
  StudentProfile,
  TimelineTask
} from "@/lib/workspace-types";
import { hasPublicEnv } from "@/lib/env";
import { getBrowserSupabase } from "@/lib/supabase/browser";

type ViewId =
  | "dashboard"
  | "profile"
  | "sources"
  | "catalog"
  | "graduation"
  | "gpa"
  | "planner"
  | "dual_credit"
  | "activities"
  | "timeline"
  | "simulator"
  | "ai_status";

const PRIMARY_NAV_ITEMS: Array<{ id: ViewId; label: string; icon: Icon }> = [
  { id: "dashboard", label: "Overview", icon: House },
  { id: "planner", label: "Academic plan", icon: CalendarCheck },
  { id: "graduation", label: "Graduation", icon: GraduationCap },
  { id: "catalog", label: "Course catalog", icon: BookOpen },
  { id: "sources", label: "Transcripts", icon: FileArrowUp },
  { id: "dual_credit", label: "SMCCD planning", icon: Compass }
];

const SECONDARY_NAV_ITEMS: Array<{ id: ViewId; label: string; icon: Icon }> = [
  { id: "gpa", label: "GPA", icon: ChartLineUp },
  { id: "activities", label: "Activities", icon: ActivityIcon },
  { id: "timeline", label: "Timeline", icon: ListChecks },
  { id: "simulator", label: "Simulator", icon: Scales },
  { id: "profile", label: "Student profile", icon: UserCircle },
  { id: "ai_status", label: "AI connection", icon: Cpu }
];

const NAV_ITEMS = [...PRIMARY_NAV_ITEMS, ...SECONDARY_NAV_ITEMS];

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

function ConfidenceTag({ value }: { value: Confidence }) {
  return <span className={`confidence-tag ${value}`}>{titleCase(value)}</span>;
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
      <div className="loading-brand"><span className="wordmark-mark">PP</span> Pilot Princess</div>
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
  const [theme, setTheme] = useState<"light" | "dark">("light");

  const [school, setSchool] = useState<School | null>(null);
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [sources, setSources] = useState<OfficialSource[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [requirements, setRequirements] = useState<GraduationRequirement[]>([]);
  const [mappings, setMappings] = useState<CourseRequirementMapping[]>([]);
  const [plan, setPlan] = useState<FourYearPlan | null>(null);
  const [versions, setVersions] = useState<PlanVersion[]>([]);
  const [planCourses, setPlanCourses] = useState<PlanCourse[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [tasks, setTasks] = useState<TimelineTask[]>([]);
  const [reviewItems, setReviewItems] = useState<CatalogReviewItem[]>([]);
  const [summaries, setSummaries] = useState<GeneratedSummary[]>([]);

  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogSubject, setCatalogSubject] = useState("all");
  const [catalogGrade, setCatalogGrade] = useState<GradeLevel | "all">("all");
  const [catalogStatuses, setCatalogStatuses] = useState<Record<string, PlanCourse["status"]>>({});
  const [catalogPage, setCatalogPage] = useState(0);
  const [reviewPage, setReviewPage] = useState(0);
  const [sourceForm, setSourceForm] = useState({
    title: "",
    rawText: "",
    file: null as File | null,
    documentType: "general" as "general" | "transcript"
  });
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, string>>({});
  const [activityForm, setActivityForm] = useState({ name: "", kind: "club", role: "", weeklyHours: 2 });
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
    () => calculateRequirementProgress(trackedRequirements, planCourses, mappings),
    [trackedRequirements, planCourses, mappings]
  );
  const gpa = useMemo(() => calculateGpa(planCourses), [planCourses]);
  const workload = useMemo(
    () => (profile ? calculateWorkload(profile, planCourses, courses, activities) : null),
    [profile, planCourses, courses, activities]
  );
  const graduationPercent = useMemo(() => overallGraduationPercent(progress), [progress]);

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
        planResult,
        activityResult,
        taskResult,
        reviewResult,
        summaryResult
      ] = await Promise.all([
        supabase.from("schools").select("*").eq("slug", "design-tech-high-school").single(),
        supabase.from("student_profiles").select("*").eq("id", userId).single(),
        supabase.from("official_sources").select("*").order("is_official", { ascending: false }).order("created_at", { ascending: false }),
        supabase.from("courses").select("*").eq("review_status", "approved").order("subject").order("name"),
        supabase.from("graduation_requirements").select("*").eq("review_status", "approved").order("name"),
        supabase.from("course_requirement_mappings").select("*"),
        supabase.from("four_year_plans").select("*").eq("user_id", userId).eq("is_active", true).single(),
        supabase.from("activities").select("*").eq("user_id", userId).order("created_at"),
        supabase.from("timeline_tasks").select("*").eq("user_id", userId).order("is_completed").order("due_date"),
        supabase.from("catalog_review_items").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
        supabase.from("generated_summaries").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(5)
      ]);
      const firstError = [
        schoolResult.error,
        profileResult.error,
        courseResult.error,
        requirementResult.error,
        mappingResult.error,
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

      const loadedProfile = profileResult.data as unknown as StudentProfile;
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
      setPlan(loadedPlan);
      setVersions(loadedVersions);
      setPlanCourses((planCourseResult.data ?? []) as unknown as PlanCourse[]);
      setActivities((activityResult.data ?? []) as unknown as Activity[]);
      setTasks((taskResult.data ?? []) as unknown as TimelineTask[]);
      setReviewItems((reviewResult.data ?? []) as unknown as CatalogReviewItem[]);
      setSummaries((summaryResult.data ?? []) as unknown as GeneratedSummary[]);
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

  async function addCatalogCourse(course: Course, status: "completed" | "current" | "planned") {
    if (!supabase || !session || !activeVersion || !profile) return;
    if (planCourses.some((row) => row.course_id === course.id)) {
      setToast("That course is already in the current plan.");
      return;
    }
    const grade = (profile.grade_level ?? course.grade_levels[0] ?? 9) as GradeLevel;
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
            term: course.term_type === "semester" ? "fall" : "full_year",
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
        await logEvent("course_selected", { course_id: course.id, status });
      },
      `${course.name} added.`
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
        const explanationPayload = await authorizedPost("/api/ai/explain", {
          feature: "plan",
          context: {
            generated_courses: generated.map((row) => courseMap.get(row.course_id)?.name),
            grade_level: profile.grade_level,
            goal_intensity: profile.goal_intensity,
            workload_tolerance: profile.workload_tolerance
          },
          fallbackSummary: "A d.tech flow was added without overwriting manual plan entries. Verify every course and prerequisite before registration."
        });
        const result = explanationPayload.result as { summary?: string };
        const explanation = result.summary ?? "Suggested courses were added from the official d.tech flow.";
        setPlanExplanation(explanation);
        await supabase.from("plan_versions").update({ ai_summary: explanation }).eq("id", activeVersion.id);
        await logEvent("plan_generated", { course_count: inserted.length });
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

  async function submitSource(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (!supabase || !session || !school) return;
    if (!sourceForm.file && !sourceForm.rawText.trim()) {
      setToast("Choose a file or paste official source text.");
      return;
    }
    await runAction(
      "Adding source",
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
            title: sourceForm.title.trim() || sourceForm.file?.name || "Student source",
            kind,
            storage_path: storagePath,
            raw_text: sourceForm.rawText.trim() || null,
            mime_type: mimeType,
            source_year: new Date().getFullYear().toString(),
            is_official: false,
            parse_status: "pending",
            confidence: "uncertain",
            document_type: sourceForm.documentType
          })
          .select("*")
          .single();
        if (error) throw error;
        setSources((current) => [data as unknown as OfficialSource, ...current]);
        setSourceForm({ title: "", rawText: "", file: null, documentType: "general" });
        await logEvent("source_added", { kind });
      },
      "Source added. Review or parse it next."
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
      },
      status === "approved" ? "Correction approved." : "Item rejected."
    );
  }

  async function addReviewedCourse(item: CatalogReviewItem) {
    if (!supabase || !session || !activeVersion || !profile) return;
    const payload = item.corrected_payload ?? item.proposed_payload;
    const isTranscript = item.entity_type === "transcript_course";
    const name = String(isTranscript ? payload.course_name ?? "" : payload.name ?? "").trim();
    if (!name) {
      setToast("Add a course name before using this item.");
      return;
    }
    const grade = (profile.grade_level ?? 9) as GradeLevel;
    await runAction(
      "Adding reviewed course",
      async () => {
        if (isTranscript) {
          const draft = transcriptPlanCourseDraft(
            payload as unknown as TranscriptCoursePayload,
            profile,
            courses,
            mappings,
            item.id
          );
          const existing = draft.course_id
            ? planCourses.find((row) => row.course_id === draft.course_id)
            : null;
          if (existing) {
            const { data, error } = await supabase
              .from("plan_courses")
              .update(draft)
              .eq("id", existing.id)
              .select("*")
              .single();
            if (error) throw error;
            setPlanCourses((current) => current.map((row) => row.id === existing.id ? data as unknown as PlanCourse : row));
            await logEvent("transcript_course_imported", { review_item_id: item.id, reconciled: true });
            return;
          }
          const { data, error } = await supabase
            .from("plan_courses")
            .insert({
              ...draft,
              plan_version_id: activeVersion.id,
              user_id: session.user.id,
              sort_order: planCourses.length
            })
            .select("*")
            .single();
          if (error) throw error;
          setPlanCourses((current) => [...current, data as unknown as PlanCourse]);
          await logEvent("transcript_course_imported", { review_item_id: item.id });
          return;
        }
        const { data, error } = await supabase
          .from("plan_courses")
          .insert({
            plan_version_id: activeVersion.id,
            user_id: session.user.id,
            custom_course_name: name,
            grade_level: grade,
            school_year: schoolYearForGrade(profile.graduation_year ?? new Date().getFullYear() + 3, grade),
            term: payload.term_type === "semester" ? "fall" : "full_year",
            status: "planned",
            credits: numberValue(payload.credits),
            is_weighted: payload.weighted === true,
            mapping_verified: item.status === "approved",
            user_edited: true,
            notes: "Added from a student-reviewed source import."
          })
          .select("*")
          .single();
        if (error) throw error;
        setPlanCourses((current) => [...current, data as unknown as PlanCourse]);
      },
      isTranscript ? "Completed course imported from transcript." : "Reviewed course added to the plan."
    );
  }

  async function addActivity(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (!supabase || !session) return;
    await runAction(
      "Adding activity",
      async () => {
        const { data, error } = await supabase
          .from("activities")
          .insert({
            user_id: session.user.id,
            name: activityForm.name.trim(),
            kind: activityForm.kind,
            role: activityForm.role.trim() || null,
            weekly_hours: activityForm.weeklyHours,
            start_grade: profile?.grade_level ?? null
          })
          .select("*")
          .single();
        if (error) throw error;
        setActivities((current) => [...current, data as unknown as Activity]);
        setActivityForm({ name: "", kind: "club", role: "", weeklyHours: 2 });
        await logEvent("activity_added");
      },
      "Activity added."
    );
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
    await runAction("Explaining simulation", async () => {
      const payload = await authorizedPost("/api/ai/explain", {
        feature: "simulation",
        context: { config: simulationConfig, comparison: result },
        fallbackSummary: "The simulated plan changes workload and stress estimates but does not alter the saved plan."
      });
      const explanation = payload.result as { summary?: string };
      setSimulationExplanation(explanation.summary ?? null);
      await logEvent("simulation_started");
    });
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

  async function generateSummary() {
    if (!supabase || !session || !profile || !workload) return;
    const deterministic = fallbackSummary(profile, progress, gpa, workload);
    await runAction(
      "Generating summary",
      async () => {
        const payload = await authorizedPost("/api/ai/explain", {
          feature: "summary",
          context: {
            preferred_name: profile.preferred_name,
            graduation_progress_percent: graduationPercent,
            gpa,
            workload,
            missing_requirements: progress.filter((item) => item.status === "missing").map((item) => item.requirement.name)
          },
          fallbackSummary: deterministic
        });
        const result = payload.result as { summary: string };
        const { data, error } = await supabase
          .from("generated_summaries")
          .insert({
            user_id: session.user.id,
            plan_version_id: activeVersion?.id ?? null,
            content: result.summary,
            generation_source: payload.fallbackUsed ? "fallback" : "codex"
          })
          .select("*")
          .single();
        if (error) throw error;
        setSummaries((current) => [data as unknown as GeneratedSummary, ...current]);
      },
      "Summary generated."
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
        <button className="secondary-button" onClick={() => void loadWorkspace()} type="button">
          <ArrowClockwise size={17} /> Try again
        </button>
      </main>
    );
  }

  if (!profile.onboarding_complete) {
    return (
      <OnboardingFlow
        supabase={supabase}
        session={session}
        school={school}
        profile={profile}
        requirements={requirements}
        courses={courses}
        mappings={mappings}
        activeVersion={activeVersion}
        existingPlanCourses={planCourses}
        onComplete={loadWorkspace}
        onSignOut={signOut}
      />
    );
  }

  const courseFits = new Map(courses.map((course) => [course.id, courseProfileFit(course, profile)]));
  const filteredCourses = courses.filter((course) => {
    const query = catalogSearch.trim().toLowerCase();
    return (
      (!query || [course.name, course.subject, course.description ?? "", course.prerequisites.join(" ")].join(" ").toLowerCase().includes(query)) &&
      (catalogSubject === "all" || course.subject === catalogSubject) &&
      (catalogGrade === "all" || course.grade_levels.includes(catalogGrade))
    );
  }).sort((a, b) => (courseFits.get(b.id)?.score ?? 0) - (courseFits.get(a.id)?.score ?? 0) || a.name.localeCompare(b.name));
  const subjects = [...new Set(courses.map((course) => course.subject))];
  const pendingReviewCount = reviewItems.filter((item) => item.status === "pending").length;
  const catalogPageSize = 12;
  const catalogPageCount = Math.max(1, Math.ceil(filteredCourses.length / catalogPageSize));
  const visibleCatalogCourses = filteredCourses.slice(catalogPage * catalogPageSize, (catalogPage + 1) * catalogPageSize);

  function renderDashboard() {
    if (!profile) return null;
    const nextTasks = tasks.filter((task) => !task.is_completed).slice(0, 4);
    const missing = progress.filter((item) => item.status === "missing");
    return (
      <>
        <PageHeader
          title={profile.preferred_name ? `Good to see you, ${profile.preferred_name}` : "Planning overview"}
          description="A source-backed view of progress, workload, and what needs attention next."
          actions={<button className="secondary-button" onClick={() => void generateSummary()} disabled={Boolean(busyLabel)}><Sparkle size={17} /> Generate summary</button>}
        />
        <section className="overview-ledger" aria-label="Plan summary">
          <div>
            <span>{profile.tracker_mode === "selected" ? "Tracked coverage" : "Graduation coverage"}</span>
            <strong>{graduationPercent}%</strong>
            <small>{progress.filter((item) => item.status !== "missing").length} of {trackedRequirements.length} tracked areas covered</small>
          </div>
          <div>
            <span>Projected weighted GPA</span>
            <strong>{formatGpa(gpa.projectedWeighted)}</strong>
            <small>{gpa.gradedCredits > 0 ? `${gpa.gradedCredits} graded credits` : "Add grades to calculate"}</small>
          </div>
          <div>
            <span>Workload</span>
            <strong>{workload ? titleCase(workload.level) : "Not available"}</strong>
            <small>{workload ? `${workload.knownWeeklyHours} known weekly hours; ${workload.demandingCourseCount}/${workload.demandingCourseLimit} demanding courses` : "Complete profile"}</small>
          </div>
        </section>
        {workload?.warning && <div className="notice-strip warning"><Warning size={19} weight="fill" /><span>{workload.warning}</span></div>}
        <div className="dashboard-columns">
          <section className="content-section">
            <header className="section-heading"><div><h2>Requirement status</h2><p>Only verified mappings count toward the projection.</p></div><button className="quiet-button" onClick={() => navigate("graduation")}>Open tracker</button></header>
            <div className="requirement-rows compact">
              {progress.slice(0, 5).map((item) => (
                <div className="requirement-row" key={item.requirement.id}>
                  <div><strong>{item.requirement.name}</strong><span>{item.verifiedProjectedCredits} / {item.requirement.credits_required}</span></div>
                  <div className="progress-track" aria-label={`${item.percent}% complete`}><span style={{ width: `${item.percent}%` }} /></div>
                </div>
              ))}
            </div>
          </section>
          <section className="content-section">
            <header className="section-heading"><div><h2>Next tasks</h2><p>Generated tasks stay editable.</p></div><button className="quiet-button" onClick={() => navigate("timeline")}>Open timeline</button></header>
            {nextTasks.length ? (
              <div className="task-list compact">
                {nextTasks.map((task) => (
                  <label className="task-row" key={task.id}>
                    <input type="checkbox" checked={task.is_completed} onChange={() => void updateTask(task.id, { is_completed: true })} />
                    <span><strong>{task.title}</strong><small>{task.due_label ?? titleCase(task.category)}</small></span>
                  </label>
                ))}
              </div>
            ) : <EmptyState title="No open tasks" body="Generate a timeline from your current grade and plan." action={<button className="secondary-button" onClick={() => void generateTasks()}>Generate timeline</button>} />}
          </section>
        </div>
        <section className="content-section summary-section">
          <header className="section-heading"><div><h2>Latest summary</h2><p>A short progress brief generated from saved plan data.</p></div></header>
          {summaries[0] ? <blockquote>{summaries[0].content}</blockquote> : <EmptyState title="No summary yet" body="Generate a short, plain-language overview from saved data." />}
        </section>
        {missing.length > 0 && <div className="notice-strip"><Flag size={19} /><span>{missing.length} requirement {missing.length === 1 ? "area needs" : "areas need"} verified course coverage.</span></div>}
      </>
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
    return (
      <>
        <PageHeader title="Student profile" description="Each answer below changes a visible planning result." />
        <section className="form-section profile-form">
          <div className="profile-subsection">
            <header><h2>Student and plan</h2><p>Sets the school years and planning window.</p></header>
            <div className="form-grid two">
              <label className="form-field"><span>Preferred name</span><input value={profile.preferred_name} onChange={(event) => setProfile({ ...profile, preferred_name: event.target.value })} /></label>
              <label className="form-field"><span>School</span><input value={school.name} disabled /></label>
              <label className="form-field"><span>Age</span><input type="number" min={12} max={22} value={profile.age ?? ""} onChange={(event) => setProfile({ ...profile, age: numberValue(event.target.value) })} /></label>
              <label className="form-field"><span>Current grade</span><select value={profile.grade_level ?? ""} onChange={(event) => { const grade = Number(event.target.value) as GradeLevel; setProfile({ ...profile, grade_level: grade, plan_start_grade: grade, plan_end_grade: Math.max(grade, profile.plan_end_grade ?? 12) as GradeLevel }); }}><option value="">Select grade</option>{GRADE_LEVELS.map((grade) => <option value={grade} key={grade}>Grade {grade}</option>)}</select></label>
              <label className="form-field"><span>Graduation year</span><input type="number" min={2025} max={2040} value={profile.graduation_year ?? ""} onChange={(event) => setProfile({ ...profile, graduation_year: numberValue(event.target.value) })} /></label>
              <label className="form-field"><span>Plan through</span><select value={profile.plan_end_grade ?? 12} onChange={(event) => setProfile({ ...profile, plan_start_grade: (profile.grade_level ?? 9) as GradeLevel, plan_end_grade: Number(event.target.value) as GradeLevel })}>{GRADE_LEVELS.filter((grade) => grade >= (profile.grade_level ?? 9)).map((grade) => <option value={grade} key={grade}>Grade {grade}{grade === 12 ? " (graduation)" : ""}</option>)}</select></label>
            </div>
          </div>

          <div className="profile-subsection">
            <header><h2>Academic direction</h2><p>Sorts d.tech courses and associate degrees without locking you into a major.</p></header>
            <fieldset className="profile-choice-grid"><legend>Current direction</legend>{MAJOR_DIRECTION_OPTIONS.map((option) => <label className={profile.major_direction === option.value ? "selected" : ""} key={option.value}><input type="radio" name="major-direction" value={option.value} checked={profile.major_direction === option.value} onChange={() => setProfile({ ...profile, major_direction: option.value })} /><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}</fieldset>
            <fieldset className="profile-interest-grid"><legend>Academic interests</legend>{ACADEMIC_INTEREST_OPTIONS.map((interest) => <label className={profile.academic_interests.includes(interest) ? "selected" : ""} key={interest}><input type="checkbox" checked={profile.academic_interests.includes(interest)} onChange={() => toggleInterest(interest)} /><span>{interest}</span></label>)}</fieldset>
            <label className="form-field"><span>Other interests</span><input value={otherInterests.join(", ")} onChange={(event) => setProfile({ ...profile, academic_interests: [...profile.academic_interests.filter((interest) => standardInterests.has(interest)), ...event.target.value.split(",").map((item) => item.trim()).filter(Boolean)] })} placeholder="Specific subjects, separated by commas" /></label>
            <label className="form-field"><span>Career ideas to explore</span><input value={profile.career_direction} onChange={(event) => setProfile({ ...profile, career_direction: event.target.value })} placeholder="For example: software engineering, public health" /><small className="form-hint">Used as course and degree search keywords, not as a commitment.</small></label>
          </div>

          <div className="profile-subsection">
            <header><h2>Capacity and stress</h2><p>Drives workload warnings and the simulator baseline.</p></header>
            <fieldset className="profile-choice-grid three"><legend>Planning priority</legend>{[
              { value: "lower_stress", label: "Protect capacity", body: "Prefer fewer simultaneous demanding courses." },
              { value: "balanced", label: "Balanced", body: "Mix rigor with activities and recovery." },
              { value: "competitive", label: "More rigorous", body: "Prefer honors when the plan still fits your limits." }
            ].map((option) => <label className={profile.goal_intensity === option.value ? "selected" : ""} key={option.value}><input type="radio" name="goal-intensity" checked={profile.goal_intensity === option.value} onChange={() => setProfile({ ...profile, goal_intensity: option.value as StudentProfile["goal_intensity"] })} /><span><strong>{option.label}</strong><small>{option.body}</small></span></label>)}</fieldset>
            <div className="form-grid two">
              <label className="form-field"><span>Demanding-course limit</span><select value={profile.workload_tolerance} onChange={(event) => setProfile({ ...profile, workload_tolerance: event.target.value as StudentProfile["workload_tolerance"] })}><option value="light">Up to 2 weighted or college courses</option><option value="balanced">Up to 4 weighted or college courses</option><option value="high">Up to 6 weighted or college courses</option></select></label>
              <label className="form-field"><span>Weekly commitment limit</span><input type="number" min={1} max={80} step={0.5} value={profile.weekly_commitment_limit ?? ""} onChange={(event) => setProfile({ ...profile, weekly_commitment_limit: numberValue(event.target.value) })} placeholder="Hours per week" /><small className="form-hint">For activities plus SMCCD class and study time outside the d.tech school day.</small></label>
              <label className="form-field"><span>Current stress baseline</span><select value={profile.stress_level} onChange={(event) => setProfile({ ...profile, stress_level: Number(event.target.value) })}><option value={1}>1 - Low</option><option value={2}>2 - Manageable</option><option value={3}>3 - Stretched</option><option value={4}>4 - High</option><option value={5}>5 - Overloaded</option></select><small className="form-hint">Used for warnings only. It does not diagnose health or predict grades.</small></label>
              <label className="form-field"><span>Graduation tracker</span><select value={profile.tracker_mode} onChange={(event) => setProfile({ ...profile, tracker_mode: event.target.value as StudentProfile["tracker_mode"], tracked_requirement_areas: event.target.value === "full" ? requirements.map((requirement) => requirement.area) : [] })}><option value="full">Full d.tech diploma</option><option value="selected">Selected requirement areas</option></select></label>
            </div>
            {profile.tracker_mode === "selected" && <fieldset className="profile-requirements"><legend>Tracked requirement areas</legend>{requirements.map((requirement) => <label key={requirement.id}><input type="checkbox" checked={profile.tracked_requirement_areas.includes(requirement.area)} onChange={() => { const selected = new Set(profile.tracked_requirement_areas); if (selected.has(requirement.area)) selected.delete(requirement.area); else selected.add(requirement.area); setProfile({ ...profile, tracked_requirement_areas: [...selected] }); }} /><span>{requirement.name}</span></label>)}</fieldset>}
          </div>

          <aside className="profile-effects" aria-label="How this profile changes planning">
            <h2>Where these answers are used</h2>
            <dl>
              <div><dt>Course catalog</dt><dd>{matchingCourseCount} courses currently match your direction, interests, or career keywords and sort first.</dd></div>
              <div><dt>Associate degrees</dt><dd>Programs with matching transcript coursework rank first, followed by profile keyword matches.</dd></div>
              <div><dt>Workload</dt><dd>{workload ? `${workload.knownWeeklyHours} known weekly hours and ${workload.demandingCourseCount} demanding courses compared with your limits.` : "Calculated from active courses and activities."}</dd></div>
              <div><dt>Simulator</dt><dd>Starts from {majorDirectionLabel(profile.major_direction)}, stress {profile.stress_level}, and your saved capacity. No GPA change is invented.</dd></div>
            </dl>
          </aside>

          <label className="confirmation-field"><input type="checkbox" checked={profile.school_confirmed} onChange={(event) => setProfile({ ...profile, school_confirmed: event.target.checked })} /><span><strong>I confirm this plan is for Design Tech High School.</strong><small>Course and graduation data are labeled for the 2025-26 source year.</small></span></label>
          <div className="form-footer"><button className="primary-button" onClick={() => void saveProfile()} disabled={Boolean(busyLabel)}><FloppyDisk size={17} /> Save profile</button></div>
        </section>
      </>
    );
  }

  function renderSources() {
    const userSources = sources.filter((source) => !source.is_official);
    const officialSources = sources.filter((source) => source.is_official);
    const reviewPageSize = 10;
    const reviewPageCount = Math.max(1, Math.ceil(reviewItems.length / reviewPageSize));
    const safeReviewPage = Math.min(reviewPage, reviewPageCount - 1);
    const visibleReviewItems = reviewItems.slice(safeReviewPage * reviewPageSize, (safeReviewPage + 1) * reviewPageSize);
    return (
      <>
        <PageHeader title="Source import and review" description="Upload official material, inspect structured results, and correct uncertainty before using it." />
        <div className="source-layout">
          <form className="form-section source-form" onSubmit={submitSource}>
            <h2>Add a source</h2>
            <label className="form-field"><span>Source type</span><select value={sourceForm.documentType} onChange={(event) => setSourceForm({ ...sourceForm, documentType: event.target.value as "general" | "transcript" })}><option value="general">Course, policy, or requirement source</option><option value="transcript">Student transcript</option></select><small className="form-hint">Transcripts use a dedicated completed-course parser.</small></label>
            <label className="form-field"><span>Title</span><input value={sourceForm.title} onChange={(event) => setSourceForm({ ...sourceForm, title: event.target.value })} placeholder="Transcript, policy, or catalog" /></label>
            <label className="form-field"><span>Official file or screenshot</span><input type="file" accept=".pdf,.docx,.txt,.csv,.png,.jpg,.jpeg,.webp" onChange={(event) => setSourceForm({ ...sourceForm, file: event.target.files?.[0] ?? null })} /><small className="form-hint">PDF, DOCX, text, CSV, PNG, JPEG, or WebP. Maximum 15 MB.</small></label>
            <div className="or-divider"><span>or paste text</span></div>
            <label className="form-field"><span>Source text</span><textarea value={sourceForm.rawText} onChange={(event) => setSourceForm({ ...sourceForm, rawText: event.target.value })} placeholder="Paste official course, policy, or transcript text." /></label>
            <button className="primary-button" type="submit" disabled={Boolean(busyLabel)}><Plus size={17} /> Add source</button>
          </form>
          <section className="content-section">
            <header className="section-heading"><div><h2>Your sources</h2><p>Raw content remains available if any extraction method fails. Text-based transcripts never use Codex.</p></div></header>
            {userSources.length ? <div className="source-list">{userSources.map((source) => <article className="source-row" key={source.id}><div><strong>{source.title}</strong><span>{source.document_type === "transcript" ? "Transcript" : titleCase(source.kind)} · {source.source_year}</span></div><div className="source-actions"><ConfidenceTag value={source.confidence} /><span className={`status-label ${source.parse_status}`}>{titleCase(source.parse_status)}</span>{source.parse_status !== "processing" && <button className="secondary-button small" onClick={() => void parseSource(source)} disabled={Boolean(busyLabel)}>{source.document_type === "transcript" ? <FileArrowUp size={15} /> : <Sparkle size={15} />} {source.document_type === "transcript" ? "Read transcript" : "AI parse"}</button>}</div>{source.error_message && <p className="row-error">{source.error_message}</p>}</article>)}</div> : <EmptyState title="No uploaded sources" body="Add a transcript, screenshot, or official document to start a review queue." />}
          </section>
        </div>
        <section className="content-section review-section">
          <header className="section-heading"><div><h2>Manual review queue</h2><p>{pendingReviewCount} items still need a decision.</p></div></header>
          {reviewItems.length ? <><div className="review-list">{visibleReviewItems.map((item) => {
            const draft = reviewDrafts[item.id] ?? JSON.stringify(item.corrected_payload ?? item.proposed_payload, null, 2);
            const displayPayload = item.corrected_payload ?? item.proposed_payload;
            const isTranscriptCourse = item.entity_type === "transcript_course";
            return <article className="review-item" key={item.id}><header><div><span>{isTranscriptCourse ? "Transcript course" : titleCase(item.entity_type)}</span><ConfidenceTag value={item.confidence} /></div><strong>{String(displayPayload.name ?? displayPayload.course_name ?? displayPayload.title ?? displayPayload.summary ?? "Parsed source item")}</strong></header>{item.uncertainty_notes.length > 0 && <ul className="uncertainty-list">{item.uncertainty_notes.map((note) => <li key={note}>{note}</li>)}</ul>}<details className="review-data"><summary>Review or correct extracted data</summary><label className="form-field"><span>Structured data</span><textarea className="code-editor" value={draft} onChange={(event) => setReviewDrafts((current) => ({ ...current, [item.id]: event.target.value }))} spellCheck={false} /></label></details><footer><span className={`review-status ${item.status}`}>{titleCase(item.status)}</span><div><button className="danger-button small" onClick={() => void saveReview(item, "rejected")} disabled={Boolean(busyLabel)}><X size={15} /> Reject</button><button className="secondary-button small" onClick={() => void saveReview(item, "approved")} disabled={Boolean(busyLabel)}><Check size={15} /> Approve</button>{(item.entity_type === "course" || isTranscriptCourse) && item.status === "approved" && <button className="primary-button small" onClick={() => void addReviewedCourse(item)} disabled={Boolean(busyLabel)}><Plus size={15} /> {isTranscriptCourse ? "Add completed" : "Use in plan"}</button>}</div></footer></article>;
          })}</div><PaginationControls page={safeReviewPage} pageCount={reviewPageCount} onChange={setReviewPage} label="Review queue pages" /></> : <EmptyState title="Nothing to review" body="Parsed courses, requirements, conflicts, and policy notes appear here." />}
        </section>
        <section className="content-section">
          <header className="section-heading"><div><h2>Official source register</h2><p>Current seed data remains visibly tied to its publication year.</p></div></header>
          <div className="source-register">{officialSources.map((source) => <a href={source.source_url ?? "#"} target="_blank" rel="noreferrer" key={source.id}><span><strong>{source.title}</strong><small>{source.source_year}</small></span><ConfidenceTag value={source.confidence} /></a>)}</div>
        </section>
      </>
    );
  }

  function renderCatalog() {
    return (
      <>
        <PageHeader title="Official d.tech catalog" description="Search the 2025-26 source-backed catalog and add courses by status." />
        <section className="catalog-controls" aria-label="Catalog filters">
          <label><span>Search courses</span><input value={catalogSearch} onChange={(event) => { setCatalogSearch(event.target.value); setCatalogPage(0); }} placeholder="Name, subject, or prerequisite" /></label>
          <label><span>Subject</span><select value={catalogSubject} onChange={(event) => { setCatalogSubject(event.target.value); setCatalogPage(0); }}><option value="all">All subjects</option>{subjects.map((subject) => <option value={subject} key={subject}>{subject}</option>)}</select></label>
          <label><span>Grade</span><select value={catalogGrade} onChange={(event) => { setCatalogGrade(event.target.value === "all" ? "all" : Number(event.target.value) as GradeLevel); setCatalogPage(0); }}><option value="all">All grades</option>{GRADE_LEVELS.map((grade) => <option value={grade} key={grade}>Grade {grade}</option>)}</select></label>
        </section>
        <div className="catalog-list-heading"><strong>{filteredCourses.length ? `${catalogPage * catalogPageSize + 1}-${Math.min((catalogPage + 1) * catalogPageSize, filteredCourses.length)} of ${filteredCourses.length} courses` : "No courses"}</strong><span>Choose a status, then add the course once.</span></div>
        <section className="catalog-list" aria-label="d.tech courses">
          {visibleCatalogCourses.map((course) => (
            <article className="course-row" key={course.id}>
              <div className="course-main">
                <div className="course-title-line"><h2>{course.name}</h2>{course.confidence !== "verified" && <ConfidenceTag value={course.confidence} />}</div>
                <div className="course-meta"><span>{course.subject}</span><span>Grades {course.grade_levels.join(", ") || "verify"}</span><span>{course.credits ? formatCredits(course.credits) : "Credits need review"}</span>{course.is_honors && <span>Honors available</span>}{course.uc_ag_area && <span>{course.uc_ag_area}</span>}</div>
                {(courseFits.get(course.id)?.reasons.length ?? 0) > 0 && <p className="profile-match-note">Profile match: {courseFits.get(course.id)?.reasons.join("; ")}</p>}
                <details className="course-details"><summary>Course details</summary><p>{course.description}</p>{course.prerequisites.length > 0 && <p className="prereq"><strong>Prerequisites:</strong> {course.prerequisites.join(", ")}</p>}</details>
              </div>
              <div className="course-actions">
                <label><span className="sr-only">Status for {course.name}</span><select aria-label={`Status for ${course.name}`} value={catalogStatuses[course.id] ?? "planned"} onChange={(event) => setCatalogStatuses((current) => ({ ...current, [course.id]: event.target.value as PlanCourse["status"] }))}><option value="planned">Planned</option><option value="current">Current</option><option value="completed">Completed</option></select></label>
                <button onClick={() => void addCatalogCourse(course, catalogStatuses[course.id] ?? "planned")} className="primary-button">Add</button>
              </div>
            </article>
          ))}
          {filteredCourses.length === 0 && <EmptyState title="No matching courses" body="Adjust the search or filters." />}
        </section>
        <PaginationControls page={catalogPage} pageCount={catalogPageCount} onChange={setCatalogPage} label="Course catalog pages" />
      </>
    );
  }

  function renderGraduation() {
    if (!profile) return null;
    const trackedCredits = trackedRequirements.reduce((total, requirement) => total + Number(requirement.credits_required), 0);
    return (
      <>
        <PageHeader title="Graduation tracker" description={profile.tracker_mode === "selected" ? "This focused view uses the requirement areas chosen during onboarding. Completed, planned, and unverified credits remain distinct." : "Completed, current, planned, missing, and unverified credits remain distinct."} />
        <section className="graduation-total"><div><span>Verified projected coverage</span><strong>{graduationPercent}%</strong></div><p>{profile.tracker_mode === "selected" ? `Showing ${trackedRequirements.length} selected areas totaling ${trackedCredits} credits. The complete d.tech diploma remains 225 credits.` : "d.tech lists 225 total credits for the 2025-26 source year."} This tracker is a planning estimate, not an official audit.</p></section>
        <section className="requirement-rows">
          {progress.map((item) => {
            const creditsRemaining = Math.max(0, Number(item.requirement.credits_required) - item.verifiedProjectedCredits);
            const statusText = item.status === "complete"
              ? "Complete"
              : item.status === "on_track"
                ? "On track"
                : item.verifiedProjectedCredits > 0
                  ? `${creditsRemaining} credits left`
                  : "Not started";
            return <article className="requirement-detail" key={item.requirement.id}>
              <header><div><h2>{item.requirement.name}</h2><p>{item.requirement.notes}</p></div><span className={`requirement-status ${item.status}`}>{statusText}</span></header>
              <div className="credit-ledger"><div><span>Completed</span><strong>{item.completedCredits}</strong></div><div><span>Current</span><strong>{item.currentCredits}</strong></div><div><span>Planned</span><strong>{item.plannedCredits}</strong></div><div><span>Unverified</span><strong>{item.unverifiedCredits}</strong></div><div><span>Required</span><strong>{item.requirement.credits_required}</strong></div></div>
              <div className="progress-track large"><span style={{ width: `${item.percent}%` }} /></div>
              {item.unverifiedCredits > 0 && <p className="verification-note"><Warning size={16} /> {item.unverifiedCredits} credits are excluded until their mapping is manually verified.</p>}
            </article>;
          })}
        </section>
      </>
    );
  }

  function renderGpa() {
    const gradedRows = planCourses.filter((row) => row.letter_grade && !["IP", "P"].includes(row.letter_grade.toUpperCase()));
    return (
      <>
        <PageHeader title="GPA tracker" description="Uses the grading behavior shown on the d.tech transcript." />
        <div className="gpa-ledger"><div><span>Current unweighted</span><strong>{formatGpa(gpa.currentUnweighted)}</strong></div><div><span>Current weighted</span><strong>{formatGpa(gpa.currentWeighted)}</strong></div><div><span>Projected unweighted</span><strong>{formatGpa(gpa.projectedUnweighted)}</strong></div><div><span>Projected weighted</span><strong>{formatGpa(gpa.projectedWeighted)}</strong></div></div>
        <dl className="gpa-method-summary"><div><dt>GPA credits</dt><dd>{gpa.gradedCredits}</dd></div><div><dt>Weighted credits</dt><dd>{gpa.weightedCredits}</dd></div><div><dt>Pass credits excluded</dt><dd>{gpa.passCredits}</dd></div></dl>
        <div className="notice-strip"><Gauge size={19} /><span>A+, A, and A- are 4 points; B variants are 3; C variants are 2; D variants are 1. Every SMCCD and d.tech Honors course receives one added point. P is excluded from GPA.</span></div>
        <section className="content-section">
          <header className="section-heading"><div><h2>GPA courses</h2><p>Exact transcript marks are preserved even when the d.tech point value is the same.</p></div><button className="quiet-button" onClick={() => navigate("planner")}>Open planner</button></header>
          {gradedRows.length ? <div className="grade-table"><div className="grade-table-head"><span>Course</span><span>Status</span><span>Grade points</span><span>Credits</span><span>Weight</span></div>{gradedRows.map((row) => { const points = dtechGradePoint(row.letter_grade); return <div className="grade-table-row" key={row.id}><strong>{courseDisplayName(row, courseMap)}</strong><span>{titleCase(row.status)}</span><span>{row.letter_grade} = {points?.toFixed(1)}</span><span>{row.credits ?? "Verify"}</span><span>{row.is_weighted || row.smccd_course_id || Number(row.college_units ?? 0) > 0 ? "Weighted" : "Standard"}</span></div>; })}</div> : <EmptyState title="No graded courses" body="Add completed or current courses and enter grades in the planner." />}
        </section>
      </>
    );
  }

  function renderPlanner() {
    if (!profile) return null;
    const snapshots = versions.filter((version) => version.kind === "snapshot");
    const planGrades = selectedPlanGrades(profile);
    const intersessionRows = planCourses.filter((row) =>
      row.status === "completed" && row.letter_grade?.toUpperCase() === "P" && row.requirement_area_override === "personal_development"
    );
    const intersessionIds = new Set(intersessionRows.map((row) => row.id));
    const priorCompletedRows = planCourses.filter(
      (row) => row.status === "completed" && !planGrades.includes(row.grade_level) && !intersessionIds.has(row.id)
    );
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
    const snapshotProgress = calculateRequirementProgress(requirements, compareCourses, mappings);
    return (
      <>
        <PageHeader title="Academic plan" description={`Your selected window runs from grade ${planGrades[0]} through grade ${planGrades.at(-1)}. Completed transcript courses still count outside this window.`} actions={<><button className="secondary-button" onClick={() => void saveSnapshot()} disabled={Boolean(busyLabel)}><FloppyDisk size={17} /> Snapshot</button><button className="primary-button" onClick={() => void generatePlan()} disabled={Boolean(busyLabel)}><Sparkle size={17} /> Suggest plan</button></>} />
        {planExplanation && <div className="notice-strip"><Sparkle size={19} /><span>{planExplanation}</span></div>}
        {intersessionRows.length > 0 && <details className="content-section transcript-intersession"><summary><span><strong>Intersession pass credits</strong><small>{intersessionRows.reduce((total, row) => total + Number(row.credits ?? 0), 0)} Personal Development credits across {intersessionRows.length} classes. Excluded from GPA.</small></span><span>View classes</span></summary><div>{intersessionRows.map((row) => <article key={row.id}><span><strong>{courseDisplayName(row, courseMap)}</strong><small>Grade {row.grade_level}, pass</small></span><span>{row.credits ?? 0} credits</span></article>)}</div></details>}
        {priorCompletedRows.length > 0 && <section className="content-section transcript-history"><header className="section-heading"><div><h2>Earlier completed courses</h2><p>Imported transcript courses count toward GPA and graduation progress without extending the planning window.</p></div></header><div>{priorCompletedRows.map((row) => <article key={row.id}><span><strong>{courseDisplayName(row, courseMap)}</strong><small>Grade {row.grade_level}{row.letter_grade ? `, final grade ${row.letter_grade}` : ""}</small></span><span>{row.credits ? `${row.credits} credits` : "Credits need review"}</span></article>)}</div></section>}
        <section className="planner-board" style={{ gridTemplateColumns: `repeat(${planGrades.length}, minmax(230px, 1fr))` }}>
          {planGrades.map((grade) => {
            const rows = planCourses.filter((row) => row.grade_level === grade && !intersessionIds.has(row.id));
            return <div className="planner-year" key={grade}><header><span>Grade {grade}</span><small>{profile.graduation_year ? schoolYearForGrade(profile.graduation_year, grade) : "Set graduation year"}</small></header><div className="planner-year-body">{rows.map((row) => { const smccdWeighted = Boolean(row.smccd_course_id || Number(row.college_units ?? 0) > 0); return <article className="plan-course" key={row.id}><div className="plan-course-title"><strong>{courseDisplayName(row, courseMap)}</strong>{row.mapping_verified ? <CheckCircle size={17} weight="fill" aria-label="Verified mapping" /> : <Warning size={17} weight="fill" aria-label="Unverified mapping" />}</div><div className="plan-course-fields"><label><span>Status</span><select value={row.status} onChange={(event) => void updatePlanCourse(row.id, { status: event.target.value as PlanCourse["status"] })}><option value="completed">Completed</option><option value="current">Current</option><option value="planned">Planned</option></select></label><label><span>Grade</span><select value={row.letter_grade ?? ""} onChange={(event) => void updatePlanCourse(row.id, { letter_grade: event.target.value || null })}>{LETTER_GRADES.map((gradeValue) => <option value={gradeValue} key={gradeValue}>{gradeValue || "None"}</option>)}</select></label><label><span>Year</span><select value={row.grade_level} onChange={(event) => { const nextGrade = Number(event.target.value) as GradeLevel; void updatePlanCourse(row.id, { grade_level: nextGrade, school_year: schoolYearForGrade(profile.graduation_year ?? new Date().getFullYear() + 3, nextGrade) }); }}>{GRADE_LEVELS.map((value) => <option value={value} key={value}>{value}</option>)}</select></label></div><label className="weight-check"><input type="checkbox" checked={smccdWeighted || row.is_weighted} disabled={smccdWeighted} onChange={(event) => void updatePlanCourse(row.id, { is_weighted: event.target.checked })} /><span>{smccdWeighted ? "SMCCD weighted" : "Weighted or honors"}</span></label><button className="icon-button danger" onClick={() => void removePlanCourse(row.id)} aria-label={`Remove ${courseDisplayName(row, courseMap)}`}><Trash size={16} /></button></article>; })}{rows.length === 0 && <p className="year-empty">No courses yet.</p>}</div></div>;
          })}
        </section>
        <section className="content-section version-compare">
          <header className="section-heading"><div><h2>Compare snapshots</h2><p>Snapshots preserve saved versions without changing the active plan.</p></div></header>
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
          </> : <EmptyState title="No snapshots" body="Save a snapshot before a major plan change." />}
        </section>
      </>
    );
  }

  function renderDualCredit() {
    if (!supabase || !session || !profile || !activeVersion) return null;
    return <SmccdPlanner
      supabase={supabase}
      session={session}
      profile={profile}
      activeVersion={activeVersion}
      planCourses={planCourses}
      onCourseAdded={(course) => setPlanCourses((current) => [...current, course])}
      onCourseRemoved={(id) => setPlanCourses((current) => current.filter((row) => row.id !== id))}
    />;
  }

  function renderAiStatus() {
    return session ? <AiStatusPanel session={session} /> : null;
  }

  function renderActivities() {
    return (
      <>
        <PageHeader title="Activity planner" description="Weekly activity hours feed directly into workload and simulation estimates." />
        <div className="activity-layout">
          <form className="form-section" onSubmit={addActivity}>
            <h2>Add an activity</h2>
            <label className="form-field"><span>Activity name</span><input value={activityForm.name} onChange={(event) => setActivityForm({ ...activityForm, name: event.target.value })} required /></label>
            <label className="form-field"><span>Type</span><select value={activityForm.kind} onChange={(event) => setActivityForm({ ...activityForm, kind: event.target.value })}><option value="club">Club</option><option value="athletics">Athletics</option><option value="service">Service</option><option value="work">Work</option><option value="family">Family responsibility</option><option value="internship">Internship</option><option value="other">Other</option></select></label>
            <label className="form-field"><span>Role</span><input value={activityForm.role} onChange={(event) => setActivityForm({ ...activityForm, role: event.target.value })} /></label>
            <label className="form-field"><span>Hours per week</span><input type="number" min={0} max={80} step={0.5} value={activityForm.weeklyHours} onChange={(event) => setActivityForm({ ...activityForm, weeklyHours: Number(event.target.value) })} /></label>
            <button className="primary-button" type="submit"><Plus size={17} /> Add activity</button>
          </form>
          <section className="activity-list-section">
            <div className="activity-summary"><span>Total weekly activity time</span><strong>{workload?.weeklyActivityHours ?? 0} hours</strong><small>Workload level: {workload ? titleCase(workload.level) : "Not available"}</small></div>
            {activities.length ? <div className="activity-list">{activities.map((activity) => <article key={activity.id}><div><strong>{activity.name}</strong><span>{titleCase(activity.kind)}{activity.role ? ` · ${activity.role}` : ""}</span></div><b>{activity.weekly_hours}h</b><button className="icon-button danger" onClick={() => void removeActivity(activity.id)} aria-label={`Remove ${activity.name}`}><Trash size={16} /></button></article>)}</div> : <EmptyState title="No activities yet" body="Add clubs, work, athletics, service, internships, or family responsibilities." />}
          </section>
        </div>
      </>
    );
  }

  function renderTimeline() {
    return (
      <>
        <PageHeader title="Timeline and checklist" description="Generated tasks are editable, completable, and mixed with your own tasks." actions={<button className="primary-button" onClick={() => void generateTasks()} disabled={Boolean(busyLabel)}><Sparkle size={17} /> Generate timeline</button>} />
        <div className="timeline-layout">
          <section className="content-section">
            {tasks.length ? <div className="task-list">{tasks.map((task) => <article className={`timeline-row ${task.is_completed ? "completed" : ""}`} key={task.id}><input type="checkbox" checked={task.is_completed} onChange={(event) => void updateTask(task.id, { is_completed: event.target.checked })} aria-label={`Mark ${task.title} complete`} /><div><input className="task-title-input" value={task.title} onChange={(event) => setTasks((current) => current.map((candidate) => candidate.id === task.id ? { ...candidate, title: event.target.value } : candidate))} onBlur={() => void updateTask(task.id, { title: task.title })} /><span>{task.due_label ?? titleCase(task.category)}{task.is_generated ? " · Generated" : ""}</span>{task.explanation && <p>{task.explanation}</p>}</div><button className="icon-button danger" onClick={async () => { if (!supabase) return; await supabase.from("timeline_tasks").delete().eq("id", task.id); setTasks((current) => current.filter((candidate) => candidate.id !== task.id)); }} aria-label={`Delete ${task.title}`}><Trash size={16} /></button></article>)}</div> : <EmptyState title="No timeline tasks" body="Generate tasks from the current plan or add your own." />}
          </section>
          <form className="form-section compact-form" onSubmit={addCustomTask}><h2>Add a custom task</h2><label className="form-field"><span>Task</span><input value={taskForm.title} onChange={(event) => setTaskForm({ ...taskForm, title: event.target.value })} required /></label><label className="form-field"><span>Category</span><select value={taskForm.category} onChange={(event) => setTaskForm({ ...taskForm, category: event.target.value })}><option value="academics">Academics</option><option value="activities">Activities</option><option value="college">College readiness</option><option value="summer">Summer</option><option value="admin">Admin</option></select></label><label className="form-field"><span>When</span><input value={taskForm.dueLabel} onChange={(event) => setTaskForm({ ...taskForm, dueLabel: event.target.value })} placeholder="Before registration" /></label><button className="secondary-button" type="submit"><Plus size={17} /> Add task</button></form>
        </div>
      </>
    );
  }

  function renderSimulator() {
    if (!profile) return null;
    return (
      <>
        <PageHeader title="Plan simulator" description="Compare a scenario without changing the saved four-year plan." actions={simulationResult && <button className="secondary-button" onClick={() => void saveSimulation()} disabled={Boolean(busyLabel)}><FloppyDisk size={17} /> Save simulation</button>} />
        <div className="simulator-layout">
          <section className="sim-controls">
            <label className="form-field"><span>Planning direction</span><select value={simulationConfig.majorDirection} onChange={(event) => setSimulationConfig({ ...simulationConfig, majorDirection: event.target.value as SimulationConfig["majorDirection"] })}>{MAJOR_DIRECTION_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select><small className="form-hint">Changes profile matching only. It does not invent major requirements.</small></label>
            <label className="form-field"><span>Path intensity</span><select value={simulationConfig.pathIntensity} onChange={(event) => setSimulationConfig({ ...simulationConfig, pathIntensity: event.target.value as SimulationConfig["pathIntensity"] })}><option value="lower_stress">One fewer demanding course</option><option value="balanced">Keep current target</option><option value="competitive">One more demanding course</option></select></label>
            <label className="form-field"><span>Course style</span><select value={simulationConfig.courseStyle} onChange={(event) => setSimulationConfig({ ...simulationConfig, courseStyle: event.target.value as SimulationConfig["courseStyle"] })}><option value="more_regular">One fewer weighted course</option><option value="more_honors">Add one Honors course</option><option value="more_dual_enrollment">Add one 3-unit SMCCD course</option></select><small className="form-hint">The SMCCD scenario adds 9 weekly student-work hours.</small></label>
            <label className="form-field"><span>Activity load</span><select value={simulationConfig.activityLoad} onChange={(event) => setSimulationConfig({ ...simulationConfig, activityLoad: event.target.value as SimulationConfig["activityLoad"] })}><option value="lower">3 fewer hours per week</option><option value="same">No change</option><option value="higher">4 more hours per week</option></select></label>
            <button className="primary-button" onClick={() => void runSimulation()} disabled={Boolean(busyLabel)}><Scales size={17} /> Run comparison</button>
          </section>
          <section className="simulation-output">
            {simulationResult ? <><div className="comparison-table"><div className="comparison-head"><span>Measure</span><strong>Current</strong><strong>Simulated</strong></div><div><span>Planning direction</span><strong>{majorDirectionLabel(profile.major_direction)}</strong><strong>{majorDirectionLabel(simulationConfig.majorDirection)}</strong></div><div><span>{profile.tracker_mode === "selected" ? "Tracked coverage" : "Graduation coverage"}</span><strong>{simulationResult.current.graduationPercent}%</strong><strong>{simulationResult.simulated.graduationPercent}%</strong></div><div><span>Projected weighted GPA</span><strong>{formatGpa(simulationResult.current.projectedWeightedGpa)}</strong><strong>{formatGpa(simulationResult.simulated.projectedWeightedGpa)}</strong></div><div><span>Known weekly hours</span><strong>{simulationResult.current.workloadScore}</strong><strong>{simulationResult.simulated.workloadScore}</strong></div><div><span>Demanding courses</span><strong>{simulationResult.current.demandingCourseCount}</strong><strong>{simulationResult.simulated.demandingCourseCount}</strong></div><div><span>Stress baseline</span><strong>{simulationResult.current.stressLevel} / 5</strong><strong>{simulationResult.simulated.stressLevel} / 5</strong></div><div><span>Activity hours</span><strong>{simulationResult.current.activityHours}</strong><strong>{simulationResult.simulated.activityHours}</strong></div></div>{simulationExplanation && <div className="simulation-explanation"><h2>What changed and why</h2><p>{simulationExplanation}</p></div>}<div className="simulation-notes"><div><h3>Changes</h3><ul>{simulationResult.changes.map((change) => <li key={change}>{change}</li>)}</ul></div><div><h3>Limits and checks</h3><ul>{simulationResult.risks.length ? simulationResult.risks.map((risk) => <li key={risk}>{risk}</li>) : <li>The scenario stays inside the limits currently saved in the profile.</li>}</ul></div></div></> : <EmptyState title="No simulation yet" body="Adjust the four controls and run a transparent comparison." />}
          </section>
        </div>
        <div className="notice-strip"><ShieldCheckIcon /><span>Running or saving a simulation never overwrites the active plan.</span></div>
      </>
    );
  }

  function ShieldCheckIcon() {
    return <CheckCircle size={19} weight="duotone" aria-hidden />;
  }

  function renderView() {
    switch (view) {
      case "dashboard": return renderDashboard();
      case "profile": return renderProfile();
      case "sources": return renderSources();
      case "catalog": return renderCatalog();
      case "graduation": return renderGraduation();
      case "gpa": return renderGpa();
      case "planner": return renderPlanner();
      case "dual_credit": return renderDualCredit();
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
          <a className="wordmark" href="/app"><span className="wordmark-mark">PP</span><span>Pilot Princess</span></a>
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
            return <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)} type="button"><NavIcon size={17} weight={view === item.id ? "fill" : "regular"} aria-hidden /><span>{item.label}</span></button>;
          })}</div>}
        </nav>
        <div className="sidebar-footer">
          <div className="school-chip"><GraduationCap size={18} weight="duotone" /><span><strong>{school.short_name}</strong><small>{school.source_year} sources</small></span></div>
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
