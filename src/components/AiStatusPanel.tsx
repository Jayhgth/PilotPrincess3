import {
  CheckCircleIcon as CheckCircle,
  ChatCircleDotsIcon as ChatCircleDots,
  CpuIcon as Cpu,
  ShieldCheckIcon as ShieldCheck,
  WarningIcon as Warning
} from "@phosphor-icons/react";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

interface CodexRuntimeStatus {
  providerStatus: "ready" | "needs_auth" | "unavailable";
  providerMessage: string;
  credentialMode: "server_api_key" | "local_codex_login" | "unconfigured";
  authStatus: "configured" | "authenticated" | "unauthenticated" | "unknown";
  cliVersion: string | null;
  model: string;
  reasoningEffort: string;
  runtime: string;
  accessPolicy: string;
  retentionPolicy: string;
}

function formatReasoningEffort(value: string) {
  return value === "low" ? "Light" : value.charAt(0).toUpperCase() + value.slice(1);
}

export default function AiStatusPanel({ session, onOpenAssistant }: { session: Session; onOpenAssistant: () => void }) {
  const [status, setStatus] = useState<CodexRuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/ai/health", { headers: { authorization: `Bearer ${session.access_token}` } })
      .then(async (response) => {
        const payload = await response.json() as CodexRuntimeStatus & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "AI connection details could not be loaded.");
        if (active) setStatus(payload);
      })
      .catch((caught) => {
        if (active) setStatusError(caught instanceof Error ? caught.message : "AI connection details could not be loaded.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session.access_token]);

  const connected = status?.providerStatus === "ready";
  const authenticationLabel = status?.credentialMode === "server_api_key"
    ? "Server API key"
    : status?.credentialMode === "local_codex_login" && status?.authStatus === "authenticated"
      ? "Local Codex login"
      : "Not authenticated";

  return <div className="ai-page page-frame">
    <header className="page-header"><div><h1>AI connection</h1><p>See what Pilot can access, then test it in the same assistant students use.</p></div></header>
    {loading && <section className="ai-connection-card checking ai-status-loading" role="status"><div /><div /><div /><span>Checking the Codex runtime</span></section>}
    {statusError && <div className="inline-alert error" role="alert"><Warning size={17} /> {statusError}</div>}
    {status && <div className="ai-status-page ai-status-focused">
      <section className={`ai-connection-card ${connected ? "connected" : "unavailable"}`} aria-labelledby="ai-connection-title">
        <div className="ai-connection-heading">
          {connected ? <CheckCircle size={21} weight="fill" /> : <Warning size={20} weight="fill" />}
          <div><h2 id="ai-connection-title">{connected ? "Pilot is ready" : "Pilot needs attention"}</h2><p>{status.providerMessage}</p></div>
          <button className="primary-button" type="button" onClick={onOpenAssistant} disabled={!connected}><ChatCircleDots size={17} /> Open assistant</button>
        </div>
        <dl className="ai-connection-metadata">
          <div><dt>Runtime</dt><dd>{status.runtime}</dd></div>
          <div><dt>Authentication</dt><dd>{authenticationLabel}</dd></div>
          <div><dt>Model</dt><dd>{status.model}</dd></div>
          <div><dt>Reasoning</dt><dd>{formatReasoningEffort(status.reasoningEffort)}</dd></div>
          <div><dt>CLI</dt><dd>{status.cliVersion ? `v${status.cliVersion}` : "Unavailable"}</dd></div>
        </dl>
      </section>
      <section className="ai-assistant-contract" aria-labelledby="assistant-contract-title">
        <div><Cpu size={19} /><span><h2 id="assistant-contract-title">One assistant, across the workspace</h2><p>Conversations persist. Pilot reads current records only when needed and keeps its work readable in the conversation.</p></span></div>
        <ul><li><CheckCircle size={16} /> Student-data reads can run automatically.</li><li><ShieldCheck size={16} /> Every plan change waits for your explicit confirmation.</li><li><CheckCircle size={16} /> Only safe reasoning summaries are shown, never hidden chain-of-thought.</li></ul>
        <p>{status.accessPolicy}. {status.retentionPolicy}.</p>
      </section>
    </div>}
  </div>;
}
