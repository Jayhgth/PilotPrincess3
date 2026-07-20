import { CpuIcon as Cpu } from "@phosphor-icons/react";
import { useState } from "react";

export interface TranscriptAiTransparency {
  model: string;
  reasoningEffort: string;
  threadId: string | null;
  latencyMs: number;
  usage: {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
    reasoning_output_tokens: number;
  } | null;
  instruction: string;
  input: string;
  capabilities: Array<{ id: string; label: string; state: string; detail: string }>;
  events: Array<Record<string, unknown>>;
  toolsUsed: string[];
  filesChanged: string[];
  mutations: string;
}

interface TranscriptAiRunDetailsProps {
  run: TranscriptAiTransparency;
  summary?: string;
}

function readable(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function TranscriptAiRunDetails({ run, summary = "Codex run details" }: TranscriptAiRunDetailsProps) {
  const [eventsOpen, setEventsOpen] = useState(false);
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);
  const [instructionOpen, setInstructionOpen] = useState(false);

  return (
    <details className="transcript-ai-inspector">
      <summary><Cpu size={15} /> {summary}</summary>
      <div>
        <dl>
          <div><dt>Model</dt><dd>{run.model}</dd></div>
          <div><dt>Reasoning</dt><dd>{run.reasoningEffort === "low" ? "Light (SDK: low)" : readable(run.reasoningEffort)}</dd></div>
          <div><dt>Duration</dt><dd>{(run.latencyMs / 1000).toFixed(1)} seconds</dd></div>
          <div><dt>Thread</dt><dd>{run.threadId ?? "Unavailable"}</dd></div>
          <div><dt>Input</dt><dd>{run.input}</dd></div>
          <div><dt>Tokens</dt><dd>{run.usage ? `${run.usage.input_tokens} in, ${run.usage.output_tokens} out` : "Unavailable"}</dd></div>
          <div><dt>Tools</dt><dd>{run.toolsUsed.length ? run.toolsUsed.join(", ") : "No observed tool calls"}</dd></div>
          <div><dt>Files changed</dt><dd>{run.filesChanged.length ? run.filesChanged.join(", ") : "No observed file changes"}</dd></div>
        </dl>
        <p>{run.mutations}</p>
        <details className="transcript-ai-events" onToggle={(event) => setEventsOpen(event.currentTarget.open)}>
          <summary>Sanitized SDK activity ({run.events.length})</summary>
          {eventsOpen && <ol>{run.events.map((event, index) => <li key={`${String(event.type)}-${index}`}><strong>{String(event.type).replaceAll(".", " ")}</strong><pre>{JSON.stringify(event, null, 2)}</pre></li>)}</ol>}
        </details>
        <details onToggle={(event) => setCapabilitiesOpen(event.currentTarget.open)}>
          <summary>Runtime capabilities</summary>
          {capabilitiesOpen && <div className="transcript-ai-capabilities">{run.capabilities.map((capability) => <p key={capability.id}><strong>{capability.label}</strong><span>{capability.state.replaceAll("_", " ")}</span><small>{capability.detail}</small></p>)}</div>}
        </details>
        <details onToggle={(event) => setInstructionOpen(event.currentTarget.open)}>
          <summary>Exact extraction instruction</summary>
          {instructionOpen && <pre>{run.instruction}</pre>}
        </details>
      </div>
    </details>
  );
}
