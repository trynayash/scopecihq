import { useEffect, useState } from 'react';

/** How long a wait lasts before it's worth saying so. */
const QUIET_MS = 300;

/**
 * Says what is loading, but only once the wait is long enough to notice.
 * Until then it holds an empty line, so nothing jumps when the text or the
 * content arrives.
 */
export function Loading({ children, className = 'app-loading' }: { children: string; className?: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setShown(true), QUIET_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <p className={className} role="status">
      {shown ? children : ' '}
    </p>
  );
}
