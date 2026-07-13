import {
  CheckCircleIcon as CheckCircle,
  MinusCircleIcon as MinusCircle,
  QuestionIcon as Question,
  XCircleIcon as XCircle
} from "@phosphor-icons/react";

import type { PlannerPrerequisiteEvaluation } from "@/lib/prerequisites";
import FadeContent from "@/components/reactbits/FadeContent";

interface Props {
  evaluation: PlannerPrerequisiteEvaluation;
  recommendedPreparation?: readonly string[];
}

export function prerequisiteDisplay(evaluation: PlannerPrerequisiteEvaluation) {
  if (evaluation.originalTexts.length === 0) {
    return { label: "No prereq", tone: "none" as const };
  }
  if (evaluation.result.status === "satisfied") {
    return { label: "Met", tone: "ready" as const };
  }
  if (evaluation.result.status === "blocked") {
    return { label: "Not met", tone: "blocked" as const };
  }
  return { label: "Review", tone: "review" as const };
}

export default function PrerequisiteReadout({ evaluation, recommendedPreparation = [] }: Props) {
  const display = prerequisiteDisplay(evaluation);
  const firstIssue = evaluation.result.missingCourses[0]?.message
    ?? evaluation.result.orderingViolations[0]?.message
    ?? evaluation.result.evidence.find((item) => item.satisfied !== true)?.message;
  const Icon = display.tone === "ready"
    ? CheckCircle
    : display.tone === "blocked"
      ? XCircle
      : display.tone === "review"
        ? Question
        : MinusCircle;
  const hasExplanation = evaluation.originalTexts.length > 0
    || evaluation.result.evidence.length > 0
    || evaluation.result.suggestedCounselorQuestions.length > 0;

  return (
    <section className={`prerequisite-readout readiness-${display.tone}`}>
      <FadeContent className="prerequisite-status-transition" duration={0.14} key={`${display.tone}-${display.label}`}>
        <header><span>Prerequisite</span><strong><Icon size={16} weight="bold" aria-hidden />{display.label}</strong></header>
        {firstIssue && <p className="prerequisite-summary">{firstIssue}</p>}
      </FadeContent>
      {hasExplanation && <details>
        <summary>Prerequisite details</summary>
        {evaluation.originalTexts.length > 0 && <div className="prerequisite-source-text"><strong>Catalog language</strong>{evaluation.originalTexts.map((text) => <p key={text}>{text}</p>)}</div>}
        {evaluation.result.evidence.length > 0 && <div className="prerequisite-evidence"><strong>Plan evidence</strong><ul>{evaluation.result.evidence.map((item, index) => <li key={`${item.clauseText}-${index}`}>{item.message}</li>)}</ul></div>}
        {evaluation.result.suggestedCounselorQuestions.length > 0 && <div className="prerequisite-questions"><strong>Ask a counselor</strong><ul>{evaluation.result.suggestedCounselorQuestions.map((question) => <li key={question}>{question}</li>)}</ul></div>}
      </details>}
      {recommendedPreparation.length > 0 && <details className="recommended-preparation"><summary>Recommended preparation</summary>{recommendedPreparation.map((text) => <p key={text}>{text}</p>)}</details>}
    </section>
  );
}
