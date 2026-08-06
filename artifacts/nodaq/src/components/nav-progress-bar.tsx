import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';

/**
 * Thin primary-colour bar that sweeps left→right on every route change.
 * Pure CSS animation — no JS timer, no state machine.
 * Fixed at the very top of the viewport, above everything (z-[60]).
 */
export function NavProgressBar() {
  const [location] = useLocation();
  const [key, setKey] = useState(0);
  const prevRef = useRef(location);

  useEffect(() => {
    if (location !== prevRef.current) {
      prevRef.current = location;
      setKey((k) => k + 1);
    }
  }, [location]);

  // key change causes React to remount the inner div, replaying the CSS animation
  return (
    <div
      className="fixed top-0 left-0 right-0 z-[60] h-[2px] pointer-events-none"
      aria-hidden
    >
      <div key={key} className="nav-progress h-full" />
    </div>
  );
}
