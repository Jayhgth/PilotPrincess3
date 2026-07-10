# Pilot Princess UI system

Last reviewed: 2026-07-10

This is the reference for future product UI work. It applies to the authenticated workspace, onboarding, authentication, and responsive states. Preserve the product requirements and navigation; use this system to make their presentation consistent.

## Design direction

Pilot Princess is a planning tool students return to, not a marketing dashboard. The interface should feel calm, direct, and academically credible. It uses one neutral Manrope type family, graphite surfaces, one burgundy accent, compact controls, and deliberate negative space.

Design dials:

- Variance: 4/10. Familiar product patterns with enough composition to avoid a template feel.
- Motion: 2/10. Motion communicates tab or loading state only.
- Density: 5/10. Enough context to make decisions without turning every datum into a card.

## Research basis

- [Linear's 2026 interface refresh](https://linear.app/now/behind-the-latest-design-refresh): supporting chrome should recede, elements should not compete for attention they have not earned, and structure should be felt instead of drawn with proliferating separators.
- [Linear's 2024 redesign](https://linear.app/now/how-we-redesigned-the-linear-ui): hierarchy, balance, alignment, density, and theme contrast must be tested across every view rather than fixed one screen at a time.
- [Carbon productive typography](https://carbondesignsystem.com/elements/typography/style-strategies/): task-focused product interfaces need a curated fixed type set; type roles should remain consistent inside a component or task.
- [Atlassian typography](https://atlassian.design/foundations/typography/product-typefaces-and-scale/): a limited type scale and coordinated line heights create hierarchy more reliably than arbitrary sizes and weights.
- [Atlassian spacing](https://atlassian.design/foundations/grid-beta/applying-grid): an 8px base and a limited spacing scale improve harmony and responsive density.
- [Carbon form pattern](https://carbondesignsystem.com/patterns/forms-pattern/): group related tasks, keep fields in predictable order, use top-aligned concise labels, show only necessary helper text, and progressively disclose secondary inputs.
- [USWDS form guidance](https://designsystem.digital.gov/components/form/): keep visual and DOM order aligned, use fieldsets and legends for choice groups, prefer simple vertical form flow, and avoid ambiguous disabled fields.
- [Atlassian border guidance](https://atlassian.design/foundations/border): borders must communicate a boundary or state. Standard dividers are 1px, selected and focus states are stronger, and decorative outlines have no role.

## Typography

Use Manrope everywhere. Do not introduce another font family or a display face.

| Role | Size / line height | Weight | Use |
| --- | --- | --- | --- |
| Page title | 28 / 34px | 650 | One `h1` per page or onboarding step |
| Page description | 14 / 21px | 450 | One short sentence below the page title |
| Section title | 16 / 22px | 650 | Primary content groups |
| Item title | 14 / 20px | 650 | Course, task, activity, or requirement name |
| Body | 14 / 20px | 450 | Explanations and result copy |
| Control | 14 / 20px | 500 | Input values, buttons, tabs |
| Label | 12 / 16px | 650 | Form labels and table headers |
| Supporting | 12 / 17px | 450 | Helper text, dates, units, provenance |
| Numeric value | 20 / 26px | 650 | GPA, hours, credits; use tabular figures |
| Display metric | 40 / 40px | 650 | One primary completion or coverage value per view |

Rules:

- Use only the weights 450, 500, 600, and 650. Avoid one-off values such as 680, 720, 740, or 780.
- Use sentence case. Do not use uppercase eyebrow labels or excessive letter spacing.
- A single component may use at most three type roles.
- Do not create intermediate 15, 17, 18, 21, or 23px roles; use the nearest named role.
- Labels are one to three words when possible. Helper text is a short complete sentence and never substitutes for a label.
- Use tabular numbers for GPA, hours, credits, years, and counts.

## Spacing and sizing

Use the scale `4, 8, 12, 16, 24, 32, 48` pixels. Avoid one-off values unless required for optical alignment.

- Page content: maximum 1,120px for forms and tools; Courses may use the 1,200px wide variant.
- Page top/bottom padding: 32 / 64px desktop, 24 / 48px mobile.
- Page header to first content group: 24px.
- Section gap: 32px desktop, 24px mobile.
- Form row gap: 24px; related controls inside a row: 16px.
- Inputs and selects: 44px high. Buttons: 40px standard, 32px compact.
- Choice controls: minimum 52px row height and minimum 44px touch target.
- Corner radius: 8px for interactive controls and bounded surfaces; 6px for compact nested rows. Do not mix larger decorative radii into the product.

## Surfaces and separators

Structure should be visible through alignment, spacing, and background before a line is added.

- `--bg`: application canvas.
- `--surface`: navigation and primary grouped content.
- `--surface-raised`: inputs, selected work areas, and the occasional bounded tool.
- `--surface-muted`: hover, read-only, and secondary grouping.
- `--line`: interactive control outlines or a single structural divider.
- `--line-strong`: focus, selected state, or a major region boundary only.

Separator rules:

1. Do not combine an outer card border with dividers around every child.
2. Do not draw both top and bottom rules around a section. Prefer one divider before the next major region.
3. Do not put a border under every list row. Use row padding, subtle hover fill, and grouping gaps; add a divider only between materially different groups.
4. Unselected choice tiles use a surface change, not an outline. The selected option receives the accent border and tint.
5. Form areas use negative space or a muted inset surface. A form is not automatically a card.

## Forms and choice groups

- Labels sit above controls and align to a common left edge.
- Helper text appears below the control only when it prevents a likely mistake. Keep it within the width of the field.
- Place related fields in two columns only when both values can be scanned as one row; otherwise use one column.
- Do not use placeholders for labels. Placeholder examples should be short.
- Avoid disabled text inputs. Render fixed information as a clearly labeled read-only value.
- Use fieldset and legend for every radio or checkbox group.
- Selected radio/checkbox rows must be clear by control state, accent, and text contrast, not color alone.

## Page patterns

### Secondary-page summary

- Use one shared summary surface only when the page has a primary decision value, such as weekly activity time or open timeline tasks.
- Place one primary number at left and no more than three aligned supporting values at right. Do not repeat those values in the register below.
- Collapse the summary to one column on narrow screens. Keep labels, units, and interpretation visible.
- Pages without a meaningful primary number, such as transcript import and AI connection, start directly with the task surface.

### Sidebar utilities

- Theme and sign-out controls live in the footer below school context.
- `Replay onboarding` and `View login page` may appear together above the theme control during demos only. Onboarding's permanent product home is Student profile under `Review setup`; the login preview preserves the active session and returns directly to the workspace. Retain the `data-demo-only` and intended-placement metadata until both sidebar shortcuts are removed.

### Public entry hero

- Use one full-bleed visual layer behind a short headline and one explanatory sentence. Do not add feature cards, decorative badges, or a second competing animation.
- Floating Lines is a locally owned React Bits adaptation using the same graphite and burgundy palette as the workspace. Keep its motion slow, pause it while hidden, and render a static frame when reduced motion is requested.
- The three source facts remain quiet supporting evidence. They must not compete with the sign-in task or imply guarantees beyond the cited d.tech source year.
- Keep authentication inside one compact Spotlight Card rather than treating the full right column as the form. Trust notes sit below the card so the credential boundary stays focused. Pointer and focus response may clarify the active surface, but must not tilt, shift, or interfere with input contrast.

### Onboarding

- One clear question per step with a 28px title and one short explanation.
- The step rail is orientation, not content; keep it visually quieter than the form.
- Do not outline the step header or every option. Use spacing and surface contrast.
- Priorities appear in three coherent groups: direction and interests, planning stance, then capacity limits.
- Keep Back and Continue in one predictable footer position.

### Activity planner

- Lead with one workload summary that separates activity time, total known workload, and the saved weekly limit.
- Put the current activity register before the quieter add-activity rail.
- Activities are rows with name, context, hours, and delete action. Use spacing instead of row borders.

### Timeline

- Lead with open, completed, course-check, and total counts in one summary surface.
- Put prerequisite follow-ups behind one disclosure. A student should not scan a separate warning list on every visit.
- Tasks are the primary surface. The custom-task composer is a quieter side rail.
- Editable titles should look like text until focused.
- Completion, timing, and generated provenance should be readable without competing badges.

### Simulator

- Controls form a narrow scenario setup rail.
- Results use one stable current-versus-scenario matrix. Individual comparison rows do not receive card backgrounds or dividers.
- Explanations and limits follow the comparison as plain text groups, not nested cards.

### Student profile

- Use three keyboard-accessible tabs: Basics, Direction, and Capacity. Render one editing task at a time instead of a multi-thousand-pixel form.
- Keep one focused editor beside a compact Planning impact panel that explains only the current tab's downstream effects.
- Keep school confirmation with Basics. Keep one consistent save bar below the editor and impact panel.
- Choice tiles are controls, not decoration. Unselected options use the muted surface; only the selected option receives the accent outline and tint.

### GPA

- Use one current-versus-projected comparison surface with unweighted and weighted methods in stable columns.
- Keep GPA, weighted, and excluded-pass credit totals as a compact supporting group inside the same surface.
- Keep the grade-point method visible as one plain note. Put the complete course calculation ledger behind a disclosure so the main page answers the GPA question first.

### AI connection

- Connection status, runtime metadata, and access policy share one bounded surface without cell-by-cell dividers.
- The live diagnostics chat is the primary test surface. Keep the exact Codex feature boundary table behind a separate disclosure.
- Always state what the test can access, which credential mode is active, and which deterministic features do not use Codex.

### Course kanban

- Preserve the left-to-right model `Done`, `In progress`, `Planned`. Do not reorder the stages to make the mutable state appear first.
- Keep columns neutral. Status is already communicated by position, heading, icon, and description; do not add decorative colored side rails to cards.
- A card shows only course identity, grade, credit, source/subject, and a result when one exists. Secondary controls remain behind Edit.
- The complete collapsed surface of an editable card is the drag target. A quiet grip icon signals the behavior, hover adds a small lift, pickup creates a distinct overlay, and the destination column responds. Edit is the only excluded card action, and the status selector remains the keyboard/mobile fallback.
- Motion communicates drag availability and state only. Disable the lift and pickup animation under reduced motion while preserving the interaction and focus treatment.
- On narrow screens preserve all three columns in a horizontal board rather than replacing the relationship with unrelated status tabs.

### Graduation

- Treat earned, in-progress, planned, unverified, and open credit as distinct states. Never include scheduled credit in a headline labeled completion or earned.
- Prefer exact labeled values and rule warnings over progress bars when the underlying requirement has structural rules or exceptions.
- Place source age and counselor-confirmation boundaries next to the result they qualify.
- Requirement rows are one quiet vertical register. Do not add accent rails, separate cards, or repeated outlines to each subject area.

## Review checklist

- One type family and the documented type roles only.
- No arbitrary font weights or visible text below 12px.
- No horizontal overflow at 390px.
- No outer-border-plus-row-divider duplication.
- Every separator has a structural or state purpose.
- Labels remain visible when fields contain values.
- Read-only values are not styled as disabled inputs.
- Light and dark themes preserve hierarchy and input contrast.
- Empty, populated, editing, selected, error, and mobile states are reviewed.
