# Codex transparency contract

Last reviewed: 2026-07-17

Pilot Princess uses Codex as an optional conversational layer over deterministic academic records. GPA, graduation, prerequisite, catalog eligibility, and text-layer transcript extraction remain deterministic and usable without AI.

Pilot is student-directed. An explicit edit is evaluated against the scope the student requested, not against every possible academic objective. Graduation, associate-degree, GPA, workload, and sequence evidence informs recommendations and warnings when relevant, but does not turn an ordinary edit into a full-plan rebuild or block it merely because an unrelated goal remains incomplete. There are four hard boundaries: another user's or locked transcript-owned record; a nonexistent course missing the minimum custom-course facts; an impossible product state or true absolute limit; and a verified prerequisite the student has not explicitly corrected or overridden. When a broader plan cannot satisfy every objective, Pilot applies the best feasible verified result and clearly names the remaining limitation instead of returning no change.

## Student experience

Pilot Assistant is one global, persistent rail available from the authenticated workspace after opt-in setup. It follows the useful parts of t3code and coding-agent interfaces without copying developer telemetry into a student product:

- student messages appear as compact bubbles and assistant answers as readable conversation text;
- assistant answers lead with the decision and default to one to three short sentences; complete schedules and evidence audits may be longer when every choice or affected record must be explained;
- assistant answers render sanitized GitHub Flavored Markdown, including structured lists, task lists, tables, links, blockquotes, and code fences;
- the current turn streams visible progress;
- safe reasoning summaries and actual student-data tool calls remain inspectable under that turn;
- running work shows live elapsed time, while settled work folds automatically behind a persisted **Worked for …** duration label;
- older tool calls fold behind a readable **Show more** control while pending approvals remain visible;
- conversational messages have one compact timestamp and copy action, while an adjacent applied-change receipt does not repeat the same turn time; assistant replies can be retried as a preserved new turn, and unfinished text drafts remain local to that browser and conversation;
- the docked rail contains one prompt surface with model selection, right-aligned attachments, stop, and send controls; submitted text clears immediately so the next message can be written while Pilot works;
- submitted follow-ups enter a visible five-message in-memory queue, run automatically in order, and can be removed or promoted to **Steer** next; stopping or steering records a readable cancelled-turn event before the next prompt runs;
- when a missing academic fact blocks useful progress, Pilot can ask one to three bounded multiple-choice questions with an optional written answer instead of returning a vague paragraph;
- conversations reload from Supabase, can be renamed, continued from any workspace page, and reversibly archived; and
- the active app tab is not sent to Pilot and does not change its available tools, retrieval, or behavior.

Onboarding presents Codex as optional. Connecting requires a student-owned consent checkbox, a successful live test, and an allowlisted model selection. GPT-5.6 Luna with Light reasoning is recommended; the student may choose GPT-5.5 or GPT-5.4 Mini or continue without AI. The universal Settings page owns the current opt-in, allowlisted model, Light/Standard/Deep reasoning level, connection test, consent, and archived conversations. The same compact allowlisted model picker is available in the chat composer. Changing a model or reasoning level does not expand tool access or bypass the application's normal validation.

Raw JSON, validation internals, event names, model protocol fields, and hidden chain-of-thought are not the primary interface. Errors are translated into a useful student-facing message. Sanitized technical evidence remains available to developers through server logs and tests rather than being presented as the answer.

## Allowed tools

Read tools may run automatically after a student sends a message:

- a compact inventory of available student-owned records;
- one bounded cross-feature academic workspace read containing ordinary profile settings, the active plan, GPA assumptions, degree bookmarks, enrollment preference, prerequisite evidence, and optional transcript-review rows;
- student overview;
- Done, In progress, and Planned courses;
- named four-year plans and recent automatic backups, with deterministic plan-to-plan diploma, major-fit, GPA, course-count, and college-load comparison;
- active California public and charter high-school search for an exact selected-school change;
- eligible selected-school and selected-provider college catalog search;
- official selected-school diploma evidence, including explicit unavailable or unverified state;
- nearby community-college providers grouped into official districts and derived from the selected school's public address;
- course-level GPA inclusion and weighting evidence;
- current-four-year-plan GPA scenario arithmetic and the all-A ceiling;
- saved GPA-planner inclusion and expected-grade assumptions;
- source-backed concurrent and dual-enrollment limits with term totals;
- deterministic schedule options from the current plan, the selected school's approved catalog, verified diploma requirements and mappings, exact student constraints, open planning years, and provider limit;
- official prerequisite evaluation plus the student's submitted clearance evidence and independent verification state;
- transcript-source labels and review state;
- a transcript evidence audit that compares printed GPA/credit totals, bounded source text, parsed rows, review decisions, catalog matches, and imported plan rows;
- the selected associate-degree goal;
- official supported-college associate-program search by name, code, college, and award type; and
- deterministic selected-degree major, awarding-college GE, and separate graduation-requirement progress.

Write tools may prepare these changes:

- add a selected-school or SMCCD course;
- add an exact schedule batch after showing the returned courses; replacements use an atomic command and durable inverse;
- move one or an exact set of unlocked plan courses, or remove an exact set of unlocked plan courses;
- edit placement, grade, credits, units, notes, and weighting on an unlocked plan course; GPA always recalculates from these course variables rather than accepting a hardcoded GPA value;
- apply the same canonical course-board sort as the Courses page;
- save GPA-planner assumptions without changing transcript grades or course evidence;
- correct an imported transcript course while preserving the original parsed payload, the exact corrected payload, and a student-provided reason;
- submit prerequisite, placement, equivalency, challenge, approval, admission, audition, or portfolio evidence as pending; Pilot cannot approve institutional evidence;
- submit an exact evidence-backed shared school-data correction as pending; only an application administrator can publish it;
- change the selected public or charter high school while retaining existing plan rows;
- update ordinary student and planning settings plus the connected Pilot model and reasoning level, excluding AI consent, authentication, account lifecycle, validation policy, and administrator state;
- update whether the student's SMCCD planning context is concurrent enrollment or a dual-enrollment partnership; district thresholds remain source-backed policy;
- change the student's selected California community-college district using an exact district identifier returned by the nearby-provider read; this preference is reversible and does not assert enrollment eligibility;
- create, copy, open, rename, compare, and delete complete named four-year plans; broad Pilot rebuilds and clears first create an automatic backup;
- save a named snapshot, update a student-confirmed SMCCD Area 7A completion, and record Skyline's manually completed information-literacy tutorial or equivalent;
- bookmark one or several selected associate-degree goals as one reversible action, or clear a selected bookmark;
- clear editable schedule rows, degree bookmarks, and GPA assumptions as one compound action while retaining transcript-backed evidence; and
- undo an applied change from the current conversation by its exact action identifier and durable stored inverse.

Every write is an exact proposal first. Application-owned request matching, schema validation, ownership checks, and normal product commands handle exact changes. The separate reviewer is reserved for a future proposal whose scope is both ambiguous and destructive; Pilot should instead ask a bounded question whenever the student's intent can be clarified. There is no student-selectable manual/automatic review mode and no approval card that bypasses validation.

Risk labels describe impact but do not create a second approval step. Exact removals, transcript corrections, grade or credit edits, degree-goal changes, manual degree evidence, moves to Done, and schedule replacements run through their owning deterministic commands. A proposal must match the student's request and the normal product boundary; unsupported scope is clarified instead of being silently broadened. Neither the assistant nor a future reviewer can bypass RLS, ownership, transcript locks, true absolute limits, or unresolved verified prerequisites.

The read surface covers student-facing academic planning data, not arbitrary database access. It cannot read authentication secrets, administrator-only data, another user's records, storage paths from unrelated products, or run SQL chosen by the model. School catalog and diploma reads are scoped to the student's selected school; Pilot cannot borrow another school's local catalog or substitute statewide/UC eligibility layers for official diploma rules. Nearby-provider reads use the school's public address, not precise student location. Supabase RLS still scopes every query to the authenticated student. The **current four-year plan** means the active Done, In progress, and Planned rows shown in Courses; Pilot does not use the unexplained phrase “saved plan.” GPA optimization is bounded to deterministic arithmetic on that current plan and student-supplied assumptions. Pilot must call the all-A output an all-A schedule ceiling and check graduation, prerequisites, and provider-specific enrollment constraints before proposing a course change. The student runtime cannot delete an account, change authentication or AI consent, grant administrator access, enroll at a college, independently approve prerequisite evidence, a transcript mapping, or a shared institutional correction, certify graduation, claim admissions outcomes, browse the web, run shell commands, read or edit files, invoke MCP, load skills/plugins, or create subagents. New tools require an allowlisted implementation, validation schema, readable presentation, boundary tests, and an update to this document.

Evidence audits use a stricter rule than ordinary Q&A. Transcript-audit intent triggers the deterministic evidence tool before the model answers, so Pilot cannot return a placeholder such as “I’m checking” without doing the check. Pilot must lead with that verdict, compare the source record with the saved derived record, separate confirmed mismatches from unresolved verification, and keep downstream outcomes separate. High-school transcript matching loads only the source's selected-school catalog; another school's catalog identity or weighting policy is never used. d.tech's deterministic layout and intersession rules run only for d.tech-shaped transcripts, while other selected schools use the consented structured interpreter and retain every uncertain field for review. A `needs_review` status alone is not an error, and a missing graduation requirement does not prove that a transcript was parsed incorrectly. Transcript-backed rows cannot be moved or deleted as ordinary plan rows. An explicit correction instead preserves the imported proposal, stores a separate corrected payload and reason, and updates its linked completed course; weighting corrections use that explicit reviewed value and GPA then recalculates normally.

Full schedule generation retains all existing active rows unless replacement was requested and uses only the currently selected school's compact verified planning profile, catalog, diploma requirements, course mappings, grade availability, sequence, and prerequisites. The retrieved profile supplies school-specific loads, on-campus subjects, normal flow, and college-course posture without expanding Pilot's global prompt. The d.tech standard flow is used only when d.tech is selected; it is never a fallback for another school. Starting grade, starting course or math level, college-course inclusion or exclusion, workload, rigor, interests, and stated goals are acceptance criteria. The planner balances placements across the requested years and respects the chosen provider boundary. Every verified college course is weighted in the app GPA; a high-school course is weighted only when the selected school's approved evidence says so. College units remain distinct from high-school credits: official transcript credit wins, then exact selected-school equivalency, with the documented provisional unit conversion used only for GPA and planning. A college course contributes to a high-school requirement only through verified selected-school evidence. Zero loaded requirements is missing evidence, never completion. The planner revises failed candidates and, when all requested objectives cannot be completed together, may apply the best feasible schedule while reporting exact warnings and unmet objectives.

Targeted course edits use exact course commands rather than the full schedule generator. Only the affected records and directly relevant constraints are validated, and coherent multi-course edits commit atomically. A diploma gap, incomplete bookmarked degree, or non-optimal GPA is not a hard blocker unless the student asked the edit to satisfy that objective. A missing catalog course can be stored as a clearly labeled custom course only from student-supplied facts; Pilot asks for the minimum missing credit, term, weighting, and identity fields and never represents the custom row as verified institutional evidence. An explicit student correction or prerequisite override remains visibly unverified rather than being converted into institutional evidence.

Pilot may spend up to six minutes on a quality-focused planning turn. At that limit it returns the strongest verified result already available and, when the normal write boundary permits it, applies that result rather than discarding the work.

## Retrieved application guidance

Each Pilot turn retrieves a bounded set of active guidance chunks from Supabase before Codex runs. Retrieval combines PostgreSQL full-text relevance with allowlisted intent tags derived only from the student's message for school, courses, schedule, graduation, GPA, transcript, college, degree, prerequisites, settings, overview, and conversation history; required role, answer-contract, selected-school evidence, and thread-action chunks are always included. The active app tab is neither displayed in the composer nor sent as retrieval or model context, so Pilot has the same capability surface everywhere. The runtime passes chunk title, content, durable source path, and match reason to Codex, and records only retrieval metadata in the visible event stream. These chunks define product terminology and behavior but never substitute for student-record evidence, which still comes exclusively from validated read tools. Retrieval failure is recorded and falls back to the built-in safety and tool rules rather than blocking deterministic planning.

Schedule construction is one deterministic read/write contract. When college coursework is allowed, the planner automatically includes every bookmarked degree in the search and scores exact catalog courses against major requirements, the awarding college's GE pattern, separate degree requirements, total units, verified high-school overlap, prerequisites, GPA weighting, school-specific grade loads, and the saved enrollment limit. The corresponding write regenerates and validates the same result and atomically includes its college portion; the model cannot silently omit bookmarked-degree courses from an otherwise approved schedule. If the student's placement and remaining terms make every degree impossible to finish, the planner may apply a schedule that passes all diploma, sequence, workload, and enrollment checks while maximizing verified degree progress and reporting what remains.

An ordinary planning request applies one best schedule to the active named plan. When a student explicitly asks for alternatives, Pilot may create separate balanced, highest-GPA, degree-overlap, and minimum-course versions, compare their complete outcomes, switch between them, or merge selected course placements through the same atomic and reversible course boundary. Plan versions and academic evidence remain inside the selected high-school workspace; account preferences and lightweight student memory remain account-wide.

The same message selects a bounded subset from the application capability registry before the tool catalog enters the prompt. A schedule request receives course, graduation, GPA, degree, prerequisite, and enrollment capabilities; a settings request receives settings capabilities. Core inventory and undo remain available. This routing reduces prompt size and tool ambiguity without changing RAG, student memory, canonical data access, or Pilot's app-wide capability surface. Legacy SMCCD tables remain immutable history behind provider-neutral college-course, degree, requirement, and equivalency read contracts; SMCCD is the first deep provider adapter rather than a fallback for unsupported districts.

## Lightweight student memory

Pilot also retrieves RLS-scoped `ai_student_memories` relevant to the current message and page. This layer stores only explicitly stated durable preferences, goals, constraints, interests, and personal planning context under stable keys. It updates automatically after a student message without a separate save prompt and can forget a value when the student retracts it. It does not store transcripts, course rows, grades, GPA, secrets, inferred traits, or facts already owned by canonical application tables. Memory can rank equally valid schedule choices, but it cannot override catalog, graduation, prerequisite, enrollment, transcript, or review rules.

Together, the assistant uses three distinct grounding layers: retrieved application guidance explains how Pilot Princess works; validated tools read and write canonical student records and selected-school evidence; and lightweight memory personalizes choices. Shared institutional corrections are a fourth governed workflow: Pilot may submit an exact pending proposal, while an administrator alone can publish it. None of these grants arbitrary database access.

## Conversation and event model

Supabase stores five RLS-protected assistant record types per user:

- `ai_conversations`: title and recent activity;
- `ai_messages`: user, assistant, and completed tool outcomes;
- `ai_events`: sanitized lifecycle and reasoning-summary events;
- `ai_tool_calls`: validated arguments, explanation, approval state, and bounded result; and
- `ai_student_memories`: explicit lightweight personalization facts, separately deletable and exportable.

The browser receives newline-delimited activity while a turn runs, then reloads the canonical persisted conversation. Tool events already represented by a persisted tool call are de-duplicated. A turn identifier keeps messages, events, and approvals grouped after reload.

Structured questions are stored in the assistant message's bounded `page_context`. A submitted answer becomes an ordinary user message linked back to that question message, so the choice remains readable in history. Retrying preserves the prior turn and submits the same text as a new turn; it never rewrites history. Unsent text drafts use conversation-scoped browser storage and are never sent until the student submits them. Image drafts remain memory-only.

Queued follow-ups also remain browser-memory-only until their turn starts. Their text and image previews stay local while waiting; removing a queued message revokes its local image previews. **Steer** cancels the active request, records that cancellation, moves the selected follow-up to the front, and then starts it as a normal persisted turn. It does not inject text into an already-running model response or bypass the normal tool approval boundary.

After an approved mutation runs, the tool outcome stores a concise summary plus the validated fields returned by the server tool. The rail renders that as a **Change applied** receipt. Student-facing details use an allowlist, so internal row IDs, repeated counts, and raw restoration payloads are not shown. Every applied write must also store a durable private server-side inverse; execution rejects a mutation that lacks one. The receipt keeps **Undo change** available until the action is undone or a later conflicting edit makes restoration unsafe. Undo re-authenticates the student, validates the stored inverse, reapplies normal RLS ownership, refuses to overwrite newer conflicting course data, records the reversal, refreshes canonical product data, and turns the same receipt into **Change undone**. Compound changes keep all removed academic records in one inverse. This is evidence of an application-side mutation, not a claim made by the model.

Completed read and write tools form a bounded per-conversation evidence ledger. Subsequent turns receive recent public tool names, summaries, and size-limited result data so references to app information retain context; Pilot refreshes that historical evidence through the owning read tool whenever current state matters. Applied writes additionally provide their stable action identifier and current undo state, while private inverse payloads remain server-only. Referential requests such as “undo that” or “bring them back” deterministically select an eligible action and execute its stored inverse through the same review and RLS boundaries. Pilot never tries to recover removed records by querying only the current plan.

Archiving records `archived_at` and immediately removes the conversation from active history. The student can restore it from the Pilot Assistant section in Settings for 14 days. Expired archives are purged when the archive is accessed; private attachment objects are removed before the conversation row, whose cascade deletes messages, events, tool calls, and attachment records. Per-user RLS applies to archive, restore, and cleanup.

Bulk and scoped plan-change language such as “remove all my in progress classes,” “mark all my planned classes in progress,” or “clear my schedule for fall 2026” triggers a deterministic `list_plan_courses` read before Codex responds. Term-and-year requests resolve to the owning academic year and include full-year courses that occupy fall or spring. Pilot uses the returned stable IDs in one bounded batch proposal instead of relying on conversational memory; transcript-backed courses retain their normal protections and are explicitly reported as unchanged.

## t3code and SDK boundary

[t3code](https://github.com/pingdotgg/t3code) is the interaction reference: a chat timeline, folded agent work, and readable tools. Pilot Princess adds an application capability registry, deterministic validation for exact changes, and a reserved reviewer boundary for a future action that is both ambiguous and destructive. It uses the official TypeScript `@openai/codex-sdk`, not t3code's app-server transport.

Each request runs in an isolated temporary workspace and Codex home. The app replays bounded conversation history into the turn, executes only its own allowlisted student-data tools, and deletes the temporary runtime after the request. The active app tab is not part of the turn. Product persistence therefore lives in Supabase rather than Codex CLI history.

Student-attached images follow the same boundary. The composer accepts up to eight PNG, JPEG, or WebP files of at most 10 MB each through selection, paste, or drag and drop. The student sees and can remove local previews before sending. After send, originals live in a private per-user Supabase Storage path, chat history receives short-lived signed preview URLs, and the turn timeline records readable attachment names, types, and sizes without embedding image bytes in event logs. Codex receives temporary local copies only for that explicit turn; those copies are removed when the turn ends.

The SDK may emit thread/turn lifecycle, agent messages, reasoning summaries, todos, command, file, MCP, web-search, usage, and failure items. Pilot Princess preserves and renders only applicable sanitized events. It never fabricates plugin, skill, tool, file, or subagent activity. Shell, files, MCP, web, plugins, skills, and subagents are disabled, so those event classes should not occur in student turns.

## Reasoning safety

`show_raw_agent_reasoning` remains false. The interface displays concise SDK reasoning summaries such as reading the course plan or preparing a change for approval. Hidden chain-of-thought is never requested, stored, exposed, or implied.

## Isolation, privacy, and retention

Each assistant turn uses a read-only Codex sandbox, disabled network, an allowlisted child-process environment, and an empty temporary working directory. Local authenticated Codex fallback is development-only unless an operator explicitly enables it; production should use a server credential.

Selected conversation history, tool results, and images explicitly attached to the current message are sent to OpenAI Codex. When independent review is required, the student's triggering message and exact proposed action are sent through a separate Codex turn. Deterministically validated low-risk actions do not create that second model turn. Provider-side handling follows the configured OpenAI account. Temporary local runtimes are deleted after each turn, while the product conversation, private image attachments, validation/reviewer summary, and sanitized activity persist in Supabase until an application retention or deletion policy removes them. Per-user RLS and private storage policies prevent another student from reading or changing those records.

## Review gate

- Initial AI setup starts only after explicit connection approval, a successful model test, and a student message, except an explicitly requested image-only transcript interpretation by an already-connected student. Later allowlisted model or reasoning changes can be made directly from Settings or the composer; the next turn is the operational check, and failures remain non-mutating.
- A read tool may run automatically. Every write begins as an exact visible proposal.
- Exact changes use deterministic validation. Pilot asks for clarification rather than executing ambiguous destructive scope; the independent reviewer remains reserved for a future case where clarification cannot resolve both conditions.
- Deterministic results stay available and clearly labeled.
- Assistant failure cannot corrupt or block deterministic planning.
- Reasoning and tool labels must be human-readable; raw transport metadata is not a substitute for transparency.
- Default answers must remain decision-focused and brief; a live representative answer should fit in one to three short sentences without ratings or repeated dashboard data.
- A live read must persist across reload, and a rejected write proposal must produce no product mutation.
- Onboarding and the Pilot Settings section own connection approval and health testing. Pilot Settings owns the current opt-in, model, and reasoning level; the global rail owns conversation history and exposes the current model picker and image attachment control.
