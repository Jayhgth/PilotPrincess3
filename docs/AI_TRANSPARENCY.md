# Codex transparency contract

Last reviewed: 2026-07-10

Pilot Princess uses Codex as an optional review layer, not as the source of academic truth. Deterministic data and calculations remain usable without AI.

## Product boundary

Codex may:

- review a student-selected snapshot of the plan, GPA evidence, activities, timeline, scenario, or profile;
- structure an unstructured policy source into a review queue;
- interpret transcript images only when no usable text layer exists; and
- answer a bounded connection-test message.

Codex does not calculate GPA, graduation credit, A-G progress, degree progress, workload, prerequisites, or transcript text extraction. It does not browse, edit plan records, approve source mappings, enroll in courses, or claim admissions outcomes.

## Visible run contract

The implementation adapts the event-timeline pattern used by [t3code](https://github.com/pingdotgg/t3code), especially its distinction between assistant output, reasoning summaries, tool lifecycle, changed files, elapsed time, and collapsed completed work. Pilot Princess applies the pattern to student review without copying coding-agent permissions.

Every interactive Codex review shows:

1. the exact feature instruction and supplied snapshot;
2. model, reasoning effort, thread, duration, and token usage;
3. live SDK lifecycle events;
4. Codex-provided reasoning summaries;
5. each tool, web search, command, and file-change event if one occurs;
6. an explicit `No tools used` and `No files changed` state when none occur;
7. structured findings with the supplied evidence behind each one;
8. proposed actions that navigate to the relevant deterministic workspace; and
9. limitations and unresolved questions.

Completed work may fold into a compact elapsed-time row, following t3code's approach, but details remain expandable.

## Reasoning safety

`show_raw_agent_reasoning` remains false. The interface displays SDK `reasoning` items as summaries, never hidden chain-of-thought. UI copy must say this plainly. Do not request, persist, or imply access to private reasoning.

## Mutation and access safety

Student review threads run with:

- `sandboxMode: read-only`;
- `approvalPolicy: never`;
- network and web search disabled;
- shell, unified exec, apps, plugins, hooks, and multi-agent features disabled; and
- a temporary empty working directory.

An AI proposal is not a plan mutation. Applying a suggestion requires a separate normal product action with the same validation, RLS, prerequisite, and evidence rules as any manual change.

Source interpretation has a different write boundary: Codex output may be stored only as pending review items. A student must review/import transcript rows, and policy mappings remain unverified until approved through the existing review boundary.

## SDK event mapping

| SDK event or item | Product presentation |
| --- | --- |
| `thread.started`, `turn.started` | Secure thread and review-start rows |
| `reasoning` | Expandable reasoning summary |
| `todo_list` | Review plan and completed steps |
| `command_execution` | Command, status, and exit code |
| `mcp_tool_call` | Server, tool, arguments, status, and error |
| `web_search` | Query and status |
| `file_change` | Exact paths and add/update/delete kind |
| `agent_message` | Structured review result |
| `turn.completed` | Usage and elapsed-time completion |
| failure events | Visible failed state and recoverable deterministic UI |

Review routes stream newline-delimited JSON from `runStreamed()`. The server sanitizes events before sending them to the browser and stores aggregate operational metadata in the user's RLS-protected event log.

## Feature inventory

The AI connection page is the canonical inventory. A feature that starts using Codex must be added there and must implement this disclosure contract in the same change. A feature that stops using Codex must remove the claim and any stale AI copy.

## Review gate

- AI starts only after an explicit action, except image-only source interpretation requested by an upload/parse action.
- Stale AI output disappears while a replacement run is active.
- Deterministic results remain visible and clearly labeled.
- Exact input, access boundary, tools/files, result, usage, and limits are inspectable.
- Failure never corrupts or blocks deterministic planning.
- No output is presented as counselor certification, enrollment availability, or an admissions prediction.
