import {
  ArrowClockwiseIcon as ArrowClockwise,
  SparkleIcon as Sparkle
} from "@phosphor-icons/react";
import ShinyText from "@/components/reactbits/ShinyText";

interface SummaryGenerateButtonProps {
  loading: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export default function SummaryGenerateButton({
  loading,
  disabled = false,
  onClick
}: SummaryGenerateButtonProps) {
  return (
    <button
      className={`secondary-button summary-generate-button${loading ? " is-loading" : ""}`}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={loading}
    >
      {loading ? (
        <span className="summary-generate-status" aria-live="polite">
          <ArrowClockwise size={17} className="spin" />
          <ShinyText text="Generating summary" />
        </span>
      ) : (
        <><Sparkle size={17} /> Generate summary</>
      )}
    </button>
  );
}
