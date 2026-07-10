import type { ReactNode } from "react";
import { appliedCreditBreakdown } from "@/lib/planning";

type CreditKind = "completed" | "current" | "planned" | "unverified" | "remaining";

export function CoverageSegments({
  items,
  label
}: {
  items: Array<{ label: string; status: "complete" | "on_track" | "missing" }>;
  label: string;
}) {
  return (
    <div className="coverage-segments" role="img" aria-label={label}>
      {items.map((item) => <span className={item.status} title={`${item.label}: ${item.status.replace("_", " ")}`} key={item.label} />)}
    </div>
  );
}

export function CreditComposition({
  completed,
  current,
  planned,
  unverified,
  required
}: {
  completed: number;
  current: number;
  planned: number;
  unverified: number;
  required: number;
}) {
  const applied = appliedCreditBreakdown({ required, completed, current, planned, unverified });
  const pieces: Array<{ kind: CreditKind; value: number; label: string }> = [
    { kind: "completed", value: applied.completed, label: "Completed and applied" },
    { kind: "current", value: applied.current, label: "In progress and applied" },
    { kind: "planned", value: applied.planned, label: "Planned and applied" },
    { kind: "remaining", value: applied.remaining, label: "Still needed" }
  ];
  const visiblePieces = pieces.filter((piece) => piece.value > 0);

  return (
    <div className="credit-composition" aria-label={`${applied.total} of ${required} credits applied; ${applied.unverified} unverified credits excluded`}>
      {visiblePieces.map((piece) => (
        <span
          className={piece.kind}
          style={{ flexGrow: piece.value }}
          title={`${piece.label}: ${piece.value} credits`}
          key={piece.kind}
        />
      ))}
    </div>
  );
}

export function DataPair({ label, value, detail, action }: { label: string; value: ReactNode; detail: string; action?: ReactNode }) {
  return (
    <div className="data-pair">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
      {action}
    </div>
  );
}
