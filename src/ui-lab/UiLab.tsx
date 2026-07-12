import { Button as BaseButton } from "@base-ui/react/button";
import { Button as ChakraButton, ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { UnstyledButton as MantineButton, MantineProvider, createTheme as createMantineTheme } from "@mantine/core";
import ButtonBase from "@mui/material/ButtonBase";
import { ThemeProvider as MuiThemeProvider, createTheme as createMuiTheme } from "@mui/material/styles";
import { Button as RadixButton, Theme as RadixTheme } from "@radix-ui/themes";
import { PaletteIcon as Palette, XIcon as X } from "@phosphor-icons/react";
import { Button as AntButton, ConfigProvider, theme as antTheme } from "antd";
import {
  useCallback,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type ReactNode
} from "react";
import { Button as AriaButton } from "react-aria-components";
import SpotlightCard from "@/components/reactbits/SpotlightCard";
import {
  DEFAULT_UI_VARIANT,
  UI_VARIANTS,
  isUiVariant,
  type UiVariant
} from "@/ui-lab/variants";

const UI_STORAGE_KEY = "pilot-princess-ui-variant";

const mantineTheme = createMantineTheme({
  primaryColor: "teal",
  fontFamily: '"Space Grotesk Variable", sans-serif',
  defaultRadius: "sm"
});

const muiThemes = {
  light: createMuiTheme({
    palette: { mode: "light", primary: { main: "#5b3f9b" }, secondary: { main: "#ef5024" } },
    shape: { borderRadius: 16 },
    typography: { fontFamily: '"Roboto Variable", sans-serif' }
  }),
  dark: createMuiTheme({
    palette: { mode: "dark", primary: { main: "#c7b7ff" }, secondary: { main: "#ff8060" } },
    shape: { borderRadius: 16 },
    typography: { fontFamily: '"Roboto Variable", sans-serif' }
  })
};

function initialVariant(): UiVariant {
  if (typeof window === "undefined") return DEFAULT_UI_VARIANT;
  const queryVariant = new URL(window.location.href).searchParams.get("ui");
  if (isUiVariant(queryVariant)) return queryVariant;
  const savedVariant = window.localStorage.getItem(UI_STORAGE_KEY);
  return isUiVariant(savedVariant) ? savedVariant : DEFAULT_UI_VARIANT;
}

export function useUiVariant() {
  const [variant, setVariantState] = useState<UiVariant>(initialVariant);

  const setVariant = useCallback((next: UiVariant) => {
    setVariantState(next);
    if (typeof window === "undefined") return;
    window.localStorage.setItem(UI_STORAGE_KEY, next);
    const url = new URL(window.location.href);
    url.searchParams.set("ui", next);
    window.history.replaceState(window.history.state, "", url);
    document.documentElement.dataset.uiVariant = next;
  }, []);

  useEffect(() => {
    document.documentElement.dataset.uiVariant = variant;
    const handlePopState = () => {
      const next = new URL(window.location.href).searchParams.get("ui");
      if (isUiVariant(next)) setVariantState(next);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [variant]);

  return [variant, setVariant] as const;
}

export function UiLabProvider({
  variant,
  theme,
  children
}: {
  variant: UiVariant;
  theme: "light" | "dark";
  children: ReactNode;
}) {
  switch (variant) {
    case "material":
      return <MuiThemeProvider theme={muiThemes[theme]}>{children}</MuiThemeProvider>;
    case "mantine":
      return <MantineProvider theme={mantineTheme} forceColorScheme={theme}>{children}</MantineProvider>;
    case "chakra":
      return <ChakraProvider value={defaultSystem}><div className={theme}>{children}</div></ChakraProvider>;
    case "ant":
      return (
        <ConfigProvider
          theme={{
            algorithm: theme === "dark" ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
            token: {
              colorPrimary: "#1c65a8",
              borderRadius: 5,
              fontFamily: '"Source Sans 3 Variable", sans-serif'
            }
          }}
        >
          {children}
        </ConfigProvider>
      );
    case "radix":
      return <RadixTheme appearance={theme} accentColor="plum" grayColor="sand" radius="small" scaling="95%">{children}</RadixTheme>;
    default:
      return children;
  }
}

type LabButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant: UiVariant;
};

export function LabButton({ variant, children, ...props }: LabButtonProps) {
  const commonProps = {
    className: props.className,
    disabled: props.disabled,
    id: props.id,
    onClick: props.onClick,
    title: props.title,
    type: props.type ?? "button" as const,
    "aria-label": props["aria-label"]
  };
  switch (variant) {
    case "t3code":
      return <BaseButton {...props}>{children}</BaseButton>;
    case "material":
      return <ButtonBase {...props}>{children}</ButtonBase>;
    case "mantine":
      return <MantineButton {...props}>{children}</MantineButton>;
    case "chakra":
      return <ChakraButton {...props}>{children}</ChakraButton>;
    case "ant":
      return <AntButton {...commonProps} type="text" htmlType={commonProps.type}>{children}</AntButton>;
    case "radix":
      return <RadixButton {...commonProps} variant="ghost">{children}</RadixButton>;
    case "aria":
      return <AriaButton {...(commonProps as ComponentProps<typeof AriaButton>)}>{children}</AriaButton>;
    default:
      return <button {...props} data-react-bits={variant === "reactbits" ? "control" : undefined}>{children}</button>;
  }
}

export function UiLabSwitcher({
  value,
  onChange
}: {
  value: UiVariant;
  onChange: (variant: UiVariant) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = UI_VARIANTS.find((variant) => variant.id === value) ?? UI_VARIANTS[0];
  const panel = (
    <div className="ui-lab-switcher" data-open={open || undefined}>
      <button
        className="ui-lab-trigger"
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls="ui-lab-options"
      >
        <Palette size={17} weight="duotone" />
        <span><strong>UI Lab</strong><small>{active.name}</small></span>
      </button>
      {open && (
        <div className="ui-lab-panel" id="ui-lab-options" role="dialog" aria-label="Choose interface version">
          <header>
            <div><strong>Interface versions</strong><span>Shared data and Pilot chat</span></div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close interface versions"><X size={16} /></button>
          </header>
          <div className="ui-lab-options">
            {UI_VARIANTS.map((variant) => (
              <button
                key={variant.id}
                className={variant.id === value ? "active" : ""}
                type="button"
                onClick={() => {
                  onChange(variant.id);
                  setOpen(false);
                }}
              >
                <span><strong>{variant.name}</strong><small>{variant.library}</small></span>
                <p>{variant.description}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return value === "reactbits"
    ? <SpotlightCard className="ui-lab-switcher-spotlight" spotlightColor="rgb(239 80 36 / 0.16)">{panel}</SpotlightCard>
    : panel;
}
