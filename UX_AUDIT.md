# Product and documentation audit

Last reviewed: 2026-07-10

## Executive outcome

The MVP is technically broad and substantially functional, but it is not whole enough for an authoritative public launch. The strongest areas are transcript/GPA handling for the supplied d.tech format, one-place course organization, source provenance, and SMCCD curriculum discovery. The weakest areas are production operations, current policy authority, degree-certification boundaries, workload completeness, and the depth of major/career guidance.

Jay selected the four-year Path Overview. It now organizes the same deterministic plan data as Finished, In progress, and Next, matching the Courses kanban without retaining a demo concept switcher. See [docs/overview-path.md](./docs/overview-path.md).

Provisional strict grade before owner selection and production validation:

- UI/UX coherence: **86/100**. The primary Overview reading model is resolved and consistent with Courses, while several secondary flows still expose more capability than a first-time student can confidently interpret.
- Student usefulness: **82/100**. Course/transcript planning is useful now; policy authority, live enrollment data, deeper direction guidance, and production readiness prevent a higher score.

## Decisions Jay needs to make

### 1. Define the launch authority level

Decide whether Pilot Princess is:

- a private student planning aid;
- a d.tech-supported pilot with counselor review; or
- a public planning product.

This changes required disclaimers, trademark approval, data review workflow, support ownership, and whether prerequisite/equivalency decisions may be presented beyond `needs_review`.

### 2. Choose production operations

Select a Node host and owners for SMTP, Supabase redirects, Codex credentials, monitoring, backups, restore drills, privacy/log retention, and incident response. The build works locally, but no deployed production operating model exists.

### 3. Obtain current academic authority

Provide or authorize a reviewer for:

- the 2026-27 d.tech catalog when published;
- a current replacement or reapproval of the 2021 equivalency chart;
- substitutions, waivers, repeats, and counselor exceptions;
- SMCCD placement and prerequisite clearances; and
- the boundary between planning evidence and counselor certification.

### 4. Set the next product-depth priority

Choose one next investment:

- live SMCCD sections, seats, times, and conflicts;
- full AA/AS eligibility including GE/residency/catalog rights;
- deeper major/career exploration using values, evidence, alternatives, and reflection;
- generalized graduation exceptions; or
- workload realism including homework, commute, work, caregiving, sleep, and recovery.

Trying to expand all five product-depth areas at once would recreate the current breadth-without-depth problem.

## Concerning gaps

| Severity | Gap | Why it matters |
| --- | --- | --- |
| Launch blocker | No production host, SMTP, monitoring, backups, or retention | Local success does not prove reliable or recoverable service. |
| Authority risk | 2021 equivalency chart and no reviewed 2026-27 d.tech catalog | Credit advice can age into incorrect advice. |
| Scope risk | AA/AS view excludes GE, residency, catalog rights, substitutions, and waivers | Students may mistake major progress for degree eligibility. |
| Enrollment risk | SMCCD catalog has no live sections, seats, times, or instructors | A valid course may not be available or fit the schedule. |
| Human-review gap | No staff workflow for prerequisite clearances or policy exceptions | `needs_review` can identify a problem but cannot resolve it. |
| Guidance quality | Major/career matching is keyword-based discovery | It can surface options but cannot support a serious direction decision. |
| Workload quality | Unentered homework and life obligations are absent | Stress/tolerance output can look more complete than its inputs. |
| Research gap | No deployed accessibility audit or student usability study | Implementation inspection is not evidence that students understand it. |
| Product polish | No transcript archive picker or kanban undo | Recoverability and history are weaker than the rest of the planner. |

## What is intentionally not a blocker

- Codex is not required for text-layer PDF parsing or planning math. That is the correct boundary.
- Open email registration is intentional; production email confirmation is separate from domain policy.
- The narrow transcript import UI is intentional and should not regain a generic source-management dashboard.
- A curriculum catalog is still useful without live sections as long as the limitation remains explicit.
- Deterministic recommendations are acceptable for discovery if the product does not market them as counseling or prediction.

## Markdown inventory and disposition

Every repository Markdown file was reviewed. The set is now organized by audience instead of repeating the same implementation history.

| File | Purpose | Disposition |
| --- | --- | --- |
| `AGENTS.md` | Short working rules for Codex contributors | Kept unchanged; already concise and necessary. |
| `README.md` | Setup, architecture, decision rules, production entry | Rewritten; removed implementation-history detail and duplicate test claims. |
| `IMPLEMENTATION_STATUS.md` | Current capability, evidence, gaps, next steps | Rewritten as a snapshot; removed long chronological UI changelog. |
| `TEST_CHECKLIST.md` | Repeatable release gate | Rewritten; removed hundreds of already-proven micro-assertions and stale 84/4 counts. |
| `UI_DESIGN_SYSTEM.md` | Permanent visual and interaction rules | Rewritten; merged institution/color guidance and removed page-by-page historical narrative. |
| `UX_AUDIT.md` | Owner decisions, risks, and strict product assessment | Rewritten as this decision brief; removed the inflated final-state framing. |
| `docs/overview-path.md` | Selected Overview rationale and QA rules | Keeps the production Finished/In progress/Next decision documented. |
| `docs/prerequisite-engine.md` | Technical prerequisite policy and operating notes | Retained but shortened to the API, conservative rules, data health, and update procedure. |
| `docs/color-and-institution-system.md` | Duplicate color/brand guidance | Removed and merged into `UI_DESIGN_SYSTEM.md`. |
| `docs/overview-graduation-design-research.md` | Historical design research and iteration log | Removed and replaced by the actionable concept review. |

The previous Markdown set totaled 1,162 lines and mixed current instructions with historical accomplishments. The new set should remain near half that size. Future passes should update current facts, not append another changelog.

## Documentation ownership rules

- `README.md`: how to run and understand the system.
- `IMPLEMENTATION_STATUS.md`: what works now and what does not.
- `TEST_CHECKLIST.md`: what must pass before release.
- `UI_DESIGN_SYSTEM.md`: durable presentation rules.
- `UX_AUDIT.md`: owner decisions and product risk.
- `docs/`: deep technical or temporary decision records only.

If a fact appears in more than two files, replace duplicates with a link. Do not store test counts in the README. Do not store historical design praise in implementation status. Do not call an unresolved local MVP "final."

## Recommended sequence

1. Decide launch authority and hosting operations.
2. Update academic sources and reviewer ownership.
3. Conduct four task-based student sessions: import a transcript, understand a graduation gap, plan one d.tech course, and evaluate one SMCCD option.
4. Choose one depth investment based on observed failures rather than adding another broad tool.
