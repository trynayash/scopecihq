import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, Route, Switch, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, ExternalLink, Lock, LogOut, Plus } from 'lucide-react';
import { SiGithub } from 'react-icons/si';
import {
  getGetProjectQueryKey,
  getGetSessionQueryKey,
  getListGitHubRepositoriesQueryKey,
  getListProjectPullRequestsQueryKey,
  getListProjectsQueryKey,
  useArchiveProject,
  useCreateProject,
  useEndSession,
  useGetProject,
  useGetSession,
  useLinkProjectRepository,
  useListGitHubRepositories,
  useListProjectPullRequests,
  useListProjects,
  useParseDemoSow,
  useSaveProjectScope,
  useUnlinkProjectRepository,
  useUpdateChangeOrder,
  useUpdateProject,
  type DemoScopeClause,
  type PolicyMode,
  type Project,
  type PullRequestResult,
  type SavedScope,
  type SessionOrganization,
  type SessionUser,
  type TrackedChangeOrder,
} from '@workspace/api-client-react';
import { BASE, ICON_MARK, TRY_PATH, WORDMARK, usePageMeta } from '../site';
import { ChangeOrderBox, ScopeEditor, changeOrderText, errorMessage, itemCount, verdictOf } from '../scope-ui';

/**
 * The signed-in app at /app: projects, each with its confirmed scope, its
 * GitHub repository and the pull requests ScopeCI has checked.
 */

const RETURN_KEY = 'scopeci:return-to';
const APP_HOME = `${BASE}/app`;

function remember(path: string) {
  try {
    sessionStorage.setItem(RETURN_KEY, path);
  } catch {
    // private mode: the person lands on the project list instead
  }
}

function recall(): string | null {
  try {
    const path = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return path;
  } catch {
    return null;
  }
}

const money = (amount: number) => `$${amount.toLocaleString('en-US')}`;

const signInHref = (next: string) => `${BASE}/api/auth/github?next=${encodeURIComponent(next)}`;

function relativeTime(value: string | Date): string {
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

function AppHeader({ user, organization }: { user?: SessionUser; organization?: SessionOrganization | null }) {
  const queryClient = useQueryClient();
  const endSession = useEndSession();
  const signOut = () =>
    endSession.mutate(undefined, {
      onSettled: () => {
        queryClient.clear();
        window.location.assign(APP_HOME);
      },
    });

  return (
    <header className="app-header">
      <div className="container app-header-inner">
        <Link href="/" className="brand app-brand" aria-label="ScopeCI projects">
          <picture className="brand-logo">
            <source media="(max-width: 719px)" srcSet={ICON_MARK} />
            <img src={WORDMARK} alt="ScopeCI" width="651" height="217" decoding="async" />
          </picture>
        </Link>
        {user && (
          <div className="app-account">
            <span className="app-account-name">
              {user.avatarUrl && <img src={user.avatarUrl} alt="" width="24" height="24" />}
              <span>{organization?.name ?? user.login}</span>
            </span>
            <button type="button" className="button button-quiet button-sm" onClick={signOut} disabled={endSession.isPending}>
              <LogOut size={14} aria-hidden="true" />
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

function Frame({ children, user, organization }: { children: ReactNode; user?: SessionUser; organization?: SessionOrganization | null }) {
  return (
    <div className="site app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <AppHeader user={user} organization={organization} />
      <main id="main" className="app-main">
        <div className="container app-inner">{children}</div>
      </main>
    </div>
  );
}

const SIGN_IN_PROBLEMS: Record<string, string> = {
  cancelled: 'Sign-in was cancelled on GitHub.',
  expired: 'That sign-in link expired. Try again.',
  failed: "GitHub sign-in didn't complete. Try again in a moment.",
  unavailable: "Sign-in isn't switched on for this server yet.",
};

function SignIn({ available }: { available: boolean }) {
  usePageMeta('Sign in — ScopeCI', 'Sign in to ScopeCI with GitHub.');
  const problem = SIGN_IN_PROBLEMS[new URLSearchParams(window.location.search).get('signin') ?? ''];
  const path = window.location.pathname.slice(BASE.length) || '/app';
  const next = path.startsWith('/app') ? path : '/app';

  return (
    <Frame>
      <section className="app-signin" aria-labelledby="signin-title">
        <h1 id="signin-title">Sign in to ScopeCI</h1>
        <p className="try-lede">
          Use your GitHub account. ScopeCI uses it to see who you are and which repositories you've given the ScopeCI
          app access to.
        </p>
        {problem && (
          <p className="try-notice" role="alert">
            {problem}
          </p>
        )}
        {available ? (
          <a className="button button-primary" href={signInHref(next)} data-testid="button-sign-in">
            <SiGithub size={16} aria-hidden="true" />
            Sign in with GitHub
          </a>
        ) : (
          !problem && <p className="try-notice">Sign-in isn't switched on for this server yet.</p>
        )}
        <p className="try-help">
          Signing in for the first time creates your workspace. Rather look first?{' '}
          <a className="try-link" href={TRY_PATH}>
            Try it on your SOW
          </a>
        </p>
      </section>
    </Frame>
  );
}

export default function AppPage() {
  const session = useGetSession({ query: { queryKey: getGetSessionQueryKey(), retry: 1, staleTime: 60_000 } });

  if (session.isPending) {
    return (
      <Frame>
        <p className="app-loading">Loading…</p>
      </Frame>
    );
  }
  if (session.isError || !session.data) {
    return (
      <Frame>
        <p className="form-error" role="alert">
          {errorMessage(session.error, "We couldn't load your account.")}
        </p>
      </Frame>
    );
  }
  const { user, organization, signInAvailable } = session.data;
  if (!user) return <SignIn available={signInAvailable} />;

  return (
    <Frame user={user} organization={organization}>
      <Switch>
        <Route path="/" component={ProjectsHome} />
        <Route path="/projects/new" component={NewProject} />
        <Route path="/projects/:projectId" component={ProjectPage} />
        <Route>
          <p className="app-empty">
            Nothing here. <Link href="/">Back to your projects</Link>
          </p>
        </Route>
      </Switch>
    </Frame>
  );
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

function ProjectStatus({ project }: { project: Project }) {
  const { checked, changeOrders, decisions, changeOrdersSent, changeOrdersApproved, approvedValue } = project.counts;
  return (
    <p className="project-status mono">
      {project.scopeVersion ? `Scope ${project.scopeVersion}` : 'Scope not confirmed'}
      {' · '}
      {project.repository ? project.repository.fullName : 'No repository'}
      {checked > 0 && (
        <>
          {' · '}
          {checked} checked
          {changeOrders > 0 && `, ${changeOrders} need${changeOrders === 1 ? 's' : ''} a change order`}
          {decisions > 0 && `, ${decisions} to decide`}
        </>
      )}
      {changeOrdersSent > 0 && ` · ${changeOrdersSent} sent`}
      {changeOrdersApproved > 0 &&
        ` · ${changeOrdersApproved} approved${approvedValue > 0 ? ` (${money(approvedValue)})` : ''}`}
    </p>
  );
}

function ProjectsHome() {
  usePageMeta('Projects — ScopeCI', 'Your ScopeCI projects.');
  const [, navigate] = useLocation();
  const projects = useListProjects();

  // Back from installing the GitHub App: return to the project that sent us.
  useEffect(() => {
    const back = recall();
    if (back && back.startsWith('/projects/')) navigate(back);
  }, [navigate]);

  return (
    <>
      <header className="app-page-head">
        <div>
          <h1>Projects</h1>
          <p className="try-lede">One project per client engagement: its scope, its repository and every pull request checked.</p>
        </div>
        <Link href="/projects/new" className="button button-primary" data-testid="button-new-project">
          <Plus size={15} aria-hidden="true" />
          New project
        </Link>
      </header>

      {projects.isPending && <p className="app-loading">Loading projects…</p>}
      {projects.isError && (
        <p className="form-error" role="alert">
          {errorMessage(projects.error, "We couldn't load your projects.")}
        </p>
      )}
      {projects.data && projects.data.projects.length === 0 && (
        <section className="try-step app-onboarding">
          <h2>Set up your first project</h2>
          <ol className="app-steps">
            <li>Create a project for one client engagement.</li>
            <li>Paste its statement of work and confirm what's included and excluded.</li>
            <li>Connect the GitHub repository the work happens in.</li>
          </ol>
          <p className="try-help">From then on, every pull request gets a check and a comment, and work the SOW excludes comes with a change order draft.</p>
        </section>
      )}
      {projects.data && projects.data.projects.length > 0 && (
        <ul className="project-list">
          {projects.data.projects.map((project) => (
            <li key={project.id}>
              <Link href={`/projects/${project.id}`} className="project-card" data-testid="project-card">
                <span className="project-card-name">{project.name}</span>
                {project.clientName && <span className="project-card-client">{project.clientName}</span>}
                <ProjectStatus project={project} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function NewProject() {
  usePageMeta('New project — ScopeCI', 'Start a ScopeCI project.');
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const create = useCreateProject();
  const [name, setName] = useState('');
  const [client, setClient] = useState('');
  const [rate, setRate] = useState('');
  const [error, setError] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('Give the project a name.');
      return;
    }
    setError('');
    create.mutate(
      {
        data: {
          name: name.trim().slice(0, 160),
          clientName: client.trim().slice(0, 160) || null,
          hourlyRate: rate.trim() === '' ? null : Math.min(100_000, Math.max(0, Math.round(Number(rate)))),
        },
      },
      {
        onSuccess: (project) => {
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          navigate(`/projects/${project.id}`);
        },
        onError: (err) => setError(errorMessage(err, "We couldn't create the project.")),
      },
    );
  };

  return (
    <>
      <Link href="/" className="app-back">
        <ArrowLeft size={14} aria-hidden="true" /> Projects
      </Link>
      <header className="app-page-head">
        <h1>New project</h1>
      </header>
      <form className="try-step app-form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="project-name">Project name</label>
          <input id="project-name" value={name} maxLength={160} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="project-client">
            Client <span className="field-optional">used to greet them in change order drafts</span>
          </label>
          <input id="project-client" value={client} maxLength={160} onChange={(e) => setClient(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="project-rate">
            Hourly rate, $ <span className="field-optional">leave empty to never show prices</span>
          </label>
          <input
            id="project-rate"
            type="number"
            min={0}
            max={100000}
            inputMode="numeric"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button button-primary" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create project'}
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      </form>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* One project                                                         */
/* ------------------------------------------------------------------ */

function ProjectPage() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const detail = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId), retry: false } });
  usePageMeta(`${detail.data?.project.name ?? 'Project'} — ScopeCI`, 'A ScopeCI project.');

  if (detail.isPending) return <p className="app-loading">Loading project…</p>;
  if (detail.isError || !detail.data) {
    return (
      <p className="app-empty">
        {(detail.error as { status?: number } | null)?.status === 404
          ? 'No such project in your workspace.'
          : errorMessage(detail.error, "We couldn't load this project.")}{' '}
        <Link href="/">Back to your projects</Link>
      </p>
    );
  }

  const { project, scope } = detail.data;
  return (
    <>
      <Link href="/" className="app-back">
        <ArrowLeft size={14} aria-hidden="true" /> Projects
      </Link>
      <header className="app-page-head">
        <div>
          <h1>{project.name}</h1>
          <ProjectStatus project={project} />
        </div>
      </header>
      <ScopeSection project={project} scope={scope} />
      <RepositorySection project={project} />
      <PullRequestsSection project={project} />
      <SettingsSection project={project} />
    </>
  );
}

function SectionHead({ step, title, done, id }: { step?: number; title: string; done?: boolean; id: string }) {
  return (
    <div className="try-step-head">
      {step !== undefined && <span className={`step-num mono ${done ? 'is-done' : ''}`}>{done ? '✓' : step}</span>}
      <h2 id={id}>{title}</h2>
    </div>
  );
}

/* Scope ------------------------------------------------------------- */

function ScopeSection({ project, scope }: { project: Project; scope: SavedScope | null }) {
  const queryClient = useQueryClient();
  const parse = useParseDemoSow();
  const save = useSaveProjectScope();

  const [pasting, setPasting] = useState(!scope);
  const [sow, setSow] = useState('');
  const [title, setTitle] = useState(scope?.title ?? project.name);
  const [draft, setDraft] = useState<DemoScopeClause[] | null>(scope?.clauses ?? null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // A newly saved version replaces the draft.
  useEffect(() => {
    setDraft(scope?.clauses ?? null);
    setTitle(scope?.title ?? project.name);
    setPasting(!scope);
  }, [scope, project.name]);

  const dirty = useMemo(
    () => draft !== null && JSON.stringify(draft) !== JSON.stringify(scope?.clauses ?? null),
    [draft, scope],
  );

  const read = (event: FormEvent) => {
    event.preventDefault();
    if (!sow.trim()) {
      setError('Paste the statement of work first.');
      return;
    }
    setError('');
    parse.mutate(
      { data: { markdown: sow.slice(0, 40_000) } },
      {
        onSuccess: (parsed) => {
          setDraft(parsed.clauses);
          setTitle(parsed.title || project.name);
          setPasting(false);
          setMessage('');
        },
        onError: (err) => setError(errorMessage(err, "We couldn't read that document.")),
      },
    );
  };

  const startEmpty = () => {
    setDraft([{ clauseRef: '§1', title: 'Scope', included: [], excluded: [] }]);
    setPasting(false);
  };

  const submit = () => {
    if (!draft || itemCount(draft) === 0) {
      setError('Add at least one included or excluded item before saving.');
      return;
    }
    setError('');
    save.mutate(
      { projectId: project.id, data: { title: title.slice(0, 200), clauses: draft.slice(0, 60) } },
      {
        onSuccess: (saved) => {
          setMessage(`Saved as ${saved.version}. New pull requests are checked against it.`);
          queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(project.id) });
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        },
        onError: (err) => setError(errorMessage(err, "We couldn't save the scope.")),
      },
    );
  };

  return (
    <section className="try-step" aria-labelledby="scope-title">
      <SectionHead step={1} title="Scope" done={Boolean(scope)} id="scope-title" />
      {scope && !dirty && !pasting && (
        <p className="try-help">
          Scope {scope.version}, saved {relativeTime(scope.savedAt)}. Edit the lists and save to make a new version;
          earlier results keep the version they were checked against.
        </p>
      )}

      {pasting ? (
        <form onSubmit={read}>
          <label className="sr-only" htmlFor="project-sow">
            Statement of work
          </label>
          <textarea
            id="project-sow"
            className="try-textarea mono"
            rows={12}
            maxLength={40_000}
            value={sow}
            placeholder="Paste the statement of work: Markdown or text copied from a PDF."
            onChange={(e) => setSow(e.target.value)}
          />
          <p className="try-help">
            ScopeCI reads what each section includes and excludes. You check that list before anything is saved.{' '}
            {!scope && (
              <button type="button" className="try-link" onClick={startEmpty}>
                No document? Start with an empty list
              </button>
            )}
            {scope && (
              <button type="button" className="try-link" onClick={() => setPasting(false)}>
                Cancel
              </button>
            )}
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="button button-primary" disabled={parse.isPending}>
            {parse.isPending ? 'Reading…' : 'Read the scope'}
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </form>
      ) : (
        draft && (
          <>
            {itemCount(draft) === 0 && (
              <p className="try-notice">
                Nothing is marked as included or excluded yet. Add the work this engagement covers and what it
                leaves out.
              </p>
            )}
            <ScopeEditor clauses={draft} onChange={setDraft} idPrefix="scope" />
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {message && !dirty && (
              <p className="try-help" role="status">
                {message}
              </p>
            )}
            <div className="app-actions">
              {(dirty || !scope) && (
                <button type="button" className="button button-primary" onClick={submit} disabled={save.isPending}>
                  {save.isPending ? 'Saving…' : scope ? 'Save as a new version' : 'Save this scope'}
                </button>
              )}
              {dirty && scope && (
                <button type="button" className="button button-quiet" onClick={() => setDraft(scope.clauses)}>
                  Discard changes
                </button>
              )}
              <button type="button" className="try-link" onClick={() => setPasting(true)}>
                {scope ? 'Read a new SOW instead' : 'Paste a different document'}
              </button>
            </div>
          </>
        )
      )}
    </section>
  );
}

/* Repository -------------------------------------------------------- */

function RepositorySection({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [choosing, setChoosing] = useState(false);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const repos = useListGitHubRepositories({
    query: { queryKey: getListGitHubRepositoriesQueryKey(), enabled: choosing, retry: false, staleTime: 0 },
  });
  const link = useLinkProjectRepository();
  const unlink = useUnlinkProjectRepository();

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(project.id) });
    queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListGitHubRepositoriesQueryKey() });
  };

  const connect = (event: FormEvent) => {
    event.preventDefault();
    const repo = repos.data?.repositories.find((r) => String(r.id) === selected);
    if (!repo) {
      setError('Choose a repository.');
      return;
    }
    setError('');
    link.mutate(
      { projectId: project.id, data: { installationId: repo.installationId, repositoryId: repo.id } },
      {
        onSuccess: () => {
          setChoosing(false);
          refresh();
        },
        onError: (err) => setError(errorMessage(err, "We couldn't connect that repository.")),
      },
    );
  };

  const disconnect = () =>
    unlink.mutate({ projectId: project.id }, { onSuccess: refresh, onError: (err) => setError(errorMessage(err, "We couldn't disconnect it.")) });

  const reauth = (repos.error as { status?: number } | null)?.status === 401;
  const install = () => remember(`/projects/${project.id}`);

  return (
    <section className="try-step" aria-labelledby="repo-title">
      <SectionHead step={2} title="Repository" done={Boolean(project.repository)} id="repo-title" />

      {project.repository ? (
        <>
          <p className="app-repo">
            <SiGithub size={15} aria-hidden="true" />
            <a href={`https://github.com/${project.repository.fullName}`} target="_blank" rel="noreferrer">
              {project.repository.fullName}
            </a>
          </p>
          <p className="try-help">
            {project.scopeVersion
              ? `Every pull request opened or updated here is checked against scope ${project.scopeVersion}.`
              : 'Pull requests here are checked once the scope above is saved.'}
          </p>
          <div className="app-actions">
            <button type="button" className="button button-quiet" onClick={disconnect} disabled={unlink.isPending}>
              Disconnect
            </button>
          </div>
        </>
      ) : !choosing ? (
        <>
          <p className="try-help">Connect the GitHub repository this engagement's code lives in.</p>
          <div className="app-actions">
            <button type="button" className="button button-primary" onClick={() => setChoosing(true)} data-testid="button-choose-repo">
              Choose a repository
            </button>
          </div>
        </>
      ) : repos.isPending ? (
        <p className="app-loading">Asking GitHub which repositories you can connect…</p>
      ) : reauth ? (
        <p className="try-notice" role="alert">
          GitHub access expired.{' '}
          <a className="try-link" href={signInHref(`/app/projects/${project.id}`)}>
            Sign in again
          </a>
        </p>
      ) : repos.isError ? (
        <p className="form-error" role="alert">
          {errorMessage(repos.error, "We couldn't reach GitHub.")}
        </p>
      ) : (
        <form onSubmit={connect}>
          {repos.data.repositories.length === 0 ? (
            <p className="try-notice">
              The ScopeCI GitHub App isn't installed on any account you can see yet. Install it on the account or
              organization that owns the repository, then come back here.
            </p>
          ) : (
            <fieldset className="repo-list">
              <legend className="sr-only">Repositories</legend>
              {repos.data.repositories.map((repo) => {
                const usedElsewhere = repo.linkedProjectId !== null && repo.linkedProjectId !== project.id;
                return (
                  <label key={repo.id} className={`repo-option ${usedElsewhere ? 'is-disabled' : ''}`}>
                    <input
                      type="radio"
                      name="repository"
                      value={String(repo.id)}
                      disabled={usedElsewhere}
                      checked={selected === String(repo.id)}
                      onChange={(e) => setSelected(e.target.value)}
                    />
                    <span className="mono">{repo.fullName}</span>
                    {repo.private && <Lock size={12} aria-label="private" />}
                    {usedElsewhere && <span className="repo-note">used by another project</span>}
                  </label>
                );
              })}
            </fieldset>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="app-actions">
            {repos.data.repositories.length > 0 && (
              <button type="submit" className="button button-primary" disabled={link.isPending}>
                {link.isPending ? 'Connecting…' : 'Connect'}
              </button>
            )}
            {repos.data.installUrl && (
              <a className="button button-quiet" href={repos.data.installUrl} onClick={install}>
                <SiGithub size={14} aria-hidden="true" />
                {repos.data.repositories.length === 0 ? 'Install the GitHub App' : 'Add a repository on GitHub'}
              </a>
            )}
            <button type="button" className="try-link" onClick={() => setChoosing(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/* Pull requests ----------------------------------------------------- */

function changeOrderSummary(tracked: TrackedChangeOrder | null): string {
  if (!tracked || tracked.status === 'DRAFT') return 'Not sent yet';
  if (tracked.status === 'SENT') return `${tracked.reference} sent ${relativeTime(tracked.sentAt!)}, waiting on the client`;
  const price = tracked.amount ? `, ${money(tracked.amount)}` : '';
  return tracked.status === 'APPROVED' ? `${tracked.reference} approved${price}` : `${tracked.reference} declined`;
}

/** "Subject: …" on the first line, then the message, as the draft box shows it. */
function splitMessage(text: string): { subject?: string; body: string } {
  const match = text.match(/^Subject: (.*)\r?\n\r?\n([\s\S]*)$/);
  return match ? { subject: match[1].slice(0, 300), body: match[2].slice(0, 10_000) } : { body: text.slice(0, 10_000) };
}

function ChangeOrderPanel({ project, pr }: { project: Project; pr: PullRequestResult }) {
  const queryClient = useQueryClient();
  const update = useUpdateChangeOrder();
  const tracked = pr.trackedChangeOrder;
  const source = tracked ? { subject: tracked.subject, body: tracked.body } : pr.changeOrder;
  const [text, setText] = useState(changeOrderText(source));
  const [hours, setHours] = useState(tracked?.hours ? String(tracked.hours) : '');
  const [error, setError] = useState('');
  useEffect(() => setText(changeOrderText(source)), [source?.subject, source?.body]);

  const decided = tracked?.status === 'APPROVED' || tracked?.status === 'DECLINED';
  const save = (data: { hours?: number | null; status?: 'SENT' | 'APPROVED' | 'DECLINED'; subject?: string; body?: string }) =>
    update.mutate(
      { projectId: project.id, data: { evaluationId: pr.evaluationId, ...data } },
      {
        onSuccess: () => {
          setError('');
          queryClient.invalidateQueries({ queryKey: getListProjectPullRequestsQueryKey(project.id) });
          queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(project.id) });
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        },
        onError: (err) => setError(errorMessage(err, "We couldn't update the change order.")),
      },
    );

  const price = (event: FormEvent) => {
    event.preventDefault();
    const value = hours.trim() === '' ? null : Math.min(10_000, Math.max(0, Math.round(Number(hours))));
    save({ hours: value });
  };

  return (
    <details className="pr-row-draft" open={tracked?.status === 'SENT' || undefined}>
      <summary>
        Change order <span className="pr-row-co-status">· {changeOrderSummary(tracked)}</span>
      </summary>
      {decided ? (
        <p className="try-help">
          {tracked!.status === 'APPROVED'
            ? 'The client approved it. This work is covered on this and later pull requests.'
            : 'The client declined it. Take the work out of this pull request, or absorb it knowingly.'}
        </p>
      ) : (
        <>
          <form className="co-hours" onSubmit={price}>
            <div className="field">
              <label htmlFor={`co-hours-${pr.evaluationId}`}>
                Hours{' '}
                <span className="field-optional">
                  {project.hourlyRate ? `priced at ${money(project.hourlyRate)} an hour` : 'set an hourly rate in settings to show a price'}
                </span>
              </label>
              <div className="try-inline">
                <input
                  id={`co-hours-${pr.evaluationId}`}
                  type="number"
                  min={0}
                  max={10000}
                  inputMode="numeric"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                />
                <button type="submit" className="button button-quiet" disabled={update.isPending}>
                  Update the draft
                </button>
              </div>
            </div>
          </form>
          <ChangeOrderBox id={`change-order-${pr.evaluationId}`} text={text} onChange={setText} showHeading={false} />
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!decided && (
        <div className="app-actions">
          {tracked?.status !== 'SENT' && (
            <button
              type="button"
              className="button button-primary"
              disabled={update.isPending}
              onClick={() => save({ status: 'SENT', ...splitMessage(text) })}
            >
              Mark as sent
            </button>
          )}
          <button type="button" className="button button-quiet" disabled={update.isPending} onClick={() => save({ status: 'APPROVED' })}>
            Client approved
          </button>
          <button type="button" className="try-link" disabled={update.isPending} onClick={() => save({ status: 'DECLINED' })}>
            Client declined
          </button>
        </div>
      )}
    </details>
  );
}

function PullRequestRow({ project, pr }: { project: Project; pr: PullRequestResult }) {
  const verdict = verdictOf(pr.verdict);

  return (
    <li className={`verdict-card is-${verdict.tone} pr-row`} data-testid="pr-result">
      <p className="verdict-card-label mono">{verdict.label}</p>
      <p className="pr-row-title">
        <a href={pr.url} target="_blank" rel="noreferrer">
          #{pr.number} {pr.title}
          <ExternalLink size={12} aria-hidden="true" />
        </a>
      </p>
      <p className="verdict-card-clause mono">
        {pr.branch ? `${pr.branch} · ` : ''}
        {pr.prState === 'OPEN' ? 'open' : pr.prState === 'MERGED' ? 'merged' : 'closed'} · checked {relativeTime(pr.checkedAt)}
      </p>
      <p className="verdict-card-reason">{pr.reason}</p>
      {pr.estimate && <p className="verdict-card-estimate">Estimated impact: {pr.estimate}</p>}
      {(pr.changeOrder || pr.trackedChangeOrder) && <ChangeOrderPanel project={project} pr={pr} />}
    </li>
  );
}

function PullRequestsSection({ project }: { project: Project }) {
  const results = useListProjectPullRequests(project.id, {
    query: { queryKey: getListProjectPullRequestsQueryKey(project.id), refetchInterval: 30_000 },
  });

  return (
    <section className="try-step" aria-labelledby="prs-title">
      <SectionHead title="Checked pull requests" id="prs-title" />
      {results.isPending && <p className="app-loading">Loading…</p>}
      {results.isError && (
        <p className="form-error" role="alert">
          {errorMessage(results.error, "We couldn't load the results.")}
        </p>
      )}
      {results.data && results.data.pullRequests.length === 0 && (
        <p className="try-help">
          {project.repository && project.scopeVersion
            ? `Nothing checked yet. The next pull request opened or updated on ${project.repository.fullName} shows up here.`
            : 'Results appear here once the scope is saved and a repository is connected.'}
        </p>
      )}
      {results.data && results.data.pullRequests.length > 0 && (
        <ul className="pr-list">
          {results.data.pullRequests.map((pr) => (
            <PullRequestRow key={pr.evaluationId} project={project} pr={pr} />
          ))}
        </ul>
      )}
    </section>
  );
}

/* Settings ---------------------------------------------------------- */

const POLICIES: Array<{ value: PolicyMode; label: string; help: string }> = [
  { value: 'OBSERVE', label: 'Report only', help: 'Posts a neutral check and a comment. Never affects merging.' },
  {
    value: 'REVIEW',
    label: 'Ask for a decision',
    help: 'Marks the check as needing action when work is out of scope or unclear.',
  },
  {
    value: 'ENFORCE',
    label: 'Fail the check',
    help: 'Fails the check on excluded work. With branch protection, that blocks merging until it is approved.',
  },
];

function SettingsSection({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const update = useUpdateProject();
  const archive = useArchiveProject();
  const [name, setName] = useState(project.name);
  const [client, setClient] = useState(project.clientName ?? '');
  const [rate, setRate] = useState(project.hourlyRate === null ? '' : String(project.hourlyRate));
  const [policy, setPolicy] = useState<PolicyMode>(project.policyMode);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError('The project needs a name.');
      return;
    }
    setError('');
    update.mutate(
      {
        projectId: project.id,
        data: {
          name: name.trim().slice(0, 160),
          clientName: client.trim().slice(0, 160) || null,
          hourlyRate: rate.trim() === '' ? null : Math.min(100_000, Math.max(0, Math.round(Number(rate)))),
          policyMode: policy,
        },
      },
      {
        onSuccess: () => {
          setStatus('Saved.');
          queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(project.id) });
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        },
        onError: (err) => setError(errorMessage(err, "We couldn't save the settings.")),
      },
    );
  };

  const archiveProject = () => {
    if (!window.confirm(`Archive "${project.name}"? Its repository stops being checked.`)) return;
    archive.mutate(
      { projectId: project.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          navigate('/');
        },
        onError: (err) => setError(errorMessage(err, "We couldn't archive the project.")),
      },
    );
  };

  return (
    <section className="try-step" aria-labelledby="settings-title">
      <SectionHead title="Settings" id="settings-title" />
      <form onSubmit={submit} onChange={() => setStatus('')}>
        <div className="try-row app-settings-row">
          <div className="field">
            <label htmlFor="settings-name">Project name</label>
            <input id="settings-name" value={name} maxLength={160} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="settings-client">Client</label>
            <input id="settings-client" value={client} maxLength={160} onChange={(e) => setClient(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="settings-rate">
              Hourly rate, $ <span className="field-optional">empty = no prices</span>
            </label>
            <input
              id="settings-rate"
              type="number"
              min={0}
              max={100000}
              inputMode="numeric"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
          </div>
        </div>
        <fieldset className="policy-options">
          <legend>What the GitHub check does</legend>
          {POLICIES.map((option) => (
            <label key={option.value} className={`policy-option ${policy === option.value ? 'is-selected' : ''}`}>
              <input
                type="radio"
                name="policy"
                value={option.value}
                checked={policy === option.value}
                onChange={() => setPolicy(option.value)}
              />
              <span>
                <strong>{option.label}</strong>
                <span>{option.help}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="app-actions">
          <button type="submit" className="button button-primary" disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save settings'}
          </button>
          {status && (
            <span className="try-help" role="status">
              {status}
            </span>
          )}
          <button type="button" className="try-link app-archive" onClick={archiveProject} disabled={archive.isPending}>
            Archive project
          </button>
        </div>
      </form>
    </section>
  );
}
