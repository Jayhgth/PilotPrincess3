export const UI_VARIANTS = [
  {
    id: "t3code",
    name: "T3 Code",
    library: "Base UI + t3code",
    description: "Dense desktop workspace, compact chrome, DM Sans, cobalt focus."
  },
  {
    id: "material",
    name: "Journey",
    library: "Material UI + custom timeline",
    description: "A visual route for students who understand progress as a sequence."
  },
  {
    id: "mantine",
    name: "Semester Studio",
    library: "Mantine + modular boards",
    description: "Starts with the current semester, then expands into planning and history."
  },
  {
    id: "chakra",
    name: "Focus",
    library: "Chakra UI + focus canvas",
    description: "One next decision at a time for students who want less competing information."
  },
  {
    id: "ant",
    name: "Campus",
    library: "Ant Design + portal ledger",
    description: "A scan-first academic portal for students who prefer dense, comparable data."
  },
  {
    id: "radix",
    name: "Academic Brief",
    library: "Radix Themes + editorial layout",
    description: "A reading-first brief with evidence and decisions arranged like a report."
  },
  {
    id: "aria",
    name: "Checklist",
    library: "React Aria + high-contrast system",
    description: "A sequential, keyboard-first checklist with explicit state and large targets."
  },
  {
    id: "reactbits",
    name: "Route Map",
    library: "React Bits + spatial composition",
    description: "An asymmetric map for spatial thinkers who want to see movement through the plan."
  },
  {
    id: "current",
    name: "Original",
    library: "Pilot Graphite",
    description: "The untouched pre-lab interface kept as a comparison backup."
  }
] as const;

export type UiVariant = (typeof UI_VARIANTS)[number]["id"];

export const DEFAULT_UI_VARIANT: UiVariant = "t3code";

export function isUiVariant(value: string | null): value is UiVariant {
  return UI_VARIANTS.some((variant) => variant.id === value);
}

export function uiVariantClass(variant: UiVariant) {
  return `ui-variant-${variant}`;
}
