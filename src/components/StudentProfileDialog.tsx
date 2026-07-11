import { XIcon as X } from "@phosphor-icons/react";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import ExperienceLog, { type ExperienceDraft } from "@/components/student-tools/ExperienceLog";
import PlanningPreferences from "@/components/student-tools/PlanningPreferences";
import WorkspaceTabs from "@/components/WorkspaceTabs";
import type { Activity, StudentProfile, WorkloadSummary } from "@/lib/models";
import styles from "./student-profile-dialog.module.css";

interface Props {
  session: Session;
  open: boolean;
  profile: StudentProfile;
  schoolName: string;
  matchingCourseCount: number;
  workload: WorkloadSummary | null;
  activities: Activity[];
  busy: boolean;
  onClose: () => void;
  onProfileChange: (profile: StudentProfile) => void;
  onSaveProfile: () => void | Promise<void>;
  onReviewSetup: () => void;
  onOpenCourses: () => void;
  onSaveActivity: (draft: ExperienceDraft, id: string | null) => boolean | Promise<boolean>;
  onRemoveActivity: (id: string) => void | Promise<void>;
}

export default function StudentProfileDialog(props: Props) {
  const [tab, setTab] = useState<"planning" | "experiences">("planning");
  const { open, onClose } = props;
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose]);
  if (!open) return null;
  return <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
    <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="student-profile-title">
      <header className={styles.dialogHeader}>
        <div><h1 id="student-profile-title">Student profile</h1><p>Personal context that improves course matching and workload checks.</p></div>
        <button className="icon-button" type="button" onClick={props.onClose} aria-label="Close student profile"><X size={18} /></button>
      </header>
      <WorkspaceTabs items={[{ id: "planning", label: "Planning" }, { id: "experiences", label: "Experiences" }]} value={tab} onChange={setTab} label="Student profile sections" layoutId="student-profile-dialog-tab" />
      <div className={styles.body}>
        {tab === "planning" ? <PlanningPreferences
          embedded
          session={props.session}
          profile={props.profile}
          schoolName={props.schoolName}
          matchingCourseCount={props.matchingCourseCount}
          workload={props.workload}
          busy={props.busy}
          onChange={props.onProfileChange}
          onSave={props.onSaveProfile}
          onReviewSetup={props.onReviewSetup}
          onNavigate={(destination) => destination === "activities" ? setTab("experiences") : props.onOpenCourses()}
        /> : <ExperienceLog
          embedded
          session={props.session}
          activities={props.activities}
          currentGrade={props.profile.grade_level ?? 9}
          workload={props.workload}
          busy={props.busy}
          onSave={props.onSaveActivity}
          onRemove={props.onRemoveActivity}
          onNavigate={() => setTab("planning")}
        />}
      </div>
    </section>
  </div>;
}
