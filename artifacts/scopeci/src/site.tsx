import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { SiGithub } from 'react-icons/si';
import { ArrowRightIcon, CrossIcon, Icon, MenuIcon, MoonIcon, SunIcon, SystemThemeIcon } from './icons';
import { useIndicator, withViewTransition } from './motion';
import { LEGAL_OPERATOR } from './legal';

/** The footer names the city; the legal pages give the full place. */
const LEGAL_CITY = 'Mumbai, India';

/**
 * Pieces every public page shares: paths, analytics, page metadata, the
 * logo, the theme controls, the masthead and the footer.
 */

export const ICON_MARK = '/assets/logo-icon.png';

/* Absolute paths, so in-page anchors also work from routes other than "/". */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
export const HOME_PATH = `${BASE}/`;
export const PRIVACY_PATH = `${BASE}/privacy`;
export const TERMS_PATH = `${BASE}/terms`;
export const SECURITY_PATH = `${BASE}/security`;
export const CONTACT_PATH = `${BASE}/contact`;
export const TRY_PATH = `${BASE}/try`;
export const APP_PATH = `${BASE}/app`;
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
/* Marks                                                               */
/* ------------------------------------------------------------------ */

/**
 * The official GitHub mark (Simple Icons path via react-icons), drawn in
 * `currentColor` so it sits inside the ScopeCI palette. It names the tool
 * ScopeCI works with. No partnership is implied.
 */
export function VendorMark({ size = 14 }: { name: 'github'; size?: number }) {
  return <SiGithub className="vendor-mark" size={size} aria-hidden="true" focusable="false" />;
}

/**
 * The supplied mark with the name set as live text, so the wordmark follows
 * the theme instead of being a dark picture on a dark page.
 */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="logo">
      <img className="logo-mark" src={ICON_MARK} alt="" width="288" height="270" decoding="async" />
      <span className={`logo-word ${compact ? 'is-compact' : ''}`}>
        Scope<span>CI</span>
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

/** next-themes only knows the theme after mount; render nothing until then. */
function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/** One button that flips between light and dark. */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const dark = mounted && resolvedTheme === 'dark';
  return (
    <button
      type="button"
      className="icon-button theme-toggle"
      onClick={() => withViewTransition(() => setTheme(dark ? 'light' : 'dark'), 'theme')}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={dark ? 'Light theme' : 'Dark theme'}
      data-testid="button-theme-toggle"
    >
      {mounted ? <Icon icon={dark ? SunIcon : MoonIcon} size={16} /> : <span className="theme-toggle-blank" />}
    </button>
  );
}

const THEME_OPTIONS = [
  { value: 'system', label: 'System', glyph: SystemThemeIcon },
  { value: 'light', label: 'Light', glyph: SunIcon },
  { value: 'dark', label: 'Dark', glyph: MoonIcon },
] as const;

/** System, light or dark, as a three-way switch. */
export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  const current = mounted ? (theme ?? 'system') : null;
  const ref = useIndicator<HTMLDivElement>('[aria-pressed="true"]', current);
  return (
    <div className="theme-switch" role="group" aria-label="Theme" ref={ref}>
      {THEME_OPTIONS.map(({ value, label, glyph }) => {
        const checked = current === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={checked}
            className={checked ? 'is-active' : ''}
            onClick={() => withViewTransition(() => setTheme(value), 'theme')}
            title={label}
          >
            <Icon icon={glyph} size={14} />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

const NAV_LINKS = [
  { href: anchor('product'), label: 'Product', testId: 'link-product' },
  { href: anchor('how-it-works'), label: 'How it works', testId: 'link-how-it-works' },
  { href: anchor('policy'), label: 'Policies', testId: 'link-policy' },
  { href: TRY_PATH, label: 'Try it', testId: 'link-try' },
  { href: anchor('questions'), label: 'Questions', testId: 'link-questions' },
];

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // The menu covers the page on a phone: hold the page still and let
  // Escape or a wider window close it.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const wide = window.matchMedia('(min-width: 1024px)');
    const onWide = () => wide.matches && setOpen(false);
    document.documentElement.classList.add('menu-open');
    window.addEventListener('keydown', onKey);
    wide.addEventListener('change', onWide);
    return () => {
      document.documentElement.classList.remove('menu-open');
      window.removeEventListener('keydown', onKey);
      wide.removeEventListener('change', onWide);
    };
  }, [open]);

  return (
    <header className={`site-header ${scrolled || open ? 'is-scrolled' : ''} ${open ? 'is-open' : ''}`}>
      <div className="container site-header-inner">
        <a className="brand" href={anchor('top')} aria-label="ScopeCI home" data-testid="link-brand">
          <Logo />
        </a>

        <nav className="site-nav" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <a key={link.href} className="site-nav-link" href={link.href} data-testid={link.testId}>
              {link.label}
            </a>
          ))}
        </nav>

        <div className="site-header-actions">
          <ThemeToggle />
          <a className="site-nav-link site-signin" href={APP_PATH} data-testid="link-sign-in">
            Sign in
          </a>
          <a className="button button-primary button-sm site-cta" href={anchor('waitlist')} data-testid="button-join-waitlist-nav">
            Join the pilot
            <Icon icon={ArrowRightIcon} size={14} />
          </a>
          <button
            type="button"
            className="icon-button menu-toggle"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((value) => !value)}
          >
            <Icon icon={open ? CrossIcon : MenuIcon} size={18} />
          </button>
        </div>
      </div>

      <div id="mobile-menu" className="mobile-menu" hidden={!open}>
        <nav className="container mobile-menu-inner" aria-label="Menu">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} onClick={() => setOpen(false)}>
              {link.label}
            </a>
          ))}
          <a href={APP_PATH} onClick={() => setOpen(false)}>
            Sign in
          </a>
          <div className="mobile-menu-foot">
            <a className="button button-primary button-lg" href={anchor('waitlist')} onClick={() => setOpen(false)}>
              Join the pilot
              <Icon icon={ArrowRightIcon} size={16} />
            </a>
            <ThemeSwitch />
          </div>
        </nav>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Footer                                                              */
/* ------------------------------------------------------------------ */

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <a href={anchor('top')} aria-label="ScopeCI home">
              <Logo />
            </a>
            <p>
              Scope checks for agency pull requests. Built for teams that sell fixed-price and milestone work.
            </p>
          </div>
          <nav className="footer-col" aria-labelledby="footer-product">
            <h2 id="footer-product">Product</h2>
            <a href={anchor('product')} data-testid="link-product-footer">Product</a>
            <a href={anchor('how-it-works')} data-testid="link-how-footer">How it works</a>
            <a href={anchor('policy')}>Policies</a>
            <a href={TRY_PATH} data-testid="link-try-footer">Try it on your SOW</a>
            <a href={APP_PATH}>Sign in</a>
          </nav>
          <nav className="footer-col" aria-labelledby="footer-company">
            <h2 id="footer-company">ScopeCI</h2>
            <a href={anchor('waitlist')} data-testid="link-waitlist-footer">Join the pilot</a>
            <a href={anchor('questions')}>Questions</a>
            <a href={CONTACT_PATH} data-testid="link-contact-footer">Contact</a>
          </nav>
          <nav className="footer-col" aria-labelledby="footer-legal">
            <h2 id="footer-legal">Legal</h2>
            <a href={TERMS_PATH} data-testid="link-terms-footer">Terms of Service</a>
            <a href={PRIVACY_PATH} data-testid="link-privacy-footer">Privacy Policy</a>
            <a href={SECURITY_PATH} data-testid="link-security-footer">Security</a>
          </nav>
        </div>
        <div className="footer-bottom">
          <span>
            © 2026 ScopeCI · Run by {LEGAL_OPERATOR} in {LEGAL_CITY} · Early access
          </span>
          <ThemeSwitch />
        </div>
      </div>
    </footer>
  );
}
