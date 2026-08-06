---
name: AnimatedKpi usage contract
description: AnimatedKpi is a full card component — wrong to use as inline formatter
---

`AnimatedKpi` (`artifacts/nodaq/src/components/animated-kpi.tsx`) is a **full card** component that renders its own wrapper, label, icon, and animated counter. Required props: `label`, `target`, `format`, `icon`.

**Why:** Attempts to use it as a bare inline number formatter (passing `value`, `formatFn`, `className`) cause a runtime "format is not a function" error because the prop is named `format` and it's required.

**How to apply:** When you need an animated number inside a custom layout, build a simple spring animation directly (useMotionValue + useSpring) or just render the static formatted value — do NOT import AnimatedKpi for inline use.
