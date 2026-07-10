// Reduced-motion-safe adaptation of React Bits Fade Content.
// https://www.reactbits.dev/animations/fade-content
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

export default function FadeContent({
  children,
  className = "",
  blur = false,
  duration = 0.2
}: {
  children: ReactNode;
  className?: string;
  blur?: boolean;
  duration?: number;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : { opacity: 0, y: 5, filter: blur ? "blur(5px)" : "blur(0px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
