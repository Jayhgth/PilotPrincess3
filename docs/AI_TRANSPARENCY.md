# Codex transparency contract

Last reviewed: 2026-07-13

Pilot Princess uses Codex as an optional conversational layer over deterministic academic records. GPA, graduation, prerequisite, catalog eligibility, and text-layer transcript extraction remain deterministic and usable without AI.

## Student experience

Pilot Assistant is one global, persistent rail available from the authenticated workspace after opt-in setup. It follows the useful parts of t3code and coding-agent interfaces without copying developer telemetry into a student product:

- student messages appear as compact bubbles and assistant answers as readable conversation text;
- assistant answers lead with the decision, default to one to three short sentences, use no more than three bullets, and are schema-bounded to 900 characters; longer detail is returned only when the student asks for it;
- assistant answers render sanitized GitHub Flavored Markdown, including structured lists, task lists, tables, links, blockquotes, and code fences;
- the current turn streams visible progress;
- safe reasoning summaries and actual student-data tool calls remain inspectable under that turn;
- running work shows live elapsed time, while settled work folds automatically behind a persisted **Worked for …** duration label;
- older tool calls fold behind a readable **Show more** control while pending approvals remain visible;
- conversational messages have one compact timestamp and copy action, while an adjacent applied-change receipt does not repeat the same turn time; assistant replies can be retried as a preserved new turn, and unfinished text drafts remain local to that browser and conversation;
- the docked rail contains one prompt surface with model selection, attachments, page context, review mode, stop, and send controls; submitted text clears immediately so the next message can be written while Pilot works;
- submitted follow-ups enter a visible five-message in-memory queue, run automatically in order, and can be removed or promoted to **Steer** next; stopping or steering records a readable cancelled-turn event before the next prompt runs;
- when a missing academic fact blocks useful progress, Pilot can ask one to three bounded multiple-choice questions with an optional written answer instead of returning a vague paragraph;
- conversations reload from Supabase, can be renamed, continued from any workspace page, and reversibly archived; and
- page context helps answer the current question but never silently changes saved records.

Onboarding presents Codex as optional. Connecting requires a student-owned consent checkbox, a successful live test, and an allowlisted model selection. GPT-5.6 Luna with Light reasoning is recommended; the student may choose GPT-5.5 or GPT-5.4 Mini or continue without AI. The universal Settings page owns the current opt-in, allowlisted model, Light/Standard/Deep reasoning level, review mode, connection test, consent, and archived conversations. The same compact allowlisted model picker is available in the chat composer. Changing a model or reasoning level does not expand tool access or bypass the normal review boundary.

Raw JSON, validation internals, event names, model protocol fields, and hidden chain-of-thought are not the primary interface. Errors are translated into a useful student-facing message. Sanitized technical evidence remains available to developers through server logs and tests rather than being presented as the answer.

## Allowed tools

Read tools may run automatically after a student sends a message:

- a compact inventory of available student-owned records;
- student overview;
- Done, In progress, and Planned courses;
- eligible d.tech and SMCCD catalog search;
- graduation evidence;
- course-level GPA inclusion and weighting evidence;
- saved-schedule GPA scenario arithmetic and the all-A ceiling;
- source-backed concurrent and dual-enrollment limits with term totals;
- deterministic schedule options from the current plan, approved catalog, open planning years, and provider limit;
- transcript-source labels and review state;
- a transcript evidence audit that compares printed GPA/credit totals, bounded source text, parsed rows, review decisions, catalog matches, and imported plan rows;
- the selected associate-degree goal;
- official SMCCD associate-program search by name, code, college, and award type; and
- deterministic selected-degree requirement progress.

Write tools may prepare these changes:

- add a d.tech or SMCCD course;
- add an exact schedule batch after showing the returned courses; Supervised mode requires a structured Yes answer, while Auto-review sends the safe-limit batch directly to its independent reviewer;
- move one or an exact set of unlocked plan courses, or remove an exact set of unlocked plan courses;
- edit an unlocked plan course;
- update whether the student's SMCCD planning context is concurrent enrollment or a dual-enrollment partnership; district thresholds remain source-backed policy;
- select or clear an associate-degree goal.

Every write is an exact proposal first. The chat composer exposes two persisted review modes:

- **Supervised** (stored as `manual`) is the default. Every proposal appears as an approval card and nothing changes until the student chooses **Apply change**.
- **Auto-review** routes each proposal to a separate isolated Codex reviewer. The reviewer sees the student's request, action name, exact arguments, and explanation, then returns `approve` or `deny` with a bounded risk label and student-readable summary. An approval executes automatically; a denial is recorded as not applied. Auto-review never turns into a student confirmation card.

Risk labels describe impact but do not create a second approval step. Explicit removals, grade edits, and moves to Done can be approved when the request and exact arguments match. Ambiguous, broader-than-requested, unsupported, or unverifiable proposals are denied automatically. A reviewer failure also declines the proposal instead of leaving it pending. Both routes execute the same server-side RLS, eligibility, prerequisite, transcript-lock, and validation rules as the normal product UI; neither the assistant nor reviewer can bypass them.

The read surface covers student-facing academic planning data, not arbitrary database access. It cannot read authentication secrets, administrator-only data, another user's records, storage paths from unrelated products, or run SQL chosen by the model. Supabase RLS still scopes every query to the authenticated student. GPA optimization is bounded to deterministic arithmetic on the saved schedule and student-supplied assumptions. Pilot must call the all-A output an all-A schedule ceiling and check graduation, prerequisites, and provider-specific enrollment constraints before proposing a course change. The student runtime cannot enroll at a college, approve a transcript mapping, certify graduation, claim admissions outcomes, browse the web, run shell commands, read or edit files, invoke MCP, load skills/plugins, or create subagents. New tools require an allowlisted implementation, validation schema, readable presentation, boundary tests, and an update to this document.

Evidence audits use a stricter rule than ordinary Q&A. Transcript-audit intent triggers the deterministic evidence tool before the model answers, so Pilot cannot return a placeholder such as “I’m checking” without doing the check. Pilot must lead with that verdict, compare the source record with the saved derived record, separate confirmed mismatches from unresolved verification, and keep downstream outcomes separate. A `needs_review` status alone is not an error, and a missing graduation requirement does not prove that a transcript was parsed incorrectly. Transcript-backed rows remain read-only in chat even when Pilot can inspect their evidence.

Schedule-generation intent also triggers its deterministic evidence tool before Pilot answers, including short requests such as “Suggest a schedule for me.” Pilot shows the exact returned courses first. In Supervised mode, it asks about the district unit limit only when the proposed schedule includes college coursework; otherwise it asks whether to add the shown schedule. In Auto-review mode, it defaults to the recommended unit limit and sends the exact batch directly to the independent reviewer without a student confirmation form. A turn may not finish with an unsupported promise to check app data later. Pilot does not claim workload personalization unless the student supplied workload information in that conversation.

## Conversation and event model

Supabase stores four RLS-protected records per user:

- `ai_conversations`: title and recent activity;
- `ai_messages`: user, assistant, and completed tool outcomes;
- `ai_events`: sanitized lifecycle and reasoning-summary events; and
- `ai_tool_calls`: validated arguments, explanation, approval state, and bounded result.

The browser receives newline-delimited activity while a turn runs, then reloads the canonical persisted conversation. Tool events already represented by a persisted tool call are de-duplicated. A turn identifier keeps messages, events, and approvals grouped after reload.

Structured questions are stored in the assistant message's bounded `page_context`. A submitted answer becomes an ordinary user message linked back to that question message, so the choice remains readable in history. Retrying preserves the prior turn and submits the same text as a new turn; it never rewrites history. Unsent text drafts use conversation-scoped browser storage and are never sent until the student submits them. Image drafts remain memory-only.

Queued follow-ups also remain browser-memory-only until their turn starts. Their text and image previews stay local while waiting; removing a queued message revokes its local image previews. **Steer** cancels the active request, records that cancellation, moves the selected follow-up to the front, and then starts it as a normal persisted turn. It does not inject text into an already-running model response or bypass the normal tool approval boundary.

After an approved mutation runs, the tool outcome stores a concise summary plus the validated fields returned by the server tool. The rail renders that as a **Change applied** receipt. Student-facing details use an allowlist, so internal row IDs, repeated counts, and raw restoration payloads are not shown. Reversible writes also store a private server-side inverse and place **Undo change** inside the receipt for 15 minutes. Undo re-authenticates the student, validates the stored inverse and time window, reapplies normal RLS ownership, records the reversal, refreshes canonical product data, and turns the same receipt into **Change undone**. This is evidence of an application-side mutation, not a claim made by the model.

Archiving records `archived_at` and immediately removes the conversation from active history. The student can restore it from the Pilot Assistant section in Settings for 14 days. Expired archives are purged when the archive is accessed; private attachment objects are removed before the conversation row, whose cascade deletes messages, events, tool calls, and attachment records. Per-user RLS applies to archive, restore, and cleanup.

Bulk plan-change language such as “remove all my in progress classes” or “mark all my planned classes in progress” triggers a deterministic `list_plan_courses` read for the requested source state before Codex responds. Pilot uses the returned stable IDs in one bounded batch proposal instead of relying on conversational memory; transcript-backed courses retain their normal protections.

## t3code and SDK boundary

[t3code](https://github.com/pingdotgg/t3code) is the interaction reference: a chat timeline, folded agent work, readable tools, and approval-reviewer routing. Its `auto_review` contract uses a separately prompted reviewer and risk framework rather than blind full access. Pilot Princess keeps that independent review while making the result autonomous: apply or decline. It uses the official TypeScript `@openai/codex-sdk`, not t3code's app-server transport.

Each request runs in an isolated temporary workspace and Codex home. The app replays bounded conversation history and selected page context into the turn, executes only its own allowlisted student-data tools, and deletes the temporary runtime after the request. Product persistence therefore lives in Supabase rather than Codex CLI history.

Student-attached images follow the same boundary. The composer accepts up to eight PNG, JPEG, or WebP files of at most 10 MB each through selection, paste, or drag and drop. The student sees and can remove local previews before sending. After send, originals live in a private per-user Supabase Storage path, chat history receives short-lived signed preview URLs, and the turn timeline records readable attachment names, types, and sizes without embedding image bytes in event logs. Codex receives temporary local copies only for that explicit turn; those copies are removed when the turn ends.

The SDK may emit thread/turn lifecycle, agent messages, reasoning summaries, todos, command, file, MCP, web-search, usage, and failure items. Pilot Princess preserves and renders only applicable sanitized events. It never fabricates plugin, skill, tool, file, or subagent activity. Shell, files, MCP, web, plugins, skills, and subagents are disabled, so those event classes should not occur in student turns.

## Reasoning safety

`show_raw_agent_reasoning` remains false. The interface displays concise SDK reasoning summaries such as reading the course plan or preparing a change for approval. Hidden chain-of-thought is never requested, stored, exposed, or implied.

## Isolation, privacy, and retention

Each assistant turn uses a read-only Codex sandbox, disabled network, an allowlisted child-process environment, and an empty temporary working directory. Local authenticated Codex fallback is development-only unless an operator explicitly enables it; production should use a server credential.

Selected conversation history, page context, tool results, and images explicitly attached to the current message are sent to OpenAI Codex. In Auto-review mode, the student's triggering message and the exact proposed action are also sent through a separate Codex turn for risk review. Provider-side handling follows the configured OpenAI account. Temporary local runtimes are deleted after each turn, while the product conversation, private image attachments, reviewer summary, and sanitized activity persist in Supabase until an application retention or deletion policy removes them. Per-user RLS and private storage policies prevent another student from reading or changing those records.

## Review gate

- Initial AI setup starts only after explicit connection approval, a successful model test, and a student message, except an explicitly requested image-only transcript interpretation by an already-connected student. Later allowlisted model or reasoning changes can be made directly from Settings or the composer; the next turn is the operational check, and failures remain non-mutating.
- A read tool may run automatically. Every write begins as an exact visible proposal.
- Manual waits for the student. Auto-review independently applies an approved exact proposal or declines it without asking for confirmation.
- Deterministic results stay available and clearly labeled.
- Assistant failure cannot corrupt or block deterministic planning.
- Reasoning and tool labels must be human-readable; raw transport metadata is not a substitute for transparency.
- Default answers must remain decision-focused and brief; a live representative answer should fit in one to three short sentences without ratings or repeated dashboard data.
- A live read must persist across reload, and a rejected write proposal must produce no product mutation.
- Onboarding and the Pilot Settings section own connection approval and health testing. Pilot Settings owns the current opt-in, model, reasoning level, and review mode; the global rail owns conversation history and exposes the current model picker.
