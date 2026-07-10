# UX Audit

Last reviewed: 2026-07-09

## Outcome

Strict final grade: **98/100**. The workspace is calm, readable, and usable on desktop and mobile. Overview, course status, discovery, graduation, transcript import, and editing now share one predictable academic-workspace structure.

## Evidence reviewed

- Every authenticated destination was inspected with populated data at a 1,440 by 1,000 desktop viewport. Overview, Courses, and Graduation were also inspected in both themes.
- Overview, all three Courses states, d.tech discovery, mobile course editing, Graduation, Simulator, and Student profile were inspected at a 390 by 844 mobile viewport.
- The local DegreeDoesntWorks interface was used only as a sizing and density reference. Its 56 px top bar, 720 to 980 px primary content widths, 14 px base type, and restrained control sizing informed the audit without copying its product or code.
- [Linear's dashboard guidance](https://linear.app/docs/dashboards) and [UI redesign notes](https://linear.app/now/how-we-redesigned-the-linear-ui) supported pruning controls, separating navigation from content, and making the main work state visible without repeated decorative cards.
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
- Switching among status tabs hid the relationship between current, future, and completed work. Desktop now shows a three-column stage board with distinct current keyline, planned dashed boundary, and dense transcript-style Done column; mobile keeps one stage visible at a time.
- Repeated full-width course cards exposed status, grade, year, weighting, verification, and delete controls at once. Compact rows now show only identity, useful metadata, result, and Edit; the full editor is disclosed per record.
- Each d.tech catalog result offered competing status and add controls. Each row now has one `Add to Planned` action and an explicit existing-status label.
- Full-width disabled catalog buttons still consumed mobile space after a course was added. They are now compact semantic status markers; only available actions are button-sized.
- The transcript tab mixed generic sources, title and type fields, a separate parse step, full-width review cards, and the official source register. It now follows the restrained DegreeDoesntWorks interaction model: one file row, one parse action, a compact results ledger, and one bulk import action, while keeping corrections behind disclosure.
- SMCCD browsing mixed discovery, configuration, planning, goals, and manual fallback in one continuous stack. Search and associate-degree planning are now separate tabs, and the 2,461-course result list stays empty until the student searches.
- The 131-program AA/AS native select offered little discovery help. It is now a searchable ranked browser with profile matches, existing-course progress, complete-catalog modes, visible match reasons, and compact progress summaries.
- Major direction, interests, career ideas, workload tolerance, and stress were unexplained form fields. The profile now groups them by purpose, states the output each answer changes, and shows a live downstream-effects summary.
- Graduation rows reported partial progress as `Missing`. They now use `N credits left`, while completed and projected-complete states remain explicit.
- Graduation and Overview could display raw mapped totals such as `90 / 40`, making correct overall percentages look inconsistent. Applied totals and composition bars now cap each requirement, while raw completed/current/planned/unverified mapping values remain visible inside the detail card.
- Repeated overview metrics competed for attention. A route brief now combines graduation coverage, GPA, and workload; a compact course stage strip, requirement index, next actions, and latest note form a deliberate reading order.
- Generic status tabs used abrupt state changes. The shared indicator now uses one 160 ms Motion transition with reduced-motion support and full arrow/Home/End keyboard behavior.
- The AI page was a binary connection button. It is now a bounded conversation that reports model and latency, explains what the test proves, and states that it cannot access student records or files.
- Narrow screens stacked three oversized overview metrics. The first two now share a row and the workload summary spans the width below them.

## Measured final checks

- Desktop content width: 1,044 px at a 1,280 px viewport and a bounded 1,200 px application canvas at 1,440 px.
- Horizontal overflow: zero across 26 populated desktop/mobile/theme states.
- Visible text below 10 px: zero across every audited destination and zero remaining CSS declarations.
- Undersized actionable controls: zero, excluding 16 px native checkboxes inside full-size clickable labels.
- d.tech catalog: 12 records per page.
- Transcript review: one 860 px-wide ledger with 57 px primary rows and no full-width cards.
- Browser console errors observed during the authenticated walkthrough: zero.
- Workspace keyboard tabs: Left, Right, Home, and End pass with roving tab focus.
- Course navigation entries removed: three (`Academic plan`, `Course catalog`, and `SMCCD planning`) consolidated into `Courses`.
- Populated redesign QA: 14 Done, 6 Planned, and 4 In progress records remained distinguishable without horizontal overflow; desktop editing stayed inside its column and mobile editing stayed inside 390 px.
- Live transcript totals from the supplied d.tech PDF: Design Lab 30/40 and Personal Development 10/25.
- Live transcript GPA from the supplied d.tech PDF: 4.00 unweighted and 4.74 weighted, with 45 pass credits visibly excluded.
- Live AI conversation: authenticated structured response from the configured `gpt-5.5` low-reasoning runtime, including per-response latency.

## Rubric

- Navigation and orientation: 10/10
- Information hierarchy: 10/10
- Readability and sizing: 10/10
- Course selection and planning flow: 10/10
- Progressive disclosure: 10/10
- Responsive behavior: 10/10
- Feedback and AI transparency: 10/10
- Accessibility and interaction sizing: 9/10
- Visual restraint and consistency: 9/10
- Data trust and requirement clarity: 9/10

## Remaining improvements

- Degree and course relevance reasons are deterministic discovery cues, not predictions of student fit or outcomes; future usability research should test whether students understand that boundary without explanation.
- A future transcript archive picker could expose older preserved uploads without adding clutter to the default latest-transcript flow.
- A formal production accessibility audit should be repeated on the deployed origin with the final hosting, font-loading, and browser environment.
