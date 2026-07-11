import {
  BrainIcon as Brain,
  CaretDownIcon as CaretDown,
  CheckCircleIcon as CheckCircle,
  ClockIcon as Clock,
  CpuIcon as Cpu,
  GearSixIcon as GearSix,
  ImageIcon as Image,
  PaperclipIcon as Paperclip,
  PaperPlaneRightIcon as PaperPlaneRight,
  PlusIcon as Plus,
  ShieldCheckIcon as ShieldCheck,
  SparkleIcon as Sparkle,
  UserCircleCheckIcon as UserCircleCheck,
  WrenchIcon as Wrench,
  WarningIcon as Warning,
  XIcon as X
} from "@phosphor-icons/react";
import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type SyntheticEvent } from "react";
import FadeContent from "@/components/reactbits/FadeContent";
import ShinyText from "@/components/reactbits/ShinyText";
import CodexConnectionSetup, { type CodexSetupValue } from "@/components/CodexConnectionSetup";
import type { AiModel, AiReviewMode } from "@/lib/ai-preferences";
import { MAX_ASSISTANT_ATTACHMENTS, validateAssistantImage } from "@/lib/ai-attachments";
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

function InlineText({ children }: { children: string }) {
  const parts = children.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    return part;
  });
}

function MessageBody({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/).filter(Boolean);
  return <div className={styles.messageBody}>{blocks.map((block, index) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    const bullets = lines.every((line) => /^[-*]\s+/.test(line));
    const numbers = lines.every((line) => /^\d+[.)]\s+/.test(line));
    if (bullets || numbers) {
      const List = numbers ? "ol" : "ul";
      return <List key={index}>{lines.map((line, lineIndex) => <li key={lineIndex}><InlineText>{line.replace(bullets ? /^[-*]\s+/ : /^\d+[.)]\s+/, "")}</InlineText></li>)}</List>;
    }
    const firstBullet = lines.findIndex((line) => /^[-*]\s+/.test(line));
    if (firstBullet > 0 && lines.slice(firstBullet).every((line) => /^[-*]\s+/.test(line))) {
      return <div className={styles.mixedBlock} key={index}>
        <p>{lines.slice(0, firstBullet).map((line, lineIndex) => <span key={lineIndex}><InlineText>{line}</InlineText>{lineIndex < firstBullet - 1 && <br />}</span>)}</p>
        <ul>{lines.slice(firstBullet).map((line, lineIndex) => <li key={lineIndex}><InlineText>{line.replace(/^[-*]\s+/, "")}</InlineText></li>)}</ul>
      </div>;
    }
    return <p key={index}>{lines.map((line, lineIndex) => <span key={lineIndex}><InlineText>{line}</InlineText>{lineIndex < lines.length - 1 && <br />}</span>)}</p>;
  })}</div>;
}

function MessageImages({ message, onPreview }: { message: AiMessage; onPreview: (image: { url: string; name: string }) => void }) {
  if (!message.attachments?.length) return null;
  return <div className={`${styles.messageImages} ${message.attachments.length === 1 ? styles.singleImage : ""}`}>
    {message.attachments.map((attachment) => <button type="button" key={attachment.id} onClick={() => onPreview({ url: attachment.preview_url, name: attachment.name })} aria-label={`Preview ${attachment.name}`}>
      {attachment.preview_url ? <img src={attachment.preview_url} alt={attachment.name} /> : <span><Image size={20} /> Preview unavailable</span>}
    </button>)}
  </div>;
}

const TOOL_LABELS: Record<string, string> = {
  get_student_overview: "Student overview",
  list_plan_courses: "Course plan",
  search_course_catalog: "Course catalog",
  get_graduation_progress: "Graduation progress",
  get_next_steps: "Next steps",
  get_experiences: "Experiences",
  get_student_profile: "Planning preferences",
  get_transcript_sources: "Transcript sources",
  get_college_goal: "College goal",
  run_load_check: "Load check",
  add_dtech_course: "Add d.tech course",
  add_smccd_course: "Add college course",
  move_plan_course: "Move course",
  remove_plan_course: "Remove course",
  update_plan_course: "Update course",
  update_student_profile: "Update planning preferences",
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
  if (event.type === "turn.failed" || itemType === "error") return { kind: "error", label: "Assistant stopped", detail: String(event.message ?? item?.message ?? "") };
  return null;
}

function TurnActivity({ events, tools, latest, running, busyTool, onDecision }: {
  events: LiveActivity[];
  tools: AiToolCall[];
  latest: boolean;
  running: boolean;
  busyTool: string | null;
  onDecision: (call: AiToolCall, decision: "confirm" | "reject") => void;
}) {
  const items = events.map(activityItem).filter((item): item is NonNullable<ReturnType<typeof activityItem>> => Boolean(item));
  const hasFailure = items.some((item) => item.kind === "error") || tools.some((tool) => tool.status === "failed");
  if (!items.length && !tools.length && !running) return null;
  return (
    <details className={styles.turnWork} open={latest || running || hasFailure || tools.some((tool) => tool.status === "pending_confirmation")}>
      <summary><span>{running ? <ShinyText text="Pilot is working" speed={1.8} /> : hasFailure ? "Work stopped" : tools.length ? `${tools.length} tool ${tools.length === 1 ? "call" : "calls"}` : "Reasoning"}</span><CaretDown size={13} /></summary>
      <div className={styles.turnWorkBody}>
        {items.map((item, index) => <details className={`${styles.workRow} ${item.kind === "error" ? styles.failed : ""}`} key={`${item.label}-${index}`} open={item.kind === "error"}>
          <summary><span className={styles.workIcon}>{item.kind === "reasoning" ? <Brain size={15} /> : item.kind === "review" ? <ShieldCheck size={15} /> : item.kind === "error" ? <Warning size={15} /> : <Clock size={15} />}</span><span><strong>{item.label}</strong>{item.detail && <small>{item.detail.slice(0, 110)}</small>}</span><CaretDown size={13} /></summary>
          {item.detail && <div className={styles.workDetails}><p>{item.detail}</p></div>}
        </details>)}
        {tools.map((tool) => <ToolCallRow key={tool.id} call={tool} busy={Boolean(busyTool)} onDecision={onDecision} />)}
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
  const [draggingImage, setDraggingImage] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ url: string; name: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(!preferences.enabled);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [setup, setSetup] = useState<CodexSetupValue>({
    enabled: preferences.enabled,
    model: preferences.model,
    approved: Boolean(preferences.approvedAt),
    testedAt: preferences.testedAt
  });
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const imagesRef = useRef<ComposerImage[]>([]);
  const suggestions = useMemo(() => contextSuggestions(pageContext), [pageContext]);

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

  useEffect(() => {
    if (!open || !preferences.enabled || settingsOpen) return;
    const loadTimer = window.setTimeout(() => void loadConversation(data.activeConversation?.id), 0);
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 180);
    return () => {
      window.clearTimeout(loadTimer);
      window.clearTimeout(focusTimer);
    };
  }, [open, preferences.enabled, settingsOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || running) return;
      if (reviewMenuOpen) setReviewMenuOpen(false);
      else onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open, reviewMenuOpen, running]);

  useEffect(() => { imagesRef.current = images; }, [images]);

  useEffect(() => () => {
    abortRef.current?.abort();
    for (const image of imagesRef.current) URL.revokeObjectURL(image.previewUrl);
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

  async function sendMessage(value?: string) {
    const message = (value ?? draft).trim();
    if ((!message && !images.length) || running) return;
    setError(null);
    let conversation = data.activeConversation;
    let optimisticId: string | null = null;
    let messagePersisted = false;
    try {
      if (!conversation) conversation = await createConversation();
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
        page_context: pageContext,
        created_at: new Date().toISOString(),
        attachments: images.map((image) => ({
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
      setRunning(true);
      const abortController = new AbortController();
      abortRef.current = abortController;
      const form = new FormData();
      form.set("conversationId", activeConversation.id);
      form.set("turnId", turnId);
      form.set("message", message);
      form.set("pageContext", JSON.stringify(pageContext));
      for (const image of images) form.append("images", image.file, image.file.name);
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
      setDraft("");
      for (const image of images) URL.revokeObjectURL(image.previewUrl);
      setImages([]);
    } catch (caught) {
      if (optimisticId) setData((current) => ({ ...current, messages: current.messages.filter((item) => item.id !== optimisticId) }));
      if (messagePersisted && conversation) {
        await loadConversation(conversation.id);
        setDraft("");
        for (const image of images) URL.revokeObjectURL(image.previewUrl);
        setImages([]);
      }
      if (!(caught instanceof DOMException && caught.name === "AbortError")) setError(caught instanceof Error ? caught.message : "Pilot could not complete that request.");
    } finally {
      setAutoReviewing(false);
      setRunning(false);
      abortRef.current = null;
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
      if (setup.enabled) setSettingsOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Pilot settings could not be saved.");
    } finally {
      setSavingPreferences(false);
    }
  }

  const activeId = data.activeConversation?.id ?? null;
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

  if (!open) return null;
  return (
    <>
      <button className={styles.backdrop} type="button" onClick={() => !running && onClose()} aria-label="Close Pilot Assistant" />
      <aside className={`${styles.drawer} ${settingsOpen ? styles.settingsDrawer : ""}`} role="dialog" aria-modal="false" aria-label="Pilot Assistant">
        <header className={styles.header}>
          {settingsOpen ? <div className={styles.settingsTitle}><Cpu size={17} /><span>Pilot setup</span></div> : <div className={styles.conversationPicker}>
            <button type="button" onClick={() => setHistoryOpen((current) => !current)} aria-expanded={historyOpen}>
              <Sparkle size={17} weight="fill" /><span>{data.activeConversation?.title ?? "Pilot Assistant"}</span><CaretDown size={13} />
            </button>
            {historyOpen && <div className={styles.historyMenu}>
              <button type="button" onClick={() => void createConversation()}><Plus size={14} /> New conversation</button>
              {data.conversations.map((conversation) => <button type="button" className={conversation.id === activeId ? styles.activeConversation : ""} key={conversation.id} onClick={() => { setHistoryOpen(false); void loadConversation(conversation.id); }}>{conversation.title}</button>)}
            </div>}
          </div>}
          <div className={styles.headerActions}>
            {!settingsOpen && <button type="button" onClick={() => void createConversation()} aria-label="New conversation"><Plus size={17} /></button>}
            {preferences.enabled && <button type="button" onClick={() => setSettingsOpen((current) => !current)} aria-label={settingsOpen ? "Return to conversation" : "Pilot settings"}>{settingsOpen ? <Sparkle size={17} /> : <GearSix size={17} />}</button>}
            <button type="button" onClick={onClose} disabled={running} aria-label="Close assistant"><X size={18} /></button>
          </div>
        </header>

        {settingsOpen ? <div className={styles.setupPane}>
          <div className={styles.setupIntro}><h2>{preferences.enabled ? "Pilot connection" : "Connect Pilot"}</h2><p>Choose one model for assistant conversations and optional image-only transcript interpretation.</p></div>
          <CodexConnectionSetup compact session={session} value={setup} onChange={setSetup} />
          {error && <div className={styles.error} role="alert"><Warning size={16} /><span>{error}</span></div>}
          <button className={styles.saveSetup} type="button" onClick={() => void savePreferences()} disabled={savingPreferences || (setup.enabled && (!setup.approved || !setup.testedAt))}>{savingPreferences ? "Saving" : setup.enabled ? "Save connection" : "Keep AI off"}</button>
        </div> : <>
        <div className={styles.timeline} ref={scrollRef}>
          {loading && !data.messages.length ? <div className={styles.loadingHistory}><ShinyText text="Opening conversation" speed={1.8} /></div> : null}
          {!loading && !data.messages.length && !running ? <div className={styles.empty}>
            <Sparkle size={24} weight="duotone" />
            <h2>Ask about your plan</h2>
            <p>Pilot can read your current records, search eligible courses, and prepare changes for your approval.</p>
            <div>{suggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => void sendMessage(suggestion)}>{suggestion}</button>)}</div>
          </div> : null}

          {data.messages.map((message) => {
            const turn = message.turn_id ? turnContent(message.turn_id) : { events: [], tools: [] };
            if (message.role === "user") return <div key={message.id} className={styles.userTurn}>
              <FadeContent className={styles.userMessage} duration={0.14}><MessageImages message={message} onPreview={setPreviewImage} />{message.content && <MessageBody text={message.content} />}</FadeContent>
              {message.turn_id && <TurnActivity events={turn.events} tools={turn.tools} latest={message.turn_id === latestTurnId} running={running && message.turn_id === latestTurnId} busyTool={busyTool} onDecision={decideTool} />}
            </div>;
            if (message.role === "assistant") return <FadeContent className={styles.assistantMessage} duration={0.16} key={message.id}><MessageBody text={message.content} /></FadeContent>;
            return <p className={styles.toolOutcome} key={message.id}><CheckCircle size={14} /> {message.content}</p>;
          })}
          {running && !data.messages.some((message) => message.turn_id === latestTurnId && message.role === "assistant") && <div className={styles.liveWorking}><ShinyText text={autoReviewing ? "Auto-review is checking" : "Pilot is working"} speed={1.8} /></div>}
          {error && <div className={styles.error} role="alert"><Warning size={16} /><span>{error}</span></div>}
        </div>

        <form className={styles.composer} onSubmit={(event: SyntheticEvent<HTMLFormElement>) => { event.preventDefault(); void sendMessage(); }}>
          <div className={styles.composerMeta}>
            <span>Using {String(pageContext.label ?? "this page")} context</span>
            <div className={styles.reviewMode} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setReviewMenuOpen(false); }}>
              <button type="button" onClick={() => setReviewMenuOpen((current) => !current)} disabled={running || savingReviewMode} aria-haspopup="menu" aria-expanded={reviewMenuOpen}>
                {reviewMode === "auto_review" ? <ShieldCheck size={14} /> : <UserCircleCheck size={14} />}
                {reviewMode === "auto_review" ? "Auto-review" : "Manual"}
                <CaretDown size={11} />
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
          </div>
          <div className={`${styles.composerSurface} ${draggingImage ? styles.draggingImage : ""}`} onDragEnter={(event) => { event.preventDefault(); setDraggingImage(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingImage(false); }} onDrop={handleDrop}>
            {images.length > 0 && <FadeContent className={styles.attachmentStrip} duration={0.14}>
              {images.map((image) => <div className={styles.attachmentThumb} key={image.id}>
                <button type="button" className={styles.previewAttachment} onClick={() => setPreviewImage({ url: image.previewUrl, name: image.file.name })} aria-label={`Preview ${image.file.name}`}><img src={image.previewUrl} alt="" /></button>
                <button type="button" className={styles.removeAttachment} onClick={() => removeImage(image.id)} disabled={running} aria-label={`Remove ${image.file.name}`}><X size={11} weight="bold" /></button>
              </div>)}
            </FadeContent>}
            <div className={styles.composerInput}>
              <input ref={fileInputRef} className={styles.fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => { addImages(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} />
              <button type="button" className={styles.attachButton} onClick={() => fileInputRef.current?.click()} disabled={running || images.length >= MAX_ASSISTANT_ATTACHMENTS} aria-label="Attach images"><Paperclip size={17} /></button>
              <textarea ref={inputRef} value={draft} onChange={(event) => setDraft(event.target.value)} onPaste={handlePaste} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder={images.length ? "Ask about these images" : "Ask Pilot"} rows={1} maxLength={4000} disabled={running} />
              <button className={styles.sendButton} type={running ? "button" : "submit"} onClick={running ? () => abortRef.current?.abort() : undefined} disabled={!running && !draft.trim() && !images.length} aria-label={running ? "Stop response" : "Send message"}>{running ? <X size={16} /> : <PaperPlaneRight size={17} weight="fill" />}</button>
            </div>
          </div>
          <small>{running ? (autoReviewing ? "A separate reviewer is checking the proposed change." : "Stop the current turn at any time.") : images.length ? `${images.length} of ${MAX_ASSISTANT_ATTACHMENTS} images ready. Images are sent only with this message.` : reviewMode === "auto_review" ? "Low-risk changes may apply after a separate review. Sensitive changes still wait for you." : "Read tools run automatically. You approve every change."}</small>
        </form>
        </>}
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
