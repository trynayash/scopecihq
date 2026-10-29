import { useEffect, useState } from 'react';

/**
 * Says so while the browser is offline, so a save that can't reach ScopeCI
 * isn't a surprise. It sits at the bottom of the window and leaves once the
 * connection is back.
 */
export function OfflineNotice() {
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => {
    const update = () => setOffline(navigator.onLine === false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return (
    <div className="offline-notice" role="status" data-shown={offline || undefined}>
      {offline ? "You're offline. Nothing can be saved until you reconnect." : ''}
    </div>
  );
}
