import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ClipboardCopy, Link2, Plus, X } from 'lucide-react';
import {
  getDemoGithubPr,
  useEvaluateDemo,
  useParseDemoSow,
  type DemoChangedFile,
  type DemoEvaluation,
  type DemoScopeClause,
} from '@workspace/api-client-react';
import { Footer, Navbar, anchor, track, usePageMeta } from '../site';

/* ------------------------------------------------------------------ */
/* Samples                                                             */
/* ------------------------------------------------------------------ */

const SAMPLE_SOW = `# Statement of Work — Harbor & Pine Online Store

## §3.1 Storefront and Checkout
Product catalogue, shopping cart and Stripe checkout for a single currency (GBP).

**Explicit Inclusions**:
- Product catalogue and search
- Shopping cart
- Stripe checkout

**Explicit Exclusions**:
- Loyalty points programme
- Multi-currency pricing
- Gift cards
`;

interface DraftPullRequest {
  title: string;
  branch: string;
  body: string;
  files: string;
}

const SAMPLE_PRS: ReadonlyArray<{ label: string; hint: string; pr: DraftPullRequest }> = [
  {
    label: 'Loyalty points',
    hint: 'Builds something the SOW excludes',
    pr: {
      title: 'Add loyalty points at checkout',
      branch: 'feat/loyalty-points',
      body: 'Customers earn points on every order and see them on a rewards page.',
      files: 'A\tsrc/loyalty/points.ts\nA\tsrc/loyalty/rewards-page.tsx\nM\tsrc/checkout/cart.ts',
    },
  },
  {
    label: 'Cart fix',
    hint: 'Work the SOW includes',
    pr: {
      title: 'Fix cart quantity rounding',
      branch: 'fix/cart-rounding',
      body: 'Shopping cart rounds 0.5 kg items down to zero.',
      files: 'M\tsrc/checkout/cart.ts',
    },
  },
  {
    label: 'Wishlist',
    hint: 'Something the SOW never mentions',
    pr: {
      title: 'Add a wishlist',
      branch: 'feat/wishlist',
      body: 'Let customers save items for later.',
      files: 'A\tsrc/wishlist/wishlist.ts\nA\tsrc/wishlist/WishlistButton.tsx',
    },
  },
];

const EMPTY_PR: DraftPullRequest = { title: '', branch: '', body: '', files: '' };

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const STATUS_CODES: Record<string, DemoChangedFile['status']> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
};

/**
 * One path per line. Also accepts `git diff --name-status` output ("A\tpath",
 * "R100\told\tnew"), so a developer can paste it straight in.
 */
export function parseFileList(text: string): DemoChangedFile[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 300)
    .map((line) => {
      const status = line.match(/^([AMDR])\d*\s+(.+)$/);
      if (status) {
        const path = status[2].split('\t').pop()!.trim();
        return { path: path.slice(0, 400), status: STATUS_CODES[status[1]] };
      }
      return { path: line.slice(0, 400) };
    });
}

function filesToText(files: DemoChangedFile[]): string {
  const code = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R' } as const;
  return files.map((f) => `${code[f.status ?? 'modified']}\t${f.path}`).join('\n');
}

function errorMessage(error: unknown, fallback: string): string {
  const data = (error as { data?: { error?: string; message?: string } } | null)?.data;
  const status = (error as { status?: number } | null)?.status;
  if (status === 429) return data?.message ?? 'Too many tries at once. Wait a minute.';
  if (status === undefined) return "We couldn't reach ScopeCI. Check your connection and try again.";
  return data?.error ?? fallback;
}

const VERDICT: Record<string, { label: string; tone: 'alert' | 'warn' | 'ok' }> = {
  CHANGE_REQUIRED: { label: 'Change order needed', tone: 'alert' },
  REVIEW_REQUIRED: { label: 'Needs a decision', tone: 'warn' },
  IN_SCOPE: { label: 'In scope', tone: 'ok' },
  APPROVED_CHANGE: { label: 'Covered by an approved change', tone: 'ok' },
};

/* ------------------------------------------------------------------ */
/* Scope checklist                                                     */
/* ------------------------------------------------------------------ */

function ItemList({
  id,
  label,
  tone,
  items,
  onChange,
}: {
  id: string;
  label: string;
  tone: 'included' | 'excluded';
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const add = (event: FormEvent) => {
    event.preventDefault();
    const item = draft.trim().toLowerCase();
    if (item && !items.includes(item)) onChange([...items, item]);
    setDraft('');
  };

  return (
    <div className={`scope-list is-${tone}`}>
      <p className="scope-list-label mono">{label}</p>
      {items.length === 0 ? (
        <p className="scope-list-empty">Nothing yet.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item}>
              {tone === 'included' ? <Check size={13} aria-hidden="true" /> : <X size={13} aria-hidden="true" />}
              <span>{item}</span>
              <button
                type="button"
                className="scope-remove"
                onClick={() => onChange(items.filter((i) => i !== item))}
                aria-label={`Remove "${item}" from ${label.toLowerCase()}`}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="scope-add" onSubmit={add}>
        <label className="sr-only" htmlFor={id}>
          Add to {label.toLowerCase()}
        </label>
        <input
          id={id}
          value={draft}
          maxLength={300}
          placeholder={tone === 'included' ? 'Add included work' : 'Add excluded work'}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="scope-add-button" aria-label={`Add to ${label.toLowerCase()}`}>
          <Plus size={14} aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function TryPage() {
  usePageMeta(
    'Try ScopeCI on your SOW',
    'Paste a statement of work, check what ScopeCI reads from it, and see how it judges a pull request. Nothing you paste is stored.',
  );

  const [sow, setSow] = useState(SAMPLE_SOW);
  const [sowError, setSowError] = useState('');
  const [scopeTitle, setScopeTitle] = useState('');
  const [clauses, setClauses] = useState<DemoScopeClause[] | null>(null);
  const [showEmptyClauses, setShowEmptyClauses] = useState(false);

  const [pr, setPr] = useState<DraftPullRequest>(EMPTY_PR);
  const [prUrl, setPrUrl] = useState('');
  const [prUrlState, setPrUrlState] = useState<{ loading: boolean; error: string; loaded: string }>({
    loading: false,
    error: '',
    loaded: '',
  });
  const [hours, setHours] = useState('');
  const [rate, setRate] = useState('');
  const [prError, setPrError] = useState('');

  const [result, setResult] = useState<DemoEvaluation | null>(null);
  const [changeOrder, setChangeOrder] = useState('');
  const [copied, setCopied] = useState(false);

  const parseSow = useParseDemoSow();
  const evaluate = useEvaluateDemo();

  const scopeHeading = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    track('try_opened');
  }, []);

  /* Step 1 -> 2 */
  const readScope = (event: FormEvent) => {
    event.preventDefault();
    if (!sow.trim()) {
      setSowError('Paste a statement of work first.');
      return;
    }
    setSowError('');
    parseSow.mutate(
      { data: { markdown: sow.slice(0, 40_000) } },
      {
        onSuccess: (scope) => {
          setScopeTitle(scope.title);
          setClauses(scope.clauses);
          setResult(null);
          track('try_sow_read');
          requestAnimationFrame(() => scopeHeading.current?.focus());
        },
        onError: (error) => setSowError(errorMessage(error, "We couldn't read that document.")),
      },
    );
  };

  const updateClause = (index: number, patch: Partial<DemoScopeClause>) => {
    setClauses((current) => current?.map((c, i) => (i === index ? { ...c, ...patch } : c)) ?? null);
    setResult(null);
  };

  const itemCount = clauses?.reduce((n, c) => n + c.included.length + c.excluded.length, 0) ?? 0;
  const visibleClauses =
    clauses
      ?.map((clause, index) => ({ clause, index }))
      .filter(({ clause }) => showEmptyClauses || clause.included.length + clause.excluded.length > 0) ?? [];

  /* Step 3 */
  const loadGitHubPr = async (event: FormEvent) => {
    event.preventDefault();
    if (!prUrl.trim()) return;
    setPrUrlState({ loading: true, error: '', loaded: '' });
    try {
      const loaded = await getDemoGithubPr({ url: prUrl.trim() });
      setPr({
        title: loaded.title,
        branch: loaded.branch ?? '',
        body: loaded.body ?? '',
        files: filesToText(loaded.files),
      });
      setPrUrlState({ loading: false, error: '', loaded: `Loaded #${loaded.number ?? ''}: ${loaded.files.length} files` });
      track('try_github_pr_loaded');
    } catch (error) {
      setPrUrlState({ loading: false, error: errorMessage(error, "We couldn't load that pull request."), loaded: '' });
    }
  };

  const check = (event: FormEvent) => {
    event.preventDefault();
    if (!clauses) return;
    const files = parseFileList(pr.files);
    if (!pr.title.trim() || files.length === 0) {
      setPrError('Give the pull request a title and at least one changed file.');
      return;
    }
    setPrError('');
    const toNumber = (value: string) => (value.trim() === '' ? null : Math.max(0, Number(value)));
    evaluate.mutate(
      {
        data: {
          scope: { title: scopeTitle.slice(0, 200), clauses },
          pullRequest: {
            title: pr.title.trim().slice(0, 300),
            branch: pr.branch.trim() || null,
            body: pr.body.trim().slice(0, 5000) || null,
            files,
          },
          issue: null,
          estimateHours: toNumber(hours),
          hourlyRate: toNumber(rate),
          projectName: scopeTitle.slice(0, 120) || null,
        },
      },
      {
        onSuccess: (evaluation) => {
          setResult(evaluation);
          setChangeOrder(
            evaluation.changeOrder ? `Subject: ${evaluation.changeOrder.subject}\n\n${evaluation.changeOrder.body}` : '',
          );
          setCopied(false);
          track('try_evaluated');
          requestAnimationFrame(() => resultHeading.current?.focus());
        },
        onError: (error) => setPrError(errorMessage(error, "We couldn't check that pull request.")),
      },
    );
  };

  const copyChangeOrder = async () => {
    try {
      await navigator.clipboard.writeText(changeOrder);
      setCopied(true);
      track('try_change_order_copied');
    } catch {
      setCopied(false);
    }
  };

  const verdict = result ? (VERDICT[result.state] ?? { label: result.state, tone: 'warn' as const }) : null;

  return (
    <div className="site">
      <a className="skip-link" href="#main">Skip to content</a>
      <Navbar />
      <main id="main" className="try">
        <div className="container try-inner">
          <header className="try-head">
            <h1 className="try-title">Try ScopeCI on your own SOW</h1>
            <p className="try-lede">
              Paste a statement of work, fix anything ScopeCI misreads, then describe a pull request.
              The check is the real one. Nothing you paste is stored.
            </p>
          </header>

          {/* Step 1 */}
          <section className="try-step" aria-labelledby="step-sow">
            <div className="try-step-head">
              <span className="step-num mono">1</span>
              <h2 id="step-sow">Your statement of work</h2>
            </div>
            <form onSubmit={readScope}>
              <label className="sr-only" htmlFor="sow-text">
                Statement of work
              </label>
              <textarea
                id="sow-text"
                className="try-textarea mono"
                rows={14}
                maxLength={40_000}
                value={sow}
                onChange={(e) => setSow(e.target.value)}
                aria-describedby="sow-help"
              />
              <p id="sow-help" className="try-help">
                This is a sample. Replace it with yours: Markdown or text copied from a PDF both work. Sections that
                list what's included and what's out of scope give the best result.{' '}
                {sow !== '' && (
                  <button type="button" className="try-link" onClick={() => setSow('')}>
                    Clear
                  </button>
                )}
                {sow !== SAMPLE_SOW && (
                  <button type="button" className="try-link" onClick={() => setSow(SAMPLE_SOW)}>
                    Use the sample
                  </button>
                )}
              </p>
              {sowError && (
                <p className="form-error" role="alert">
                  {sowError}
                </p>
              )}
              <button type="submit" className="button button-primary" disabled={parseSow.isPending}>
                {parseSow.isPending ? 'Reading…' : 'Read the scope'}
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            </form>
          </section>

          {/* Step 2 */}
          {clauses && (
            <section className="try-step" aria-labelledby="step-scope">
              <div className="try-step-head">
                <span className="step-num mono">2</span>
                <h2 id="step-scope" ref={scopeHeading} tabIndex={-1}>
                  What ScopeCI read
                </h2>
              </div>
              <p className="try-help">
                Fix anything it got wrong. This list, not the raw document, is what pull requests are checked
                against.
              </p>
              {itemCount === 0 && (
                <p className="try-notice">
                  We didn't find anything marked as included or excluded. Add items below, or paste a document with
                  "Included:" and "Out of scope:" lists.
                </p>
              )}
              <div className="scope-clauses">
                {(itemCount === 0 ? clauses.map((clause, index) => ({ clause, index })).slice(0, 1) : visibleClauses).map(
                  ({ clause, index }) => (
                    <article className="scope-clause" key={`${clause.clauseRef}-${index}`}>
                      <h3 className="scope-clause-title">
                        <span className="mono">{clause.clauseRef}</span> {clause.title}
                      </h3>
                      <div className="scope-columns">
                        <ItemList
                          id={`clause-${index}-included`}
                          label="Included"
                          tone="included"
                          items={clause.included}
                          onChange={(included) => updateClause(index, { included })}
                        />
                        <ItemList
                          id={`clause-${index}-excluded`}
                          label="Excluded"
                          tone="excluded"
                          items={clause.excluded}
                          onChange={(excluded) => updateClause(index, { excluded })}
                        />
                      </div>
                    </article>
                  ),
                )}
              </div>
              {itemCount > 0 && clauses.length > visibleClauses.length && (
                <button type="button" className="try-link" onClick={() => setShowEmptyClauses(true)}>
                  Show {clauses.length - visibleClauses.length} more section
                  {clauses.length - visibleClauses.length === 1 ? '' : 's'} with nothing listed
                </button>
              )}
            </section>
          )}

          {/* Step 3 */}
          {clauses && (
            <section className="try-step" aria-labelledby="step-pr">
              <div className="try-step-head">
                <span className="step-num mono">3</span>
                <h2 id="step-pr">A pull request</h2>
              </div>

              <div className="try-samples" role="group" aria-label="Sample pull requests">
                {SAMPLE_PRS.map((sample) => (
                  <button
                    type="button"
                    key={sample.label}
                    className={`try-sample ${pr.title === sample.pr.title ? 'is-active' : ''}`}
                    onClick={() => {
                      setPr(sample.pr);
                      setResult(null);
                    }}
                  >
                    <strong>{sample.label}</strong>
                    <span>{sample.hint}</span>
                  </button>
                ))}
              </div>

              <form className="try-github" onSubmit={loadGitHubPr}>
                <label htmlFor="pr-url">Or load a public GitHub pull request</label>
                <div className="try-inline">
                  <input
                    id="pr-url"
                    type="url"
                    inputMode="url"
                    placeholder="https://github.com/owner/repo/pull/123"
                    value={prUrl}
                    maxLength={300}
                    onChange={(e) => setPrUrl(e.target.value)}
                  />
                  <button type="submit" className="button button-quiet" disabled={prUrlState.loading}>
                    <Link2 size={14} aria-hidden="true" />
                    {prUrlState.loading ? 'Loading…' : 'Load'}
                  </button>
                </div>
                <p aria-live="polite" className="try-help">
                  {prUrlState.error && <span className="field-error">{prUrlState.error}</span>}
                  {prUrlState.loaded}
                </p>
              </form>

              <form onSubmit={check} className="try-pr">
                <div className="field">
                  <label htmlFor="pr-title">Title</label>
                  <input
                    id="pr-title"
                    value={pr.title}
                    maxLength={300}
                    placeholder="Add loyalty points at checkout"
                    onChange={(e) => setPr({ ...pr, title: e.target.value })}
                  />
                </div>
                <div className="field">
                  <label htmlFor="pr-files">
                    Changed files <span className="field-optional">one per line, or paste git diff --name-status</span>
                  </label>
                  <textarea
                    id="pr-files"
                    className="try-textarea mono"
                    rows={5}
                    value={pr.files}
                    placeholder={'src/loyalty/points.ts\nsrc/checkout/cart.ts'}
                    onChange={(e) => setPr({ ...pr, files: e.target.value })}
                  />
                </div>
                <div className="try-row">
                  <div className="field">
                    <label htmlFor="pr-branch">
                      Branch <span className="field-optional">optional</span>
                    </label>
                    <input
                      id="pr-branch"
                      value={pr.branch}
                      maxLength={200}
                      onChange={(e) => setPr({ ...pr, branch: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="pr-hours">
                      Estimated hours <span className="field-optional">optional</span>
                    </label>
                    <input
                      id="pr-hours"
                      type="number"
                      min={0}
                      max={10000}
                      inputMode="decimal"
                      value={hours}
                      onChange={(e) => setHours(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="pr-rate">
                      Your hourly rate, $ <span className="field-optional">optional</span>
                    </label>
                    <input
                      id="pr-rate"
                      type="number"
                      min={0}
                      max={10000}
                      inputMode="decimal"
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                    />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="pr-body">
                    Description <span className="field-optional">optional</span>
                  </label>
                  <textarea
                    id="pr-body"
                    className="try-textarea"
                    rows={3}
                    maxLength={5000}
                    value={pr.body}
                    onChange={(e) => setPr({ ...pr, body: e.target.value })}
                  />
                </div>
                {prError && (
                  <p className="form-error" role="alert">
                    {prError}
                  </p>
                )}
                <button type="submit" className="button button-primary" disabled={evaluate.isPending}>
                  {evaluate.isPending ? 'Checking…' : 'Check this pull request'}
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
              </form>
            </section>
          )}

          {/* Step 4 */}
          {result && verdict && (
            <section className="try-step try-result" aria-labelledby="step-result" aria-live="polite">
              <div className="try-step-head">
                <span className="step-num mono">4</span>
                <h2 id="step-result" ref={resultHeading} tabIndex={-1}>
                  The result
                </h2>
              </div>

              <div className={`verdict-card is-${verdict.tone}`} data-testid="try-verdict">
                <p className="verdict-card-label mono">{verdict.label}</p>
                <p className="verdict-card-reason">{result.reason}</p>
                {result.clause && (
                  <p className="verdict-card-clause mono">
                    {result.clause.clauseRef} {result.clause.title}
                  </p>
                )}
                {result.delta.length > 0 && (
                  <ul className="verdict-card-delta">
                    {result.delta.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
                {result.estimate && <p className="verdict-card-estimate">Estimated impact: {result.estimate}</p>}
              </div>

              {result.changeOrder && (
                <div className="change-order">
                  <div className="change-order-head">
                    <h3>Change order draft</h3>
                    <button type="button" className="button button-quiet" onClick={copyChangeOrder}>
                      <ClipboardCopy size={14} aria-hidden="true" />
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="try-help">Edit it, then send it to your client instead of doing the work for free.</p>
                  <label className="sr-only" htmlFor="change-order-text">
                    Change order draft
                  </label>
                  <textarea
                    id="change-order-text"
                    className="try-textarea"
                    rows={14}
                    value={changeOrder}
                    onChange={(e) => {
                      setChangeOrder(e.target.value);
                      setCopied(false);
                    }}
                  />
                </div>
              )}

              <details className="try-comment">
                <summary>The comment ScopeCI would post on the pull request</summary>
                <pre className="mono">{result.comment}</pre>
              </details>

              <div className="try-cta">
                <p>
                  <strong>Want this on your real pull requests?</strong> We're taking a small group of fixed-price
                  agencies on GitHub and Linear into the pilot.
                </p>
                <a className="button button-primary" href={anchor('waitlist')} onClick={() => track('try_waitlist_click')}>
                  Join the pilot waitlist
                  <ArrowRight size={15} aria-hidden="true" />
                </a>
              </div>
            </section>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
