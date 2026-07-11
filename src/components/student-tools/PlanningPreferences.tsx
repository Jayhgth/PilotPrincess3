import {
  ArrowRightIcon as ArrowRight,
  FloppyDiskIcon as FloppyDisk,
  PencilSimpleIcon as PencilSimple,
  UserCircleIcon as UserCircle
} from "@phosphor-icons/react";
import type { Session } from "@supabase/supabase-js";
import { useState } from "react";
import FadeContent from "@/components/reactbits/FadeContent";
import {
  ACADEMIC_INTEREST_OPTIONS,
  CAREER_INTEREST_AREA_OPTIONS,
  MAJOR_DIRECTION_OPTIONS,
  majorDirectionLabel,
  WORK_VALUE_OPTIONS
} from "@/lib/profile-planning";
import type { StudentProfile, WorkloadSummary } from "@/lib/models";
import styles from "./student-tools.module.css";

interface PlanningPreferencesProps {
  session: Session;
  profile: StudentProfile;
  schoolName: string;
  matchingCourseCount: number;
  workload: WorkloadSummary | null;
  busy: boolean;
  onChange: (profile: StudentProfile) => void;
  onSave: () => void | Promise<void>;
  onReviewSetup: () => void;
  onNavigate: (destination: "courses" | "activities") => void;
  embedded?: boolean;
}

function toggleValue(values: string[], value: string) {
  const next = new Set(values);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return [...next];
}

function listPhrase(values: string[], fallback: string) {
  if (values.length === 0) return fallback;
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, 2).join(", ")}, and ${values.length - 2} more`;
}

export default function PlanningPreferences({
  session,
  profile,
  schoolName,
  matchingCourseCount,
  workload,
  busy,
  onChange,
  onSave,
  onReviewSetup,
  onNavigate,
  embedded = false
}: PlanningPreferencesProps) {
  const [directionOpen, setDirectionOpen] = useState(false);
  const [capacityOpen, setCapacityOpen] = useState(false);
  const standardInterests = new Set<string>(ACADEMIC_INTEREST_OPTIONS);
  const otherInterests = profile.academic_interests.filter((interest) => !standardInterests.has(interest));
  const canSave = Boolean(session.user.id) && !busy;
  const limit = profile.weekly_commitment_limit;
  const knownHours = workload?.knownWeeklyHours ?? 0;
  const directionLabel = majorDirectionLabel(profile.major_direction);
  const directionPhrase = directionLabel === "Exploring" ? "keeping academic options broad" : `exploring ${directionLabel} options`;
  const capacityPhrase = limit === null
    ? "No weekly limit is saved yet."
    : knownHours <= limit
      ? `${knownHours} of ${limit} weekly hours are currently known.`
      : `${knownHours} known weekly hours exceed the ${limit} hour limit.`;

  return (
    <div className={embedded ? styles.embeddedPage : styles.page}>
      <header className={styles.pageHeader}>
        <div>
          {embedded ? <h2>Planning preferences</h2> : <h1>Planning preferences</h1>}
          <p>A short brief that tells course matching and workload checks what to prioritize.</p>
        </div>
        <button className={styles.secondaryButton} type="button" onClick={onReviewSetup}>
          <UserCircle size={17} /> Review school setup
        </button>
      </header>

      <section className={styles.preferenceBrief} aria-labelledby="planning-brief-heading">
        <div>
          <h2 id="planning-brief-heading">Current brief</h2>
          <p>
            {profile.preferred_name || "This student"} is {directionPhrase} at {schoolName},
            with interest in {listPhrase(profile.academic_interests, "several subjects")}. The plan should prioritize {listPhrase(profile.work_values, "balance and useful exploration").toLowerCase()}.
          </p>
        </div>
        <dl>
          <div><dt>Course matches</dt><dd><button type="button" onClick={() => onNavigate("courses")}>{matchingCourseCount} available <ArrowRight size={13} /></button></dd></div>
          <div><dt>Capacity</dt><dd>{capacityPhrase}</dd></div>
        </dl>
      </section>

      <section className={styles.preferenceSection}>
        <button className={styles.disclosureButton} type="button" onClick={() => setDirectionOpen((open) => !open)} aria-expanded={directionOpen}>
          <span><strong>Direction</strong><small>{majorDirectionLabel(profile.major_direction)}. {profile.academic_interests.length} subject interests saved.</small></span>
          <span><PencilSimple size={16} /> {directionOpen ? "Close" : "Edit"}</span>
        </button>
        {directionOpen && (
          <FadeContent className={styles.preferenceEditor} duration={0.16}>
            <label className={styles.field}>
              <span>Broad academic direction</span>
              <select value={profile.major_direction} onChange={(event) => onChange({ ...profile, major_direction: event.target.value })}>
                {MAJOR_DIRECTION_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </select>
              <small>This improves sorting. It does not lock in a major.</small>
            </label>
            <fieldset className={styles.choiceFieldset}>
              <legend>Subjects to test</legend>
              <div className={styles.choiceGrid}>
                {ACADEMIC_INTEREST_OPTIONS.map((interest) => (
                  <label key={interest} className={profile.academic_interests.includes(interest) ? styles.selectedChoice : ""}>
                    <input type="checkbox" checked={profile.academic_interests.includes(interest)} onChange={() => onChange({ ...profile, academic_interests: toggleValue(profile.academic_interests, interest) })} />
                    <span>{interest}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className={styles.formGrid}>
              <label className={styles.field}><span>Other interests</span><input value={otherInterests.join(", ")} onChange={(event) => onChange({ ...profile, academic_interests: [...profile.academic_interests.filter((interest) => standardInterests.has(interest)), ...event.target.value.split(",").map((interest) => interest.trim()).filter(Boolean)] })} placeholder="Specific subjects, separated by commas" /></label>
              <label className={styles.field}><span>Career ideas to test</span><input value={profile.career_direction} onChange={(event) => onChange({ ...profile, career_direction: event.target.value })} placeholder="Software engineering, public health" /><small>Ideas only. They are used as search keywords.</small></label>
            </div>
            <details className={styles.formDetails}>
              <summary>Add work styles, values, and open questions</summary>
              <fieldset className={styles.choiceFieldset}>
                <legend>Ways of working to explore</legend>
                <div className={styles.choiceGrid}>
                  {CAREER_INTEREST_AREA_OPTIONS.map((option) => (
                    <label key={option.value} className={profile.career_interest_areas.includes(option.value) ? styles.selectedChoice : ""}>
                      <input type="checkbox" checked={profile.career_interest_areas.includes(option.value)} onChange={() => onChange({ ...profile, career_interest_areas: toggleValue(profile.career_interest_areas, option.value) })} />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className={styles.choiceFieldset}>
                <legend>What matters in the work</legend>
                <div className={styles.choiceGrid}>
                  {WORK_VALUE_OPTIONS.map((value) => (
                    <label key={value} className={profile.work_values.includes(value) ? styles.selectedChoice : ""}>
                      <input type="checkbox" checked={profile.work_values.includes(value)} onChange={() => onChange({ ...profile, work_values: toggleValue(profile.work_values, value) })} />
                      <span>{value}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className={styles.field}><span>Questions to answer through experience</span><textarea rows={3} value={profile.exploration_questions.join("\n")} onChange={(event) => onChange({ ...profile, exploration_questions: event.target.value.split("\n").map((line) => line.trim()).filter(Boolean) })} placeholder={"Do I enjoy open-ended technical work?\nDo I want work centered on people or systems?"} /><small>One question per line.</small></label>
            </details>
          </FadeContent>
        )}
      </section>

      <section className={styles.preferenceSection}>
        <button className={styles.disclosureButton} type="button" onClick={() => setCapacityOpen((open) => !open)} aria-expanded={capacityOpen}>
          <span><strong>Capacity</strong><small>{capacityPhrase}</small></span>
          <span><PencilSimple size={16} /> {capacityOpen ? "Close" : "Edit"}</span>
        </button>
        {capacityOpen && (
          <FadeContent className={styles.preferenceEditor} duration={0.16}>
            <fieldset className={styles.choiceFieldset}>
              <legend>Planning priority</legend>
              <div className={styles.choiceGridThree}>
                {[
                  { value: "lower_stress", label: "Protect capacity" },
                  { value: "balanced", label: "Balanced" },
                  { value: "competitive", label: "More rigorous" }
                ].map((option) => (
                  <label key={option.value} className={profile.goal_intensity === option.value ? styles.selectedChoice : ""}>
                    <input type="radio" name="planning-priority" checked={profile.goal_intensity === option.value} onChange={() => onChange({ ...profile, goal_intensity: option.value as StudentProfile["goal_intensity"] })} />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className={styles.formGrid}>
              <label className={styles.field}><span>Demanding courses at once</span><select value={profile.workload_tolerance} onChange={(event) => onChange({ ...profile, workload_tolerance: event.target.value as StudentProfile["workload_tolerance"] })}><option value="light">Up to 2</option><option value="balanced">Up to 4</option><option value="high">Up to 6</option></select><small>Weighted and college courses count.</small></label>
              <label className={styles.field}><span>Weekly commitment limit</span><input type="number" min={1} max={80} step={0.5} value={profile.weekly_commitment_limit ?? ""} onChange={(event) => onChange({ ...profile, weekly_commitment_limit: event.target.value ? Number(event.target.value) : null })} placeholder="24" /><small>Activities plus SMCCD class and study time.</small></label>
              <label className={styles.field}><span>Current stress</span><select value={profile.stress_level} onChange={(event) => onChange({ ...profile, stress_level: Number(event.target.value) })}><option value={1}>1 - Low</option><option value={2}>2 - Manageable</option><option value={3}>3 - Stretched</option><option value={4}>4 - High</option><option value={5}>5 - Overloaded</option></select><small>Used for warnings, never grade prediction.</small></label>
            </div>
            <button className={styles.textButton} type="button" onClick={() => onNavigate("activities")}>Review activity hours <ArrowRight size={14} /></button>
          </FadeContent>
        )}
      </section>

      <div className={styles.saveBar}>
        <span>Save changes to update matching and workload checks.</span>
        <button className={styles.primaryButton} type="button" onClick={() => void onSave()} disabled={!canSave}><FloppyDisk size={16} /> Save preferences</button>
      </div>
    </div>
  );
}
