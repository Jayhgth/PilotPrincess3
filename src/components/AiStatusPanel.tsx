import {
  CheckCircleIcon as CheckCircle,
  CpuIcon as Cpu,
  ShieldCheckIcon as ShieldCheck,
  WarningIcon as Warning
} from "@phosphor-icons/react";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import CodexReviewPanel from "@/components/CodexReviewPanel";

interface CodexFeatureStatus {
  id: string;
  label: string;
  usesCodex: boolean;
  condition: string;
}

interface RuntimeCapability {
  id: string;
  label: string;
  state: "available" | "available_if_emitted" | "disabled";
  detail: string;
}

interface CodexRuntimeStatus {
  apiKeyConfigured: boolean;
  credentialMode: "server_api_key" | "local_codex_login" | "unconfigured";
  providerStatus: "ready" | "needs_auth" | "unavailable";
  providerMessage: string;
  authStatus: "configured" | "authenticated" | "unauthenticated" | "unknown";
  cliVersion: string | null;
  checkedAt: string;
  model: string;
  reasoningEffort: string;
  maxConcurrentTurns: number;
  maxWaitingTurns: number;
  runtime: string;
  transport: string;
  accessPolicy: string;
  retentionPolicy: string;
  features: CodexFeatureStatus[];
  capabilities: RuntimeCapability[];
}

function formatReasoningEffort(value: string) {
  if (value === "low") return "Light";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function AiStatusPanel({ session }: { session: Session }) {
  const [status, setStatus] = useState<CodexRuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/ai/health", {
      headers: { authorization: `Bearer ${session.access_token}` }
    })
      .then(async (response) => {
        const payload = await response.json() as CodexRuntimeStatus & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "AI connection details could not be loaded.");
        if (active) setStatus(payload);
      })
      .catch((caught) => {
        if (active) setStatusError(caught instanceof Error ? caught.message : "AI connection details could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [session.access_token]);

  const connected = status?.providerStatus === "ready";
  const authenticationLabel = status?.credentialMode === "server_api_key"
    ? "Server API key"
    : status?.credentialMode === "local_codex_login" && status?.authStatus === "authenticated"
      ? "Local Codex login"
      : "Not authenticated";

  return (
    <div className="ai-page page-frame">
      <header className="page-header">
        <div>
          <h1>AI connection</h1>
          <p>Verify the runtime, run one real request, and inspect the sanitized SDK event record.</p>
        </div>
      </header>

      {loading && <section className="ai-connection-card checking ai-status-loading" role="status"><div /><div /><div /><span>Checking the Codex runtime and authentication</span></section>}
      {statusError && <div className="inline-alert error" role="alert"><Warning size={17} /> {statusError}</div>}

      {status && <div className="ai-status-page">
        <section className={`ai-connection-card ${connected ? "connected" : "unavailable"}`} aria-labelledby="ai-connection-title">
          <div className="ai-connection-heading">
            {connected ? <CheckCircle size={21} weight="fill" /> : <Warning size={20} weight="fill" />}
            <div><h2 id="ai-connection-title">{connected ? "Codex runtime ready" : "Codex runtime needs attention"}</h2><p>{status.providerMessage}</p></div>
          </div>
          <dl className="ai-connection-metadata">
            <div><dt>Provider</dt><dd>{status.runtime}</dd></div>
            <div><dt>Transport</dt><dd>{status.transport}</dd></div>
            <div><dt>Authentication</dt><dd>{authenticationLabel}</dd></div>
            <div><dt>Model</dt><dd>{status.model}</dd></div>
            <div><dt>Reasoning</dt><dd>{formatReasoningEffort(status.reasoningEffort)}</dd></div>
            <div><dt>CLI</dt><dd>{status.cliVersion ? `v${status.cliVersion}` : "Unavailable"}</dd></div>
          </dl>
          <div className="ai-connection-policy"><ShieldCheck size={16} /><span>{status.accessPolicy}. {status.retentionPolicy}. Capacity is {status.maxConcurrentTurns} active and {status.maxWaitingTurns} waiting turns.</span></div>
        </section>

        <CodexReviewPanel
          session={session}
          focus="connection"
          title="Run a transparent diagnostic"
          description="This sends the displayed snapshot to OpenAI Codex. The answer, available reasoning summaries, sanitized lifecycle, usage, and exact input stay inspectable for this page visit."
          question="Confirm that this Codex connection is functional and summarize the access boundary shown in the runtime snapshot."
          context={{
            provider_status: status.providerStatus,
            runtime: status.runtime,
            transport: status.transport,
            model: status.model,
            reasoning: formatReasoningEffort(status.reasoningEffort),
            access_policy: status.accessPolicy,
            retention_policy: status.retentionPolicy,
            capabilities: status.capabilities
          }}
        />

        <section className="ai-capability-section" aria-labelledby="ai-capability-title">
          <header><h2 id="ai-capability-title">Trace coverage</h2><p>The official TypeScript SDK exposes a smaller event set than the persistent Codex app-server used by t3code. Disabled capabilities are disclosed instead of being presented as unused events.</p></header>
          <div className="ai-capability-table">
            {status.capabilities.map((capability) => <div key={capability.id}><span><strong>{capability.label}</strong><small>{capability.detail}</small></span><em>{capability.state === "disabled" ? "Disabled" : capability.state === "available" ? "Available" : "When emitted"}</em></div>)}
          </div>
          <p><ShieldCheck size={15} /> Reasoning means Codex-provided summaries only. Hidden chain-of-thought is not requested or shown.</p>
        </section>

        <details className="ai-boundaries">
          <summary>Where Codex is used</summary>
          <p>Calculations and saved-plan changes stay deterministic. Codex starts only for the tasks marked Used.</p>
          <div className="ai-feature-table" role="table" aria-label="Codex feature usage">
            <div className="ai-feature-row ai-feature-head" role="row"><span role="columnheader">Feature</span><span role="columnheader">Codex</span><span role="columnheader">Rule</span></div>
            {status.features.map((feature) => <div className="ai-feature-row" role="row" key={feature.id}><strong role="cell">{feature.label}</strong><span role="cell" className={feature.usesCodex ? "uses-ai" : "no-ai"}>{feature.usesCodex ? "Used" : "Not used"}</span><span role="cell">{feature.condition}</span></div>)}
          </div>
          <div className="ai-privacy-note"><Cpu size={18} /><span>The browser receives a sanitized event stream. No local Codex CLI history is retained, and the isolated runtime home is deleted after the turn. Provider handling follows the configured OpenAI account.</span></div>
        </details>
      </div>}
    </div>
  );
}
