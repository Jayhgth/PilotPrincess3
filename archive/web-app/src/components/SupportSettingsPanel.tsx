import { BugIcon as Bug, CheckCircleIcon as CheckCircle, ClockIcon as Clock, LifebuoyIcon as Lifebuoy } from "@phosphor-icons/react";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState, type SyntheticEvent } from "react";
import type { School, SupportRequest } from "@/lib/models";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import styles from "./SupportSettingsPanel.module.css";

interface SupportSettingsPanelProps {
  session: Session;
  school: School;
}

const CATEGORY_LABELS: Record<SupportRequest["category"], string> = {
  support: "General support",
  bug: "Bug report",
  course_issue: "Course or academic data"
};

const STATUS_LABELS: Record<SupportRequest["status"], string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed"
};

export default function SupportSettingsPanel({ session, school }: SupportSettingsPanelProps) {
  const [category, setCategory] = useState<SupportRequest["category"]>("support");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [requests, setRequests] = useState<SupportRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let active = true;
    const supabase = getBrowserSupabase();
    void supabase.from("support_requests").select("*").eq("user_id", session.user.id).order("created_at", { ascending: false }).limit(50)
      .then(({ data, error: loadError }) => {
        if (!active) return;
        if (loadError) setError(loadError.message);
        else setRequests((data ?? []) as unknown as SupportRequest[]);
        setLoading(false);
      });
    return () => { active = false; };
  }, [session.user.id]);

  async function submit(event: SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    event.preventDefault();
    const cleanSubject = subject.trim();
    const cleanMessage = message.trim();
    if (cleanSubject.length < 3 || cleanMessage.length < 10) {
      setError("Add a short subject and enough detail for an administrator to investigate.");
      return;
    }
    setSubmitting(true);
    setSubmitted(false);
    setError(null);
    const supabase = getBrowserSupabase();
    const { data, error: submitError } = await supabase.from("support_requests").insert({
      user_id: session.user.id,
      reporter_email: session.user.email ?? "Student account",
      school_id: school.id,
      category,
      subject: cleanSubject,
      message: cleanMessage
    }).select("*").single();
    if (submitError) {
      setError(submitError.message);
    } else {
      setRequests((current) => [data as unknown as SupportRequest, ...current]);
      setSubject("");
      setMessage("");
      setSubmitted(true);
    }
    setSubmitting(false);
  }

  return <div className={styles.panel}>
    <section className="content-section" aria-labelledby="contact-support-heading">
      <header className={styles.heading}>
        <div><h2 id="contact-support-heading">Contact support</h2><p>Send a private message to the app administrators. Your account and selected school are included automatically.</p></div>
      </header>
      <form className={styles.form} onSubmit={submit}>
        <div className={styles.formGrid}>
          <label className="form-field"><span>Type</span><select value={category} onChange={(event) => setCategory(event.target.value as SupportRequest["category"])}><option value="support">General support</option><option value="bug">Bug report</option><option value="course_issue">Course or academic data</option></select></label>
          <label className="form-field"><span>Subject</span><input value={subject} maxLength={120} onChange={(event) => setSubject(event.target.value)} placeholder="Briefly describe the issue" required /></label>
        </div>
        <label className="form-field"><span>Message</span><textarea value={message} maxLength={4000} rows={6} onChange={(event) => setMessage(event.target.value)} placeholder={category === "course_issue" ? "Include the school, course name or code, and what appears incorrect." : "Explain what happened and what you expected."} required /></label>
        <div className={styles.context}><Lifebuoy size={16} /><span>{session.user.email ?? "Student account"} · {school.name}</span></div>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.submitRow}>{submitted && <span role="status"><CheckCircle size={15} weight="fill" /> Message sent</span>}<button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Sending" : "Send message"}</button></div>
      </form>
    </section>

    <section className="content-section" aria-labelledby="support-history-heading">
      <header className={styles.heading}><div><h2 id="support-history-heading">Your messages</h2><p>Responses and status updates appear here.</p></div></header>
      {loading ? <p className={styles.empty}>Loading messages…</p> : requests.length === 0 ? <p className={styles.empty}>No support messages yet.</p> : <div className={styles.requests}>{requests.map((request) => <article className={styles.request} key={request.id}>
        <header><span className={styles.category}>{request.category === "bug" ? <Bug size={14} /> : <Lifebuoy size={14} />}{CATEGORY_LABELS[request.category]}</span><span className={`${styles.status} ${styles[request.status]}`}>{request.status === "resolved" || request.status === "closed" ? <CheckCircle size={13} /> : <Clock size={13} />}{STATUS_LABELS[request.status]}</span></header>
        <h3>{request.subject}</h3>
        <p>{request.message}</p>
        {request.admin_response && <div className={styles.response}><strong>Administrator response</strong><p>{request.admin_response}</p></div>}
        <small>{new Date(request.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</small>
      </article>)}</div>}
    </section>
  </div>;
}
