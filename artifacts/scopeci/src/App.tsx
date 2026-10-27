import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowRight,
  Check,
  Download,
  FileSignature,
  GitBranch,
  GitPullRequest,
  Lock,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { useCreateWaitlistSignup } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import NotFound from '@/pages/not-found';
import TryPage from '@/pages/try';
import AppPage from '@/pages/app';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import {
  BASE,
  Footer,
  ICON_MARK,
  Navbar,
  PRIVACY_PATH,
  TRY_PATH,
  VendorMark,
  anchor,
  attribution,
  track,
  usePageMeta,
} from './site';

// By default React Query pauses a mutation while the browser reports being
// offline, which leaves the signup button spinning with no explanation. Let
// it fail instead, so the form can say the connection is the problem.
const queryClient = new QueryClient({
  defaultOptions: { mutations: { networkMode: 'always' } },
});


const PAGE_TITLE = 'ScopeCI — Catch scope creep in pull requests';
const PAGE_DESCRIPTION =
  'ScopeCI checks each pull request against the statement of work your client signed, so out-of-scope work is flagged before it merges. In development; join the waitlist.';

const PRIVACY_TITLE = 'Privacy Policy — ScopeCI';
const PRIVACY_DESCRIPTION =
  'What ScopeCI collects through its early-access waitlist, why, and how to have it removed.';

const ADMIN_API = `${BASE}/api/admin`;

/** One-shot scroll depth observers. */
function useScrollDepth() {
  useEffect(() => {
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

/* ------------------------------------------------------------------ */
/* Hero: the pull request, and what ScopeCI adds to it                 */
/* ------------------------------------------------------------------ */

/* queued -> checking -> sow -> linear -> files -> verdict.
   The whole sequence lands in about a second, then the surface stays still. */
const REVIEW_STEPS = [160, 420, 620, 820, 1040] as const;

const EVIDENCE_ROWS = [
  { source: 'SOW', value: '§4.2 User authentication', result: 'excludes this', tone: 'bad' },
  { source: 'Linear', value: 'ENG-184', result: 'linked', tone: 'ok' },
  { source: 'Files', value: 'roles.ts, rbac.ts, invitations.ts', result: 'matched', tone: 'bad' },
] as const;

/**
 * An illustration, not a screenshot: the states and wording match what the
 * evaluator returns for this scenario in review mode (see
 * lib/commercial-engine/fixtures/golden/scope-expansion).
 */
function PullRequestCheck() {
  const [ref, inView] = useInView<HTMLDivElement>('0px');
  const step = useTimeline(REVIEW_STEPS, inView);

  const checking = step >= 1 && step < 5;
  const resolved = step >= 5;

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
          <div className="window-main">
            <div className="pr-head">
              <span className="pr-state mono">
                <GitPullRequest size={12} aria-hidden="true" />
                Open
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

            <ul className="checks mono" aria-label="Checks on this pull request">
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
                  {resolved ? <X size={10} /> : <span className="check-pending">…</span>}
                </span>
                <span className="check-name">scopeci / commercial</span>
                <span className="check-result">
                  {resolved ? 'action required' : checking ? 'checking' : 'queued'}
                </span>
              </li>
            </ul>
          </div>

          <div className="review">
            <div className="review-head">
              <span className="review-brand mono">
                <img src={ICON_MARK} alt="" width="288" height="270" decoding="async" />
                ScopeCI
              </span>
              <span className="review-label mono">Scope check</span>
            </div>

            <p className={`verdict mono ${resolved ? 'is-blocked' : ''}`} data-testid="status-commercial-review">
              {resolved ? 'Change required' : 'Checking against the SOW'}
            </p>
            <p className="verdict-note">
              {resolved
                ? '§4.2 of the statement of work excludes organization roles and team invitations. This pull request adds both.'
                : 'Reading the statement of work, the linked issue and the changed files.'}
            </p>

            <ul className="evidence-rows mono" aria-label="What the result is based on">
              {EVIDENCE_ROWS.map((row, index) => (
                <li key={row.source} className={step >= index + 2 ? 'is-resolved' : ''}>
                  <span className="evidence-source">{row.source}</span>
                  <span className="evidence-value">{row.value}</span>
                  <span className={`evidence-result ${row.tone}`}>
                    {step >= index + 2 ? row.result : '…'}
                  </span>
                </li>
              ))}
            </ul>

            <div className="review-row mono">
              <span>Mode</span>
              <strong>Review · needs a decision before merge</strong>
            </div>
          </div>
        </div>
      </div>

      <figcaption className="sr-only">
        Example: pull request #1842, Add organization-level permissions. Build and
        unit tests pass. The ScopeCI check returns change required: section 4.2 of
        the statement of work excludes organization roles and team invitations, and
        the changed files add both. The pull request is linked to Linear issue
        ENG-184. In review mode, someone has to decide before it merges.
      </figcaption>
    </figure>
  );
}

function Hero() {
  return (
    <section className="hero" id="top" aria-labelledby="hero-title">
      <div className="container hero-inner">
        <div className="hero-lead">
          <p className="hero-status">
            <span className="stack-marks" aria-hidden="true">
              <VendorMark name="github" size={14} />
              <VendorMark name="linear" size={14} />
            </span>
            In development, for agencies on GitHub and Linear
          </p>

          <h1 className="hero-title" id="hero-title">
            Catch scope creep in the pull request, not on the invoice.
          </h1>

          <p className="hero-lede">
            ScopeCI checks each pull request against the statement of work your client
            signed. When a branch builds something the contract leaves out, the check
            names the clause, the issue and the files, while it's still a change order
            and not free work.
          </p>
          <p className="hero-note">
            It doesn't run on real repositories yet, but the check is real: try it on your own SOW.
          </p>

          <div className="hero-actions">
            <a
              className="button button-primary"
              href={TRY_PATH}
              data-testid="button-try-hero"
              onClick={() => track('hero_cta_click')}
            >
              Try it on your SOW
              <ArrowRight size={15} aria-hidden="true" />
            </a>
            <a className="button button-ghost" href={anchor('waitlist')} data-testid="button-join-waitlist-hero">
              Join the waitlist
              <ArrowDown size={15} aria-hidden="true" />
            </a>
          </div>
        </div>

        <div className="hero-stage">
          <PullRequestCheck />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* How it works                                                        */
/* ------------------------------------------------------------------ */

function HowItWorks() {
  return (
    <section className="section section-how" id="how-it-works" aria-labelledby="how-title">
      <div className="container">
        <h2 className="section-title" id="how-title">How it works</h2>
        <p className="section-lede">
          Three inputs you already have, one result where your team already looks.
        </p>

        <ol className="steps">
          <li className="step">
            <span className="step-num mono">1</span>
            <h3>Add the statement of work</h3>
            <p>
              ScopeCI splits it into clauses and records what each one includes and
              excludes. Markdown for now.
            </p>
            <div className="step-artifact mono" aria-label="Excerpt from a statement of work">
              <p className="md-heading">### §4.2 User authentication</p>
              <p>Email and password sign-in, sessions, password reset.</p>
              <p className="md-strong">**Explicit exclusions**</p>
              <p className="md-bullet">- Organization roles</p>
              <p className="md-bullet">- Team invitations</p>
            </div>
          </li>

          <li className="step">
            <span className="step-num mono">2</span>
            <h3>Open pull requests as usual</h3>
            <p>
              On every push it reads which files changed and the Linear issue linked to
              the branch. It never checks out or runs your code.
            </p>
            <div className="step-artifact mono" aria-label="Files changed in the pull request">
              <p className="artifact-head">
                <VendorMark name="linear" size={11} />
                ENG-184 · feature/org-permissions
              </p>
              <ul className="file-list">
                <li><span className="file-status is-added">A</span><span>src/auth/roles.ts</span><span className="pos">+24</span></li>
                <li><span className="file-status is-added">A</span><span>src/middleware/rbac.ts</span><span className="pos">+18</span></li>
                <li><span className="file-status">M</span><span>src/routes/invitations.ts</span><span className="pos">+61</span></li>
              </ul>
              <p className="artifact-foot">and 11 more files</p>
            </div>
          </li>

          <li className="step">
            <span className="step-num mono">3</span>
            <h3>Read the result on the PR</h3>
            <p>
              One check and one comment: in scope, change required or needs review,
              with the clause that decided it.
            </p>
            <div className="step-artifact mono" aria-label="The ScopeCI check on the pull request">
              <p className="artifact-check">
                <span className="check-icon is-alert" aria-hidden="true"><X size={10} /></span>
                <span>scopeci / commercial</span>
                <strong>Change required</strong>
              </p>
              <p>§4.2 excludes organization roles, team invitations.</p>
              <p className="artifact-foot">Next: send a change order, or approve it as in scope.</p>
            </div>
          </li>
        </ol>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* What the result is based on                                         */
/* ------------------------------------------------------------------ */

function Evidence() {
  return (
    <section className="section section-evidence" id="evidence" aria-labelledby="evidence-title">
      <div className="container">
        <div className="evidence-lede">
          <h2 className="section-title" id="evidence-title">What the result is based on</h2>
          <p className="section-lede">
            The contract on one side, the work on the other, and the clause that joins
            them. A project manager can check it in a minute, and so can your client.
          </p>
        </div>

        <div className="evidence-body">
          <div className="ledger" data-testid="evidence-panel">
            <div className="ledger-grid">
              <div className="ledger-pane">
                <p className="pane-label mono">Statement of work</p>
                <p className="pane-subject mono">
                  <FileSignature size={14} aria-hidden="true" />
                  §4.2 User authentication
                </p>

                <p className="pane-group mono">Included</p>
                <ul className="scope-items mono">
                  <li className="is-included"><Check size={12} aria-hidden="true" /> Email and password sign-in</li>
                  <li className="is-included"><Check size={12} aria-hidden="true" /> Sessions and sign-out</li>
                  <li className="is-included"><Check size={12} aria-hidden="true" /> Password reset</li>
                </ul>

                <p className="pane-group mono">Excluded</p>
                <ul className="scope-items mono">
                  <li className="is-excluded"><X size={12} aria-hidden="true" /> Organization roles</li>
                  <li className="is-excluded"><X size={12} aria-hidden="true" /> Team invitations</li>
                </ul>
              </div>

              {/* The seam carries the finding that connects the two sides. */}
              <div className="ledger-seam">
                <span className="seam-line" aria-hidden="true" />
                <span className="seam-label">Excluded work</span>
                <span className="seam-line" aria-hidden="true" />
              </div>

              <div className="ledger-pane">
                <p className="pane-label mono">Pull request</p>
                <p className="pane-subject mono">
                  <VendorMark name="github" size={14} />
                  #1842
                </p>
                <p className="pane-headline">Add organization-level permissions</p>

                <dl className="pane-facts mono">
                  <div>
                    <dt>Linked issue</dt>
                    <dd><VendorMark name="linear" size={12} />ENG-184</dd>
                  </div>
                  <div>
                    <dt>Changed files</dt>
                    <dd>14</dd>
                  </div>
                  <div>
                    <dt>Matches</dt>
                    <dd>Organization roles, team invitations</dd>
                  </div>
                </dl>

                <p className="pane-flag mono" data-testid="status-scope-expansion">
                  Both match an exclusion in §4.2.
                </p>
              </div>
            </div>

            <div className="ledger-trace">
              <span className="trace-label mono">Trace</span>
              <ol className="trace mono" aria-label="Trace from contract clause to pull request">
                <li>SOW §4.2</li>
                <li>ENG-184</li>
                <li>PR #1842</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Questions                                                           */
/* ------------------------------------------------------------------ */

const QUESTIONS: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: 'Does an AI model read our contracts?',
    a: "No. The check is plain rules that compare clause text with the changed files and the linked issue, so no language model sees your contract or your code. The trade-off is that it can only be as precise as the SOW, and the rules are still being taught to read SOWs beyond our test projects.",
  },
  {
    q: "Will it block my team's merges?",
    a: 'Only if you ask it to. Each repository starts in observe mode, where the check reports and never changes merge status. Review mode asks for a decision on flagged pull requests. Enforce mode fails the check, so branch protection can hold the merge until a change order is approved.',
  },
  {
    q: 'What access does it need?',
    a: 'A GitHub App that reads pull requests and repository contents and writes checks and pull request comments, plus a Linear connection to read the issue linked to each branch. It asks for no admin, secrets or workflow permissions.',
  },
  {
    q: 'We use Jira, GitLab or Bitbucket.',
    a: "Then it won't work for you yet. GitHub and Linear are the only integrations being built.",
  },
  {
    q: 'What will it cost?',
    a: "There's no price yet. We'd rather set one after a few agencies have used it on real client projects.",
  },
  {
    q: 'When can we use it?',
    a: "You can try the check on your own SOW today, on this site. Running it on your real repositories is next: we'll email the waitlist when the first pilot agencies can connect GitHub.",
  },
];

function Questions() {
  return (
    <section className="section section-faq" id="questions" aria-labelledby="questions-title">
      <div className="container split">
        <div className="split-lede">
          <h2 className="section-title" id="questions-title">Questions</h2>
          <p className="section-lede">
            The things worth knowing before you put your email down.
          </p>
        </div>

        <div className="split-body faq">
          {QUESTIONS.map((item) => (
            <details
              className="faq-item"
              key={item.q}
              onToggle={(event) => {
                if ((event.currentTarget as HTMLDetailsElement).open) track('faq_opened');
              }}
            >
              <summary>
                {item.q}
                <Plus size={16} aria-hidden="true" />
              </summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Waitlist                                                            */
/* ------------------------------------------------------------------ */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type WaitlistState = 'idle' | 'submitting' | 'success' | 'duplicate';

/** Turns a failed signup into one sentence the visitor can act on. */
function signupErrorMessage(status: number | undefined): string {
  if (status === 429) return 'Too many attempts from your network. Wait a minute, then try again.';
  if (status === undefined) return "We couldn't reach ScopeCI. Check your connection and try again.";
  return 'Something went wrong on our side. Try again in a minute.';
}

function Waitlist() {
  const [email, setEmail] = useState('');
  const [agency, setAgency] = useState('');
  // Hidden from people (see .hp-field); a value means a bot filled every input.
  const [trap, setTrap] = useState('');
  const [state, setState] = useState<WaitlistState>('idle');
  const [emailError, setEmailError] = useState('');
  const [formError, setFormError] = useState('');
  const [savedEmail, setSavedEmail] = useState('');

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
        setEmailError("That doesn't look like an email address.");
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
            website_url_hp: trap || null,
          },
        },
        {
          onSuccess: () => {
            setSavedEmail(trimmedEmail.toLowerCase());
            setState('success');
            track('waitlist_success');
          },
          onError: (error) => {
            setState('idle');
            const status = error?.status;
            if (status === 409) {
              setSavedEmail(trimmedEmail.toLowerCase());
              setState('duplicate');
              track('waitlist_duplicate');
              return;
            }
            if (status === 400) {
              setEmailError(
                error?.data?.error ?? "That doesn't look like an email address.",
              );
              track('waitlist_error');
              return;
            }
            setFormError(signupErrorMessage(status));
            track('waitlist_error');
          },
        },
      );
    },
    [agency, createSignup, email, submitting, trap],
  );

  const settled = state === 'success' || state === 'duplicate';

  return (
    <section className="waitlist" id="waitlist" aria-labelledby="waitlist-title">
      <div className="container split">
        <div className="split-lede">
          <h2 className="section-title" id="waitlist-title">Join the waitlist</h2>
          <p className="section-lede">
            For agencies doing fixed-price or milestone work on GitHub and Linear.
            We'll email you when you can try it, and occasionally with progress.
          </p>
        </div>

        <div className="split-body">
          <div className="waitlist-panel">
            {settled ? (
              <div className="settled" role="status" data-testid="waitlist-success">
                <span className="settled-mark" aria-hidden="true">
                  <Check size={18} />
                </span>
                <h3>
                  {state === 'duplicate' ? "You're already on the list." : "You're on the list."}
                </h3>
                <p>
                  We'll write to <strong>{savedEmail}</strong> when early access opens.
                </p>
              </div>
            ) : (
              <form className="waitlist-form" onSubmit={submit} noValidate>
                <div className="field">
                  <label htmlFor="work-email">Work email</label>
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
                    <p className="field-error" id="work-email-error">
                      {emailError}
                    </p>
                  )}
                </div>

                <div className="field">
                  <label htmlFor="agency-name">
                    Agency <span className="field-optional">optional</span>
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

                <div className="hp-field" aria-hidden="true">
                  <label htmlFor="website">Website</label>
                  <input
                    id="website"
                    name="website"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={trap}
                    onChange={(event) => setTrap(event.target.value)}
                  />
                </div>

                <p aria-live="polite" className="form-status">
                  {formError && (
                    <span className="form-error" data-testid="status-waitlist-error">
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
                      Saving
                    </>
                  ) : (
                    <>
                      Join the waitlist
                      <ArrowRight size={15} aria-hidden="true" />
                    </>
                  )}
                </button>

                <p className="form-note">
                  No spam, and we never share your address.{' '}
                  <a href={PRIVACY_PATH}>Privacy policy</a>
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
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

  // Arriving from another route (e.g. the footer's Waitlist link), the
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
        <HowItWorks />
        <Evidence />
        <Questions />
        <Waitlist />
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

type AdminView = 'checking' | 'signed-out' | 'ready';

/** Same-origin requests carry the httpOnly session cookie set at sign-in. */
async function adminFetch(path: string, init?: RequestInit) {
  return fetch(`${ADMIN_API}${path}`, { credentials: 'same-origin', ...init });
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  );
}

interface GitHubAppStatus {
  configured: boolean;
  source: 'environment' | 'admin' | null;
  slug: string | null;
  owner: string | null;
  settingsUrl: string | null;
  installUrl: string | null;
  signInReady: boolean;
  webhooksReady: boolean;
  encryptionReady: boolean;
  baseUrl: string;
}

const SETUP_RESULTS: Record<string, string> = {
  created: 'GitHub App created. Install it on a repository, then sign in at /app.',
  expired: 'That setup was already used or is over an hour old. Start again.',
  failed: "GitHub didn't hand over the App's keys. Start again; if it keeps failing, check the server log.",
};

/** Creates ScopeCI's GitHub App with GitHub's manifest flow, or shows the one in use. */
function GitHubAppPanel({ onSignedOut }: { onSignedOut: () => void }) {
  const [status, setStatus] = useState<GitHubAppStatus | null>(null);
  const [name, setName] = useState('ScopeCI');
  const [organization, setOrganization] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice] = useState(
    () => SETUP_RESULTS[new URLSearchParams(window.location.search).get('github') ?? ''] ?? '',
  );

  const load = useCallback(async () => {
    const res = await adminFetch('/github-app');
    if (res.status === 401) return onSignedOut();
    if (!res.ok) throw new Error('load failed');
    setStatus(await res.json());
  }, [onSignedOut]);

  useEffect(() => {
    // Don't show the result again on a refresh.
    if (window.location.search.includes('github=')) window.history.replaceState(null, '', window.location.pathname);
    load().catch(() => setError("Couldn't load the GitHub App's status."));
  }, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await adminFetch('/github-app/manifest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), organization: organization.trim() }),
      });
      if (res.status === 401) return onSignedOut();
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Couldn't start. Try again.");
        setBusy(false);
        return;
      }
      // GitHub takes the manifest as a form post, shows it for confirmation,
      // then sends the browser back to the API, which returns here.
      const form = document.createElement('form');
      form.method = 'post';
      form.action = body.action;
      const field = document.createElement('input');
      field.type = 'hidden';
      field.name = 'manifest';
      field.value = JSON.stringify(body.manifest);
      form.appendChild(field);
      document.body.appendChild(form);
      form.submit();
    } catch {
      setError("Couldn't reach the API.");
      setBusy(false);
    }
  };

  const forget = async () => {
    if (!window.confirm("Forget this GitHub App? Sign-in and pull request checks stop until you create one again. The App stays on GitHub until you delete it there.")) return;
    setError('');
    try {
      const res = await adminFetch('/github-app', { method: 'DELETE' });
      if (res.status === 401) return onSignedOut();
      await load();
    } catch {
      setError("Couldn't forget the App. Try again.");
    }
  };

  return (
    <section className="admin-panel" aria-labelledby="github-app-heading">
      <h2 id="github-app-heading" className="mono">GitHub App</h2>
      {notice && <p className="admin-notice mono" role="status">{notice}</p>}
      {!status ? (
        !error && <p className="admin-hint mono">Checking…</p>
      ) : status.configured ? (
        <>
          <p className="admin-sub mono">
            {status.slug ? `Connected as ${status.slug}` : 'Connected'}
            {status.owner ? `, owned by ${status.owner}` : ''}
            {status.source === 'environment' ? ', set in environment variables.' : '.'}
          </p>
          <ul className="admin-checks mono">
            <li data-ok={status.signInReady}>{status.signInReady ? 'Ready' : 'Not ready'}: Sign in with GitHub</li>
            <li data-ok={status.webhooksReady}>{status.webhooksReady ? 'Ready' : 'Not ready'}: pull request checks</li>
          </ul>
          <div className="admin-actions">
            {status.installUrl && (
              <a className="button button-primary" href={status.installUrl}>Install on a repository</a>
            )}
            {status.settingsUrl && (
              <a className="button button-quiet" href={status.settingsUrl}>App settings on GitHub</a>
            )}
            {status.source === 'admin' && (
              <button type="button" className="button button-quiet" onClick={forget}>Forget this App</button>
            )}
          </div>
        </>
      ) : (
        <form className="admin-setup" onSubmit={create}>
          <p className="admin-sub mono">
            ScopeCI needs one GitHub App for sign-in and pull request checks. GitHub shows you its settings to
            confirm, then sends you back here. Webhooks will go to {status.baseUrl}.
          </p>
          {!status.encryptionReady && (
            <p className="admin-error mono">Set GITHUB_TOKEN_ENCRYPTION_KEY on the server first. The App's keys are stored encrypted with it.</p>
          )}
          <label className="mono" htmlFor="app-name">App name, unique on GitHub</label>
          <input
            id="app-name"
            className="admin-key-input mono"
            value={name}
            maxLength={34}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <label className="mono" htmlFor="app-org">GitHub organization to own it (optional)</label>
          <input
            id="app-org"
            className="admin-key-input mono"
            value={organization}
            maxLength={39}
            placeholder="Leave empty to create it on your own account"
            onChange={(e) => setOrganization(e.target.value)}
          />
          <div className="admin-actions">
            <button type="submit" className="button button-primary" disabled={busy || !status.encryptionReady}>
              {busy ? 'Opening GitHub…' : 'Create GitHub App'}
            </button>
          </div>
        </form>
      )}
      {error && <p className="admin-error mono" role="alert">{error}</p>}
    </section>
  );
}

function AdminWaitlist() {
  usePageMeta('Admin', 'Internal admin page.');

  const [view, setView] = useState<AdminView>('checking');
  const [key, setKey] = useState('');
  const [signups, setSignups] = useState<AdminSignup[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /** Loads both lists; drops back to the sign-in form when the session is gone. */
  const load = useCallback(async () => {
    const [signupsRes, statsRes] = await Promise.all([
      adminFetch('/waitlist'),
      adminFetch('/waitlist/stats'),
    ]);
    if (signupsRes.status === 401 || statsRes.status === 401) {
      setView('signed-out');
      return;
    }
    if (!signupsRes.ok || !statsRes.ok) throw new Error('load failed');
    setSignups(await signupsRes.json());
    setStats(await statsRes.json());
    setView('ready');
  }, []);

  useEffect(() => {
    load().catch(() => {
      setView('signed-out');
      setError("Couldn't reach the API.");
    });
  }, [load]);

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    if (!key.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await adminFetch('/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key.trim() }),
      });
      if (res.status === 204) {
        setKey('');
        await load();
      } else if (res.status === 429) {
        setError('Too many attempts. Wait 15 minutes and try again.');
      } else if (res.status === 401) {
        setError('That key is not right.');
      } else {
        setError("Couldn't sign in. Try again.");
      }
    } catch {
      setError("Couldn't reach the API.");
    } finally {
      setBusy(false);
    }
  };

  const signedOut = useCallback(() => setView('signed-out'), []);

  const signOut = async () => {
    await adminFetch('/session', { method: 'DELETE' }).catch(() => {});
    setSignups([]);
    setStats(null);
    setView('signed-out');
  };

  const refresh = async () => {
    setBusy(true);
    setError('');
    try {
      await load();
    } catch {
      setError("Couldn't refresh. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (signup: AdminSignup) => {
    if (!window.confirm(`Remove ${signup.email} from the waitlist? This can't be undone.`)) return;
    setError('');
    try {
      const res = await adminFetch(`/waitlist/${signup.id}`, { method: 'DELETE' });
      if (res.status === 401) {
        setView('signed-out');
        return;
      }
      if (res.status !== 204 && res.status !== 404) throw new Error('delete failed');
      await load();
    } catch {
      setError(`Couldn't remove ${signup.email}. Try again.`);
    }
  };

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return signups;
    return signups.filter((s) =>
      [s.email, s.agency, s.utmSource, s.utmCampaign, s.referrer].some((value) =>
        value?.toLowerCase().includes(needle),
      ),
    );
  }, [query, signups]);

  if (view === 'checking') {
    return (
      <div className="site">
        <main className="admin">
          <p className="admin-empty mono container">Checking your session…</p>
        </main>
      </div>
    );
  }

  if (view === 'signed-out') {
    return (
      <div className="site">
        <main className="admin">
          <div className="container admin-gate">
            <Lock size={24} aria-hidden="true" />
            <h1 className="mono">Admin sign-in</h1>
            <form onSubmit={signIn}>
              <label className="sr-only" htmlFor="admin-key">Admin key</label>
              <input
                id="admin-key"
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Admin key"
                className="admin-key-input mono"
                autoComplete="current-password"
                autoFocus
              />
              <button type="submit" className="button button-primary" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
            {error && <p className="admin-error mono" role="alert">{error}</p>}
            <p className="admin-hint mono">Stays signed in for 12 hours on this browser.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="site">
      <main className="admin">
        <div className="container">
          <div className="admin-header">
            <div>
              <h1 className="mono">Admin</h1>
              <p className="admin-sub mono">The GitHub App, and early access signups</p>
            </div>
            <div className="admin-actions">
              <button type="button" className="button button-quiet" onClick={refresh} disabled={busy}>
                <RefreshCw size={14} aria-hidden="true" />
                Refresh
              </button>
              <a className="button button-quiet" href={`${ADMIN_API}/waitlist/csv`} download>
                <Download size={14} aria-hidden="true" />
                Export CSV
              </a>
              <button type="button" className="button button-quiet" onClick={signOut}>
                Sign out
              </button>
            </div>
          </div>

          <GitHubAppPanel onSignedOut={signedOut} />

          {stats && (
            <div className="admin-stats">
              <div className="admin-stat">
                <span className="admin-stat-value mono">{stats.total}</span>
                <span className="admin-stat-label mono">Total signups</span>
              </div>
              <div className="admin-stat">
                <span className="admin-stat-value mono">{stats.qualified}</span>
                <span className="admin-stat-label mono">Gave an agency name</span>
              </div>
              <div className="admin-stat">
                <span className="admin-stat-value mono">{stats.recent}</span>
                <span className="admin-stat-label mono">Last 7 days</span>
              </div>
            </div>
          )}

          {error && <p className="admin-error mono" role="alert">{error}</p>}

          {signups.length === 0 ? (
            <p className="admin-empty mono">No signups yet.</p>
          ) : (
            <>
              <div className="admin-toolbar">
                <label className="sr-only" htmlFor="admin-search">Filter signups</label>
                <input
                  id="admin-search"
                  type="search"
                  className="admin-key-input mono"
                  placeholder="Filter by email, agency, source or referrer"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <span className="admin-count mono">
                  {visible.length === signups.length
                    ? `${signups.length} signups`
                    : `${visible.length} of ${signups.length}`}
                </span>
              </div>
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
                      <th><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((s) => (
                      <tr key={s.id}>
                        <td>{s.email}</td>
                        <td>{s.agency || '—'}</td>
                        <td className="admin-nowrap">{formatDate(s.createdAt)}</td>
                        <td>{s.utmSource || '—'}</td>
                        <td>{s.utmCampaign || '—'}</td>
                        <td className="admin-ref" title={s.referrer ?? undefined}>{s.referrer || '—'}</td>
                        <td>
                          <button
                            type="button"
                            className="admin-delete"
                            onClick={() => remove(s)}
                            aria-label={`Remove ${s.email}`}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
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
        <Route path="/try" component={TryPage} />
        <Route path="/app" nest>
          <AppPage />
        </Route>
        <Route path="/admin" component={AdminWaitlist} />
        <Route path="/admin/waitlist" component={AdminWaitlist} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <Router />
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
