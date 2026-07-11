import type { AiToolCall } from "@/lib/models";

export interface AssistantQuestion {
  id: string;
  prompt: string;
  options: Array<{ id: string; label: string }>;
  allow_custom: boolean;
}

const DRAFT_PREFIX = "pilot-princess:assistant-draft";

export function assistantDraftKey(userId: string, conversationId: string | null) {
  return `${DRAFT_PREFIX}:${userId}:${conversationId ?? "new"}`;
}

export function assistantQuestionsFromContext(context: Record<string, unknown>): AssistantQuestion[] {
  if (!Array.isArray(context.questions)) return [];
  return context.questions.slice(0, 3).filter((question): question is AssistantQuestion => {
    if (!question || typeof question !== "object" || Array.isArray(question)) return false;
    const value = question as Record<string, unknown>;
    return typeof value.id === "string"
      && typeof value.prompt === "string"
      && typeof value.allow_custom === "boolean"
      && Array.isArray(value.options)
      && value.options.length >= 2
      && value.options.length <= 4
      && value.options.every((option) => option && typeof option === "object" && !Array.isArray(option) && typeof (option as Record<string, unknown>).id === "string" && typeof (option as Record<string, unknown>).label === "string");
  });
}

export function formatStructuredAnswers(questions: AssistantQuestion[], answers: Record<string, string>) {
  return [
    "Here are my answers:",
    ...questions.map((question) => `- **${question.prompt}** ${answers[question.id] ?? "No answer"}`)
  ].join("\n");
}

export function visibleToolCalls(tools: AiToolCall[], expanded: boolean, limit = 2) {
  const pending = tools.filter((tool) => tool.status === "pending_confirmation");
  const settled = tools.filter((tool) => tool.status !== "pending_confirmation");
  if (expanded || settled.length <= limit) return { visible: tools, hiddenCount: 0 };
  const visibleIds = new Set([...pending, ...settled.slice(-limit)].map((tool) => tool.id));
  return {
    visible: tools.filter((tool) => visibleIds.has(tool.id)),
    hiddenCount: tools.length - visibleIds.size
  };
}

export interface ChangeDetail {
  label: string;
  value: string;
}

function humanizeKey(key: string) {
  return key.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function readableValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(readableValue).filter(Boolean).join(", ");
  const text = typeof value === "object" ? JSON.stringify(value) : String(value).replaceAll("_", " ");
  return text.length > 180 ? `${text.slice(0, 177)}…` : text;
}

export function changeDetailsFromContext(context: Record<string, unknown>): ChangeDetail[] {
  const data = context.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  return Object.entries(data as Record<string, unknown>)
    .map(([key, value]) => ({ label: humanizeKey(key), value: readableValue(value) }))
    .filter((entry): entry is ChangeDetail => Boolean(entry.value))
    .slice(0, 8);
}

export function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

export function formatMessageTimeTitle(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
