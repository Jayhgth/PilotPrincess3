import {
  ArrowClockwiseIcon as ArrowClockwise,
  CheckCircleIcon as CheckCircle,
  CpuIcon as Cpu,
  ShieldCheckIcon as ShieldCheck,
  WarningIcon as Warning
} from "@phosphor-icons/react";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

interface CodexFeatureStatus {
  id: string;
  label: string;
  usesCodex: boolean;
  condition: string;
}

interface CodexRuntimeStatus {
  configured: boolean;
  credentialMode: "server_api_key" | "local_codex_login";
  localAuthFallbackAvailable: boolean;
  model: string;
  maxConcurrentTurns: number;
  features: CodexFeatureStatus[];
}

interface CodexTestResult {
  ok: boolean;
  message: string;
  model?: string;
  latencyMs?: number;
  testedAt?: string;
}

export default function AiStatusPanel({ session }: { session: Session }) {
  const [status, setStatus] = useState<CodexRuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<CodexTestResult | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/ai/health", {
      headers: { authorization: `Bearer ${session.access_token}` }
    })
      .then(async (response) => {
        const payload = await response.json() as CodexRuntimeStatus & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? "AI status could not be loaded.");
        if (active) setStatus(payload);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "AI status could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [session.access_token]);

  async function testConnection() {
    setTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const response = await fetch("/api/ai/test", {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.access_token}`,
          "content-type": "application/json"
        },
        body: "{}"
      });
      const payload = await response.json() as CodexTestResult & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Codex connection test failed.");
      setTestResult(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Codex connection test failed.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1>AI status</h1>
          <p>See where Codex is used, how the server is configured, and whether a real request succeeds.</p>
        </div>
      </header>

      {loading && <div className="ai-status-loading" role="status"><ArrowClockwise className="spin" size={17} /> Loading server configuration</div>}
      {error && <div className="inline-alert error" role="alert"><Warning size={17} /> {error}</div>}

      {status && (
        <div className="ai-status-layout">
          <section className="content-section ai-runtime" aria-labelledby="ai-runtime-title">
            <header className="section-heading">
              <div>
                <h2 id="ai-runtime-title">Server runtime</h2>
                <p>Credentials remain server-side. This page never receives a key.</p>
              </div>
            </header>
            <dl className="ai-runtime-list">
              <div><dt>Credential mode</dt><dd>{status.credentialMode === "server_api_key" ? "Server API key" : "Local Codex login"}</dd></div>
              <div><dt>Model</dt><dd>{status.model}</dd></div>
              <div><dt>Concurrent turns</dt><dd>{status.maxConcurrentTurns}</dd></div>
              <div><dt>Configuration</dt><dd>{status.configured ? "Server key configured" : "No server key; local login will be attempted"}</dd></div>
            </dl>
            <button className="primary-button ai-test-button" type="button" onClick={() => void testConnection()} disabled={testing}>
              {testing ? <ArrowClockwise className="spin" size={17} /> : <Cpu size={17} />}
              {testing ? "Testing connection" : "Run connection test"}
            </button>
            {testResult && (
              <div className="inline-alert success ai-test-result" role="status">
                <CheckCircle size={18} weight="fill" />
                <span><strong>{testResult.message}</strong>{testResult.latencyMs !== undefined ? ` ${testResult.latencyMs} ms using ${testResult.model}.` : ""}</span>
              </div>
            )}
          </section>

          <section className="content-section ai-feature-section" aria-labelledby="ai-feature-title">
            <header className="section-heading">
              <div>
                <h2 id="ai-feature-title">Feature boundaries</h2>
                <p>Deterministic operations stay deterministic. Codex is used only where language or image understanding adds value.</p>
              </div>
            </header>
            <div className="ai-feature-table" role="table" aria-label="Codex feature usage">
              <div className="ai-feature-row ai-feature-head" role="row"><span role="columnheader">Feature</span><span role="columnheader">Codex</span><span role="columnheader">Rule</span></div>
              {status.features.map((feature) => (
                <div className="ai-feature-row" role="row" key={feature.id}>
                  <strong role="cell">{feature.label}</strong>
                  <span role="cell" className={feature.usesCodex ? "uses-ai" : "no-ai"}>{feature.usesCodex ? "Used" : "Not used"}</span>
                  <span role="cell">{feature.condition}</span>
                </div>
              ))}
            </div>
            <div className="ai-privacy-note"><ShieldCheck size={18} weight="duotone" /><span>Uploaded source content is treated as untrusted data. Codex runs server-side with no web access and a read-only sandbox.</span></div>
          </section>
        </div>
      )}
    </>
  );
}
