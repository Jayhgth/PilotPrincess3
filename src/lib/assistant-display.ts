export interface AssistantTimingEvent {
  type: string;
  occurredAt?: unknown;
  latencyMs?: unknown;
}

function timestamp(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatAssistantDuration(durationMs: number) {
  const elapsedSeconds = Math.max(0, Math.floor(durationMs / 1000));
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`;

  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function assistantTurnStartedAt(events: readonly AssistantTimingEvent[]) {
  const started = events.find((event) => event.type === "turn.started");
  return timestamp(started?.occurredAt) === null ? null : String(started?.occurredAt);
}

export function assistantTurnDuration(events: readonly AssistantTimingEvent[]) {
  const completed = [...events].reverse().find((event) => event.type === "turn.completed");
  const suppliedLatency = completed?.latencyMs;
  if (typeof suppliedLatency === "number" && Number.isFinite(suppliedLatency) && suppliedLatency >= 0) {
    return formatAssistantDuration(suppliedLatency);
  }

  const startedAt = timestamp(events.find((event) => event.type === "turn.started")?.occurredAt);
  const endedAt = timestamp([...events].reverse().find((event) => event.type === "turn.completed" || event.type === "turn.failed" || event.type === "turn.cancelled")?.occurredAt);
  if (startedAt === null || endedAt === null) return null;
  return formatAssistantDuration(Math.max(0, endedAt - startedAt));
}
