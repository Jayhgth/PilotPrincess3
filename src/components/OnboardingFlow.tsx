import {
  ArrowLeftIcon as ArrowLeft,
  ArrowRightIcon as ArrowRight,
  CheckIcon as Check,
  CheckCircleIcon as CheckCircle,
  CpuIcon as Cpu,
  FileTextIcon as FileText,
  GraduationCapIcon as GraduationCap,
  PathIcon as Path,
  UploadSimpleIcon as UploadSimple,
  UserCircleIcon as UserCircle,
  WarningIcon as Warning
} from "@phosphor-icons/react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { useMemo, useState } from "react";
import type {
  CatalogReviewItem,
  Course,
  CourseRequirementMapping,
  EnrollmentPolicy,
  GradeLevel,
  GraduationRequirement,
  PlanCourse,
  PlanVersion,
  RequirementArea,
  School,
  SmccdHighSchoolEquivalency,
  StudentEnrollmentPreference,
  StudentSettings
} from "@/lib/models";
import { GRADE_LEVELS, REQUIREMENT_LABELS } from "@/lib/planning";
import {
  isDtechIntersessionCourse,
  resolveTranscriptCourse,
  transcriptPlanCourseDraft,
  type TranscriptCoursePayload
} from "@/lib/transcript";
import BrandMark from "@/components/BrandMark";
import CodexConnectionSetup, { type CodexSetupValue } from "@/components/CodexConnectionSetup";
import TranscriptAiRunDetails, { type TranscriptAiTransparency } from "@/components/TranscriptAiRunDetails";

type OnboardingStage = "student" | "plan" | "requirements" | "assistant" | "transcript";

const STAGES: Array<{ id: OnboardingStage; label: string }> = [
  { id: "student", label: "About you" },
  { id: "plan", label: "Plan window" },
  { id: "requirements", label: "Requirement tracker" },
  { id: "assistant", label: "Pilot Assistant" },
  { id: "transcript", label: "Transcript" }
];

const ALL_REQUIREMENT_AREAS = Object.keys(REQUIREMENT_LABELS) as RequirementArea[];

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

interface OnboardingFlowProps {
  supabase: SupabaseClient;
  session: Session;
  school: School;
  settings: StudentSettings;
  requirements: GraduationRequirement[];
  courses: Course[];
  mappings: CourseRequirementMapping[];
  equivalencies: SmccdHighSchoolEquivalency[];
  activeVersion: PlanVersion;
  existingPlanCourses: PlanCourse[];
  enrollmentPolicies: EnrollmentPolicy[];
  enrollmentPreference: StudentEnrollmentPreference;
  mode?: "initial" | "replay";
  onComplete: () => Promise<void>;
  onExit?: () => void;
  onSignOut: () => Promise<void>;
}

export default function OnboardingFlow({
  supabase,
  session,
  school,
  settings: initialSettings,
  requirements,
  courses,
  mappings,
  equivalencies,
  activeVersion,
  existingPlanCourses,
  enrollmentPolicies,
  enrollmentPreference,
  mode = "initial",
  onComplete,
  onExit,
  onSignOut
}: OnboardingFlowProps) {
  const isReplay = mode === "replay";
  const [stage, setStage] = useState<OnboardingStage>("student");
  const [settings, setSettings] = useState<StudentSettings>({
    ...initialSettings,
    tracker_mode: initialSettings.tracker_mode ?? "full",
    tracked_requirement_areas: initialSettings.tracked_requirement_areas?.length
      ? initialSettings.tracked_requirement_areas
      : ALL_REQUIREMENT_AREAS
  });
  const [planYears, setPlanYears] = useState(() => {
    const start = initialSettings.plan_start_grade ?? initialSettings.grade_level;
    const end = initialSettings.plan_end_grade;
    return start && end ? end - start + 1 : start ? 13 - start : 4;
  });
  const [transcriptTitle, setTranscriptTitle] = useState("My transcript");
  const [transcriptText, setTranscriptText] = useState("");
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
  const [enrollmentProgram, setEnrollmentProgram] = useState<StudentEnrollmentPreference["program_type"]>(enrollmentPreference.program_type);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stageIndex = STAGES.findIndex((candidate) => candidate.id === stage);
  const currentGrade = (settings.grade_level ?? 9) as GradeLevel;
  const maximumPlanYears = 13 - currentGrade;
  const availablePlanYears = Array.from({ length: maximumPlanYears }, (_, index) => index + 1);
  const planEndGrade = Math.min(12, currentGrade + planYears - 1) as GradeLevel;
  const selectedRequirementCount = settings.tracker_mode === "full"
    ? requirements.length
    : settings.tracked_requirement_areas.length;
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

  function validateStage() {
    setError(null);
    if (stage === "student") {
      if (!settings.preferred_name.trim() || !settings.age || !settings.grade_level || !settings.graduation_year) {
        setError("Add your name, age, current grade, and expected graduation year.");
        return false;
      }
    }
    if (stage === "requirements" && settings.tracker_mode === "selected" && settings.tracked_requirement_areas.length === 0) {
      setError("Choose at least one requirement area to track.");
      return false;
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

  async function nextStage() {
    if (!validateStage()) return;
    if (stage === "assistant") {
      setBusyLabel(aiSetup.enabled ? "Saving Pilot connection" : "Saving AI preference");
      try {
        await saveAiPreferences();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "The AI preference could not be saved.");
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
    const maxYears = 13 - grade;
    setPlanYears((current) => Math.min(current, maxYears));
    setSettings((current) => ({
      ...current,
      grade_level: grade,
      plan_start_grade: grade,
      plan_end_grade: Math.min(12, grade + Math.min(planYears, maxYears) - 1) as GradeLevel
    }));
  }

  function toggleRequirement(area: RequirementArea) {
    setSettings((current) => {
      const selected = new Set(current.tracked_requirement_areas);
      if (selected.has(area)) selected.delete(area);
      else selected.add(area);
      return { ...current, tracked_requirement_areas: [...selected] };
    });
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
    if (!transcriptFile && !transcriptText.trim()) {
      setError("Choose a transcript file or paste transcript text first.");
      return;
    }
    setBusyLabel("Reading transcript");
    try {
      let storagePath: string | null = null;
      let mimeType: string | null = null;
      let kind: "upload" | "screenshot" | "pasted_text" = "pasted_text";
      if (transcriptFile) {
        const safeName = transcriptFile.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        storagePath = `${session.user.id}/${crypto.randomUUID()}-${safeName}`;
        mimeType = transcriptFile.type || "application/octet-stream";
        kind = mimeType.startsWith("image/") ? "screenshot" : "upload";
        const { error: uploadError } = await supabase.storage
          .from("source-uploads")
          .upload(storagePath, transcriptFile, { contentType: mimeType, upsert: false });
        if (uploadError) throw uploadError;
      }
      const { data: source, error: sourceError } = await supabase
        .from("official_sources")
        .insert({
          school_id: school.id,
          user_id: session.user.id,
          title: transcriptTitle.trim() || transcriptFile?.name || "My transcript",
          kind,
          storage_path: storagePath,
          raw_text: transcriptText.trim() || null,
          mime_type: mimeType,
          source_year: new Date().getFullYear().toString(),
          is_official: false,
          parse_status: "pending",
          confidence: "uncertain",
          document_type: "transcript"
        })
        .select("id")
        .single();
      if (sourceError || !source) throw sourceError ?? new Error("The transcript source could not be saved.");

      const result = await authorizedPost("/api/ai/parse-transcript", { sourceId: source.id });
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
      setError(caught instanceof Error ? caught.message : "The transcript could not be parsed.");
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

      const existingReviewIds = new Set(existingPlanCourses.map((row) => row.source_review_item_id).filter(Boolean));
      const candidates = selectedTranscriptItems
        .filter((item) => !existingReviewIds.has(item.id))
        .map((item, index) => ({
          ...transcriptPlanCourseDraft(payloadFor(item), settings, courses, mappings, item.id, equivalencies),
          plan_version_id: activeVersion.id,
          user_id: session.user.id,
          sort_order: existingPlanCourses.length + index
        }));
      const drafts = [] as typeof candidates;
      for (const candidate of candidates) {
        const existing = candidate.course_id
          ? existingPlanCourses.find((row) => row.course_id === candidate.course_id)
          : null;
        if (existing) {
          const { plan_version_id: _version, user_id: _user, ...update } = candidate;
          const { error: reconcileError } = await supabase
            .from("plan_courses")
            .update(update)
            .eq("id", existing.id);
          if (reconcileError) throw reconcileError;
        } else {
          drafts.push(candidate);
        }
      }
      if (drafts.length > 0) {
        const { error: importError } = await supabase.from("plan_courses").insert(drafts);
        if (importError) throw importError;
      }

      const completedSettings: StudentSettings = {
        ...settings,
        school_id: school.id,
        school_confirmed: true,
        onboarding_complete: true,
        ai_enabled: aiSetup.enabled,
        ai_model: aiSetup.model,
        ai_reasoning_effort: "low",
        ai_connection_approved_at: aiSetup.enabled ? (settings.ai_connection_approved_at ?? new Date().toISOString()) : null,
        ai_setup_tested_at: aiSetup.testedAt,
        plan_start_grade: currentGrade,
        plan_end_grade: planEndGrade,
        tracked_requirement_areas: settings.tracker_mode === "full"
          ? ALL_REQUIREMENT_AREAS
          : settings.tracked_requirement_areas
      };
      const { error: settingsError } = await supabase
        .from("student_settings")
        .update(completedSettings)
        .eq("id", session.user.id);
      if (settingsError) throw settingsError;
      const { error: enrollmentError } = await supabase.from("student_enrollment_preferences").upsert({
        user_id: session.user.id,
        provider_code: "SMCCD",
        program_type: enrollmentProgram,
        limit_mode: "recommended",
        custom_unit_limit: null
      }, { onConflict: "user_id,provider_code" });
      if (enrollmentError) throw enrollmentError;
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
      setError(caught instanceof Error ? caught.message : "Onboarding could not be completed.");
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
          <div className="onboarding-route-summary">
            <strong>Grade {currentGrade} to {planEndGrade}</strong>
            <span>{planYears} school {planYears === 1 ? "year" : "years"}</span>
            <span>{selectedRequirementCount} requirement areas</span>
            <span>{aiSetup.enabled ? (aiSetup.testedAt ? "Pilot connected" : "Pilot setup pending") : "Pilot off"}</span>
            <span>{isReplay ? `${completedCourseCount} saved courses kept` : `${selectedTranscriptIds.size} completed courses ready`}</span>
          </div>
        </aside>

        <section className="onboarding-stage" aria-live="polite">
          {stage === "student" && <>
            <header><UserCircle size={25} weight="duotone" /><h1>Tell us where you are now</h1><p>This anchors school years and the planning window.</p></header>
            <div className="form-grid two">
              <label className="form-field"><span>Preferred name</span><input autoFocus value={settings.preferred_name} onChange={(event) => setSettings({ ...settings, preferred_name: event.target.value })} /></label>
              <label className="form-field"><span>School</span><input value={school.name} readOnly aria-readonly="true" /></label>
              <label className="form-field"><span>Age</span><input type="number" min={12} max={22} value={settings.age ?? ""} onChange={(event) => setSettings({ ...settings, age: asNumber(event.target.value) })} /></label>
              <label className="form-field"><span>Current grade</span><select value={settings.grade_level ?? ""} onChange={(event) => changeGrade(Number(event.target.value) as GradeLevel)}><option value="">Select grade</option>{GRADE_LEVELS.map((grade) => <option value={grade} key={grade}>Grade {grade}</option>)}</select></label>
              <label className="form-field"><span>Expected graduation year</span><input type="number" min={2026} max={2040} value={settings.graduation_year ?? ""} onChange={(event) => setSettings({ ...settings, graduation_year: asNumber(event.target.value) })} /></label>
            </div>
          </>}

          {stage === "plan" && <>
            <header><Path size={25} weight="duotone" /><h1>How far ahead should we plan?</h1><p>You can expand or shorten this window later without deleting saved courses.</p></header>
            <fieldset className="onboarding-choice-list">
              <legend>Plan length</legend>
              {availablePlanYears.map((years) => {
                const endGrade = Math.min(12, currentGrade + years - 1);
                return <label key={years} className={planYears === years ? "selected" : ""}><input type="radio" name="plan-years" value={years} checked={planYears === years} onChange={() => setPlanYears(years)} /><span><strong>{years === maximumPlanYears ? "Through graduation" : years === 1 ? "This school year" : `${years} school years`}</strong><small>Grade {currentGrade} through grade {endGrade}</small></span></label>;
              })}
            </fieldset>
            <div className="onboarding-plan-line" aria-label="Selected plan grades">
              {GRADE_LEVELS.map((grade) => <span key={grade} className={grade >= currentGrade && grade <= planEndGrade ? "included" : ""}>Grade {grade}</span>)}
            </div>
            <fieldset className="onboarding-choice-list enrollment-choice-list">
              <legend>College enrollment type</legend>
              {(["concurrent", "dual"] as const).map((programType) => {
                const policy = enrollmentPolicies.find((candidate) => candidate.provider_code === "SMCCD" && candidate.program_type === programType);
                return <label key={programType} className={enrollmentProgram === programType ? "selected" : ""}><input type="radio" name="onboarding-enrollment-type" checked={enrollmentProgram === programType} onChange={() => setEnrollmentProgram(programType)} /><span><strong>{programType === "concurrent" ? "Concurrent enrollment" : "Dual enrollment partnership"}</strong><small>{policy ? `${policy.recommended_max_units} units per term under the current district planning threshold.` : "District policy is not loaded."}</small></span></label>;
              })}
            </fieldset>
          </>}

          {stage === "requirements" && <>
            <header><GraduationCap size={25} weight="duotone" /><h1>Choose your graduation tracker</h1><p>The full diploma view is recommended. A focused view keeps only selected areas in daily progress totals.</p></header>
            <div className="tracker-mode-switch">
              <label className={settings.tracker_mode === "full" ? "selected" : ""}><input type="radio" name="tracker-mode" checked={settings.tracker_mode === "full"} onChange={() => setSettings({ ...settings, tracker_mode: "full", tracked_requirement_areas: ALL_REQUIREMENT_AREAS })} /><span><strong>Full high school diploma</strong><small>Track all {requirements.length} official requirement areas.</small></span></label>
              <label className={settings.tracker_mode === "selected" ? "selected" : ""}><input type="radio" name="tracker-mode" checked={settings.tracker_mode === "selected"} onChange={() => setSettings({ ...settings, tracker_mode: "selected", tracked_requirement_areas: [] })} /><span><strong>Focused tracker</strong><small>Choose the areas you want on your overview.</small></span></label>
            </div>
            {settings.tracker_mode === "selected" && <fieldset className="requirement-picker"><legend>Visible requirement areas</legend>{requirements.map((requirement) => <label key={requirement.id} className={settings.tracked_requirement_areas.includes(requirement.area) ? "selected" : ""}><input type="checkbox" checked={settings.tracked_requirement_areas.includes(requirement.area)} onChange={() => toggleRequirement(requirement.area)} /><span><strong>{requirement.name}</strong><small>{requirement.credits_required} credits required</small></span></label>)}</fieldset>}
          </>}

          {stage === "assistant" && <>
            <header><Cpu size={25} weight="duotone" /><h1>Connect Pilot Assistant</h1><p>Choose the model, approve the data boundary, and verify the real server connection. This choice saves when you continue.</p></header>
            <CodexConnectionSetup value={aiSetup} onChange={setAiSetup} />
          </>}

          {stage === "transcript" && <>
            <header><FileText size={25} weight="duotone" /><h1>{isReplay ? "Keep your completed classes" : "Add completed classes"}</h1><p>{isReplay ? "Replaying onboarding updates setup choices without changing saved courses." : "Upload a transcript or paste its text. Nothing counts until you review and import it."}</p></header>
            {isReplay ? <div className="onboarding-replay-summary">
              <CheckCircle size={20} weight="duotone" />
              <div><strong>{completedCourseCount} completed {completedCourseCount === 1 ? "course" : "courses"} will stay in your plan</strong><p>Finish to save the plan window and tracker choices from this walkthrough. Exit onboarding to discard them all.</p></div>
            </div> : transcriptItems.length === 0 ? <div className="transcript-entry">
              <label className="form-field"><span>Transcript label</span><input value={transcriptTitle} onChange={(event) => setTranscriptTitle(event.target.value)} /></label>
              <label className="transcript-drop"><UploadSimple size={25} weight="duotone" /><span><strong>{transcriptFile?.name ?? "Choose a transcript"}</strong><small>PDF, DOCX, text, CSV, PNG, JPEG, or WebP. Maximum 15 MB.</small></span><input type="file" accept=".pdf,.docx,.txt,.csv,.png,.jpg,.jpeg,.webp" onChange={(event) => setTranscriptFile(event.target.files?.[0] ?? null)} /></label>
              <div className="or-divider"><span>or paste text</span></div>
              <label className="form-field"><span>Transcript text</span><textarea value={transcriptText} onChange={(event) => setTranscriptText(event.target.value)} placeholder="Paste completed course rows, grades, credits, and school years." /></label>
              <button className="secondary-button" type="button" onClick={() => void parseTranscript()} disabled={Boolean(busyLabel)}><FileText size={17} /> {busyLabel === "Reading transcript" ? "Reading transcript" : "Read transcript"}</button>
            </div> : <div className="transcript-review">
              {transcriptSummary && <p className="transcript-summary">{transcriptSummary}</p>}
              {transcriptAiTransparency && <TranscriptAiRunDetails run={transcriptAiTransparency} summary="Inspect Codex vision run" />}
              <div className="transcript-review-heading"><strong>{academicTranscriptItems.length} GPA courses found</strong><span>Select the rows to import.</span></div>
              <div className="transcript-course-list">{academicTranscriptItems.map((item) => {
                const payload = payloadFor(item);
                const selected = selectedTranscriptIds.has(item.id);
                const resolution = resolveTranscriptCourse(payload, courses);
                const identityLabel = resolution.classification === "dtech_catalog"
                  ? "Catalog match"
                  : resolution.classification === "smccd_catalog"
                    ? "College match"
                    : resolution.classification === "smccd_unmatched"
                      ? "College review"
                      : "Custom course";
                return <label key={item.id} className={selected ? "selected" : ""}><input type="checkbox" checked={selected} onChange={() => setSelectedTranscriptIds((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} /><span><strong>{courseTitle(item)}</strong><small>{payload.letter_grade ? `Grade ${payload.letter_grade}` : "Grade needs review"}{payload.grade_level ? `, taken in grade ${payload.grade_level}` : ""}{payload.credits !== null && payload.credits !== undefined ? `, ${payload.credits} credits` : ""}</small></span><em>{identityLabel}, {resolution.identityResolved ? "resolved" : item.confidence}</em></label>;
              })}</div>
              {intersessionTranscriptItems.length > 0 && <details className="transcript-pass-review" open><summary><span><strong>Intersession pass/fail courses</strong><small>{intersessionTranscriptItems.length} classes, excluded from GPA. Passed classes count toward Personal Development.</small></span></summary><div className="transcript-course-list">{intersessionTranscriptItems.map((item) => { const payload = payloadFor(item); const selected = selectedTranscriptIds.has(item.id); const passed = payload.letter_grade?.toUpperCase() === "P"; return <label key={item.id} className={selected ? "selected" : ""}><input type="checkbox" checked={selected} onChange={() => setSelectedTranscriptIds((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} /><span><strong>{courseTitle(item)}</strong><small>{passed ? `Pass, grade ${payload.grade_level}, ${payload.credits ?? 0} Personal Development credits` : `F, grade ${payload.grade_level}, no Personal Development credit`}</small></span><em>Pass/fail · Not in GPA</em></label>; })}</div></details>}
              <button className="quiet-button" type="button" onClick={() => { setTranscriptItems([]); setSelectedTranscriptIds(new Set()); setTranscriptSummary(null); setTranscriptAiTransparency(null); }}>Use a different transcript</button>
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
