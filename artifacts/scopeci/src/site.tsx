import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { SiGithub, SiLinear } from 'react-icons/si';

/**
 * Pieces every public page shares: paths, analytics, page metadata, the
 * masthead and the footer.
 */

export const WORDMARK = '/assets/logo-wordmark.png';
export const ICON_MARK = '/assets/logo-icon.png';

/* Absolute paths, so in-page anchors also work from routes other than "/". */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
export const PRIVACY_PATH = `${BASE}/privacy`;
export const TRY_PATH = `${BASE}/try`;
export const anchor = (id: string) => `${BASE}/#${id}`;

/* ------------------------------------------------------------------ */
/* Attribution & lightweight analytics                                 */
/* ------------------------------------------------------------------ */

interface Attribution {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  referrer: string | null;
}

function captureAttribution(): Attribution {
  const params = new URLSearchParams(window.location.search);
  return {
    utmSource: params.get('utm_source'),
    utmMedium: params.get('utm_medium'),
    utmCampaign: params.get('utm_campaign'),
    utmContent: params.get('utm_content'),
    utmTerm: params.get('utm_term'),
    referrer: document.referrer || null,
  };
}

/** Module-level singleton — read once, never mutated. */
export const attribution = captureAttribution();

/**
 * Fire-and-forget analytics. Uses sendBeacon when available so events
 * survive page unloads; falls back to a detached fetch. Never blocks
 * rendering or throws. The server only accepts the event names it lists in
 * routes/events.ts, so add new ones there too.
 */
export function track(event: string): void {
  try {
    const payload = JSON.stringify({
      event,
      source: attribution.utmSource,
      medium: attribution.utmMedium,
      campaign: attribution.utmCampaign,
      referrer: attribution.referrer,
      landingPage: window.location.pathname,
    });

    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(`${BASE}/api/events`, blob);
    } else {
      fetch(`${BASE}/api/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // Analytics must never break the page.
  }
}

/** Keeps the document title, description and canonical in step with the route. */
export function usePageMeta(title: string, description: string) {
  useEffect(() => {
    document.title = title;
    const setMeta = (selector: string, value: string) => {
      document.querySelector(selector)?.setAttribute('content', value);
    };
    setMeta('meta[name="description"]', description);
    setMeta('meta[property="og:title"]', title);
    setMeta('meta[property="og:description"]', description);
    setMeta('meta[property="og:url"]', window.location.origin + window.location.pathname);
    setMeta(
      'meta[property="og:image"]',
      `${window.location.origin}${BASE}/assets/logo-with-bg-and-wordmark.png`,
    );
    setMeta('meta[name="twitter:title"]', title);
    setMeta('meta[name="twitter:description"]', description);
    setMeta(
      'meta[name="twitter:image"]',
      `${window.location.origin}${BASE}/assets/logo-with-bg-and-wordmark.png`,
    );

    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      document.head.appendChild(canonical);
    }
    canonical.href = window.location.origin + window.location.pathname;
  }, [title, description]);
}

/* ------------------------------------------------------------------ */
/* Vendor marks                                                        */
/* ------------------------------------------------------------------ */

/**
 * Official GitHub / Linear marks (Simple Icons paths via react-icons),
 * drawn in `currentColor` so they sit inside the ScopeCI palette. They name the
 * tools ScopeCI is being built for. No partnership is implied. Jira is not
 * supported, so its mark is not shown.
 */
export function VendorMark({ name, size = 14 }: { name: 'github' | 'linear'; size?: number }) {
  const Mark = name === 'github' ? SiGithub : SiLinear;
  return <Mark className="vendor-mark" size={size} aria-hidden="true" focusable="false" />;
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`masthead ${scrolled ? 'is-scrolled' : ''}`}>
      <nav className="masthead-inner container" aria-label="Primary">
        <a className="brand" href={anchor('top')} data-testid="link-brand">
          <picture className="brand-logo">
            <source media="(max-width: 719px)" srcSet={ICON_MARK} />
            <img
              src={WORDMARK}
              alt="ScopeCI"
              width="651"
              height="217"
              decoding="async"
            />
          </picture>
        </a>

        <div className="masthead-actions">
          <a className="masthead-link" href={anchor('how-it-works')} data-testid="link-how-it-works">
            How it works
          </a>
          <a className="masthead-link" href={TRY_PATH} data-testid="link-try">
            Try it
          </a>
          <a className="masthead-link" href={anchor('questions')} data-testid="link-questions">
            Questions
          </a>
          <a className="button button-primary button-sm" href={anchor('waitlist')} data-testid="button-join-waitlist-nav">
            Join waitlist
            <ArrowRight size={14} aria-hidden="true" />
          </a>
        </div>
      </nav>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Footer                                                              */
/* ------------------------------------------------------------------ */

export function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-top">
          <div className="footer-brand">
            <img
              src={WORDMARK}
              alt="ScopeCI"
              width="651"
              height="217"
              loading="lazy"
              decoding="async"
            />
            <p>Scope checks for agency pull requests.</p>
          </div>
          <nav className="footer-links mono" aria-label="Footer">
            <a href={anchor('how-it-works')} data-testid="link-how-footer">How it works</a>
            <a href={TRY_PATH} data-testid="link-try-footer">Try it</a>
            <a href={anchor('waitlist')} data-testid="link-waitlist-footer">Waitlist</a>
            <a href={PRIVACY_PATH} data-testid="link-privacy-footer">Privacy</a>
          </nav>
        </div>
        <div className="footer-bottom mono">
          <span>© 2026 ScopeCI</span>
          <span>In development</span>
        </div>
      </div>
    </footer>
  );
}
