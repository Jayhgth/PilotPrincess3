# Course catalog experience

Last reviewed: July 10, 2026

This document is the implementation reference for the d.tech and SMCCD course discovery surfaces. It records the research behind the interface, the eligibility rules that keep misleading options out of view, and the five review passes required before catalog changes are considered complete.

## Product job

The catalog is not an archive browser. It helps a student answer four questions in order:

1. What can I still take in the school year I am planning?
2. Which of those courses match the subject or college I care about?
3. Am I ready for the course, and what evidence supports that answer?
4. What will be added to my plan?

The official catalog remains the authority for course descriptions and prerequisites. The app narrows and explains options using the student's plan; it does not claim enrollment, seat availability, counselor approval, or a current d.tech equivalency when the source does not prove one.

## Research synthesis

### Interaction principles

- Search and the highest-value filters belong together. Baymard's product-list research repeatedly ties successful discovery to relevant filters, visible applied scope, and list information that corresponds to those filters.
- Tabs switch between closely related peer views. They should have short, scannable labels and should not substitute for primary navigation. This follows Shopify Polaris and the established application-tab pattern in Tailwind UI.
- A course row should expose only the fields needed to decide whether to inspect it. Full descriptions, prerequisite evidence, equivalency context, and the add action belong in the detail view.
- The planning year is context, not optional metadata. Eligibility changes with it, so it stays visible above the result list and is never buried in the add form.
- Unavailable choices should not masquerade as selectable results. Already represented courses, courses outside the chosen d.tech grade, lower sequential math, and prerequisite-blocked courses are removed before search results are rendered.
- Hidden results need a plain-language explanation. The interface reports that unavailable results were hidden without turning the page into an audit log.
- Source provenance is structural. d.tech uses its own mark and semantic color. College results use official CSM, Skyline, and Cañada marks plus a distinct dual-enrollment color system. Color is reinforced by names and marks.
- Motion communicates selection and result changes only. The catalog uses reduced-motion-safe React Bits adaptations for result-count and detail transitions; it avoids decorative looping motion.

### Benchmark review

| Product or system | Useful pattern | What this app adopts | What this app avoids |
| --- | --- | --- | --- |
| [Baymard product-list research](https://baymard.com/research/ecommerce-product-lists) | Filter relevance, applied scope, comparable list data | Search/filter/result hierarchy and matching metadata | Large filter sets that do not affect the decision |
| [Baymard filtering guidance](https://baymard.com/learn/ecommerce-filter-ui) | High-value filters remain easy to find | Subject, planning year, college, and transfer status only | A long advanced-filter drawer |
| [Shopify Polaris index filters](https://polaris-site-prod-kit.shopify.prod.shopifyapps.com/components/selection-and-input/index-filters) | Search, filters, sort, and views form one task surface | One discovery header and compact filter area | Duplicated search controls |
| [Shopify Polaris resource lists](https://polaris.shopify.com/components/lists/resource-list) | Rows bridge summary and detail levels | Decision-sized result rows that open details | Treating every course as a large dashboard card |
| [Shopify Polaris tabs](https://polaris.shopify.com/components/navigation/tabs) | Tabs represent alternate peer views | My plan, d.tech courses, and College courses | Long tab labels and nested primary navigation |
| [Tailwind UI tabs](https://tailwindcss.com/plus/ui-blocks/application-ui/navigation/tabs) | Compact application-level tab treatment | Familiar keyboard and visual states | Pill navigation for a full-width workspace |
| [Udemy course discovery](https://support.udemy.com/hc/en-us/articles/229232767-How-to-Search-for-Courses-on-Udemy) | Search first, then level/topic/language filters, then preview | Search-first discovery and detail preview | Promotional ranking and popularity claims |
| [edX search](https://edxsupport.zendesk.com/hc/en-us/articles/115011202847-How-do-I-search-for-a-course) | Subject, level, availability, type, and partner filters | Institution and course-type context | Filters not supported by the district data |
| [MIT OpenCourseWare](https://ocw.mit.edu/search/) | Browse by topic/department and filter content type | Subject browsing and direct search | Presenting archived material as current availability |
| [Harvard course search](https://courses.my.harvard.edu/) | Requirement and schedule-oriented academic filtering | Student-plan context and requirement evidence in details | Dense scheduling controls before a course is chosen |
| [Harvard Business School course catalog](https://www.hbs.edu/coursecatalog/) | Term-first search, eligibility context, shortlist behavior | Planning-year context and eligibility before add | A separate shortlist that duplicates the plan |
| [Harvard Law course catalog](https://hls.harvard.edu/courses/) | Clear search, filters, and reset behavior | Compact controls with predictable empty states | Scattered search controls |
| [Harvard Division of Continuing Education search](https://coursebrowser.dce.harvard.edu/) | Program requirements stay connected to course details | d.tech equivalency and degree context in the detail pane | Claiming a course fulfills a requirement without source evidence |
| [UC Berkeley classes](https://classes.berkeley.edu/) | Requirement, day, instructor, and division filters | Requirement-relevant facts stay near the course decision | Schedule filters because the app has no live section feed |
| [Berkeley Academic Guide](https://guide.berkeley.edu/courses/) | Separates the approved catalog from the live schedule | Explicit catalog-year and enrollment disclaimers | Conflating catalog inclusion with current offering |
| [Oregon State class search](https://classes.oregonstate.edu/) | Master schedule with scoped filters and relevance | Relevance after eligibility, then alphabetical stability | Ranking that hides why a result appears |
| [The New School course catalog](https://courses.newschool.edu/) | Two-level filters and removable scope | Visible planning scope plus compact source filters | Deep filter nesting for a 41-course d.tech catalog |
| [Airbnb search filters](https://www.airbnb.com/help/article/1234) | Shows high-value filters after primary trip context | Planning year first, then institution/subject | A modal for basic filters |
| [Steam search](https://store.steampowered.com/search/) | Multi-criteria discovery and preserved context | Stable selected detail and consistent source scope | Endless result grids and tag overload |
| [Apple App Store categories](https://developer.apple.com/help/app-store-connect/reference/app-information/app-store-categories/) | Primary category controls browse placement | One clear subject/college identity per result | Multiple competing taxonomies in the row |

The research does not justify copying a commerce interface literally. The adopted pattern is a compact academic master-detail browser: the left side supports discovery and comparison, while the right side explains one consequential choice with official-source context.

## Information architecture

### Courses workspace tabs

- **My plan:** completed, current, and planned courses in the kanban workflow.
- **d.tech courses:** eligible high-school courses for one selected planning grade.
- **College courses:** eligible SMCCD catalog courses plus the related associate-degree view.

Within College courses, `Find courses` and `Associate degree` remain peer tools. The three college selectors are filters, not navigation tabs.

### Result row

Every visible result must provide:

- official course name and code when one exists;
- source identity through text and an official mark;
- subject or college;
- credits or units;
- selected planning grade for d.tech;
- transfer status for SMCCD when the source supplies it;
- readiness with an icon and text, not color alone.

### Detail panel

The detail panel contains:

- source and course identity;
- decision facts in a compact two-column definition list;
- official description when available;
- profile-fit reasons only when they are specific;
- prerequisite status and evidence;
- SMCCD transfer, degree applicability, general education, and d.tech equivalency data;
- fixed planning year, editable term, and the add action.

## Eligibility rules

### Shared

- A course already represented in the active plan is excluded regardless of completed, current, or planned status.
- Exact catalog IDs are preferred. Normalized names and course codes close transcript/manual-entry gaps.
- A blocked prerequisite evaluation excludes the result for the selected planning year.
- A `needs_review` result remains visible because placement, counselor approval, or ambiguous source language may still make the course possible. The detail view must state what needs review.
- UI checks are repeated in the add mutation handler so stale selections cannot bypass eligibility.

### d.tech

- The grade selector contains only the student's saved planning window.
- A course is visible only when its official `grade_levels` includes the selected grade.
- The reviewed sequential math spine is Algebra 1, Geometry, Algebra 2, Precalculus, Calculus.
- Completing or currently taking a spine course removes that course family and lower spine courses. Lateral courses such as Advanced Statistics and Discrete Math are not assigned an invented rank.
- Standard/honors aliases satisfy each other only where the official catalog describes them as variants of the same course family.
- A planned or current full-year course has a known grade-level chronology. It can satisfy a next-grade prerequisite but not a same-grade prior-course requirement.

### SMCCD

- The selected planning grade comes from the student's saved planning window and is used for prerequisite chronology.
- A course code already represented at any SMCCD college is excluded from discovery at the other colleges.
- Exact catalog prerequisites can block a course. Placement and multiple-measures language remains `needs_review` rather than being guessed.
- Catalog inclusion does not prove live schedule availability, permission, enrollment, or d.tech credit.

## Implementation checklist

- [x] Shared eligibility helpers with unit tests.
- [x] Duplicate suppression by d.tech ID/name aliases and SMCCD normalized code.
- [x] Grade-scoped d.tech discovery.
- [x] Reviewed math-spine suppression without ranking lateral math.
- [x] Full-year prerequisite chronology correction.
- [x] Standard/honors prerequisite aliases for Precalculus and Calculus families.
- [x] Add-handler guards for stale or blocked selections.
- [x] Search-first shared browser with explicit planning scope.
- [x] Official institution marks in college filtering and result rows.
- [x] Readiness icon plus text.
- [x] Reduced-motion-safe result/detail transitions using local React Bits adaptations.
- [ ] Live section availability. No authoritative schedule feed is connected.
- [ ] Counselor-approved reverse d.tech-to-SMCCD placement mappings beyond reviewed records.

## Five-pass review protocol

1. **Data accuracy:** verify IDs, normalized aliases/codes, grade ranges, math rank boundaries, prerequisite timing, and no invented equivalencies.
2. **Interaction correctness:** verify search, each filter, selection, add, duplicate prevention, empty states, result limits, and stale-selection guards.
3. **Hierarchy and copy:** verify the planning context appears before filters, row metadata is decision-relevant, details do not repeat rows, and disclaimers are concise.
4. **Responsive and visual system:** verify authenticated desktop and mobile in light/dark themes, official marks, focus states, readable type, no overflow, and reduced motion.
5. **Regression and accessibility:** run unit tests, lint, typecheck, build, and e2e; check keyboard tabs, semantic controls, icon-plus-text statuses, and console errors.

Any failed pass returns the work to the relevant implementation step. A catalog change is not complete merely because the page renders.
