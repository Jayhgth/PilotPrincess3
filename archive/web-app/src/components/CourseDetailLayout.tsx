import { ArrowSquareOutIcon as ArrowSquareOut } from "@phosphor-icons/react";
import type { ReactNode } from "react";

interface CourseFact {
  label: string;
  value: ReactNode;
}

interface Props {
  identity: ReactNode;
  code?: string | null;
  title: string;
  sourceUrl?: string | null;
  facts: readonly CourseFact[];
  description?: string | null;
  children?: ReactNode;
  controls: ReactNode;
}

export default function CourseDetailLayout({
  identity,
  code,
  title,
  sourceUrl,
  facts,
  description,
  children,
  controls
}: Props) {
  return (
    <div className="catalog-course-detail">
      <header className="catalog-detail-heading">
        <div className="catalog-detail-identity">{identity}</div>
        {code && <strong className="catalog-detail-code">{code}</strong>}
        <h3>{title}</h3>
        {sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer">Official course page <ArrowSquareOut size={13} /></a>}
      </header>

      <dl className="catalog-fact-list">
        {facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
      </dl>

      {description && <p className="catalog-course-description">{description}</p>}
      {children}
      {controls}
    </div>
  );
}
