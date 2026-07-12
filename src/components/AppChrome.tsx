import { Button as BaseButton } from "@base-ui/react/button";
import {
  ArrowClockwiseIcon as ArrowClockwise,
  GearSixIcon as GearSix,
  GraduationCapIcon as GraduationCap,
  HouseIcon as House,
  MoonIcon as Moon,
  SignOutIcon as SignOut,
  SparkleIcon as Sparkle,
  SunIcon as Sun,
  XIcon as X
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import BrandMark from "@/components/BrandMark";

export interface WorkspaceNavItem<ViewId extends string> {
  id: ViewId;
  label: string;
  icon: Icon;
}

interface Props<ViewId extends string> {
  view: ViewId;
  activeLabel: string;
  navItems: WorkspaceNavItem<ViewId>[];
  school: { short_name: string; source_year: string | null };
  theme: "light" | "dark";
  aiEnabled: boolean;
  assistantOpen: boolean;
  mobileNavOpen: boolean;
  isAdmin: boolean;
  onNavigate: (view: ViewId) => void;
  onMobileNavChange: (open: boolean) => void;
  onAssistantToggle: () => void;
  onAdmin: () => void;
  onReplayOnboarding: () => void;
  onViewLogin: () => void;
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
  isAdmin,
  onNavigate,
  onMobileNavChange,
  onAssistantToggle,
  onAdmin,
  onReplayOnboarding,
  onViewLogin,
  onThemeToggle,
  onSignOut,
  children
}: Props<ViewId>) {
  return <>
    <aside className={`app-sidebar ${mobileNavOpen ? "open" : ""}`}>
      <div className="sidebar-top">
        <a className="wordmark" href="/app"><BrandMark /><span>Pilot Princess</span></a>
        <button className="mobile-close icon-button" onClick={() => onMobileNavChange(false)} aria-label="Close navigation"><X size={18} /></button>
      </div>
      <nav className="sidebar-nav" aria-label="Planning workspace">
        {navItems.map((item) => {
          const NavIcon = item.icon;
          const active = view === item.id;
          return <BaseButton
            key={item.id}
            className={active ? "active" : ""}
            onClick={() => {
              onNavigate(item.id);
              onMobileNavChange(false);
            }}
            type="button"
            aria-current={active ? "page" : undefined}
          >
            <NavIcon size={18} weight={active ? "fill" : "regular"} aria-hidden />
            <span>{item.label}</span>
          </BaseButton>;
        })}
      </nav>
      <div className="sidebar-footer">
        <div className="school-chip">
          <GraduationCap size={18} weight="duotone" />
          <span><strong>{school.short_name}</strong><small>{school.source_year ?? "Current"} sources</small></span>
        </div>
        <div className="sidebar-account-actions">
          {isAdmin && <>
            <button className="sidebar-utility" onClick={onAdmin} type="button"><GearSix size={17} /><span>Admin settings</span></button>
            <button className="sidebar-utility" data-demo-only="true" data-admin-only="true" onClick={onReplayOnboarding} type="button"><ArrowClockwise size={17} /><span>Replay onboarding</span></button>
            <button className="sidebar-utility" data-demo-only="true" data-admin-only="true" onClick={onViewLogin} type="button"><House size={17} /><span>View login page</span></button>
          </>}
          <button className="sidebar-utility" onClick={onThemeToggle} type="button">{theme === "light" ? <Moon size={17} /> : <Sun size={17} />}<span>{theme === "light" ? "Dark mode" : "Light mode"}</span></button>
          <button className="sidebar-utility" onClick={onSignOut} type="button"><SignOut size={17} /><span>Sign out</span></button>
        </div>
      </div>
    </aside>
    {mobileNavOpen && <button className="nav-backdrop" onClick={() => onMobileNavChange(false)} aria-label="Close navigation overlay" />}

    <main className="app-main">
      <div className="mobile-bar">
        <button className="icon-button" onClick={() => onMobileNavChange(true)} aria-label="Open navigation"><BrandMark /></button>
        <span>{activeLabel}</span>
        <div className="mobile-bar-actions">
          <button className="icon-button" onClick={onAssistantToggle} aria-label="Open Pilot Assistant"><Sparkle size={18} weight="duotone" /></button>
          <button className="icon-button" onClick={onThemeToggle} aria-label="Toggle theme">{theme === "light" ? <Moon size={18} /> : <Sun size={18} />}</button>
        </div>
      </div>
      <div className="app-toolbar">
        <button className={assistantOpen ? "active" : ""} type="button" onClick={onAssistantToggle}>
          <Sparkle size={17} weight={assistantOpen ? "fill" : "duotone"} />
          <span>{assistantOpen ? "Collapse Pilot" : aiEnabled ? "Ask Pilot" : "Set up Pilot"}</span>
        </button>
      </div>
      <div className="app-content">{children}</div>
    </main>
  </>;
}
