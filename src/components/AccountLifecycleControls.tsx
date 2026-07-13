import {
  DownloadSimpleIcon as DownloadSimple,
  TrashIcon as Trash
} from "@phosphor-icons/react";
import { useState, type SyntheticEvent } from "react";
import { authenticatedFetch } from "@/lib/supabase/authenticated-fetch";
import styles from "./AccountLifecycleControls.module.css";

interface Props {
  onDeleted: () => void | Promise<void>;
}

export default function AccountLifecycleControls({ onDeleted }: Props) {
  const [exporting, setExporting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportData() {
    setError(null);
    setExporting(true);
    try {
      const response = await authenticatedFetch("/api/account/export");
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? "Data could not be exported.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `pilot-princess-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Data could not be exported.");
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirmation !== "DELETE") return;
    setError(null);
    setDeleting(true);
    try {
      const response = await authenticatedFetch("/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmation })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? "Account could not be deleted.");
      }
      await onDeleted();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Account could not be deleted.");
      setDeleting(false);
    }
  }

  return <div className={styles.lifecycle}>
    <div className={styles.row}>
      <span><strong>Export data</strong><small>Settings, plan, transcript, and Pilot records.</small></span>
      <button className={`secondary-button ${styles.action}`} type="button" onClick={() => void exportData()} disabled={exporting || deleting}>
        <DownloadSimple size={16} /> {exporting ? "Preparing" : "Download"}
      </button>
    </div>
    <div className={`${styles.row} ${styles.deleteRow}`}>
      <span><strong>Delete account</strong><small>Permanently removes the account and saved data.</small></span>
      {!confirming && <button className={`danger-button ${styles.action}`} type="button" onClick={() => { setConfirming(true); setError(null); }} disabled={exporting || deleting}>
        <Trash size={16} /> Delete
      </button>}
    </div>
    {confirming && <form className={styles.confirmation} onSubmit={deleteAccount}>
      <label><span>Type DELETE to confirm</span><input autoFocus autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={deleting} /></label>
      <div>
        <button className="quiet-button" type="button" onClick={() => { setConfirming(false); setConfirmation(""); setError(null); }} disabled={deleting}>Cancel</button>
        <button className="danger-button" type="submit" disabled={confirmation !== "DELETE" || deleting}>{deleting ? "Deleting" : "Delete account"}</button>
      </div>
    </form>}
    {error && <p className={styles.error} role="alert">{error}</p>}
  </div>;
}
