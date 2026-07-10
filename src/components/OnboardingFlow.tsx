import {
  ArrowLeftIcon as ArrowLeft,
  ArrowRightIcon as ArrowRight,
  CheckIcon as Check,
  CheckCircleIcon as CheckCircle,
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
  GradeLevel,
  GraduationRequirement,
  PlanCourse,
  PlanVersion,
  RequirementArea,
  School,
  StudentProfile
} from "@/lib/models";
import { GRADE_LEVELS, REQUIREMENT_LABELS } from "@/lib/planning";
import { ACADEMIC_INTEREST_OPTIONS, MAJOR_DIRECTION_OPTIONS } from "@/lib/profile-planning";
import { transcriptPlanCourseDraft, type TranscriptCoursePayload } from "@/lib/transcript";

type OnboardingStage = "student" | "priorities" | "plan" | "requirements" | "transcript";

const STAGES: Array<{ id: OnboardingStage; label: string }> = [
  { id: "student", label: "About you" },
  { id: "priorities", label: "Priorities" },
  { id: "plan", label: "Plan window" },
  { id: "requirements", label: "Requirement tracker" },
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
  profile: StudentProfile;
  requirements: GraduationRequirement[];
  courses: Course[];
  mappings: CourseRequirementMapping[];
  activeVersion: PlanVersion;
  existingPlanCourses: PlanCourse[];
  mode?: "initial" | "replay";
  onComplete: () => Promise<void>;
  onExit?: () => void;
  onSignOut: () => Promise<void>;
}

export default function OnboardingFlow({
  supabase,
  session,
  school,
  profile: initialProfile,
  requirements,
  courses,
  mappings,
  activeVersion,
  existingPlanCourses,
  mode = "initial",
  onComplete,
  onExit,
  onSignOut
}: OnboardingFlowProps) {
  const isReplay = mode === "replay";
  const [stage, setStage] = useState<OnboardingStage>("student");
  const [profile, setProfile] = useState<StudentProfile>({
    ...initialProfile,
    tracker_mode: initialProfile.tracker_mode ?? "full",
    tracked_requirement_areas: initialProfile.tracked_requirement_areas?.length
      ? initialProfile.tracked_requirement_areas
      : ALL_REQUIREMENT_AREAS
  });
  const [planYears, setPlanYears] = useState(() => {
    const start = initialProfile.plan_start_grade ?? initialProfile.grade_level;
    const end = initialProfile.plan_end_grade;
    return start && end ? end - start + 1 : start ? 13 - start : 4;
  });
  const [transcriptTitle, setTranscriptTitle] = useState("My transcript");
  const [transcriptText, setTranscriptText] = useState("");
  const [transcriptFile, setTranscriptFile] = useState<File | null>(null);
  const [transcriptItems, setTranscriptItems] = useState<CatalogReviewItem[]>([]);
  const [selectedTranscriptIds, setSelectedTranscriptIds] = useState<Set<string>>(new Set());
  const [transcriptSummary, setTranscriptSummary] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stageIndex = STAGES.findIndex((candidate) => candidate.id === stage);
  const currentGrade = (profile.grade_level ?? 9) as GradeLevel;
  const maximumPlanYears = 13 - currentGrade;
  const availablePlanYears = Array.from({ length: maximumPlanYears }, (_, index) => index + 1);
  const planEndGrade = Math.min(12, currentGrade + planYears - 1) as GradeLevel;
  const selectedRequirementCount = profile.tracker_mode === "full"
    ? requirements.length
    : profile.tracked_requirement_areas.length;
  const completedCourseCount = existingPlanCourses.filter((course) => course.status === "completed").length;

  const selectedTranscriptItems = useMemo(
    () => transcriptItems.filter((item) => selectedTranscriptIds.has(item.id)),
    [selectedTranscriptIds, transcriptItems]
  );
  const intersessionTranscriptItems = transcriptItems.filter((item) => {
    const payload = payloadFor(item);
    return payload.letter_grade?.toUpperCase() === "P" && payload.subject === "Personal Development";
  });
  const academicTranscriptItems = transcriptItems.filter((item) => !intersessionTranscriptItems.includes(item));

  function validateStage() {
    setError(null);
    if (stage === "student") {
      if (!profile.preferred_name.trim() || !profile.age || !profile.grade_level || !profile.graduation_year) {
        setError("Add your name, age, current grade, and expected graduation year.");
        return false;
      }
    }
    if (stage === "priorities" && !profile.weekly_commitment_limit) {
      setError("Add the weekly hours you can realistically use for activities and college coursework.");
      return false;
    }
    if (stage === "requirements" && profile.tracker_mode === "selected" && profile.tracked_requirement_areas.length === 0) {
      setError("Choose at least one requirement area to track.");
      return false;
    }
    return true;
  }

  function nextStage() {
    if (!validateStage()) return;
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
    setProfile((current) => ({
      ...current,
      grade_level: grade,
      plan_start_grade: grade,
      plan_end_grade: Math.min(12, grade + Math.min(planYears, maxYears) - 1) as GradeLevel
    }));
  }

  function toggleRequirement(area: RequirementArea) {
    setProfile((current) => {
      const selected = new Set(current.tracked_requirement_areas);
      if (selected.has(area)) selected.delete(area);
      else selected.add(area);
      return { ...current, tracked_requirement_areas: [...selected] };
    });
  }

  function toggleAcademicInterest(interest: string) {
    setProfile((current) => {
      const selected = new Set(current.academic_interests);
      if (selected.has(interest)) selected.delete(interest);
      else selected.add(interest);
      return { ...current, academic_interests: [...selected] };
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
          ...transcriptPlanCourseDraft(payloadFor(item), profile, courses, mappings, item.id),
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

      const completedProfile: StudentProfile = {
        ...profile,
        school_id: school.id,
        school_confirmed: true,
        onboarding_complete: true,
        plan_start_grade: currentGrade,
        plan_end_grade: planEndGrade,
        tracked_requirement_areas: profile.tracker_mode === "full"
          ? ALL_REQUIREMENT_AREAS
          : profile.tracked_requirement_areas
      };
      const { error: profileError } = await supabase
        .from("student_profiles")
        .update(completedProfile)
        .eq("id", session.user.id);
      if (profileError) throw profileError;
      const { error: versionError } = await supabase
        .from("plan_versions")
        .update({
          generation_config: {
            ...activeVersion.generation_config,
            plan_start_grade: currentGrade,
            plan_end_grade: planEndGrade,
            tracker_mode: completedProfile.tracker_mode,
            tracked_requirement_areas: completedProfile.tracked_requirement_areas,
            ...(isReplay ? {} : { transcript_courses_imported: candidates.length })
          }
        })
        .eq("id", activeVersion.id);
      if (versionError) throw versionError;
      await supabase.rpc("log_app_event", {
        event_name: isReplay ? "onboarding_replayed" : "onboarding_completed",
        properties: {
          plan_years: planYears,
          tracker_mode: completedProfile.tracker_mode,
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
    <main className="onboarding-shell">
      <header className="onboarding-topbar">
        <a className="wordmark" href="/app"><span className="wordmark-mark">PP</span><span>Pilot Princess</span></a>
        <div className="onboarding-topbar-actions">
          {isReplay && <span>Changes save only when you finish.</span>}
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
            <span>{isReplay ? `${completedCourseCount} saved courses kept` : `${selectedTranscriptIds.size} completed courses ready`}</span>
          </div>
        </aside>

        <section className="onboarding-stage" aria-live="polite">
          {stage === "student" && <>
            <header><UserCircle size={25} weight="duotone" /><h1>Tell us where you are now</h1><p>This anchors school years, workload, and every plan suggestion.</p></header>
            <div className="form-grid two">
              <label className="form-field"><span>Preferred name</span><input autoFocus value={profile.preferred_name} onChange={(event) => setProfile({ ...profile, preferred_name: event.target.value })} /></label>
              <label className="form-field"><span>School</span><input value={school.name} disabled /></label>
              <label className="form-field"><span>Age</span><input type="number" min={12} max={22} value={profile.age ?? ""} onChange={(event) => setProfile({ ...profile, age: asNumber(event.target.value) })} /></label>
              <label className="form-field"><span>Current grade</span><select value={profile.grade_level ?? ""} onChange={(event) => changeGrade(Number(event.target.value) as GradeLevel)}><option value="">Select grade</option>{GRADE_LEVELS.map((grade) => <option value={grade} key={grade}>Grade {grade}</option>)}</select></label>
              <label className="form-field"><span>Expected graduation year</span><input type="number" min={2026} max={2040} value={profile.graduation_year ?? ""} onChange={(event) => setProfile({ ...profile, graduation_year: asNumber(event.target.value) })} /></label>
            </div>
          </>}

          {stage === "priorities" && <>
            <header><UserCircle size={25} weight="duotone" /><h1>What should the plan optimize for?</h1><p>These answers sort real courses and degrees, set workload limits, and establish the simulator baseline.</p></header>
            <fieldset className="profile-choice-grid"><legend>Current academic direction</legend>{MAJOR_DIRECTION_OPTIONS.map((option) => <label className={profile.major_direction === option.value ? "selected" : ""} key={option.value}><input type="radio" name="onboarding-major" checked={profile.major_direction === option.value} onChange={() => setProfile({ ...profile, major_direction: option.value })} /><span><strong>{option.label}</strong><small>{option.description}</small></span></label>)}</fieldset>
            <fieldset className="profile-interest-grid"><legend>Interests to match</legend>{ACADEMIC_INTEREST_OPTIONS.map((interest) => <label className={profile.academic_interests.includes(interest) ? "selected" : ""} key={interest}><input type="checkbox" checked={profile.academic_interests.includes(interest)} onChange={() => toggleAcademicInterest(interest)} /><span>{interest}</span></label>)}</fieldset>
            <label className="form-field"><span>Career ideas to explore</span><input value={profile.career_direction} onChange={(event) => setProfile({ ...profile, career_direction: event.target.value })} placeholder="Optional, for example software engineering" /><small>Used only as matching keywords.</small></label>
            <fieldset className="profile-choice-grid three"><legend>Planning priority</legend>{[
              { value: "lower_stress", label: "Protect capacity", body: "Prefer fewer demanding courses." },
              { value: "balanced", label: "Balanced", body: "Mix rigor, activities, and recovery." },
              { value: "competitive", label: "More rigorous", body: "Prefer honors when limits allow." }
            ].map((option) => <label className={profile.goal_intensity === option.value ? "selected" : ""} key={option.value}><input type="radio" name="onboarding-intensity" checked={profile.goal_intensity === option.value} onChange={() => setProfile({ ...profile, goal_intensity: option.value as StudentProfile["goal_intensity"] })} /><span><strong>{option.label}</strong><small>{option.body}</small></span></label>)}</fieldset>
            <div className="form-grid two">
              <label className="form-field"><span>Demanding-course limit</span><select value={profile.workload_tolerance} onChange={(event) => setProfile({ ...profile, workload_tolerance: event.target.value as StudentProfile["workload_tolerance"] })}><option value="light">Up to 2 weighted or college courses</option><option value="balanced">Up to 4 weighted or college courses</option><option value="high">Up to 6 weighted or college courses</option></select></label>
              <label className="form-field"><span>Weekly commitment limit</span><input type="number" min={1} max={80} step={0.5} value={profile.weekly_commitment_limit ?? ""} onChange={(event) => setProfile({ ...profile, weekly_commitment_limit: asNumber(event.target.value) })} placeholder="Hours per week" /><small>Activities plus SMCCD class and study time outside d.tech.</small></label>
              <label className="form-field"><span>Current stress baseline</span><select value={profile.stress_level} onChange={(event) => setProfile({ ...profile, stress_level: Number(event.target.value) })}><option value={1}>1 - Low</option><option value={2}>2 - Manageable</option><option value={3}>3 - Stretched</option><option value={4}>4 - High</option><option value={5}>5 - Overloaded</option></select></label>
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
          </>}

          {stage === "requirements" && <>
            <header><GraduationCap size={25} weight="duotone" /><h1>Choose your graduation tracker</h1><p>The full diploma view is recommended. A focused view keeps only selected areas in daily progress totals.</p></header>
            <div className="tracker-mode-switch">
              <label className={profile.tracker_mode === "full" ? "selected" : ""}><input type="radio" name="tracker-mode" checked={profile.tracker_mode === "full"} onChange={() => setProfile({ ...profile, tracker_mode: "full", tracked_requirement_areas: ALL_REQUIREMENT_AREAS })} /><span><strong>Full d.tech diploma</strong><small>Track all {requirements.length} official requirement areas.</small></span></label>
              <label className={profile.tracker_mode === "selected" ? "selected" : ""}><input type="radio" name="tracker-mode" checked={profile.tracker_mode === "selected"} onChange={() => setProfile({ ...profile, tracker_mode: "selected", tracked_requirement_areas: [] })} /><span><strong>Focused tracker</strong><small>Choose the areas you want on your overview.</small></span></label>
            </div>
            {profile.tracker_mode === "selected" && <fieldset className="requirement-picker"><legend>Visible requirement areas</legend>{requirements.map((requirement) => <label key={requirement.id} className={profile.tracked_requirement_areas.includes(requirement.area) ? "selected" : ""}><input type="checkbox" checked={profile.tracked_requirement_areas.includes(requirement.area)} onChange={() => toggleRequirement(requirement.area)} /><span><strong>{requirement.name}</strong><small>{requirement.credits_required} credits required</small></span></label>)}</fieldset>}
          </>}

          {stage === "transcript" && <>
            <header><FileText size={25} weight="duotone" /><h1>{isReplay ? "Keep your completed classes" : "Add completed classes"}</h1><p>{isReplay ? "Replaying onboarding updates your profile and planning preferences without changing saved courses." : "Upload a transcript or paste its text. Nothing counts until you review and import it."}</p></header>
            {isReplay ? <div className="onboarding-replay-summary">
              <CheckCircle size={20} weight="duotone" />
              <div><strong>{completedCourseCount} completed {completedCourseCount === 1 ? "course" : "courses"} will stay in your plan</strong><p>Finish to save the profile, plan window, and tracker choices from this walkthrough. Exit onboarding to discard them all.</p></div>
            </div> : transcriptItems.length === 0 ? <div className="transcript-entry">
              <label className="form-field"><span>Transcript label</span><input value={transcriptTitle} onChange={(event) => setTranscriptTitle(event.target.value)} /></label>
              <label className="transcript-drop"><UploadSimple size={25} weight="duotone" /><span><strong>{transcriptFile?.name ?? "Choose a transcript"}</strong><small>PDF, DOCX, text, CSV, PNG, JPEG, or WebP. Maximum 15 MB.</small></span><input type="file" accept=".pdf,.docx,.txt,.csv,.png,.jpg,.jpeg,.webp" onChange={(event) => setTranscriptFile(event.target.files?.[0] ?? null)} /></label>
              <div className="or-divider"><span>or paste text</span></div>
              <label className="form-field"><span>Transcript text</span><textarea value={transcriptText} onChange={(event) => setTranscriptText(event.target.value)} placeholder="Paste completed course rows, grades, credits, and school years." /></label>
              <button className="secondary-button" type="button" onClick={() => void parseTranscript()} disabled={Boolean(busyLabel)}><FileText size={17} /> {busyLabel === "Reading transcript" ? "Reading transcript" : "Read transcript"}</button>
            </div> : <div className="transcript-review">
              {transcriptSummary && <p className="transcript-summary">{transcriptSummary}</p>}
              <div className="transcript-review-heading"><strong>{academicTranscriptItems.length} GPA courses found</strong><span>Select the rows to import.</span></div>
              <div className="transcript-course-list">{academicTranscriptItems.map((item) => {
                const payload = payloadFor(item);
                const selected = selectedTranscriptIds.has(item.id);
                return <label key={item.id} className={selected ? "selected" : ""}><input type="checkbox" checked={selected} onChange={() => setSelectedTranscriptIds((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} /><span><strong>{courseTitle(item)}</strong><small>{payload.letter_grade ? `Grade ${payload.letter_grade}` : "Grade needs review"}{payload.grade_level ? `, taken in grade ${payload.grade_level}` : ""}{payload.credits !== null && payload.credits !== undefined ? `, ${payload.credits} credits` : ""}</small></span><em>{payload.matched_course_id ? "Catalog match" : "Custom course"}, {item.confidence}</em></label>;
              })}</div>
              {intersessionTranscriptItems.length > 0 && <details className="transcript-pass-review" open><summary><span><strong>Intersession pass credits</strong><small>{intersessionTranscriptItems.length} classes, excluded from GPA and counted toward Personal Development.</small></span></summary><div className="transcript-course-list">{intersessionTranscriptItems.map((item) => { const payload = payloadFor(item); const selected = selectedTranscriptIds.has(item.id); return <label key={item.id} className={selected ? "selected" : ""}><input type="checkbox" checked={selected} onChange={() => setSelectedTranscriptIds((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} /><span><strong>{courseTitle(item)}</strong><small>Pass, grade {payload.grade_level}, {payload.credits ?? 0} Personal Development credits</small></span><em>Not in GPA</em></label>; })}</div></details>}
              <button className="quiet-button" type="button" onClick={() => { setTranscriptItems([]); setSelectedTranscriptIds(new Set()); setTranscriptSummary(null); }}>Use a different transcript</button>
            </div>}
          </>}

          {error && <div className="inline-alert error" role="alert"><Warning size={17} /> {error}</div>}
          <footer className="onboarding-actions">
            {stageIndex > 0 ? <button className="secondary-button" type="button" onClick={previousStage} disabled={Boolean(busyLabel)}><ArrowLeft size={17} /> Back</button> : <span />}
            {stage !== "transcript"
              ? <button className="primary-button" type="button" onClick={nextStage}>Continue <ArrowRight size={17} /></button>
              : <button className="primary-button" type="button" onClick={() => void finishOnboarding()} disabled={Boolean(busyLabel)}>{busyLabel ? (isReplay ? "Saving changes" : "Creating workspace") : isReplay ? "Save changes" : transcriptItems.length ? "Import selected and finish" : "Finish setup"} <ArrowRight size={17} /></button>}
          </footer>
        </section>
      </div>
      {busyLabel && <div className="busy-bar onboarding-busy" role="status">{busyLabel}</div>}
    </main>
  );
}
