# Color and institution system

Reviewed 2026-07-10. This is the reference for product color, institutional identity, and motion decisions.

## Decision

Pilot Graphite is implemented. It preserves the established Pilot Princess mulberry identity, deepens the dark neutral range, and gives d.tech and dual enrollment separate semantic color scopes. Institutional color never carries meaning alone: every course also names its school or college and uses the official mark.

The interface follows a token approach similar to Tailwind dark-mode variants and Atlassian semantic tokens. Neutral surfaces handle hierarchy. Color is reserved for actions, selection, status, and course provenance. React Bits motion is limited to tab indicators, selected catalog detail transitions, and existing drag/generation feedback. All motion respects reduced-motion preferences.

## Tested combinations

| Palette | Light direction | Dark direction | Primary action contrast | College action contrast | Recommendation |
| --- | --- | --- | ---: | ---: | --- |
| Pilot Graphite | cool white, graphite, mulberry | near-black, mineral gray, rose | 8.35:1 / 7.05:1 | 8.91:1 / 8.09:1 | Implemented. Best continuity and source separation. |
| d.tech Signal | warm white, graphite, accessible orange | near-black, signal coral | 6.42:1 / 7.40:1 | 8.91:1 / 7.98:1 | Strongest d.tech expression. Better for a school-owned product than a neutral planning tool. |
| District First | cool white, district blue, orange | blue-black, sky blue, coral | 8.91:1 / 8.20:1 | 6.42:1 / 7.91:1 | Best if concurrent enrollment becomes the primary product. |
| Coastal Study | cool mint neutral, teal, plum | green-black, sea-glass, lilac | 6.43:1 / 8.51:1 | 8.20:1 / 7.91:1 | Calmest alternative, but least connected to existing brands. |

The first number in each contrast cell is light mode and the second is dark mode. `pnpm colors:validate` checks body, muted, primary-action, and college-action pairs against WCAG AA 4.5:1.

## Official identities

| Identity | UI color | Local asset source |
| --- | --- | --- |
| d.tech | official orange family, with a darker accessible UI orange | Official d.tech site mark: https://www.designtechhighschool.org/home |
| SMCCCD | district blue `#002F65` | Official district horizontal logos: https://www.smccd.edu/ and https://downloads.smccd.edu/browse/districtinformation |
| College of San Mateo | CSM blue `#004990` | Official CSM signature and style guide: https://collegeofsanmateo.edu/marketing/logos-styleguide.php |
| Skyline College | Skyline red `#F03D3A`; accessible UI red is darker in light mode | Official Skyline logos and 2023 style guide: https://skylinecollege.edu/mcpr/styleguidelogos.php |
| Cañada College | Cañada green `#205C40` | Official Cañada logos and style guide: https://canadacollege.edu/marketing/logos.php |

Color values come from the official CSM, Skyline, Cañada, and district guides. Full-color marks are used on light surfaces. Approved white marks are used on dark surfaces. The logos remain the property of their institutions and are used only to identify course provenance.

## Application rules

- Product actions use Pilot mulberry. d.tech catalog selections use accessible d.tech orange. SMCCD course and degree work uses district blue.
- Mixed SMCCD lists show the relevant official campus mark, college name, and dual-enrollment label.
- College course cards use a subtle district-tinted surface, not a decorative side stripe.
- Campus colors distinguish CSM, Skyline, and Cañada selection outlines, but labels and logos remain the primary identifiers.
- Borders are reserved for controls and major structural boundaries. Grouped rows use surface changes and spacing.
- New motion must explain a state change, selection, loading state, or drag action and must have a reduced-motion fallback.

## Research basis

- W3C requires 4.5:1 contrast for normal text and 3:1 for visual information needed to identify controls and states: https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html and https://www.w3.org/WAI/WCAG21/Understanding/non-text-contrast.html
- W3C also recommends not relying on color alone, clearly identifying interactive elements, and using spacing to group related content: https://www.w3.org/WAI/tips/designing/
- Tailwind documents a single selector-driven light/dark system, including `data-theme` support: https://tailwindcss.com/docs/dark-mode
- Atlassian recommends semantic tokens so the same role stays consistent across components and themes: https://atlassian.design/tokens/design-tokens
- React Bits Animated Content and Fade Content informed the restrained selection transitions: https://www.reactbits.dev/animations/animated-content and https://www.reactbits.dev/animations/fade-content
