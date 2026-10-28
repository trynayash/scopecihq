import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

/**
 * The few motion helpers the site needs. Everything here degrades to the
 * finished state: with reduced motion, or without IntersectionObserver,
 * nothing waits on an animation to become readable.
 */

export function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Reports once when `ref` first enters the viewport. */
export function useInView<T extends Element>(rootMargin = '-12% 0px -12% 0px') {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin, threshold: 0.01 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin]);

  return [ref, inView] as const;
}

/**
 * Advances through `delays.length` steps once `enabled` is true. With reduced
 * motion the final step is applied immediately. Changing `run` replays it.
 */
export function useTimeline(delays: readonly number[], enabled: boolean, run = 0) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    if (prefersReducedMotion()) {
      setStep(delays.length);
      return;
    }
    setStep(0);
    const timers = delays.map((delay, index) => window.setTimeout(() => setStep(index + 1), delay));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
    // `delays` is a module-level constant at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, run]);

  return step;
}

/**
 * Fades `[data-reveal]` descendants in as they reach the viewport. The
 * container carries `js-reveal`, which is what hides them until then; an
 * optional `data-reveal-delay` (ms) staggers siblings.
 */
export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
    for (const target of targets) {
      const delay = target.dataset.revealDelay;
      if (delay) target.style.setProperty('--reveal-delay', delay);
    }
    if (typeof IntersectionObserver === 'undefined' || prefersReducedMotion()) {
      targets.forEach((target) => target.classList.add('is-revealed'));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.01 },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);

  return ref;
}

/**
 * Tilts `ref` toward the pointer by writing `--tilt-x` / `--tilt-y` (in
 * degrees). Only for a fine pointer and without reduced motion; otherwise
 * the element keeps its resting pose.
 */
export function usePointerTilt<T extends HTMLElement>(maxDegrees = 5) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || prefersReducedMotion()) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    let frame = 0;
    let target = { x: 0, y: 0 };
    let current = { x: 0, y: 0 };

    const apply = () => {
      current = {
        x: current.x + (target.x - current.x) * 0.12,
        y: current.y + (target.y - current.y) * 0.12,
      };
      node.style.setProperty('--tilt-x', `${(-current.y * maxDegrees).toFixed(3)}deg`);
      node.style.setProperty('--tilt-y', `${(current.x * maxDegrees).toFixed(3)}deg`);
      if (Math.abs(target.x - current.x) > 0.001 || Math.abs(target.y - current.y) > 0.001) {
        frame = requestAnimationFrame(apply);
      } else {
        frame = 0;
      }
    };
    const kick = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    const onMove = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      target = { x: Math.max(-0.6, Math.min(0.6, x)), y: Math.max(-0.6, Math.min(0.6, y)) };
      kick();
    };
    const onLeave = () => {
      target = { x: 0, y: 0 };
      kick();
    };

    const area = node.parentElement ?? node;
    area.addEventListener('pointermove', onMove);
    area.addEventListener('pointerleave', onLeave);
    return () => {
      area.removeEventListener('pointermove', onMove);
      area.removeEventListener('pointerleave', onLeave);
      cancelAnimationFrame(frame);
    };
  }, [maxDegrees]);

  return ref;
}

/**
 * One selection mark that slides between the items of a group, so the eye
 * follows the choice rather than seeing one item switch off and another on.
 * Writes the selected item's box to `--ind-x`, `--ind-y`, `--ind-w` and
 * `--ind-h` on the container; the CSS draws the mark. The container gets
 * `data-indicator="placed"` before the first measure and `"ready"` a frame
 * later, so the mark appears in place and only animates on later moves.
 * With nothing selected the attribute goes, and the items' own selected
 * style is all there is. `key` is whatever changes when the selection does.
 */
export function useIndicator<T extends HTMLElement>(selector: string, key: unknown) {
  // A callback ref, so a group that mounts later (after data loads) is
  // still found.
  const [root, setRoot] = useState<T | null>(null);

  useLayoutEffect(() => {
    if (!root) return;
    let frame = 0;
    const place = () => {
      const item = root.querySelector<HTMLElement>(selector);
      if (!item) {
        delete root.dataset.indicator;
        return;
      }
      // Offsets are measured against the container, which the attribute
      // makes the positioned ancestor; transforms (a pressed item) are ignored.
      const first = !root.dataset.indicator;
      if (first) root.dataset.indicator = 'placed';
      root.style.setProperty('--ind-x', `${item.offsetLeft}px`);
      root.style.setProperty('--ind-y', `${item.offsetTop}px`);
      root.style.setProperty('--ind-w', `${item.offsetWidth}px`);
      root.style.setProperty('--ind-h', `${item.offsetHeight}px`);
      if (first) {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          if (root.dataset.indicator) root.dataset.indicator = 'ready';
        });
      }
    };
    place();
    // Labels change width when fonts load or the layout reflows.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (observer) {
      observer.observe(root);
      for (const child of Array.from(root.children)) observer.observe(child);
    }
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [root, selector, key]);

  return setRoot;
}

/**
 * Runs a DOM-changing update inside a view transition, so a page change or
 * a theme change crossfades instead of cutting. `kind` is set on <html> as
 * `data-transition` for the duration, for CSS that treats the two
 * differently. Without the API, or with reduced motion, the update just runs.
 */
export function withViewTransition(update: () => void, kind: 'page' | 'theme' = 'page') {
  if (typeof document === 'undefined' || !document.startViewTransition || prefersReducedMotion()) {
    update();
    return;
  }
  const html = document.documentElement;
  const transition = document.startViewTransition(() => flushSync(update));
  html.dataset.transition = kind;
  current = transition;
  // A newer transition skips this one; only the latest clears the marker.
  const clear = () => {
    if (current === transition) delete html.dataset.transition;
  };
  transition.finished.then(clear, clear);
}

let current: ViewTransition | null = null;
