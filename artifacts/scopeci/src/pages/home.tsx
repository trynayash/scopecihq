import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRightIcon, CrossIcon, Icon, PlusIcon, TickIcon } from '../icons';
import { useCreateWaitlistSignup } from '@workspace/api-client-react';
import {
  CONTACT_PATH,
  Footer,
  ICON_MARK,
  Navbar,
  PRICING_PATH,
  PRIVACY_PATH,
  TRY_PATH,
  VendorMark,
  anchor,
  attribution,
  track,
  usePageMeta,
} from '../site';
import { useReveal } from '../motion';
import { AGENCY, dollars, PILOT_MONTHS_FREE, STUDIO } from '../pricing';
import { HeroStage } from '../landing/hero-stage';
import { CreepChart } from '../landing/creep-chart';
import { PolicyDemo } from '../landing/policy-demo';
import { ProductTour } from '../landing/product-tour';

const PAGE_TITLE = 'ScopeCI — Catch scope creep in pull requests';
const PAGE_DESCRIPTION =
  'ScopeCI checks each pull request against the statement of work your client signed, names the clause when work falls outside it, and drafts the change order. Early access for agencies on GitHub.';

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

/** Names the sections the header links to, so a reader who jumps in knows where they landed. */
function Kicker({ children }: { children: string }) {
  return (
    <p className="kicker">
      <span className="kicker-rule" aria-hidden="true" />
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

function Hero() {
  return (
    <section className="hero" id="top" aria-labelledby="hero-title">
      <div className="hero-guides" aria-hidden="true" />
      <div className="container hero-inner">
        <div className="hero-copy">
          <p className="hero-kicker">
            Early access for agencies on
            <span className="hero-kicker-marks">
              <VendorMark name="github" size={14} /> GitHub
            </span>
          </p>

          <h1 className="hero-title display" id="hero-title">
            Catch scope creep in the pull request, not on the invoice.
          </h1>

          <p className="hero-lede">
            ScopeCI reads the statement of work your client signed and checks every pull request against it. When a
            branch builds something the contract leaves out, the check names the clause and drafts the change order,
            before the work ships for free.
          </p>

          <div className="hero-actions">
            <a
              className="button button-primary button-lg"
              href={TRY_PATH}
              data-testid="button-try-hero"
              onClick={() => track('hero_cta_click')}
            >
              Try it on your SOW
              <Icon icon={ArrowRightIcon} size={16} />
            </a>
            <a className="button button-secondary button-lg" href={anchor('how-it-works')} data-testid="button-how-hero">
              See how it works
            </a>
          </div>
          <p className="hero-fine">
            Two minutes, no account. Nothing you paste is stored.
          </p>
        </div>

        <div className="hero-visual" data-reveal>
          <HeroStage />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Product                                                             */
/* ------------------------------------------------------------------ */

function Product() {
  return (
    <section className="section section-product" id="product" aria-labelledby="product-title">
      <div className="container">
        <div className="section-head">
          <Kicker>Product</Kicker>
          <h2 className="section-title display" id="product-title">
            What your team actually opens.
          </h2>
          <p className="section-lede">
            Real screens from the app, shown with a sample workspace: the pull requests ScopeCI checked, the scope
            they were checked against, and the change orders waiting on clients.
          </p>
        </div>
        <div data-reveal data-reveal-delay="80">
          <ProductTour />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* The problem                                                         */
/* ------------------------------------------------------------------ */

function Problem() {
  return (
    <section className="section section-problem" id="why" aria-labelledby="why-title">
      <div className="container problem-grid">
        <div className="section-head">
          <h2 className="section-title display" id="why-title">
            Scope creep doesn’t arrive as one big request.
          </h2>
          <p className="section-lede">
            It arrives as a dozen reasonable pull requests, each small enough to wave through. By the time anyone holds
            them up against the contract, the work is merged and the margin is gone.
          </p>
          <p className="section-lede problem-turn">
            ScopeCI moves that comparison to the cheapest moment there is: the pull request, while the work is still a
            question you can ask the client.
          </p>
        </div>
        <div className="problem-visual">
          <CreepChart />
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
        <div className="section-head">
          <Kicker>How it works</Kicker>
          <h2 className="section-title display" id="how-title">
            Three inputs you already have. One answer where your team already looks.
          </h2>
        </div>

        <ol className="steps">
          <li className="step">
            <div className="step-top">
              <span className="step-num mono">1</span>
              <span className="step-line" aria-hidden="true" />
            </div>
            <h3>Add the statement of work</h3>
            <p>
              Paste it as Markdown or text from a PDF. ScopeCI lists what each section includes and excludes, and you
              confirm the list before anything is checked against it.
            </p>
            <div className="artifact artifact-paper" aria-label="Excerpt from a statement of work">
              <p className="artifact-doc-title">4.2&ensp;User authentication</p>
              <p>Email and password sign-in, sessions, password reset.</p>
              <p className="artifact-doc-label">Explicit exclusions</p>
              <ul>
                <li><Icon icon={CrossIcon} size={13} /> Organization roles</li>
                <li><Icon icon={CrossIcon} size={13} /> Team invitations</li>
              </ul>
            </div>
          </li>

          <li className="step">
            <div className="step-top">
              <span className="step-num mono">2</span>
              <span className="step-line" aria-hidden="true" />
            </div>
            <h3>Open pull requests as usual</h3>
            <p>
              On every push it reads the title, branch, description and the names of the changed files. It never
              checks out, builds or runs your code.
            </p>
            <div className="artifact mono" aria-label="Files changed in the pull request">
              <p className="artifact-head">
                <VendorMark name="github" size={11} />
                #1842 · feature/org-permissions
              </p>
              <ul className="artifact-files">
                <li><span className="is-added">A</span><span>src/auth/roles.ts</span><span className="pos">+124</span></li>
                <li><span className="is-added">A</span><span>src/middleware/rbac.ts</span><span className="pos">+88</span></li>
                <li><span className="is-added">A</span><span>src/routes/invitations.ts</span><span className="pos">+117</span></li>
              </ul>
              <p className="artifact-foot">and 11 more files</p>
            </div>
          </li>

          <li className="step">
            <div className="step-top">
              <span className="step-num mono">3</span>
            </div>
            <h3>Read the answer on the pull request</h3>
            <p>
              One check and one comment, updated on every push: in scope, needs a decision, or change order needed,
              with the clause that decided it.
            </p>
            <div className="artifact" aria-label="The ScopeCI check on the pull request">
              <p className="artifact-check mono">
                <span className="artifact-check-icon"><Icon icon={CrossIcon} size={14} strokeWidth={2.2} /></span>
                scopeci / commercial
              </p>
              <span className="chip is-alert">Change order needed</span>
              <p className="artifact-reason">§4.2 excludes organization roles and team invitations.</p>
            </div>
          </li>
        </ol>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Policy                                                              */
/* ------------------------------------------------------------------ */

function Policy() {
  return (
    <section className="section section-policy" id="policy" aria-labelledby="policy-title">
      <div className="container policy-grid">
        <div className="section-head">
          <Kicker>Policies</Kicker>
          <h2 className="section-title display" id="policy-title">
            Quiet until you want it strict.
          </h2>
          <p className="section-lede">
            Each project chooses what the check does to a merge. Start by watching what it flags; turn it up once the
            team trusts it. Choose one to see the pull request change.
          </p>
        </div>
        <div>
          <PolicyDemo />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

function Evidence() {
  return (
    <section className="section section-evidence" id="evidence" aria-labelledby="evidence-title">
      <div className="container">
        <div className="section-head">
          <h2 className="section-title display" id="evidence-title">
            Every answer shows its working.
          </h2>
          <p className="section-lede">
            The contract on one side, the work on the other, and the clause that joins them. A project manager can
            check it in a minute, and so can your client.
          </p>
        </div>

        <div className="ledger" data-testid="evidence-panel">
          <div className="ledger-grid">
            <div className="ledger-pane">
              <p className="pane-label">Statement of work</p>
              <p className="pane-subject">§4.2 User authentication</p>
              <p className="pane-group">Included</p>
              <ul className="pane-items">
                <li className="is-in"><Icon icon={TickIcon} size={14} /> Email and password sign-in</li>
                <li className="is-in"><Icon icon={TickIcon} size={14} /> Sessions and sign-out</li>
                <li className="is-in"><Icon icon={TickIcon} size={14} /> Password reset</li>
              </ul>
              <p className="pane-group">Excluded</p>
              <ul className="pane-items">
                <li className="is-out"><Icon icon={CrossIcon} size={14} /> Organization roles</li>
                <li className="is-out"><Icon icon={CrossIcon} size={14} /> Team invitations</li>
              </ul>
            </div>

            {/* The seam carries the finding that connects the two sides. */}
            <div className="ledger-seam" aria-hidden="true">
              <span className="seam-line" />
              <span className="seam-label">Excluded work</span>
              <span className="seam-line" />
            </div>

            <div className="ledger-pane">
              <p className="pane-label">Pull request</p>
              <p className="pane-subject">
                <VendorMark name="github" size={14} />
                #1842 Add organization-level permissions
              </p>
              <dl className="pane-facts">
                <div>
                  <dt>Branch</dt>
                  <dd className="mono">feature/org-permissions</dd>
                </div>
                <div>
                  <dt>Changed files</dt>
                  <dd className="mono num">14</dd>
                </div>
                <div>
                  <dt>Matches</dt>
                  <dd>Organization roles, team invitations</dd>
                </div>
              </dl>
              <p className="pane-flag" data-testid="status-scope-expansion">
                Both match an exclusion in §4.2.
              </p>
            </div>
          </div>

          <div className="ledger-trace">
            <span className="trace-label">Trace</span>
            <ol className="trace mono" aria-label="Trace from contract clause to pull request">
              <li>SOW §4.2</li>
              <li>PR #1842</li>
              <li>2 matches</li>
              <li className="is-end">CO drafted</li>
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Change order                                                        */
/* ------------------------------------------------------------------ */

const LIFECYCLE = [
  { state: 'Drafted', text: 'Written from the flagged items. Add hours and your rate to price it.' },
  { state: 'Sent', text: 'Edit it, send it to the client, mark it sent. ScopeCI keeps the wait visible.' },
  { state: 'Approved', text: 'The work is covered on this pull request and every later one.' },
] as const;

function ChangeOrder() {
  return (
    <section className="section section-co" id="change-orders" aria-labelledby="co-title">
      <div className="container co-grid">
        <div className="section-head">
          <h2 className="section-title display" id="co-title">
            The flag comes with the paperwork.
          </h2>
          <p className="section-lede">
            When work is out of scope, ScopeCI drafts the message to your client, quoting the clause, so a PM can send
            it the same day instead of finding it at the end of the month.
          </p>
          <ol className="lifecycle">
            {LIFECYCLE.map((item, index) => (
              <li key={item.state}>
                <span className={`lifecycle-num mono ${index === LIFECYCLE.length - 1 ? 'is-end' : ''}`} aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div>
                  <strong>{item.state}</strong>
                  <p>{item.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="co-visual">
          <div className="co-stack" aria-hidden="true">
            <span className="co-sheet co-sheet-3" />
            <span className="co-sheet co-sheet-2" />
          </div>
          <article className="co-letter" aria-label="Example change order drafted by ScopeCI">
            <header className="co-letter-head mono">
              <span>Change order draft</span>
              <span className="chip is-ok">Ready to send</span>
            </header>
            <p className="co-subject">
              <span className="mono">Subject</span>
              Change request: organization roles, team invitations (Patient portal)
            </p>
            <div className="co-body">
              <p>Hi Jordan,</p>
              <p>
                While working on “Add organization-level permissions”, we found work that our statement of work lists
                as out of scope:
              </p>
              <ul>
                <li>Organization roles <span>(excluded in §4.2 User authentication)</span></li>
                <li>Team invitations <span>(excluded in §4.2 User authentication)</span></li>
              </ul>
              <p>
                We estimate <strong>14 hours</strong> for this, which is <strong>$2,100</strong> at our rate of $150 an
                hour.
              </p>
              <p>How would you like to go ahead?</p>
              <ol>
                <li>Approve it as a change order, and we’ll include it in this release.</li>
                <li>Leave it out for now, and we’ll take it out of this change.</li>
              </ol>
              <p className="co-sign">Thanks,<br />Lantern Studio</p>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Principles                                                          */
/* ------------------------------------------------------------------ */

const PRINCIPLES: ReadonlyArray<{ term: string; detail: string }> = [
  {
    term: 'What it reads',
    detail: 'The pull request’s title, branch and description, and the names of the files it changes.',
  },
  {
    term: 'What it never does',
    detail: 'Check out, build or run your code. Send your contract or your code to a language model.',
  },
  {
    term: 'How it decides',
    detail: 'Plain rules over the scope you confirmed: what each clause includes and excludes. Every answer cites its clause.',
  },
  {
    term: 'Where it starts',
    detail: 'Report only. The check stays neutral and never touches a merge until you change the project’s policy.',
  },
  {
    term: 'GitHub permissions',
    detail: 'Pull requests and checks: read and write. Contents and metadata: read. No admin, secrets or workflow access.',
  },
  {
    term: 'What it keeps',
    detail: 'Your confirmed scope, versioned, and each result with the version it was checked against.',
  },
];

function Principles() {
  return (
    <section className="section section-principles" id="principles" aria-labelledby="principles-title">
      <div className="container principles-grid">
        <div className="section-head">
          <h2 className="section-title display" id="principles-title">
            Built to be trusted with contracts.
          </h2>
          <p className="section-lede">
            A tool that reads your client agreements should be boring in the right places. Here is everything it
            touches.
          </p>
        </div>
        <dl className="spec">
          {PRINCIPLES.map((row) => (
            <div key={row.term} className="spec-row">
              <dt>{row.term}</dt>
              <dd>{row.detail}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Questions                                                           */
/* ------------------------------------------------------------------ */

const QUESTIONS: ReadonlyArray<{ q: string; a: ReactNode }> = [
  {
    q: 'Does an AI model read our contracts?',
    a: 'No. The check is plain rules that compare clause text with the pull request’s title, branch, description and changed files, so no language model sees your contract or your code. The trade-off is that it can only be as precise as the SOW, and you confirm what it read before anything is checked.',
  },
  {
    q: 'Will it block my team’s merges?',
    a: 'Only if you ask it to. Every project starts in report-only mode, where the check never changes merge status. Ask for a decision marks flagged pull requests as needing action. Fail the check fails it, so branch protection can hold the merge until a change order is approved.',
  },
  {
    q: 'What access does it need?',
    a: 'A GitHub App that reads pull requests and repository contents and writes checks and pull request comments. It asks for no admin, secrets or workflow permissions.',
  },
  {
    q: 'Where do the hours and prices come from?',
    a: 'From you. Add the hours to a change order and ScopeCI prices them at the project’s hourly rate. It never invents an estimate.',
  },
  {
    q: 'We use Jira, GitLab or Bitbucket.',
    a: 'Then it won’t work for you yet. GitHub is the only integration today.',
  },
  {
    q: 'What does it cost?',
    a: (
      <>
        Nothing during the pilot. After it, one price per agency with everyone on the team included: Studio is{' '}
        {dollars(STUDIO.monthly)} a month for up to {STUDIO.projects} active projects, and Agency is{' '}
        {dollars(AGENCY.monthly)} for up to {AGENCY.projects}. Pilot agencies get their first {PILOT_MONTHS_FREE} months
        free.{' '}
        <a className="text-link" href={PRICING_PATH}>
          See pricing
        </a>
      </>
    ),
  },
  {
    q: 'When can we use it?',
    a: 'You can try the check on your own SOW today, on this site, without an account. Running it on your own repositories is open to a small group of pilot agencies; join the waitlist and we’ll be in touch.',
  },
];

function Questions() {
  return (
    <section className="section section-faq" id="questions" aria-labelledby="questions-title">
      <div className="container faq-grid">
        <div className="section-head faq-head">
          <Kicker>Questions</Kicker>
          <h2 className="section-title display" id="questions-title">
            Worth knowing first.
          </h2>
          <p className="section-lede">
            Anything else,{' '}
            <a className="text-link" href={CONTACT_PATH}>
              write to us
            </a>
            . A person answers.
          </p>
        </div>

        <div className="faq">
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
                <span className="faq-icon">
                  <Icon icon={PlusIcon} size={18} />
                </span>
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

const PILOT_TERMS = [
  `Free during the pilot, then your first ${PILOT_MONTHS_FREE} months free`,
  'Set up with you on one live project',
  'Report only to start: nothing blocks a merge',
] as const;

function Waitlist() {
  const [email, setEmail] = useState('');
  const [agency, setAgency] = useState('');
  // Hidden from people (see .hp-field); a value means a bot filled every input.
  const [trap, setTrap] = useState('');
  const [state, setState] = useState<WaitlistState>('idle');
  const [emailError, setEmailError] = useState('');
  // Counts rejected submits, so the same message twice is still announced.
  const [emailErrorAttempt, setEmailErrorAttempt] = useState(0);
  const [formError, setFormError] = useState('');
  const [savedEmail, setSavedEmail] = useState('');

  const createSignup = useCreateWaitlistSignup();
  const submitting = state === 'submitting';
  const hasStartedRef = useRef(false);
  const emailInputRef = useRef<HTMLInputElement>(null);

  const rejectEmail = useCallback((message: string) => {
    setEmailError(message);
    setEmailErrorAttempt((attempt) => attempt + 1);
  }, []);

  // Back to the field, so its label, invalid state and error are read out.
  // It runs after the re-render: while saving, the field is disabled and
  // can't take focus.
  useEffect(() => {
    if (emailError) emailInputRef.current?.focus();
  }, [emailError, emailErrorAttempt]);

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (submitting) return;

      const trimmedEmail = email.trim();
      const trimmedAgency = agency.trim();

      setFormError('');
      if (!trimmedEmail) {
        rejectEmail('Enter your work email.');
        return;
      }
      if (trimmedEmail.length > 320 || !EMAIL_PATTERN.test(trimmedEmail)) {
        rejectEmail("That doesn't look like an email address.");
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
              rejectEmail(error?.data?.error ?? "That doesn't look like an email address.");
              track('waitlist_error');
              return;
            }
            setFormError(signupErrorMessage(status));
            track('waitlist_error');
          },
        },
      );
    },
    [agency, createSignup, email, rejectEmail, submitting, trap],
  );

  const settled = state === 'success' || state === 'duplicate';

  return (
    <section className="section section-waitlist" id="waitlist" aria-labelledby="waitlist-title">
      <div className="container">
        <div className="cta-panel on-dark">
          <div className="cta-copy">
            <img className="cta-mark" src={ICON_MARK} alt="" width="288" height="270" loading="lazy" decoding="async" />
            <h2 className="section-title display" id="waitlist-title">
              Run it on your next fixed-price project.
            </h2>
            <p className="section-lede">
              For agencies doing fixed-price or milestone work on GitHub. Leave your email and we’ll set up the pilot
              with you.
            </p>
            <ul className="cta-terms">
              {PILOT_TERMS.map((term) => (
                <li key={term}>
                  <Icon icon={TickIcon} size={16} />
                  {term}
                </li>
              ))}
            </ul>
          </div>

          <div className="cta-form-wrap">
            {settled ? (
              <div className="settled" role="status" data-testid="waitlist-success">
                <span className="settled-mark">
                  <Icon icon={TickIcon} size={22} />
                </span>
                <h3>{state === 'duplicate' ? "You're already on the list." : "You're on the list."}</h3>
                <p>
                  We'll write to <strong>{savedEmail}</strong> about the pilot.
                </p>
              </div>
            ) : (
              <form className="waitlist-form" onSubmit={submit} noValidate>
                <div className="field">
                  <label htmlFor="work-email">Work email</label>
                  <input
                    id="work-email"
                    ref={emailInputRef}
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
                    // A fresh alert on every rejected submit, so it's announced each time.
                    <p className="field-error" id="work-email-error" role="alert" key={emailErrorAttempt}>
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
                  className="button button-primary button-lg waitlist-submit"
                  disabled={submitting}
                  data-testid="button-submit-waitlist"
                >
                  {submitting ? (
                    <>
                      <span className="spinner" aria-hidden="true" />
                      Saving
                    </>
                  ) : (
                    <>
                      Join the pilot
                      <Icon icon={ArrowRightIcon} size={16} />
                    </>
                  )}
                </button>

                <p className="form-note">
                  No spam, and we never share your address. <a className="text-link" href={PRIVACY_PATH}>Privacy policy</a>
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

export default function Home() {
  usePageMeta(PAGE_TITLE, PAGE_DESCRIPTION);
  useScrollDepth();
  const revealRef = useReveal<HTMLDivElement>();

  // Track the page view once.
  useEffect(() => {
    track('page_view');
  }, []);

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
    const frame = requestAnimationFrame(() => target?.scrollIntoView({ behavior: 'auto', block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="site js-reveal" ref={revealRef}>
      <a className="skip-link" href="#main">Skip to content</a>
      <Navbar />
      <main id="main">
        <Hero />
        <Product />
        <Problem />
        <HowItWorks />
        <Policy />
        <Evidence />
        <ChangeOrder />
        <Principles />
        <Questions />
        <Waitlist />
      </main>
      <Footer />
    </div>
  );
}
