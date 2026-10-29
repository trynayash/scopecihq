import { errorMessage } from '../scope-ui';

/**
 * What to show when something couldn't be loaded: what failed, in words, and
 * a way to ask again without reloading the page.
 */
export function LoadError({
  error,
  fallback,
  onRetry,
  retrying = false,
}: {
  error: unknown;
  fallback: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  return (
    <div className="load-error" role="alert">
      <p>{errorMessage(error, fallback)}</p>
      <button type="button" className="button button-quiet button-sm" onClick={onRetry} disabled={retrying}>
        {retrying ? 'Trying…' : 'Try again'}
      </button>
    </div>
  );
}

/**
 * A refresh that failed while the page already shows what it loaded before.
 * The page stays as it is, with anything being typed on it; this only says
 * it may be out of date, and offers to ask again.
 */
export function StaleNotice({
  error,
  what,
  onRetry,
  retrying = false,
}: {
  error: unknown;
  /** What couldn't be refreshed, as in "We couldn't refresh this project." */
  what: string;
  onRetry: () => void;
  retrying?: boolean;
}) {
  const reason = errorMessage(error, '');
  return (
    <div className="stale-notice" role="status">
      <p>
        We couldn't refresh {what}, so it may be out of date.{reason && ` ${reason}`}
      </p>
      <button type="button" className="button button-quiet button-sm" onClick={onRetry} disabled={retrying}>
        {retrying ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  );
}
