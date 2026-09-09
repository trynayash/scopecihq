import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  Check,
  CircleDot,
  GitBranch,
  Github,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();
const wordmark = '/assets/logo-wordmark.png';
const iconMark = '/assets/logo-icon.png';

function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          node.classList.add('is-visible');
          observer.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className={`reveal ${className}`}>{children}</div>;
}

function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 14);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <header className={`nav-wrap ${scrolled ? 'scrolled' : ''}`}>
      <nav className="nav container" aria-label="Primary navigation">
        <a className="nav-brand" href="#top" data-testid="link-brand">
          <picture className="nav-logo">
            <source media="(max-width: 640px)" srcSet={iconMark} />
            <img src={wordmark} alt="ScopeCI" width="143" height="34" />
          </picture>
          <span className="nav-descriptor">Commercial CI/CD</span>
        </a>
        <div className="nav-links">
          <a className="nav-link" href="#how-it-works" data-testid="link-how-it-works">How it works</a>
          <a className="nav-link" href="#waitlist" data-testid="link-waitlist-nav">Waitlist</a>
          <a className="nav-cta" href="#waitlist" data-testid="button-join-waitlist-nav">Join waitlist <ArrowRight size={14} aria-hidden="true" /></a>
        </div>
      </nav>
    </header>
  );
}

function HeroPRCard() {
  const [status, setStatus] = useState<'checking' | 'resolved'>('checking');
  const [approvalRequested, setApprovalRequested] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setStatus('resolved'), 1900);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="product-frame" aria-label="ScopeCI commercial review product preview" data-testid="product-preview">
      <div className="product-window">
        <div className="window-bar">
          <div className="window-dots" aria-hidden="true"><span className="window-dot" /><span className="window-dot" /><span className="window-dot" /></div>
          <span className="window-title">github.com / northstar / api</span>
          <span className="window-title">PR VIEW</span>
        </div>
        <div className="pr-body">
          <div className="pr-main">
            <p className="pr-label">Pull request #1842</p>
            <h2 className="pr-title">Add organization-level permissions</h2>
            <div className="pr-meta">
              <span className="pr-pill"><Github size={12} aria-hidden="true" /> northstar/api</span>
              <span className="pr-pill"><GitBranch size={12} aria-hidden="true" /> feature/permissions</span>
            </div>
            <div className="pr-divider" />
            <div className="diff-line"><span className="diff-sign">−</span><span>account.settings = member</span></div>
            <div className="diff-line added"><span className="diff-sign">+</span><span>organization.roles = enabled</span></div>
            <div className="diff-line added"><span className="diff-sign">+</span><span>inviteMembers(account)</span></div>
            {status === 'checking' && <div className="checking-line" data-testid="status-checking"><span /> Checking commercial scope...</div>}
          </div>
          <div className="pr-side">
            <div className="scope-check">
              <div className="scope-top">
                <span className="scope-mark"><img src={iconMark} alt="" width="14" height="14" /> ScopeCI</span>
                <span className="pr-label">Commercial review</span>
              </div>
              <div className="scope-status" data-testid="status-commercial-review"><span className="status-dot" /> {status === 'checking' ? 'CHECKING' : 'NOT AUTHORIZED'}</div>
              <p className="scope-statement">{status === 'checking' ? 'Comparing this work with the approved project scope.' : 'This work extends beyond the approved project scope.'}</p>
              <div className="scope-row"><span>SOW</span><strong>§4.2 Authentication</strong></div>
              <div className="scope-row"><span>LINEAR</span><strong>ENG-184</strong></div>
              <div className="scope-row"><span>Estimated impact</span><strong>{status === 'checking' ? 'Resolving...' : '18–24 hrs · $2,700–$3,600'}</strong></div>
              <div className="scope-row"><span>Change order</span><strong>{status === 'checking' ? 'Checking...' : 'Not approved'}</strong></div>
              <button className="scope-request" type="button" disabled={status === 'checking' || approvalRequested} onClick={() => setApprovalRequested(true)} data-testid="button-request-approval">
                {status === 'checking' ? 'Reviewing evidence' : approvalRequested ? 'Approval requested' : 'Request approval'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="hero" id="top" aria-labelledby="hero-title">
      <div className="container">
        <Reveal className="hero-content">
          <p className="eyebrow">Commercial CI/CD for software agencies</p>
          <h1 className="hero-title" id="hero-title">Ship only work your client approved.</h1>
          <p className="hero-copy">ScopeCI connects your contract, project tracker, and GitHub workflow so unapproved client work gets caught before it reaches production.</p>
          <div className="hero-actions">
            <a className="primary-button" href="#waitlist" data-testid="button-join-waitlist-hero">Join the waitlist <ArrowRight size={15} aria-hidden="true" /></a>
            <a className="text-button" href="#how-it-works" data-testid="link-see-how-it-works">See how it works <ArrowDown size={15} aria-hidden="true" /></a>
          </div>
          <p className="hero-note">Built for software agencies using GitHub + Linear/Jira.</p>
        </Reveal>
        <Reveal className="hero-product">
          <HeroPRCard />
        </Reveal>
        <Reveal className="hero-statement">
          <div className="sequence" aria-label="Contract leads to project, which leads to code">
            <span>CONTRACT</span><span className="arrow">↓</span><span>PROJECT</span><span className="arrow">↓</span><span>CODE</span>
          </div>
          <p>One commercial layer between what was sold and what ships.</p>
        </Reveal>
      </div>
    </section>
  );
}

function ScopeGap() {
  const flow = [
    ['Signed SOW', 'approved scope'],
    ['Client request', 'new work enters'],
    ['Linear / Jira', 'project work'],
    ['GitHub', 'code changes'],
    ['ScopeCI', 'commercial authorization'],
    ['Production', 'approved work ships'],
  ];
  return (
    <section className="section gap-section" id="the-gap" aria-labelledby="gap-title">
      <div className="container gap-layout">
        <Reveal>
          <p className="eyebrow">The gap</p>
          <h2 className="section-heading" id="gap-title">The contract knows what was sold. GitHub knows what was built.</h2>
          <p className="section-copy">The problem lives between them.</p>
        </Reveal>
        <Reveal className="architecture-flow" aria-label="ScopeCI authorization flow">
          {flow.map(([name, detail], index) => (
            <div className={`flow-row ${name === 'ScopeCI' ? 'scopeci' : ''} ${name === 'Production' ? 'production' : ''}`} key={name}>
              <div className="flow-rail"><span className="flow-node" /></div>
              <div className="flow-copy"><strong>{name}</strong><span>{detail}</span></div>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

function HowScopeCIWorks() {
  const items = [
    ['01', 'Understand the contract', 'Turn signed SOWs and project agreements into a structured scope baseline.', 'Deliverables, exclusions, assumptions, limits and milestones.'],
    ['02', 'Trace the work', 'Connect contractual scope to actual project work.', 'Follow a request from the backlog all the way to the pull request.'],
    ['03', 'Control the merge', 'Require commercial approval before unauthorized work ships.', "Warn, review or enforce based on the agency's policy."],
  ];
  return (
    <section className="section works-section" id="how-it-works" aria-labelledby="works-title">
      <div className="container works-layout">
        <Reveal className="works-heading">
          <p className="eyebrow">What ScopeCI does</p>
          <h2 className="section-heading" id="works-title">A commercial control layer for engineering.</h2>
        </Reveal>
        <div className="works-list">
          {items.map(([num, title, description, small]) => (
            <Reveal key={num}>
              <article className="work-item" data-testid={`article-work-${num}`}>
                <span className="work-num">{num}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                  <span className="work-underline" />
                  <p className="mono" style={{ fontSize: 11, color: 'var(--forest-2)', marginTop: 17 }}>{small}</p>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function ContractCodeGraph() {
  const nodes = ['SIGNED SOW', 'SCOPE GRAPH', 'LINEAR / JIRA', 'GITHUB PR', 'COMMERCIAL CHECK'];
  return (
    <section className="section graph-section" aria-labelledby="graph-title">
      <div className="container graph-layout">
        <Reveal>
          <p className="eyebrow">Contract → code</p>
          <h2 className="section-heading" id="graph-title">The commercial state follows the work.</h2>
          <p className="section-copy">A clear path from agreement to issue to pull request, with authorization at the merge boundary.</p>
        </Reveal>
        <Reveal className="graph" aria-label="Contract to code system graph">
          {nodes.map((node, index) => (
            <div key={node} style={{ width: '100%', display: 'contents' }}>
              <div className={`graph-node ${node === 'COMMERCIAL CHECK' ? 'active' : ''}`} data-testid={`node-${index + 1}`}>{node}</div>
              {index < nodes.length - 1 && <div className="graph-arrow">↓</div>}
            </div>
          ))}
          <div className="graph-outcome"><span>Approve</span><span>Block</span><span>Ship</span></div>
        </Reveal>
      </div>
    </section>
  );
}

function EvidencePanel() {
  return (
    <section className="section evidence-section" aria-labelledby="evidence-title">
      <div className="container evidence-layout">
        <Reveal>
          <p className="eyebrow">Evidence</p>
          <h2 className="section-heading" id="evidence-title">Evidence, not guesses.</h2>
          <p className="section-copy">Every decision connects back to the contract and the work being built.</p>
          <div className="evidence-trace" aria-label="Evidence chain">
            <span className="trace-node">SOW §4.2</span><span className="trace-line" /><span className="trace-node">ENG-184</span><span className="trace-line" /><span className="trace-node">PR #1842</span>
          </div>
        </Reveal>
        <Reveal>
          <div className="evidence-interface" data-testid="evidence-panel">
            <div className="evidence-pane">
              <p className="pane-title">Project scope</p>
              <p className="pane-project">Northstar / API</p>
              <ul className="scope-list">
                <li className="included"><Check size={13} aria-hidden="true" /> User authentication</li>
                <li className="included"><Check size={13} aria-hidden="true" /> Profile management</li>
                <li className="included"><Check size={13} aria-hidden="true" /> Account settings</li>
                <li className="excluded"><span>×</span> Organization roles</li>
                <li className="excluded"><span>×</span> Team invitations</li>
              </ul>
            </div>
            <div className="evidence-pane">
              <p className="pane-title">ENG-184</p>
              <p className="pane-project">Add organization-level permissions</p>
              <div className="pane-data"><p>Changed files</p><strong>14</strong></div>
              <div className="pane-data"><p>Estimated effort</p><strong>18–24 hrs</strong></div>
            </div>
            <div className="scope-expansion" data-testid="status-scope-expansion"><AlertTriangle size={12} aria-hidden="true" /> Scope expansion</div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function CommercialCheck() {
  const [requested, setRequested] = useState(false);
  return (
    <section className="section check-section" aria-labelledby="check-title">
      <div className="container check-layout">
        <Reveal>
          <p className="eyebrow">Commercial check</p>
          <h2 className="section-heading" id="check-title">A merge should know what the contract says.</h2>
          <p className="check-copy">This work cannot be treated as approved engineering work until the commercial state is resolved.</p>
        </Reveal>
        <Reveal>
          <div className="check-window" data-testid="commercial-check-panel">
            <div className="check-header">
              <span className="check-brand"><img src={iconMark} alt="" width="17" height="17" /> ScopeCI Commercial Check</span>
              <CircleDot size={14} color="#7f9a8c" aria-hidden="true" />
            </div>
            <div className="check-pr">
              <span className="check-pr-number">PR #1842</span>
              <h3>Add organization-level permissions</h3>
              <div className="check-table">
                <div className="check-table-row"><span>SOW match</span><strong className="bad">× Not found</strong></div>
                <div className="check-table-row"><span>Commercial status</span><strong className="bad">Not authorized</strong></div>
                <div className="check-table-row"><span>Change order</span><strong>Not approved</strong></div>
              </div>
              <div className="check-impact">
                <p>Estimated impact<strong>18–24 engineer hours</strong></p>
                <span className="amount">$2.7k–$3.6k</span>
              </div>
              <button type="button" className="approval-button" onClick={() => setRequested(true)} data-testid="button-request-commercial-approval">{requested ? 'Approval requested' : 'Request approval'}</button>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Waitlist() {
  const [email, setEmail] = useState('');
  const [agency, setAgency] = useState('');
  const [state, setState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [emailError, setEmailError] = useState('');
  const [serverError, setServerError] = useState('');

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEmailError('');
    setServerError('');
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError('Enter a valid work email.');
      return;
    }
    setState('submitting');
    window.setTimeout(() => {
      if (email.toLowerCase().includes('error')) {
        setState('error');
        setServerError('Something went wrong. Please try again.');
      } else {
        setState('success');
      }
    }, 900);
  };

  return (
    <section className="waitlist-section" id="waitlist" aria-labelledby="waitlist-title">
      <div className="container waitlist-layout">
        <Reveal className="waitlist-heading">
          <p className="eyebrow">Early access</p>
          <h2 className="section-heading" id="waitlist-title">Put a commercial check in front of your next merge.</h2>
          <p className="waitlist-copy">ScopeCI is being built for software development agencies working on fixed-price and milestone-based client projects.</p>
        </Reveal>
        <Reveal>
          <div className="waitlist-form-wrap">
            {state === 'success' ? (
              <div className="success-state" role="status" data-testid="waitlist-success">
                <span className="success-check"><Check size={20} aria-hidden="true" /></span>
                <h3>You're on the list.</h3>
                <p>We'll reach out when early access opens.</p>
                <span className="mono">ScopeCI</span>
              </div>
            ) : (
              <form className="waitlist-form" onSubmit={submit} noValidate>
                <div className="field">
                  <label htmlFor="work-email">Work email</label>
                  <input id="work-email" name="email" type="email" autoComplete="email" placeholder="you@agency.com" value={email} onChange={(event) => { setEmail(event.target.value); setEmailError(''); }} className={emailError ? 'invalid' : ''} aria-invalid={Boolean(emailError)} aria-describedby={emailError ? 'email-error' : undefined} data-testid="input-work-email" />
                  {emailError && <span className="field-error" id="email-error" role="alert">{emailError}</span>}
                </div>
                <div className="field">
                  <label htmlFor="agency-name">Agency / company <span style={{ fontWeight: 400, color: '#8a968d' }}>(optional)</span></label>
                  <input id="agency-name" name="agency" type="text" autoComplete="organization" placeholder="Your agency" value={agency} onChange={(event) => setAgency(event.target.value)} data-testid="input-agency-name" />
                </div>
                {serverError && <p className="form-error" role="alert" data-testid="status-waitlist-error">{serverError}</p>}
                <button className="primary-button waitlist-submit" type="submit" disabled={state === 'submitting'} data-testid="button-submit-waitlist">
                  {state === 'submitting' ? 'Requesting access…' : 'Request early access'} {state !== 'submitting' && <ArrowRight size={15} aria-hidden="true" />}
                </button>
                <p className="form-note">No spam. Early product access and occasional updates.</p>
              </form>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section className="closing" aria-labelledby="closing-title">
      <div className="container">
        <Reveal>
          <p className="eyebrow">ScopeCI</p>
          <h2 id="closing-title">Connect the contract to the code.</h2>
          <p>Commercial CI/CD for software agencies.</p>
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
            <img src={wordmark} alt="ScopeCI" width="133" height="32" />
            <p>Commercial CI/CD for software agencies.</p>
          </div>
          <nav className="footer-links" aria-label="Footer navigation">
            <a href="#waitlist" data-testid="link-waitlist-footer">Waitlist</a>
            <span data-testid="text-privacy-footer">Privacy</span>
            <a href="mailto:hello@scopeci.com" data-testid="link-contact-footer">Contact</a>
          </nav>
        </div>
        <div className="footer-bottom"><span>© 2026 ScopeCI</span><span>Commercial authorization for engineering work.</span></div>
      </div>
    </footer>
  );
}

function Home() {
  useEffect(() => {
    document.title = 'ScopeCI — Commercial CI/CD for Software Agencies';
    const description = 'ScopeCI connects your contracts, project work and GitHub workflow to catch commercially unauthorized engineering work before it ships.';
    const setMeta = (selector: string, attribute: string, value: string) => {
      const element = document.querySelector(selector);
      if (element) element.setAttribute(attribute, value);
    };
    setMeta('meta[name="description"]', 'content', description);
    setMeta('meta[property="og:title"]', 'content', 'ScopeCI — Commercial CI/CD for Software Agencies');
    setMeta('meta[property="og:description"]', 'content', description);
    setMeta('meta[name="twitter:title"]', 'content', 'ScopeCI — Commercial CI/CD for Software Agencies');
    setMeta('meta[name="twitter:description"]', 'content', description);
    if (!document.querySelector('link[rel="canonical"]')) {
      const canonical = document.createElement('link');
      canonical.rel = 'canonical';
      canonical.href = window.location.origin + window.location.pathname;
      document.head.appendChild(canonical);
    }
  }, []);
  return (
    <div className="site-shell">
      <Navbar />
      <main>
        <Hero />
        <ScopeGap />
        <HowScopeCIWorks />
        <ContractCodeGraph />
        <EvidencePanel />
        <CommercialCheck />
        <Waitlist />
        <Closing />
      </main>
      <Footer />
    </div>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
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