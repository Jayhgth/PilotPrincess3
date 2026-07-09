import {
  ArrowClockwiseIcon as ArrowClockwise,
  CheckCircleIcon as CheckCircle,
  CpuIcon as Cpu,
  PaperPlaneTiltIcon as PaperPlaneTilt,
  ShieldCheckIcon as ShieldCheck,
  WarningIcon as Warning
} from "@phosphor-icons/react";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState, type SyntheticEvent } from "react";

interface CodexFeatureStatus {
  id: string;
  label: string;
  usesCodex: boolean;
  condition: string;
}

interface CodexRuntimeStatus {
  configured: boolean;
  credentialMode: "server_api_key" | "local_codex_login";
  model: string;
  maxConcurrentTurns: number;
  features: CodexFeatureStatus[];
}

interface CodexTestResult {
  message: string;
  model?: string;
  latencyMs?: number;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
  latencyMs?: number;
}

const INITIAL_MESSAGE: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content: "Send a short message to test the live server connection. Each successful reply shows the model and response time."
};

export default function AiStatusPanel({ session }: { session: Session }) {
  const [status, setStatus] = useState<CodexRuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<CodexTestResult | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

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
        if (active) setError(caught instanceof Error ? caught.message : "AI connection details could not be loaded.");
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

  async function sendMessage(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setDraft("");
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.access_token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          messages: nextMessages.slice(-8).map(({ role, content: messageContent }) => ({ role, content: messageContent }))
        })
      });
      const payload = await response.json() as {
        reply?: string;
        model?: string;
        latencyMs?: number;
        error?: string;
      };
      if (!response.ok || !payload.reply) throw new Error(payload.error ?? "Codex did not return a chat reply.");
      setMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: "assistant",
        content: payload.reply!,
        model: payload.model,
        latencyMs: payload.latencyMs
      }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Codex diagnostics chat failed.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1>AI connection</h1>
          <p>Test a real Codex conversation and review exactly which product features use AI.</p>
        </div>
      </header>

      {loading && <div className="ai-status-loading" role="status">Loading server configuration</div>}
      {error && <div className="inline-alert error" role="alert"><Warning size={17} /> {error}</div>}

      {status && (
        <div className="ai-status-page">
          <section className="ai-runtime-strip" aria-label="Codex server configuration">
            <dl>
              <div><dt>Connection</dt><dd>{status.configured ? "Server API key" : "Local Codex login"}</dd></div>
              <div><dt>Model</dt><dd>{status.model}</dd></div>
              <div><dt>Capacity</dt><dd>{status.maxConcurrentTurns} concurrent requests</dd></div>
            </dl>
            <button className="secondary-button" type="button" onClick={() => void testConnection()} disabled={testing}>
              {testing ? <ArrowClockwise className="spin" size={16} /> : <Cpu size={16} />}
              {testing ? "Running check" : "Quick connection check"}
            </button>
          </section>

          {testResult && (
            <div className="inline-alert success ai-test-result" role="status">
              <CheckCircle size={18} weight="fill" />
              <span><strong>{testResult.message}</strong>{testResult.latencyMs !== undefined ? ` ${testResult.latencyMs} ms using ${testResult.model}.` : ""}</span>
            </div>
          )}

          <section className="ai-chat-section" aria-labelledby="ai-chat-title">
            <header>
              <h2 id="ai-chat-title">Live diagnostics chat</h2>
              <p>This sends an authenticated, server-side Codex request. It cannot read your records, files, or browser.</p>
            </header>
            <div className="ai-chat-log" aria-live="polite">
              {messages.map((message) => (
                <article className={`ai-chat-message ${message.role}`} key={message.id}>
                  <span>{message.role === "user" ? "You" : "Codex"}</span>
                  <p>{message.content}</p>
                  {message.model && <small>{message.model} responded in {message.latencyMs} ms</small>}
                </article>
              ))}
              {sending && <div className="ai-chat-pending" role="status"><ArrowClockwise className="spin" size={15} /> Waiting for Codex</div>}
            </div>
            <form className="ai-chat-form" onSubmit={sendMessage}>
              <label className="form-field">
                <span>Test message</span>
                <textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={1200} rows={3} placeholder="Ask what this connection test proves." />
              </label>
              <div><span>{draft.length} / 1200</span><button className="primary-button" type="submit" disabled={sending || !draft.trim()}><PaperPlaneTilt size={16} /> Send</button></div>
            </form>
          </section>

          <details className="ai-boundaries">
            <summary>Where Codex is used</summary>
            <p>Deterministic operations stay deterministic. Codex is limited to the tasks listed as used below.</p>
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
            <div className="ai-privacy-note"><ShieldCheck size={18} /><span>Credentials stay on the server. Uploaded source content is treated as untrusted data, with no web access and a read-only sandbox.</span></div>
          </details>
        </div>
      )}
    </>
  );
}
