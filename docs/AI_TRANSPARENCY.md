# Codex transparency contract

Last reviewed: 2026-07-11

Pilot Princess uses Codex as an optional conversational layer over deterministic academic records. GPA, graduation, prerequisite, workload, catalog eligibility, and text-layer transcript extraction remain deterministic and usable without AI.

## Student experience

Pilot Assistant is one global, persistent drawer available from the authenticated workspace. It follows the useful parts of t3code and coding-agent interfaces without copying developer telemetry into a student product:

- student messages appear as compact bubbles and assistant answers as readable conversation text;
- the current turn streams visible progress;
- safe reasoning summaries and actual student-data tool calls remain inspectable under that turn;
- completed work folds to keep the conversation calm;
- conversations reload from Supabase and can be continued from any workspace page; and
- page context helps answer the current question but never silently changes saved records.

Raw JSON, validation internals, event names, model protocol fields, and hidden chain-of-thought are not the primary interface. Errors are translated into a useful student-facing message. Sanitized technical evidence remains available to developers through server logs and tests rather than being presented as the answer.

## Allowed tools

Read tools may run automatically after a student sends a message:

- student overview;
- Done, In progress, and Planned courses;
- eligible d.tech and SMCCD catalog search;
- graduation evidence;
- next steps; and
- experiences.

Write tools may prepare these changes:

- add a d.tech or SMCCD course;
- move or remove an unlocked plan course;
- add a next step; and
- complete a next step.

Every write is a proposal first. The interface shows the tool's purpose and exact arguments in an approval card. Nothing changes until the student chooses **Apply change**. Rejection is recorded as not applied. Confirmation executes the same server-side RLS, eligibility, prerequisite, transcript-lock, and validation rules as the normal product UI; the model cannot bypass them.

The student runtime cannot enroll at a college, approve a transcript mapping, certify graduation, claim admissions outcomes, browse the web, run shell commands, read or edit files, invoke MCP, load skills/plugins, or create subagents. New tools require an allowlisted implementation, validation schema, readable presentation, boundary tests, and an update to this document.

## Conversation and event model

Supabase stores four RLS-protected records per user:

- `ai_conversations`: title and recent activity;
- `ai_messages`: user, assistant, and confirmed tool outcomes;
- `ai_events`: sanitized lifecycle and reasoning-summary events; and
- `ai_tool_calls`: validated arguments, explanation, approval state, and bounded result.

The browser receives newline-delimited activity while a turn runs, then reloads the canonical persisted conversation. Tool events already represented by a persisted tool call are de-duplicated. A turn identifier keeps messages, events, and approvals grouped after reload.

## t3code and SDK boundary

[t3code](https://github.com/pingdotgg/t3code) is the interaction reference: a chat timeline, folded agent work, readable tools, and explicit approvals. Pilot Princess uses the official TypeScript `@openai/codex-sdk`, not t3code's app-server transport.

Each request runs in an isolated temporary workspace and Codex home. The app replays bounded conversation history and selected page context into the turn, executes only its own allowlisted student-data tools, and deletes the temporary runtime after the request. Product persistence therefore lives in Supabase rather than Codex CLI history.

The SDK may emit thread/turn lifecycle, agent messages, reasoning summaries, todos, command, file, MCP, web-search, usage, and failure items. Pilot Princess preserves and renders only applicable sanitized events. It never fabricates plugin, skill, tool, file, or subagent activity. Shell, files, MCP, web, plugins, skills, and subagents are disabled, so those event classes should not occur in student turns.

## Reasoning safety

`show_raw_agent_reasoning` remains false. The interface displays concise SDK reasoning summaries such as reading the course plan or preparing a change for approval. Hidden chain-of-thought is never requested, stored, exposed, or implied.

## Isolation, privacy, and retention

Each assistant turn uses a read-only Codex sandbox, disabled network, an allowlisted child-process environment, and an empty temporary working directory. Local authenticated Codex fallback is development-only unless an operator explicitly enables it; production should use a server credential.

Selected conversation history, page context, and tool results are sent to OpenAI Codex. Provider-side handling follows the configured OpenAI account. The temporary local runtime is deleted after the turn, while the product conversation and sanitized activity persist in Supabase until an application retention or deletion policy removes them. Per-user RLS prevents another student from reading or changing those records.

## Review gate

- AI starts only after a student message, except an explicitly requested image-only transcript interpretation.
- A read tool may run automatically; a write never runs without exact confirmation.
- Deterministic results stay available and clearly labeled.
- Assistant failure cannot corrupt or block deterministic planning.
- Reasoning and tool labels must be human-readable; raw transport metadata is not a substitute for transparency.
- A live read must persist across reload, and a rejected write proposal must produce no product mutation.
- The AI connection page remains the concise capability and health check; the global drawer owns conversation history.
