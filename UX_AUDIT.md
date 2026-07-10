# UX Audit

Last reviewed: 2026-07-10

## Outcome

Strict UI/UX grade: **91/100**. Strict student-usefulness grade: **86/100**. The primary flow is now coherent and trustworthy enough for an MVP: completed work is visibly separate from scheduled work, Courses has one predictable interaction model, and source-backed rules are explained where they affect results. The remaining deductions are substantive product gaps, not polish points.

The repeatable implementation rules are maintained in `UI_DESIGN_SYSTEM.md`; this audit records the measured result, while that document is the reference for future UI work.

## Evidence reviewed

- Every authenticated destination was inspected with populated data at a 1,440 by 1,000 desktop viewport. Overview, Courses, and Graduation were also inspected in both themes.
- Overview, all three Courses states, d.tech discovery, mobile course editing, Graduation, Simulator, and Student profile were inspected at a 390 by 844 mobile viewport.
- The local DegreeDoesntWorks interface was used only as a sizing and density reference. Its 56 px top bar, 720 to 980 px primary content widths, 14 px base type, and restrained control sizing informed the audit without copying its product or code.
- [Linear's dashboard guidance](https://linear.app/docs/dashboards) and [UI redesign notes](https://linear.app/now/how-we-redesigned-the-linear-ui) supported pruning controls, separating navigation from content, and making the main work state visible without repeated decorative cards.
- [Linear's 2026 design refresh](https://linear.app/now/behind-the-latest-design-refresh) reinforced the rule that structure should be felt through hierarchy and density before it is drawn with borders, and that secondary chrome should not compete with the task.
- [Atlassian typography](https://atlassian.design/foundations/typography/product-typefaces-and-scale/), [spacing](https://atlassian.design/foundations/grid-beta/applying-grid), and [border](https://atlassian.design/foundations/border) guidance informed the limited type roles, 8 px-based spacing rhythm, and purposeful 1 px/selected 2 px boundary rules.
- [Carbon productive typography](https://carbondesignsystem.com/elements/typography/style-strategies/) and [form patterns](https://carbondesignsystem.com/patterns/forms-pattern/) informed the task-focused 12/14/16 px text hierarchy, top-aligned labels, concise helper text, and progressive grouping.
- [USWDS form guidance](https://designsystem.digital.gov/components/form/) supported the simple vertical reading order, semantic fieldsets, and replacement of ambiguous disabled fields with clearly read-only values.
- [Carbon dashboard guidance](https://carbondesignsystem.com/data-visualization/dashboards/) supported the overview-to-detail hierarchy and keeping requirement labels, values, and completion context together.
- [Shopify navigation guidance](https://shopify.dev/docs/apps/design/navigation) supported using compact tabs only between sibling views instead of adding more sidebar destinations.
- [React Bits](https://www.reactbits.dev/get-started/installation) was reviewed for component ideas; its Motion foundation informed the restrained shared tab indicator, while autoplay, 3D, spotlight, and ornamental effects were intentionally excluded from this planning workflow.
- Recognized portfolio references on [Awwwards](https://www.awwwards.com/creative-web-portfolios.html) informed typography, rhythm, and negative space only; portfolio interaction patterns were not copied into data-heavy planning tasks.

## Problems found and resolved

- The content canvas was too wide at up to 1,480 px. It is now capped at 1,200 px, yielding a measured 1,044 px content area at the audited desktop viewport.
- Twelve equally prominent sidebar destinations made orientation difficult. Three destinations are now primary, with transcript import and six other tools behind a clear `More tools` disclosure.
- Several labels and metadata lines were 7 to 9 px. All visible audited text is now at least 10 px, with normal product copy generally 12 to 14 px.
- Metrics were visually dominant at 48 to 54 px and 144 px tall. They are now 26 to 34 px within compact 104 px regions.
- Courses were split across Academic plan, Course catalog, SMCCD planning, transcript history, and GPA. One Courses destination now owns the editable records, with separate `In progress`, `Planned`, and `Done` lists and read-only links from outcome views.
- Switching among status tabs hid the relationship between current, future, and completed work. Courses now uses one neutral kanban ordered `Done`, `In progress`, `Planned`. The complete collapsed surface of an editable card drags across columns and provides restrained hover, pickup, overlay, and drop-target feedback; Edit stays independent. Transcript-backed rows expose a lock and never drag. Narrow screens keep the same mental model in a horizontal board.
- Repeated full-width course cards exposed status, grade, year, weighting, verification, and delete controls at once. Compact rows now show only identity, useful metadata, result, and Edit; the full editor is disclosed per record.
- Each d.tech catalog result offered competing status and add controls. Each row now has one `Add to Planned` action and an explicit existing-status label.
- Full-width disabled catalog buttons still consumed mobile space after a course was added. They are now compact semantic status markers; only available actions are button-sized.
- The transcript tab mixed generic sources, title and type fields, a separate parse step, full-width review cards, and the official source register. It now follows the restrained DegreeDoesntWorks interaction model: one file row, one parse action, a compact results ledger, and one bulk import action, while keeping corrections behind disclosure.
- SMCCD browsing mixed discovery, configuration, planning, goals, and manual fallback in one continuous stack. Search and associate-degree planning are now separate tabs, and the 2,461-course result list stays empty until the student searches.
- The 131-program AA/AS native select offered little discovery help. It is now a searchable ranked browser with profile matches, existing-course progress, complete-catalog modes, visible match reasons, and compact progress summaries.
- Major direction, interests, career ideas, workload tolerance, and stress were unexplained form fields. The profile now groups them by purpose, states the output each answer changes, and shows a live downstream-effects summary.
- Graduation rows reported partial progress as `Missing`. They now use `N credits left`, while completed and projected-complete states remain explicit.
- Graduation and Overview could display raw mapped totals such as `90 / 40`, and the prominent percentage included planned work. The headline now measures earned credit only; current, planned, open, and unverified values remain separate. Decorative composition bars were removed because their visual precision exceeded the underlying rule model.
- Laboratory Science previously behaved like one unrestricted 30-credit bucket. It now checks Biology, Chemistry, and a third science independently and states the missing lane in plain language.
- World Language previously added raw credits only. A verified Level 3/III course now grants the full 20-credit sequence requirement without inventing lower-level history, and the credit remains Done/In progress/Planned according to the actual course.
- Transcript weighting previously conflated the d.tech A-G `*` marker with Honors. Weighting now requires explicit Honors evidence for d.tech courses, every SMCCD course remains weighted, and the reviewed course title is preserved in the interface.
- Repeated overview metrics competed for attention. A route brief now combines graduation coverage, GPA, and workload; a compact course stage strip, requirement index, next actions, and latest note form a deliberate reading order.
- Generic status tabs used abrupt state changes. The shared indicator now uses one 160 ms Motion transition with reduced-motion support and full arrow/Home/End keyboard behavior.
- The AI page was a binary connection button. It is now a bounded conversation that reports model and latency, explains what the test proves, and states that it cannot access student records or files.
- Narrow screens stacked three oversized overview metrics. The first two now share a row and the workload summary spans the width below them.
- Older tools used a mixture of 10, 11, 13, 15, 17, 18, 21, and 23 px text with many near-duplicate font weights. The product now uses named supporting, body, section, numeric, page, and display-metric roles; all authenticated page audits resolve to that shared scale.
- Activity, Timeline, Simulator, and Student profile still used generic bordered form cards after the academic workspace had changed. They now use purpose-specific layouts: register plus composer, checklist plus composer, controls plus scenario output, and section-intro plus form body.
- Profile and onboarding capacity fields were verbose and visually uneven. Options are shorter, each helper states exactly how the value is used, fixed school data is read-only, and the three capacity controls share one responsive grid.
- Page headers, forms, unselected choice tiles, and list rows repeated too many visible separators. Revised views use negative space and muted surfaces first; borders are retained for controls, selected states, and major structural boundaries.

## Measured final checks

- Desktop content width: 1,044 px at a 1,280 px viewport and a bounded 1,200 px application canvas at 1,440 px.
- Horizontal overflow: zero across 26 populated desktop/mobile/theme states.
- Authenticated product typography: 12 px supporting/labels, 14 px body/controls, 16 px sections, 20 px numeric values, 28 px page titles, and 40 px single display metrics. No 10, 11, 13, 15, 17, 18, 21, or 23 px product declarations remain.
- Responsive tool audit: Activity, Timeline, Simulator, and Student profile have zero horizontal overflow at both 1,280x720 and 390x844. Onboarding capacity fields resolve to three equal desktop columns and one mobile column.
- Undersized actionable controls: zero, excluding 16 px native checkboxes inside full-size clickable labels.
- d.tech catalog: 12 records per page.
- Transcript review: one 860 px-wide ledger with 57 px primary rows and no full-width cards.
- Browser console errors observed during the authenticated walkthrough: zero.
- Workspace keyboard tabs: Left, Right, Home, and End pass with roving tab focus.
- Course navigation entries removed: three (`Academic plan`, `Course catalog`, and `SMCCD planning`) consolidated into `Courses`.
- Populated redesign QA: 14 Done, 6 Planned, and 4 In progress records remained distinguishable without horizontal overflow; desktop editing stayed inside its column and mobile editing stayed inside 390 px.
- Kanban QA: Done is leftmost; transcript Chemistry is locked; an editable course moved from In progress to Planned and changed from grade 11 to grade 12; no outer-page overflow occurred at 390x844.
- Equivalency QA: CHIN 132 resolves to `Mandarin 3 Spring`, 5 d.tech credits, and World Language `Covered in plan` at 20 planned credits from the one verified Level 3 course.
- Live transcript totals from the supplied d.tech PDF: Design Lab 30/40 and Personal Development 10/25.
- Live transcript GPA from the supplied d.tech PDF: 4.00 unweighted and 4.74 weighted, with 45 pass credits visibly excluded.
- Live AI conversation: authenticated structured response from the configured `gpt-5.5` low-reasoning runtime, including per-response latency.

## UI/UX rubric — 91/100

- Navigation and orientation: 9/10
- Information hierarchy: 9/10
- Readability and sizing: 9/10
- Course selection and planning flow: 9/10
- Progressive disclosure: 9/10
- Responsive behavior: 9/10
- Feedback and AI transparency: 9/10
- Accessibility and interaction sizing: 9/10
- Visual restraint and consistency: 10/10
- Data trust and requirement clarity: 9/10

## Student-usefulness rubric — 86/100

- Course and transcript organization: 9/10
- Transcript/GPA reliability for the supplied d.tech format: 9/10
- Graduation planning: 8/10
- SMCCD concurrent-enrollment discovery: 9/10
- Workload, major, interest, and career decision support: 8/10

## Weak points and remaining improvements

- The d.tech/SMCCD equivalency source is exact but old: the published chart says 2021. The product labels that age and asks for confirmation, but a current counselor-approved source is needed before the app can be treated as authoritative.
- The requirement engine models the documented science structure and the clarified Level 3 language rule. It does not yet provide a generalized, versioned rule system for substitutions, waivers, repeats, exceptions, or future policy changes.
- Kanban moves are immediately reversible by moving the card again, but there is no one-click undo. Horizontal drag is naturally less fluid on a 390 px screen; the Edit status selector is retained as the reliable keyboard/mobile fallback.
- The SMCCD catalog is curriculum, not a live schedule. Students still cannot see current sections, seat availability, time conflicts, instructor, or prerequisite clearance.
- Associate-degree progress includes parsed major requirements but excludes general education, residency, catalog rights, waivers, and substitutions. It is useful for discovery, not degree certification.
- Workload guidance covers entered activities and the district's college-unit workload convention. d.tech homework, commute, employment, caregiving, sleep, and recovery remain student-entered or unmodeled, so the stress/tolerance output can still be incomplete.
- Major, academic-interest, and career outputs are transparent deterministic matches, but they remain shallow compared with a guided exploration workflow using values, evidence, alternatives, and follow-up reflection.
- The latest transcript workflow is intentionally minimal; older preserved source files do not have an archive picker in the UI.
- A formal accessibility audit and student usability study are still required on the deployed production origin. The current grade is based on implementation inspection and browser QA, not research participants.
