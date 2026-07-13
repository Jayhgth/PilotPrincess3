import {
  ArchiveIcon as Archive,
  CheckCircleIcon as CheckCircle,
  CheckIcon as Check,
  WarningIcon as Warning
} from "@phosphor-icons/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import AiModelPicker from "@/components/AiModelPicker";
import {
  AI_REASONING_OPTIONS,
  type AiModel,
  type AiReasoningEffort,
  type AiReviewMode
} from "@/lib/ai-preferences";
import type { AiConversation, StudentSettings } from "@/lib/models";
import { authenticatedFetch } from "@/lib/supabase/authenticated-fetch";
import styles from "./PilotSettingsSection.module.css";

interface PilotDraft {
  enabled: boolean;
  model: AiModel;
  reasoningEffort: AiReasoningEffort;
  approved: boolean;
  testedAt: string | null;
  reviewMode: AiReviewMode;
}

function settingsDraft(settings: StudentSettings): PilotDraft {
  return {
    enabled: settings.ai_enabled,
    model: settings.ai_model,
    reasoningEffort: settings.ai_reasoning_effort,
    approved: Boolean(settings.ai_connection_approved_at),
    testedAt: settings.ai_setup_tested_at,
    reviewMode: settings.ai_review_mode
  };
}

function SettingRow({ title, description, control }: { title: string; description: string; control: ReactNode }) {
  return <div className={styles.settingRow}>
    <span><strong>{title}</strong><small>{description}</small></span>
    <div className={styles.control}>{control}</div>
  </div>;
}

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
  const [draft, setDraft] = useState<PilotDraft>(() => settingsDraft(settings));
  const [archives, setArchives] = useState<AiConversation[]>([]);
  const [loadingArchives, setLoadingArchives] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(draft.testedAt ? "Connection verified." : null);

  const authorizedFetch = useCallback((url: string, init?: RequestInit) => authenticatedFetch(url, init), []);

  useEffect(() => {
    setDraft(settingsDraft(settings));
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

  function update(patch: Partial<PilotDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const preferenceResponse = await authorizedFetch("/api/ai/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: draft.enabled, model: draft.model, reasoningEffort: draft.reasoningEffort, approved: draft.approved })
      });
      const preferencePayload = await preferenceResponse.json() as { error?: string };
      if (!preferenceResponse.ok) throw new Error(preferencePayload.error ?? "Pilot settings could not be saved.");
      if (draft.enabled && draft.reviewMode !== settings.ai_review_mode) {
        const reviewResponse = await authorizedFetch("/api/ai/review-mode", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: draft.reviewMode })
        });
        const reviewPayload = await reviewResponse.json() as { error?: string };
        if (!reviewResponse.ok) throw new Error(reviewPayload.error ?? "Change access could not be saved.");
      }
      await onChanged();
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pilot settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setError(null);
    setTestMessage(null);
    try {
      const response = await authorizedFetch("/api/ai/health", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: draft.model, reasoningEffort: draft.reasoningEffort, approved: true })
      });
      const payload = await response.json() as { error?: string; testedAt?: string; message?: string };
      if (!response.ok || !payload.testedAt) throw new Error(payload.error ?? "Codex did not respond.");
      update({ testedAt: payload.testedAt });
      setTestMessage(payload.message ?? "Connection verified.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Codex did not respond.");
    } finally {
      setTesting(false);
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

  const dirty = draft.enabled !== settings.ai_enabled
    || draft.model !== settings.ai_model
    || draft.reasoningEffort !== settings.ai_reasoning_effort
    || draft.approved !== Boolean(settings.ai_connection_approved_at)
    || draft.reviewMode !== settings.ai_review_mode;

  return <div className={styles.pilotSettings}>
    <section className={styles.settingsSection} aria-labelledby="pilot-settings-heading">
      <header><h2 id="pilot-settings-heading">Pilot Assistant</h2></header>
      <div className={styles.rows}>
        <SettingRow
          title="Pilot Assistant"
          description="Use Pilot chat and AI-assisted planning."
          control={<label className={styles.switch}><input type="checkbox" role="switch" checked={draft.enabled} onChange={(event) => update({ enabled: event.target.checked, approved: event.target.checked ? draft.approved : false })} /><span /></label>}
        />
        <SettingRow
          title="Model"
          description="Default model for new Pilot turns."
          control={<AiModelPicker value={draft.model} disabled={!draft.enabled} onChange={(model) => { update({ model, testedAt: null }); setTestMessage(null); }} />}
        />
        <SettingRow
          title="Reasoning"
          description="How much analysis Pilot uses before answering."
          control={<select className={styles.select} disabled={!draft.enabled} value={draft.reasoningEffort} onChange={(event) => { update({ reasoningEffort: event.target.value as AiReasoningEffort, testedAt: null }); setTestMessage(null); }}>{AI_REASONING_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select>}
        />
        <SettingRow
          title="Change access"
          description="Supervised asks before every write; Auto-review uses an independent reviewer."
          control={<select className={styles.select} disabled={!draft.enabled} value={draft.reviewMode} onChange={(event) => update({ reviewMode: event.target.value as AiReviewMode })}><option value="manual">Supervised</option><option value="auto_review">Auto-review</option></select>}
        />
      </div>
    </section>

    <section className={styles.settingsSection} aria-labelledby="pilot-privacy-heading">
      <header><h2 id="pilot-privacy-heading">Connection and privacy</h2></header>
      <div className={styles.rows}>
        <SettingRow
          title="Share requested context"
          description="Allow messages and the academic records needed for a request to be sent to OpenAI Codex."
          control={<label className={styles.switch}><input type="checkbox" role="switch" disabled={!draft.enabled} checked={draft.approved} onChange={(event) => update({ approved: event.target.checked, testedAt: event.target.checked ? draft.testedAt : null })} /><span /></label>}
        />
        <SettingRow
          title="Connection test"
          description={testMessage ?? "Verify the selected model and reasoning level. No API key is needed."}
          control={<button className="secondary-button small" type="button" disabled={!draft.enabled || !draft.approved || testing} onClick={() => void testConnection()}>{testing ? "Testing" : draft.testedAt ? "Test again" : "Test"}</button>}
        />
      </div>
    </section>

    {error && <p className={styles.error} role="alert"><Warning size={15} /> {error}</p>}
    <div className={styles.saveRow}>
      {saved && <span role="status"><Check size={15} weight="bold" /> Saved</span>}
      <button className="primary-button" type="button" onClick={() => void save()} disabled={saving || !dirty || (draft.enabled && !draft.approved)}>{saving ? "Saving" : "Save Pilot settings"}</button>
    </div>

    <details className={styles.archives}>
      <summary><Archive size={15} /> Archived conversations <span>{archives.length}</span></summary>
      <p>Restore a conversation within 14 days. After that, its messages and attachments are deleted.</p>
      {loadingArchives ? <small>Loading archived conversations</small> : archives.length ? <div className={styles.archiveList}>{archives.map((conversation) => <div className={styles.archiveRow} key={conversation.id}><span><strong>{conversation.title}</strong><small>{archiveExpiryLabel(conversation.archived_at)}</small></span><button className="secondary-button small" type="button" onClick={() => void restore(conversation)} disabled={restoringId === conversation.id}>Restore</button></div>)}</div> : <div className={styles.archiveEmpty}><CheckCircle size={16} /> No archived conversations</div>}
    </details>
  </div>;
}
