// Site-tuned adaptation of React Bits Shiny Text (David Haz),
// MIT + Commons Clause. Reduced-motion safe and styled by global.css.
// https://www.reactbits.dev/text-animations/shiny-text
import { useReducedMotion } from "motion/react";
import type { CSSProperties } from "react";

interface ShinyTextProps {
  text: string;
  className?: string;
  speed?: number;
  disabled?: boolean;
}

export default function ShinyText({
  text,
  className = "",
  speed = 1.7,
  disabled = false
}: ShinyTextProps) {
  const reduceMotion = useReducedMotion();
  const animationDisabled = disabled || reduceMotion;
  const style = { "--shiny-text-speed": `${speed}s` } as CSSProperties;

  return (
    <span
      className={`shiny-text${animationDisabled ? " is-static" : ""}${className ? ` ${className}` : ""}`}
      style={style}
    >
      {text}
    </span>
  );
}
