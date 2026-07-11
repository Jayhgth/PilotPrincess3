# Codex transparency contract

Last reviewed: 2026-07-11

Pilot Princess uses Codex as an optional conversational layer over deterministic academic records. GPA, graduation, prerequisite, workload, catalog eligibility, and text-layer transcript extraction remain deterministic and usable without AI.

## Student experience

Pilot Assistant is one global, persistent rail available from the authenticated workspace after opt-in setup. It follows the useful parts of t3code and coding-agent interfaces without copying developer telemetry into a student product:

- student messages appear as compact bubbles and assistant answers as readable conversation text;
- assistant answers render sanitized GitHub Flavored Markdown, including structured lists, task lists, tables, links, blockquotes, and code fences;
- the current turn streams visible progress;
- safe reasoning summaries and actual student-data tool calls remain inspectable under that turn;
- running work shows live elapsed time, while settled work folds automatically behind a persisted **Worked for …** duration label;
- older tool calls fold behind a readable **Show more** control while pending approvals remain visible;
- every message has a timestamp and copy action, assistant replies can be retried as a preserved new turn, and unfinished text drafts remain local to that browser and conversation;
- when a missing preference blocks useful progress, Pilot can ask one to three bounded multiple-choice questions with an optional written answer instead of returning a vague paragraph;
- conversations reload from Supabase, can be renamed, continued from any workspace page, and reversibly archived; and
- page context helps answer the current question but never silently changes saved records.

Onboarding presents Codex as optional. Connecting requires a student-owned consent checkbox, a successful live test, and an allowlisted model selection. GPT-5.6 Luna with Light reasoning is recommended; the student may choose GPT-5.5 or GPT-5.4 Mini or continue without AI. Connection, archived conversations, and panel layout live in a centered settings dialog opened from the global rail.

Raw JSON, validation internals, event names, model protocol fields, and hidden chain-of-thought are not the primary interface. Errors are translated into a useful student-facing message. Sanitized technical evidence remains available to developers through server logs and tests rather than being presented as the answer.

## Allowed tools

Read tools may run automatically after a student sends a message:

- student overview;
- Done, In progress, and Planned courses;
- eligible d.tech and SMCCD catalog search;
- graduation evidence;
- next steps;
- experiences;
- planning preferences and capacity inputs;
- transcript-source labels and review state;
- the selected associate-degree goal; and
- a deterministic workload scenario.

Write tools may prepare these changes:

- add a d.tech or SMCCD course;
- move or remove an unlocked plan course;
- add or complete a next step;
- edit an unlocked plan course or planning preferences;
- add, edit, or remove an experience;
- edit or remove a student-owned next step; and
- select or clear an associate-degree goal.

Every write is an exact proposal first. The chat composer exposes two persisted review modes:

- **Manual** is the default. Every proposal appears as an approval card and nothing changes until the student chooses **Apply change**.
- **Auto-review** routes each eligible proposal to a separate isolated Codex reviewer. The reviewer sees the student's request, action name, exact arguments, and explanation, then returns `approve`, `manual`, or `deny` with a bounded risk label and student-readable summary. Only a low-risk approval may continue automatically.

Product policy overrides the reviewer and forces removals, preferred-name changes, grade edits, and marking a course Done to Manual. Medium-risk, high-risk, ambiguous, failed, or uncertain reviews also become manual approval cards. A denied proposal is recorded as not applied. Both routes execute the same server-side RLS, eligibility, prerequisite, transcript-lock, and validation rules as the normal product UI; neither the assistant nor reviewer can bypass them.

The student runtime cannot enroll at a college, approve a transcript mapping, certify graduation, claim admissions outcomes, browse the web, run shell commands, read or edit files, invoke MCP, load skills/plugins, or create subagents. New tools require an allowlisted implementation, validation schema, readable presentation, boundary tests, and an update to this document.

## Conversation and event model

Supabase stores four RLS-protected records per user:

- `ai_conversations`: title and recent activity;
- `ai_messages`: user, assistant, and completed tool outcomes;
- `ai_events`: sanitized lifecycle and reasoning-summary events; and
- `ai_tool_calls`: validated arguments, explanation, approval state, and bounded result.

The browser receives newline-delimited activity while a turn runs, then reloads the canonical persisted conversation. Tool events already represented by a persisted tool call are de-duplicated. A turn identifier keeps messages, events, and approvals grouped after reload.

Structured questions are stored in the assistant message's bounded `page_context`. A submitted answer becomes an ordinary user message linked back to that question message, so the choice remains readable in history. Retrying preserves the prior turn and submits the same text as a new turn; it never rewrites history. Unsent text drafts use conversation-scoped browser storage and are never sent until the student submits them. Image drafts remain memory-only.

After an approved mutation runs, the tool outcome stores a concise summary plus the validated fields returned by the server tool. The rail renders that as a **Change applied** receipt. This is evidence of the exact application-side mutation, not a claim made by the model.

Archiving sets the owning conversation's existing `is_archived` flag. It removes that conversation from active history without deleting messages, attachments, events, or tool calls. The student can restore it from Pilot settings. Per-user RLS applies to both actions.

## Retrieval boundary

`ai_knowledge_chunks` stores concise, source-controlled guidance about Pilot's role, page ownership, academic evidence rules, approval behavior, and answer style. Each turn uses tagged Postgres full-text search to select a bounded set of relevant chunks. The assistant timeline shows the retrieved chunk titles as **App guidance** so the student can understand which product rules shaped the answer.

Student records are not copied into the retrieval corpus. Current courses, profile fields, graduation evidence, transcript-source state, experiences, tasks, and college goals are read through allowlisted RLS-protected tools. This keeps static role guidance separate from live private data and prevents stale embeddings from becoming academic evidence.

## t3code and SDK boundary

[t3code](https://github.com/pingdotgg/t3code) is the interaction reference: a chat timeline, folded agent work, readable tools, and approval-reviewer routing. Its `auto_review` contract uses a separately prompted reviewer and risk framework rather than blind full access. Pilot Princess mirrors that concept for student-data proposals with stricter forced-manual categories. It uses the official TypeScript `@openai/codex-sdk`, not t3code's app-server transport.

Each request runs in an isolated temporary workspace and Codex home. The app replays bounded conversation history and selected page context into the turn, executes only its own allowlisted student-data tools, and deletes the temporary runtime after the request. Product persistence therefore lives in Supabase rather than Codex CLI history.

Student-attached images follow the same boundary. The composer accepts up to eight PNG, JPEG, or WebP files of at most 10 MB each through selection, paste, or drag and drop. The student sees and can remove local previews before sending. After send, originals live in a private per-user Supabase Storage path, chat history receives short-lived signed preview URLs, and the turn timeline records readable attachment names, types, and sizes without embedding image bytes in event logs. Codex receives temporary local copies only for that explicit turn; those copies are removed when the turn ends.

The SDK may emit thread/turn lifecycle, agent messages, reasoning summaries, todos, command, file, MCP, web-search, usage, and failure items. Pilot Princess preserves and renders only applicable sanitized events. It never fabricates plugin, skill, tool, file, or subagent activity. Shell, files, MCP, web, plugins, skills, and subagents are disabled, so those event classes should not occur in student turns.

## Reasoning safety

`show_raw_agent_reasoning` remains false. The interface displays concise SDK reasoning summaries such as reading the course plan or preparing a change for approval. Hidden chain-of-thought is never requested, stored, exposed, or implied.

## Isolation, privacy, and retention

Each assistant turn uses a read-only Codex sandbox, disabled network, an allowlisted child-process environment, and an empty temporary working directory. Local authenticated Codex fallback is development-only unless an operator explicitly enables it; production should use a server credential.

Selected conversation history, page context, tool results, and images explicitly attached to the current message are sent to OpenAI Codex. In Auto-review mode, the student's triggering message and the exact proposed action are also sent through a separate Codex turn for risk review. Provider-side handling follows the configured OpenAI account. Temporary local runtimes are deleted after each turn, while the product conversation, private image attachments, reviewer summary, and sanitized activity persist in Supabase until an application retention or deletion policy removes them. Per-user RLS and private storage policies prevent another student from reading or changing those records.

## Review gate

- AI starts only after explicit connection approval, a successful model test, and a student message, except an explicitly requested image-only transcript interpretation by an already-connected student.
- A read tool may run automatically. Every write begins as an exact visible proposal.
- Manual waits for the student. Auto-review may apply only an independently approved low-risk proposal; protected categories and uncertain decisions wait for the student.
- Deterministic results stay available and clearly labeled.
- Assistant failure cannot corrupt or block deterministic planning.
- Reasoning and tool labels must be human-readable; raw transport metadata is not a substitute for transparency.
- A live read must persist across reload, and a rejected write proposal must produce no product mutation.
- Onboarding and rail settings own connection approval, model choice, and health testing; the global rail owns conversation history.
