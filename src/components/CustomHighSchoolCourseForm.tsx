import { useState, type SyntheticEvent } from "react";
import { PlusIcon as Plus } from "@phosphor-icons/react/dist/csr/Plus";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { REQUIREMENT_LABELS, schoolYearForGrade } from "@/lib/planning";
import type { GradeLevel, GraduationRequirement, PlanCourse, PlanVersion, StudentSettings } from "@/lib/models";

interface Props {
  supabase: SupabaseClient;
  session: Session;
  activeVersion: PlanVersion;
  settings: StudentSettings;
  availableGrades: GradeLevel[];
  planCourses: PlanCourse[];
  onAdded: (row: PlanCourse) => void;
}

export default function CustomHighSchoolCourseForm({ supabase, session, activeVersion, settings, availableGrades, planCourses, onAdded }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    name: string;
    credits: number;
    gradeLevel: GradeLevel;
    term: PlanCourse["term"];
    isWeighted: boolean;
    requirementArea: GraduationRequirement["area"];
  }>({ name: "", credits: 5, gradeLevel: availableGrades[0] ?? 9, term: "fall", isWeighted: false, requirementArea: "other" });

  async function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const name = draft.name.trim();
    if (!name) return;
    if (draft.gradeLevel === 12 && draft.term === "summer") {
      setError("Senior year does not include a summer term. Choose fall or spring.");
      return;
    }
    const normalizedName = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (planCourses.some((row) => String(row.custom_course_name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === normalizedName)) {
      setError("That custom course is already represented in the plan.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data, error: insertError } = await supabase.from("plan_courses").insert({
        plan_version_id: activeVersion.id,
        user_id: session.user.id,
        custom_course_name: name,
        grade_level: draft.gradeLevel,
        school_year: schoolYearForGrade(settings.graduation_year ?? new Date().getFullYear() + 3, draft.gradeLevel),
        term: draft.term,
        status: "planned",
        credits: draft.credits,
        college_units: null,
        is_weighted: draft.isWeighted,
        mapping_verified: false,
        user_edited: true,
        requirement_area_override: draft.requirementArea,
        notes: "Student-provided custom high-school course; not verified against an institutional catalog.",
        sort_order: planCourses.filter((row) => row.grade_level === draft.gradeLevel).length
      }).select("*").single();
      if (insertError) throw insertError;
      onAdded(data as unknown as PlanCourse);
      setDraft((current) => ({ ...current, name: "" }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The custom course could not be added.");
    } finally {
      setBusy(false);
    }
  }

  return <details className="smccd-manual-entry">
    <summary>Course missing from the catalog?</summary>
    <form className="form-section compact-form" onSubmit={submit}>
      <h2>Add a custom high-school course</h2>
      <p className="muted-copy">Custom courses stay marked as student-provided until institutional evidence is reviewed.</p>
      {error && <div className="inline-alert error" role="alert">{error}</div>}
      <label className="form-field"><span>Course name</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} required /></label>
      <div className="form-grid four">
        <label className="form-field"><span>Credits</span><input type="number" min={0} max={100} step={0.5} value={draft.credits} onChange={(event) => setDraft({ ...draft, credits: Number(event.target.value) })} /></label>
        <label className="form-field"><span>School year</span><select value={draft.gradeLevel} onChange={(event) => { const gradeLevel = Number(event.target.value) as GradeLevel; setDraft({ ...draft, gradeLevel, term: gradeLevel === 12 && draft.term === "summer" ? "fall" : draft.term }); }}>{availableGrades.map((grade) => <option value={grade} key={grade}>Grade {grade}</option>)}</select></label>
        <label className="form-field"><span>Term</span><select value={draft.term} onChange={(event) => setDraft({ ...draft, term: event.target.value as PlanCourse["term"] })}><option value="fall">Fall</option><option value="spring">Spring</option><option value="full_year">Full year</option>{draft.gradeLevel < 12 && <option value="summer">Summer</option>}</select></label>
        <label className="form-field"><span>Requirement area</span><select value={draft.requirementArea} onChange={(event) => setDraft({ ...draft, requirementArea: event.target.value as GraduationRequirement["area"] })}>{Object.entries(REQUIREMENT_LABELS).map(([area, label]) => <option value={area} key={area}>{label}</option>)}</select></label>
      </div>
      <label className="settings-checkbox"><input type="checkbox" checked={draft.isWeighted} onChange={(event) => setDraft({ ...draft, isWeighted: event.target.checked })} /><span>Weighted or honors</span></label>
      <button className="secondary-button" type="submit" disabled={busy}><Plus size={17} /> {busy ? "Adding…" : "Add custom course"}</button>
    </form>
  </details>;
}
