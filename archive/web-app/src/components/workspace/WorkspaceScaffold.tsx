import type { ReactNode } from "react";
import BrandMark from "@/components/BrandMark";

export function PageHeader({
  title,
  description,
  actions
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return <header className="page-header">
    <div>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </div>
    {actions && <div className="page-actions">{actions}</div>}
  </header>;
}

export function LoadingWorkspace() {
  return <main className="workspace-loading" aria-live="polite">
    <div className="loading-brand"><BrandMark /> Pilot Princess</div>
    <div className="skeleton-line wide" />
    <div className="skeleton-line" />
    <div className="skeleton-grid"><div /><div /><div /></div>
    <span>Preparing your planning workspace</span>
  </main>;
}

export function LoadingView() {
  return <div className="workspace-view-loading" role="status" aria-label="Loading section"><span /><span /><span /></div>;
}
