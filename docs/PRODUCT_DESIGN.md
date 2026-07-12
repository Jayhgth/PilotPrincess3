# Product and design reference

Last reviewed: 2026-07-12

Pilot Princess is a student decision workspace, not a KPI dashboard. It helps a d.tech student understand what is finished, what is happening now, what decisions come next, and how concurrent enrollment changes the path.

## Product hierarchy

1. **Overview** answers: what is true now, what needs attention, and where should I go next?
2. **Courses** owns Done, In progress, and Planned course organization plus exact d.tech and college course selection. It does not own degree selection or degree progress.
3. **Graduation** owns d.tech diploma evidence and the complete associate-degree workspace: finding, comparing, tracking, prioritizing, and auditing AA or AS programs. Missing degree courses link into the College Courses selector without moving degree controls there.
4. **GPA planner** compares grade assumptions for the saved schedule. College-unit policy warnings belong with Courses, where the schedule changes.
5. **Transcript import** converts completed records into reviewable Done courses and is entered from Courses.
6. **Settings** is an account-level destination in the sidebar footer, beside Sign out. Opening it replaces the planning navigation with General, Planning, Pilot, and account-gated Admin sections. Appearance and student details live in General; plan scope, college enrollment type, and next steps live in Planning; all assistant configuration lives in Pilot; administrator previews and reset controls live in Admin.

Do not duplicate course management, graduation totals, or action lists across destinations. Link to the owning workspace.

Associate-degree discovery uses one search field rather than stacked mode, award, and college filters. Tracked degrees use a compact switcher. Major requirements stay attached to the selected degree, while general education is one shared section because every AA and AS includes a general education pattern. Catalog-tagged course evidence is not presented as a complete GE audit.

## Focused product surfaces

| Tool | Student job | Standout capability |
| --- | --- | --- |
| GPA planner | Understand GPA arithmetic and compare the saved schedule safely | Locked transcript baseline, expected-grade scenario, saved-schedule ceiling, target-grade calculation, and source-backed college-unit checks |
| Overview actions | Know the next action and why it comes next | Plan-derived and student-owned actions live beside the current path, with add, complete, delete, and reconciliation controls |
| Pilot Assistant | Ask across the workspace and request an exact, reviewable change | Optional onboarding connection plus a docked rail that archives old conversations, shows readable work, and offers Manual or separate Auto-review routing |

The tools support students first. Counselors can use the same evidence to ask better questions, but the app does not certify eligibility or replace counseling.

Pilot Assistant is one global, contextual rail rather than a second AI panel repeated on every page. It may explain or compare deterministic scenarios, but it does not replace the owning surface or silently change the plan.

## Research synthesis

The current interaction model was checked against more than ten contemporary references:

- BigFuture uses a personalized dashboard checklist rather than a standalone task product.
- SMCCD K-12 guidance: prerequisites, approval, calendars, college record, and registration remain explicit concurrent-enrollment boundaries.
- CSM and the SMCCD district publish slightly different fee-free concurrent figures. The product therefore stores 11 as the conservative planning threshold, 11.5 as the district FAQ fee-free figure, and 19 as the absolute K-12 maximum instead of flattening them into one rule.
- CCSF, Foothill, and De Anza show that limits vary by district, term, unit system, grade, and approval path. Enrollment policies are data records keyed by provider, program, and term rather than application constants.
- Baymard catalog/list research: search, high-value filters, comparable rows, and honest hidden-result explanations reduce discovery friction.
- Shopify Polaris resource lists and tabs: related views use concise tabs; list rows summarize while a stable detail view owns action and evidence.
- Tailwind application UI patterns: strong alignment, restrained surfaces, predictable controls, and clear table/list density fit decision dashboards better than card grids.
- Linear, GitHub, and Stripe product patterns: hierarchy comes from spacing, typography, state, and interaction rather than outlines around every item.
- Artificial Analysis-style benchmark presentation: name the method, show the evidence behind the number, and keep comparisons aligned; do not use vague decorative bars.
- t3code: stream and fold agent work while retaining inspectable reasoning-summary, tool, file, and elapsed-time detail.
- Gemini for Workspace, Slack agents, Atlassian Rovo, GitHub Copilot, Notion AI, and Claude Artifacts: an assistant works best as a persistent secondary surface that preserves the primary task, keeps context visible, and makes permissions or changes explicit.

External references inform the local rules; they are not product requirements.

## Visual system

The production interface uses DM Sans and the semantic tokens in `src/styles/global.css` and `src/styles/t3code.css`. Its retained structure follows the useful parts of t3code: a compact fixed navigation rail, dense workbench rows, restrained surfaces, and an inspectable assistant rail. Pilot Princess rose is the single product accent for navigation, focus, selection, and general actions. Dark mode uses deep neutral graphite. d.tech uses its official mark plus orange `#EF5024` and charcoal `#20242C` only in institution-scoped identity. SMCCD colleges use their official marks and scoped colors; institution colors do not replace the product accent in shared chrome.

Type roles: 28px page title, 16px section title, 14px body/control, 12px label/supporting, 20px numeric, and at most one 40px primary answer in a view. Use weights 450-650.

Spacing uses 4, 8, 12, 16, 24, 32, and 48px. Controls are at least 40px and touch targets 44px where practical. Default radii are 6-10px.

Use alignment, spacing, and surface tone before borders. A divider is reserved for control boundaries, table headers, selected states, or major regions. Never outline every row and every parent.

## Institution and state language

- Course provenance is always written, not carried by color alone.
- Done, In progress, and Planned remain distinct everywhere.
- Earned, current, planned, unverified, and open credit remain distinct.
- Ready, blocked, and needs review include text and evidence.
- d.tech, SMCCD, CSM, Skyline, and Cañada marks render through `InstitutionMark`; do not invent monograms.

## Interaction and motion

React Bits adaptations may clarify loading, selection, reveal, drag, and bounded focus. Motion is never ornamental and must respect reduced motion. Loading removes stale output when it could be mistaken for the new result.

AI results follow progressive disclosure: user messages are compact bubbles, answers are unboxed readable text, and settled reasoning/tool work folds underneath the turn. The composer keeps page context and review mode in one quiet metadata row; image attachments appear as a compact thumbnail strip with remove and full-preview actions rather than a second upload card. Read tools run automatically. Every write begins as a visible exact proposal. Manual mode uses a focused approval card. Auto-review makes an independent binary decision, then applies approved changes or declines unsupported ones without a student confirmation step.

Assistant chrome stays secondary to the student's page. The rail stays attached to the workspace, uses a forgiving invisible resize target on wide screens, and stores only its width. Archiving updates the picker optimistically without closing it; archived conversations remain restorable for 14 days. Connection, model, review mode, and archive management live in the universal Settings page. The rail contains conversation work only. Mobile uses a full-width rail with resize controls removed.

The Pilot control sits in the authenticated top-right toolbar. At wide desktop sizes, the 420px rail docks without obscuring the current page; at narrower sizes it becomes a dismissible overlay and then a full-width mobile surface. Setup uses one recommended model, optional alternatives, one consent statement, one connection test, and one save action. No student is opted in by default.

Course cards are draggable from the card body, animate pickup and destination, and retain keyboard/mobile status controls. Transcript-backed courses remain locked. Workspace tabs support Left, Right, Home, and End.

## Responsive and accessibility gate

- No horizontal overflow at 390px except the intentional three-column course board, which uses a labeled horizontal viewport.
- Product text stays at or above 12px except inspectable code/telemetry detail.
- Focus is visible, state is not color-only, form labels remain explicit, and content order is meaningful.
- Review populated, empty, loading, error, editing, and selected states in both themes.
- Review representative authenticated desktop and mobile pages without console errors.
