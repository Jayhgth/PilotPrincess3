import {
  ArrowLeftIcon as ArrowLeft,
  ArrowRightIcon as ArrowRight,
  CheckIcon as Check,
  CheckCircleIcon as CheckCircle,
  CpuIcon as Cpu,
  FileTextIcon as FileText,
  MoonIcon as Moon,
  SunIcon as Sun,
  UploadSimpleIcon as UploadSimple,
  UserCircleIcon as UserCircle,
  WarningIcon as Warning
} from "@phosphor-icons/react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import type {
  CatalogReviewItem,
  Course,
  CourseRequirementMapping,
  GradeLevel,
  PlanCourse,
  PlanVersion,
  RequirementArea,
  School,
  SmccdHighSchoolEquivalency,
  StudentSettings
} from "@/lib/models";
import { GRADE_LEVELS, REQUIREMENT_LABELS } from "@/lib/planning";
import {
  findExistingTranscriptPlanCourse,
  isDtechIntersessionCourse,
  resolveTranscriptCourse,
  transcriptPlanCourseDraft,
  type TranscriptCoursePayload
} from "@/lib/transcript";
import BrandMark from "@/components/BrandMark";
import CodexConnectionSetup, { type CodexSetupValue } from "@/components/CodexConnectionSetup";
import InstitutionIdentityMark from "@/components/InstitutionIdentityMark";
import TranscriptAiRunDetails, { type TranscriptAiTransparency } from "@/components/TranscriptAiRunDetails";

type OnboardingStage = "student" | "assistant" | "transcript";

const STAGES: Array<{ id: OnboardingStage; label: string }> = [
  { id: "student", label: "About you" },
  { id: "assistant", label: "Pilot Assistant" },
  { id: "transcript", label: "Transcript" }
];

const ALL_REQUIREMENT_AREAS = Object.keys(REQUIREMENT_LABELS) as RequirementArea[];

export function applyOnboardingPlanningDefaults(settings: StudentSettings, gradeLevel: GradeLevel): StudentSettings {
  return {
    ...settings,
    plan_start_grade: gradeLevel,
    plan_end_grade: 12,
    tracker_mode: "full",
    tracked_requirement_areas: ALL_REQUIREMENT_AREAS
  };
}

export function onboardingErrorMessage(caught: unknown, fallback: string) {
  if (caught instanceof Error && caught.message) return caught.message;
  if (caught && typeof caught === "object" && "message" in caught) {
    const message = (caught as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

function asNumber(value: string) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function payloadFor(item: CatalogReviewItem) {
  return (item.corrected_payload ?? item.proposed_payload) as unknown as TranscriptCoursePayload;
}

function courseTitle(item: CatalogReviewItem) {
  const payload = payloadFor(item);
  return payload.matched_course_name || payload.course_name || "Transcript course";
}

type SchoolSearchResult = Pick<School, "id" | "cds_code" | "name" | "district_name" | "county_name" | "governance_type" | "city" | "postal_code" | "low_grade" | "high_grade" | "website_url">;

interface NearbyDistrictResult {
  district_code: string;
  district_name: string;
  colleges_count: number;
  nearest_distance_miles: number | null;
  providers: Array<{ id: string; name: string; website_url: string; distance_miles: number | null }>;
  is_recommended: boolean;
}

interface OnboardingFlowProps {
  supabase: SupabaseClient;
  session: Session;
  school: School;
  settings: StudentSettings;
  courses: Course[];
  mappings: CourseRequirementMapping[];
  equivalencies: SmccdHighSchoolEquivalency[];
  activeVersion: PlanVersion;
  existingPlanCourses: PlanCourse[];
  theme: "light" | "dark";
  mode?: "initial" | "replay";
  onComplete: () => Promise<void>;
  onExit?: () => void;
  onSignOut: () => Promise<void>;
  onThemeToggle: () => void;
}

export default function OnboardingFlow({
  supabase,
  session,
  school,
  settings: initialSettings,
  courses,
  mappings,
  equivalencies,
  activeVersion,
  existingPlanCourses,
  theme,
  mode = "initial",
  onComplete,
  onExit,
  onSignOut,
  onThemeToggle
}: OnboardingFlowProps) {
  const isReplay = mode === "replay";
  const [stage, setStage] = useState<OnboardingStage>("student");
  const [settings, setSettings] = useState<StudentSettings>(() => applyOnboardingPlanningDefaults(
    initialSettings,
    (initialSettings.grade_level ?? initialSettings.plan_start_grade ?? 9) as GradeLevel
  ));
  const [activeSchool, setActiveSchool] = useState(school);
  const [selectedSchool, setSelectedSchool] = useState<SchoolSearchResult | null>(() => initialSettings.school_confirmed ? school : null);
  const [schoolQuery, setSchoolQuery] = useState(() => initialSettings.school_confirmed ? school.name : "");
  const [schoolResults, setSchoolResults] = useState<SchoolSearchResult[]>(() => initialSettings.school_confirmed ? [school] : []);
  const [nearbyDistricts, setNearbyDistricts] = useState<NearbyDistrictResult[]>([]);
  const [selectedDistrictCode, setSelectedDistrictCode] = useState<string | null>(null);
  const [districtSelectionTouched, setDistrictSelectionTouched] = useState(false);
  const [districtSelectionMethod, setDistrictSelectionMethod] = useState<"suggested" | "student" | "pilot">("suggested");
  const [schoolCourses, setSchoolCourses] = useState(courses);
  const [schoolMappings, setSchoolMappings] = useState(mappings);
  const [schoolEquivalencies, setSchoolEquivalencies] = useState(equivalencies);
  const [transcriptFile, setTranscriptFile] = useState<File | null>(null);
  const [transcriptItems, setTranscriptItems] = useState<CatalogReviewItem[]>([]);
  const [selectedTranscriptIds, setSelectedTranscriptIds] = useState<Set<string>>(new Set());
  const [transcriptSummary, setTranscriptSummary] = useState<string | null>(null);
  const [transcriptAiTransparency, setTranscriptAiTransparency] = useState<TranscriptAiTransparency | null>(null);
  const [aiSetup, setAiSetup] = useState<CodexSetupValue>({
    enabled: initialSettings.ai_enabled ?? false,
    model: initialSettings.ai_model ?? "gpt-5.6-luna",
    approved: Boolean(initialSettings.ai_connection_approved_at),
    testedAt: initialSettings.ai_setup_tested_at
  });
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stageIndex = STAGES.findIndex((candidate) => candidate.id === stage);
  const currentGrade = (settings.grade_level ?? 9) as GradeLevel;
  const planEndGrade = 12 as GradeLevel;
  const planYears = 13 - currentGrade;
  const completedCourseCount = existingPlanCourses.filter((course) => course.status === "completed").length;

  const selectedTranscriptItems = useMemo(
    () => transcriptItems.filter((item) => selectedTranscriptIds.has(item.id)),
    [selectedTranscriptIds, transcriptItems]
  );
  const intersessionTranscriptItems = transcriptItems.filter((item) => {
    const payload = payloadFor(item);
    return isDtechIntersessionCourse(payload);
  });
  const academicTranscriptItems = transcriptItems.filter((item) => !intersessionTranscriptItems.includes(item));
  const selectedDistrict = nearbyDistricts.find((district) => district.district_code === selectedDistrictCode) ?? null;

  useEffect(() => {
    if (stage !== "student") return;
    const query = schoolQuery.trim();
    if ((selectedSchool && query === selectedSchool.name) || query.length < 2) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void supabase.rpc("search_california_high_schools", { query_text: query, result_limit: 12 }).then(({ data, error: searchError }) => {
        if (cancelled) return;
        if (searchError) {
          setError("California school search is temporarily unavailable.");
          setSchoolResults([]);
          return;
        }
        setSchoolResults((data ?? []) as unknown as SchoolSearchResult[]);
      });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [schoolQuery, selectedSchool, stage, supabase]);

  useEffect(() => {
    let active = true;
    if (!selectedSchool) return;
    void Promise.all([
      supabase.rpc("nearby_college_districts", { target_school_id: selectedSchool.id, result_limit: 5 }),
      supabase.from("student_college_district_preferences").select("district_code,selection_method").eq("user_id", session.user.id).maybeSingle()
    ]).then(([{ data, error: providerError }, preferenceResult]) => {
      if (!active) return;
      const districts = providerError ? [] : (data ?? []) as unknown as NearbyDistrictResult[];
      setNearbyDistricts(districts);
      const preference = preferenceResult.error ? null : preferenceResult.data;
      if (!districtSelectionTouched) {
        if (preference && ["student", "pilot"].includes(preference.selection_method)) {
          setSelectedDistrictCode(preference.district_code);
          setDistrictSelectionTouched(true);
          setDistrictSelectionMethod(preference.selection_method as "student" | "pilot");
        } else {
          setSelectedDistrictCode(districts.find((district) => district.is_recommended)?.district_code ?? districts[0]?.district_code ?? null);
          setDistrictSelectionMethod("suggested");
        }
      }
    });
    return () => { active = false; };
  }, [districtSelectionTouched, selectedSchool, session.user.id, supabase]);

  function validateStage() {
    setError(null);
    if (stage === "student") {
      if (!selectedSchool) {
        setError("Choose your California public or charter high school.");
        return false;
      }
      if (!settings.preferred_name.trim() || !settings.age || !settings.grade_level || !settings.graduation_year) {
        setError("Add your name, age, current grade, and expected graduation year.");
        return false;
      }
    }
    if (stage === "assistant" && aiSetup.enabled && !aiSetup.approved) {
      setError("Approve the Codex connection before continuing, or choose to continue without AI.");
      return false;
    }
    if (stage === "assistant" && aiSetup.enabled && !aiSetup.testedAt) {
      setError("Test the selected model before continuing.");
      return false;
    }
    return true;
  }

  async function saveAiPreferences() {
    const payload = await authorizedPost("/api/ai/preferences", {
      enabled: aiSetup.enabled,
      model: aiSetup.model,
      approved: aiSetup.approved,
      testedAt: aiSetup.testedAt
    });
    const preferences = payload.preferences as {
      enabled: boolean;
      model: StudentSettings["ai_model"];
      approvedAt: string | null;
      testedAt: string | null;
    };
    setSettings((current) => ({
      ...current,
      ai_enabled: preferences.enabled,
      ai_model: preferences.model,
      ai_reasoning_effort: "low",
      ai_connection_approved_at: preferences.approvedAt,
      ai_setup_tested_at: preferences.testedAt
    }));
  }

  async function saveSchoolSelection() {
    if (!selectedSchool) throw new Error("Choose your California public or charter high school.");
    const selection = await supabase.rpc("select_current_school", { target_school_id: selectedSchool.id });
    if (selection.error) throw selection.error;
    if (selectedDistrictCode) {
      const preference = await supabase.rpc("set_college_district_preference", {
        target_district_code: selectedDistrictCode,
        preference_method: districtSelectionMethod
      });
      if (preference.error) throw preference.error;
    }
    const [schoolResult, courseResult, mappingResult] = await Promise.all([
      supabase.from("schools").select("*").eq("id", selectedSchool.id).single(),
      supabase.from("courses").select("*").eq("school_id", selectedSchool.id).eq("review_status", "approved").order("subject").order("name"),
      supabase.from("course_requirement_mappings").select("id, course_id, requirement_id, confidence, is_user_override, courses!inner(school_id)").eq("courses.school_id", selectedSchool.id)
    ]);
    const firstError = schoolResult.error ?? courseResult.error ?? mappingResult.error;
    if (firstError) throw firstError;
    const loadedSchool = schoolResult.data as unknown as School;
    setActiveSchool(loadedSchool);
    setSchoolCourses((courseResult.data ?? []) as unknown as Course[]);
    setSchoolMappings((mappingResult.data ?? []) as unknown as CourseRequirementMapping[]);
    setSchoolEquivalencies(loadedSchool.slug === "design-tech-high-school" ? equivalencies : []);
    setSettings((current) => ({ ...current, school_id: loadedSchool.id, school_confirmed: true, school_selected_at: new Date().toISOString() }));
  }

  async function nextStage() {
    if (!validateStage()) return;
    if (stage === "student") {
      setBusyLabel("Saving school");
      try {
        await saveSchoolSelection();
      } catch (caught) {
        setError(onboardingErrorMessage(caught, "The school selection could not be saved."));
        return;
      } finally {
        setBusyLabel(null);
      }
    }
    if (stage === "assistant") {
      setBusyLabel(aiSetup.enabled ? "Saving Pilot connection" : "Saving AI preference");
      try {
        await saveAiPreferences();
      } catch (caught) {
        setError(onboardingErrorMessage(caught, "The AI preference could not be saved."));
        return;
      } finally {
        setBusyLabel(null);
      }
    }
    const next = STAGES[stageIndex + 1];
    if (next) setStage(next.id);
  }

  function previousStage() {
    setError(null);
    const previous = STAGES[stageIndex - 1];
    if (previous) setStage(previous.id);
  }

  function changeGrade(grade: GradeLevel) {
    setSettings((current) => applyOnboardingPlanningDefaults({ ...current, grade_level: grade }, grade));
  }

  async function authorizedPost(path: string, body: Record<string, unknown>) {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify(body)
    });
    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) throw new Error(String(payload.error ?? "The request failed."));
    return payload;
  }

  async function parseTranscript() {
    setError(null);
    if (!transcriptFile) {
      setError("Choose a transcript file first.");
      return;
    }
    setBusyLabel("Reading transcript");
    try {
      const safeName = transcriptFile.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const storagePath = `${session.user.id}/${crypto.randomUUID()}-${safeName}`;
      const mimeType = transcriptFile.type || "application/octet-stream";
      const kind: "upload" | "screenshot" = mimeType.startsWith("image/") ? "screenshot" : "upload";
      const { error: uploadError } = await supabase.storage
        .from("source-uploads")
        .upload(storagePath, transcriptFile, { contentType: mimeType, upsert: false });
      if (uploadError) throw uploadError;
      const { data: existingTranscript } = await supabase
        .from("official_sources")
        .select("*")
        .eq("user_id", session.user.id)
        .eq("document_type", "transcript")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const sourceValues = {
          school_id: activeSchool.id,
          user_id: session.user.id,
          title: transcriptFile.name,
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
      const { data: source, error: sourceError } = await sourceMutation
        .select("id")
        .single();
      if (sourceError || !source) {
        await supabase.storage.from("source-uploads").remove([storagePath]);
        throw sourceError ?? new Error("The transcript source could not be saved.");
      }

      const result = await authorizedPost("/api/ai/parse-transcript", { sourceId: source.id });
      if (existingTranscript?.storage_path && existingTranscript.storage_path !== storagePath) {
        await supabase.storage.from("source-uploads").remove([existingTranscript.storage_path]);
      }
      const items = ((result.reviewItems ?? []) as CatalogReviewItem[]).filter(
        (item) => item.entity_type === "transcript_course"
      );
      setTranscriptItems(items);
      setSelectedTranscriptIds(new Set(items.map((item) => item.id)));
      const parserNote = result.aiUsed === true
        ? "This source had no usable text layer, so Codex vision was used for extraction."
        : "Parsed deterministically from the document text. Codex was not used.";
      setTranscriptSummary(`${String(result.summary ?? "Transcript review ready.")} ${parserNote}`);
      setTranscriptAiTransparency(result.aiUsed === true ? result.aiTransparency as typeof transcriptAiTransparency : null);
      if (items.length === 0) {
        setError("No completed courses were extracted. The source is saved for manual review.");
      }
    } catch (caught) {
      setError(onboardingErrorMessage(caught, "The transcript could not be parsed."));
    } finally {
      setBusyLabel(null);
    }
  }

  async function finishOnboarding() {
    setError(null);
    if (!validateStage()) return;
    setBusyLabel(isReplay ? "Saving onboarding changes" : "Creating your workspace");
    try {
      const selectedIds = [...selectedTranscriptIds];
      const rejectedIds = transcriptItems.filter((item) => !selectedTranscriptIds.has(item.id)).map((item) => item.id);
      if (selectedIds.length > 0) {
        const { error: approveError } = await supabase
          .from("catalog_review_items")
          .update({ status: "approved" })
          .in("id", selectedIds);
        if (approveError) throw approveError;
      }
      if (rejectedIds.length > 0) {
        const { error: rejectError } = await supabase
          .from("catalog_review_items")
          .update({ status: "rejected" })
          .in("id", rejectedIds);
        if (rejectError) throw rejectError;
      }

      const { data: persistedPlanData, error: persistedPlanError } = await supabase
        .from("plan_courses")
        .select("*")
        .eq("plan_version_id", activeVersion.id);
      if (persistedPlanError) throw persistedPlanError;
      const persistedPlanCourses = (persistedPlanData ?? []) as unknown as PlanCourse[];
      const linkedPlanCoursesByReviewId = new Map(
        persistedPlanCourses
          .filter((row): row is PlanCourse & { source_review_item_id: string } => Boolean(row.source_review_item_id))
          .map((row) => [row.source_review_item_id, row])
      );
      const claimedPlanCourseIds = new Set([...linkedPlanCoursesByReviewId.values()].map((row) => row.id));
      let nextSortOrder = persistedPlanCourses.reduce((maximum, row) => Math.max(maximum, row.sort_order), -1) + 1;
      const candidates = selectedTranscriptItems.map((item) => {
        const draft = transcriptPlanCourseDraft(payloadFor(item), settings, schoolCourses, schoolMappings, item.id, schoolEquivalencies);
        const linked = linkedPlanCoursesByReviewId.get(item.id);
        const existing = linked ?? findExistingTranscriptPlanCourse(draft, persistedPlanCourses, claimedPlanCourseIds);
        if (existing) claimedPlanCourseIds.add(existing.id);
        return {
          id: existing?.id ?? crypto.randomUUID(),
          ...draft,
          plan_version_id: activeVersion.id,
          user_id: session.user.id,
          sort_order: existing?.sort_order ?? nextSortOrder++
        };
      });
      if (candidates.length > 0) {
        const { error: importError } = await supabase.from("plan_courses").upsert(candidates);
        if (importError) throw importError;
      }

      const completedSettings: StudentSettings = {
        ...applyOnboardingPlanningDefaults(settings, currentGrade),
        school_id: activeSchool.id,
        school_confirmed: true,
        onboarding_complete: true,
        ai_enabled: aiSetup.enabled,
        ai_model: aiSetup.model,
        ai_reasoning_effort: "low",
        ai_connection_approved_at: aiSetup.enabled ? (settings.ai_connection_approved_at ?? new Date().toISOString()) : null,
        ai_setup_tested_at: aiSetup.testedAt
      };
      const { error: settingsError } = await supabase
        .from("student_settings")
        .update(completedSettings)
        .eq("id", session.user.id);
      if (settingsError) throw settingsError;
      const { error: versionError } = await supabase
        .from("plan_versions")
        .update({
          generation_config: {
            ...activeVersion.generation_config,
            plan_start_grade: currentGrade,
            plan_end_grade: planEndGrade,
            tracker_mode: completedSettings.tracker_mode,
            tracked_requirement_areas: completedSettings.tracked_requirement_areas,
            ai_enabled: completedSettings.ai_enabled,
            ai_model: completedSettings.ai_model,
            ...(isReplay ? {} : { transcript_courses_imported: candidates.length })
          }
        })
        .eq("id", activeVersion.id);
      if (versionError) throw versionError;
      await supabase.rpc("log_app_event", {
        event_name: isReplay ? "onboarding_replayed" : "onboarding_completed",
        properties: {
          plan_years: planYears,
          tracker_mode: completedSettings.tracker_mode,
          ai_enabled: completedSettings.ai_enabled,
          ai_model: completedSettings.ai_model,
          transcript_courses_imported: candidates.length
        }
      });
      await onComplete();
    } catch (caught) {
      setError(onboardingErrorMessage(caught, "Onboarding could not be completed."));
    } finally {
      setBusyLabel(null);
    }
  }

  return (
    <main className="onboarding-shell t3code-app" data-stage={stage} data-stage-index={stageIndex}>
      <header className="onboarding-topbar">
        <a className="wordmark" href="/app"><BrandMark /><span>Pilot Princess</span></a>
        <div className="onboarding-topbar-actions">
          {isReplay && <span>Setup changes save at Finish. Pilot approval saves on its step.</span>}
          <button className="quiet-button onboarding-theme-toggle" onClick={onThemeToggle} type="button" title={`Use ${theme === "light" ? "dark" : "light"} theme`} aria-label={`Use ${theme === "light" ? "dark" : "light"} theme`}>
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
            <span>{theme === "light" ? "Dark" : "Light"}</span>
          </button>
          <button className="quiet-button" onClick={() => isReplay ? onExit?.() : void onSignOut()} type="button">{isReplay ? "Exit onboarding" : "Sign out"}</button>
        </div>
      </header>
      <div className="onboarding-layout">
        <aside className="onboarding-progress" aria-label="Onboarding progress">
          <p>Set up your route</p>
          <ol>
            {STAGES.map((item, index) => (
              <li key={item.id} className={item.id === stage ? "active" : index < stageIndex ? "complete" : ""} aria-current={item.id === stage ? "step" : undefined}>
                <span>{index < stageIndex ? <Check size={13} weight="bold" /> : index + 1}</span>
                {item.label}
              </li>
            ))}
          </ol>
        </aside>

        <section className="onboarding-stage" aria-live="polite">
          {stage === "student" && <>
            <header><UserCircle size={25} weight="duotone" /><h1>Tell us where you are now</h1><p>This anchors school years and plans through graduation.</p></header>
            <div className="form-grid two onboarding-student-grid">
              <div className="form-field onboarding-school-field full">
                <label htmlFor={selectedSchool ? undefined : "onboarding-school-search"}>California high school</label>
                {!selectedSchool && <input id="onboarding-school-search" aria-label="Search California high schools" autoComplete="off" value={schoolQuery} onChange={(event) => { setSchoolQuery(event.target.value); setSelectedSchool(null); setNearbyDistricts([]); setSelectedDistrictCode(null); setDistrictSelectionTouched(false); setDistrictSelectionMethod("suggested"); }} placeholder="Search by school, district, city, ZIP, or CDS code" />}
                {schoolQuery.trim().length >= 2 && schoolResults.length > 0 && !selectedSchool && <div className="onboarding-school-results" role="listbox" aria-label="California high school results">{schoolResults.map((result) => <button type="button" role="option" aria-selected={false} key={result.id} onClick={() => { setSelectedSchool(result); setSchoolQuery(result.name); setNearbyDistricts([]); setSelectedDistrictCode(null); setDistrictSelectionTouched(false); setDistrictSelectionMethod("suggested"); setError(null); }}><InstitutionIdentityMark name={result.name} websiteUrl={result.website_url} decorative /><span><strong>{result.name}</strong><small>{[result.district_name, result.city, result.governance_type === "charter" ? "Charter" : null].filter(Boolean).join(" · ")}</small></span></button>)}</div>}
                {selectedSchool && <div className="onboarding-selected-school"><InstitutionIdentityMark name={selectedSchool.name} websiteUrl={selectedSchool.website_url} decorative /><span><strong>{selectedSchool.name}</strong><small>{[selectedSchool.district_name, selectedSchool.city].filter(Boolean).join(" · ")}</small></span><button className="quiet-button small" type="button" onClick={() => { setSelectedSchool(null); setSchoolQuery(""); setSchoolResults([]); setNearbyDistricts([]); setSelectedDistrictCode(null); }}>Change</button></div>}
              </div>
              {selectedSchool && nearbyDistricts.length > 0 && <div className="onboarding-district-field full"><label htmlFor="onboarding-college-district">Community-college district</label><div><select id="onboarding-college-district" value={selectedDistrictCode ?? ""} onChange={(event) => { setSelectedDistrictCode(event.target.value); setDistrictSelectionTouched(true); setDistrictSelectionMethod("student"); }}>{nearbyDistricts.map((district) => <option key={district.district_code} value={district.district_code}>{district.district_name}{district.is_recommended ? " — recommended" : district.nearest_distance_miles != null ? ` — ${Number(district.nearest_distance_miles).toFixed(1)} mi` : ""}</option>)}</select><p>{selectedDistrict ? `${selectedDistrict.providers.map((provider) => provider.name).join(" · ")}. ` : ""}Recommended from the school’s public address; change it later in Settings.</p></div></div>}
              <label className="form-field"><span>Preferred name</span><input value={settings.preferred_name} onChange={(event) => setSettings({ ...settings, preferred_name: event.target.value })} /></label>
              <label className="form-field"><span>Age</span><input type="number" min={12} max={22} value={settings.age ?? ""} onChange={(event) => setSettings({ ...settings, age: asNumber(event.target.value) })} /></label>
              <label className="form-field"><span>Current grade</span><select value={settings.grade_level ?? ""} onChange={(event) => changeGrade(Number(event.target.value) as GradeLevel)}><option value="">Select grade</option>{GRADE_LEVELS.map((grade) => <option value={grade} key={grade}>Grade {grade}</option>)}</select></label>
              <label className="form-field"><span>Expected graduation year</span><input type="number" min={2026} max={2040} value={settings.graduation_year ?? ""} onChange={(event) => setSettings({ ...settings, graduation_year: asNumber(event.target.value) })} /></label>
            </div>
          </>}

          {stage === "assistant" && <>
            <header><Cpu size={25} weight="duotone" /><h1>Connect Pilot Assistant</h1><p>Choose the model, approve the data boundary, and verify the real server connection. This choice saves when you continue.</p></header>
            <CodexConnectionSetup value={aiSetup} onChange={setAiSetup} />
          </>}

          {stage === "transcript" && <>
            <header><FileText size={25} weight="duotone" /><h1>{isReplay ? "Keep your completed classes" : "Add completed classes"}</h1><p>{isReplay ? "Update your profile and Pilot setup without changing saved courses." : "Upload your transcript. Nothing counts until you review and import it."}</p></header>
            {isReplay ? <div className="onboarding-replay-summary">
              <CheckCircle size={20} weight="duotone" />
              <div><strong>{completedCourseCount} completed {completedCourseCount === 1 ? "course" : "courses"} will stay in your plan</strong><p>Finish to save profile and assistant changes. Exit onboarding to discard them.</p></div>
            </div> : transcriptItems.length === 0 ? <div className="transcript-entry">
              <label className="transcript-drop"><UploadSimple size={25} weight="duotone" /><span><strong>{transcriptFile?.name ?? "Choose a transcript"}</strong><small>PDF, DOCX, text, CSV, PNG, JPEG, or WebP. Maximum 15 MB.</small></span><input type="file" accept=".pdf,.docx,.txt,.csv,.png,.jpg,.jpeg,.webp" onChange={(event) => setTranscriptFile(event.target.files?.[0] ?? null)} /></label>
              <button className="secondary-button" type="button" onClick={() => void parseTranscript()} disabled={Boolean(busyLabel) || !transcriptFile}><FileText size={17} /> {busyLabel === "Reading transcript" ? "Reading transcript" : "Read transcript"}</button>
            </div> : <div className="transcript-review">
              {transcriptSummary && <p className="transcript-summary">{transcriptSummary}</p>}
              {transcriptAiTransparency && <TranscriptAiRunDetails run={transcriptAiTransparency} summary="Inspect Codex vision run" />}
              <div className="transcript-review-heading"><strong>{academicTranscriptItems.length} GPA courses found</strong><span>Select the rows to import.</span></div>
              <div className="transcript-course-list">{academicTranscriptItems.map((item) => {
                const payload = payloadFor(item);
                const selected = selectedTranscriptIds.has(item.id);
                const resolution = resolveTranscriptCourse(payload, schoolCourses);
                const identityLabel = resolution.classification === "dtech_catalog" || resolution.classification === "high_school_catalog"
                  ? "Catalog match"
                  : resolution.classification === "smccd_catalog"
                    ? "College match"
                    : resolution.classification === "smccd_unmatched"
                      ? "College review"
                      : "Custom course";
                return <label key={item.id} className={selected ? "selected" : ""}><input type="checkbox" checked={selected} onChange={() => setSelectedTranscriptIds((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} /><span><strong>{courseTitle(item)}</strong><small>{payload.letter_grade ? `Grade ${payload.letter_grade}` : "Grade needs review"}{payload.grade_level ? `, taken in grade ${payload.grade_level}` : ""}{payload.credits !== null && payload.credits !== undefined ? `, ${payload.credits} credits` : ""}</small></span><em>{identityLabel}, {resolution.identityResolved ? "resolved" : item.confidence}</em></label>;
              })}</div>
              {intersessionTranscriptItems.length > 0 && <details className="transcript-pass-review" open><summary><span><strong>Intersession pass/fail courses</strong><small>{intersessionTranscriptItems.length} classes, excluded from GPA. Passed classes count toward Personal Development.</small></span></summary><div className="transcript-course-list">{intersessionTranscriptItems.map((item) => { const payload = payloadFor(item); const selected = selectedTranscriptIds.has(item.id); const passed = payload.letter_grade?.toUpperCase() === "P"; return <label key={item.id} className={selected ? "selected" : ""}><input type="checkbox" checked={selected} onChange={() => setSelectedTranscriptIds((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} /><span><strong>{courseTitle(item)}</strong><small>{passed ? `Pass, grade ${payload.grade_level}, ${payload.credits ?? 0} Personal Development credits` : `F, grade ${payload.grade_level}, no Personal Development credit`}</small></span><em>Pass/fail · Not in GPA</em></label>; })}</div></details>}
              <button className="quiet-button" type="button" onClick={() => { setTranscriptFile(null); setTranscriptItems([]); setSelectedTranscriptIds(new Set()); setTranscriptSummary(null); setTranscriptAiTransparency(null); }}>Use a different transcript</button>
            </div>}
          </>}

          {error && <div className="inline-alert error" role="alert"><Warning size={17} /> {error}</div>}
          <footer className="onboarding-actions">
            {stageIndex > 0 ? <button className="secondary-button" type="button" onClick={previousStage} disabled={Boolean(busyLabel)}><ArrowLeft size={17} /> Back</button> : <span />}
            {stage !== "transcript"
              ? <button className="primary-button" type="button" onClick={() => void nextStage()} disabled={Boolean(busyLabel)}>Continue <ArrowRight size={17} /></button>
              : <button className="primary-button" type="button" onClick={() => void finishOnboarding()} disabled={Boolean(busyLabel)}>{busyLabel ? (isReplay ? "Saving changes" : "Creating workspace") : isReplay ? "Save changes" : transcriptItems.length ? "Import selected and finish" : "Finish setup"} <ArrowRight size={17} /></button>}
          </footer>
        </section>
      </div>
      {busyLabel && <div className="busy-bar onboarding-busy" role="status">{busyLabel}</div>}
    </main>
  );
}
