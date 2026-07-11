# Codex transparency contract

Last reviewed: 2026-07-11

Pilot Princess uses Codex as an optional review layer, not as the source of academic truth. Deterministic data and calculations remain available when Codex is unavailable.

## Product boundary

Codex may:

- review a student-selected plan, GPA, experience, next-step, load-check, or preference snapshot;
- structure an unstructured policy source into a pending review queue;
- interpret transcript images only when no usable text layer exists; and
- complete an explicit connection diagnostic.

Codex does not calculate GPA, graduation credit, A-G progress, degree progress, workload, prerequisites, or text-layer transcript extraction. It does not browse, enroll, approve mappings, edit saved plan data, or claim admissions outcomes.

## Student answer contract

A review result contains only:

1. one direct answer;
2. up to three observations, each tied to a supplied field or fact;
3. at most one proposed navigation action; and
4. one verification or uncertainty note.

The prompt rejects rankings, diagnoses, motivational filler, generic advice, and repeated points. An AI proposal never changes a plan. The student must perform a separate normal product action with the same RLS, prerequisite, evidence, and validation rules as any manual change.

## Inspectable run contract

The interface adapts t3code's progressive-disclosure pattern: the useful answer stays short while completed agent work folds into an inspectable run record.

Every interactive review provides three views:

- **Answer:** the moderated student result.
- **Activity:** every sanitized SDK lifecycle occurrence, grouped by item for reading. Started, updated, and completed events remain available as raw sanitized JSON.
- **Run details:** exact instruction and snapshot, model, reasoning effort, thread, duration, usage, runtime capabilities, and access limits.

Command output, MCP arguments/results, web queries, file paths, todo items, agent messages, nonfatal errors, and failure states are displayed when the SDK emits them. Payload strings are bounded before reaching the browser. A disabled capability is labeled `Disabled`; it is not misrepresented as an event with a zero count.

Image-transcript and unstructured-source extraction return the same sanitized lifecycle, thread, duration, usage, capabilities, observed tool/file activity, and exact extraction instruction after the parse completes. Their larger structured extraction output stays in the review queue rather than being presented as a planning recommendation.

## t3code and transport scope

[t3code](https://github.com/pingdotgg/t3code) is the presentation and event-architecture reference, not a claim of protocol parity.

Pilot Princess currently uses the official TypeScript `@openai/codex-sdk`, which launches Codex exec JSONL for each turn. That SDK exposes:

- thread and turn start/completion/failure;
- item start/update/completion;
- agent messages and reasoning summaries;
- todo lists;
- command, file-change, MCP, and web-search items; and
- usage and errors.

t3code uses the persistent Codex app-server protocol, which exposes additional deltas, plans, diffs, approvals, dynamic tools, plugin attribution, and subagent events. The TypeScript SDK does not expose those richer event classes. Pilot Princess therefore shows the complete event set it actually receives and a capability manifest for what is disabled or unavailable. It never fabricates skill, plugin, tool, or subagent activity.

Skills are not loaded into student review runtimes. Plugins, MCP configuration, shell, browser/computer tools, image generation, workspace dependency tools, network, hooks, file mutation, and multi-agent execution are disabled. If a future SDK adds a new item type, it must be sanitized, preserved, and given a readable projection before the feature can claim support for it.

## Reasoning safety

`show_raw_agent_reasoning` remains false and reasoning summaries are requested as concise. The interface displays SDK `reasoning` items as summaries only. Hidden chain-of-thought is never requested, stored, or implied.

## Isolation and retention

Each student review runs with:

- `sandboxMode: read-only` and `approvalPolicy: never`;
- network and web search disabled;
- shell, unified exec, apps, plugins, hooks, skills, goals, memories, and multi-agent features disabled;
- an empty temporary working directory;
- an allowlisted child-process environment;
- an isolated temporary `CODEX_HOME` containing only local authentication in development or when an operator explicitly enables that fallback; and
- `history.persistence: none`.

The selected snapshot is sent to OpenAI Codex. The working directory and isolated Codex home are deleted after the turn, and no local Codex CLI session history is retained. This does not claim that provider-side retention is disabled; provider handling follows the configured OpenAI account. Production local-login fallback is blocked unless an operator explicitly enables it, and production should use a server API key. Operational event logs store aggregate success, latency, model, usage, and event counts under the user's RLS policy; they do not store the full student snapshot, raw error text, or hidden reasoning. The browser trace is ephemeral and disappears when the page component is unmounted, but the student can explicitly download the complete sanitized run record as JSON.

## SDK event mapping

| SDK event or item | Product presentation |
| --- | --- |
| `thread.started`, `turn.started` | Read-only thread and turn lifecycle |
| `reasoning` | Expandable reasoning summary |
| `todo_list` | Agent task-list lifecycle |
| `command_execution` | Command, status, aggregate output, and exit code |
| `mcp_tool_call` | Server, tool, arguments, result/error, and status |
| `web_search` | Query and lifecycle |
| `file_change` | Exact paths, add/update/delete kind, and status |
| `agent_message` | Agent output plus the separately parsed moderated result |
| `turn.completed` | Usage and completion lifecycle |
| failure events | Visible failed state while deterministic features remain usable |

Review routes stream newline-delimited JSON with one monotonic run sequence, timestamp metadata, `no-store, no-transform`, and proxy buffering disabled. The browser batches event commits, mounts large raw payloads only when opened, separates queue wait from execution time, supports cancellation, and aborts the server request when the review component unmounts. Runtime capacity is bounded at two active and four waiting turns.

## Feature inventory and review gate

The AI connection page is the canonical inventory. A feature that starts or stops using Codex must update that inventory and this boundary in the same change.

- AI starts only after an explicit action, except visual interpretation requested by an image-only source upload.
- Stale AI output disappears while a replacement run is active.
- Deterministic results stay visible and clearly labeled.
- Failure never corrupts or blocks deterministic planning.
- No AI output is presented as counselor certification, live enrollment availability, or an admissions prediction.
