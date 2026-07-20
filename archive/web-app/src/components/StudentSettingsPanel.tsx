import { CheckIcon as Check } from "@phosphor-icons/react";
import { MagnifyingGlassIcon as MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState, type SyntheticEvent } from "react";
import AccountLifecycleControls from "@/components/AccountLifecycleControls";
import InstitutionIdentityMark from "@/components/InstitutionIdentityMark";
import PilotSettingsSection from "@/components/PilotSettingsSection";
import type { CollegeDistrict, GradeLevel, NearbyCollegeDistrict, School, StudentCollegeDistrictPreference, StudentSettings } from "@/lib/models";
import type { SchoolSupportReadiness } from "@/lib/workspace-bootstrap";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import styles from "./StudentSettingsPanel.module.css";

const GRADE_LEVELS: GradeLevel[] = [9, 10, 11, 12];

export type StudentSettingsPatch = Partial<Pick<
  StudentSettings,
  | "preferred_name"
  | "age"
  | "grade_level"
  | "graduation_year"
>>;

type StudentSettingsSection = "general" | "pilot";

interface StudentSettingsPanelProps {
  section: StudentSettingsSection;
  session: Session;
  settings: StudentSettings;
  school: School;
  schoolSupport: SchoolSupportReadiness;
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
}

function settingsDraft(settings: StudentSettings): SettingsDraft {
  return {
    preferredName: settings.preferred_name,
    age: settings.age,
    gradeLevel: settings.grade_level as GradeLevel | null,
    graduationYear: settings.graduation_year
  };
}

export default function StudentSettingsPanel({
  section,
  session,
  settings,
  school,
  schoolSupport,
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
  const [collegeDistricts, setCollegeDistricts] = useState<CollegeDistrict[]>([]);
  const [nearbyDistricts, setNearbyDistricts] = useState<NearbyCollegeDistrict[]>([]);
  const [districtPreference, setDistrictPreference] = useState<StudentCollegeDistrictPreference | null>(null);
  const [selectedDistrictCode, setSelectedDistrictCode] = useState("");
  const [districtStatus, setDistrictStatus] = useState<"loading" | "idle" | "saving" | "saved">("loading");
  const [schoolQuery, setSchoolQuery] = useState("");
  const [schoolResults, setSchoolResults] = useState<Array<Pick<School, "id" | "name" | "district_name" | "city" | "governance_type" | "website_url"> & { support?: SchoolSupportReadiness }>>([]);
  const [schoolSearchBusy, setSchoolSearchBusy] = useState(false);
  const [pendingSchool, setPendingSchool] = useState<(typeof schoolResults)[number] | null>(null);
  const [switchingSchool, setSwitchingSchool] = useState(false);

  const dirty = draft.preferredName !== settings.preferred_name
    || draft.age !== settings.age
    || draft.gradeLevel !== settings.grade_level
    || draft.graduationYear !== settings.graduation_year;

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
      supabase.from("student_college_district_preferences").select("user_id,district_code,selection_method,school_id_at_selection,updated_at").eq("user_id", session.user.id).eq("school_id_at_selection", school.id).maybeSingle()
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

  useEffect(() => {
    if (section !== "general" || schoolQuery.trim().length < 2) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    let active = true;
    const timeout = window.setTimeout(() => {
      void (async () => {
        const { data, error: searchError } = await supabase.rpc("search_california_high_schools", { query_text: schoolQuery.trim(), result_limit: 8 });
        if (!active) return;
        if (searchError) throw searchError;
        const results = (Array.isArray(data) ? data : []) as Array<Pick<School, "id" | "name" | "district_name" | "city" | "governance_type" | "website_url">>;
        const ids = results.map((result) => result.id);
        const readiness = ids.length
          ? await supabase.from("school_support_readiness").select("school_id,catalog_supported,diploma_supported,planning_supported,last_source_update").in("school_id", ids)
          : { data: [], error: null };
        if (readiness.error) throw readiness.error;
        const supportBySchool = new Map((readiness.data ?? []).map((row) => [row.school_id, {
          level: row.catalog_supported && row.diploma_supported && row.planning_supported ? "complete" : row.catalog_supported || row.diploma_supported || row.planning_supported ? "partial" : "discovery",
          catalog_supported: Boolean(row.catalog_supported),
          diploma_supported: Boolean(row.diploma_supported),
          planning_supported: Boolean(row.planning_supported),
          last_source_update: row.last_source_update ? String(row.last_source_update) : null
        } satisfies SchoolSupportReadiness]));
        if (active) setSchoolResults(results.filter((result) => result.id !== school.id).map((result) => ({ ...result, support: supportBySchool.get(result.id) })));
      })().catch(() => {
        if (active) setError("High-school search is temporarily unavailable.");
      }).finally(() => {
        if (active) setSchoolSearchBusy(false);
      });
    }, 220);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [school.id, schoolQuery, section]);

  async function switchSchool() {
    if (!pendingSchool) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setSwitchingSchool(true);
    setError(null);
    const { error: switchError } = await supabase.rpc("select_current_school", { target_school_id: pendingSchool.id });
    if (switchError) {
      setError(switchError.message);
      setSwitchingSchool(false);
      return;
    }
    setSchoolQuery("");
    setSchoolResults([]);
    setPendingSchool(null);
    await onInstitutionChanged?.();
    setSwitchingSchool(false);
  }

  async function save(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    const preferredName = draft.preferredName.trim();
    if (section === "general" && !preferredName) {
      setError("Enter a preferred name.");
      return;
    }
    const patch: StudentSettingsPatch = {};
    if (preferredName !== settings.preferred_name) patch.preferred_name = preferredName;
    if (draft.age !== settings.age) patch.age = draft.age;
    if (draft.gradeLevel !== settings.grade_level) patch.grade_level = draft.gradeLevel;
    if (draft.graduationYear !== settings.graduation_year) patch.graduation_year = draft.graduationYear;

    setSaving(true);
    try {
      await onSave(patch);
      setDraft((current) => ({ ...current, preferredName }));
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Settings could not be saved.");
    } finally {
      setSaving(false);
    }
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
      settings.ai_setup_tested_at
    ].join(":");
    return <div className={styles.settingsPanel}><PilotSettingsSection key={pilotSettingsKey} settings={settings} onChanged={onAiPreferencesChanged} /></div>;
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
      <div className={styles.readiness} aria-label={`${school.name} support readiness`}>
        <div><strong>{schoolSupport.level === "complete" ? "Full support" : schoolSupport.level === "partial" ? "Partial support" : "Discovery support"}</strong>{schoolSupport.last_source_update && <small>Sources refreshed {new Date(schoolSupport.last_source_update).toLocaleDateString()}</small>}</div>
        <span className={schoolSupport.catalog_supported ? styles.ready : ""}><Check size={13} /> Catalog</span>
        <span className={schoolSupport.diploma_supported ? styles.ready : ""}><Check size={13} /> Diploma</span>
        <span className={schoolSupport.planning_supported ? styles.ready : ""}><Check size={13} /> Planning</span>
      </div>
      <div className={styles.schoolChange}>
        <label className="form-field"><span>Change high school</span><div className={styles.searchField}><MagnifyingGlass size={16} aria-hidden /><input value={schoolQuery} onChange={(event) => { const query = event.target.value; setSchoolQuery(query); setPendingSchool(null); setSchoolSearchBusy(query.trim().length >= 2); if (query.trim().length < 2) setSchoolResults([]); }} placeholder="Search California public or charter schools" /></div><small>Each school has a separate saved academic workspace.</small></label>
        {schoolSearchBusy && <small className={styles.searchStatus}>Searching…</small>}
        {schoolResults.length > 0 && <div className={styles.schoolResults} role="listbox" aria-label="High-school results">{schoolResults.map((result) => <button type="button" role="option" aria-selected={pendingSchool?.id === result.id} key={result.id} onClick={() => setPendingSchool(result)}><InstitutionIdentityMark name={result.name} websiteUrl={result.website_url} decorative /><span><strong>{result.name}</strong><small>{[result.district_name, result.city].filter(Boolean).join(" · ")}</small></span><em>{result.support?.level === "complete" ? "Full support" : result.support?.level === "partial" ? "Partial" : "Discovery"}</em></button>)}</div>}
        {pendingSchool && <div className={styles.schoolSwitchConfirm} role="alert"><p><strong>Switch to {pendingSchool.name}?</strong> The current academic workspace will be wiped from view, including courses, transcript review, GPA assumptions, and degree bookmarks. It remains saved under {school.name} and returns when you switch back.</p><div><button className="quiet-button small" type="button" onClick={() => setPendingSchool(null)}>Cancel</button><button className="primary-button small" type="button" onClick={() => void switchSchool()} disabled={switchingSchool}>{switchingSchool ? "Switching" : "Switch school"}</button></div></div>}
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

  </div>;
}
