import type { Variants } from 'framer-motion';

/** Stagger wrapper — use on a container, pair with itemVariants on children */
export const containerVariants: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.04,
    },
  },
};

/** Standard card entrance — slide up + fade */
export const itemVariants: Variants = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { duration: 0.42, ease: [0.25, 0.1, 0.25, 1] },
  },
};

/** Slide in from the right — for side-panel items (pending actions) */
export const slideRightVariants: Variants = {
  hidden: { x: 16, opacity: 0 },
  visible: {
    x: 0,
    opacity: 1,
    transition: { duration: 0.38, ease: [0.25, 0.1, 0.25, 1] },
  },
};

/** Fade + subtle scale — for chart containers */
export const fadeScaleVariants: Variants = {
  hidden: { opacity: 0, scale: 0.985 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.45, ease: 'easeOut' },
  },
};

/** Card hover lift — spring-based, applied via whileHover */
export const cardHoverVariants: Variants = {
  hover: {
    y: -3,
    boxShadow:
      '0 8px 24px -4px rgba(0,0,0,0.35), 0 2px 8px -2px rgba(0,0,0,0.2)',
    transition: { type: 'spring', stiffness: 300, damping: 20 },
  },
};

/**
 * Tighter stagger for table/list rows — 30 ms gap, immediate start.
 * Pair with itemVariants on children.
 */
export const listContainerVariants: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.03,
      delayChildren: 0,
    },
  },
};

/** Page enter/exit — fade + subtle Y drift, 18 ms exit for snappiness */
export const pageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] as const },
  },
  exit: {
    opacity: 0,
    y: -4,
    transition: { duration: 0.14, ease: [0.25, 0.1, 0.25, 1] as const },
  },
};
