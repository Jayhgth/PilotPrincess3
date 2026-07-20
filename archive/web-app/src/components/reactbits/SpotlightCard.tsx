// Accessibility-tuned adaptation of React Bits Spotlight Card (David Haz),
// MIT + Commons Clause. Adds keyboard-focus positioning and frame-coalesced updates.
// https://www.reactbits.dev/components/spotlight-card
import {
  useEffect,
  useRef,
  type CSSProperties,
  type FocusEvent,
  type PointerEvent,
  type PropsWithChildren
} from "react";

interface SpotlightCardProps extends PropsWithChildren {
  className?: string;
  spotlightColor?: string;
}

interface PendingPosition {
  x: number;
  y: number;
}

export default function SpotlightCard({
  children,
  className = "",
  spotlightColor
}: SpotlightCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(0);
  const pendingPositionRef = useRef<PendingPosition | null>(null);

  useEffect(() => () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
  }, []);

  function applyPosition(position: PendingPosition) {
    const card = cardRef.current;
    if (!card) return;
    card.style.setProperty("--spotlight-x", `${position.x}px`);
    card.style.setProperty("--spotlight-y", `${position.y}px`);
  }

  function queuePosition(position: PendingPosition) {
    pendingPositionRef.current = position;
    if (frameRef.current) return;

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      if (pendingPositionRef.current) applyPosition(pendingPositionRef.current);
    });
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const card = cardRef.current;
    if (!card || event.pointerType === "touch") return;
    const rect = card.getBoundingClientRect();
    queuePosition({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  }

  function handlePointerLeave() {
    pendingPositionRef.current = null;
    const card = cardRef.current;
    if (!card?.matches(":focus-within")) {
      card?.style.setProperty("--spotlight-x", "50%");
      card?.style.setProperty("--spotlight-y", "18%");
    }
  }

  function handleFocus(event: FocusEvent<HTMLDivElement>) {
    const card = cardRef.current;
    const target = event.target;
    if (!card || !(target instanceof HTMLElement)) return;
    const cardRect = card.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    applyPosition({
      x: targetRect.left - cardRect.left + targetRect.width / 2,
      y: targetRect.top - cardRect.top + targetRect.height / 2
    });
  }

  const style = spotlightColor
    ? ({ "--spotlight-color": spotlightColor } as CSSProperties)
    : undefined;

  return (
    <div
      className={`spotlight-card ${className}`.trim()}
      data-react-bits="spotlight-card"
      onFocusCapture={handleFocus}
      onPointerLeave={handlePointerLeave}
      onPointerMove={handlePointerMove}
      ref={cardRef}
      style={style}
    >
      {children}
    </div>
  );
}
