import { motion, useReducedMotion, type Variants } from "motion/react";
import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { useId } from "react";

interface BentoGridProps extends Omit<ComponentPropsWithoutRef<typeof motion.div>, "children"> {
  children: ReactNode;
}

interface BentoCardProps extends Omit<ComponentPropsWithoutRef<typeof motion.section>, "children"> {
  title: string;
  Icon: ElementType;
  action?: ReactNode;
  children: ReactNode;
}

const gridVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.055 } }
};

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] }
  }
};

// Adapted from Magic UI's MIT-licensed Bento Grid for this project's native CSS system.
// https://magicui.design/docs/components/bento-grid
export function BentoGrid({ children, className = "", ...props }: BentoGridProps) {
  const reduceMotion = useReducedMotion();
  return <motion.div
    className={`magic-bento-grid ${className}`.trim()}
    data-magic-ui="bento-grid"
    initial={reduceMotion ? false : "hidden"}
    animate="visible"
    variants={reduceMotion ? undefined : gridVariants}
    {...props}
  >{children}</motion.div>;
}

export function BentoCard({ title, Icon, action, children, className = "", ...props }: BentoCardProps) {
  const headingId = useId();
  const reduceMotion = useReducedMotion();
  return <motion.section
    className={`magic-bento-card ${className}`.trim()}
    aria-labelledby={headingId}
    data-magic-ui="bento-card"
    variants={reduceMotion ? undefined : cardVariants}
    {...props}
  >
    <header className="magic-bento-heading">
      <h2 id={headingId}><Icon size={16} weight="duotone" aria-hidden />{title}</h2>
      {action && <div className="magic-bento-action">{action}</div>}
    </header>
    <div className="magic-bento-body">{children}</div>
  </motion.section>;
}
