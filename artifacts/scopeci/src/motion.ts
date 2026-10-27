import { useEffect, useRef, useState } from 'react';

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
