import {
  ArrowClockwiseIcon as ArrowClockwise,
  ArrowSquareOutIcon as ArrowSquareOut,
  CheckCircleIcon as CheckCircle,
  HouseIcon as House,
  TrashIcon as Trash,
  WarningIcon as Warning
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { SharedDataProposal } from "@/lib/models";
import styles from "./AdminSettingsPanel.module.css";

interface AdminSettingsPanelProps {
  accessToken: string;
  email: string;
  onReplayOnboarding: () => void;
  onViewLogin: () => void;
  onResetComplete: () => void;
}

type ReviewProposal = SharedDataProposal & { schools: { name: string } | null };

export default function AdminSettingsPanel({
  accessToken,
  email,
  onReplayOnboarding,
  onViewLogin,
  onResetComplete
}: AdminSettingsPanelProps) {
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ReviewProposal[]>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/admin/shared-proposals", { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Shared corrections could not be loaded.");
        if (active) setProposals(payload.proposals ?? []);
      })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Shared corrections could not be loaded."); });
    return () => { active = false; };
  }, [accessToken]);

  async function reviewProposal(proposalId: string, decision: "approved" | "rejected") {
    setReviewingId(proposalId);
    setError(null);
    try {
      const response = await fetch("/api/admin/shared-proposals", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ proposalId, decision, note: null })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "The correction could not be reviewed.");
      setProposals((current) => current.filter((proposal) => proposal.id !== proposalId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The correction could not be reviewed.");
    } finally {
      setReviewingId(null);
    }
  }

  async function resetWorkspace() {
    if (confirmation !== "RESET" || resetting) return;
    setResetting(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/reset", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "The test workspace could not be reset.");
      onResetComplete();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "The test workspace could not be reset.");
      setResetting(false);
    }
  }

  function beginConfirmation() {
    setConfirming(true);
    window.setTimeout(() => confirmationRef.current?.focus(), 0);
  }

  return <div className={styles.panel}>
    <section className="content-section" aria-labelledby="admin-account-heading">
      <header className={styles.heading}>
        <div><h2 id="admin-account-heading">Administrator account</h2><p>Testing controls are available only to this signed-in account.</p></div>
      </header>
      <div className={styles.identity}><CheckCircle size={17} weight="fill" /><span><strong>Administrator</strong><small>{email}</small></span></div>
    </section>

    <section className="content-section" aria-labelledby="admin-tools-heading">
      <header className={styles.heading}>
        <div><h2 id="admin-tools-heading">Testing tools</h2><p>Preview student entry points and restart the onboarding flow.</p></div>
      </header>
      <div className={styles.toolRows}>
        <div className={styles.toolRow}><span><strong>Replay onboarding</strong><small>Open onboarding with the current account and existing data.</small></span><button className="secondary-button" type="button" onClick={onReplayOnboarding}><ArrowClockwise size={16} /> Replay</button></div>
        <div className={styles.toolRow}><span><strong>View login page</strong><small>Preview the signed-out entry screen without changing this account.</small></span><button className="secondary-button" type="button" onClick={onViewLogin}><House size={16} /> View login</button></div>
      </div>
    </section>

    <section className="content-section" aria-labelledby="shared-corrections-heading">
      <header className={styles.heading}>
        <div><h2 id="shared-corrections-heading">Shared data corrections</h2><p>Student and Pilot submissions stay pending until an administrator checks the evidence and exact fields.</p></div>
      </header>
      {proposals.length === 0 ? <p className={styles.empty}>No corrections are waiting for review.</p> : <div className={styles.proposals}>{proposals.map((proposal) => <article className={styles.proposal} key={proposal.id}>
        <header><span><strong>{proposal.entity_type.replaceAll("_", " ")}</strong><small>{proposal.schools?.name ?? "Statewide shared data"} · {proposal.submitted_via === "pilot" ? "Submitted by Pilot" : "Student submission"}</small></span><code>{proposal.target_table}</code></header>
        <p>{proposal.evidence_summary}</p>
        <dl>{Object.entries(proposal.proposed_payload).map(([field, value]) => <div key={field}><dt>{field.replaceAll("_", " ")}</dt><dd>{typeof value === "string" ? value : JSON.stringify(value)}</dd></div>)}</dl>
        <footer>{proposal.evidence_url ? <a href={proposal.evidence_url} target="_blank" rel="noreferrer">Open evidence <ArrowSquareOut size={13} /></a> : <span>No evidence link</span>}<div><button className="quiet-button" type="button" disabled={reviewingId === proposal.id} onClick={() => void reviewProposal(proposal.id, "rejected")}>Reject</button><button className="primary-button" type="button" disabled={reviewingId === proposal.id} onClick={() => void reviewProposal(proposal.id, "approved")}>{reviewingId === proposal.id ? "Reviewing" : "Approve and publish"}</button></div></footer>
      </article>)}</div>}
    </section>

    <section className={`content-section ${styles.dangerSection}`} aria-labelledby="reset-workspace-heading">
      <header className={styles.heading}>
        <div><h2 id="reset-workspace-heading">Reset this user workspace</h2><p>Remove plans, transcripts, uploads, tasks, summaries, and Pilot conversations. Sign-in and administrator access remain.</p></div>
      </header>
      {!confirming ? <button className="danger-button" type="button" onClick={beginConfirmation}><Trash size={16} /> Reset user data</button> : <div className={styles.confirmation}>
        <label htmlFor="admin-reset-confirmation">Type <strong>RESET</strong> to confirm</label>
        <input ref={confirmationRef} id="admin-reset-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} disabled={resetting} />
        <div><button className="quiet-button" type="button" onClick={() => { setConfirming(false); setConfirmation(""); setError(null); }} disabled={resetting}>Cancel</button><button className="danger-button" type="button" onClick={() => void resetWorkspace()} disabled={confirmation !== "RESET" || resetting}>{resetting ? "Resetting workspace" : "Reset and restart onboarding"}</button></div>
      </div>}
      {error && <div className={styles.error} role="alert"><Warning size={16} /><span>{error}</span></div>}
    </section>
  </div>;
}
