import { useState, useEffect } from 'react';

/**
 * Layout switch for small screens. The styles here are inline objects, which
 * can't carry media queries, so the breakpoint has to be read in JS.
 * 760px keeps tablets on the desktop layout.
 */
export function useIsMobile(breakpoint = 760) {
  const query = `(max-width: ${breakpoint}px)`;
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = e => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return isMobile;
}
