import type { ThreadEvent } from "@openai/codex-sdk";

const SECRET_KEY_PATTERN = /(?:^|_)(?:access_?token|api_?key|authorization(?:_?header)?|client_?secret|cookie|password|refresh_?token|secret)(?:$|_)/i;

export function sanitizeCodexText(value: unknown, limit = 12_000) {
  const text = String(value ?? "")
    .replace(/(bearer\s+)[a-z0-9._~+/-]+=*/gi, "$1[redacted]")
    .replace(/\b(?:sk|sb)(?:-proj)?[_-][a-z0-9_-]{10,}\b/gi, "[redacted]")
    .replace(/([?&](?:access_?token|api_?key|auth|password|secret)=)[^&\s]+/gi, "$1[redacted]");
  return text.length <= limit ? text : `${text.slice(0, limit)}\n[truncated after ${limit} characters]`;
}

export function sanitizeCodexValue(value: unknown, key = "", depth = 0): unknown {
  if (SECRET_KEY_PATTERN.test(key)) return "[redacted]";
  if (typeof value === "string") return sanitizeCodexText(value);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 6) return "[maximum detail depth reached]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeCodexValue(item, "", depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([entryKey, entryValue]) => [entryKey, sanitizeCodexValue(entryValue, entryKey, depth + 1)])
    );
  }
  return sanitizeCodexText(value);
}

export function sanitizeCodexEvent(event: ThreadEvent, sequence: number) {
  const base = { type: event.type, sequence, occurredAt: new Date().toISOString() };
  if (event.type === "thread.started") return { ...base, threadId: event.thread_id };
  if (event.type === "turn.started") return base;
  if (event.type === "turn.completed") return { ...base, usage: event.usage };
  if (event.type === "turn.failed") return { ...base, message: sanitizeCodexText(event.error.message) };
  if (event.type === "error") return { ...base, message: sanitizeCodexText(event.message) };

  const item = event.item;
  if (item.type === "reasoning") return { ...base, item: { id: item.id, type: item.type, text: sanitizeCodexText(item.text) } };
  if (item.type === "agent_message") return { ...base, item: { id: item.id, type: item.type, text: sanitizeCodexText(item.text) } };
  if (item.type === "command_execution") return { ...base, item: { id: item.id, type: item.type, command: sanitizeCodexText(item.command), aggregatedOutput: sanitizeCodexText(item.aggregated_output), status: item.status, exitCode: item.exit_code } };
  if (item.type === "file_change") return { ...base, item: { id: item.id, type: item.type, changes: sanitizeCodexValue(item.changes), status: item.status } };
  if (item.type === "mcp_tool_call") return { ...base, item: { id: item.id, type: item.type, server: sanitizeCodexText(item.server), tool: sanitizeCodexText(item.tool), arguments: sanitizeCodexValue(item.arguments), result: sanitizeCodexValue(item.result), status: item.status, error: sanitizeCodexText(item.error?.message) } };
  if (item.type === "web_search") return { ...base, item: { id: item.id, type: item.type, query: sanitizeCodexText(item.query) } };
  if (item.type === "todo_list") return { ...base, item: { id: item.id, type: item.type, items: sanitizeCodexValue(item.items) } };
  return { ...base, item: { id: item.id, type: item.type, message: sanitizeCodexText(item.message) } };
}

type ItemEvent = Extract<ThreadEvent, { type: "item.started" | "item.updated" | "item.completed" }>;

function isItemEvent(event: ThreadEvent): event is ItemEvent {
  return event.type === "item.started" || event.type === "item.updated" || event.type === "item.completed";
}

export function codexTraceSummary(events: ThreadEvent[]) {
  const itemEvents = events.filter(isItemEvent);
  const toolEvents = itemEvents.filter((event) => ["command_execution", "mcp_tool_call", "web_search"].includes(event.item.type));
  const fileEvents = itemEvents.filter((event) => event.item.type === "file_change");
  return {
    events: events.map((event, index) => sanitizeCodexEvent(event, index + 1)),
    toolsUsed: [...new Set(toolEvents.map((event) => event.item.type))],
    filesChanged: [...new Set(fileEvents.flatMap((event) => event.item.type === "file_change" ? event.item.changes.map((change) => change.path) : []))]
  };
}
