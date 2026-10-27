import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { Link, Route, Switch, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { SiGithub } from 'react-icons/si';
import {
  getGetProjectQueryKey,
  getGetSessionQueryKey,
  getListGitHubRepositoriesQueryKey,
  getListProjectPullRequestsQueryKey,
  getListProjectsQueryKey,
  getGetWorkspaceQueryKey,
  getGetInviteQueryKey,
  useAcceptInvite,
  useArchiveProject,
  useCreateInvite,
  useGetInvite,
  useGetWorkspace,
  useRemoveMember,
  useRevokeInvite,
  useSwitchWorkspace,
  useUpdateWorkspace,
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
import { BASE, ICON_MARK, Logo, TRY_PATH, ThemeToggle, usePageMeta } from '../site';
import { ChangeOrderBox, ScopeEditor, changeOrderText, errorMessage, itemCount, verdictOf } from '../scope-ui';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CopyIcon,
  ExternalIcon,
  FolderIcon,
  Icon,
  LockIcon,
  PlusIcon,
  SignOutIcon,
  TeamIcon,
  TickIcon,
} from '../icons';

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

function WorkspaceSwitcher({ current, workspaces }: { current: SessionOrganization; workspaces: SessionOrganization[] }) {
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const switchTo = useSwitchWorkspace();
  if (workspaces.length < 2) return <span className="app-workspace-name">{current.name}</span>;
  return (
    <>
      <label className="sr-only" htmlFor="workspace-switcher">
        Workspace
      </label>
      <select
        id="workspace-switcher"
        className="app-workspace-select"
        value={current.id}
        disabled={switchTo.isPending}
        onChange={(e) =>
          switchTo.mutate(
            { data: { organizationId: e.target.value } },
            {
              onSuccess: () => {
                // Everything on screen belonged to the other workspace.
                queryClient.invalidateQueries();
                navigate('/');
              },
            },
          )
        }
      >
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
    </>
  );
}

function AppHeader({
  user,
  organization,
  workspaces = [],
}: {
  user?: SessionUser;
  organization?: SessionOrganization | null;
  workspaces?: SessionOrganization[];
}) {
  const queryClient = useQueryClient();
  const [location] = useLocation();
  const endSession = useEndSession();
  const onProjects = location === '/' || location.startsWith('/projects');
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
          <Logo />
        </Link>
        {user && (
          <>
            <span className="app-header-divider" aria-hidden="true" />
            <span className="app-account-name">
              {organization ? <WorkspaceSwitcher current={organization} workspaces={workspaces} /> : <span>{user.login}</span>}
            </span>
            <nav className="app-nav" aria-label="App">
              <Link href="/" className={`app-nav-link ${onProjects ? 'is-active' : ''}`} data-testid="link-projects">
                <Icon icon={FolderIcon} size={14} />
                <span className="app-header-label">Projects</span>
              </Link>
              <Link href="/team" className={`app-nav-link ${location === '/team' ? 'is-active' : ''}`} data-testid="link-team">
                <Icon icon={TeamIcon} size={14} />
                <span className="app-header-label">Team</span>
              </Link>
            </nav>
          </>
        )}
        <div className="app-account">
          <ThemeToggle />
          {user && (
            <>
              {user.avatarUrl && <img className="app-avatar" src={user.avatarUrl} alt={user.login} title={user.login} width="28" height="28" />}
              <button type="button" className="button button-quiet button-sm" onClick={signOut} disabled={endSession.isPending}>
                <Icon icon={SignOutIcon} size={14} />
                <span className="app-header-label">Sign out</span>
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function Frame({
  children,
  user,
  organization,
  workspaces,
}: {
  children: ReactNode;
  user?: SessionUser;
  organization?: SessionOrganization | null;
  workspaces?: SessionOrganization[];
}) {
  return (
    <div className="site app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <AppHeader user={user} organization={organization} workspaces={workspaces} />
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
      <section className="app-signin panel" aria-labelledby="signin-title">
        <img className="app-signin-mark" src={ICON_MARK} alt="" width="288" height="270" decoding="async" />
        <h1 id="signin-title" className="display">Sign in to ScopeCI</h1>
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
          <a className="button button-primary button-lg app-signin-button" href={signInHref(next)} data-testid="button-sign-in">
            <SiGithub size={16} aria-hidden="true" />
            Sign in with GitHub
          </a>
        ) : (
          !problem && <p className="try-notice">Sign-in isn't switched on for this server yet.</p>
        )}
        <ol className="app-signin-steps">
          <li>Signing in for the first time creates your workspace.</li>
          <li>Add a project, its statement of work and its repository.</li>
          <li>Every pull request on it gets a scope check.</li>
        </ol>
        <p className="try-help">
          Rather look first?{' '}
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
  const { user, organization, workspaces, signInAvailable } = session.data;
  if (!user) return <SignIn available={signInAvailable} />;

  return (
    <Frame user={user} organization={organization} workspaces={workspaces}>
      <Switch>
        <Route path="/" component={ProjectsHome} />
        <Route path="/projects/new" component={NewProject} />
        <Route path="/projects/:projectId" component={ProjectPage} />
        <Route path="/team" component={TeamPage} />
        <Route path="/invite/:token" component={InvitePage} />
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
    <p className="project-status">
      <span className={`chip ${project.scopeVersion ? 'is-ok' : 'is-warn'}`}>
        {project.scopeVersion ? `Scope ${project.scopeVersion}` : 'Scope not confirmed'}
      </span>
      <span className="chip">
        <SiGithub size={11} aria-hidden="true" />
        <span className="mono">{project.repository ? project.repository.fullName : 'No repository'}</span>
      </span>
      {checked > 0 && <span className="chip">{checked} checked</span>}
      {changeOrders > 0 && (
        <span className="chip is-alert">
          {changeOrders} need{changeOrders === 1 ? 's' : ''} a change order
        </span>
      )}
      {decisions > 0 && <span className="chip is-warn">{decisions} to decide</span>}
      {changeOrdersSent > 0 && <span className="chip">{changeOrdersSent} sent</span>}
      {changeOrdersApproved > 0 && (
        <span className="chip is-ok">
          {changeOrdersApproved} approved{approvedValue > 0 ? ` · ${money(approvedValue)}` : ''}
        </span>
      )}
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
          <h1 className="display">Projects</h1>
          <p className="try-lede">One project per client engagement: its scope, its repository and every pull request checked.</p>
        </div>
        <Link href="/projects/new" className="button button-primary" data-testid="button-new-project">
          <Icon icon={PlusIcon} size={16} />
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
          <h2 className="display">Set up your first project</h2>
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
                <span className="project-card-top">
                  <span className="project-card-name">{project.name}</span>
                  <Icon icon={ArrowRightIcon} size={16} />
                </span>
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
        <Icon icon={ArrowLeftIcon} size={14} /> Projects
      </Link>
      <header className="app-page-head">
        <h1 className="display">New project</h1>
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
          <Icon icon={ArrowRightIcon} size={16} />
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
        <Icon icon={ArrowLeftIcon} size={14} /> Projects
      </Link>
      <header className="app-page-head">
        <div>
          <h1 className="display">{project.name}</h1>
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
      {step !== undefined && (
        <span className={`step-num mono ${done ? 'is-done' : ''}`}>
          {done ? (
            <>
              <Icon icon={TickIcon} size={13} strokeWidth={2} />
              <span className="sr-only">Done</span>
            </>
          ) : (
            step
          )}
        </span>
      )}
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
            <Icon icon={ArrowRightIcon} size={16} />
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
                    {repo.private && (
                      <>
                        <Icon icon={LockIcon} size={13} />
                        <span className="sr-only">private</span>
                      </>
                    )}
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
          <Icon icon={ExternalIcon} size={13} />
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

/* ------------------------------------------------------------------ */
/* Team                                                                */
/* ------------------------------------------------------------------ */

function TeamPage() {
  usePageMeta('Team — ScopeCI', 'Who is in this ScopeCI workspace.');
  const queryClient = useQueryClient();
  const workspace = useGetWorkspace({ query: { queryKey: getGetWorkspaceQueryKey() } });
  const rename = useUpdateWorkspace();
  const createInvite = useCreateInvite();
  const revoke = useRevokeInvite();
  const remove = useRemoveMember();
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (workspace.data) setName(workspace.data.name);
  }, [workspace.data?.name]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() });
  };
  const fail = (fallback: string) => (err: unknown) => setError(errorMessage(err, fallback));

  if (workspace.isPending) return <p className="app-loading">Loading…</p>;
  if (workspace.isError || !workspace.data) {
    return (
      <p className="form-error" role="alert">
        {errorMessage(workspace.error, "We couldn't load the team.")}
      </p>
    );
  }
  const team = workspace.data;
  const owner = team.role === 'OWNER';

  const submitName = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setError('Give the workspace a name.');
    setError('');
    rename.mutate({ data: { name: name.trim().slice(0, 120) } }, { onSuccess: () => { setStatus('Saved.'); refresh(); }, onError: fail("We couldn't rename it.") });
  };

  const invite = () =>
    createInvite.mutate(undefined, {
      onSuccess: (created) => {
        setLink(created.url);
        setCopied(false);
        setError('');
        refresh();
      },
      onError: fail("We couldn't make an invite."),
    });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <Link href="/" className="app-back">
        <Icon icon={ArrowLeftIcon} size={14} /> Projects
      </Link>
      <header className="app-page-head">
        <div>
          <h1 className="display">Team</h1>
          <p className="try-lede">Everyone here sees and works on all of {team.name}'s projects.</p>
        </div>
      </header>

      {owner && (
        <section className="try-step" aria-labelledby="workspace-title">
          <SectionHead title="Workspace name" id="workspace-title" />
          <form onSubmit={submitName} onChange={() => setStatus('')}>
            <div className="try-inline app-name-row">
              <label className="sr-only" htmlFor="workspace-name">
                Workspace name
              </label>
              <input id="workspace-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
              <button type="submit" className="button button-quiet" disabled={rename.isPending}>
                Save
              </button>
            </div>
            {status && (
              <p className="try-help" role="status">
                {status}
              </p>
            )}
          </form>
        </section>
      )}

      <section className="try-step" aria-labelledby="members-title">
        <SectionHead title="Members" id="members-title" />
        <ul className="member-list">
          {team.members.map((member) => (
            <li key={member.userId} className="member-row" data-testid="member-row">
              {member.avatarUrl && <img src={member.avatarUrl} alt="" width="28" height="28" />}
              <span className="member-name">
                <strong>{member.name ?? member.login}</strong>
                <span className="mono">
                  @{member.login} · {member.role === 'OWNER' ? 'owner' : 'member'}
                  {member.you ? ' · you' : ''}
                </span>
              </span>
              {owner && !member.you && (
                <button
                  type="button"
                  className="try-link app-archive"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (!window.confirm(`Remove ${member.login} from ${team.name}?`)) return;
                    remove.mutate({ userId: member.userId }, { onSuccess: refresh, onError: fail("We couldn't remove them.") });
                  }}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {owner && (
        <section className="try-step" aria-labelledby="invite-title">
          <SectionHead title="Invite someone" id="invite-title" />
          <p className="try-help">
            Make a link and send it to them. It works once, for seven days, and they sign in with their own GitHub
            account.
          </p>
          {link ? (
            <div className="invite-link">
              <label className="sr-only" htmlFor="invite-url">
                Invite link
              </label>
              <div className="try-inline">
                <input id="invite-url" className="mono" readOnly value={link} onFocus={(e) => e.target.select()} />
                <button type="button" className="button button-quiet" onClick={copy}>
                  <Icon icon={CopyIcon} size={14} />
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="try-help">This link is only shown now. Make another one if it gets lost.</p>
            </div>
          ) : null}
          <div className="app-actions">
            <button type="button" className="button button-primary" onClick={invite} disabled={createInvite.isPending}>
              {link ? 'Make another link' : 'Make an invite link'}
            </button>
          </div>
          {team.invites.length > 0 && (
            <ul className="member-list invite-list">
              {team.invites.map((open) => (
                <li key={open.id} className="member-row">
                  <span className="member-name">
                    <strong>Open invite</strong>
                    <span className="mono">
                      made {relativeTime(open.createdAt)}
                      {open.createdBy ? ` by @${open.createdBy}` : ''} · expires{' '}
                      {new Date(open.expiresAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="try-link app-archive"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate({ inviteId: open.id }, { onSuccess: refresh, onError: fail("We couldn't cancel it.") })}
                  >
                    Cancel
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function InvitePage() {
  usePageMeta('Join a workspace — ScopeCI', 'Accept an invite to a ScopeCI workspace.');
  const { token = '' } = useParams<{ token: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const invite = useGetInvite(token, { query: { queryKey: getGetInviteQueryKey(token), retry: false } });
  const accept = useAcceptInvite();
  const [error, setError] = useState('');

  const join = () =>
    accept.mutate(
      { token },
      {
        onSuccess: () => {
          queryClient.invalidateQueries();
          navigate('/');
        },
        onError: (err) => setError(errorMessage(err, "We couldn't add you to the workspace.")),
      },
    );

  if (invite.isPending) return <p className="app-loading">Checking the invite…</p>;
  if (invite.isError || !invite.data) {
    return (
      <section className="app-signin panel">
        <h1 className="display">This invite doesn't work</h1>
        <p className="try-lede">{errorMessage(invite.error, 'The link may be wrong.')}</p>
        <p className="try-help">
          <Link href="/" className="try-link">
            Go to your projects
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section className="app-signin panel" aria-labelledby="invite-heading">
      <h1 id="invite-heading" className="display">Join {invite.data.workspaceName}</h1>
      <p className="try-lede">
        {invite.data.invitedBy ? `@${invite.data.invitedBy} invited you` : 'You were invited'} to work on{' '}
        {invite.data.workspaceName}'s projects in ScopeCI.
        {invite.data.alreadyMember && " You're already a member; joining switches you to it."}
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button type="button" className="button button-primary" onClick={join} disabled={accept.isPending} data-testid="button-join">
        {accept.isPending ? 'Joining…' : `Join ${invite.data.workspaceName}`}
        <Icon icon={ArrowRightIcon} size={16} />
      </button>
    </section>
  );
}
