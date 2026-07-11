import {
  CheckCircleIcon as CheckCircle,
  FlaskIcon as Flask,
  ShieldCheckIcon as ShieldCheck,
  TrashIcon as Trash,
  WarningIcon as Warning,
  XIcon as X
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./AdminSettingsDialog.module.css";

interface AdminSettingsDialogProps {
  accessToken: string;
  email: string;
  onClose: () => void;
  onResetComplete: () => void;
}

export default function AdminSettingsDialog({
  accessToken,
  email,
  onClose,
  onResetComplete
}: AdminSettingsDialogProps) {
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const confirmationRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !resetting) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, resetting]);

  useEffect(() => {
    if (confirming) confirmationRef.current?.focus();
  }, [confirming]);

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

  return createPortal(
    <div className={styles.backdrop} onMouseDown={(event) => {
      if (event.target === event.currentTarget && !resetting) onClose();
    }}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="admin-settings-title">
        <header className={styles.header}>
          <div>
            <span className={styles.icon}><ShieldCheck size={18} weight="duotone" /></span>
            <span><strong id="admin-settings-title">Admin settings</strong><small>Testing controls for this account</small></span>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} disabled={resetting} aria-label="Close admin settings"><X size={18} /></button>
        </header>

        <div className={styles.body}>
          <div className={styles.identity}>
            <CheckCircle size={17} weight="fill" />
            <span><strong>Administrator</strong><small>{email}</small></span>
          </div>

          <div className={styles.intro}>
            <Flask size={19} />
            <div><h2>Testing tools</h2><p>This panel is reserved for administrator-only QA controls. More tools can be added here without exposing them to student accounts.</p></div>
          </div>

          <section className={styles.resetSection} aria-labelledby="reset-workspace-title">
            <div>
              <h3 id="reset-workspace-title">Reset this user workspace</h3>
              <p>Remove all plans, profile answers, transcripts and uploads, activities, tasks, simulations, summaries, and Pilot conversations. Your sign-in and administrator access remain.</p>
            </div>

            {!confirming ? (
              <button className={styles.resetButton} type="button" onClick={() => setConfirming(true)}><Trash size={16} /> Reset user data</button>
            ) : (
              <div className={styles.confirmation}>
                <label htmlFor="admin-reset-confirmation">Type <strong>RESET</strong> to confirm</label>
                <input
                  ref={confirmationRef}
                  id="admin-reset-confirmation"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  disabled={resetting}
                />
                <div>
                  <button type="button" onClick={() => { setConfirming(false); setConfirmation(""); setError(null); }} disabled={resetting}>Cancel</button>
                  <button className={styles.confirmReset} type="button" onClick={() => void resetWorkspace()} disabled={confirmation !== "RESET" || resetting}>{resetting ? "Resetting workspace…" : "Reset and restart onboarding"}</button>
                </div>
              </div>
            )}

            {error && <div className={styles.error} role="alert"><Warning size={16} /><span>{error}</span></div>}
          </section>
        </div>
      </section>
    </div>,
    document.body
  );
}
