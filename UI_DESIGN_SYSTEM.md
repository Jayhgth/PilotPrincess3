# Pilot Princess UI system

Last reviewed: 2026-07-10

Pilot Princess is a student decision surface, not a KPI dashboard. It should feel calm, direct, academically credible, and clearly distinguish verified work from plans and d.tech work from college work.

Design dials: variance 4/10, motion 3/10, density 5/10. Use familiar product patterns, enough composition to avoid a template feel, motion only for state and feedback, and enough context to make decisions without carding every datum.

## Foundations

Use Manrope everywhere and only the named roles below.

| Role | Size / line height | Weight | Use |
| --- | --- | --- | --- |
| Page title | 28 / 34px | 650 | One page or step title |
| Description | 14 / 21px | 450 | One sentence below a title |
| Section title | 16 / 22px | 650 | Primary group |
| Item title | 14 / 20px | 650 | Course, task, or requirement |
| Body / control | 14 / 20px | 450-500 | Explanations and controls |
| Label | 12 / 16px | 650 | Forms and table headers |
| Supporting | 12 / 17px | 450 | Dates, units, provenance |
| Numeric | 20 / 26px | 650 | GPA, credits, hours |
| Display metric | 40 / 40px | 650 | One primary result per view |

Use sentence case, tabular figures for measured values, and weights 450, 500, 600, or 650 only. Do not add intermediate type roles.

Use the spacing scale `4, 8, 12, 16, 24, 32, 48`. Product controls are 40px high, inputs 44px, and touch targets at least 44px. Use 8px radii for controls and grouped surfaces and 6px for compact rows.

The application canvas is at most 1,120px; Courses may use 1,200px. Desktop page padding is 32/64px and mobile is 24/48px.

## Color and institution identity

`Pilot Graphite` is the production palette. Semantic tokens in `src/styles/global.css` are the only styling API:

- `--bg`: application canvas.
- `--surface`: navigation and primary grouping.
- `--surface-raised`: inputs, selected work areas, and occasional bounded tools.
- `--surface-muted`: hover, read-only, and secondary grouping.
- `--ink`, `--ink-soft`, `--ink-faint`: text hierarchy.
- `--line`, `--line-strong`: control and selected-state boundaries.
- `--accent`, `--accent-soft`: Pilot Princess actions and state.
- `--success`, `--warning`, `--danger`: semantic feedback.

Dark mode uses deep neutral graphite, not a gray veil. d.tech identity uses the reviewed official orange `#EF5024` and charcoal `#20242C` only inside institution-scoped components. SMCCD and each college use official marks and scoped college colors. Every course also names its source; color never carries provenance alone.

Official marks live in `public/institutions/` and render through `InstitutionMark`. Do not improvise monograms or recolor marks. Confirm trademark approval before public launch.

## Structure

Alignment, spacing, and background establish hierarchy before a line is added.

- Do not combine an outer card border with dividers around every child.
- Do not outline every list row, choice, or form group.
- Use a divider only for a control boundary, selected state, table header, or major region change.
- Unselected choices use surface contrast; selected choices add accent and control state.
- Forms are not automatically cards.
- A component uses no more than three type roles.

## Interaction and motion

Locally owned React Bits adaptations may clarify tab selection, loading, drag state, and bounded surface focus. Do not add autoplay decoration, 3D tilt, glow, or motion unrelated to a user action.

- Motion must preserve the same information at rest.
- Respect `prefers-reduced-motion` and retain focus/keyboard behavior.
- Loading removes stale output when it could be mistaken for the new result.
- Buttons look actionable through shape, label, hover/focus, and affordance, not color alone.
- Workspace tabs support Left, Right, Home, and End.

## Core page patterns

### Overview

Use the selected Finished, In progress, and Next reading model documented in [docs/overview-path.md](./docs/overview-path.md). Keep GPA and workload as compact context, then place tasks and the latest plan note below the path. Do not repeat the same percentage or course counts in separate cards.

### Courses

Use one `Done`, `In progress`, `Planned` board in that order. The collapsed editable card is the drag target; transcript-backed Done records are locked. Show course identity, grade, credit, source/subject, and result only. Edit owns secondary controls. Preserve the three-stage relationship on narrow screens.

Catalog discovery uses `My plan`, `d.tech courses`, and `College courses` as short peer tabs. Each catalog is search-first with one visible planning year, only high-value filters, compact result rows, and one stable detail panel. Taken courses, courses outside the selected d.tech grade, lower sequential math, and prerequisite-blocked courses do not appear as selectable results. Report the hidden count in plain language. Keep `needs_review` visible when placement or human approval could make the course possible.

Result rows show only identity, source, subject/college, credit or units, and icon-plus-text readiness. Description, prerequisite evidence, equivalency, transfer status, and add controls belong in the detail panel. On narrow screens, selecting a row moves and scrolls the detail panel before the list. Use official institution marks and semantic source tokens; never create college monograms or rely on color alone. The research and eligibility contract are in [docs/catalog-experience.md](./docs/catalog-experience.md).

### Graduation

Keep earned, current, planned, unverified, and open credit distinct. Exact values and rule warnings beat progress bars. Requirement rows form one quiet evidence register; source age and counselor boundaries sit next to affected results.

### Transcript import

Use one file row, optional pasted text, one parse action, one compact review ledger, and one import action. Corrections are disclosed only when requested.

### Student profile and onboarding

Profile uses Basics, Direction, and Capacity tabs with one Planning impact explanation. Onboarding asks one question per step and keeps Back/Continue stable. The sidebar onboarding and login shortcuts are demo-only and retain placement metadata until removed.

### Secondary tools

Activity is register plus composer. Timeline is checklist plus composer. Simulator is controls plus one current/scenario matrix. GPA is one current/projected comparison with the ledger disclosed. AI connection groups runtime, access policy, live diagnostics, and exact AI boundaries without a divider grid.

### Public entry

Use one continuous near-black Floating Lines layer behind story and authentication. Authentication stays inside one compact translucent Spotlight Card with a neutral-white spotlight. Do not split the page with a flat form canvas or add competing animation.

## Review gate

- Exact state labels remain visible: Done is not planned, and verified is not inferred.
- No horizontal overflow at 390px.
- No product text below 12px.
- All controls meet touch and keyboard requirements.
- Light/dark hierarchy and input contrast pass.
- Empty, populated, editing, loading, error, selected, and reduced-motion states are reviewed.
- Representative authenticated desktop and mobile states have no console errors.

The system is informed by current guidance from Linear, Atlassian, Carbon, USWDS, and React Bits. Product rules above are the local source of truth; external examples are references, not requirements.
