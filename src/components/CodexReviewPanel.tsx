import {
  ArrowRightIcon as ArrowRight,
  BrainIcon as Brain,
  CheckCircleIcon as CheckCircle,
  ClockIcon as Clock,
  CodeIcon as Code,
  DownloadSimpleIcon as DownloadSimple,
  FileTextIcon as FileText,
  ListChecksIcon as ListChecks,
  ShieldCheckIcon as ShieldCheck,
  SparkleIcon as Sparkle,
  TerminalWindowIcon as TerminalWindow,
  WarningIcon as Warning
} from "@phosphor-icons/react";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useMemo, useRef, useState } from "react";
import AnimatedContent from "@/components/reactbits/AnimatedContent";
import ShinyText from "@/components/reactbits/ShinyText";
import type { PlanningReviewResult } from "@/server/ai-schemas";

export type ReviewFocus = "plan" | "gpa" | "activities" | "timeline" | "scenario" | "profile" | "connection";
export type ReviewDestination = "courses" | "graduation" | "gpa" | "activities" | "timeline" | "simulator" | "profile";

interface RuntimeCapability {
  id: string;
  label: string;
  state: "available" | "available_if_emitted" | "disabled";
  detail: string;
}

export interface AuditEvent {
  source: "application" | "sdk";
  type: string;
  sequence: number;
  occurredAt: string;
  item?: Record<string, unknown>;
  [key: string]: unknown;
}

interface RunMeta {
  model: string;
  reasoningEffort: string;
  threadId: string | null;
  latencyMs: number | null;
  executionLatencyMs: number | null;
  usage: { input_tokens: number; cached_input_tokens: number; output_tokens: number; reasoning_output_tokens: number } | null;
}

interface ActivityGroup {
  id: string;
  kind: "status" | "reasoning" | "todo" | "tool" | "file" | "response" | "error";
  label: string;
  detail: string;
  state: "running" | "complete" | "failed";
  events: AuditEvent[];
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

const EMPTY_META: RunMeta = { model: "", reasoningEffort: "", threadId: null, latencyMs: null, executionLatencyMs: null, usage: null };

function reasoningLabel(value: string, includeSdk = false) {
  if (!value) return "Pending";
  if (value === "low") return includeSdk ? "Light (SDK: low)" : "Light";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function jsonDetail(value: unknown) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export function activityProjection(event: AuditEvent) {
  const item = event.item;
  const itemType = String(item?.type ?? "");
  const lifecycle = event.type;
  const itemStatus = String(item?.status ?? "");
  const state: ActivityGroup["state"] = itemStatus === "failed" || lifecycle.includes("failed") || lifecycle === "error" || itemType === "error"
    ? "failed"
    : itemStatus === "completed" || lifecycle === "item.completed" || lifecycle === "turn.completed" || lifecycle === "thread.started" || lifecycle === "run.completed"
      ? "complete"
      : "running";

  if (itemType === "reasoning") return { kind: "reasoning" as const, label: "Reasoning summary", detail: jsonDetail(item?.text), state };
  if (itemType === "todo_list") return { kind: "todo" as const, label: "Agent task list", detail: jsonDetail(item?.items), state };
  if (itemType === "command_execution") {
    const parts = [jsonDetail(item?.command), jsonDetail(item?.aggregatedOutput)].filter(Boolean);
    return { kind: "tool" as const, label: "Command execution", detail: parts.join("\n\n"), state };
  }
  if (itemType === "mcp_tool_call") {
    const name = `${String(item?.server ?? "MCP")} / ${String(item?.tool ?? "tool")}`;
    const parts = [jsonDetail(item?.arguments), jsonDetail(item?.result), jsonDetail(item?.error)].filter(Boolean);
    return { kind: "tool" as const, label: name, detail: parts.join("\n\n"), state };
  }
  if (itemType === "web_search") return { kind: "tool" as const, label: "Web search", detail: jsonDetail(item?.query), state };
  if (itemType === "file_change") return { kind: "file" as const, label: "File changes", detail: jsonDetail(item?.changes), state };
  if (itemType === "agent_message") return { kind: "response" as const, label: "Agent output", detail: jsonDetail(item?.text), state };
  if (itemType === "error") return { kind: "error" as const, label: "Codex error", detail: jsonDetail(item?.message), state: "failed" as const };
  if (lifecycle === "thread.started") return { kind: "status" as const, label: "Secure thread opened", detail: jsonDetail(event.threadId), state };
  if (lifecycle === "turn.started") return { kind: "status" as const, label: "Turn started", detail: "", state };
  if (lifecycle === "turn.completed") return { kind: "status" as const, label: "Turn completed", detail: jsonDetail(event.usage), state };
  if (lifecycle === "run.started") return { kind: "status" as const, label: "Review request accepted", detail: "", state };
  if (lifecycle === "run.completed") return { kind: "status" as const, label: "Structured result validated", detail: "", state };
  return { kind: lifecycle.includes("failed") || lifecycle === "error" ? "error" as const : "status" as const, label: lifecycle.replaceAll(".", " "), detail: jsonDetail(event.message), state };
}

function groupAuditEvents(events: AuditEvent[]) {
  const groups = new Map<string, ActivityGroup>();
  for (const event of events) {
    const itemId = typeof event.item?.id === "string" ? event.item.id : null;
    const id = itemId
      ? `item:${itemId}`
      : event.type.startsWith("turn.")
        ? "turn"
        : event.source === "application" && event.type.startsWith("run.")
          ? "run"
          : `${event.source}:${event.type}`;
    const projection = activityProjection(event);
    const current = groups.get(id);
    groups.set(id, {
      id,
      ...projection,
      events: current ? [...current.events, event] : [event]
    });
  }
  return [...groups.values()];
}

function ActivityIcon({ kind }: { kind: ActivityGroup["kind"] }) {
  if (kind === "reasoning") return <Brain size={15} aria-hidden />;
  if (kind === "todo") return <ListChecks size={15} aria-hidden />;
  if (kind === "tool") return <TerminalWindow size={15} aria-hidden />;
  if (kind === "file") return <FileText size={15} aria-hidden />;
  if (kind === "response") return <Sparkle size={15} aria-hidden />;
  if (kind === "error") return <Warning size={15} aria-hidden />;
  return <CheckCircle size={15} aria-hidden />;
}

function RawEventDetails({ events }: { events: AuditEvent[] }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="codex-raw-event" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Sanitized event data</summary>
      {open && <pre>{JSON.stringify(events, null, 2)}</pre>}
    </details>
  );
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
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [capabilities, setCapabilities] = useState<RuntimeCapability[]>([]);
  const [meta, setMeta] = useState<RunMeta>(EMPTY_META);
  const [error, setError] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [activeTab, setActiveTab] = useState<"answer" | "activity" | "input">("answer");
  const [exactInputOpen, setExactInputOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const contextLabels = useMemo(() => Object.keys(context).map((key) => key.replaceAll("_", " ")), [context]);
  const activityGroups = useMemo(() => groupAuditEvents(events), [events]);
  const toolCount = activityGroups.filter((event) => event.kind === "tool").length;
  const fileCount = activityGroups.filter((event) => event.kind === "file").length;
  const toolsDisabled = capabilities.find((capability) => capability.id === "tools")?.state === "disabled";
  const filesDisabled = capabilities.find((capability) => capability.id === "files")?.state === "disabled";
  const elapsedLabel = meta.latencyMs ? `${(meta.latencyMs / 1000).toFixed(1)}s` : running ? "Live" : "Not run";

  async function runReview() {
    if (running) return;
    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;
    setRunning(true);
    setResult(null);
    setEvents([]);
    setCapabilities([]);
    setMeta(EMPTY_META);
    setError(null);
    setInstruction("");
    setExactInputOpen(false);
    setActiveTab("activity");

    let queue: AuditEvent[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    const flushEvents = () => {
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      if (!queue.length) return;
      const batch = queue;
      queue = [];
      setEvents((current) => [...current, ...batch]);
    };
    const enqueueEvent = (event: AuditEvent) => {
      queue.push(event);
      if (!flushTimer) flushTimer = setTimeout(flushEvents, 40);
    };

    try {
      const response = await fetch("/api/ai/review", {
        method: "POST",
        headers: { authorization: `Bearer ${session.access_token}`, "content-type": "application/json" },
        body: JSON.stringify({ focus, question, context }),
        signal: abortController.signal
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? "The review could not start.");
      }
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const consume = (line: string) => {
        if (!line.trim()) return;
        const payload = JSON.parse(line) as Record<string, unknown>;
        if (payload.kind === "run.started") {
          setInstruction(String(payload.instruction ?? ""));
          setCapabilities(Array.isArray(payload.capabilities) ? payload.capabilities as RuntimeCapability[] : []);
          setMeta((current) => ({ ...current, model: String(payload.model ?? ""), reasoningEffort: String(payload.reasoningEffort ?? "") }));
          enqueueEvent({ source: "application", type: "run.started", sequence: Number(payload.sequence ?? 0), occurredAt: String(payload.occurredAt ?? new Date().toISOString()) });
        } else if (payload.kind === "sdk.event") {
          enqueueEvent({ source: "sdk", ...(payload.event as Record<string, unknown>) } as AuditEvent);
        } else if (payload.kind === "run.completed") {
          enqueueEvent({ source: "application", type: "run.completed", sequence: Number(payload.sequence ?? 0), occurredAt: String(payload.occurredAt ?? new Date().toISOString()) });
          setResult(payload.result as PlanningReviewResult);
          setMeta({
            model: String(payload.model ?? ""),
            reasoningEffort: String(payload.reasoningEffort ?? ""),
            threadId: typeof payload.threadId === "string" ? payload.threadId : null,
            latencyMs: typeof payload.latencyMs === "number" ? payload.latencyMs : null,
            executionLatencyMs: typeof payload.executionLatencyMs === "number" ? payload.executionLatencyMs : null,
            usage: payload.usage as RunMeta["usage"]
          });
          setRunning(false);
          setActiveTab("answer");
        } else if (payload.kind === "run.failed") {
          throw new Error(String(payload.message ?? "The review failed."));
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) consume(line);
        if (done) {
          consume(buffer);
          break;
        }
      }
      flushEvents();
    } catch (caught) {
      await reader?.cancel().catch(() => undefined);
      if (abortController.signal.aborted) {
        enqueueEvent({ source: "application", type: "run.cancelled", sequence: Date.now(), occurredAt: new Date().toISOString() });
        flushEvents();
        return;
      }
      const message = caught instanceof Error ? caught.message : "The review failed.";
      setError(message);
      enqueueEvent({ source: "application", type: "run.failed", sequence: Date.now(), occurredAt: new Date().toISOString(), message });
      flushEvents();
    } finally {
      if (flushTimer) clearTimeout(flushTimer);
      flushEvents();
      setRunning(false);
      if (abortRef.current === abortController) abortRef.current = null;
    }
  }

  function downloadRunRecord() {
    const record = {
      exportedAt: new Date().toISOString(),
      focus,
      instruction: instruction || JSON.stringify(context),
      result,
      events,
      capabilities,
      runtime: meta
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `pilot-princess-codex-${focus}-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className={`codex-review-panel ${compact ? "compact" : ""}`} aria-labelledby={`codex-review-${focus}`}>
      <div className="codex-review-intro">
        <div>
          <h2 id={`codex-review-${focus}`}>{title}</h2>
          <p>{description}</p>
        </div>
        <button className="codex-review-run" type="button" onClick={() => running ? abortRef.current?.abort() : void runReview()}>
          {running ? <><span className="codex-run-pulse" aria-hidden /><ShinyText text="Cancel review" disabled={false} speed={1.6} /></> : <><Sparkle size={17} /> {result ? "Run again" : "Review with Codex"}</>}
        </button>
      </div>

      {!events.length && !running && (
        <p className="codex-review-boundary"><ShieldCheck size={16} aria-hidden /> Sends only {contextLabels.join(", ") || "the supplied snapshot"} to OpenAI Codex. No tools, network, files, skills, plugins, subagents, or automatic plan changes.</p>
      )}

      {(events.length > 0 || running || result || error) && (
        <div className="codex-run-workspace" aria-live="polite">
          <div className="codex-run-summary">
            <span>{running ? <ShinyText text="Codex is working" speed={1.8} /> : error ? "Review stopped" : result ? "Review complete" : "Review cancelled"}</span>
            <small>{elapsedLabel}, {toolCount ? `${toolCount} tool events` : toolsDisabled ? "tools disabled" : "no tool events"}, {fileCount ? `${fileCount} file events` : filesDisabled ? "files disabled" : "no file events"}</small>
          </div>
          <div className="codex-run-tabs" role="tablist" aria-label="Codex review details">
            <button type="button" role="tab" aria-selected={activeTab === "answer"} className={activeTab === "answer" ? "active" : ""} onClick={() => setActiveTab("answer")} disabled={!result}>Answer</button>
            <button type="button" role="tab" aria-selected={activeTab === "activity"} className={activeTab === "activity" ? "active" : ""} onClick={() => setActiveTab("activity")}>Activity <span>{events.length}</span></button>
            <button type="button" role="tab" aria-selected={activeTab === "input"} className={activeTab === "input" ? "active" : ""} onClick={() => setActiveTab("input")}>Run details</button>
          </div>

          {activeTab === "answer" && result && (
            <AnimatedContent className="codex-review-result" role="tabpanel">
              <p className="codex-review-answer">{result.answer}</p>
              {result.observations.length > 0 && <div className="codex-observation-list">
                {result.observations.map((observation) => <article className={observation.kind} key={`${observation.label}-${observation.evidence}`}>
                  <div><span>{observation.kind === "attention" ? "Needs attention" : observation.kind === "consider" ? "Consider" : "Looks clear"}</span><strong>{observation.label}</strong><p>{observation.detail}</p></div>
                  <small>{observation.evidence}</small>
                </article>)}
              </div>}
              {result.next_action && <button className="codex-next-action" type="button" onClick={() => onNavigate?.(result.next_action!.destination)} disabled={!onNavigate}>
                <span><strong>{result.next_action.label}</strong><small>{result.next_action.why}</small></span><ArrowRight size={16} />
              </button>}
              <p className="codex-verification-note"><ShieldCheck size={15} /> {result.verification_note}</p>
            </AnimatedContent>
          )}

          {activeTab === "activity" && (
            <div className="codex-activity-panel" role="tabpanel">
              {activityGroups.map((group) => <details className={`codex-activity-row ${group.state}`} key={group.id} open={group.state === "running" || group.state === "failed"}>
                <summary><ActivityIcon kind={group.kind} /><span><strong>{group.label}</strong><small>{group.events.length > 1 ? `${group.events.length} lifecycle events` : group.events[0]?.type}</small></span><em>{group.state}</em></summary>
                <div>
                  {group.detail && <pre>{group.detail}</pre>}
                  <RawEventDetails events={group.events} />
                </div>
              </details>)}
              {!activityGroups.length && <p className="codex-activity-empty"><Clock size={15} /> Waiting for the first SDK event.</p>}
            </div>
          )}

          {activeTab === "input" && (
            <div className="codex-run-inspector-body" role="tabpanel">
              <dl>
                <div><dt>Model</dt><dd>{meta.model || "Pending"}</dd></div>
                <div><dt>Reasoning</dt><dd>{reasoningLabel(meta.reasoningEffort, true)}</dd></div>
                <div><dt>Total duration</dt><dd>{meta.latencyMs ? `${(meta.latencyMs / 1000).toFixed(1)} seconds` : "Pending"}</dd></div>
                <div><dt>Codex execution</dt><dd>{meta.executionLatencyMs ? `${(meta.executionLatencyMs / 1000).toFixed(1)} seconds` : "Pending"}</dd></div>
                <div><dt>Queue wait</dt><dd>{meta.latencyMs !== null && meta.executionLatencyMs !== null ? `${(Math.max(0, meta.latencyMs - meta.executionLatencyMs) / 1000).toFixed(1)} seconds` : "Pending"}</dd></div>
                <div><dt>Thread</dt><dd>{meta.threadId ?? "Pending"}</dd></div>
                <div><dt>Input tokens</dt><dd>{meta.usage?.input_tokens ?? "Pending"}</dd></div>
                <div><dt>Output tokens</dt><dd>{meta.usage?.output_tokens ?? "Pending"}</dd></div>
              </dl>
              {capabilities.length > 0 && <div className="codex-capability-list"><h3>Runtime access</h3>{capabilities.map((capability) => <div key={capability.id}><span><strong>{capability.label}</strong><small>{capability.detail}</small></span><em>{capability.state === "disabled" ? "Disabled" : capability.state === "available" ? "Available" : "If emitted"}</em></div>)}</div>}
              <details className="codex-exact-input" onToggle={(event) => setExactInputOpen(event.currentTarget.open)}><summary><Code size={15} /> Exact feature instruction and snapshot</summary>{exactInputOpen && <pre>{instruction || JSON.stringify(context, null, 2)}</pre>}</details>
              {result && <button className="codex-run-export" type="button" onClick={downloadRunRecord}><DownloadSimple size={15} /> Download this sanitized run record</button>}
              <p><Brain size={14} /> Reasoning entries are summaries supplied by Codex. Hidden chain-of-thought is never requested or displayed.</p>
            </div>
          )}
        </div>
      )}

      {error && <div className="inline-alert error" role="alert"><Warning size={17} /> {error}</div>}
    </section>
  );
}
