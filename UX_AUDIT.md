# UX Audit

Last reviewed: 2026-07-09

## Outcome

Strict final grade: **97/100**. The workspace is calm, readable, and usable on desktop and mobile. Course status, discovery, and editing now share one predictable structure.

## Evidence reviewed

- Every authenticated destination was inspected at a 1280 by 720 desktop viewport.
- Overview, unified Courses, d.tech discovery, SMCCD discovery, mobile course editing, graduation, transcript review, and AI connection were inspected at a 390 by 844 mobile viewport where applicable.
- The local DegreeDoesntWorks interface was used only as a sizing and density reference. Its 56 px top bar, 720 to 980 px primary content widths, 14 px base type, and restrained control sizing informed the audit without copying its product or code.
- Official [Tailwind Plus Application UI](https://tailwindcss.com/plus/ui-blocks/application-ui) and [sidebar shell examples](https://tailwindcss.com/plus/ui-blocks/application-ui/application-shells/sidebar) supported the decision to use one stable application shell with a compact primary navigation.
- Carbon's [progress bar guidance](https://v10.carbondesignsystem.com/components/progress-bar/usage/) supported keeping the requirement name, current value, and completion context visible together.

## Problems found and resolved

- The content canvas was too wide at up to 1,480 px. It is now capped at 1,200 px, yielding a measured 1,044 px content area at the audited desktop viewport.
- Twelve equally prominent sidebar destinations made orientation difficult. Three destinations are now primary, with transcript import and six other tools behind a clear `More tools` disclosure.
- Several labels and metadata lines were 7 to 9 px. All visible audited text is now at least 10 px, with normal product copy generally 12 to 14 px.
- Metrics were visually dominant at 48 to 54 px and 144 px tall. They are now 26 to 34 px within compact 104 px regions.
- Courses were split across Academic plan, Course catalog, SMCCD planning, transcript history, and GPA. One Courses destination now owns the editable records, with separate `In progress`, `Planned`, and `Done` lists and read-only links from outcome views.
- Repeated full-width course cards exposed status, grade, year, weighting, verification, and delete controls at once. Compact rows now show only identity, useful metadata, result, and Edit; the full editor is disclosed per record.
- Each d.tech catalog result offered competing status and add controls. Each row now has one `Add to Planned` action and an explicit existing-status label.
- The d.tech catalog produced a 4,395 px page and the transcript review queue produced a 10,657 px page. Pagination reduces the catalog to about 1,553 px and bounds review work to ten records per page.
- SMCCD browsing mixed discovery, configuration, planning, goals, and manual fallback in one continuous stack. Search and associate-degree planning are now separate tabs, and the 2,461-course result list stays empty until the student searches.
- The 131-program AA/AS native select offered little discovery help. It is now a searchable ranked browser with profile matches, existing-course progress, complete-catalog modes, visible match reasons, and compact progress summaries.
- Major direction, interests, career ideas, workload tolerance, and stress were unexplained form fields. The profile now groups them by purpose, states the output each answer changes, and shows a live downstream-effects summary.
- Graduation rows reported partial progress as `Missing`. They now use `N credits left`, while completed and projected-complete states remain explicit.
- The AI page was a binary connection button. It is now a bounded conversation that reports model and latency, explains what the test proves, and states that it cannot access student records or files.
- Narrow screens stacked three oversized overview metrics. The first two now share a row and the workload summary spans the width below them.

## Measured final checks

- Desktop content width: 1,044 px at a 1,280 px viewport.
- Horizontal overflow: zero across every audited destination.
- Visible text below 10 px: zero across every audited destination and zero remaining CSS declarations.
- Undersized actionable controls: zero, excluding 16 px native checkboxes inside full-size clickable labels.
- d.tech catalog: 12 records per page.
- Transcript review: 10 records per page.
- Browser console errors observed during the authenticated walkthrough: zero.
- Course navigation entries removed: three (`Academic plan`, `Course catalog`, and `SMCCD planning`) consolidated into `Courses`.
- Populated course QA: 12 Done, 7 Planned, and 4 In progress records remained distinguishable without horizontal overflow; add and status-move mutations updated counts immediately.
- Live transcript totals from the supplied d.tech PDF: Design Lab 30/40 and Personal Development 10/25.
- Live transcript GPA from the supplied d.tech PDF: 4.00 unweighted and 4.74 weighted, with 45 pass credits visibly excluded.
- Live AI conversation: authenticated structured response from `gpt-5.4`, including per-response latency.

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
- The transcript review queue is now bounded, but a future bulk-review mode could accelerate very large imports without weakening per-record confirmation.
- A formal production accessibility audit should be repeated on the deployed origin with the final hosting, font-loading, and browser environment.
