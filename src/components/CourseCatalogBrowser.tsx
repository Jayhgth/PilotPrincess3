import {
  BookOpenIcon as BookOpen,
  CaretRightIcon as CaretRight
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import InstitutionMark from "@/components/InstitutionMark";
import FadeContent from "@/components/reactbits/FadeContent";
import type { InstitutionKey } from "@/lib/institutions";

export type CatalogSourceKind = "dtech" | "smccd";
export type CatalogReadinessTone = "ready" | "blocked" | "review" | "none";

export interface CatalogResultRow {
  id: string;
  code?: string;
  title: string;
  metadata: string[];
  readinessLabel: string;
  readinessTone: CatalogReadinessTone;
  planStatus?: string;
  institution?: InstitutionKey;
}

interface Props {
  source: CatalogSourceKind;
  title: string;
  description: string;
  countLabel: string;
  filters: ReactNode;
  results: CatalogResultRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  detail: ReactNode;
  emptyTitle: string;
  emptyBody: string;
  footer?: ReactNode;
  sourceAction?: ReactNode;
}

export default function CourseCatalogBrowser({
  source,
  title,
  description,
  countLabel,
  filters,
  results,
  selectedId,
  onSelect,
  detail,
  emptyTitle,
  emptyBody,
  footer,
  sourceAction
}: Props) {
  return (
    <section className={`unified-catalog source-${source}`}>
      <header className="catalog-source-header">
        <div className="catalog-source-identity">
          <InstitutionMark institution={source} size="header" decorative />
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
        </div>
        {sourceAction}
      </header>

      <div className="catalog-filter-bar">{filters}</div>

      <div className="catalog-browser-layout">
        <div className="catalog-results-column">
          <div className="catalog-results-heading"><strong>{countLabel}</strong><span>Select a row to inspect it</span></div>
          {results.length > 0 ? (
            <div className="catalog-result-list" aria-label={`${title} results`}>
              {results.map((result) => (
                <button
                  aria-pressed={selectedId === result.id}
                  className={`catalog-result-row ${selectedId === result.id ? "selected" : ""} ${result.institution ? `institution-${result.institution.toLowerCase()}` : ""}`}
                  key={result.id}
                  onClick={() => onSelect(result.id)}
                  type="button"
                >
                  <span className="catalog-result-identity">
                    {result.institution && <InstitutionMark institution={result.institution} decorative />}
                    <span className="catalog-result-course">
                      <span className="catalog-result-title">{result.code && <b>{result.code}</b>}<strong>{result.title}</strong></span>
                      <span className="catalog-result-metadata">{result.metadata.map((item) => <span key={item}>{item}</span>)}</span>
                    </span>
                  </span>
                  <span className="catalog-result-state">
                    {result.planStatus && <strong>{result.planStatus}</strong>}
                    <span className={`readiness-${result.readinessTone}`}>{result.readinessLabel}</span>
                  </span>
                  <CaretRight size={15} aria-hidden />
                </button>
              ))}
            </div>
          ) : (
            <div className="catalog-results-empty">
              <BookOpen size={19} aria-hidden />
              <strong>{emptyTitle}</strong>
              <p>{emptyBody}</p>
            </div>
          )}
          {footer}
        </div>
        <aside className="catalog-detail-panel" aria-live="polite">
          <FadeContent className="catalog-detail-transition" key={selectedId ?? "empty"}>{detail}</FadeContent>
        </aside>
      </div>
    </section>
  );
}
