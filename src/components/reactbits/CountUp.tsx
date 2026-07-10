// Adapted from React Bits Count Up (David Haz), MIT + Commons Clause.
// https://www.reactbits.dev/text-animations/count-up
import { useInView, useMotionValue, useReducedMotion, useSpring } from "motion/react";
import { useCallback, useEffect, useRef } from "react";

interface CountUpProps {
  to: number;
  from?: number;
  delay?: number;
  duration?: number;
  className?: string;
  separator?: string;
  suffix?: string;
}

export default function CountUp({
  to,
  from = 0,
  delay = 0,
  duration = 0.35,
  className = "",
  separator = "",
  suffix = ""
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const motionValue = useMotionValue(from);
  const reduceMotion = useReducedMotion();
  const springValue = useSpring(motionValue, {
    damping: 20 + 40 * (1 / duration),
    stiffness: 100 * (1 / duration)
  });
  const isInView = useInView(ref, { once: true, margin: "0px" });

  const maxDecimals = Math.max(
    (from.toString().split(".")[1] ?? "").length,
    (to.toString().split(".")[1] ?? "").length
  );

  const formatValue = useCallback((latest: number) => {
    const formattedNumber = Intl.NumberFormat("en-US", {
      useGrouping: Boolean(separator),
      minimumFractionDigits: maxDecimals,
      maximumFractionDigits: maxDecimals
    }).format(latest);

    const value = separator ? formattedNumber.replace(/,/g, separator) : formattedNumber;
    return `${value}${suffix}`;
  }, [maxDecimals, separator, suffix]);

  useEffect(() => {
    if (ref.current) ref.current.textContent = formatValue(reduceMotion ? to : from);
  }, [formatValue, from, reduceMotion, to]);

  useEffect(() => {
    if (!isInView) return;
    if (reduceMotion) {
      motionValue.set(to);
      return;
    }

    const timeoutId = window.setTimeout(() => motionValue.set(to), delay * 1000);
    return () => window.clearTimeout(timeoutId);
  }, [delay, isInView, motionValue, reduceMotion, to]);

  useEffect(() => {
    const unsubscribe = springValue.on("change", (latest) => {
      if (ref.current) ref.current.textContent = formatValue(latest);
    });
    return () => unsubscribe();
  }, [formatValue, springValue]);

  return <span className={className} ref={ref}>{formatValue(reduceMotion ? to : from)}</span>;
}
