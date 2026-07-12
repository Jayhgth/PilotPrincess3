export const UI_VARIANTS = [
  {
    id: "t3code",
    name: "T3 Code",
    library: "Base UI + t3code",
    description: "Dense desktop workspace, compact chrome, DM Sans, cobalt focus."
  },
  {
    id: "material",
    name: "Material",
    library: "Material UI",
    description: "Expressive navigation rail, tonal surfaces, strong state hierarchy."
  },
  {
    id: "mantine",
    name: "Mantine",
    library: "Mantine",
    description: "Crisp teal workspace with calm density and modular controls."
  },
  {
    id: "chakra",
    name: "Chakra",
    library: "Chakra UI",
    description: "Friendly student-first layout with generous targets and warm contrast."
  },
  {
    id: "ant",
    name: "Campus",
    library: "Ant Design",
    description: "Compact academic portal with precise tables and information density."
  },
  {
    id: "radix",
    name: "Radix",
    library: "Radix Themes",
    description: "Editorial plum and graphite system with quiet, deliberate hierarchy."
  },
  {
    id: "aria",
    name: "High Contrast",
    library: "React Aria",
    description: "Accessibility-led structure with large controls and unmistakable states."
  },
  {
    id: "reactbits",
    name: "Kinetic",
    library: "React Bits",
    description: "Burgundy motion language with bounded focus and asymmetric rhythm."
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
