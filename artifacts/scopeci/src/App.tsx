import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  Check,
  Download,
  FileSignature,
  GitBranch,
  GitPullRequest,
  Circle,
  Inbox,
  Lock,
  ServerCog,
  X,
} from 'lucide-react';
import { SiGithub, SiJira, SiLinear } from 'react-icons/si';
import { useCreateWaitlistSignup } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();

const WORDMARK = '/assets/logo-wordmark.png';
const ICON_MARK = '/assets/logo-icon.png';

const PAGE_TITLE = 'ScopeCI — Commercial CI/CD for Software Agencies';
const PAGE_DESCRIPTION =
  'ScopeCI connects your contracts, project work and GitHub workflow to catch commercially unauthorized engineering work before it ships.';

const PRIVACY_TITLE = 'Privacy Policy — ScopeCI';
const PRIVACY_DESCRIPTION =
  'What ScopeCI collects through its early-access waitlist, why, and how to have it removed.';

/* Absolute paths, so in-page anchors also work from routes other than "/". */
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const HOME = `${BASE}/`;
const PRIVACY_PATH = `${BASE}/privacy`;
const ADMIN_PATH = `${BASE}/admin/waitlist`;
const anchor = (id: string) => `${BASE}/#${id}`;

/* ------------------------------------------------------------------ */
/* Attribution & lightweight analytics                                 */
/* ------------------------------------------------------------------ */

/** Captured once on page load — stays constant for the session. */
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

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
const attribution = captureAttribution();

/**
 * Fire-and-forget analytics. Uses sendBeacon when available so events
 * survive page unloads; falls back to a detached fetch. Never blocks
 * rendering or throws.
 */
function track(event: string): void {
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

/** One-shot scroll depth observers. */
function useScrollDepth() {
  useEffect(() => {
    if (prefersReducedMotion()) return;

    const fired = { 50: false, 90: false };

    const onScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight <= 0) return;
      const pct = (scrollTop / docHeight) * 100;

      if (!fired[50] && pct >= 50) {
        fired[50] = true;
        track('scroll_50');
      }
      if (!fired[90] && pct >= 90) {
        fired[90] = true;
        track('scroll_90');
      }

      if (fired[50] && fired[90]) {
        window.removeEventListener('scroll', onScroll);
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
}

/** Keeps the document title, description and canonical in step with the route. */
function usePageMeta(title: string, description: string) {
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
/* Motion primitives                                                   */
/* ------------------------------------------------------------------ */

function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Reports once when `ref` first enters the viewport. */
function useInView<T extends HTMLElement>(rootMargin = '-12% 0px -12% 0px') {
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
 * motion the final step is applied immediately, so nothing is conveyed by
 * animation alone.
 */
function useTimeline(delays: readonly number[], enabled: boolean) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    if (prefersReducedMotion()) {
      setStep(delays.length);
      return;
    }
    const timers = delays.map((delay, index) =>
      window.setTimeout(() => setStep(index + 1), delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
    // `delays` is a module-level constant at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return step;
}

function Reveal({
  children,
  className = '',
  delay = 0,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: 'div' | 'section' | 'header' | 'li';
}) {
  const [ref, inView] = useInView<HTMLDivElement>('0px 0px -8% 0px');
  return (
    <Tag
      ref={ref as never}
      className={`reveal ${inView ? 'is-visible' : ''} ${className}`.trim()}
      style={delay ? ({ '--reveal-delay': `${delay}ms` } as React.CSSProperties) : undefined}
    >
      {children}
    </Tag>
  );
}

/* ------------------------------------------------------------------ */
/* Vendor marks                                                        */
/* ------------------------------------------------------------------ */

/**
 * Official GitHub / Linear / Jira marks (Simple Icons paths via react-icons),
 * drawn in `currentColor` so they sit inside the ScopeCI palette. They are
 * shown to state compatibility only — no partnership is implied.
 */
function VendorMark({
  name,
  size = 14,
}: {
  name: 'github' | 'linear' | 'jira' | 'scopeci';
  size?: number;
}) {
  if (name === 'scopeci') {
    return (
      <img
        className="vendor-mark"
        src={ICON_MARK}
        alt=""
        width={size}
        height={size}
        decoding="async"
      />
    );
  }
  const Mark = name === 'github' ? SiGithub : name === 'linear' ? SiLinear : SiJira;
  return <Mark className="vendor-mark" size={size} aria-hidden="true" focusable="false" />;
}

function StackMarks({ size = 15 }: { size?: number }) {
  return (
    <span className="stack-marks" aria-hidden="true">
      <VendorMark name="github" size={size} />
      <VendorMark name="linear" size={size} />
      <VendorMark name="jira" size={size} />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

function Navbar() {
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
          <a className="masthead-link" href={anchor('waitlist')} data-testid="link-waitlist-nav">
            Waitlist
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
/* Hero product surface                                                */
/* ------------------------------------------------------------------ */

/* checking -> sow -> linear -> github -> verdict -> impact -> action.
   The whole sequence lands in ~1.4s, then the surface stays still. */
const REVIEW_STEPS = [140, 400, 600, 800, 1000, 1180, 1360] as const;

const EVIDENCE_ROWS = [
  { source: 'SOW', mark: 'sow', value: '§4.2 Authentication', result: 'no match', tone: 'bad' },
  { source: 'LINEAR', mark: 'linear', value: 'ENG-184', result: 'linked', tone: 'ok' },
  { source: 'GITHUB', mark: 'github', value: 'PR #1842', result: 'read', tone: 'ok' },
] as const;

function CommercialReviewSurface() {
  const [ref, inView] = useInView<HTMLDivElement>('0px');
  const step = useTimeline(REVIEW_STEPS, inView);
  const [requested, setRequested] = useState(false);

  const checking = step >= 1 && step < 5;
  const resolved = step >= 5;
  const actionable = step >= 7;

  return (
    <figure className="surface" ref={ref} data-testid="product-preview">
      <div className="window">
        <div className="window-bar">
          <span className="window-path mono">
            <VendorMark name="github" size={12} />
            northstar / api
          </span>
          <span className="window-ref mono">Pull request #1842</span>
        </div>

        <div className="window-body">
          {/* Left: the pull request as GitHub shows it. */}
          <div className="window-main">
            <div className="pr-head">
              <span className={`pr-state mono ${resolved ? 'is-held' : ''}`}>
                <GitPullRequest size={12} aria-hidden="true" />
                {resolved ? 'On hold' : 'Open'}
              </span>
              <p className="pr-title">Add organization-level permissions</p>
              <p className="pr-meta mono">
                <GitBranch size={11} aria-hidden="true" />
                <span>feature/org-permissions</span>
                <span className="pr-arrow" aria-hidden="true">&#8594;</span>
                <span>main</span>
                <span className="pr-sep" aria-hidden="true">·</span>
                <span>14 files</span>
                <span className="pos">+386</span>
                <span className="neg">&#8722;22</span>
              </p>
            </div>

            <ul className="checks mono" aria-label="Merge checks">
              <li>
                <span className="check-icon ok" aria-hidden="true"><Check size={10} /></span>
                <span className="check-name">build</span>
                <span className="check-result">passed</span>
              </li>
              <li>
                <span className="check-icon ok" aria-hidden="true"><Check size={10} /></span>
                <span className="check-name">test:unit</span>
                <span className="check-result">passed</span>
              </li>
              <li className={resolved ? 'is-failed' : 'is-running'}>
                <span className="check-icon" aria-hidden="true">
                  {resolved ? <X size={10} /> : <span className="check-pending" aria-hidden="true">…</span>}
                </span>
                <span className="check-name">scopeci / commercial</span>
                <span className="check-result">
                  {resolved ? 'not authorized' : checking ? 'checking scope' : 'queued'}
                </span>
              </li>
            </ul>

              <ul className="evidence-rows mono" aria-label="Evidence resolved by ScopeCI">
                {EVIDENCE_ROWS.map((row, index) => (
                  <li key={row.source} className={step >= index + 2 ? 'is-resolved' : ''}>
                    <span className="evidence-source">
                      {row.mark === 'sow' ? (
                        <FileSignature size={12} aria-hidden="true" />
                      ) : (
                        <VendorMark name={row.mark} size={12} />
                      )}
                      {row.source}
                    </span>
                    <span className="evidence-value">{row.value}</span>
                    <span className={`evidence-result ${row.tone}`}>
                      {step >= index + 2 ? row.result : 'resolving'}
                    </span>
                  </li>
                ))}
              </ul>
          </div>

          {/* Right: what ScopeCI adds to it. */}
          <div className="review">
            <div className="review-head">
              <span className="review-brand mono">
                <img src={ICON_MARK} alt="" width="288" height="270" decoding="async" />
                ScopeCI
              </span>
              <span className="review-label mono">Commercial review</span>
            </div>

            <p
              className={`verdict mono ${resolved ? 'is-blocked' : ''}`}
              data-testid="status-commercial-review"
            >
              {resolved ? 'Not authorized' : 'Reviewing'}
            </p>
            <p className="verdict-note">
              {resolved
                ? 'This work extends beyond the approved project scope.'
                : 'Comparing this pull request against the approved project scope.'}
            </p>


            <div className={`impact ${step >= 6 ? 'is-shown' : ''}`}>
              <div>
                <p className="impact-label mono">Estimated impact</p>
                <p className="impact-value mono">{step >= 6 ? '18–24 hrs' : 'calculating'}</p>
              </div>
              <p className="impact-amount mono">{step >= 6 ? '$2,700–$3,600' : '—'}</p>
            </div>

            <div className="review-row mono">
              <span>Change order</span>
              <strong>{actionable ? 'Not approved' : '—'}</strong>
            </div>

            <button
              type="button"
              className="button button-quiet review-action"
              disabled={!actionable || requested}
              onClick={() => setRequested(true)}
              data-testid="button-request-approval"
            >
              {requested ? 'Approval requested' : 'Request approval'}
            </button>
          </div>
        </div>
      </div>

      <figcaption className="sr-only">
        A ScopeCI commercial review of pull request #1842, Add organization-level
        permissions. Build and unit tests pass, but the commercial check resolves to
        not authorized: the work has no match in SOW §4.2, is linked to Linear issue
        ENG-184 and to PR #1842, and carries an estimated impact of 18 to 24 engineer
        hours, or $2,700 to $3,600. No change order is approved, so the merge is blocked.
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

function HeroGradientBars() {
  return (
    <div className="hero-gradient-bars" aria-hidden="true">
      {Array.from({ length: 23 }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

function Hero() {
  return (
    <section className="hero" id="top" aria-labelledby="hero-title">
      <HeroGradientBars />
      <div className="container hero-inner">
        <Reveal className="hero-lead">
          <div className="hero-trust">
            <span className="stack-marks" aria-hidden="true">
              <VendorMark name="github" size={14} />
              <VendorMark name="linear" size={14} />
              <VendorMark name="jira" size={14} />
            </span>
            <span>For agencies on GitHub, Linear, and Jira.</span>
          </div>

          <h1 className="hero-title" id="hero-title">
            Ship only work your client <em>approved.</em>
          </h1>

          <p className="hero-lede">
            ScopeCI connects your contract, project tracker, and GitHub workflow so
            unapproved client work gets caught before it reaches production.
          </p>

          <div className="hero-actions">
            <a
              className="button button-primary"
              href={anchor('waitlist')}
              data-testid="button-join-waitlist-hero"
              onClick={() => track('hero_cta_click')}
            >
              Join the waitlist
              <ArrowRight size={15} aria-hidden="true" />
            </a>
            <a
              className="button button-ghost"
              href={anchor('how-it-works')}
              data-testid="link-see-how-it-works"
            >
              See how it works
              <ArrowDown size={15} aria-hidden="true" />
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const GAP_CHAIN = [
  { name: 'Signed SOW', detail: 'what was sold', domain: 'Commercial', mark: 'sow' },
  { name: 'Client request', detail: 'new work enters', domain: 'Commercial', mark: 'request' },
  { name: 'Linear / Jira', detail: 'work is planned', domain: 'Engineering', mark: 'tracker' },
  { name: 'GitHub', detail: 'what was built', domain: 'Engineering', mark: 'github' },
  { name: 'ScopeCI', detail: 'Commercial authorization', domain: 'Control', mark: 'scopeci' },
  { name: 'Production', detail: 'approved work ships', domain: 'Release', mark: 'production' },
] as const;

/** Renders the real product mark for a stage, or a neutral glyph where the
 *  stage is not a specific vendor. */
function StageMark({ mark }: { mark: string }) {
  if (mark === 'github' || mark === 'scopeci') {
    return <VendorMark name={mark} size={15} />;
  }
  if (mark === 'tracker') {
    return (
      <>
        <VendorMark name="linear" size={15} />
        <VendorMark name="jira" size={15} />
      </>
    );
  }
  if (mark === 'sow') return <FileSignature size={15} aria-hidden="true" />;
  if (mark === 'request') return <Inbox size={15} aria-hidden="true" />;
  return <ServerCog size={15} aria-hidden="true" />;
}

function TheGap() {
  return (
    <section className="section section-gap" id="the-gap" aria-labelledby="gap-title">
      <div className="container split">
        <Reveal className="split-lede">
          <p className="eyebrow">The gap</p>
          <h2 className="section-title" id="gap-title">
            The contract knows what was sold.
            <br />
            GitHub knows what was built.
          </h2>
          <p className="section-lede">The problem lives between them.</p>
        </Reveal>

        <Reveal className="split-body" delay={80}>
          <ol className="chain" aria-label="Where work travels, from signed scope to production">
            {GAP_CHAIN.map((node) => {
              const isControl = node.name === 'ScopeCI';
              return (
                <li
                  key={node.name}
                  className={`chain-row ${isControl ? 'is-control' : ''} ${
                    node.name === 'Production' ? 'is-terminal' : ''
                  }`}
                >
                  <span className="chain-rail" aria-hidden="true">
                    <span className="chain-node" />
                  </span>
                  <span className="chain-mark" aria-hidden="true">
                    <StageMark mark={node.mark} />
                  </span>
                  <span className="chain-name">{node.name}</span>
                  <span className="chain-detail">{node.detail}</span>
                  <span className="chain-domain">{node.domain}</span>
                </li>
              );
            })}
          </ol>
        </Reveal>
      </div>
    </section>
  );
}

const CAPABILITIES = [
  {
    num: '01',
    title: 'Understand the contract',
    body: 'Turn signed SOWs and project agreements into a structured scope baseline.',
    detail: 'Deliverables, exclusions, assumptions, limits and milestones.',
  },
  {
    num: '02',
    title: 'Trace the work',
    body: 'Connect contractual scope to actual project work.',
    detail: 'Follow a request from the backlog all the way to the pull request.',
  },
  {
    num: '03',
    title: 'Control the merge',
    body: 'Require commercial approval before unauthorized work ships.',
    detail: "Warn, review or enforce based on the agency's policy.",
  },
] as const;

function WhatScopeCIDoes() {
  const [sectionRef, inView] = useInView<HTMLElement>('-15% 0px -15% 0px');
  const [activeCapability, setActiveCapability] = useState(0);
  const selectedCapability = CAPABILITIES[activeCapability];

  useEffect(() => {
    if (!inView || prefersReducedMotion()) return;
    const timer = window.setInterval(() => {
      setActiveCapability((current) => (current + 1) % CAPABILITIES.length);
    }, 3600);
    return () => window.clearInterval(timer);
  }, [inView]);

  return (
    <section
      className="section section-does"
      id="how-it-works"
      ref={sectionRef}
      aria-labelledby="does-title"
    >
      <div className="container split">
        <Reveal className="split-lede">
          <p className="eyebrow">What ScopeCI does</p>
          <h2 className="section-title" id="does-title">
            A commercial control layer for engineering.
          </h2>
        </Reveal>

        <div className="split-body capability-list">
          {CAPABILITIES.map((item, index) => (
            <div key={item.num}>
              <button
                type="button"
                className={`capability ${activeCapability === index ? 'is-active' : ''}`}
                aria-pressed={activeCapability === index}
                onClick={() => {
                  setActiveCapability(index);
                  track(`capability_${item.num}_selected`);
                }}
                data-testid={`article-work-${item.num}`}
              >
                <span className="capability-index mono">{item.num}</span>
                <div className="capability-body">
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                  <p className="capability-detail">{item.detail}</p>
                </div>
                <ArrowRight className="capability-arrow" size={16} aria-hidden="true" />
              </button>
            </div>
          ))}

          <div
            key={selectedCapability.num}
            className="capability-demo"
            aria-live="polite"
          >
            <div className="capability-demo-copy">
              <p className="mono capability-demo-label">Illustrative flow · {selectedCapability.num}</p>
              <h3>{selectedCapability.title}</h3>
              <p>{selectedCapability.body}</p>
            </div>
            <div className="capability-demo-flow" aria-label="Illustrative ScopeCI workflow">
              <span className="demo-chip">
                <FileSignature size={13} aria-hidden="true" />
                SOW
              </span>
              <span className="demo-connector" aria-hidden="true" />
              <span className="demo-chip">
                <VendorMark name="linear" size={13} />
                ENG-184
              </span>
              <span className="demo-connector" aria-hidden="true" />
              <span className="demo-chip">
                <VendorMark name="github" size={13} />
                PR #1842
              </span>
              <span className="demo-connector" aria-hidden="true" />
              <span className={`demo-chip demo-verdict is-${activeCapability}`}>
                {activeCapability === 2 ? <Check size={13} aria-hidden="true" /> : <Lock size={13} aria-hidden="true" />}
                {activeCapability === 2 ? 'Merge gate' : activeCapability === 1 ? 'Trace linked' : 'Scope baseline'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* The same work item, and the commercial state it carries at each stage. */
const WORK_STATES = [
  { stage: 'Signed SOW', ref: '§4.2 Authentication', state: 'approved', mark: 'sow' },
  { stage: 'Linear / Jira', ref: 'ENG-184', state: 'review', mark: 'tracker' },
  { stage: 'GitHub', ref: 'PR #1842', state: 'needs', mark: 'github' },
  { stage: 'Commercial check', ref: 'scopeci / commercial', state: 'blocked', mark: 'scopeci' },
  { stage: 'Approval', ref: 'Change order', state: 'needs', mark: 'approval' },
  { stage: 'Ship', ref: 'production', state: 'blocked', mark: 'production' },
] as const;

type StateKey = 'approved' | 'review' | 'needs' | 'blocked';

const STATE_META: Record<StateKey, { label: string; icon: ReactNode }> = {
  approved: { label: 'Approved', icon: <Check size={11} aria-hidden="true" /> },
  review: { label: 'Review', icon: <Circle size={9} aria-hidden="true" /> },
  needs: { label: 'Needs approval', icon: <AlertTriangle size={11} aria-hidden="true" /> },
  blocked: { label: 'Not authorized', icon: <X size={11} aria-hidden="true" /> },
};

const STATE_STEPS = [120, 260, 400, 540, 680, 820] as const;

function CommercialState() {
  const [ref, inView] = useInView<HTMLDivElement>('-10% 0px -18% 0px');
  const step = useTimeline(STATE_STEPS, inView);

  return (
    <section className="section section-state" aria-labelledby="state-title">
      <div className="container">
        <Reveal className="state-lede">
          <p className="eyebrow">Commercial state</p>
          <h2 className="section-title" id="state-title">
            The commercial state follows the work.
          </h2>
          <p className="section-lede">Every piece of work carries one.</p>
        </Reveal>

        <Reveal className="state-body" delay={80}>
          <div className="state-panel" ref={ref}>
            <div className="state-panel-head mono">
              <span className="state-panel-label">Work item</span>
              <span className="state-panel-ref">
                ENG-184 · Add organization-level permissions
              </span>
            </div>

            <ol className="state-rows mono" aria-label="Commercial state at each stage">
              {WORK_STATES.map((row, index) => {
                const meta = STATE_META[row.state as StateKey];
                const shown = step > index;
                return (
                  <li
                    key={row.stage}
                    className={`state-row ${shown ? 'is-shown' : ''}`}
                    data-testid={`state-row-${index + 1}`}
                  >
                    <span className="state-rail" aria-hidden="true">
                      <span className="state-node" />
                    </span>
                    <span className="state-mark" aria-hidden="true">
                      {row.mark === 'approval' ? (
                        <FileSignature size={14} aria-hidden="true" />
                      ) : (
                        <StageMark mark={row.mark} />
                      )}
                    </span>
                    <span className="state-stage">{row.stage}</span>
                    <span className="state-ref">{row.ref}</span>
                    <span className={`state-badge is-${row.state}`}>
                      {shown ? (
                        <>
                          {meta.icon}
                          {meta.label}
                        </>
                      ) : (
                        <span className="state-pending">resolving</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>

            <div className="state-legend mono" aria-hidden="true">
              {(Object.keys(STATE_META) as StateKey[]).map((key) => (
                <span key={key} className={`state-badge is-${key}`}>
                  {STATE_META[key].icon}
                  {STATE_META[key].label}
                </span>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Evidence() {
  return (
    <section className="section section-evidence" id="evidence" aria-labelledby="evidence-title">
      <div className="container">
        <Reveal className="evidence-lede">
          <p className="eyebrow">Evidence</p>
          <h2 className="section-title" id="evidence-title">Evidence, not guesses.</h2>
          <p className="section-lede">
            Every decision connects back to the contract and the work being built.
          </p>
        </Reveal>

        <Reveal className="evidence-body" delay={80}>
          <div className="ledger" data-testid="evidence-panel">
            <div className="ledger-grid">
              <div className="ledger-pane">
                <p className="pane-label mono">Project scope</p>
                <p className="pane-subject mono">
                  <FileSignature size={14} aria-hidden="true" />
                  Northstar / API
                </p>

                <p className="pane-group mono">Included</p>
                <ul className="scope-items mono">
                  <li className="is-included">
                    <Check size={12} aria-hidden="true" /> User authentication
                  </li>
                  <li className="is-included">
                    <Check size={12} aria-hidden="true" /> Profile management
                  </li>
                  <li className="is-included">
                    <Check size={12} aria-hidden="true" /> Account settings
                  </li>
                </ul>

                <p className="pane-group mono">Excluded</p>
                <ul className="scope-items mono">
                  <li className="is-excluded">
                    <X size={12} aria-hidden="true" /> Organization roles
                  </li>
                  <li className="is-excluded">
                    <X size={12} aria-hidden="true" /> Team invitations
                  </li>
                </ul>
              </div>

              {/* The seam carries the finding that connects the two sides. */}
              <div className="ledger-seam">
                <span className="seam-line" aria-hidden="true" />
                <span className="seam-label">Scope expansion</span>
                <span className="seam-line" aria-hidden="true" />
              </div>

              <div className="ledger-pane">
                <p className="pane-label mono">Engineering</p>
                <p className="pane-subject mono">
                  <VendorMark name="linear" size={14} />
                  ENG-184
                </p>
                <p className="pane-headline">Add organization-level permissions</p>

                <dl className="pane-facts mono">
                  <div>
                    <dt>Changed files</dt>
                    <dd>14</dd>
                  </div>
                  <div>
                    <dt>Estimated effort</dt>
                    <dd>18–24 hrs</dd>
                  </div>
                  <div>
                    <dt>Pull request</dt>
                    <dd>
                      <VendorMark name="github" size={12} />
                      #1842
                    </dd>
                  </div>
                </dl>

                <p className="pane-flag mono" data-testid="status-scope-expansion">
                  Matches an excluded deliverable.
                </p>
              </div>
            </div>

            {/* Trace lives inside the panel, so both sides read as one record. */}
            <div className="ledger-trace">
              <span className="trace-label mono">Trace</span>
              <ol className="trace mono" aria-label="Trace from contract clause to pull request">
                <li>SOW §4.2</li>
                <li>ENG-184</li>
                <li>PR #1842</li>
              </ol>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function CommercialCheck() {
  const [requested, setRequested] = useState(false);

  return (
    <section className="section section-check" aria-labelledby="check-title">
      <div className="container split split-reverse">
        <Reveal className="split-lede">
          <p className="eyebrow">Merge check</p>
          <h2 className="section-title" id="check-title">
            A merge should know what the contract says.
          </h2>
          <p className="section-lede">
            The commercial state sits with the pull request, where the decision is
            actually made — not in a spreadsheet discovered at invoicing.
          </p>
        </Reveal>

        <Reveal className="split-body" delay={80}>
          <div className="check-card" data-testid="commercial-check-panel">
            <div className="check-card-head">
              <span className="review-brand mono">
                <img src={ICON_MARK} alt="" width="288" height="270" decoding="async" />
                ScopeCI commercial check
              </span>
              <span className="check-card-ref mono">
                <VendorMark name="github" size={12} />
                northstar / api
              </span>
            </div>

            <div className="check-card-body">
              <p className="check-card-ref-line mono">Pull request #1842</p>
              <p className="check-card-title">Add organization-level permissions</p>

              <p className="check-verdict mono">
                <X size={13} aria-hidden="true" />
                Not authorized
              </p>

              <dl className="check-table mono">
                <div>
                  <dt>SOW match</dt>
                  <dd className="is-bad">No</dd>
                </div>
                <div>
                  <dt>Change order</dt>
                  <dd>Not approved</dd>
                </div>
                <div>
                  <dt>Policy</dt>
                  <dd>Block on unapproved scope</dd>
                </div>
              </dl>

              <div className="check-impact">
                <div>
                  <p className="impact-label mono">Estimated impact</p>
                  <p className="impact-value mono">18–24 engineer hours</p>
                </div>
                <p className="impact-amount mono">$2.7k–$3.6k</p>
              </div>

              <button
                type="button"
                className="button button-quiet check-action"
                onClick={() => setRequested(true)}
                disabled={requested}
                data-testid="button-request-commercial-approval"
              >
                {requested ? 'Approval requested' : 'Request approval'}
              </button>

              <p className="check-foot mono">
                Checked 3s ago · scopeci / commercial
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const DIFFERENTIATORS = [
  {
    title: 'Works with your stack',
    body: 'Keep GitHub, Linear, Jira and the workflows your team already uses.',
    marks: true,
  },
  {
    title: 'Commercially aware',
    body: 'Know whether engineering work is contractually approved before time disappears into it.',
  },
  {
    title: 'Engineering-native',
    body: 'ScopeCI lives close to the work — from issue to pull request to merge.',
  },
] as const;

function Differentiator() {
  return (
    <section className="section section-diff" aria-labelledby="diff-title">
      <div className="container">
        <Reveal className="diff-head">
          <h2 className="diff-title" id="diff-title">Not another project management tool.</h2>
        </Reveal>
        <Reveal className="diff-grid" delay={70}>
          {DIFFERENTIATORS.map((item) => (
            <div className="diff-item" key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
              {'marks' in item && item.marks ? <StackMarks size={16} /> : null}
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Waitlist                                                            */
/* ------------------------------------------------------------------ */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type WaitlistState = 'idle' | 'submitting' | 'success' | 'duplicate';

function Waitlist() {
  const [email, setEmail] = useState('');
  const [agency, setAgency] = useState('');
  const [state, setState] = useState<WaitlistState>('idle');
  const [emailError, setEmailError] = useState('');
  const [formError, setFormError] = useState('');

  const createSignup = useCreateWaitlistSignup();
  const submitting = state === 'submitting';
  const hasStartedRef = useRef(false);

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (submitting) return;

      const trimmedEmail = email.trim();
      const trimmedAgency = agency.trim();

      setFormError('');
      if (!trimmedEmail) {
        setEmailError('Enter your work email.');
        return;
      }
      if (trimmedEmail.length > 320 || !EMAIL_PATTERN.test(trimmedEmail)) {
        setEmailError('Enter a valid work email address.');
        return;
      }
      setEmailError('');
      setState('submitting');

      track('waitlist_submitted');

      createSignup.mutate(
        {
          data: {
            email: trimmedEmail.toLowerCase(),
            agency: trimmedAgency ? trimmedAgency.slice(0, 160) : null,
            ...attribution,
          } as never,
        },
        {
          onSuccess: () => {
            setState('success');
            track('waitlist_success');
          },
          onError: (error) => {
            setState('idle');
            const status = error?.status;
            if (status === 409) {
              setState('duplicate');
              track('waitlist_duplicate');
              return;
            }
            if (status === 400) {
              setEmailError(
                error?.data?.error ?? 'Enter a valid work email address.',
              );
              track('waitlist_error');
              return;
            }
            setFormError(
              "We couldn't save your request. Please try again in a moment.",
            );
            track('waitlist_error');
          },
        },
      );
    },
    [agency, createSignup, email, submitting],
  );

  const settled = state === 'success' || state === 'duplicate';

  return (
    <section className="waitlist" id="waitlist" aria-labelledby="waitlist-title">
      <div className="container split">
        <Reveal className="split-lede">
          <p className="eyebrow">Early access</p>
          <h2 className="section-title" id="waitlist-title">
            Put a commercial check in front of your next merge.
          </h2>
          <p className="section-lede">
            ScopeCI is being built for software development agencies working on
            fixed-price and milestone-based client projects.
          </p>
        </Reveal>

        <Reveal className="split-body" delay={80}>
          <div className="waitlist-panel">
            <div className="waitlist-panel-head mono">
              <span className="review-brand">
                <img src={ICON_MARK} alt="" width="288" height="270" decoding="async" />
                ScopeCI
              </span>
              <span className="waitlist-panel-label">Early access request</span>
            </div>
            {settled ? (
              <div className="settled" role="status" data-testid="waitlist-success">
                <span className="settled-mark" aria-hidden="true">
                  <Check size={18} />
                </span>
                <h3>
                  {state === 'duplicate'
                    ? "You're already on the list."
                    : "You're on the list."}
                </h3>
                <p>We'll reach out when early access opens.</p>
                <span className="settled-sig mono">ScopeCI</span>
              </div>
            ) : (
              <form className="waitlist-form" onSubmit={submit} noValidate>
                <div className="field">
                  <label className="mono" htmlFor="work-email">
                    Work email
                  </label>
                  <input
                    id="work-email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    maxLength={320}
                    required
                    placeholder="you@agency.com"
                    value={email}
                    disabled={submitting}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      if (emailError) setEmailError('');
                      if (!hasStartedRef.current) {
                        hasStartedRef.current = true;
                        track('waitlist_started');
                      }
                    }}
                    className={emailError ? 'is-invalid' : ''}
                    aria-invalid={Boolean(emailError)}
                    aria-describedby={emailError ? 'work-email-error' : undefined}
                    data-testid="input-work-email"
                  />
                  {emailError && (
                    <p className="field-error mono" id="work-email-error">
                      {emailError}
                    </p>
                  )}
                </div>

                <div className="field">
                  <label className="mono" htmlFor="agency-name">
                    Agency / company <span className="field-optional">optional</span>
                  </label>
                  <input
                    id="agency-name"
                    name="agency"
                    type="text"
                    autoComplete="organization"
                    maxLength={160}
                    placeholder="Your agency"
                    value={agency}
                    disabled={submitting}
                    onChange={(event) => setAgency(event.target.value)}
                    data-testid="input-agency-name"
                  />
                </div>

                <p aria-live="polite" className="form-status">
                  {formError && (
                    <span className="form-error mono" data-testid="status-waitlist-error">
                      {formError}
                    </span>
                  )}
                </p>

                <button
                  type="submit"
                  className="button button-primary waitlist-submit"
                  disabled={submitting}
                  data-testid="button-submit-waitlist"
                >
                  {submitting ? (
                    <>
                      <span className="spinner spinner-dark" aria-hidden="true" />
                      Requesting access
                    </>
                  ) : (
                    <>
                      Request early access
                      <ArrowRight size={15} aria-hidden="true" />
                    </>
                  )}
                </button>

                <p className="form-note mono">
                  No spam. Early product access and occasional updates.
                </p>
              </form>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Closing + footer                                                    */
/* ------------------------------------------------------------------ */

function Closing() {
  return (
    <section className="closing" aria-labelledby="closing-title">
      <div className="container">
        <Reveal>
          <h2 id="closing-title">Connect the contract to the code.</h2>
          <p className="mono">Commercial CI/CD for software agencies.</p>
        </Reveal>
      </div>
    </section>
  );
}

function Footer() {
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
            <p>Commercial CI/CD for software agencies.</p>
          </div>
          <nav className="footer-links mono" aria-label="Footer">
            <a href={anchor('waitlist')} data-testid="link-waitlist-footer">Waitlist</a>
            <a href={PRIVACY_PATH} data-testid="link-privacy-footer">Privacy</a>
            {/* No mailbox is configured yet, so "Contact" goes to the one channel
                that actually reaches us: the early-access form. */}
            <a href={anchor('waitlist')} data-testid="link-contact-footer">Contact</a>
          </nav>
        </div>
        <div className="footer-bottom mono">
          <span>© 2026 ScopeCI</span>
          <span>Commercial authorization for engineering work.</span>
        </div>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function Home() {
  usePageMeta(PAGE_TITLE, PAGE_DESCRIPTION);
  useScrollDepth();

  // Track the page view once.
  useEffect(() => { track('page_view'); }, []);

  // Arriving from another route (e.g. the footer's Waitlist/Contact links), the
  // browser resolves the hash before React has rendered these sections, so it
  // silently gives up. Re-run the jump once they exist.
  useEffect(() => {
    const { hash } = window.location;
    if (hash.length < 2) return;
    let target: Element | null = null;
    try {
      target = document.querySelector(hash);
    } catch {
      return; // not a usable selector
    }
    if (!target) return;
    const frame = requestAnimationFrame(() =>
      target?.scrollIntoView({ behavior: 'auto', block: 'start' }),
    );
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="site">
      <a className="skip-link" href="#main">Skip to content</a>
      <Navbar />
      <main id="main">
        <Hero />
        <TheGap />
        <WhatScopeCIDoes />
        <CommercialState />
        <Evidence />
        <CommercialCheck />
        <Differentiator />
        <Waitlist />
        <Closing />
      </main>
      <Footer />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Privacy                                                             */
/* ------------------------------------------------------------------ */

/**
 * Describes only what the site actually does today: one waitlist form, no
 * accounts, no analytics. Nothing here asserts a company entity, address or
 * jurisdiction, because none is established yet.
 */
const PRIVACY_SECTIONS: ReadonlyArray<{ heading: string; body: readonly string[] }> = [
  {
    heading: 'What we collect',
    body: [
      'When you submit the early-access form we store the work email address you enter, the agency or company name if you choose to add one, and the date the request was made.',
      'If you arrive through a campaign link, the URL may contain standard marketing parameters such as utm_source and utm_campaign. We store these alongside your signup so we can understand which channels bring us the most relevant users.',
      'That is the only information you give us. There is no account to create and no product to sign into yet, and no client, contract, issue-tracker or repository data is collected through this site.',
    ],
  },
  {
    heading: 'First-party analytics',
    body: [
      'This site records a small number of first-party analytics events — page views, scroll depth, and form interactions — to understand how visitors use the site. These events are sent to our own server, not to a third-party analytics service.',
      'No cookies are set for analytics. No personal information is included in the events.',
    ],
  },
  {
    heading: 'Technical information',
    body: [
      'As with any website, requests to ScopeCI are handled by our hosting and database providers, whose logs record standard technical details such as IP address, browser type and the pages requested. These logs exist to run, debug and secure the service.',
      'This site sets no advertising or tracking cookies.',
    ],
  },
  {
    heading: 'How we use it',
    body: [
      'Your email address is used to contact you about ScopeCI early access and occasional product updates — nothing else. We do not sell or rent early-access details, and we do not share them with third parties for their own marketing.',
    ],
  },
  {
    heading: 'Who else processes it',
    body: [
      'Waitlist entries are held in a hosted database, and the site is served by our hosting provider. Both process this information on our behalf so that the service can run.',
      'The site loads its typefaces from Google Fonts, so your browser requests those files from Google when a page loads.',
    ],
  },
  {
    heading: 'How long we keep it',
    body: [
      'We keep early-access requests until early access closes or you ask us to remove yours, whichever happens first.',
    ],
  },
  {
    heading: 'Your choices',
    body: [
      'You can ask us to remove your details from the early-access list at any time and we will delete the record. Depending on where you live, you may also have rights to access or correct the information we hold about you.',
    ],
  },
  {
    heading: 'Contact',
    body: [
      'We do not publish a dedicated privacy address yet. Until we do, reply to any email you receive from us about ScopeCI early access and we will handle access or removal requests from there.',
    ],
  },
  {
    heading: 'Changes to this policy',
    body: [
      'If this policy changes we will update the date at the top of this page. ScopeCI is still being built, so we expect to expand this policy as the product itself launches.',
    ],
  },
];

function Privacy() {
  usePageMeta(PRIVACY_TITLE, PRIVACY_DESCRIPTION);

  return (
    <div className="site site-legal">
      <a className="skip-link" href="#main">Skip to content</a>
      <Navbar />
      <main id="main">
        <article className="legal" aria-labelledby="privacy-title">
          <div className="container legal-inner">
            <header className="legal-head">
              <p className="eyebrow">ScopeCI</p>
              <h1 className="legal-title" id="privacy-title">Privacy Policy</h1>
              <p className="legal-meta mono">
                Last updated 10 September 2026 · Early access
              </p>
              <p className="legal-lede">
                ScopeCI is not generally available yet. Today this site does two
                things: it describes the product, and it collects early-access
                requests. This policy covers what that form collects, and what is
                processed to keep the site running.
              </p>
            </header>

            <ol className="legal-sections">
              {PRIVACY_SECTIONS.map((section, index) => (
                <li className="legal-section" key={section.heading}>
                  <span className="legal-num mono" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div className="legal-body">
                    <h2>{section.heading}</h2>
                    {section.body.map((paragraph) => (
                      <p key={paragraph.slice(0, 40)}>{paragraph}</p>
                    ))}
                  </div>
                </li>
              ))}
            </ol>

            <p className="legal-foot mono">
              <a href={anchor('waitlist')} data-testid="link-privacy-back">
                Back to ScopeCI
              </a>
            </p>
          </div>
        </article>
      </main>
      <Footer />
    </div>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

interface AdminSignup {
  id: number;
  email: string;
  agency: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  referrer: string | null;
  createdAt: string;
}

interface AdminStats {
  total: number;
  qualified: number;
  recent: number;
}

function AdminWaitlist() {
  usePageMeta('Admin — Waitlist', 'Internal admin page.');

  const [key, setKey] = useState(() => sessionStorage.getItem('admin_key') || '');
  const [authed, setAuthed] = useState(false);
  const [signups, setSignups] = useState<AdminSignup[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async (secret: string) => {
    setLoading(true);
    setError('');
    try {
      const headers = {
        Authorization: `Bearer ${secret}`,
        'x-admin-key': secret,
      };
      const [signupsRes, statsRes] = await Promise.all([
        fetch(`${BASE}/api/admin/waitlist`, { headers }),
        fetch(`${BASE}/api/admin/waitlist/stats`, { headers }),
      ]);
      if (signupsRes.status === 401 || statsRes.status === 401) {
        setError('Invalid admin key.');
        setAuthed(false);
        sessionStorage.removeItem('admin_key');
        return;
      }
      setSignups(await signupsRes.json());
      setStats(await statsRes.json());
      setAuthed(true);
      sessionStorage.setItem('admin_key', secret);
    } catch {
      setError('Failed to fetch data.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-login if key is in sessionStorage.
  useEffect(() => {
    if (key && !authed) fetchData(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmitKey = (e: FormEvent) => {
    e.preventDefault();
    if (key.trim()) fetchData(key.trim());
  };

  const handleExportCsv = () => {
    window.open(`${BASE}/api/admin/waitlist/csv?key=${encodeURIComponent(key)}`, '_blank');
  };

  if (!authed) {
    return (
      <div className="site">
        <main className="admin">
          <div className="container admin-gate">
            <Lock size={24} />
            <h1 className="mono">Admin access</h1>
            <form onSubmit={handleSubmitKey}>
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Admin key"
                className="admin-key-input mono"
                autoFocus
              />
              <button type="submit" className="button button-primary" disabled={loading}>
                {loading ? 'Verifying…' : 'Enter'}
              </button>
            </form>
            {error && <p className="admin-error mono">{error}</p>}
          </div>
        </main>
      </div>
    );
  }

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="site">
      <main className="admin">
        <div className="container">
          <div className="admin-header">
            <div>
              <h1 className="mono">Waitlist</h1>
              <p className="admin-sub mono">ScopeCI early access signups</p>
            </div>
            <button type="button" className="button button-quiet" onClick={handleExportCsv}>
              <Download size={14} aria-hidden="true" />
              Export CSV
            </button>
          </div>

          {stats && (
            <div className="admin-stats">
              <div className="admin-stat">
                <span className="admin-stat-value mono">{stats.total}</span>
                <span className="admin-stat-label mono">Total signups</span>
              </div>
              <div className="admin-stat">
                <span className="admin-stat-value mono">{stats.qualified}</span>
                <span className="admin-stat-label mono">Qualified agencies</span>
              </div>
              <div className="admin-stat">
                <span className="admin-stat-value mono">{stats.recent}</span>
                <span className="admin-stat-label mono">Recent (7d)</span>
              </div>
            </div>
          )}

          {signups.length === 0 ? (
            <p className="admin-empty mono">No signups yet.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table mono">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Agency</th>
                    <th>Date</th>
                    <th>Source</th>
                    <th>Campaign</th>
                    <th>Referrer</th>
                  </tr>
                </thead>
                <tbody>
                  {signups.map((s) => (
                    <tr key={s.id}>
                      <td>{s.email}</td>
                      <td>{s.agency || '—'}</td>
                      <td className="admin-nowrap">{fmtDate(s.createdAt)}</td>
                      <td>{s.utmSource || '—'}</td>
                      <td>{s.utmCampaign || '—'}</td>
                      <td className="admin-ref">{s.referrer || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/admin/waitlist" component={AdminWaitlist} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
