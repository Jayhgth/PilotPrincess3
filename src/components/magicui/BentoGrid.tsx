import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { useId } from "react";

interface BentoGridProps extends ComponentPropsWithoutRef<"div"> {
  children: ReactNode;
}

interface BentoCardProps extends ComponentPropsWithoutRef<"section"> {
  title: string;
  Icon: ElementType;
  action?: ReactNode;
  children: ReactNode;
}

// Adapted from Magic UI's MIT-licensed Bento Grid for this project's native CSS system.
// https://magicui.design/docs/components/bento-grid
export function BentoGrid({ children, className = "", ...props }: BentoGridProps) {
  return <div className={`magic-bento-grid ${className}`.trim()} {...props}>{children}</div>;
}

export function BentoCard({ title, Icon, action, children, className = "", ...props }: BentoCardProps) {
  const headingId = useId();
  return <section className={`magic-bento-card ${className}`.trim()} aria-labelledby={headingId} {...props}>
    <header className="magic-bento-heading">
      <h2 id={headingId}><Icon size={16} weight="duotone" aria-hidden />{title}</h2>
      {action}
    </header>
    <div className="magic-bento-body">{children}</div>
  </section>;
}
