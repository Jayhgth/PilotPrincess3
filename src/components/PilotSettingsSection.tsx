import {
  ArchiveIcon as Archive,
  CheckIcon as Check,
  WarningIcon as Warning
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import CodexConnectionSetup, { type CodexSetupValue } from "@/components/CodexConnectionSetup";
import type { AiReviewMode } from "@/lib/ai-preferences";
import type { AiConversation, StudentSettings } from "@/lib/models";
import { authenticatedFetch } from "@/lib/supabase/authenticated-fetch";
import styles from "./StudentSettingsPanel.module.css";

function archiveExpiryLabel(archivedAt: string | null) {
  const archivedDate = new Date(archivedAt ?? "");
  if (Number.isNaN(archivedDate.getTime())) return "Deletes 14 days after archiving";
  archivedDate.setDate(archivedDate.getDate() + 14);
  return `Deletes ${archivedDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

export default function PilotSettingsSection({
  settings,
  onChanged
}: {
  settings: StudentSettings;
  onChanged: () => void | Promise<void>;
}) {
  const [setup, setSetup] = useState<CodexSetupValue>({
    enabled: settings.ai_enabled,
    model: settings.ai_model,
    approved: Boolean(settings.ai_connection_approved_at),
    testedAt: settings.ai_setup_tested_at
  });
  const [reviewMode, setReviewMode] = useState<AiReviewMode>(settings.ai_review_mode);
  const [archives, setArchives] = useState<AiConversation[]>([]);
  const [loadingArchives, setLoadingArchives] = useState(true);
  const [saving, setSaving] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const authorizedFetch = useCallback((url: string, init?: RequestInit) => authenticatedFetch(url, init), []);

  useEffect(() => {
    setSetup({
      enabled: settings.ai_enabled,
      model: settings.ai_model,
      approved: Boolean(settings.ai_connection_approved_at),
      testedAt: settings.ai_setup_tested_at
    });
    setReviewMode(settings.ai_review_mode);
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    void authorizedFetch("/api/ai/conversations?archived=true")
      .then(async (response) => {
        const payload = await response.json() as { conversations?: AiConversation[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "Archived conversations could not be loaded.");
        if (!cancelled) setArchives(payload.conversations ?? []);
      })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Archived conversations could not be loaded."); })
      .finally(() => { if (!cancelled) setLoadingArchives(false); });
    return () => { cancelled = true; };
  }, [authorizedFetch]);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const preferenceResponse = await authorizedFetch("/api/ai/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: setup.enabled, model: setup.model, approved: setup.approved })
      });
      const preferencePayload = await preferenceResponse.json() as { error?: string };
      if (!preferenceResponse.ok) throw new Error(preferencePayload.error ?? "Pilot settings could not be saved.");
      if (setup.enabled && reviewMode !== settings.ai_review_mode) {
        const reviewResponse = await authorizedFetch("/api/ai/review-mode", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: reviewMode })
        });
        const reviewPayload = await reviewResponse.json() as { error?: string };
        if (!reviewResponse.ok) throw new Error(reviewPayload.error ?? "Review mode could not be saved.");
      }
      await onChanged();
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pilot settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function restore(conversation: AiConversation) {
    setRestoringId(conversation.id);
    setError(null);
    try {
      const response = await authorizedFetch("/api/ai/conversations", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: conversation.id, archived: false })
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The conversation could not be restored.");
      setArchives((current) => current.filter((item) => item.id !== conversation.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The conversation could not be restored.");
    } finally {
      setRestoringId(null);
    }
  }

  const connectionDirty = setup.enabled !== settings.ai_enabled
    || setup.model !== settings.ai_model
    || setup.approved !== Boolean(settings.ai_connection_approved_at)
    || setup.testedAt !== settings.ai_setup_tested_at
    || reviewMode !== settings.ai_review_mode;

  return <section className={`content-section ${styles.section}`} aria-labelledby="pilot-settings-heading">
    <header className={styles.sectionHeading}>
      <div>
        <h2 id="pilot-settings-heading">Pilot Assistant</h2>
        <p>Connection, model access, change review, and conversation retention live here.</p>
      </div>
    </header>
    <CodexConnectionSetup compact value={setup} onChange={(next) => { setSetup(next); setSaved(false); }} />
    <label className={`form-field ${styles.reviewField}`}>
      <span>Change review</span>
      <select disabled={!setup.enabled} value={reviewMode} onChange={(event) => { setReviewMode(event.target.value as AiReviewMode); setSaved(false); }}>
        <option value="manual">Manual approval</option>
        <option value="auto_review">Independent auto-review</option>
      </select>
      <small>{reviewMode === "auto_review" ? "A separate reviewer applies supported changes and declines unsafe ones." : "You approve every proposed change before it is applied."}</small>
    </label>
    {error && <p className={styles.error} role="alert"><Warning size={15} /> {error}</p>}
    <div className={styles.saveRow}>
      {saved && <span className={styles.savedStatus} role="status"><Check size={15} weight="bold" /> Pilot settings saved</span>}
      <button className="primary-button" type="button" onClick={() => void save()} disabled={saving || !connectionDirty || (setup.enabled && (!setup.approved || !setup.testedAt))}>{saving ? "Saving" : "Save Pilot settings"}</button>
    </div>
    <details className={styles.archiveSection}>
      <summary><Archive size={15} /> Archived conversations <span>{archives.length}</span></summary>
      <p>Restore a conversation within 14 days. After that, its messages and attachments are deleted.</p>
      {loadingArchives ? <small>Loading archived conversations</small> : archives.length ? <div className={styles.archiveList}>{archives.map((conversation) => <div className={styles.archiveRow} key={conversation.id}><span><strong>{conversation.title}</strong><small>{archiveExpiryLabel(conversation.archived_at)}</small></span><button className="secondary-button small" type="button" onClick={() => void restore(conversation)} disabled={restoringId === conversation.id}>Restore</button></div>)}</div> : <div className={styles.archiveEmpty}>No archived conversations.</div>}
    </details>
  </section>;
}
