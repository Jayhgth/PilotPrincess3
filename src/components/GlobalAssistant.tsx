import {
  ArchiveIcon as Archive,
  ArrowUpIcon as ArrowUp,
  BrainIcon as Brain,
  CaretDownIcon as CaretDown,
  ChatCircleDotsIcon as ChatCircleDots,
  CheckIcon as Check,
  CheckCircleIcon as CheckCircle,
  ClockIcon as Clock,
  CopyIcon as Copy,
  CpuIcon as Cpu,
  ImageIcon as Image,
  PaperclipIcon as Paperclip,
  PaperPlaneRightIcon as PaperPlaneRight,
  PencilSimpleIcon as PencilSimple,
  PlusIcon as Plus,
  ShieldCheckIcon as ShieldCheck,
  StopIcon as Stop,
  ArrowCounterClockwiseIcon as ArrowCounterClockwise,
  WrenchIcon as Wrench,
  WarningIcon as Warning,
  XIcon as X
} from "@phosphor-icons/react";
import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from "react";
import FadeContent from "@/components/reactbits/FadeContent";
import ShinyText from "@/components/reactbits/ShinyText";
import AssistantMarkdown from "@/components/AssistantMarkdown";
import AiModelPicker from "@/components/AiModelPicker";
import type { AiModel, AiReasoningEffort } from "@/lib/ai-preferences";
import { MAX_ASSISTANT_ATTACHMENTS, validateAssistantImage } from "@/lib/ai-attachments";
import { assistantTurnDuration, assistantTurnStartedAt, formatAssistantDuration } from "@/lib/assistant-display";
import { asAssistantRecord, assistantDockedMaxWidth, assistantDraftKey, assistantQuestionsFromContext, changeDetailsFromContext, formatMessageTime, formatMessageTimeTitle, formatStructuredAnswers, prioritizeAssistantQueue, visibleToolCalls, type AssistantQuestion } from "@/lib/assistant-chat";
import type { AiConversation, AiEvent, AiMessage, AiToolCall } from "@/lib/models";
import { authenticatedFetch } from "@/lib/supabase/authenticated-fetch";
import type { WorkspaceDomain } from "@/lib/app-capabilities";
import styles from "./GlobalAssistant.module.css";

interface GlobalAssistantProps {
  session: Session;
  open: boolean;
  preferences: {
    enabled: boolean;
    model: AiModel;
    reasoningEffort: AiReasoningEffort;
  };
  onPreferencesChanged: () => void | Promise<void>;
  onClose: () => void;
  onDataChanged: (domains?: WorkspaceDomain[]) => void | Promise<void>;
}

interface ConversationPayload {
  conversations: AiConversation[];
  activeConversation: AiConversation | null;
  messages: AiMessage[];
  events: AiEvent[];
  toolCalls: AiToolCall[];
}

type LiveActivity = Record<string, unknown> & {
  source: "application" | "sdk";
  type: string;
  sequence: number;
  occurredAt: string;
};

interface ComposerImage {
  id: string;
  file: File;
  previewUrl: string;
}

interface QueuedMessage {
  id: string;
  content: string;
  images: ComposerImage[];
  context: Record<string, unknown>;
}

interface SendMessageOptions {
  context?: Record<string, unknown>;
  images?: ComposerImage[];
  conversation?: AiConversation;
  queueItem?: QueuedMessage;
  clearComposerDraft?: boolean;
}

const PANEL_WIDTH_KEY = "pilot-princess:assistant-width";
const DEFAULT_PANEL_WIDTH = 420;
const MIN_PANEL_WIDTH = 360;
const MAX_PANEL_WIDTH = 680;
const MIN_WORKSPACE_WITH_SIDEBAR = 1080;
const MAX_QUEUED_MESSAGES = 5;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function loadStoredNumber(key: string, fallback: number) {
  if (typeof window === "undefined") return fallback;
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) ? value : fallback;
}

const EMPTY_PAYLOAD: ConversationPayload = {
  conversations: [],
  activeConversation: null,
  messages: [],
  events: [],
  toolCalls: []
};

const ASSISTANT_SUGGESTIONS = [
  "What should I focus on next?",
  "Check whether my full plan is balanced.",
  "What can you help me change?"
];

function MessageImages({ message, onPreview }: { message: AiMessage; onPreview: (image: { url: string; name: string }) => void }) {
  if (!message.attachments?.length) return null;
  return <div className={`${styles.messageImages} ${message.attachments.length === 1 ? styles.singleImage : ""}`}>
    {message.attachments.map((attachment) => <button type="button" key={attachment.id} onClick={() => onPreview({ url: attachment.preview_url, name: attachment.name })} aria-label={`Preview ${attachment.name}`}>
      {attachment.preview_url ? <img src={attachment.preview_url} alt={attachment.name} /> : <span><Image size={20} /> Preview unavailable</span>}
    </button>)}
  </div>;
}

function MessageActions({ message, align = "left", canRetry = false, onRetry }: { message: AiMessage; align?: "left" | "right"; canRetry?: boolean; onRetry?: () => void }) {
  const [copied, setCopied] = useState(false);
  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard availability depends on the browser security context.
    }
  }
  return <div className={`${styles.messageActions} ${align === "right" ? styles.messageActionsRight : ""}`}>
    <time dateTime={message.created_at} title={formatMessageTimeTitle(message.created_at)}>{formatMessageTime(message.created_at)}</time>
    <button type="button" onClick={() => void copyMessage()} aria-label={copied ? "Message copied" : "Copy message"} title={copied ? "Copied" : "Copy message"}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>
    {canRetry && onRetry && <button type="button" onClick={onRetry} aria-label="Retry response" title="Send this prompt again as a new turn"><ArrowCounterClockwise size={13} /></button>}
  </div>;
}

function StructuredQuestions({ questions, answered, willQueue, onSubmit }: { questions: AssistantQuestion[]; answered: boolean; willQueue: boolean; onSubmit: (answers: Record<string, string>) => Promise<boolean> }) {
  const [answers, setAnswers] = useState<Record<string, string>>(() => Object.fromEntries(questions.flatMap((question) => {
    const recommended = question.options.find((option) => option.label.includes("(Recommended)"));
    return recommended ? [[question.id, recommended.label]] : [];
  })));
  const [submitting, setSubmitting] = useState(false);
  const [queued, setQueued] = useState(false);
  const complete = questions.every((question) => Boolean(answers[question.id]?.trim()));
  async function submit() {
    if (!complete || answered || submitting || queued) return;
    setSubmitting(true);
    try {
      const accepted = await onSubmit(answers);
      if (accepted && willQueue) setQueued(true);
    } finally {
      setSubmitting(false);
    }
  }
  return <section className={styles.questionSet} aria-label="Pilot questions">
    {questions.map((question) => <fieldset key={question.id} disabled={answered || submitting || queued}>
      <legend>{question.prompt}</legend>
      <div className={styles.questionOptions}>{question.options.map((option) => <button type="button" key={option.id} className={answers[question.id] === option.label ? styles.selectedQuestionOption : ""} onClick={() => setAnswers((current) => ({ ...current, [question.id]: option.label }))}>{option.label}</button>)}</div>
      {question.allow_custom && <input value={question.options.some((option) => option.label === answers[question.id]) ? "" : answers[question.id] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} placeholder="Or write your answer" aria-label={`Custom answer: ${question.prompt}`} />}
    </fieldset>)}
    <button className={styles.submitAnswers} type="button" onClick={() => void submit()} disabled={!complete || answered || submitting || queued}>{answered ? "Answered" : queued ? "Queued" : submitting ? (willQueue ? "Queuing" : "Sending") : questions.length > 1 ? "Send answers" : "Send answer"}</button>
  </section>;
}

function ChangeReceipt({ message, busy, onUndo }: { message: AiMessage; busy: boolean; onUndo: (message: AiMessage) => void }) {
  const context = asAssistantRecord(message.page_context);
  const details = changeDetailsFromContext(context);
  const toolName = String(context.tool_name ?? "student data");
  const undone = typeof context.undone_at === "string";
  const canUndo = context.undo_available === true && typeof context.tool_call_id === "string" && !undone;
  return <FadeContent className={`${styles.changeReceipt} ${undone ? styles.changeUndone : ""}`} duration={0.16}>
    <div><CheckCircle size={16} weight="fill" /><span><strong>{undone ? "Change undone" : "Change applied"}</strong><small>{friendlyToolLabel(toolName)}</small></span></div>
    <p>{message.content}</p>
    {!undone && details.length > 0 && <dl>{details.map((detail, index) => <div key={`${detail.label}-${index}`}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl>}
    {canUndo && <div className={styles.changeReceiptActions}><button type="button" onClick={() => onUndo(message)} disabled={busy}><ArrowCounterClockwise size={13} />{busy ? "Undoing" : "Undo change"}</button></div>}
  </FadeContent>;
}

const TOOL_LABELS: Record<string, string> = {
  get_student_overview: "Student overview",
  get_academic_context: "Academic workspace",
  list_plan_courses: "Course plan",
  search_california_high_schools: "California high schools",
  search_course_catalog: "Course catalog",
  get_graduation_progress: "Graduation progress",
  get_transcript_sources: "Transcript sources",
  get_student_data_inventory: "Student records",
  audit_transcript_data: "Transcript audit",
  get_gpa_evidence: "GPA evidence",
  evaluate_gpa_scenario: "GPA scenario",
  get_gpa_scenario: "Saved GPA scenario",
  get_enrollment_constraints: "College unit limits",
  get_course_schedule_options: "Course schedule options",
  get_prerequisite_evidence: "Prerequisite evidence",
  get_degree_progress: "Degree progress",
  get_college_goal: "Degree bookmarks",
  search_smccd_programs: "College programs",
  set_current_school: "Change selected school",
  undo_change: "Undo previous change",
  add_course_schedule: "Apply course schedule",
  add_dtech_course: "Add high school course",
  add_smccd_course: "Add college course",
  add_academic_courses: "Add academic course plan",
  move_plan_course: "Move course",
  move_plan_courses: "Move courses",
  remove_plan_course: "Remove course",
  remove_plan_courses: "Remove courses",
  update_plan_course: "Update course",
  sort_plan_courses: "Sort course plan",
  update_gpa_scenario: "Update GPA scenario",
  update_enrollment_preference: "Update college enrollment type",
  update_student_settings: "Update student settings",
  submit_shared_data_correction: "Submit shared data correction",
  correct_transcript_course: "Correct transcript course",
  save_prerequisite_evidence: "Submit prerequisite evidence",
  create_plan_snapshot: "Save plan snapshot",
  set_smccd_ge_completion: "Update college degree completion",
  set_college_goal: "Bookmark degree",
  clear_college_goal: "Remove degree bookmark",
  clear_academic_plan: "Clear academic plan"
};

function friendlyToolLabel(name: string) {
  return TOOL_LABELS[name] ?? name.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function humanizeActivityText(value: unknown) {
  let text = String(value ?? "").replaceAll("**", "").replaceAll("`", "").trim();
  for (const [slug, label] of Object.entries(TOOL_LABELS)) text = text.replaceAll(slug, label.toLowerCase());
  text = text
    .replace(/^Reading tool ['"]?(.+?)['"]?$/i, "Reading $1")
    .replace(/^Waiting for tool response\.?$/i, "Checking saved records")
    .replace(/^Mutating proposal only\.?$/i, "Preparing an exact change")
    .replace(/^Calling tool ['"]?(.+?)['"]?$/i, "Checking $1");
  return text;
}

function toolSummary(call: AiToolCall) {
  const safetyReview = (call.result as { safety_review?: { summary?: unknown } } | null)?.safety_review;
  const undone = call.result as { undone_at?: unknown; undo_summary?: unknown } | null;
  if (call.status === "completed" && undone?.undone_at) return String(undone.undo_summary ?? "Change undone");
  if (call.status === "completed") return String((call.result as { summary?: unknown } | null)?.summary ?? "Completed");
  if (call.status === "failed") return String((call.result as { error?: unknown } | null)?.error ?? "The tool failed.");
  if (call.status === "rejected") return String(safetyReview?.summary ?? "Not applied");
  if (call.status === "pending_confirmation") return "Safety review queued";
  return "Running";
}

function readableArguments(call: AiToolCall) {
  const entries = Object.entries(call.arguments).filter(([, value]) => value !== null && value !== "");
  return entries.map(([key, value]) => {
    if (key === "course_ids" && Array.isArray(value)) return { label: "Courses", value: `${value.length} selected ${value.length === 1 ? "course" : "courses"}` };
    if (key === "include_college_courses") return { label: "College courses", value: value === true ? "Included" : "Excluded" };
    if (typeof value === "boolean") return { label: key.replaceAll("_", " "), value: value ? "Yes" : "No" };
    if (Array.isArray(value)) return { label: key.replaceAll("_", " "), value: value.map((item) => String(item).replaceAll("_", " ")).join(", ") || "None" };
    if (typeof value === "object") return { label: key.replaceAll("_", " "), value: "Structured details validated" };
    return { label: key.replaceAll("_", " "), value: String(value).replaceAll("_", " ") };
  });
}

function ToolCallRow({ call, busy }: { call: AiToolCall; busy: boolean }) {
  const pending = call.status === "pending_confirmation";
  const label = friendlyToolLabel(call.tool_name);
  if (pending) {
    return (
      <FadeContent className={styles.approvalCard} duration={0.16}>
        <div className={styles.approvalHeading}><ShieldCheck size={16} /><div><strong>{busy ? "Reviewing change" : "Change queued"}</strong><span>{label}</span></div></div>
        <p>{call.explanation}</p>
        <dl>{readableArguments(call).map((entry) => <div key={entry.label}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>)}</dl>
      </FadeContent>
    );
  }
  return (
    <details className={`${styles.workRow} ${call.status === "failed" || call.status === "rejected" ? styles.failed : ""}`} open={call.status === "rejected" || undefined}>
      <summary><span className={styles.workIcon}>{call.status === "completed" ? <CheckCircle size={15} /> : call.status === "failed" || call.status === "rejected" ? <Warning size={15} /> : <Wrench size={15} />}</span><span><strong>{label}</strong><small>{toolSummary(call)}</small></span><CaretDown size={13} /></summary>
      <div className={styles.workDetails}><p>{call.explanation}</p>{readableArguments(call).length > 0 && <dl>{readableArguments(call).map((entry) => <div key={entry.label}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>)}</dl>}</div>
    </details>
  );
}

function activityItem(event: LiveActivity) {
  if (event.type === "attachments.received") return { kind: "image", label: "Image context", detail: String(event.summary ?? "Student-provided images were added to this turn") };
  if (event.type === "knowledge.retrieved") return { kind: "tool", label: "Planning guidance", detail: String(event.summary ?? "Retrieved relevant application guidance") };
  if (event.type === "knowledge.failed") return { kind: "tool", label: "Planning guidance", detail: "Built-in guidance used because retrieved guidance was unavailable" };
  if (event.type === "memory.retrieved") return { kind: "tool", label: "Student context", detail: String(event.summary ?? "Retrieved relevant preferences") };
  if (event.type === "memory.updated") return { kind: "tool", label: "Student context", detail: String(event.summary ?? "Updated lightweight preferences") };
  if (event.type === "safety_review.started" || event.type === "auto_review.started") return { kind: "review", label: "Safety review", detail: String(event.summary ?? "Checking the proposed change") };
  if (event.type === "safety_review.completed" || event.type === "auto_review.completed") {
    const review = event.review as Record<string, unknown> | undefined;
    return { kind: "review", label: "Safety review", detail: String(review?.summary ?? "Review completed") };
  }
  const toolCall = event.toolCall as Record<string, unknown> | undefined;
  if (toolCall) {
    const status = String(toolCall.status ?? "running");
    const result = toolCall.result as Record<string, unknown> | undefined;
    return {
      kind: status === "failed" ? "error" : "tool",
      label: friendlyToolLabel(String(toolCall.tool_name ?? toolCall.label ?? "Student data tool")),
      detail: status === "running"
        ? humanizeActivityText(toolCall.explanation ?? "Reading your saved plan")
        : humanizeActivityText(result?.summary ?? toolCall.error ?? (status === "pending_confirmation" ? "Waiting for confirmation" : "Completed"))
    };
  }
  const item = event.item as Record<string, unknown> | undefined;
  const itemType = String(item?.type ?? "");
  if (itemType === "reasoning") return { kind: "reasoning", label: "Reasoning", detail: humanizeActivityText(item?.text) };
  if (itemType === "todo_list") return { kind: "plan", label: "Working plan", detail: JSON.stringify(item?.items ?? []) };
  if (itemType === "command_execution") return { kind: "tool", label: "Command", detail: String(item?.command ?? "") };
  if (itemType === "mcp_tool_call") return { kind: "tool", label: `${String(item?.server ?? "Tool")} ${String(item?.tool ?? "call")}`, detail: "" };
  if (itemType === "web_search") return { kind: "tool", label: "Web search", detail: String(item?.query ?? "") };
  if (itemType === "file_change") return { kind: "tool", label: "File changes", detail: JSON.stringify(item?.changes ?? []) };
  if (event.type === "turn.cancelled") return { kind: "stopped", label: "Response stopped", detail: String(event.message ?? "Stopped by the student") };
  if (event.type === "turn.failed" || itemType === "error") return { kind: "error", label: "Assistant stopped", detail: String(event.message ?? item?.message ?? "") };
  return null;
}

function LiveElapsed({ startedAt }: { startedAt: string }) {
  const textRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const startedAtMs = Date.parse(startedAt);
    const update = () => {
      if (textRef.current) textRef.current.textContent = formatAssistantDuration(Date.now() - startedAtMs);
    };
    update();
    const interval = window.setInterval(update, 1000);
    return () => window.clearInterval(interval);
  }, [startedAt]);
  return <span ref={textRef} className={styles.turnDuration}>0s</span>;
}

function TurnActivity({ events, tools, running, reviewing }: {
  events: LiveActivity[];
  tools: AiToolCall[];
  running: boolean;
  reviewing: boolean;
}) {
  const [showAllTools, setShowAllTools] = useState(false);
  const items = events.map(activityItem).filter((item): item is NonNullable<ReturnType<typeof activityItem>> => Boolean(item));
  const hasFailure = items.some((item) => item.kind === "error") || tools.some((tool) => tool.status === "failed");
  const hasRejectedChange = tools.some((tool) => tool.status === "rejected");
  const wasCancelled = items.some((item) => item.kind === "stopped");
  const hasPendingChange = tools.some((tool) => tool.status === "pending_confirmation");
  const forceOpen = running || hasFailure || hasRejectedChange || hasPendingChange;
  const startedAt = assistantTurnStartedAt(events);
  const duration = assistantTurnDuration(events);
  if (!items.length && !tools.length && !running) return null;
  const toolCount = tools.length;
  const groupedTools = visibleToolCalls(tools, showAllTools);
  return (
    <details className={styles.turnWork} key={forceOpen ? "active" : "settled"} open={forceOpen || undefined}>
      <summary><span className={styles.turnWorkLabel}>{running ? <><ShinyText text="Working" speed={1.8} />{startedAt && <> for <LiveElapsed startedAt={startedAt} /></>}</> : hasFailure || wasCancelled ? duration ? `Stopped after ${duration}` : "Work stopped" : duration ? `Worked for ${duration}` : toolCount ? `${toolCount} tool ${toolCount === 1 ? "call" : "calls"}` : "Reasoning"}{!running && duration && toolCount > 0 && <small> · {toolCount} tool {toolCount === 1 ? "call" : "calls"}</small>}</span><CaretDown size={13} /></summary>
      <div className={styles.turnWorkBody}>
        {items.map((item, index) => <details className={`${styles.workRow} ${item.kind === "error" ? styles.failed : ""}`} key={`${item.label}-${index}`} open={item.kind === "error"}>
          <summary><span className={styles.workIcon}>{item.kind === "reasoning" ? <Brain size={15} /> : item.kind === "review" ? <ShieldCheck size={15} /> : item.kind === "error" ? <Warning size={15} /> : <Clock size={15} />}</span><span><strong>{item.label}</strong>{item.detail && <small>{item.detail.slice(0, 110)}</small>}</span><CaretDown size={13} /></summary>
          {item.detail && <div className={styles.workDetails}><p>{item.detail}</p></div>}
        </details>)}
        {groupedTools.hiddenCount > 0 && <button className={styles.showMoreTools} type="button" onClick={() => setShowAllTools(true)}><CaretDown size={13} /> Show {groupedTools.hiddenCount} earlier tool {groupedTools.hiddenCount === 1 ? "call" : "calls"}</button>}
        {groupedTools.visible.map((tool) => <ToolCallRow key={tool.id} call={tool} busy={reviewing} />)}
        {showAllTools && tools.length > 2 && <button className={styles.showMoreTools} type="button" onClick={() => setShowAllTools(false)}><CaretDown size={13} className={styles.caretUp} /> Show fewer tool calls</button>}
      </div>
    </details>
  );
}

export default function GlobalAssistant({ session, open, preferences, onPreferencesChanged, onClose, onDataChanged }: GlobalAssistantProps) {
  const [data, setData] = useState<ConversationPayload>(EMPTY_PAYLOAD);
  const [liveEvents, setLiveEvents] = useState<LiveActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busyUndo, setBusyUndo] = useState<string | null>(null);
  const [reviewingChange, setReviewingChange] = useState(false);
  const [pendingModel, setPendingModel] = useState<AiModel | null>(null);
  const [savingModel, setSavingModel] = useState(false);
  const [images, setImages] = useState<ComposerImage[]>([]);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
  const [draggingImage, setDraggingImage] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);
  const [busyArchive, setBusyArchive] = useState<string | null>(null);
  const [renamingConversationId, setRenamingConversationId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [panelWidth, setPanelWidth] = useState(() => clamp(loadStoredNumber(PANEL_WIDTH_KEY, DEFAULT_PANEL_WIDTH), MIN_PANEL_WIDTH, typeof window === "undefined" ? MAX_PANEL_WIDTH : assistantDockedMaxWidth(window.innerWidth, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH, MIN_WORKSPACE_WITH_SIDEBAR)));
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const imagesRef = useRef<ComposerImage[]>([]);
  const queueRef = useRef<QueuedMessage[]>([]);
  const reviewedPendingRef = useRef<Set<string>>(new Set());
  const reviewBacklogRef = useRef(false);
  const dockResizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const activeId = data.activeConversation?.id ?? null;
  const selectedModel = pendingModel ?? preferences.model;

  const authorizedFetch = useCallback((url: string, init?: RequestInit) => authenticatedFetch(url, init), []);

  async function changeModel(model: AiModel) {
    if (model === selectedModel || savingModel || running) return;
    setPendingModel(model);
    setSavingModel(true);
    setError(null);
    try {
      const response = await authorizedFetch("/api/ai/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          enabled: true,
          model,
          reasoningEffort: preferences.reasoningEffort,
          approved: true
        })
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The model could not be changed.");
      await onPreferencesChanged();
      setPendingModel(null);
    } catch (caught) {
      setPendingModel(null);
      setError(caught instanceof Error ? caught.message : "The model could not be changed.");
    } finally {
      setSavingModel(false);
    }
  }

  const loadConversation = useCallback(async (conversationId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = conversationId ? `/api/ai/conversations?conversationId=${encodeURIComponent(conversationId)}` : "/api/ai/conversations";
      const response = await authorizedFetch(url);
      const payload = await response.json() as ConversationPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Conversation history could not be loaded.");
      setData(payload);
      setLiveEvents([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Conversation history could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [authorizedFetch]);

  const reviewToolCalls = useCallback(async (toolCallIds: string[]) => {
    let changed = false;
    const affectedDomains = new Set<WorkspaceDomain>();
    try {
      for (const toolCallId of toolCallIds) {
        const reviewResponse = await authorizedFetch("/api/ai/tool", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ toolCallId })
        });
        const reviewPayload = await reviewResponse.json() as { error?: string; applied?: boolean; toolCall?: AiToolCall; result?: { affected_domains?: WorkspaceDomain[] } };
        if (!reviewResponse.ok) throw new Error(reviewPayload.error ?? "The safety review could not complete.");
        if (reviewPayload.toolCall) {
          setData((current) => ({
            ...current,
            toolCalls: current.toolCalls.map((call) => call.id === reviewPayload.toolCall!.id ? reviewPayload.toolCall! : call)
          }));
        }
        changed ||= reviewPayload.applied === true;
        if (reviewPayload.applied) reviewPayload.result?.affected_domains?.forEach((domain) => affectedDomains.add(domain));
      }
    } finally {
      if (changed) await onDataChanged([...affectedDomains]);
    }
    return changed;
  }, [authorizedFetch, onDataChanged]);

  useEffect(() => {
    if (!open || !preferences.enabled) return;
    const loadTimer = window.setTimeout(() => void loadConversation(data.activeConversation?.id), 0);
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 180);
    return () => {
      window.clearTimeout(loadTimer);
      window.clearTimeout(focusTimer);
    };
  }, [open, preferences.enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || running || reviewBacklogRef.current) return;
    const pendingIds = data.toolCalls
      .filter((call) => call.status === "pending_confirmation" && !reviewedPendingRef.current.has(call.id))
      .map((call) => call.id);
    if (!pendingIds.length) return;
    pendingIds.forEach((id) => reviewedPendingRef.current.add(id));
    reviewBacklogRef.current = true;
    setReviewingChange(true);
    void reviewToolCalls(pendingIds)
      .then(() => loadConversation(data.activeConversation?.id))
      .catch((caught) => {
        pendingIds.forEach((id) => reviewedPendingRef.current.delete(id));
        setError(caught instanceof Error ? caught.message : "The safety review could not complete.");
      })
      .finally(() => {
        reviewBacklogRef.current = false;
        setReviewingChange(false);
      });
  }, [data.activeConversation?.id, data.toolCalls, loadConversation, open, reviewToolCalls, running]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDraft(window.localStorage.getItem(assistantDraftKey(session.user.id, activeId)) ?? ""), 0);
    return () => window.clearTimeout(timer);
  }, [activeId, session.user.id]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--assistant-panel-width", `${panelWidth}px`);
    window.localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth));
    return () => {
      root.style.removeProperty("--assistant-panel-width");
    };
  }, [panelWidth]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1440) return;
      setPanelWidth((current) => clamp(current, MIN_PANEL_WIDTH, assistantDockedMaxWidth(window.innerWidth, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH, MIN_WORKSPACE_WITH_SIDEBAR)));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || running) return;
      if (previewImage) setPreviewImage(null);
      else onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open, previewImage, running]);

  useEffect(() => { imagesRef.current = images; }, [images]);
  useEffect(() => { queueRef.current = queuedMessages; }, [queuedMessages]);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  }, [draft]);

  useEffect(() => () => {
    abortRef.current?.abort();
    for (const image of imagesRef.current) URL.revokeObjectURL(image.previewUrl);
    for (const queued of queueRef.current) for (const image of queued.images) URL.revokeObjectURL(image.previewUrl);
  }, []);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: running ? "smooth" : "auto" }));
    return () => cancelAnimationFrame(frame);
  }, [data.messages, data.toolCalls, liveEvents, open, running]);

  async function createConversation() {
    const response = await authorizedFetch("/api/ai/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    const payload = await response.json() as { conversation?: AiConversation; error?: string };
    if (!response.ok || !payload.conversation) throw new Error(payload.error ?? "A new conversation could not be created.");
    setData((current) => ({ ...current, conversations: [payload.conversation!, ...current.conversations], activeConversation: payload.conversation!, messages: [], events: [], toolCalls: [] }));
    setLiveEvents([]);
    setHistoryOpen(false);
    return payload.conversation;
  }

  function startNewConversation() {
    if (runningRef.current) return;
    setData((current) => ({
      ...current,
      activeConversation: null,
      messages: [],
      events: [],
      toolCalls: []
    }));
    setLiveEvents([]);
    setError(null);
    setHistoryOpen(false);
    setRenamingConversationId(null);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleDockResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !drawerRef.current) return;
    dockResizeRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: drawerRef.current.getBoundingClientRect().width };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.documentElement.dataset.assistantResizing = "true";
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function handleDockResizeMove(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = dockResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId || !drawerRef.current) return;
    const maxWidth = assistantDockedMaxWidth(window.innerWidth, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH, MIN_WORKSPACE_WITH_SIDEBAR);
    const width = clamp(resize.startWidth - (event.clientX - resize.startX), MIN_PANEL_WIDTH, maxWidth);
    drawerRef.current.style.width = `${width}px`;
    document.documentElement.style.setProperty("--assistant-panel-width", `${width}px`);
  }

  function handleDockResizeEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = dockResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const width = clamp(drawerRef.current?.getBoundingClientRect().width ?? panelWidth, MIN_PANEL_WIDTH, assistantDockedMaxWidth(window.innerWidth, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH, MIN_WORKSPACE_WITH_SIDEBAR));
    setPanelWidth(width);
    window.localStorage.setItem(PANEL_WIDTH_KEY, String(width));
    dockResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    delete document.documentElement.dataset.assistantResizing;
  }

  async function archiveConversation(conversationId: string) {
    if (running || busyArchive) return;
    const conversation = data.conversations.find((candidate) => candidate.id === conversationId);
    if (!conversation) return;
    const previousData = data;
    const remainingActive = data.conversations.filter((candidate) => candidate.id !== conversationId);
    const nextActive = data.activeConversation?.id === conversationId ? remainingActive[0] ?? null : data.activeConversation;

    setBusyArchive(conversationId);
    setError(null);
    setData((current) => ({
      ...current,
      conversations: current.conversations.filter((candidate) => candidate.id !== conversationId),
      ...(current.activeConversation?.id === conversationId
        ? { activeConversation: nextActive, messages: [], events: [], toolCalls: [] }
        : {})
    }));
    try {
      const response = await authorizedFetch("/api/ai/conversations", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, archived: true })
      });
      const payload = await response.json() as { conversation?: AiConversation; error?: string };
      if (!response.ok || !payload.conversation) throw new Error(payload.error ?? "The conversation could not be updated.");
      if (data.activeConversation?.id === conversationId && nextActive) await loadConversation(nextActive.id);
    } catch (caught) {
      setData(previousData);
      setError(caught instanceof Error ? caught.message : "The conversation could not be updated.");
    } finally {
      setBusyArchive(null);
    }
  }

  async function renameConversation(conversationId: string) {
    const title = renameDraft.trim();
    if (!title || savingRename) return;
    setSavingRename(true);
    setError(null);
    try {
      const response = await authorizedFetch("/api/ai/conversations", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, title })
      });
      const payload = await response.json() as { conversation?: AiConversation; error?: string };
      if (!response.ok || !payload.conversation) throw new Error(payload.error ?? "The conversation could not be renamed.");
      const renamed = payload.conversation;
      setData((current) => ({
        ...current,
        conversations: current.conversations.map((conversation) => conversation.id === renamed.id ? renamed : conversation),
        activeConversation: current.activeConversation?.id === renamed.id ? renamed : current.activeConversation
      }));
      setRenamingConversationId(null);
      setRenameDraft("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The conversation could not be renamed.");
    } finally {
      setSavingRename(false);
    }
  }

  function updateDraft(value: string) {
    setDraft(value);
    const key = assistantDraftKey(session.user.id, activeId);
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  }

  function commitQueue(next: QueuedMessage[]) {
    queueRef.current = next;
    setQueuedMessages(next);
  }

  function queueMessage(value?: string, context: Record<string, unknown> = {}) {
    const content = (value ?? draft).trim();
    const queuedImages = value === undefined ? images : [];
    if (!content && !queuedImages.length) return false;
    if (queueRef.current.length >= MAX_QUEUED_MESSAGES) {
      setError(`Pilot can hold up to ${MAX_QUEUED_MESSAGES} messages. Remove one before adding another.`);
      return false;
    }
    const queued: QueuedMessage = {
      id: crypto.randomUUID(),
      content,
      images: queuedImages,
      context
    };
    commitQueue([...queueRef.current, queued]);
    setError(null);
    if (value === undefined) {
      window.localStorage.removeItem(assistantDraftKey(session.user.id, activeId));
      setDraft("");
      setImages([]);
    }
    return true;
  }

  function removeQueuedMessage(id: string) {
    const queued = queueRef.current.find((message) => message.id === id);
    if (queued) for (const image of queued.images) URL.revokeObjectURL(image.previewUrl);
    commitQueue(queueRef.current.filter((message) => message.id !== id));
  }

  function runQueuedMessage(id: string) {
    const queued = queueRef.current.find((message) => message.id === id);
    if (!queued) return;
    const next = prioritizeAssistantQueue(queueRef.current, id);
    commitQueue(next);
    if (runningRef.current) {
      abortRef.current?.abort();
      return;
    }
    commitQueue(next.slice(1));
    void sendMessage(queued.content, {
      context: queued.context,
      images: queued.images,
      conversation: data.activeConversation ?? undefined,
      queueItem: queued,
      clearComposerDraft: false
    });
  }

  async function submitMessage(value?: string, context: Record<string, unknown> = {}) {
    if (runningRef.current) {
      return queueMessage(value, context);
    }
    await sendMessage(value, { context });
    return true;
  }

  function addImages(files: File[]) {
    const remaining = MAX_ASSISTANT_ATTACHMENTS - images.length;
    if (remaining <= 0) {
      setError(`You can attach up to ${MAX_ASSISTANT_ATTACHMENTS} images.`);
      return;
    }
    const accepted: ComposerImage[] = [];
    let validationError: string | null = files.length > remaining ? `You can attach up to ${MAX_ASSISTANT_ATTACHMENTS} images.` : null;
    for (const file of files.slice(0, remaining)) {
      const problem = validateAssistantImage(file);
      if (problem) {
        validationError ??= problem;
        continue;
      }
      accepted.push({ id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file) });
    }
    if (accepted.length) setImages((current) => [...current, ...accepted]);
    setError(validationError);
  }

  function removeImage(id: string) {
    setImages((current) => current.filter((image) => {
      if (image.id === id) URL.revokeObjectURL(image.previewUrl);
      return image.id !== id;
    }));
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pastedImages = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (!pastedImages.length) return;
    event.preventDefault();
    addImages(pastedImages);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDraggingImage(false);
    const droppedImages = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith("image/"));
    if (droppedImages.length) addImages(droppedImages);
  }

  async function sendMessage(value?: string, options: SendMessageOptions = {}) {
    const message = (value ?? draft).trim();
    const messageImages = options.images ?? (value === undefined ? images : []);
    if ((!message && !messageImages.length) || runningRef.current) return;
    const clearComposerDraft = options.clearComposerDraft ?? value === undefined;
    const messageContext = options.context ?? {};
    setError(null);
    if (clearComposerDraft) {
      window.localStorage.removeItem(assistantDraftKey(session.user.id, activeId));
      setDraft("");
      setImages([]);
    }
    runningRef.current = true;
    setRunning(true);
    const abortController = new AbortController();
    abortRef.current = abortController;
    let conversation = options.conversation ?? data.activeConversation;
    let optimisticId: string | null = null;
    let messagePersisted = false;
    try {
      if (!conversation) conversation = await createConversation();
      abortController.signal.throwIfAborted();
      const activeConversation = conversation;
      const turnId = crypto.randomUUID();
      optimisticId = `local-${turnId}`;
      const optimistic: AiMessage = {
        id: optimisticId,
        conversation_id: activeConversation.id,
        user_id: session.user.id,
        turn_id: turnId,
        role: "user",
        content: message,
        page_context: messageContext,
        created_at: new Date().toISOString(),
        attachments: messageImages.map((image) => ({
          id: image.id,
          conversation_id: activeConversation.id,
          message_id: optimisticId!,
          user_id: session.user.id,
          name: image.file.name,
          mime_type: image.file.type,
          size_bytes: image.file.size,
          preview_url: image.previewUrl,
          created_at: new Date().toISOString()
        }))
      };
      setData((current) => ({ ...current, messages: [...current.messages, optimistic] }));
      setLiveEvents([]);
      const form = new FormData();
      form.set("conversationId", activeConversation.id);
      form.set("turnId", turnId);
      form.set("message", message);
      for (const image of messageImages) form.append("images", image.file, image.file.name);
      const response = await authorizedFetch("/api/ai/chat", {
        method: "POST",
        body: form,
        signal: abortController.signal
      });
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? "Pilot could not start the conversation.");
      }
      messagePersisted = true;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const proposalIds: string[] = [];
      const consume = (line: string) => {
        if (!line.trim()) return;
        const payload = JSON.parse(line) as { kind: string; event?: LiveActivity; message?: string; proposals?: Array<{ id?: string }> };
        if (payload.kind === "activity" && payload.event) setLiveEvents((current) => [...current, payload.event!]);
        if (payload.kind === "turn.completed" && payload.proposals) proposalIds.push(...payload.proposals.map((proposal) => proposal.id).filter((id): id is string => Boolean(id)));
        if (payload.kind === "turn.failed") throw new Error(payload.message ?? "Pilot could not complete that request.");
      };
      while (true) {
        const { done, value: chunk } = await reader.read();
        buffer += decoder.decode(chunk ?? new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) consume(line);
        if (done) { consume(buffer); break; }
      }
      if (proposalIds.length) {
        setReviewingChange(true);
        proposalIds.forEach((id) => reviewedPendingRef.current.add(id));
        try {
          await reviewToolCalls(proposalIds);
        } catch (caught) {
          proposalIds.forEach((id) => reviewedPendingRef.current.delete(id));
          throw caught;
        }
      }
      await loadConversation(activeConversation.id);
      if (clearComposerDraft) window.localStorage.removeItem(assistantDraftKey(session.user.id, activeConversation.id));
      for (const image of messageImages) URL.revokeObjectURL(image.previewUrl);
      if (options.images === undefined) setImages([]);
    } catch (caught) {
      if (optimisticId) setData((current) => ({ ...current, messages: current.messages.filter((item) => item.id !== optimisticId) }));
      if (clearComposerDraft && !messagePersisted) {
        setDraft(message);
        setImages(messageImages);
        window.localStorage.setItem(assistantDraftKey(session.user.id, conversation?.id ?? activeId), message);
      }
      if (messagePersisted && conversation) {
        await loadConversation(conversation.id);
        if (clearComposerDraft) window.localStorage.removeItem(assistantDraftKey(session.user.id, conversation.id));
        for (const image of messageImages) URL.revokeObjectURL(image.previewUrl);
        if (options.images === undefined) setImages([]);
      }
      if (options.queueItem && !messagePersisted && !abortController.signal.aborted && !queueRef.current.some((queued) => queued.id === options.queueItem!.id)) {
        commitQueue([options.queueItem, ...queueRef.current]);
      }
      if (!(caught instanceof DOMException && caught.name === "AbortError")) setError(caught instanceof Error ? caught.message : "Pilot could not complete that request.");
    } finally {
      setReviewingChange(false);
      runningRef.current = false;
      setRunning(false);
      abortRef.current = null;
      if ((messagePersisted || abortController.signal.aborted) && conversation && queueRef.current.length) {
        const [next, ...remaining] = queueRef.current;
        commitQueue(remaining);
        void sendMessage(next.content, {
          context: next.context,
          images: next.images,
          conversation: conversation ?? undefined,
          queueItem: next,
          clearComposerDraft: false
        });
      }
    }
  }

  async function undoChange(message: AiMessage) {
    const toolCallId = String(asAssistantRecord(message.page_context).tool_call_id ?? "");
    if (!toolCallId) return;
    setBusyUndo(toolCallId);
    setError(null);
    try {
      const response = await authorizedFetch("/api/ai/undo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ toolCallId }) });
      const payload = await response.json() as { error?: string; affected_domains?: WorkspaceDomain[] };
      if (!response.ok) throw new Error(payload.error ?? "The change could not be undone.");
      await loadConversation(message.conversation_id);
      await onDataChanged(payload.affected_domains);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The change could not be undone.");
      await loadConversation(message.conversation_id);
    } finally {
      setBusyUndo(null);
    }
  }

  const events = useMemo(() => [
    ...data.events.map((event) => asAssistantRecord(event.payload) as LiveActivity),
    ...liveEvents
  ], [data.events, liveEvents]);
  const turnIds = data.messages.map((message) => message.turn_id).filter((id): id is string => Boolean(id));
  const latestTurnId = turnIds.at(-1) ?? null;
  const turnContent = (turnId: string) => {
    const tools = data.toolCalls.filter((call) => call.turn_id === turnId);
    const persistedToolIds = new Set(tools.map((tool) => tool.id));
    return {
      events: events.filter((event) => {
        if (String((event as { turnId?: unknown }).turnId ?? "") !== turnId) return false;
        const eventTool = event.toolCall as { id?: unknown } | undefined;
        return !eventTool?.id || !persistedToolIds.has(String(eventTool.id));
      }),
      tools
    };
  };
  const userMessagesByTurn = new Map(data.messages.filter((message) => message.role === "user" && message.turn_id).map((message) => [message.turn_id!, message]));
  const answeredQuestionMessages = new Set(data.messages
    .filter((message) => message.role === "user" && typeof asAssistantRecord(message.page_context).structured_answer_to === "string")
    .map((message) => String(asAssistantRecord(message.page_context).structured_answer_to)));
  if (!open) return null;
  return (
    <>
      <button className={styles.backdrop} type="button" onClick={() => !running && onClose()} aria-label="Close Pilot Assistant" />
      <aside ref={drawerRef} style={{ width: panelWidth }} className={`${styles.drawer} ${styles.dockedDrawer}`} role="dialog" aria-modal="false" aria-label="Pilot Assistant">
        <div className={styles.resizeRail} role="separator" aria-label="Resize Pilot Assistant" aria-orientation="vertical" onPointerDown={handleDockResizeStart} onPointerMove={handleDockResizeMove} onPointerUp={handleDockResizeEnd} onPointerCancel={handleDockResizeEnd}><span /></div>
        <header className={styles.header}>
          <div className={styles.conversationPicker}>
            <button type="button" onClick={() => setHistoryOpen((current) => !current)} aria-expanded={historyOpen}>
              <span>{data.activeConversation?.title ?? "New conversation"}</span><CaretDown size={11} />
            </button>
            {historyOpen && <div className={styles.historyMenu}>
              <button className={styles.newConversation} type="button" onClick={startNewConversation}><Plus size={14} /> New conversation</button>
              <div className={styles.historyList}>{data.conversations.map((conversation) => <div className={`${styles.historyRow} ${conversation.id === activeId ? styles.activeConversation : ""}`} key={conversation.id}>
                {renamingConversationId === conversation.id ? <form className={styles.renameConversation} onSubmit={(event) => { event.preventDefault(); void renameConversation(conversation.id); }}>
                  <input autoFocus value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} maxLength={120} aria-label="Conversation title" />
                  <button type="submit" disabled={!renameDraft.trim() || savingRename} aria-label="Save conversation title" title="Save"><Check size={13} /></button>
                  <button type="button" onClick={() => setRenamingConversationId(null)} aria-label="Cancel rename" title="Cancel"><X size={13} /></button>
                </form> : <>
                  <button className={styles.historySelect} type="button" onClick={() => { setHistoryOpen(false); void loadConversation(conversation.id); }}><span>{conversation.title}</span></button>
                  <button className={styles.renameConversationButton} type="button" onClick={() => { setRenamingConversationId(conversation.id); setRenameDraft(conversation.title); }} disabled={running} aria-label={`Rename ${conversation.title}`} title="Rename conversation"><PencilSimple size={14} /></button>
                  <button className={styles.archiveConversation} type="button" onClick={() => void archiveConversation(conversation.id)} disabled={running || busyArchive === conversation.id} aria-label={`Archive ${conversation.title}`} title="Archive conversation"><Archive size={14} /></button>
                </>}
              </div>)}</div>
            </div>}
          </div>
        </header>

        {preferences.enabled ? <>
        <div className={styles.timeline} ref={scrollRef}>
          {loading && !data.messages.length ? <div className={styles.loadingHistory}><ShinyText text="Opening conversation" speed={1.8} /></div> : null}
          {!loading && !data.messages.length && !running ? <div className={styles.empty}>
            <ChatCircleDots size={24} />
            <h2>Ask about your plan</h2>
            <p>Pilot can read your records, search eligible courses, and apply valid changes after an independent safety review.</p>
            <div>{ASSISTANT_SUGGESTIONS.map((suggestion) => <button type="button" key={suggestion} onClick={() => void submitMessage(suggestion)}>{suggestion}</button>)}</div>
          </div> : null}

          {data.messages.map((message) => {
            const turn = message.turn_id ? turnContent(message.turn_id) : { events: [], tools: [] };
            if (message.role === "user") return <div key={message.id} className={styles.userTurn}>
              <FadeContent className={styles.userMessage} duration={0.14}><MessageImages message={message} onPreview={setPreviewImage} />{message.content && <AssistantMarkdown text={message.content} />}</FadeContent>
              <MessageActions message={message} align="right" />
              {message.turn_id && <TurnActivity events={turn.events} tools={turn.tools} running={running && message.turn_id === latestTurnId} reviewing={reviewingChange} />}
            </div>;
            if (message.role === "assistant") {
              const questions = assistantQuestionsFromContext(message.page_context);
              const sourceMessage = message.turn_id ? userMessagesByTurn.get(message.turn_id) : undefined;
              const canRetry = Boolean(sourceMessage && !sourceMessage.attachments?.length && !running && !turn.tools.some((tool) => tool.status === "pending_confirmation"));
              return <div className={styles.assistantTurn} key={message.id}>
                <FadeContent className={styles.assistantMessage} duration={0.16}><AssistantMarkdown text={message.content} /></FadeContent>
                {questions.length > 0 && <StructuredQuestions questions={questions} answered={answeredQuestionMessages.has(message.id)} willQueue={running} onSubmit={(answers) => submitMessage(formatStructuredAnswers(questions, answers), { structured_answer_to: message.id })} />}
                <MessageActions message={message} canRetry={canRetry} onRetry={sourceMessage ? () => void sendMessage(sourceMessage.content, { context: { retry_of_turn_id: sourceMessage.turn_id } }) : undefined} />
              </div>;
            }
            return <ChangeReceipt message={message} busy={busyUndo === asAssistantRecord(message.page_context).tool_call_id} onUndo={(receipt) => void undoChange(receipt)} key={message.id} />;
          })}
          {running && !data.messages.some((message) => message.turn_id === latestTurnId && message.role === "assistant") && <div className={styles.liveWorking}><ShinyText text={reviewingChange ? "Checking change" : "Pilot is working"} speed={1.8} /></div>}
          {error && <div className={styles.error} role="alert"><Warning size={16} /><span>{error}</span></div>}
        </div>

        <form className={styles.composer} onSubmit={(event: SyntheticEvent<HTMLFormElement>) => { event.preventDefault(); void submitMessage(); }}>
          {queuedMessages.length > 0 && <div className={styles.queueTray} aria-label="Queued messages">
            <div className={styles.queueHeading}><strong>{queuedMessages.length === 1 ? "Next message" : `${queuedMessages.length} messages queued`}</strong><span>{running ? "Runs when Pilot finishes" : "Waiting to send"}</span></div>
            <div className={styles.queueList}>{queuedMessages.map((queued, index) => <div className={styles.queueRow} key={queued.id}>
              <span className={styles.queuePosition}>{index === 0 ? "Next" : index + 1}</span>
              <span className={styles.queueText}>{queued.content || `${queued.images.length} attached ${queued.images.length === 1 ? "image" : "images"}`}</span>
              {queued.images.length > 0 && queued.content && <span className={styles.queueAttachments}>{queued.images.length} {queued.images.length === 1 ? "image" : "images"}</span>}
              <button className={styles.runQueued} type="button" onClick={() => runQueuedMessage(queued.id)} aria-label={`${running ? "Steer now with" : "Send"} ${queued.content || "queued image message"}`} title={running ? "Stop the current response and run this next" : "Send this message now"}><ArrowUp size={13} />{index === 0 ? (running ? "Steer" : "Send") : "Next"}</button>
              <button className={styles.removeQueued} type="button" onClick={() => removeQueuedMessage(queued.id)} aria-label={`Remove queued message ${queued.content || "with images"}`} title="Remove from queue"><X size={13} /></button>
            </div>)}</div>
          </div>}
          <div className={`${styles.composerSurface} ${draggingImage ? styles.draggingImage : ""}`} onDragEnter={(event) => { event.preventDefault(); setDraggingImage(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingImage(false); }} onDrop={handleDrop}>
            {images.length > 0 && <FadeContent className={styles.attachmentStrip} duration={0.14}>
              {images.map((image) => <div className={styles.attachmentThumb} key={image.id}>
                <button type="button" className={styles.previewAttachment} onClick={() => setPreviewImage({ url: image.previewUrl, name: image.file.name })} aria-label={`Preview ${image.file.name}`}><img src={image.previewUrl} alt="" /></button>
                <button type="button" className={styles.removeAttachment} onClick={() => removeImage(image.id)} aria-label={`Remove ${image.file.name}`}><X size={11} weight="bold" /></button>
              </div>)}
            </FadeContent>}
            <textarea ref={inputRef} value={draft} onChange={(event) => updateDraft(event.target.value)} onPaste={handlePaste} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submitMessage(); } }} placeholder={images.length ? "Ask about these images" : running ? "Message Pilot next" : "Ask Pilot"} rows={1} maxLength={4000} />
            <div className={styles.composerToolbar}>
              <input ref={fileInputRef} className={styles.fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => { addImages(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} />
              <div className={styles.composerTools}>
                <AiModelPicker compact side="top" value={selectedModel} disabled={savingModel || running} onChange={(model) => void changeModel(model)} />
              </div>
              <div className={styles.composerActions}>
                <button type="button" className={styles.attachButton} onClick={() => fileInputRef.current?.click()} disabled={images.length >= MAX_ASSISTANT_ATTACHMENTS} aria-label="Attach images" title="Attach images"><Paperclip size={16} /></button>
                {running && !draft.trim() && !images.length
                  ? <button className={styles.stopButton} type="button" onClick={() => abortRef.current?.abort()} aria-label="Stop current response" title="Stop current response"><Stop size={13} weight="fill" /></button>
                  : <button className={styles.sendButton} type="submit" disabled={!draft.trim() && !images.length} aria-label={running ? "Queue message" : "Send message"} title={running ? "Queue after the current response" : "Send message"}><PaperPlaneRight size={15} weight="fill" /></button>}
              </div>
            </div>
          </div>
          {(running || reviewingChange || queuedMessages.length > 0) && <span className={styles.composerStatus} role="status">{queuedMessages.length ? `${queuedMessages.length} queued` : reviewingChange ? "Validating change" : "Pilot is working"}</span>}
        </form>
        </> : <div className={styles.disconnected}>
          <Cpu size={22} />
          <strong>Connect Pilot to start</strong>
          <p>Test a Codex model and approve access before sending student context.</p>
        </div>}
      </aside>
      {previewImage && <div className={styles.imagePreviewBackdrop} role="dialog" aria-modal="true" aria-label={`Preview ${previewImage.name}`} onClick={() => setPreviewImage(null)}>
        <div className={styles.imagePreview} onClick={(event) => event.stopPropagation()}>
          <div><span>{previewImage.name}</span><button type="button" onClick={() => setPreviewImage(null)} aria-label="Close image preview"><X size={18} /></button></div>
          <img src={previewImage.url} alt={previewImage.name} />
        </div>
      </div>}
    </>
  );
}
