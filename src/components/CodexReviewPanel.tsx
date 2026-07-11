import {
  ArrowRightIcon as ArrowRight,
  BrainIcon as Brain,
  CheckCircleIcon as CheckCircle,
  ClockIcon as Clock,
  CodeIcon as Code,
  FileTextIcon as FileText,
  ListChecksIcon as ListChecks,
  MagnifyingGlassIcon as MagnifyingGlass,
  ShieldCheckIcon as ShieldCheck,
  SparkleIcon as Sparkle,
  TerminalWindowIcon as TerminalWindow,
  WarningIcon as Warning
} from "@phosphor-icons/react";
import type { Session } from "@supabase/supabase-js";
import { useMemo, useState } from "react";
import AnimatedContent from "@/components/reactbits/AnimatedContent";
import ShinyText from "@/components/reactbits/ShinyText";
import type { PlanningReviewResult } from "@/server/ai-schemas";

export type ReviewFocus = "plan" | "gpa" | "activities" | "timeline" | "scenario" | "profile";
export type ReviewDestination = "courses" | "graduation" | "gpa" | "activities" | "timeline" | "simulator" | "profile";

interface TraceEvent {
  id: string;
  kind: "status" | "reasoning" | "todo" | "tool" | "file" | "response" | "error";
  label: string;
  detail?: string;
  state?: "running" | "complete" | "failed";
}

interface RunMeta {
  model: string;
  reasoningEffort: string;
  threadId: string | null;
  latencyMs: number | null;
  usage: { input_tokens: number; cached_input_tokens: number; output_tokens: number; reasoning_output_tokens: number } | null;
}

interface CodexReviewPanelProps {
  session: Session;
  focus: ReviewFocus;
  title: string;
  description: string;
  question: string;
  context: Record<string, unknown>;
  compact?: boolean;
  onNavigate?: (destination: ReviewDestination) => void;
}

const EMPTY_META: RunMeta = { model: "", reasoningEffort: "", threadId: null, latencyMs: null, usage: null };

function reasoningLabel(value: string, includeSdk = false) {
  if (!value) return "starting";
  if (value === "low") return includeSdk ? "Light (SDK: low)" : "light";
  return value;
}

function eventIcon(kind: TraceEvent["kind"]) {
  if (kind === "reasoning") return Brain;
  if (kind === "todo") return ListChecks;
  if (kind === "tool") return TerminalWindow;
  if (kind === "file") return FileText;
  if (kind === "response") return Sparkle;
  if (kind === "error") return Warning;
  return CheckCircle;
}

function traceFromSdk(payload: Record<string, unknown>): TraceEvent | null {
  const event = payload.event as Record<string, unknown> | undefined;
  if (!event) return null;
  const type = String(event.type ?? "");
  const item = event.item as Record<string, unknown> | undefined;
  if (type === "thread.started") return { id: "thread", kind: "status", label: "Secure review thread opened", state: "complete" };
  if (type === "turn.started") return { id: "turn", kind: "status", label: "Review started", state: "running" };
  if (type === "turn.completed") return { id: "turn", kind: "status", label: "Review complete", state: "complete" };
  if (type === "turn.failed" || type === "error") return { id: "turn-error", kind: "error", label: "Review failed", detail: String(event.message ?? "Unknown error"), state: "failed" };
  if (!item) return null;
  const itemType = String(item.type ?? "");
  const id = String(item.id ?? `${type}:${itemType}`);
  const state = type === "item.completed" ? "complete" : "running";
  if (itemType === "reasoning") return { id, kind: "reasoning", label: "Reasoning summary", detail: String(item.text ?? ""), state };
  if (itemType === "todo_list") {
    const todos = Array.isArray(item.items) ? item.items as Array<{ text?: string; completed?: boolean }> : [];
    return { id, kind: "todo", label: "Review plan", detail: todos.map((todo) => `${todo.completed ? "Done" : "Next"}: ${todo.text ?? ""}`).join("\n"), state };
  }
  if (itemType === "command_execution") return { id, kind: "tool", label: "Command", detail: String(item.command ?? ""), state };
  if (itemType === "mcp_tool_call") return { id, kind: "tool", label: `${String(item.server ?? "Tool")} / ${String(item.tool ?? "call")}`, detail: JSON.stringify(item.arguments ?? {}), state };
  if (itemType === "web_search") return { id, kind: "tool", label: "Web search", detail: String(item.query ?? ""), state };
  if (itemType === "file_change") {
    const changes = Array.isArray(item.changes) ? item.changes as Array<{ path?: string; kind?: string }> : [];
    return { id, kind: "file", label: "File changes", detail: changes.map((change) => `${change.kind ?? "update"}: ${change.path ?? ""}`).join("\n"), state };
  }
  if (itemType === "agent_message" && type === "item.completed") return { id, kind: "response", label: "Structured response prepared", state: "complete" };
  if (itemType === "error") return { id, kind: "error", label: "Codex error", detail: String(item.message ?? ""), state: "failed" };
  return null;
}

export default function CodexReviewPanel({
  session,
  focus,
  title,
  description,
  question,
  context,
  compact = false,
  onNavigate
}: CodexReviewPanelProps) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PlanningReviewResult | null>(null);
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [meta, setMeta] = useState<RunMeta>(EMPTY_META);
  const [error, setError] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [showTrace, setShowTrace] = useState(false);
  const [showInput, setShowInput] = useState(false);

  const contextLabels = useMemo(() => Object.keys(context).map((key) => key.replaceAll("_", " ")), [context]);
  const toolCount = trace.filter((event) => event.kind === "tool").length;
  const fileCount = trace.filter((event) => event.kind === "file").length;

  function upsertTrace(next: TraceEvent) {
    setTrace((current) => {
      const index = current.findIndex((event) => event.id === next.id);
      if (index < 0) return [...current, next];
      const updated = [...current];
      updated[index] = { ...current[index], ...next };
      return updated;
    });
  }

  async function runReview() {
    if (running) return;
    setRunning(true);
    setResult(null);
    setTrace([{ id: "connect", kind: "status", label: "Connecting to Codex", state: "running" }]);
    setMeta(EMPTY_META);
    setError(null);
    setInstruction("");
    setShowTrace(true);
    try {
      const response = await fetch("/api/ai/review", {
        method: "POST",
        headers: { authorization: `Bearer ${session.access_token}`, "content-type": "application/json" },
        body: JSON.stringify({ focus, question, context })
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? "The review could not start.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const payload = JSON.parse(line) as Record<string, unknown>;
          if (payload.kind === "run.started") {
            upsertTrace({ id: "connect", kind: "status", label: "Connected with read-only access", state: "complete" });
            setInstruction(String(payload.instruction ?? ""));
            setMeta((current) => ({ ...current, model: String(payload.model ?? ""), reasoningEffort: String(payload.reasoningEffort ?? "") }));
          } else if (payload.kind === "sdk.event") {
            const next = traceFromSdk(payload);
            if (next) upsertTrace(next);
          } else if (payload.kind === "run.completed") {
            setResult(payload.result as PlanningReviewResult);
            setMeta({
              model: String(payload.model ?? ""),
              reasoningEffort: String(payload.reasoningEffort ?? ""),
              threadId: typeof payload.threadId === "string" ? payload.threadId : null,
              latencyMs: typeof payload.latencyMs === "number" ? payload.latencyMs : null,
              usage: payload.usage as RunMeta["usage"]
            });
          } else if (payload.kind === "run.failed") {
            throw new Error(String(payload.message ?? "The review failed."));
          }
        }
        if (done) break;
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The review failed.";
      setError(message);
      upsertTrace({ id: "client-error", kind: "error", label: "Review stopped", detail: message, state: "failed" });
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className={`codex-review-panel ${compact ? "compact" : ""}`} aria-labelledby={`codex-review-${focus}`}>
      <div className="codex-review-intro">
        <span className="codex-review-mark"><Sparkle size={17} weight="fill" aria-hidden /> Optional AI review</span>
        <div>
          <h2 id={`codex-review-${focus}`}>{title}</h2>
          <p>{description}</p>
        </div>
        <button className="codex-review-run" type="button" onClick={() => void runReview()} disabled={running}>
          {running ? <><span className="codex-run-pulse" aria-hidden /><ShinyText text="Reviewing saved data" disabled={false} speed={1.6} /></> : <><Sparkle size={17} /> Run transparent review</>}
        </button>
      </div>

      <div className="codex-review-boundary">
        <ShieldCheck size={16} aria-hidden />
        <span>Uses only this snapshot: {contextLabels.join(", ") || "no saved fields"}. No browser, files, network, or automatic changes.</span>
      </div>

      {(running || trace.length > 0) && (
        <div className="codex-run-console" aria-live="polite">
          <button className="codex-run-console-toggle" type="button" onClick={() => setShowTrace((value) => !value)} aria-expanded={showTrace}>
            <span>{running ? "Codex is working" : error ? "Review stopped" : `Worked for ${meta.latencyMs ? `${(meta.latencyMs / 1000).toFixed(1)}s` : "this review"}`}</span>
            <small>{toolCount} tools · {fileCount} files · {meta.reasoningEffort ? `${reasoningLabel(meta.reasoningEffort)} reasoning` : "starting"}</small>
          </button>
          {showTrace && <div className="codex-trace-list">
            {trace.map((event) => {
              const EventIcon = eventIcon(event.kind);
              return <div className={`codex-trace-row ${event.state ?? ""}`} key={event.id}>
                <EventIcon size={15} aria-hidden />
                <div><strong>{event.label}</strong>{event.detail && <pre>{event.detail}</pre>}</div>
                {event.state === "running" && <span className="codex-run-dot" aria-label="Running" />}
              </div>;
            })}
            {!running && toolCount === 0 && <div className="codex-trace-row quiet"><TerminalWindow size={15} /><div><strong>No tools used</strong><span>This review stayed inside the supplied snapshot.</span></div></div>}
            {!running && fileCount === 0 && <div className="codex-trace-row quiet"><FileText size={15} /><div><strong>No files changed</strong><span>Suggested actions remain proposals until you choose one.</span></div></div>}
          </div>}
        </div>
      )}

      {error && <div className="inline-alert error" role="alert"><Warning size={17} /> {error}</div>}

      {result && <AnimatedContent className="codex-review-result">
        <p className="codex-review-summary">{result.summary}</p>
        {result.findings.length > 0 && <div className="codex-findings">
          {result.findings.map((finding) => <article className={finding.priority} key={`${finding.title}-${finding.evidence}`}>
            <span>{finding.priority === "attention" ? "Needs attention" : finding.priority === "consider" ? "Consider" : "Looks clear"}</span>
            <h3>{finding.title}</h3>
            <p>{finding.detail}</p>
            <small><MagnifyingGlass size={13} /> {finding.evidence}</small>
          </article>)}
        </div>}
        {result.proposed_actions.length > 0 && <div className="codex-actions">
          <h3>Reviewable next actions</h3>
          {result.proposed_actions.map((action) => <button key={`${action.destination}-${action.label}`} type="button" onClick={() => onNavigate?.(action.destination)} disabled={!onNavigate}>
            <span><strong>{action.label}</strong><small>{action.why}</small></span><ArrowRight size={16} />
          </button>)}
        </div>}
        {(result.questions.length > 0 || result.limitations.length > 0) && <div className="codex-review-notes">
          {result.questions.length > 0 && <div><h3>Questions worth resolving</h3><ul>{result.questions.map((questionItem) => <li key={questionItem}>{questionItem}</li>)}</ul></div>}
          {result.limitations.length > 0 && <div><h3>Limits</h3><ul>{result.limitations.map((limit) => <li key={limit}>{limit}</li>)}</ul></div>}
        </div>}
      </AnimatedContent>}

      {(instruction || meta.model) && <details className="codex-run-inspector" open={showInput} onToggle={(event) => setShowInput(event.currentTarget.open)}>
        <summary><Code size={15} /> Inspect prompt and run data</summary>
        <div className="codex-run-inspector-body">
          <dl>
            <div><dt>Model</dt><dd>{meta.model || "Pending"}</dd></div>
            <div><dt>Reasoning</dt><dd>{meta.reasoningEffort ? reasoningLabel(meta.reasoningEffort, true) : "Pending"}</dd></div>
            <div><dt>Duration</dt><dd>{meta.latencyMs ? `${(meta.latencyMs / 1000).toFixed(1)} seconds` : "Pending"}</dd></div>
            <div><dt>Thread</dt><dd>{meta.threadId ?? "Pending"}</dd></div>
            <div><dt>Input tokens</dt><dd>{meta.usage?.input_tokens ?? "Pending"}</dd></div>
            <div><dt>Output tokens</dt><dd>{meta.usage?.output_tokens ?? "Pending"}</dd></div>
          </dl>
          <div className="codex-exact-input"><strong>Exact feature instruction and snapshot</strong><pre>{instruction || JSON.stringify(context, null, 2)}</pre></div>
          <p><Clock size={14} /> Reasoning rows are summaries provided by Codex. Hidden chain-of-thought is never requested or displayed.</p>
        </div>
      </details>}
    </section>
  );
}
