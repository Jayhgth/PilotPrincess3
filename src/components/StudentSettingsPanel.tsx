import { CheckIcon as Check } from "@phosphor-icons/react";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState, type SyntheticEvent } from "react";
import AccountLifecycleControls from "@/components/AccountLifecycleControls";
import InstitutionIdentityMark from "@/components/InstitutionIdentityMark";
import PilotSettingsSection from "@/components/PilotSettingsSection";
import type { CollegeDistrict, GradeLevel, NearbyCollegeDistrict, School, StudentCollegeDistrictPreference, StudentSettings } from "@/lib/models";
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
  onInstitutionChanged?: () => void | Promise<void>;
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
  onInstitutionChanged,
  onAccountDeleted
}: StudentSettingsPanelProps) {
  const [draft, setDraft] = useState<SettingsDraft>(() => settingsDraft(settings));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [correction, setCorrection] = useState({ field: "website_url", value: "", evidenceUrl: "", summary: "" });
  const [correctionStatus, setCorrectionStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [collegeDistricts, setCollegeDistricts] = useState<CollegeDistrict[]>([]);
  const [nearbyDistricts, setNearbyDistricts] = useState<NearbyCollegeDistrict[]>([]);
  const [districtPreference, setDistrictPreference] = useState<StudentCollegeDistrictPreference | null>(null);
  const [selectedDistrictCode, setSelectedDistrictCode] = useState("");
  const [districtStatus, setDistrictStatus] = useState<"loading" | "idle" | "saving" | "saved">("loading");

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

  useEffect(() => {
    if (section !== "general") return;
    let active = true;
    const supabase = getBrowserSupabase();
    if (!supabase) {
      void Promise.resolve().then(() => { if (active) setDistrictStatus("idle"); });
      return;
    }
    void Promise.all([
      supabase.from("college_districts").select("district_code,name,website_url,policy_provider_code,status,source_url,source_updated_at").eq("status", "active").order("name"),
      supabase.rpc("nearby_college_districts", { target_school_id: school.id, result_limit: 8 }),
      supabase.from("student_college_district_preferences").select("user_id,district_code,selection_method,school_id_at_selection,updated_at").eq("user_id", session.user.id).maybeSingle()
    ]).then(([districtResult, nearbyResult, preferenceResult]) => {
      if (!active) return;
      if (districtResult.error || nearbyResult.error || preferenceResult.error) {
        setError("College-district options could not be loaded.");
        setDistrictStatus("idle");
        return;
      }
      const preference = preferenceResult.data as unknown as StudentCollegeDistrictPreference | null;
      const nearby = (nearbyResult.data ?? []) as unknown as NearbyCollegeDistrict[];
      setCollegeDistricts((districtResult.data ?? []) as unknown as CollegeDistrict[]);
      setNearbyDistricts(nearby);
      setDistrictPreference(preference);
      setSelectedDistrictCode(preference?.district_code ?? nearby.find((district) => district.is_recommended)?.district_code ?? nearby[0]?.district_code ?? "");
      setDistrictStatus("idle");
    });
    return () => { active = false; };
  }, [school.id, section, session.user.id]);

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

  async function saveCollegeDistrict(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    if (!selectedDistrictCode || selectedDistrictCode === districtPreference?.district_code) return;
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setError("College-district settings are unavailable in this environment.");
      return;
    }
    setError(null);
    setDistrictStatus("saving");
    const { data, error: districtError } = await supabase.rpc("set_college_district_preference", {
      target_district_code: selectedDistrictCode,
      preference_method: "student"
    });
    if (districtError) {
      setError(districtError.message);
      setDistrictStatus("idle");
      return;
    }
    setDistrictPreference(data as unknown as StudentCollegeDistrictPreference);
    setDistrictStatus("saved");
    await onInstitutionChanged?.();
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

    <section className={`content-section ${styles.section}`} aria-labelledby="institution-settings-heading">
      <header className={styles.sectionHeading}>
        <div><h2 id="institution-settings-heading">Schools</h2><p>Your high school controls its course catalog and diploma rules. The college district controls nearby college suggestions and district-specific planning rules.</p></div>
      </header>
      <div className={styles.institutionIdentity}>
        <InstitutionIdentityMark name={school.name} websiteUrl={school.website_url} size="header" decorative />
        <span><strong>{school.name}</strong><small>{[school.district_name, school.city, school.governance_type === "charter" ? "Charter" : "Public"].filter(Boolean).join(" · ")}</small></span>
      </div>
      <form className={styles.districtForm} onSubmit={saveCollegeDistrict}>
        <label className="form-field"><span>Community-college district</span><select value={selectedDistrictCode} onChange={(event) => { setSelectedDistrictCode(event.target.value); setDistrictStatus("idle"); }} disabled={districtStatus === "loading" || districtStatus === "saving"}>
          <option value="">Choose a district</option>
          {nearbyDistricts.length > 0 && <optgroup label="Near this high school">{nearbyDistricts.map((district) => <option value={district.district_code} key={district.district_code}>{district.is_recommended ? "Recommended — " : ""}{district.district_name}{district.nearest_distance_miles != null ? ` (${Number(district.nearest_distance_miles).toFixed(1)} mi)` : ""}</option>)}</optgroup>}
          <optgroup label="All California districts">{collegeDistricts.filter((district) => !nearbyDistricts.some((nearby) => nearby.district_code === district.district_code)).map((district) => <option value={district.district_code} key={district.district_code}>{district.name}</option>)}</optgroup>
        </select><small>Suggested from the school’s public address; no device location is used.</small></label>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.saveRow}>{districtStatus === "saved" && <span className={styles.savedStatus} role="status"><Check size={15} weight="bold" /> District saved</span>}<button className="secondary-button" type="submit" disabled={!selectedDistrictCode || selectedDistrictCode === districtPreference?.district_code || districtStatus === "loading" || districtStatus === "saving"}>{districtStatus === "saving" ? "Saving" : "Save district"}</button></div>
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
