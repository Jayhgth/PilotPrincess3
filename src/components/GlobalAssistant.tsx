import {
  ArchiveIcon as Archive,
  ArrowUpIcon as ArrowUp,
  ArrowSquareOutIcon as ArrowSquareOut,
  BrainIcon as Brain,
  CaretDownIcon as CaretDown,
  CheckIcon as Check,
  CheckCircleIcon as CheckCircle,
  ClockIcon as Clock,
  CopyIcon as Copy,
  CpuIcon as Cpu,
  GearSixIcon as GearSix,
  ImageIcon as Image,
  PaperclipIcon as Paperclip,
  PaperPlaneRightIcon as PaperPlaneRight,
  PencilSimpleIcon as PencilSimple,
  PlusIcon as Plus,
  PushPinIcon as PushPin,
  ShieldCheckIcon as ShieldCheck,
  SparkleIcon as Sparkle,
  StopIcon as Stop,
  UserCircleCheckIcon as UserCircleCheck,
  ArrowCounterClockwiseIcon as ArrowCounterClockwise,
  WrenchIcon as Wrench,
  WarningIcon as Warning,
  XIcon as X
} from "@phosphor-icons/react";
import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent, type SyntheticEvent } from "react";
import FadeContent from "@/components/reactbits/FadeContent";
import ShinyText from "@/components/reactbits/ShinyText";
import AssistantMarkdown from "@/components/AssistantMarkdown";
import CodexConnectionSetup, { type CodexSetupValue } from "@/components/CodexConnectionSetup";
import type { AiModel, AiReviewMode } from "@/lib/ai-preferences";
import { MAX_ASSISTANT_ATTACHMENTS, validateAssistantImage } from "@/lib/ai-attachments";
import { assistantTurnDuration, assistantTurnStartedAt, formatAssistantDuration } from "@/lib/assistant-display";
import { assistantDockedMaxWidth, assistantDraftKey, assistantQuestionsFromContext, changeDetailsFromContext, formatMessageTime, formatMessageTimeTitle, formatStructuredAnswers, prioritizeAssistantQueue, visibleToolCalls, type AssistantQuestion } from "@/lib/assistant-chat";
import type { AiConversation, AiEvent, AiMessage, AiToolCall } from "@/lib/models";
import styles from "./GlobalAssistant.module.css";

interface GlobalAssistantProps {
  session: Session;
  open: boolean;
  pageContext: Record<string, unknown>;
  preferences: {
    enabled: boolean;
    model: AiModel;
    reviewMode: AiReviewMode;
    approvedAt: string | null;
    testedAt: string | null;
  };
  onClose: () => void;
  onDataChanged: () => void | Promise<void>;
  onPreferencesChanged: () => void | Promise<void>;
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

type AssistantPanelMode = "docked" | "floating";
type AssistantSettingsSection = "connection" | "archive" | "interface";

interface FloatingLayout {
  left: number;
  top: number;
  width: number;
  height: number;
}

const PANEL_WIDTH_KEY = "pilot-princess:assistant-width";
const PANEL_MODE_KEY = "pilot-princess:assistant-mode";
const PANEL_FLOATING_LAYOUT_KEY = "pilot-princess:assistant-floating-layout";
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

function loadPanelMode(): AssistantPanelMode {
  if (typeof window === "undefined") return "docked";
  return window.localStorage.getItem(PANEL_MODE_KEY) === "floating" ? "floating" : "docked";
}

function loadFloatingLayout(): FloatingLayout {
  const fallback = { left: Math.max(16, (typeof window === "undefined" ? 1440 : window.innerWidth) - 452), top: 16, width: 420, height: Math.max(560, (typeof window === "undefined" ? 900 : window.innerHeight) - 32) };
  if (typeof window === "undefined") return fallback;
  try {
    const saved = JSON.parse(window.localStorage.getItem(PANEL_FLOATING_LAYOUT_KEY) ?? "null") as Partial<FloatingLayout> | null;
    if (!saved) return fallback;
    const width = clamp(Number(saved.width) || fallback.width, MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, window.innerWidth - 24));
    const height = clamp(Number(saved.height) || fallback.height, 460, window.innerHeight - 24);
    return {
      left: clamp(Number(saved.left) || fallback.left, 12, Math.max(12, window.innerWidth - width - 12)),
      top: clamp(Number(saved.top) || fallback.top, 12, Math.max(12, window.innerHeight - height - 12)),
      width,
      height
    };
  } catch {
    return fallback;
  }
}

const EMPTY_PAYLOAD: ConversationPayload = {
  conversations: [],
  activeConversation: null,
  messages: [],
  events: [],
  toolCalls: []
};

function contextSuggestions(context: Record<string, unknown>) {
  const view = String(context.view ?? "dashboard");
  return ({
    dashboard: ["What should I focus on next?", "Check whether my current plan is balanced.", "What should I verify with my counselor?"],
    courses: ["Find an eligible course that fits my interests.", "Check my current course sequence.", "Help me add a course to my plan."],
    graduation: ["Which graduation requirement still needs attention?", "Explain what is completed versus only scheduled.", "What should I plan next for graduation?"],
    gpa: ["Explain my GPA in plain language.", "Which courses are included in this GPA?", "What GPA evidence should I verify?"],
    activities: ["Where is my experience record incomplete?", "How many current activity hours are recorded?", "Help me make one experience more specific."],
    timeline: ["What is my most important next step?", "Check whether any steps are out of order.", "Add a next step for me."],
    simulator: ["Explain the current load-check assumptions.", "Would one SMCCD course fit my saved limit?", "What information is missing from this load check?"],
    profile: ["What courses match my saved interests?", "Help me test one career direction.", "Which planning preference is still unclear?"]
  } as Record<string, string[]>)[view] ?? ["What should I focus on next?", "Check my current plan.", "What can you help me change?"];
}

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
  const [answers, setAnswers] = useState<Record<string, string>>({});
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

function ChangeReceipt({ message }: { message: AiMessage }) {
  const details = changeDetailsFromContext(message.page_context);
  const toolName = String(message.page_context.tool_name ?? "student data");
  return <FadeContent className={styles.changeReceipt} duration={0.16}>
    <div><CheckCircle size={16} weight="fill" /><span><strong>Change applied</strong><small>{friendlyToolLabel(toolName)}</small></span></div>
    <p>{message.content}</p>
    {details.length > 0 && <dl>{details.map((detail) => <div key={detail.label}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl>}
    <MessageActions message={message} />
  </FadeContent>;
}

const TOOL_LABELS: Record<string, string> = {
  get_student_overview: "Student overview",
  list_plan_courses: "Course plan",
  search_course_catalog: "Course catalog",
  get_graduation_progress: "Graduation progress",
  get_next_steps: "Next steps",
  get_experiences: "Experiences",
  get_student_profile: "Student profile",
  get_transcript_sources: "Transcript sources",
  get_student_data_inventory: "Student records",
  audit_transcript_data: "Transcript audit",
  get_gpa_evidence: "GPA evidence",
  evaluate_gpa_scenario: "GPA scenario",
  get_enrollment_constraints: "College unit limits",
  get_plan_versions: "Plan versions",
  get_degree_progress: "Degree progress",
  get_college_goal: "College goal",
  run_load_check: "Load check",
  add_dtech_course: "Add d.tech course",
  add_smccd_course: "Add college course",
  move_plan_course: "Move course",
  remove_plan_course: "Remove course",
  update_plan_course: "Update course",
  update_student_profile: "Update planning preferences",
  update_enrollment_preference: "Update enrollment guardrail",
  add_experience: "Add experience",
  update_experience: "Update experience",
  remove_experience: "Remove experience",
  add_next_step: "Add next step",
  complete_next_step: "Complete next step",
  update_next_step: "Update next step",
  remove_next_step: "Remove next step",
  set_college_goal: "Set college goal",
  clear_college_goal: "Clear college goal"
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
    .replace(/^Mutating proposal only\.?$/i, "Preparing a change for your approval")
    .replace(/^Calling tool ['"]?(.+?)['"]?$/i, "Checking $1");
  return text;
}

function toolSummary(call: AiToolCall) {
  const autoReview = (call.result as { auto_review?: { summary?: unknown } } | null)?.auto_review;
  if (call.status === "completed") return String((call.result as { summary?: unknown } | null)?.summary ?? "Completed");
  if (call.status === "failed") return String((call.result as { error?: unknown } | null)?.error ?? "The tool failed.");
  if (call.status === "rejected") return String(autoReview?.summary ?? "Not applied");
  if (call.status === "pending_confirmation") return String(autoReview?.summary ?? "Waiting for your confirmation");
  return "Running";
}

function readableArguments(call: AiToolCall) {
  const entries = Object.entries(call.arguments).filter(([, value]) => value !== null && value !== "");
  return entries.map(([key, value]) => ({ label: key.replaceAll("_", " "), value: String(value).replaceAll("_", " ") }));
}

function ToolCallRow({ call, busy, onDecision }: { call: AiToolCall; busy: boolean; onDecision: (call: AiToolCall, decision: "confirm" | "reject") => void }) {
  const pending = call.status === "pending_confirmation";
  const label = friendlyToolLabel(call.tool_name);
  const autoReview = (call.result as { auto_review?: { summary?: unknown } } | null)?.auto_review;
  const autoReviewSummary = typeof autoReview?.summary === "string" ? autoReview.summary : null;
  if (pending) {
    return (
      <FadeContent className={styles.approvalCard} duration={0.16}>
        <div className={styles.approvalHeading}><Wrench size={16} /><div><strong>Confirm this change</strong><span>{label}</span></div></div>
        <p>{call.explanation}</p>
        {autoReviewSummary && <p className={styles.reviewNote}><ShieldCheck size={15} /> Auto-review left this for you: {autoReviewSummary}</p>}
        <dl>{readableArguments(call).map((entry) => <div key={entry.label}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>)}</dl>
        <div className={styles.approvalActions}>
          <button type="button" onClick={() => onDecision(call, "confirm")} disabled={busy}>Apply change</button>
          <button type="button" onClick={() => onDecision(call, "reject")} disabled={busy}>Not now</button>
        </div>
      </FadeContent>
    );
  }
  return (
    <details className={`${styles.workRow} ${call.status === "failed" ? styles.failed : ""}`}>
      <summary><span className={styles.workIcon}>{call.status === "completed" ? <CheckCircle size={15} /> : call.status === "failed" ? <Warning size={15} /> : <Wrench size={15} />}</span><span><strong>{label}</strong><small>{toolSummary(call)}</small></span><CaretDown size={13} /></summary>
      <div className={styles.workDetails}><p>{call.explanation}</p>{readableArguments(call).length > 0 && <dl>{readableArguments(call).map((entry) => <div key={entry.label}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>)}</dl>}</div>
    </details>
  );
}

function activityItem(event: LiveActivity) {
  if (event.type === "attachments.received") return { kind: "image", label: "Image context", detail: String(event.summary ?? "Student-provided images were added to this turn") };
  if (event.type === "auto_review.started") return { kind: "review", label: "Auto-review", detail: String(event.summary ?? "Checking the proposed change") };
  if (event.type === "auto_review.completed") {
    const review = event.review as Record<string, unknown> | undefined;
    return { kind: "review", label: "Auto-review", detail: String(review?.summary ?? "Review completed") };
  }
  if (event.type === "retrieval.completed") {
    const sources = Array.isArray(event.sources) ? event.sources as Array<Record<string, unknown>> : [];
    return {
      kind: "retrieval",
      label: "App guidance",
      detail: sources.length
        ? sources.map((source) => String(source.title ?? "Pilot guidance")).join(", ")
        : String(event.summary ?? "Used Pilot Princess guidance")
    };
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

function TurnActivity({ events, tools, running, busyTool, onDecision }: {
  events: LiveActivity[];
  tools: AiToolCall[];
  running: boolean;
  busyTool: string | null;
  onDecision: (call: AiToolCall, decision: "confirm" | "reject") => void;
}) {
  const [showAllTools, setShowAllTools] = useState(false);
  const items = events.map(activityItem).filter((item): item is NonNullable<ReturnType<typeof activityItem>> => Boolean(item));
  const hasFailure = items.some((item) => item.kind === "error") || tools.some((tool) => tool.status === "failed");
  const wasCancelled = items.some((item) => item.kind === "stopped");
  const hasPendingChange = tools.some((tool) => tool.status === "pending_confirmation");
  const forceOpen = running || hasFailure || hasPendingChange;
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
        {groupedTools.visible.map((tool) => <ToolCallRow key={tool.id} call={tool} busy={Boolean(busyTool)} onDecision={onDecision} />)}
        {showAllTools && tools.length > 2 && <button className={styles.showMoreTools} type="button" onClick={() => setShowAllTools(false)}><CaretDown size={13} className={styles.caretUp} /> Show fewer tool calls</button>}
      </div>
    </details>
  );
}

export default function GlobalAssistant({ session, open, pageContext, preferences, onClose, onDataChanged, onPreferencesChanged }: GlobalAssistantProps) {
  const [data, setData] = useState<ConversationPayload>(EMPTY_PAYLOAD);
  const [liveEvents, setLiveEvents] = useState<LiveActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busyTool, setBusyTool] = useState<string | null>(null);
  const [autoReviewing, setAutoReviewing] = useState(false);
  const [reviewMode, setReviewMode] = useState<AiReviewMode>(preferences.reviewMode);
  const [reviewMenuOpen, setReviewMenuOpen] = useState(false);
  const [savingReviewMode, setSavingReviewMode] = useState(false);
  const [images, setImages] = useState<ComposerImage[]>([]);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
  const [draggingImage, setDraggingImage] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(!preferences.enabled);
  const [settingsSection, setSettingsSection] = useState<AssistantSettingsSection>("connection");
  const [archivedConversations, setArchivedConversations] = useState<AiConversation[]>([]);
  const [loadingArchived, setLoadingArchived] = useState(false);
  const [busyArchive, setBusyArchive] = useState<string | null>(null);
  const [renamingConversationId, setRenamingConversationId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [savingRename, setSavingRename] = useState(false);
  const [panelMode, setPanelModeState] = useState<AssistantPanelMode>(loadPanelMode);
  const [panelWidth, setPanelWidth] = useState(() => clamp(loadStoredNumber(PANEL_WIDTH_KEY, DEFAULT_PANEL_WIDTH), MIN_PANEL_WIDTH, typeof window === "undefined" ? MAX_PANEL_WIDTH : assistantDockedMaxWidth(window.innerWidth, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH, MIN_WORKSPACE_WITH_SIDEBAR)));
  const [floatingLayout, setFloatingLayout] = useState<FloatingLayout>(loadFloatingLayout);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [setup, setSetup] = useState<CodexSetupValue>({
    enabled: preferences.enabled,
    model: preferences.model,
    approved: Boolean(preferences.approvedAt),
    testedAt: preferences.testedAt
  });
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const imagesRef = useRef<ComposerImage[]>([]);
  const queueRef = useRef<QueuedMessage[]>([]);
  const dockResizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const panelDragRef = useRef<{ pointerId: number; startX: number; startY: number; startLeft: number; startTop: number } | null>(null);
  const suggestions = useMemo(() => contextSuggestions(pageContext), [pageContext]);
  const activeId = data.activeConversation?.id ?? null;

  const authorizedFetch = useCallback((url: string, init?: RequestInit) => fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${session.access_token}`, ...(init?.headers ?? {}) }
  }), [session.access_token]);

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

  const loadArchivedConversations = useCallback(async () => {
    setLoadingArchived(true);
    try {
      const response = await authorizedFetch("/api/ai/conversations?archived=true");
      const payload = await response.json() as ConversationPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Archived conversations could not be loaded.");
      setArchivedConversations(payload.conversations);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Archived conversations could not be loaded.");
    } finally {
      setLoadingArchived(false);
    }
  }, [authorizedFetch]);

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
    if (!settingsOpen || settingsSection !== "archive") return;
    const timer = window.setTimeout(() => void loadArchivedConversations(), 0);
    return () => window.clearTimeout(timer);
  }, [loadArchivedConversations, settingsOpen, settingsSection]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDraft(window.localStorage.getItem(assistantDraftKey(session.user.id, activeId)) ?? ""), 0);
    return () => window.clearTimeout(timer);
  }, [activeId, session.user.id]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.assistantMode = panelMode;
    root.style.setProperty("--assistant-panel-width", `${panelWidth}px`);
    window.localStorage.setItem(PANEL_MODE_KEY, panelMode);
    window.localStorage.setItem(PANEL_WIDTH_KEY, String(panelWidth));
    return () => {
      delete root.dataset.assistantMode;
      root.style.removeProperty("--assistant-panel-width");
    };
  }, [panelMode, panelWidth]);

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
      else if (settingsOpen) setSettingsOpen(false);
      else if (reviewMenuOpen) setReviewMenuOpen(false);
      else onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open, previewImage, reviewMenuOpen, running, settingsOpen]);

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

  function openSettings(section: AssistantSettingsSection = "connection") {
    setSettingsSection(section);
    setHistoryOpen(false);
    setSettingsOpen(true);
  }

  function changePanelMode(mode: AssistantPanelMode) {
    if (mode === "floating") {
      const width = clamp(panelWidth, MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, window.innerWidth - 24));
      const height = clamp(window.innerHeight - 32, 460, window.innerHeight - 24);
      const next = { left: Math.max(12, window.innerWidth - width - 16), top: 16, width, height };
      setFloatingLayout(next);
      window.localStorage.setItem(PANEL_FLOATING_LAYOUT_KEY, JSON.stringify(next));
    }
    setPanelModeState(mode);
  }

  function commitFloatingLayout() {
    if (panelMode !== "floating" || !drawerRef.current || window.innerWidth < 1200) return;
    const rect = drawerRef.current.getBoundingClientRect();
    const next = {
      left: clamp(rect.left, 12, Math.max(12, window.innerWidth - rect.width - 12)),
      top: clamp(rect.top, 12, Math.max(12, window.innerHeight - rect.height - 12)),
      width: clamp(rect.width, MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, window.innerWidth - 24)),
      height: clamp(rect.height, 460, window.innerHeight - 24)
    };
    setFloatingLayout(next);
    window.localStorage.setItem(PANEL_FLOATING_LAYOUT_KEY, JSON.stringify(next));
  }

  function handleDockResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (panelMode !== "docked" || event.button !== 0 || !drawerRef.current) return;
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

  function handlePanelDragStart(event: ReactPointerEvent<HTMLElement>) {
    if (panelMode !== "floating" || event.button !== 0 || !drawerRef.current || (event.target as HTMLElement).closest("button, input, textarea")) return;
    const rect = drawerRef.current.getBoundingClientRect();
    panelDragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startLeft: rect.left, startTop: rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.cursor = "move";
    document.body.style.userSelect = "none";
  }

  function handlePanelDragMove(event: ReactPointerEvent<HTMLElement>) {
    const drag = panelDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !drawerRef.current) return;
    const rect = drawerRef.current.getBoundingClientRect();
    const left = clamp(drag.startLeft + event.clientX - drag.startX, 12, Math.max(12, window.innerWidth - rect.width - 12));
    const top = clamp(drag.startTop + event.clientY - drag.startY, 12, Math.max(12, window.innerHeight - rect.height - 12));
    drawerRef.current.style.left = `${left}px`;
    drawerRef.current.style.top = `${top}px`;
  }

  function handlePanelDragEnd(event: ReactPointerEvent<HTMLElement>) {
    const drag = panelDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    panelDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    commitFloatingLayout();
  }

  async function updateConversationArchive(conversationId: string, archived: boolean) {
    if (running || busyArchive) return;
    setBusyArchive(conversationId);
    setError(null);
    try {
      const response = await authorizedFetch("/api/ai/conversations", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, archived })
      });
      const payload = await response.json() as { conversation?: AiConversation; error?: string };
      if (!response.ok || !payload.conversation) throw new Error(payload.error ?? "The conversation could not be updated.");
      if (archived) {
        setHistoryOpen(false);
        if (data.activeConversation?.id === conversationId) await loadConversation();
        else setData((current) => ({ ...current, conversations: current.conversations.filter((conversation) => conversation.id !== conversationId) }));
      } else {
        await loadConversation(data.activeConversation?.id);
      }
      if (settingsOpen && settingsSection === "archive") await loadArchivedConversations();
    } catch (caught) {
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
      context: { ...pageContext, ...context }
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

  function resetPanelLayout() {
    const next = { left: Math.max(12, window.innerWidth - DEFAULT_PANEL_WIDTH - 16), top: 16, width: DEFAULT_PANEL_WIDTH, height: Math.max(460, window.innerHeight - 32) };
    setPanelWidth(DEFAULT_PANEL_WIDTH);
    setFloatingLayout(next);
    window.localStorage.setItem(PANEL_WIDTH_KEY, String(DEFAULT_PANEL_WIDTH));
    window.localStorage.setItem(PANEL_FLOATING_LAYOUT_KEY, JSON.stringify(next));
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
    const messageContext = { ...pageContext, ...(options.context ?? {}) };
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
      form.set("pageContext", JSON.stringify(messageContext));
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
      if (reviewMode === "auto_review" && proposalIds.length) {
        setAutoReviewing(true);
        let changed = false;
        for (const toolCallId of proposalIds) {
          const reviewResponse = await authorizedFetch("/api/ai/tool", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ toolCallId, decision: "auto_review" }),
            signal: abortController.signal
          });
          const reviewPayload = await reviewResponse.json() as { error?: string; applied?: boolean };
          if (!reviewResponse.ok) throw new Error(reviewPayload.error ?? "Auto-review could not complete.");
          changed ||= reviewPayload.applied === true;
        }
        if (changed) await onDataChanged();
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
      setAutoReviewing(false);
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

  async function updateReviewMode(mode: AiReviewMode) {
    if (mode === reviewMode) {
      setReviewMenuOpen(false);
      return;
    }
    setSavingReviewMode(true);
    setError(null);
    try {
      const response = await authorizedFetch("/api/ai/review-mode", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode })
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Review mode could not be changed.");
      setReviewMode(mode);
      setReviewMenuOpen(false);
      await onPreferencesChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Review mode could not be changed.");
    } finally {
      setSavingReviewMode(false);
    }
  }

  async function decideTool(call: AiToolCall, decision: "confirm" | "reject") {
    setBusyTool(call.id);
    setError(null);
    try {
      const response = await authorizedFetch("/api/ai/tool", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ toolCallId: call.id, decision }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "The change could not be handled.");
      await loadConversation(call.conversation_id);
      if (decision === "confirm") await onDataChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The change could not be handled.");
      await loadConversation(call.conversation_id);
    } finally {
      setBusyTool(null);
    }
  }

  async function savePreferences() {
    setSavingPreferences(true);
    setError(null);
    try {
      const response = await authorizedFetch("/api/ai/preferences", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(setup)
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Pilot settings could not be saved.");
      await onPreferencesChanged();
      setSettingsOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pilot settings could not be saved.");
    } finally {
      setSavingPreferences(false);
    }
  }

  const events = useMemo(() => [
    ...data.events.map((event) => event.payload as LiveActivity),
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
    .filter((message) => message.role === "user" && typeof message.page_context.structured_answer_to === "string")
    .map((message) => String(message.page_context.structured_answer_to)));
  const drawerStyle: CSSProperties = panelMode === "floating"
    ? { left: floatingLayout.left, top: floatingLayout.top, width: floatingLayout.width, height: floatingLayout.height }
    : { width: panelWidth };

  if (!open) return null;
  return (
    <>
      <button className={styles.backdrop} type="button" onClick={() => !running && onClose()} aria-label="Close Pilot Assistant" />
      <aside ref={drawerRef} style={drawerStyle} className={`${styles.drawer} ${panelMode === "floating" ? styles.floatingDrawer : styles.dockedDrawer}`} role="dialog" aria-modal="false" aria-label="Pilot Assistant" onPointerUpCapture={commitFloatingLayout}>
        <div className={styles.resizeRail} role="separator" aria-label="Resize Pilot Assistant" aria-orientation="vertical" onPointerDown={handleDockResizeStart} onPointerMove={handleDockResizeMove} onPointerUp={handleDockResizeEnd} onPointerCancel={handleDockResizeEnd}><span /></div>
        <header className={styles.header} onPointerDown={handlePanelDragStart} onPointerMove={handlePanelDragMove} onPointerUp={handlePanelDragEnd} onPointerCancel={handlePanelDragEnd}>
          <div className={styles.conversationPicker}>
            <button type="button" onClick={() => setHistoryOpen((current) => !current)} aria-expanded={historyOpen}>
              <Sparkle size={15} weight="fill" /><span>{data.activeConversation?.title ?? "Pilot Assistant"}</span><CaretDown size={11} />
            </button>
            {historyOpen && <div className={styles.historyMenu}>
              <button className={styles.newConversation} type="button" onClick={() => void createConversation()}><Plus size={14} /> New conversation</button>
              <div className={styles.historyList}>{data.conversations.map((conversation) => <div className={`${styles.historyRow} ${conversation.id === activeId ? styles.activeConversation : ""}`} key={conversation.id}>
                {renamingConversationId === conversation.id ? <form className={styles.renameConversation} onSubmit={(event) => { event.preventDefault(); void renameConversation(conversation.id); }}>
                  <input autoFocus value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} maxLength={120} aria-label="Conversation title" />
                  <button type="submit" disabled={!renameDraft.trim() || savingRename} aria-label="Save conversation title" title="Save"><Check size={13} /></button>
                  <button type="button" onClick={() => setRenamingConversationId(null)} aria-label="Cancel rename" title="Cancel"><X size={13} /></button>
                </form> : <>
                  <button className={styles.historySelect} type="button" onClick={() => { setHistoryOpen(false); void loadConversation(conversation.id); }}><span>{conversation.title}</span></button>
                  <button className={styles.renameConversationButton} type="button" onClick={() => { setRenamingConversationId(conversation.id); setRenameDraft(conversation.title); }} disabled={running} aria-label={`Rename ${conversation.title}`} title="Rename conversation"><PencilSimple size={14} /></button>
                  <button className={styles.archiveConversation} type="button" onClick={() => void updateConversationArchive(conversation.id, true)} disabled={running || busyArchive === conversation.id} aria-label={`Archive ${conversation.title}`} title="Archive conversation"><Archive size={14} /></button>
                </>}
              </div>)}</div>
            </div>}
          </div>
          <div className={styles.headerActions}>
            <button type="button" onClick={() => void createConversation()} aria-label="New conversation" title="New conversation"><Plus size={15} /></button>
            <button className={styles.panelModeButton} type="button" onClick={() => changePanelMode(panelMode === "docked" ? "floating" : "docked")} aria-label={panelMode === "docked" ? "Float assistant panel" : "Dock assistant panel"} title={panelMode === "docked" ? "Float panel" : "Dock panel"}>{panelMode === "docked" ? <ArrowSquareOut size={15} /> : <PushPin size={15} />}</button>
            <button type="button" onClick={() => openSettings("connection")} aria-label="Pilot settings" title="Settings"><GearSix size={15} /></button>
            <button type="button" onClick={onClose} disabled={running} aria-label="Close assistant" title="Close"><X size={16} /></button>
          </div>
        </header>

        {preferences.enabled ? <>
        <div className={styles.timeline} ref={scrollRef}>
          {loading && !data.messages.length ? <div className={styles.loadingHistory}><ShinyText text="Opening conversation" speed={1.8} /></div> : null}
          {!loading && !data.messages.length && !running ? <div className={styles.empty}>
            <Sparkle size={24} weight="duotone" />
            <h2>Ask about your plan</h2>
            <p>Pilot can read your current records, search eligible courses, and prepare changes for your approval.</p>
            <div>{suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => void submitMessage(suggestion)}>{suggestion}</button>)}</div>
          </div> : null}

          {data.messages.map((message) => {
            const turn = message.turn_id ? turnContent(message.turn_id) : { events: [], tools: [] };
            if (message.role === "user") return <div key={message.id} className={styles.userTurn}>
              <FadeContent className={styles.userMessage} duration={0.14}><MessageImages message={message} onPreview={setPreviewImage} />{message.content && <AssistantMarkdown text={message.content} />}</FadeContent>
              <MessageActions message={message} align="right" />
              {message.turn_id && <TurnActivity events={turn.events} tools={turn.tools} running={running && message.turn_id === latestTurnId} busyTool={busyTool} onDecision={decideTool} />}
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
            return <ChangeReceipt message={message} key={message.id} />;
          })}
          {running && !data.messages.some((message) => message.turn_id === latestTurnId && message.role === "assistant") && <div className={styles.liveWorking}><ShinyText text={autoReviewing ? "Auto-review is checking" : "Pilot is working"} speed={1.8} /></div>}
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
                <button type="button" className={styles.attachButton} onClick={() => fileInputRef.current?.click()} disabled={images.length >= MAX_ASSISTANT_ATTACHMENTS} aria-label="Attach images" title="Attach images"><Paperclip size={16} /></button>
                <span className={styles.contextChip} title={`Using ${String(pageContext.label ?? "this page")} context`}>{String(pageContext.label ?? "Page")}</span>
              </div>
              <div className={styles.composerActions}>
                <div className={styles.reviewMode} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setReviewMenuOpen(false); }}>
                  <button type="button" onClick={() => setReviewMenuOpen((current) => !current)} disabled={running || savingReviewMode} aria-label={`Change review mode. Current mode: ${reviewMode === "auto_review" ? "Auto-review" : "Manual"}`} aria-haspopup="menu" aria-expanded={reviewMenuOpen} title="Change review mode">
                    {reviewMode === "auto_review" ? <ShieldCheck size={14} /> : <UserCircleCheck size={14} />}
                    <span>{reviewMode === "auto_review" ? "Auto" : "Manual"}</span>
                    <CaretDown size={10} />
                  </button>
                  {reviewMenuOpen && <div className={styles.reviewMenu} role="menu" aria-label="Change review mode">
                    <button type="button" role="menuitemradio" aria-checked={reviewMode === "manual"} onClick={() => void updateReviewMode("manual")}>
                      <UserCircleCheck size={16} /><span><strong>Manual</strong><small>You approve every proposed change.</small></span>{reviewMode === "manual" && <CheckCircle size={14} weight="fill" />}
                    </button>
                    <button type="button" role="menuitemradio" aria-checked={reviewMode === "auto_review"} onClick={() => void updateReviewMode("auto_review")}>
                      <ShieldCheck size={16} /><span><strong>Auto-review</strong><small>A separate reviewer may apply low-risk changes. Sensitive changes still wait.</small></span>{reviewMode === "auto_review" && <CheckCircle size={14} weight="fill" />}
                    </button>
                  </div>}
                </div>
                {running && !draft.trim() && !images.length
                  ? <button className={styles.stopButton} type="button" onClick={() => abortRef.current?.abort()} aria-label="Stop current response" title="Stop current response"><Stop size={13} weight="fill" /></button>
                  : <button className={styles.sendButton} type="submit" disabled={!draft.trim() && !images.length} aria-label={running ? "Queue message" : "Send message"} title={running ? "Queue after the current response" : "Send message"}><PaperPlaneRight size={15} weight="fill" /></button>}
              </div>
            </div>
          </div>
          {(running || queuedMessages.length > 0) && <span className={styles.composerStatus} role="status">{queuedMessages.length ? `${queuedMessages.length} queued` : autoReviewing ? "Reviewing change" : "Pilot is working"}</span>}
        </form>
        </> : <div className={styles.disconnected}>
          <Cpu size={22} />
          <strong>Connect Pilot to start</strong>
          <p>Test a Codex model and approve access before sending student context.</p>
          <button type="button" onClick={() => openSettings("connection")}>Open settings</button>
        </div>}
      </aside>
      {settingsOpen && <div className={styles.settingsBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
        <section className={styles.settingsDialog} role="dialog" aria-modal="true" aria-label="Pilot settings">
          <header className={styles.settingsHeader}><div><GearSix size={17} /><strong>Pilot settings</strong></div><button type="button" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={17} /></button></header>
          <div className={styles.settingsLayout}>
            <nav className={styles.settingsNav} aria-label="Pilot settings sections">
              <button type="button" className={settingsSection === "connection" ? styles.activeSetting : ""} onClick={() => setSettingsSection("connection")}><Cpu size={16} /> Connection</button>
              <button type="button" className={settingsSection === "archive" ? styles.activeSetting : ""} onClick={() => setSettingsSection("archive")}><Archive size={16} /> Archive</button>
              <button type="button" className={settingsSection === "interface" ? styles.activeSetting : ""} onClick={() => setSettingsSection("interface")}><ArrowSquareOut size={16} /> Interface</button>
            </nav>
            <div className={styles.settingsContent}>
              {settingsSection === "connection" && <div className={styles.settingsPane}>
                <div className={styles.settingsIntro}><h2>{preferences.enabled ? "Connection" : "Connect Pilot"}</h2><p>Choose the model used for assistant conversations and image context.</p></div>
                <CodexConnectionSetup compact session={session} value={setup} onChange={setSetup} />
                {error && <div className={styles.error} role="alert"><Warning size={16} /><span>{error}</span></div>}
                <div className={styles.settingsFooter}><button className={styles.saveSetup} type="button" onClick={() => void savePreferences()} disabled={savingPreferences || (setup.enabled && (!setup.approved || !setup.testedAt))}>{savingPreferences ? "Saving" : setup.enabled ? "Save connection" : "Keep AI off"}</button></div>
              </div>}
              {settingsSection === "archive" && <div className={styles.settingsPane}>
                <div className={styles.settingsIntro}><h2>Archived conversations</h2><p>Archived chats leave the history menu but keep their messages and activity.</p></div>
                {loadingArchived ? <div className={styles.settingsLoading}><ShinyText text="Loading archive" speed={1.8} /></div> : archivedConversations.length ? <div className={styles.archiveList}>{archivedConversations.map((conversation) => <div className={styles.archiveRow} key={conversation.id}><span><strong>{conversation.title}</strong><small>{new Date(conversation.updated_at).toLocaleDateString()}</small></span><button type="button" onClick={() => void updateConversationArchive(conversation.id, false)} disabled={busyArchive === conversation.id}>Restore</button></div>)}</div> : <div className={styles.archiveEmpty}><Archive size={20} /><strong>No archived conversations</strong><p>Archive a chat from the conversation menu when you no longer need it in the active list.</p></div>}
                {error && <div className={styles.error} role="alert"><Warning size={16} /><span>{error}</span></div>}
              </div>}
              {settingsSection === "interface" && <div className={styles.settingsPane}>
                <div className={styles.settingsIntro}><h2>Panel layout</h2><p>Keep Pilot attached to the workspace or move it as a floating panel.</p></div>
                <div className={styles.layoutOptions}>
                  <button type="button" className={panelMode === "docked" ? styles.selectedLayout : ""} onClick={() => changePanelMode("docked")}><PushPin size={18} /><span><strong>Docked</strong><small>Resize from the left edge while the workspace stays visible.</small></span>{panelMode === "docked" && <CheckCircle size={15} weight="fill" />}</button>
                  <button type="button" className={panelMode === "floating" ? styles.selectedLayout : ""} onClick={() => changePanelMode("floating")}><ArrowSquareOut size={18} /><span><strong>Floating</strong><small>Drag the header to move it and resize from the lower-right corner.</small></span>{panelMode === "floating" && <CheckCircle size={15} weight="fill" />}</button>
                </div>
                <button className={styles.resetLayout} type="button" onClick={resetPanelLayout}>Reset panel size and position</button>
              </div>}
            </div>
          </div>
        </section>
      </div>}
      {previewImage && <div className={styles.imagePreviewBackdrop} role="dialog" aria-modal="true" aria-label={`Preview ${previewImage.name}`} onClick={() => setPreviewImage(null)}>
        <div className={styles.imagePreview} onClick={(event) => event.stopPropagation()}>
          <div><span>{previewImage.name}</span><button type="button" onClick={() => setPreviewImage(null)} aria-label="Close image preview"><X size={18} /></button></div>
          <img src={previewImage.url} alt={previewImage.name} />
        </div>
      </div>}
    </>
  );
}
