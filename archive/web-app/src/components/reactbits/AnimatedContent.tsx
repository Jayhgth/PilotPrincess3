// Reduced-motion-safe adaptation of React Bits Animated Content (David Haz),
// MIT + Commons Clause. Uses the project's existing Motion runtime.
// https://www.reactbits.dev/animations/animated-content
import { motion, useReducedMotion } from "motion/react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

interface AnimatedContentProps extends Omit<ComponentPropsWithoutRef<typeof motion.div>, "children"> {
  children: ReactNode;
  distance?: number;
  direction?: "vertical" | "horizontal";
  reverse?: boolean;
  duration?: number;
  delay?: number;
  threshold?: number;
}

export default function AnimatedContent({
  children,
  distance = 10,
  direction = "vertical",
  reverse = false,
  duration = 0.28,
  delay = 0,
  threshold = 0.08,
  ...props
}: AnimatedContentProps) {
  const reduceMotion = useReducedMotion();
  const offset = (reverse ? -1 : 1) * distance;
  const initial = direction === "horizontal"
    ? { opacity: 0, x: offset }
    : { opacity: 0, y: offset };

  return (
    <motion.div
      initial={reduceMotion ? false : initial}
      whileInView={reduceMotion ? undefined : { opacity: 1, x: 0, y: 0 }}
      viewport={{ once: true, amount: threshold }}
      transition={{ duration, delay, ease: [0.16, 1, 0.3, 1] }}
      {...props}
    >
      {children}
    </motion.div>
  );
}
