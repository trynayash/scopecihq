/**
 * Work the server starts outside any request: a webhook's processing, a
 * re-check, the sweep. It is tracked so a shutdown (Render sends SIGTERM on
 * every deploy) can let it finish, rather than cut it off between saving a
 * commit's result and posting its check run on GitHub.
 */

const inflight = new Set<Promise<unknown>>();

/** Tracks `work` until it settles and returns it. Its errors stay the caller's to handle. */
export function runInBackground<T>(work: Promise<T>): Promise<T> {
  inflight.add(work);
  const forget = () => {
    inflight.delete(work);
  };
  work.then(forget, forget);
  return work;
}

/** How many pieces of background work are still running. */
export function backgroundCount(): number {
  return inflight.size;
}

/**
 * Waits until no background work is left, or `ms` has passed. Work started
 * while waiting is waited for too. Resolves true when everything finished.
 */
export async function drain(ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (inflight.size > 0) {
    const left = deadline - Date.now();
    if (left <= 0) return false;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled([...inflight]),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, left);
      }),
    ]);
    clearTimeout(timer);
  }
  return true;
}
