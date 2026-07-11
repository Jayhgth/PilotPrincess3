# Product and design reference

Last reviewed: 2026-07-11

Pilot Princess is a student decision workspace, not a KPI dashboard. It helps a d.tech student understand what is finished, what is happening now, what decisions come next, and how concurrent enrollment changes the path.

## Product hierarchy

1. **Overview** answers: what is true now, what needs attention, and where should I go next?
2. **Courses** is the only place where Done, In progress, and Planned courses are organized or changed.
3. **Graduation** explains diploma, A-G, and selected associate-degree evidence.
4. **GPA planner** compares grade assumptions, workload, and college-unit guardrails for the saved schedule.
5. **Student profile** is a settings dialog for interests, capacity, and experiences.
6. **Transcript import** converts completed records into reviewable Done courses and is entered from Courses.

Do not duplicate course management, graduation totals, or action lists across destinations. Link to the owning workspace.

## Focused product surfaces

| Tool | Student job | Standout capability |
| --- | --- | --- |
| GPA planner | Understand GPA arithmetic and compare the saved schedule safely | Locked transcript baseline, expected-grade scenario, saved-schedule ceiling, target-grade calculation, UC completed-work estimate, workload context, and source-backed college-unit checks |
| Overview actions | Know the next action and why it comes next | Plan-derived and student-owned actions live beside the current path, with add, complete, delete, and reconciliation controls |
| Student profile | Preserve the context that planning needs without adding a destination | Planning priorities and a factual active/past experience register share one centered, tabbed dialog |
| Pilot Assistant | Ask across the workspace and request an exact, reviewable change | Optional onboarding connection plus a compact rail that can be resized, detached and moved, archives old conversations, shows readable work, and offers Manual or separate Auto-review routing |

The tools support students first. Counselors can use the same evidence to ask better questions, but the app does not certify eligibility or replace counseling.

Pilot Assistant is one global, contextual rail rather than a second AI panel repeated on every page. It may explain or compare deterministic scenarios, but it does not replace the owning surface or silently change the plan.

## Research synthesis

The current interaction model was checked against more than ten contemporary references:

- BigFuture interest areas and career/major exploration: interest categories should open exploration rather than prescribe one answer.
- O*NET Interest Profiler: RIASEC is useful as a vocabulary for interests; Pilot Princess uses student-selected descriptions, not a copied assessment or diagnostic score.
- Common App activity guidance: time, role, responsibility, and concrete contribution are more reusable than a generic activity count.
- Common App places activities, responsibilities, and work inside the student application profile, while transcript and current-course evidence live under Education and Courses & Grades.
- Scoir keeps activities in My Profile and puts assignments on the dashboard, supporting the decision to remove separate Experiences and Next steps destinations.
- BigFuture uses a personalized dashboard checklist rather than a standalone task product.
- UC admissions guidance: UC GPA is a separate methodology using grade 10-11 A-G work, no plus/minus distinction, and capped honors semesters.
- CaliforniaColleges.edu: academic plan, career plan, goals, experiences, documents, and tasks should connect without becoming one undifferentiated dashboard.
- Xello: grade-aware tasks, course planning, career exploration, experience hours, and resume evidence benefit from separate focused workflows.
- SMCCD K-12 guidance: prerequisites, approval, calendars, college record, and registration remain explicit concurrent-enrollment boundaries.
- CSM and the SMCCD district publish slightly different fee-free concurrent figures. The product therefore stores 11 as the conservative planning threshold, 11.5 as the district FAQ fee-free figure, and 19 as the absolute K-12 maximum instead of flattening them into one rule.
- CCSF, Foothill, and De Anza show that limits vary by district, term, unit system, grade, and approval path. Enrollment policies are data records keyed by provider, program, and term rather than application constants.
- REL/NCES career-exploration guidance: interests, career research, work-based experiences, and a portfolio create stronger exploration than keyword matching alone.
- Baymard catalog/list research: search, high-value filters, comparable rows, and honest hidden-result explanations reduce discovery friction.
- Shopify Polaris resource lists and tabs: related views use concise tabs; list rows summarize while a stable detail view owns action and evidence.
- Tailwind application UI patterns: strong alignment, restrained surfaces, predictable controls, and clear table/list density fit decision dashboards better than card grids.
- Linear, GitHub, and Stripe product patterns: hierarchy comes from spacing, typography, state, and interaction rather than outlines around every item.
- Artificial Analysis-style benchmark presentation: name the method, show the evidence behind the number, and keep comparisons aligned; do not use vague decorative bars.
- t3code: stream and fold agent work while retaining inspectable reasoning-summary, tool, file, and elapsed-time detail.
- Gemini for Workspace, Slack agents, Atlassian Rovo, GitHub Copilot, Notion AI, and Claude Artifacts: an assistant works best as a persistent secondary surface that preserves the primary task, keeps context visible, and makes permissions or changes explicit.

External references inform the local rules; they are not product requirements.

## Visual system

Use Manrope and the semantic tokens in `src/styles/global.css`. The production palette is Pilot Graphite. Dark mode uses deep neutral graphite, never a gray veil. d.tech uses official orange `#EF5024` and charcoal `#20242C` only in institution-scoped identity. SMCCD colleges use their official marks and scoped colors.

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

AI results follow progressive disclosure: user messages are compact bubbles, answers are unboxed readable text, and settled reasoning/tool work folds underneath the turn. The composer keeps page context and review mode in one quiet metadata row; image attachments appear as a compact thumbnail strip with remove and full-preview actions rather than a second upload card. Read tools run automatically. Every write begins as a visible exact proposal. Manual mode uses a focused approval card. Auto-review displays a separate reviewer decision and automatically applies only low-risk proposals; sensitive or uncertain proposals become the same manual card.

Assistant chrome stays secondary to the student's page. The docked rail uses a forgiving invisible resize target and stores its width. Floating mode preserves size and position and uses the header as the move target. Connection and archive management appear in one centered settings dialog rather than replacing chat content inside the rail. Mobile always uses a full-width rail and a bottom-aligned settings surface, with movement and resize controls removed.

The Pilot control sits in the authenticated top-right toolbar. At wide desktop sizes, the 420px rail docks without obscuring the current page; at narrower sizes it becomes a dismissible overlay and then a full-width mobile surface. Setup uses one recommended model, optional alternatives, one consent statement, one connection test, and one save action. No student is opted in by default.

Course cards are draggable from the card body, animate pickup and destination, and retain keyboard/mobile status controls. Transcript-backed courses remain locked. Workspace tabs support Left, Right, Home, and End.

## Responsive and accessibility gate

- No horizontal overflow at 390px except the intentional three-column course board, which uses a labeled horizontal viewport.
- Product text stays at or above 12px except inspectable code/telemetry detail.
- Focus is visible, state is not color-only, form labels remain explicit, and content order is meaningful.
- Review populated, empty, loading, error, editing, and selected states in both themes.
- Review representative authenticated desktop and mobile pages without console errors.
