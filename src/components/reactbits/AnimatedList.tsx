// Reduced-motion-safe adaptation of React Bits Animated List (David Haz),
// MIT + Commons Clause. Keeps native list and button semantics intact.
// https://reactbits.dev/components/animated-list
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { useRef, type ReactNode } from "react";

interface AnimatedListProps<T> {
  items: readonly T[];
  itemKey: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  ariaLabel: string;
  className?: string;
}

function AnimatedListItem({
  children,
  index
}: {
  children: ReactNode;
  index: number;
}) {
  const itemRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const inView = useInView(itemRef, { amount: 0.12, once: true });

  return (
    <motion.div
      ref={itemRef}
      role="listitem"
      className="animated-list-item"
      layout={reduceMotion ? false : "position"}
      initial={reduceMotion ? false : { opacity: 0, y: 7 }}
      animate={reduceMotion || inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 7 }}
      exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
      transition={{
        layout: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
        opacity: { duration: 0.16, delay: reduceMotion ? 0 : Math.min(index, 5) * 0.012 },
        y: { duration: 0.2, delay: reduceMotion ? 0 : Math.min(index, 5) * 0.012, ease: [0.16, 1, 0.3, 1] }
      }}
    >
      {children}
    </motion.div>
  );
}

export default function AnimatedList<T>({
  items,
  itemKey,
  renderItem,
  ariaLabel,
  className = ""
}: AnimatedListProps<T>) {
  return (
    <div
      aria-label={ariaLabel}
      className={`animated-list ${className}`.trim()}
      data-react-bits="animated-list"
      role="list"
    >
      <AnimatePresence initial>
        {items.map((item, index) => (
          <AnimatedListItem index={index} key={itemKey(item)}>
            {renderItem(item, index)}
          </AnimatedListItem>
        ))}
      </AnimatePresence>
    </div>
  );
}
