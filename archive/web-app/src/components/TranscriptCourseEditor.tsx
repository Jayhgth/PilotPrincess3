import { XIcon as X } from "@phosphor-icons/react";
import type { TranscriptCoursePayload } from "@/lib/transcript";

interface TranscriptCourseEditorProps {
  value: TranscriptCoursePayload;
  schoolName: string;
  isDtechSchool: boolean;
  onChange: (next: TranscriptCoursePayload) => void;
  onIgnore: () => void;
  disabled: boolean;
}

function optionalText(value: string) {
  const trimmed = value.trim();
  return trimmed || null;
}

function optionalNumber(value: string) {
  if (value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export default function TranscriptCourseEditor({ value, schoolName, isDtechSchool, onChange, onIgnore, disabled }: TranscriptCourseEditorProps) {
  function update(next: Partial<TranscriptCoursePayload>) {
    // Keep parser metadata and future payload keys that this editor does not expose.
    onChange({ ...value, ...next });
  }

  return <fieldset className="transcript-course-editor" disabled={disabled}>
    <legend className="sr-only">Edit extracted course data</legend>
    <div className="form-grid two">
      <label className="form-field">
        <span>Course name</span>
        <input required value={value.course_name ?? ""} onChange={(event) => update({ course_name: event.target.value })} />
      </label>
      <label className="form-field">
        <span>Course code</span>
        <input value={value.course_code ?? ""} onChange={(event) => update({ course_code: optionalText(event.target.value) })} placeholder="Example: MATH 200" />
      </label>
      <label className="form-field full">
        <span>Institution</span>
        <input value={value.institution_name ?? ""} onChange={(event) => update({ institution_name: optionalText(event.target.value) })} placeholder="School or college name" />
      </label>
      <label className="form-field">
        <span>Letter grade</span>
        <input value={value.letter_grade ?? ""} onChange={(event) => update({ letter_grade: optionalText(event.target.value)?.toUpperCase() ?? null })} placeholder="A, B+, P, or IP" />
      </label>
      <label className="form-field">
        <span>Grading basis</span>
        <select value={value.grading_basis ?? ""} onChange={(event) => update({ grading_basis: event.target.value ? event.target.value as TranscriptCoursePayload["grading_basis"] : undefined })}>
          <option value="">Not specified</option>
          <option value="letter">Letter grade</option>
          <option value="pass_fail">Pass / fail</option>
        </select>
      </label>
      <label className="form-field">
        <span>High-school credits</span>
        <input type="number" min={0} step={0.5} value={value.credits ?? ""} onChange={(event) => update({ credits: optionalNumber(event.target.value) })} />
      </label>
      <label className="form-field">
        <span>College units</span>
        <input type="number" min={0} step={0.5} value={value.college_units ?? ""} onChange={(event) => update({ college_units: optionalNumber(event.target.value) })} />
      </label>
      <label className="form-field">
        <span>Grade level</span>
        <select value={value.grade_level ?? ""} onChange={(event) => update({ grade_level: optionalNumber(event.target.value) })}>
          <option value="">Not specified</option>
          {[9, 10, 11, 12].map((grade) => <option key={grade} value={grade}>Grade {grade}</option>)}
        </select>
      </label>
      <label className="form-field">
        <span>School year</span>
        <input value={value.school_year ?? ""} onChange={(event) => update({ school_year: optionalText(event.target.value) })} placeholder="Example: 2025-26" />
      </label>
      <label className="form-field">
        <span>Term</span>
        <select value={value.term ?? ""} onChange={(event) => update({ term: event.target.value ? event.target.value as TranscriptCoursePayload["term"] : undefined })}>
          <option value="">Not specified</option>
          <option value="fall">Fall</option>
          <option value="spring">Spring</option>
          <option value="summer">Summer</option>
          <option value="full_year">Full year</option>
        </select>
      </label>
      <label className="form-field">
        <span>Record type</span>
        <select value={value.transcript_classification ?? ""} onChange={(event) => update({ transcript_classification: event.target.value ? event.target.value as TranscriptCoursePayload["transcript_classification"] : undefined })}>
          <option value="">Detect automatically</option>
          <option value="high_school_catalog">Selected-school catalog course</option>
          {(isDtechSchool || value.transcript_classification === "dtech_catalog") && <option value="dtech_catalog">d.tech catalog course</option>}
          {(isDtechSchool || value.transcript_classification === "dtech_intersession") && <option value="dtech_intersession">d.tech intersession</option>}
          <option value="smccd_catalog">College catalog course</option>
          <option value="smccd_unmatched">Unmatched college course</option>
          <option value="custom">Custom course</option>
        </select>
      </label>
      <p className="form-hint full">GPA weighting follows the institution, the reviewed transcript, and {schoolName}'s approved catalog.{isDtechSchool ? " d.tech courses require an explicit Honors title." : ""}</p>
    </div>
    <p className="form-hint">Changes are saved when this row is imported.</p>
    <button className="quiet-button small" type="button" onClick={onIgnore} disabled={disabled}><X size={15} /> Ignore row</button>
  </fieldset>;
}
