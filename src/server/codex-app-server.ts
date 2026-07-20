import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import type {
  Input,
  ModelReasoningEffort,
  ThreadEvent,
  ThreadItem,
  ThreadOptions,
  TurnOptions,
  Usage
} from "@openai/codex-sdk";

type JsonRecord = Record<string, unknown>;

export interface CodexAccountInfo {
  type: string;
  email: string | null;
  planType: string | null;
}

export interface CodexAccountStatus {
  account: CodexAccountInfo | null;
  requiresOpenaiAuth: boolean;
}

interface AppServerTurn {
  items: ThreadItem[];
  finalResponse: string;
  usage: Usage | null;
}

interface QueuedEvent {
  event?: ThreadEvent;
  error?: Error;
  done?: boolean;
}

class EventQueue {
  private values: QueuedEvent[] = [];
  private waiters: Array<(value: QueuedEvent) => void> = [];

  push(value: QueuedEvent) {
    const waiter = this.waiters.shift();
    if (waiter) waiter(value);
    else this.values.push(value);
  }

  async next() {
    const value = this.values.shift();
    if (value) return value;
    return await new Promise<QueuedEvent>((resolve) => this.waiters.push(resolve));
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function localCodexCliScript() {
  return createRequire(import.meta.url).resolve("@openai/codex/bin/codex.js");
}

function appServerInput(input: Input) {
  const entries = typeof input === "string" ? [{ type: "text" as const, text: input }] : input;
  return entries.map((entry) => entry.type === "text"
    ? { type: "text", text: entry.text, text_elements: [] }
    : { type: "localImage", path: entry.path });
}

function mapThreadItem(value: unknown) {
  if (!isRecord(value) || typeof value.type !== "string" || typeof value.id !== "string") return null;
  if (value.type === "agentMessage") return { id: value.id, type: "agent_message" as const, text: String(value.text ?? "") };
  if (value.type === "reasoning") {
    const summary = Array.isArray(value.summary) ? value.summary.map(String).join("\n") : "";
    return { id: value.id, type: "reasoning" as const, text: summary };
  }
  if (value.type === "plan") return { id: value.id, type: "todo_list" as const, items: [] };
  if (value.type === "webSearch") return { id: value.id, type: "web_search" as const, query: String(value.query ?? "") };
  if (value.type === "commandExecution") {
    return {
      id: value.id,
      type: "command_execution" as const,
      command: String(value.command ?? ""),
      aggregated_output: String(value.aggregatedOutput ?? ""),
      exit_code: typeof value.exitCode === "number" ? value.exitCode : undefined,
      status: value.status === "completed" ? "completed" as const : value.status === "failed" ? "failed" as const : "in_progress" as const
    };
  }
  if (value.type === "fileChange") {
    return {
      id: value.id,
      type: "file_change" as const,
      changes: Array.isArray(value.changes) ? value.changes.map((change) => {
        const record = isRecord(change) ? change : {};
        return { path: String(record.path ?? ""), kind: record.kind === "add" || record.kind === "delete" ? record.kind : "update" as const };
      }) : [],
      status: value.status === "failed" ? "failed" as const : "completed" as const
    };
  }
  return null;
}

function usageFromNotification(params: unknown): Usage | null {
  if (!isRecord(params) || !isRecord(params.tokenUsage) || !isRecord(params.tokenUsage.last)) return null;
  const usage = params.tokenUsage.last;
  return {
    input_tokens: Number(usage.inputTokens ?? 0),
    cached_input_tokens: Number(usage.cachedInputTokens ?? 0),
    output_tokens: Number(usage.outputTokens ?? 0),
    reasoning_output_tokens: Number(usage.reasoningOutputTokens ?? 0)
  };
}

export class CodexAppServer {
  private process: ChildProcessWithoutNullStreams | null = null;
  private initialized: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private turnQueues = new Map<string, EventQueue>();
  private earlyTurnEvents = new Map<string, QueuedEvent[]>();
  private turnUsage = new Map<string, Usage>();
  private stderr = "";

  constructor(private readonly options: { env: Record<string, string>; config?: JsonRecord }) {}

  startThread(options: ThreadOptions = {}) {
    return new AppServerThread(this, options);
  }

  async readAccount(): Promise<CodexAccountStatus> {
    await this.ensureInitialized();
    const result = await this.request("account/read", {});
    const response = isRecord(result) ? result : {};
    const account = isRecord(response.account) ? response.account : null;
    return {
      account: account ? {
        type: String(account.type ?? "unknown"),
        email: typeof account.email === "string" ? account.email : null,
        planType: typeof account.planType === "string" ? account.planType : null
      } : null,
      requiresOpenaiAuth: response.requiresOpenaiAuth === true
    };
  }

  async close() {
    const process = this.process;
    this.process = null;
    this.initialized = null;
    if (!process || process.killed) return;
    process.kill();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (!process.killed) process.kill("SIGKILL");
        resolve();
      }, 1_500);
      process.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  private async ensureInitialized() {
    if (this.initialized) return this.initialized;
    this.initialized = this.start();
    return this.initialized;
  }

  private async start() {
    const child = spawn(process.execPath, [localCodexCliScript(), "app-server", "--stdio"], {
      env: { ...this.options.env, ELECTRON_RUN_AS_NODE: "1", CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "pilot_princess_desktop" },
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.process = child;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${String(chunk)}`.slice(-8_000);
    });
    child.once("exit", (code) => {
      const error = new Error(`Codex app-server exited${code == null ? "" : ` with code ${code}`}.${this.stderr ? ` ${this.stderr.trim()}` : ""}`);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      for (const queue of this.turnQueues.values()) queue.push({ error });
      this.turnQueues.clear();
    });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    await this.request("initialize", {
      clientInfo: { name: "pilot_princess", title: "Pilot Princess", version: "0.1.0" },
      capabilities: { experimentalApi: true, requestAttestation: false }
    });
    this.notify("initialized");
  }

  private handleLine(line: string) {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(message)) return;
    if (typeof message.id === "number" && ("result" in message || "error" in message) && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (isRecord(message.error)) pending.reject(new Error(String(message.error.message ?? "Codex app-server request failed.")));
      else pending.resolve(message.result);
      return;
    }
    if (typeof message.id === "number" && typeof message.method === "string") {
      this.respond(message.id, null, `Pilot Princess does not expose ${message.method} to student planning turns.`);
      return;
    }
    if (typeof message.method !== "string") return;
    const params = isRecord(message.params) ? message.params : {};
    const turnId = typeof params.turnId === "string"
      ? params.turnId
      : isRecord(params.turn) && typeof params.turn.id === "string"
        ? params.turn.id
        : null;
    if (message.method === "thread/tokenUsage/updated" && turnId) {
      const usage = usageFromNotification(params);
      if (usage) this.turnUsage.set(turnId, usage);
      return;
    }
    if (!turnId) return;
    const queue = this.turnQueues.get(turnId);
    const emit = (event: QueuedEvent) => {
      if (queue) queue.push(event);
      else {
        const buffered = this.earlyTurnEvents.get(turnId) ?? [];
        buffered.push(event);
        this.earlyTurnEvents.set(turnId, buffered);
      }
    };
    if (message.method === "item/started" || message.method === "item/completed") {
      const item = mapThreadItem(params.item);
      if (item) emit({ event: { type: message.method === "item/started" ? "item.started" : "item.completed", item } as ThreadEvent });
      return;
    }
    if (message.method === "turn/completed") {
      const turn = isRecord(params.turn) ? params.turn : {};
      if (turn.status === "failed") {
        const error = isRecord(turn.error) ? String(turn.error.message ?? "Codex turn failed.") : "Codex turn failed.";
        emit({ event: { type: "turn.failed", error: { message: error } } });
      } else {
        emit({ event: { type: "turn.completed", usage: this.turnUsage.get(turnId) ?? { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 } } });
      }
      emit({ done: true });
      if (queue) this.turnQueues.delete(turnId);
      this.turnUsage.delete(turnId);
    }
  }

  private notify(method: string, params?: unknown) {
    this.process?.stdin.write(`${JSON.stringify(params === undefined ? { method } : { method, params })}\n`);
  }

  private respond(id: number, result: unknown, error?: string) {
    this.process?.stdin.write(`${JSON.stringify(error ? { id, error: { code: -32601, message: error } } : { id, result })}\n`);
  }

  private async request(method: string, params: unknown) {
    if (method !== "initialize") await this.ensureInitialized();
    const id = this.nextId++;
    const result = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.process?.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return result;
  }

  async createThread(options: ThreadOptions) {
    await this.ensureInitialized();
    const result = await this.request("thread/start", {
      model: options.model ?? null,
      cwd: options.workingDirectory ?? null,
      approvalPolicy: "never",
      sandbox: "read-only",
      ephemeral: true,
      config: {
        ...(this.options.config ?? {}),
        history: { persistence: "none" },
        model_reasoning_summary: "concise",
        show_raw_agent_reasoning: false,
        hide_agent_reasoning: false,
        features: {
          apps: false,
          browser_use: false,
          code_mode: { enabled: false },
          computer_use: false,
          goals: false,
          hooks: false,
          image_generation: false,
          memories: false,
          multi_agent: false,
          plugins: false,
          remote_plugin: false,
          shell_tool: false,
          unified_exec: false,
          workspace_dependencies: false
        }
      }
    });
    if (!isRecord(result) || !isRecord(result.thread) || typeof result.thread.id !== "string") {
      throw new Error("Codex app-server did not return a thread ID.");
    }
    return result.thread.id;
  }

  async *runTurn(threadId: string, input: Input, options: TurnOptions & { effort?: ModelReasoningEffort }) {
    const started = await this.request("turn/start", {
      threadId,
      input: appServerInput(input),
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      effort: options.effort ?? null,
      summary: "concise",
      outputSchema: options.outputSchema ?? null
    });
    if (!isRecord(started) || !isRecord(started.turn) || typeof started.turn.id !== "string") {
      throw new Error("Codex app-server did not start the turn.");
    }
    const turnId = started.turn.id;
    const queue = new EventQueue();
    this.turnQueues.set(turnId, queue);
    for (const event of this.earlyTurnEvents.get(turnId) ?? []) queue.push(event);
    this.earlyTurnEvents.delete(turnId);
    yield { type: "thread.started", thread_id: threadId } satisfies ThreadEvent;
    yield { type: "turn.started" } satisfies ThreadEvent;
    const abort = () => { void this.request("turn/interrupt", { threadId, turnId }).catch(() => undefined); };
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      while (true) {
        const value = await queue.next();
        if (value.error) throw value.error;
        if (value.done) break;
        if (value.event) yield value.event;
      }
    } finally {
      options.signal?.removeEventListener("abort", abort);
      this.turnQueues.delete(turnId);
    }
  }
}

class AppServerThread {
  private threadId: string | null = null;

  constructor(private readonly server: CodexAppServer, private readonly options: ThreadOptions) {}

  get id() {
    return this.threadId;
  }

  async runStreamed(input: Input, options: TurnOptions = {}) {
    if (!this.threadId) this.threadId = await this.server.createThread(this.options);
    return { events: this.server.runTurn(this.threadId, input, { ...options, effort: this.options.modelReasoningEffort }) };
  }

  async run(input: Input, options: TurnOptions = {}): Promise<AppServerTurn> {
    const streamed = await this.runStreamed(input, options);
    const items: AppServerTurn["items"] = [];
    let finalResponse = "";
    let usage: Usage | null = null;
    let error: string | null = null;
    for await (const event of streamed.events) {
      if (event.type === "item.completed") {
        items.push(event.item);
        if (event.item.type === "agent_message") finalResponse = event.item.text;
      } else if (event.type === "turn.completed") usage = event.usage;
      else if (event.type === "turn.failed") error = event.error.message;
    }
    if (error) throw new Error(error);
    return { items, finalResponse, usage };
  }
}
