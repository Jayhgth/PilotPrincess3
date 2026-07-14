import {
  BookOpenIcon as BookOpen,
  CaretRightIcon as CaretRight,
  CheckCircleIcon as CheckCircle,
  MinusCircleIcon as MinusCircle,
  QuestionIcon as Question,
  XCircleIcon as XCircle
} from "@phosphor-icons/react";
import { useRef, type ReactNode } from "react";
import InstitutionMark from "@/components/InstitutionMark";
import AnimatedContent from "@/components/reactbits/AnimatedContent";
import AnimatedList from "@/components/reactbits/AnimatedList";
import FadeContent from "@/components/reactbits/FadeContent";
import type { InstitutionKey } from "@/lib/institutions";

type CatalogSourceKind = "dtech" | "smccd";
export type CatalogReadinessTone = "ready" | "blocked" | "review" | "none";

interface CatalogResultRow {
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
  description?: string;
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
  planningContext?: string;
  hiddenSummary?: string;
  resultsHint?: string;
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
  sourceAction,
  planningContext,
  hiddenSummary,
  resultsHint = "Open a course for details"
}: Props) {
  const detailPanelRef = useRef<HTMLElement>(null);
  const readinessIcon = (tone: CatalogReadinessTone) => {
    if (tone === "ready") return <CheckCircle size={15} weight="bold" aria-hidden />;
    if (tone === "blocked") return <XCircle size={15} weight="bold" aria-hidden />;
    if (tone === "review") return <Question size={15} weight="bold" aria-hidden />;
    return <MinusCircle size={15} weight="bold" aria-hidden />;
  };
  const selectResult = (id: string) => {
    onSelect(id);
    if (window.matchMedia("(max-width: 960px)").matches) {
      window.requestAnimationFrame(() => detailPanelRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start"
      }));
    }
  };

  return (
    <section className={`unified-catalog source-${source}`}>
      <header className="catalog-source-header">
        <div className="catalog-source-identity">
          <InstitutionMark institution={source} size="header" decorative />
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
        </div>
        {sourceAction}
      </header>

      {(planningContext || hiddenSummary) && <div className="catalog-context-line" aria-label="Catalog scope">
        {planningContext && <strong>{planningContext}</strong>}
        {hiddenSummary && <span>{hiddenSummary}</span>}
      </div>}
      <div className="catalog-filter-bar">{filters}</div>

      <div className={`catalog-browser-layout ${selectedId ? "has-selection" : ""}`}>
        <div className="catalog-results-column">
          <div className="catalog-results-heading"><AnimatedContent distance={4} duration={0.18} key={countLabel}><strong>{countLabel}</strong></AnimatedContent><span>{resultsHint}</span></div>
          {results.length > 0 ? (
            <AnimatedList
              ariaLabel={`${title} results`}
              className="catalog-result-list"
              items={results}
              itemKey={(result) => result.id}
              renderItem={(result) => (
                <button
                  aria-pressed={selectedId === result.id}
                  className={`catalog-result-row ${selectedId === result.id ? "selected" : ""} ${result.institution ? `institution-${result.institution.toLowerCase()}` : ""}`}
                  onClick={() => selectResult(result.id)}
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
                    <span className={`readiness-${result.readinessTone}`}>{readinessIcon(result.readinessTone)}{result.readinessLabel}</span>
                  </span>
                  <CaretRight size={15} aria-hidden />
                </button>
              )}
            />
          ) : (
            <div className="catalog-results-empty">
              <BookOpen size={19} aria-hidden />
              <strong>{emptyTitle}</strong>
              <p>{emptyBody}</p>
            </div>
          )}
          {footer}
        </div>
        <aside className="catalog-detail-panel" aria-live="polite" ref={detailPanelRef}>
          <FadeContent className="catalog-detail-transition" key={selectedId ?? "empty"}>{detail}</FadeContent>
        </aside>
      </div>
    </section>
  );
}
