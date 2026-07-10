import {
  CheckCircleIcon as CheckCircle,
  InfoIcon as Info,
  QuestionIcon as Question,
  WarningCircleIcon as WarningCircle
} from "@phosphor-icons/react";

import type { PlannerPrerequisiteEvaluation } from "@/lib/prerequisites";

interface Props {
  evaluation: PlannerPrerequisiteEvaluation;
  recommendedPreparation?: readonly string[];
}

export function prerequisiteDisplay(evaluation: PlannerPrerequisiteEvaluation) {
  if (evaluation.originalTexts.length === 0) {
    return { label: "No prerequisite listed", tone: "none" as const };
  }
  if (evaluation.result.status === "satisfied") {
    return { label: "Ready in this plan", tone: "ready" as const };
  }
  if (evaluation.result.status === "blocked") {
    return { label: "Prerequisite missing", tone: "blocked" as const };
  }
  return { label: "Counselor review", tone: "review" as const };
}

export default function PrerequisiteReadout({ evaluation, recommendedPreparation = [] }: Props) {
  const display = prerequisiteDisplay(evaluation);
  const firstIssue = evaluation.result.missingCourses[0]?.message
    ?? evaluation.result.orderingViolations[0]?.message
    ?? evaluation.result.evidence.find((item) => item.satisfied !== true)?.message;
  const Icon = display.tone === "ready"
    ? CheckCircle
    : display.tone === "blocked"
      ? WarningCircle
      : display.tone === "review"
        ? Question
        : Info;
  const hasExplanation = evaluation.originalTexts.length > 0
    || evaluation.result.evidence.length > 0
    || evaluation.result.suggestedCounselorQuestions.length > 0;

  return (
    <section className={`prerequisite-readout readiness-${display.tone}`}>
      <header><Icon size={17} aria-hidden /><div><strong>{display.label}</strong>{firstIssue && <p>{firstIssue}</p>}</div></header>
      {hasExplanation && <details>
        <summary>Review prerequisite evidence</summary>
        {evaluation.originalTexts.length > 0 && <div className="prerequisite-source-text"><strong>Catalog language</strong>{evaluation.originalTexts.map((text) => <p key={text}>{text}</p>)}</div>}
        {evaluation.result.evidence.length > 0 && <div className="prerequisite-evidence"><strong>Plan evidence</strong><ul>{evaluation.result.evidence.map((item, index) => <li key={`${item.clauseText}-${index}`}>{item.message}</li>)}</ul></div>}
        {evaluation.result.suggestedCounselorQuestions.length > 0 && <div className="prerequisite-questions"><strong>Ask a counselor</strong><ul>{evaluation.result.suggestedCounselorQuestions.map((question) => <li key={question}>{question}</li>)}</ul></div>}
      </details>}
      {recommendedPreparation.length > 0 && <details className="recommended-preparation"><summary>Recommended preparation</summary>{recommendedPreparation.map((text) => <p key={text}>{text}</p>)}</details>}
    </section>
  );
}
