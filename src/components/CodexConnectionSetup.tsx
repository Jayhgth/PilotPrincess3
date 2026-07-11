import {
  CheckCircleIcon as CheckCircle,
  CpuIcon as Cpu,
  ShieldCheckIcon as ShieldCheck,
  WarningIcon as Warning
} from "@phosphor-icons/react";
import type { Session } from "@supabase/supabase-js";
import { useState } from "react";
import FadeContent from "@/components/reactbits/FadeContent";
import ShinyText from "@/components/reactbits/ShinyText";
import { AI_MODEL_OPTIONS, AI_REASONING_EFFORT, type AiModel } from "@/lib/ai-preferences";
import styles from "./CodexConnectionSetup.module.css";

export interface CodexSetupValue {
  enabled: boolean;
  model: AiModel;
  approved: boolean;
  testedAt: string | null;
}

export default function CodexConnectionSetup({
  session,
  value,
  onChange,
  compact = false
}: {
  session: Session;
  value: CodexSetupValue;
  onChange: (next: CodexSetupValue) => void;
  compact?: boolean;
}) {
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState<string | null>(value.testedAt ? "Connection verified." : null);
  const [testError, setTestError] = useState<string | null>(null);

  function update(patch: Partial<CodexSetupValue>) {
    onChange({ ...value, ...patch });
  }

  function selectModel(model: AiModel) {
    setTestMessage(null);
    setTestError(null);
    update({ model, testedAt: null });
  }

  async function testConnection() {
    setTesting(true);
    setTestMessage(null);
    setTestError(null);
    update({ testedAt: null });
    try {
      const response = await fetch("/api/ai/health", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ model: value.model, approved: value.approved })
      });
      const payload = await response.json() as { error?: string; testedAt?: string; message?: string };
      if (!response.ok || !payload.testedAt) throw new Error(payload.error ?? "Codex did not respond.");
      update({ testedAt: payload.testedAt });
      setTestMessage(payload.message ?? "Connection verified.");
    } catch (error) {
      setTestError(error instanceof Error ? error.message : "Codex did not respond.");
    } finally {
      setTesting(false);
    }
  }

  return <div className={`${styles.setup} ${compact ? styles.compact : ""}`}>
    <fieldset className={styles.connectionChoice}>
      <legend>Use Pilot Assistant</legend>
      <label className={value.enabled ? styles.selected : ""}>
        <input type="radio" name={compact ? "assistant-mode-compact" : "assistant-mode"} checked={value.enabled} onChange={() => update({ enabled: true })} />
        <span><strong>Connect Pilot</strong><small>Ask questions and prepare changes from anywhere in the workspace.</small></span>
      </label>
      <label className={!value.enabled ? styles.selected : ""}>
        <input type="radio" name={compact ? "assistant-mode-compact" : "assistant-mode"} checked={!value.enabled} onChange={() => update({ enabled: false, approved: false, testedAt: null })} />
        <span><strong>Continue without AI</strong><small>Planning, transcript parsing, GPA, and graduation tracking still work.</small></span>
      </label>
    </fieldset>

    {value.enabled && <FadeContent className={styles.connectionDetails} duration={0.16}>
      <div className={styles.managedNote}><Cpu size={18} /><span><strong>No API key needed</strong><small>The app manages the server connection. You choose the model and whether Pilot may use your selected context.</small></span></div>
      <fieldset className={styles.modelList}>
        <legend>Model</legend>
        {AI_MODEL_OPTIONS.map((option) => <label className={value.model === option.value ? styles.selected : ""} key={option.value}>
          <input type="radio" name={compact ? "assistant-model-compact" : "assistant-model"} value={option.value} checked={value.model === option.value} onChange={() => selectModel(option.value)} />
          <span><strong>{option.label}{option.recommended ? <em>Recommended</em> : null}</strong><small>{option.description}</small></span>
        </label>)}
      </fieldset>
      <div className={styles.reasoning}><span>Reasoning</span><strong>Light</strong><small>Fixed for concise answers and practical tool use.</small></div>
      <label className={styles.consent}>
        <input type="checkbox" checked={value.approved} onChange={(event) => update({ approved: event.target.checked, testedAt: event.target.checked ? value.testedAt : null })} />
        <ShieldCheck size={18} />
        <span>I approve sending my messages, retrieved app guidance, and the student records needed for my request to OpenAI Codex. Pilot starts in Manual review; risk-based Auto-review can be enabled later in chat.</span>
      </label>
      <div className={styles.testRow}>
        <button type="button" onClick={() => void testConnection()} disabled={testing || !value.approved}>
          {testing ? <ShinyText text="Testing connection" speed={1.7} /> : value.testedAt ? "Test again" : "Test connection"}
        </button>
        <span>GPT-5.6 Luna with {AI_REASONING_EFFORT === "low" ? "Light" : AI_REASONING_EFFORT} reasoning is recommended.</span>
      </div>
      {testMessage && value.testedAt && <FadeContent className={styles.success} duration={0.14}><CheckCircle size={17} weight="fill" /><span>{testMessage}</span></FadeContent>}
      {testError && <div className={styles.error} role="alert"><Warning size={17} /><span>{testError}</span></div>}
    </FadeContent>}
  </div>;
}
