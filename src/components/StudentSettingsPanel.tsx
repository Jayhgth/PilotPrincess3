import { CheckIcon as Check } from "@phosphor-icons/react";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState, type SyntheticEvent } from "react";
import AccountLifecycleControls from "@/components/AccountLifecycleControls";
import PilotSettingsSection from "@/components/PilotSettingsSection";
import type { GradeLevel, School, StudentSettings } from "@/lib/models";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import styles from "./StudentSettingsPanel.module.css";

const GRADE_LEVELS: GradeLevel[] = [9, 10, 11, 12];

export type StudentSettingsPatch = Partial<Pick<
  StudentSettings,
  | "preferred_name"
  | "age"
  | "grade_level"
  | "graduation_year"
  | "plan_start_grade"
  | "plan_end_grade"
>>;

type StudentSettingsSection = "general" | "planning" | "pilot";

interface StudentSettingsPanelProps {
  section: StudentSettingsSection;
  session: Session;
  settings: StudentSettings;
  school: School;
  busy?: boolean;
  onSave: (patch: StudentSettingsPatch) => void | Promise<void>;
  onAiPreferencesChanged: () => void | Promise<void>;
  onAccountDeleted: () => void | Promise<void>;
}

interface SettingsDraft {
  preferredName: string;
  age: number | null;
  gradeLevel: GradeLevel | null;
  graduationYear: number | null;
  planStartGrade: GradeLevel | null;
  planEndGrade: GradeLevel | null;
}

function settingsDraft(settings: StudentSettings): SettingsDraft {
  return {
    preferredName: settings.preferred_name,
    age: settings.age,
    gradeLevel: settings.grade_level as GradeLevel | null,
    graduationYear: settings.graduation_year,
    planStartGrade: settings.plan_start_grade,
    planEndGrade: settings.plan_end_grade
  };
}

export default function StudentSettingsPanel({
  section,
  session,
  settings,
  school,
  busy = false,
  onSave,
  onAiPreferencesChanged,
  onAccountDeleted
}: StudentSettingsPanelProps) {
  const [draft, setDraft] = useState<SettingsDraft>(() => settingsDraft(settings));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [correction, setCorrection] = useState({ field: "website_url", value: "", evidenceUrl: "", summary: "" });
  const [correctionStatus, setCorrectionStatus] = useState<"idle" | "saving" | "saved">("idle");

  const dirty = section === "general"
    ? draft.preferredName !== settings.preferred_name
      || draft.age !== settings.age
      || draft.gradeLevel !== settings.grade_level
      || draft.graduationYear !== settings.graduation_year
    : draft.planStartGrade !== settings.plan_start_grade
      || draft.planEndGrade !== settings.plan_end_grade;

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDraft(settingsDraft(settings));
      setSaved(false);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [settings]);

  async function save(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    const preferredName = draft.preferredName.trim();
    if (section === "general" && !preferredName) {
      setError("Enter a preferred name.");
      return;
    }
    if (section === "planning" && draft.planStartGrade && draft.planEndGrade && draft.planStartGrade > draft.planEndGrade) {
      setError("The planning window must end at or after its starting grade.");
      return;
    }

    const patch: StudentSettingsPatch = {};
    if (section === "general") {
      if (preferredName !== settings.preferred_name) patch.preferred_name = preferredName;
      if (draft.age !== settings.age) patch.age = draft.age;
      if (draft.gradeLevel !== settings.grade_level) patch.grade_level = draft.gradeLevel;
      if (draft.graduationYear !== settings.graduation_year) patch.graduation_year = draft.graduationYear;
    } else {
      if (draft.planStartGrade !== settings.plan_start_grade) patch.plan_start_grade = draft.planStartGrade;
      if (draft.planEndGrade !== settings.plan_end_grade) patch.plan_end_grade = draft.planEndGrade;
    }

    setSaving(true);
    try {
      await onSave(patch);
      if (section === "general") setDraft((current) => ({ ...current, preferredName }));
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function submitSchoolCorrection(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    setError(null);
    if (!correction.value.trim() || correction.summary.trim().length < 10) {
      setError("Add the corrected value and a short explanation of the official evidence.");
      return;
    }
    setCorrectionStatus("saving");
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setError("Shared corrections are unavailable in this environment.");
      setCorrectionStatus("idle");
      return;
    }
    const { error: correctionError } = await supabase.from("shared_data_proposals").insert({
      submitted_by: session.user.id,
      submitted_via: "student",
      entity_type: "school",
      action: "correct",
      school_id: school.id,
      target_table: "schools",
      target_id: school.id,
      proposed_payload: { [correction.field]: correction.value.trim() },
      evidence_url: correction.evidenceUrl.trim() || null,
      evidence_summary: correction.summary.trim(),
      status: "pending"
    });
    if (correctionError) {
      setError(correctionError.message);
      setCorrectionStatus("idle");
      return;
    }
    setCorrection({ field: "website_url", value: "", evidenceUrl: "", summary: "" });
    setCorrectionStatus("saved");
  }

  const controlsDisabled = busy || saving;
  const currentYear = new Date().getFullYear();

  if (section === "pilot") {
    const pilotSettingsKey = [
      settings.ai_enabled,
      settings.ai_model,
      settings.ai_reasoning_effort,
      settings.ai_connection_approved_at,
      settings.ai_setup_tested_at,
      settings.ai_review_mode
    ].join(":");
    return <div className={styles.settingsPanel}><PilotSettingsSection key={pilotSettingsKey} settings={settings} onChanged={onAiPreferencesChanged} /></div>;
  }

  if (section === "planning") {
    return <div className={`${styles.settingsPanel} ${styles.compactPanel}`}>
      <section className={`content-section ${styles.section} ${styles.planningSection}`} aria-labelledby="plan-settings-heading">
        <header className={styles.sectionHeading}>
          <div><h2 id="plan-settings-heading">Plan range</h2><p>First and last high-school years shown in the plan.</p></div>
        </header>
        <form className={styles.planningForm} onSubmit={save}>
          <div className={`form-grid two ${styles.settingsGrid}`}>
            <label className="form-field"><span>Starts</span><select value={draft.planStartGrade ?? ""} onChange={(event) => setDraft({ ...draft, planStartGrade: event.target.value ? Number(event.target.value) as GradeLevel : null })}><option value="">Not set</option>{GRADE_LEVELS.map((grade) => <option key={grade} value={grade}>Grade {grade}</option>)}</select></label>
            <label className="form-field"><span>Ends</span><select value={draft.planEndGrade ?? ""} onChange={(event) => setDraft({ ...draft, planEndGrade: event.target.value ? Number(event.target.value) as GradeLevel : null })}><option value="">Not set</option>{GRADE_LEVELS.map((grade) => <option key={grade} value={grade}>Grade {grade}</option>)}</select></label>
          </div>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <div className={styles.saveRow}>{saved && <span className={styles.savedStatus} role="status"><Check size={15} weight="bold" /> Plan range saved</span>}<button className="primary-button" type="submit" disabled={controlsDisabled || !dirty}>{saving ? "Saving" : "Save"}</button></div>
        </form>
      </section>
    </div>;
  }

  return <div className={styles.settingsPanel}>
    <section className={`content-section ${styles.section}`} aria-labelledby="account-settings-heading">
      <header className={styles.sectionHeading}><div><h2 id="account-settings-heading">Account</h2></div></header>
      <div className={styles.accountIdentity}><span><strong>Signed in</strong><small>{session.user.email ?? "Student account"}</small></span></div>
      <AccountLifecycleControls onDeleted={onAccountDeleted} />
    </section>

    <section className={`content-section ${styles.section}`} aria-labelledby="student-settings-heading">
      <header className={styles.sectionHeading}>
        <div><h2 id="student-settings-heading">Student profile</h2><p>Grade, school years, and expected graduation.</p></div>
      </header>
      <form onSubmit={save}>
        <div className={`form-grid two ${styles.settingsGrid}`}>
          <label className="form-field"><span>Preferred name</span><input value={draft.preferredName} onChange={(event) => setDraft({ ...draft, preferredName: event.target.value })} required /></label>
          <label className="form-field"><span>Age</span><input type="number" min={12} max={22} value={draft.age ?? ""} onChange={(event) => setDraft({ ...draft, age: event.target.value ? Number(event.target.value) : null })} /></label>
          <label className="form-field"><span>Current grade</span><select value={draft.gradeLevel ?? ""} onChange={(event) => setDraft({ ...draft, gradeLevel: event.target.value ? Number(event.target.value) as GradeLevel : null })}><option value="">Not set</option>{GRADE_LEVELS.map((grade) => <option key={grade} value={grade}>Grade {grade}</option>)}</select></label>
          <label className="form-field"><span>Expected graduation year</span><input type="number" min={currentYear} max={currentYear + 12} value={draft.graduationYear ?? ""} onChange={(event) => setDraft({ ...draft, graduationYear: event.target.value ? Number(event.target.value) : null })} /></label>
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.saveRow}>{saved && <span className={styles.savedStatus} role="status"><Check size={15} weight="bold" /> Profile saved</span>}<button className="primary-button" type="submit" disabled={controlsDisabled || !dirty}>{saving ? "Saving" : "Save profile"}</button></div>
      </form>
    </section>

    <section className={`content-section ${styles.section}`} aria-labelledby="school-correction-heading">
      <header className={styles.sectionHeading}>
        <div><h2 id="school-correction-heading">Report school information</h2><p>Suggest an evidence-backed correction for {school.name}. An administrator reviews it before shared data changes.</p></div>
      </header>
      <form onSubmit={submitSchoolCorrection}>
        <div className={`form-grid two ${styles.settingsGrid}`}>
          <label className="form-field"><span>Field</span><select value={correction.field} onChange={(event) => setCorrection({ ...correction, field: event.target.value })}><option value="website_url">Website</option><option value="name">School name</option><option value="district_name">District</option><option value="city">City</option><option value="postal_code">ZIP code</option></select></label>
          <label className="form-field"><span>Correct value</span><input value={correction.value} onChange={(event) => setCorrection({ ...correction, value: event.target.value })} /></label>
          <label className="form-field"><span>Official evidence URL</span><input type="url" value={correction.evidenceUrl} onChange={(event) => setCorrection({ ...correction, evidenceUrl: event.target.value })} placeholder="https://" /></label>
          <label className="form-field"><span>What the source confirms</span><input value={correction.summary} onChange={(event) => setCorrection({ ...correction, summary: event.target.value })} /></label>
        </div>
        <div className={styles.saveRow}>{correctionStatus === "saved" && <span className={styles.savedStatus} role="status"><Check size={15} weight="bold" /> Submitted for review</span>}<button className="secondary-button" type="submit" disabled={correctionStatus === "saving"}>{correctionStatus === "saving" ? "Submitting" : "Submit correction"}</button></div>
      </form>
    </section>
  </div>;
}
