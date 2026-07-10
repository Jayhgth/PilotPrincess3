# Overview and Graduation design research

Last reviewed: 2026-07-10

## Design read

This is a redesign of a student planning workspace for teenagers making course decisions. The target language is calm, direct, and evidence-first. It should feel closer to a focused benchmark comparison product than a card-heavy school portal.

Design dials:

- Design variance: 4/10. Predictable enough to scan quickly, with one strong primary composition per page.
- Motion intensity: 3/10. Motion is limited to short entrance feedback; decision-critical numbers render at their final value immediately.
- Visual density: 5/10. Enough data to compare requirements without creating a cockpit.

The current Manrope typography, neutral graphite palette, burgundy accent, navigation, routes, and underlying data semantics remain. This is a targeted structural redesign, not a new brand.

## Current audit

### Overview

- The page repeats the same graduation numbers in the route brief and requirement map.
- A large horizontal Courses row has weak button affordance, three internal dividers, and an unrelated trailing `Open` label.
- Requirement rows use a divider and a small status marker for nearly every item, producing visual noise without improving comparison.
- Next actions, requirements, workload, GPA, summary generation, and a generated note compete at nearly equal visual weight.
- Empty plan-note copy consumes a full section even when no summary exists.

### Graduation

- The summary is split with strong top, bottom, vertical, and internal grid lines.
- Each requirement repeats four labels and four values, so the page reads as scattered text instead of one comparable dataset.
- Side-color markers and repeated card outlines imply hierarchy that the data does not have.
- The current row body mixes capped applied credit with uncapped raw credit values, which makes the display harder to reconcile even though the underlying calculator is correct.
- Method and source context sits between summary and requirements instead of acting as compact metadata.

## Reference findings

### Artificial Analysis

[Artificial Analysis model comparison](https://artificialanalysis.ai/models/) leads with a clear comparison question, separates the primary index from speed and cost, states whether higher or lower is better, and keeps methodology adjacent to each measure. It uses one dimension at a time rather than placing every metric in equal cards.

Applied here:

- Lead with earned credit as the primary answer.
- Show plan coverage, scheduled work, and open credit as supporting dimensions.
- Put the exact source and interpretation beside the summary.
- Keep detailed requirement evidence available from the relevant row.

### LiveBench

[LiveBench](https://livebench.ai/) presents one stable matrix with a global score followed by category columns. Users can compare rows because labels appear once in the header instead of being repeated inside every item.

Applied here:

- Graduation requirements use one comparison header and consistent columns.
- Each row exposes Requirement, Earned, Scheduled, Open, and Status in the same positions.
- Mobile rows switch to a compact two-line summary rather than squeezing the desktop matrix.

### ARC Prize

[ARC Prize leaderboard](https://arcprize.org/leaderboard) pairs the main performance view with an explicit explanation of how to interpret the data and a separate verification policy. It distinguishes measured results from claims that still need review.

Applied here:

- Earned and scheduled credit stay visibly separate.
- Unverified mappings never enter the primary totals.
- Rule warnings and verification notes remain attached to the relevant requirement.

### Tailwind application UI

[Tailwind application UI data-display patterns](https://tailwindcss.com/plus/ui-blocks/application-ui/data-display/stats) include simple stats, shared-boundary groups, tables, description lists, and stacked lists as distinct tools. The useful principle is to choose one container for related measures and avoid wrapping every number in its own floating card.

Applied here:

- One summary surface contains the primary result and supporting figures.
- One requirement matrix handles all eight comparable areas.
- Related values use spacing and alignment before borders.

### React Bits

[React Bits](https://www.reactbits.dev/) distributes copy-owned components with TypeScript and CSS variants. The project already includes its `motion` dependency.

Applied here:

- A locally owned `CountUp` component preserves the React Bits formatting and reduced-motion behavior, but critical percentages start at their final value so a user never sees an intermediate number presented as fact.
- A reduced-motion-safe adaptation of `Animated Content` introduces major groups with a short opacity and position transition.
- Decorative backgrounds, glare, glow, and cursor effects are intentionally excluded because they would compete with planning data.

## Resulting information architecture

### Overview

1. Page title and summary-generation action.
2. One plan snapshot: earned credit, projected GPA, workload, and the most important open requirement.
3. One obvious Course plan button with a clear destination and done/current/planned counts.
4. Requirements at a glance and next actions in one balanced decision area.
5. Generated plan note only when one exists.

### Graduation

1. Page title.
2. One credit summary with earned percent, projected coverage, earned/current/planned/open totals, and source metadata.
3. One comparable requirement matrix.
4. Row-level rule notes, verification warnings, and source detail behind disclosure.

## Five-loop review protocol

1. Hierarchy: verify the primary answer is obvious in five seconds and no duplicate metric competes with it.
2. Comparison: verify every requirement can be compared across the same columns without rereading labels.
3. Affordance: verify Course plan and all disclosures look and behave like controls with keyboard focus.
4. Responsive and themes: verify 1280x720 and 390x844 in light and dark themes with no overflow or illegible states.
5. Reduction: remove any remaining line, label, wrapper, note, or animation that does not change a decision.

## Acceptance rules

- No decorative side-color bars.
- No progress track used as a substitute for exact values.
- No divider between every adjacent element.
- No duplicated credit value within the same page section.
- No raw uncapped credit presented where the label implies applied requirement credit.
- One obvious course destination with an icon, descriptive label, and directional affordance.
- Earned, scheduled, open, and unverified states remain semantically distinct.
- Both pages preserve keyboard navigation, focus visibility, dark mode, and reduced-motion behavior.

## Completed review loops

1. **Desktop hierarchy, dark:** removed the duplicated route brief, made earned credit the single primary result, and replaced the ambiguous full-width Courses strip with a clearly labeled Course plan action.
2. **Desktop comparison, dark:** replaced repeated requirement cards with one stable comparison matrix and capped every displayed value at the credit its area can accept.
3. **Interaction and density:** reduced each desktop requirement row to 70 px, moved rule and verification evidence behind a full-row disclosure, and verified keyboard-visible focus and exact 91% earned / 96% plan coverage values.
4. **Mobile, dark at 390x844:** verified both pages with no document overflow; the matrix switches to labeled Earned, Scheduled, and Open values and retains full-row disclosure targets.
5. **Desktop, light:** verified hierarchy and contrast with five structural borders on Overview, no decorative side bars, legible status colors, an obvious Course plan destination, and exact calculated values on first paint.

The final structure deliberately uses surfaces and alignment for grouping. Lines remain only around the primary summary, actionable Course plan control, and focus/control boundaries.
