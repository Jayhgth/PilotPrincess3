import { ChatCircleDotsIcon as ChatCircleDots } from "@phosphor-icons/react/dist/csr/ChatCircleDots";
import { GearSixIcon as GearSix } from "@phosphor-icons/react/dist/csr/GearSix";
import { MoonIcon as Moon } from "@phosphor-icons/react/dist/csr/Moon";
import { SignOutIcon as SignOut } from "@phosphor-icons/react/dist/csr/SignOut";
import { SunIcon as Sun } from "@phosphor-icons/react/dist/csr/Sun";
import { XIcon as X } from "@phosphor-icons/react/dist/csr/X";
import type { Icon } from "@phosphor-icons/react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import BrandMark from "@/components/BrandMark";
import InstitutionIdentityMark from "@/components/InstitutionIdentityMark";
import type { School } from "@/lib/models";

const SIDEBAR_WIDTH_KEY = "pilot-princess:sidebar-width";
const SIDEBAR_COLLAPSED_WIDTH = 64;
const SIDEBAR_MIN_EXPANDED_WIDTH = 184;
const SIDEBAR_MAX_WIDTH = 320;
const SIDEBAR_DEFAULT_WIDTH = 248;

function normalizeSidebarWidth(value: number) {
  if (!Number.isFinite(value)) return SIDEBAR_DEFAULT_WIDTH;
  if (value < SIDEBAR_MIN_EXPANDED_WIDTH) return SIDEBAR_COLLAPSED_WIDTH;
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_EXPANDED_WIDTH, Math.round(value)));
}

interface WorkspaceNavItem<ViewId extends string> {
  id: ViewId;
  label: string;
  icon: Icon;
}

interface Props<ViewId extends string> {
  view: ViewId;
  activeLabel: string;
  navItems: WorkspaceNavItem<ViewId>[];
  school: Pick<School, "slug" | "name" | "short_name" | "website_url" | "source_year">;
  theme: "light" | "dark";
  aiEnabled: boolean;
  assistantOpen: boolean;
  mobileNavOpen: boolean;
  onNavigate: (view: ViewId) => void;
  onPreload?: (view: ViewId) => void;
  onSettings: () => void;
  onMobileNavChange: (open: boolean) => void;
  onAssistantToggle: () => void;
  onThemeToggle: () => void;
  onSignOut: () => void;
  children: ReactNode;
}

export default function AppChrome<ViewId extends string>({
  view,
  activeLabel,
  navItems,
  school,
  theme,
  aiEnabled,
  assistantOpen,
  mobileNavOpen,
  onNavigate,
  onPreload,
  onSettings,
  onMobileNavChange,
  onAssistantToggle,
  onThemeToggle,
  onSignOut,
  children
}: Props<ViewId>) {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return SIDEBAR_DEFAULT_WIDTH;
    return normalizeSidebarWidth(Number(window.localStorage.getItem(SIDEBAR_WIDTH_KEY)));
  });
  const pendingSidebarWidth = useRef(sidebarWidth);
  const onAssistantToggleRef = useRef(onAssistantToggle);

  useEffect(() => {
    onAssistantToggleRef.current = onAssistantToggle;
  }, [onAssistantToggle]);

  useEffect(() => {
    function togglePilotWithKeyboard(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented || event.key.toLowerCase() !== "b" || event.altKey || event.shiftKey) return;
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      onAssistantToggleRef.current();
    }

    window.addEventListener("keydown", togglePilotWithKeyboard);
    return () => window.removeEventListener("keydown", togglePilotWithKeyboard);
  }, []);

  useEffect(() => {
    pendingSidebarWidth.current = sidebarWidth;
    document.documentElement.style.setProperty("--app-sidebar-width", `${sidebarWidth}px`);
    document.documentElement.dataset.sidebarCollapsed = String(sidebarWidth === SIDEBAR_COLLAPSED_WIDTH);
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => () => {
    document.documentElement.style.removeProperty("--app-sidebar-width");
    delete document.documentElement.dataset.sidebarCollapsed;
    delete document.documentElement.dataset.sidebarResizing;
  }, []);

  function previewSidebarWidth(width: number) {
    const normalized = normalizeSidebarWidth(width);
    pendingSidebarWidth.current = normalized;
    document.documentElement.style.setProperty("--app-sidebar-width", `${normalized}px`);
    document.documentElement.dataset.sidebarCollapsed = String(normalized === SIDEBAR_COLLAPSED_WIDTH);
  }

  function beginSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (window.innerWidth <= 960) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    document.documentElement.dataset.sidebarResizing = "true";
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function resizeSidebar(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    previewSidebarWidth(event.clientX);
  }

  function finishSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    delete document.documentElement.dataset.sidebarResizing;
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    setSidebarWidth(pendingSidebarWidth.current);
  }

  function resizeSidebarWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    let nextWidth: number;
    if (event.key === "ArrowLeft") nextWidth = sidebarWidth === SIDEBAR_COLLAPSED_WIDTH ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth - 16;
    else if (event.key === "ArrowRight") nextWidth = sidebarWidth === SIDEBAR_COLLAPSED_WIDTH ? SIDEBAR_MIN_EXPANDED_WIDTH : sidebarWidth + 16;
    else if (event.key === "Home") nextWidth = SIDEBAR_COLLAPSED_WIDTH;
    else if (event.key === "End") nextWidth = SIDEBAR_MAX_WIDTH;
    else return;
    event.preventDefault();
    setSidebarWidth(normalizeSidebarWidth(nextWidth));
  }

  return <>
    <aside className={`app-sidebar ${mobileNavOpen ? "open" : ""}`}>
      <div className="sidebar-top">
        <button className="wordmark" type="button" onClick={() => onNavigate(navItems[0].id)}><BrandMark /><span>Pilot Princess</span></button>
        <button className="mobile-close icon-button" type="button" onClick={() => onMobileNavChange(false)} aria-label="Close navigation"><X size={18} /></button>
      </div>
      <nav className="sidebar-nav" aria-label="Planning workspace">
        {navItems.map((item) => {
          const NavIcon = item.icon;
          const active = view === item.id;
          return <button
            key={item.id}
            className={active ? "active" : ""}
            onPointerEnter={() => onPreload?.(item.id)}
            onFocus={() => onPreload?.(item.id)}
            onClick={() => {
              onNavigate(item.id as ViewId);
              onMobileNavChange(false);
            }}
            type="button"
            aria-current={active ? "page" : undefined}
            title={item.label}
          >
            <NavIcon size={18} weight={active ? "fill" : "regular"} aria-hidden />
            <span>{item.label}</span>
          </button>;
        })}
      </nav>
      <div className="sidebar-footer">
        <div className="school-chip" title={`${school.short_name}, ${school.source_year ?? "Current"} sources`}>
          <InstitutionIdentityMark name={school.name} websiteUrl={school.website_url} decorative />
          <span className="school-chip-copy"><strong>{school.short_name}</strong><small>{school.source_year ?? "Current"} sources</small></span>
        </div>
        <div className="sidebar-account-actions">
          <button className="sidebar-utility" onClick={onSettings} type="button" title="Settings"><GearSix size={17} /><span>Settings</span></button>
          <button className="sidebar-utility" onClick={onThemeToggle} type="button" title={`Use ${theme === "light" ? "dark" : "light"} theme`} aria-label={`Use ${theme === "light" ? "dark" : "light"} theme`}>
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
            <span>{theme === "light" ? "Dark" : "Light"}</span>
          </button>
          <button className="sidebar-utility" onClick={onSignOut} type="button" title="Sign out"><SignOut size={17} /><span>Sign out</span></button>
        </div>
      </div>
      <div
        className="sidebar-resize-handle"
        role="separator"
        aria-label="Resize navigation"
        aria-orientation="vertical"
        aria-valuemin={SIDEBAR_COLLAPSED_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuenow={sidebarWidth}
        tabIndex={0}
        title="Drag to resize navigation"
        onPointerDown={beginSidebarResize}
        onPointerMove={resizeSidebar}
        onPointerUp={finishSidebarResize}
        onPointerCancel={finishSidebarResize}
        onKeyDown={resizeSidebarWithKeyboard}
      />
    </aside>
    {mobileNavOpen && <button className="nav-backdrop" type="button" onClick={() => onMobileNavChange(false)} aria-label="Close navigation overlay" />}

    <main className="app-main">
      <div className="mobile-bar">
        <button className="icon-button" type="button" onClick={() => onMobileNavChange(true)} aria-label="Open navigation"><BrandMark /></button>
        <span>{activeLabel}</span>
        <div className="mobile-bar-actions">
          <button className="icon-button" type="button" onClick={onAssistantToggle} aria-label="Open Pilot Assistant"><ChatCircleDots size={18} /></button>
          <button className="icon-button" type="button" onClick={onThemeToggle} aria-label="Toggle theme">{theme === "light" ? <Moon size={18} /> : <Sun size={18} />}</button>
        </div>
      </div>
      <div className="app-toolbar">
        <button
          className={assistantOpen ? "active" : ""}
          type="button"
          onClick={onAssistantToggle}
          aria-pressed={assistantOpen}
          title={`${assistantOpen ? "Collapse Pilot" : aiEnabled ? "Open Pilot" : "Set up Pilot"} (⌘ B)`}
        >
          <span>{assistantOpen ? "Collapse Pilot" : aiEnabled ? "Open Pilot" : "Set up Pilot"}</span>
        </button>
      </div>
      <div className="app-content">{children}</div>
    </main>
  </>;
}
