import {
  ArrowClockwiseIcon as ArrowClockwise,
  GearSixIcon as GearSix,
  GraduationCapIcon as GraduationCap,
  HouseIcon as House,
  MoonIcon as Moon,
  SignOutIcon as SignOut,
  SparkleIcon as Sparkle,
  SunIcon as Sun,
  UserCircleIcon as UserCircle,
  XIcon as X
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import BrandMark from "@/components/BrandMark";
import { LabButton } from "@/ui-lab/UiLab";
import type { UiVariant } from "@/ui-lab/variants";

export interface WorkspaceNavItem<ViewId extends string> {
  id: ViewId;
  label: string;
  icon: Icon;
}

interface Props<ViewId extends string> {
  variant: UiVariant;
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
  onProfile: () => void;
  onAdmin: () => void;
  onReplayOnboarding: () => void;
  onViewLogin: () => void;
  onThemeToggle: () => void;
  onSignOut: () => void;
  children: ReactNode;
}

const SIDE_VARIANTS: UiVariant[] = ["t3code", "current"];

export default function WorkspaceChrome<ViewId extends string>({
  variant,
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
  onProfile,
  onAdmin,
  onReplayOnboarding,
  onViewLogin,
  onThemeToggle,
  onSignOut,
  children
}: Props<ViewId>) {
  const sideLayout = SIDE_VARIANTS.includes(variant);

  const primaryNav = (className: string) => (
    <nav className={className} aria-label="Planning workspace">
      {navItems.map((item) => {
        const NavIcon = item.icon;
        const active = view === item.id;
        return (
          <LabButton
            variant={variant}
            key={item.id}
            className={active ? "active" : ""}
            onClick={() => onNavigate(item.id)}
            type="button"
            aria-current={active ? "page" : undefined}
          >
            <NavIcon size={18} weight={active ? "fill" : "regular"} aria-hidden />
            <span>{item.label}</span>
          </LabButton>
        );
      })}
    </nav>
  );

  const schoolIdentity = (
    <div className="school-chip">
      <GraduationCap size={18} weight="duotone" />
      <span><strong>{school.short_name}</strong><small>{school.source_year ?? "Current"} sources</small></span>
    </div>
  );

  const accountActions = (className: string) => (
    <div className={className}>
      <button className="sidebar-utility" onClick={onProfile} type="button"><UserCircle size={17} /><span>Student profile</span></button>
      {isAdmin && <>
        <button className="sidebar-utility" onClick={onAdmin} type="button"><GearSix size={17} /><span>Admin settings</span></button>
        <button className="sidebar-utility" data-demo-only="true" data-admin-only="true" onClick={onReplayOnboarding} type="button"><ArrowClockwise size={17} /><span>Replay onboarding</span></button>
        <button className="sidebar-utility" data-demo-only="true" data-admin-only="true" onClick={onViewLogin} type="button"><House size={17} /><span>View login page</span></button>
      </>}
      <button className="sidebar-utility" onClick={onThemeToggle} type="button">{theme === "light" ? <Moon size={17} /> : <Sun size={17} />}<span>{theme === "light" ? "Dark mode" : "Light mode"}</span></button>
      <button className="sidebar-utility" onClick={onSignOut} type="button"><SignOut size={17} /><span>Sign out</span></button>
    </div>
  );

  return <>
    {sideLayout ? (
      <aside className={`app-sidebar ${mobileNavOpen ? "open" : ""}`}>
        <div className="sidebar-top">
          <a className="wordmark" href="/app"><BrandMark /><span>Pilot Princess</span></a>
          <button className="mobile-close icon-button" onClick={() => onMobileNavChange(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>
        {primaryNav("sidebar-nav")}
        <div className="sidebar-footer">
          {schoolIdentity}
          {accountActions("sidebar-account-actions")}
        </div>
      </aside>
    ) : (
      <header className="lab-desktop-header">
        <div className="lab-brand-cluster">
          <a className="wordmark" href="/app"><BrandMark /><span>Pilot Princess</span></a>
          {schoolIdentity}
        </div>
        {primaryNav("lab-primary-nav")}
        <div className="lab-header-actions">
          <button className="lab-theme-action" onClick={onThemeToggle} type="button" aria-label={theme === "light" ? "Use dark mode" : "Use light mode"}>{theme === "light" ? <Moon size={18} /> : <Sun size={18} />}</button>
          <button className={`lab-pilot-action ${assistantOpen ? "active" : ""}`} type="button" onClick={onAssistantToggle}><Sparkle size={17} weight={assistantOpen ? "fill" : "duotone"} /><span>{assistantOpen ? "Collapse Pilot" : aiEnabled ? "Ask Pilot" : "Set up Pilot"}</span></button>
          <details className="lab-account-menu">
            <summary><UserCircle size={19} /><span>Account</span></summary>
            <div className="lab-account-popover">
              {schoolIdentity}
              {accountActions("lab-account-actions")}
            </div>
          </details>
        </div>
      </header>
    )}

    {!sideLayout && mobileNavOpen && (
      <aside className="lab-mobile-drawer open">
        <div className="sidebar-top">
          <a className="wordmark" href="/app"><BrandMark /><span>Pilot Princess</span></a>
          <button className="mobile-close icon-button" onClick={() => onMobileNavChange(false)} aria-label="Close navigation"><X size={18} /></button>
        </div>
        {primaryNav("sidebar-nav")}
        {schoolIdentity}
        {accountActions("sidebar-account-actions")}
      </aside>
    )}
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
      {sideLayout && <div className="app-toolbar"><button className={assistantOpen ? "active" : ""} type="button" onClick={onAssistantToggle}><Sparkle size={17} weight={assistantOpen ? "fill" : "duotone"} /><span>{assistantOpen ? "Collapse Pilot" : aiEnabled ? "Ask Pilot" : "Set up Pilot"}</span></button></div>}
      <div className="app-content">{children}</div>
    </main>
  </>;
}
