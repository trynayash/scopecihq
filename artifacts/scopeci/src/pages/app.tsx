import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Route, Switch, useLocation, useParams } from 'wouter';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import * as Dialog from '@radix-ui/react-dialog';
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
  useRecheckProject,
  useChangeMemberRole,
  useListArchivedProjects,
  useRestoreProject,
  getListArchivedProjectsQueryKey,
  useAcceptPullRequest,
  useWithdrawPullRequestAcceptance,
  useListProjects,
  useParseDemoSow,
  useSaveProjectScope,
  useUnlinkProjectRepository,
  useUpdateChangeOrder,
  useUpdateProject,
  type ChangedFile,
  type DemoScopeClause,
  type PolicyMode,
  type Project,
  type PullRequestResult,
  type SavedScope,
  type SessionOrganization,
  type SessionUser,
  type TrackedChangeOrder,
  setWorkspaceHeader,
} from '@workspace/api-client-react';
import {
  BASE,
  CONTACT_PATH,
  ICON_MARK,
  Logo,
  PRIVACY_PATH,
  SECURITY_PATH,
  TERMS_PATH,
  TRY_PATH,
  ThemeToggle,
  usePageMeta,
} from '../site';
import { useConfirm } from '../components/confirm-dialog';
import { Loading } from '../components/loading';
import { LoadError, StaleNotice } from '../components/load-error';
import { CopyButton } from '../components/copy-button';
import { useIndicator } from '../motion';
import { useUnsavedChanges } from '../unsaved';
import { ChangeOrderBox, ScopeEditor, changeOrderText, errorMessage, itemCount, verdictOf } from '../scope-ui';
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  ContractIcon,
  CrossIcon,
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

/** How long a trip to GitHub to install the App may take before it's forgotten. */
const RETURN_TTL_MS = 30 * 60 * 1000;

function remember(path: string) {
  try {
    sessionStorage.setItem(RETURN_KEY, JSON.stringify({ path, at: Date.now() }));
  } catch {
    // private mode: the person lands on the project list instead
  }
}

/** The page to go back to after installing the App, once, if the trip was recent. */
function recall(): string | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(RETURN_KEY) ?? 'null') as { path?: string; at?: number } | null;
    sessionStorage.removeItem(RETURN_KEY);
    return stored?.path && stored.at && Date.now() - stored.at < RETURN_TTL_MS ? stored.path : null;
  } catch {
    return null;
  }
}

/** Drops the stored trip when the person got back to that page some other way. */
function forget(path: string) {
  try {
    const stored = JSON.parse(sessionStorage.getItem(RETURN_KEY) ?? 'null') as { path?: string } | null;
    if (stored?.path === path) sessionStorage.removeItem(RETURN_KEY);
  } catch {
    // nothing stored
  }
}

/**
 * After moving to another workspace (switching, leaving or joining), drop
 * everything cached from the old one, so pages show Loading rather than its
 * projects for a moment. The session is only refreshed: it holds the sign-in.
 */
function startFreshWorkspace(queryClient: QueryClient) {
  const sessionKey = JSON.stringify(getGetSessionQueryKey());
  queryClient.resetQueries({ predicate: (query) => JSON.stringify(query.queryKey) !== sessionKey });
  queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() });
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
  const [error, setError] = useState('');
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
                setError('');
                // Everything on screen belonged to the other workspace.
                startFreshWorkspace(queryClient);
                navigate('/');
              },
              onError: (err) => setError(errorMessage(err, "Couldn't switch workspace.")),
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
      {error && (
        <span className="app-header-error" role="alert">
          {error}
        </span>
      )}
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
  const navRef = useIndicator<HTMLElement>('.is-active', onProjects ? 'projects' : location);
  const [signOutError, setSignOutError] = useState('');
  // Only a sign-out the server confirmed reloads; otherwise the cookie is
  // still good and reloading would just sign them straight back in.
  const signOut = () =>
    endSession.mutate(undefined, {
      onSuccess: () => {
        queryClient.clear();
        window.location.assign(APP_HOME);
      },
      onError: () => setSignOutError("Couldn't sign out. Check your connection and try again."),
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
            <nav className="app-nav" aria-label="App" ref={navRef}>
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
              {signOutError && (
                <span className="app-header-error" role="alert">
                  {signOutError}
                </span>
              )}
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
      <footer className="app-foot">
        <div className="container app-inner">
          <span>ScopeCI · Early access</span>
          <nav aria-label="Legal">
            <a href={TERMS_PATH}>Terms</a>
            <a href={PRIVACY_PATH}>Privacy</a>
            <a href={SECURITY_PATH}>Security</a>
            <a href={CONTACT_PATH}>Contact</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

const SIGN_IN_PROBLEMS: Record<string, string> = {
  cancelled: 'Sign-in was cancelled on GitHub.',
  expired: 'That sign-in link expired. Try again.',
  failed: "GitHub sign-in didn't complete. Try again in a moment.",
  unavailable: "Sign-in isn't switched on for this server yet.",
  busy: 'Too many sign-ins from your network just now. Wait a minute and try again.',
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
        <p className="page-lede">
          Use your GitHub account. ScopeCI uses it to see who you are and which repositories you've given the ScopeCI
          app access to.
        </p>
        {problem && (
          <p className="notice is-warning" role="alert">
            {problem}
          </p>
        )}
        {available ? (
          <a className="button button-primary button-lg app-signin-button" href={signInHref(next)} data-testid="button-sign-in">
            <SiGithub size={16} aria-hidden="true" />
            Sign in with GitHub
          </a>
        ) : (
          !problem && <p className="notice">Sign-in isn't switched on for this server yet.</p>
        )}
        {available && (
          <p className="app-signin-legal">
            By signing in you agree to the{' '}
            <a className="text-link" href={TERMS_PATH}>
              Terms of Service
            </a>{' '}
            and the{' '}
            <a className="text-link" href={PRIVACY_PATH}>
              Privacy Policy
            </a>
            .
          </p>
        )}
        <ol className="app-signin-steps">
          <li>Signing in for the first time creates your workspace.</li>
          <li>Add a project, its statement of work and its repository.</li>
          <li>Every pull request on it gets a scope check.</li>
        </ol>
        <p className="help">
          Rather look first?{' '}
          <a className="text-link" href={TRY_PATH}>
            Try it on your SOW
          </a>
        </p>
      </section>
    </Frame>
  );
}

export default function AppPage() {
  const session = useGetSession({ query: { queryKey: getGetSessionQueryKey(), retry: 1, staleTime: 60_000 } });
  // Every write says which workspace this page shows, so one made after a
  // switch in another tab is refused rather than landing in the other workspace.
  const shownWorkspace = session.data?.organization?.id ?? null;
  useEffect(() => {
    setWorkspaceHeader(shownWorkspace);
  }, [shownWorkspace]);

  if (session.isPending) {
    return (
      <Frame>
        <Loading>Checking your session…</Loading>
      </Frame>
    );
  }
  // Only a session never loaded is an error page. A refresh that fails later
  // keeps the one already shown, so a passing blip doesn't replace the page
  // and whatever was being typed on it.
  if (!session.data) {
    return (
      <Frame>
        <LoadError
          error={session.error}
          fallback="We couldn't load your account."
          onRetry={() => session.refetch()}
          retrying={session.isFetching}
        />
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

/**
 * Two quiet lines rather than a row of badges: what the project is tied to
 * (its scope version and repository), then what has happened on it. Only
 * the counts that ask for something are in colour.
 */
function ProjectStatus({ project }: { project: Project }) {
  const { checked, changeOrders, decisions, changeOrdersSent, changeOrdersApproved, approvedValue } = project.counts;
  return (
    <div className="project-status">
      <p className="project-meta">
        <span className={project.scopeVersion ? undefined : 'is-warn'}>
          <Icon icon={ContractIcon} size={14} />
          {project.scopeVersion ? `Scope ${project.scopeVersion}` : 'Scope not confirmed'}
        </span>
        <span className={project.repository ? undefined : 'is-faint'}>
          <SiGithub size={13} aria-hidden="true" />
          <span className="mono">{project.repository ? project.repository.fullName : 'No repository'}</span>
        </span>
      </p>
      {checked > 0 && (
        <p className="project-counts">
          <span>
            <strong className="num">{checked}</strong> checked
          </span>
          {changeOrders > 0 && (
            <span className="is-alert">
              <strong className="num">{changeOrders}</strong> need{changeOrders === 1 ? 's' : ''} a change order
            </span>
          )}
          {decisions > 0 && (
            <span className="is-warn">
              <strong className="num">{decisions}</strong> to decide
            </span>
          )}
          {changeOrdersSent > 0 && (
            <span>
              <strong className="num">{changeOrdersSent}</strong> sent
            </span>
          )}
          {changeOrdersApproved > 0 && (
            <span className="is-ok">
              <strong className="num">{changeOrdersApproved}</strong> approved
              {approvedValue > 0 && <span className="num"> · {money(approvedValue)}</span>}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

function ProjectsHome() {
  usePageMeta('Projects — ScopeCI', 'Your ScopeCI projects.');
  const [, navigate] = useLocation();
  const projects = useListProjects();

  // Back from installing the GitHub App: return to the project that sent us.
  useEffect(() => {
    // "#connect" reopens the repository list there, so they can pick the
    // repository they just gave the App access to.
    const back = recall();
    if (back && back.startsWith('/projects/')) navigate(`${back}#connect`);
  }, [navigate]);

  return (
    <>
      <header className="app-page-head">
        <div>
          <h1 className="display">Projects</h1>
          <p className="page-lede">One project per client engagement: its scope, its repository and every pull request checked.</p>
        </div>
        <Link href="/projects/new" className="button button-primary" data-testid="button-new-project">
          <Icon icon={PlusIcon} size={16} />
          New project
        </Link>
      </header>

      {projects.isPending && <Loading>Loading projects…</Loading>}
      {projects.isError && !projects.data && (
        <LoadError
          error={projects.error}
          fallback="We couldn't load your projects."
          onRetry={() => projects.refetch()}
          retrying={projects.isFetching}
        />
      )}
      {projects.isError && projects.data && (
        <StaleNotice error={projects.error} what="your projects" onRetry={() => projects.refetch()} retrying={projects.isFetching} />
      )}
      {projects.data && projects.data.projects.length === 0 && (
        <section className="panel app-onboarding">
          <h2 className="display">Set up your first project</h2>
          <ol className="app-steps">
            <li>Create a project for one client engagement.</li>
            <li>Paste its statement of work and confirm what's included and excluded.</li>
            <li>Connect the GitHub repository the work happens in.</li>
          </ol>
          <p className="help">From then on, every pull request gets a check and a comment, and work the SOW excludes comes with a change order draft.</p>
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
      {projects.data && <ArchivedProjects />}
    </>
  );
}

/**
 * Archived projects, folded away under the list until asked for. Restoring
 * brings back the scope, results and change orders; the repository has to be
 * connected again, since archiving released it.
 */
function ArchivedProjects() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const archived = useListArchivedProjects({ query: { queryKey: getListArchivedProjectsQueryKey(), enabled: open } });
  const restore = useRestoreProject();
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  // A restored project leaves this list; focus goes back to its toggle.
  const toggleRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="archived">
      <button type="button" className="text-link" aria-expanded={open} onClick={() => setOpen((o) => !o)} ref={toggleRef}>
        {open ? 'Hide archived projects' : 'Archived projects'}
      </button>
      {open && archived.isPending && <Loading>Loading archived projects…</Loading>}
      {open && archived.isError && !archived.data && (
        <LoadError error={archived.error} fallback="We couldn't load the archived projects." onRetry={() => archived.refetch()} retrying={archived.isFetching} />
      )}
      {open && archived.isError && archived.data && (
        <StaleNotice error={archived.error} what="the archived projects" onRetry={() => archived.refetch()} retrying={archived.isFetching} />
      )}
      {open && archived.data && archived.data.projects.length === 0 && <p className="help">Nothing archived.</p>}
      {open && archived.data && archived.data.projects.length > 0 && (
        <ul className="archived-list">
          {archived.data.projects.map((project) => (
            <li key={project.id}>
              <span>
                <strong>{project.name}</strong>
                {project.clientName && <span className="archived-client"> · {project.clientName}</span>}
              </span>
              <button
                type="button"
                className="button button-quiet button-sm"
                aria-disabled={restore.isPending}
                aria-label={`Restore ${project.name}`}
                onClick={() =>
                  !restore.isPending &&
                  restore.mutate(
                    { projectId: project.id },
                    {
                      onSuccess: () => {
                        setError('');
                        setStatus(`${project.name} is back. Connect its repository again to check pull requests.`);
                        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
                        queryClient.invalidateQueries({ queryKey: getListArchivedProjectsQueryKey() });
                        toggleRef.current?.focus();
                      },
                      onError: (err) => setError(errorMessage(err, "We couldn't restore it.")),
                    },
                  )
                }
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="app-status" role="status">
        {status}
      </p>
    </div>
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
      <form className="panel app-form" onSubmit={submit}>
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
  const detail = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId) } });
  usePageMeta(`${detail.data?.project.name ?? 'Project'} — ScopeCI`, 'A ScopeCI project.');

  if (detail.isPending) return <Loading>Loading project…</Loading>;
  // Not found is an answer, even for a page already showing (a teammate
  // archived it); anything else may pass, so it can be asked again.
  if ((detail.error as { status?: number } | null)?.status === 404) {
    return (
      <p className="app-empty">
        No such project in this workspace. It may have been archived, or it belongs to another workspace.{' '}
        <Link href="/">Back to your projects</Link>
      </p>
    );
  }
  if (!detail.data) {
    return (
      <LoadError
        error={detail.error}
        fallback="We couldn't load this project."
        onRetry={() => detail.refetch()}
        retrying={detail.isFetching}
      />
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
      {/* A refresh that failed keeps the page, and any unsaved edits on it. */}
      {detail.isError && (
        <StaleNotice
          error={detail.error}
          what="this project"
          onRetry={() => detail.refetch()}
          retrying={detail.isFetching}
        />
      )}
      <ScopeSection project={project} scope={scope} />
      <RepositorySection project={project} />
      <PullRequestsSection project={project} />
      <SettingsSection project={project} />
    </>
  );
}

function SectionHead({
  step,
  title,
  done,
  id,
  focusable = false,
}: {
  step?: number;
  title: string;
  done?: boolean;
  id: string;
  /** Can take focus from code, for when the control that had it is gone. */
  focusable?: boolean;
}) {
  return (
    <div className="panel-head">
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
      <h2 id={id} tabIndex={focusable ? -1 : undefined}>
        {title}
      </h2>
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
  // The SOW's own title; empty means the project's name, read when saving.
  const [title, setTitle] = useState(scope?.title ?? '');
  const [draft, setDraft] = useState<DemoScopeClause[] | null>(scope?.clauses ?? null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  // What reading the document couldn't take in (sections past the limit),
  // shown above the lists so a partial read is never mistaken for the whole.
  const [warnings, setWarnings] = useState<string[]>([]);

  // A newly saved version replaces the draft. Only that: renaming the
  // project (here or by a teammate) must not throw away unsaved edits.
  useEffect(() => {
    setDraft(scope?.clauses ?? null);
    setTitle(scope?.title ?? '');
    setPasting(!scope);
  }, [scope]);

  const dirty = useMemo(
    () => draft !== null && JSON.stringify(draft) !== JSON.stringify(scope?.clauses ?? null),
    [draft, scope],
  );

  // Leaving the page (a link, the tab, a reload) with unsaved scope edits asks first.
  useUnsavedChanges(dirty);

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
          setTitle(parsed.title || '');
          setPasting(false);
          setMessage('');
          setWarnings(parsed.warnings ?? []);
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
      { projectId: project.id, data: { title: (title || project.name).slice(0, 200), clauses: draft } },
      {
        onSuccess: (saved) => {
          setMessage(
            project.repository
              ? `Saved as ${saved.version}. Open pull requests are being checked against it now.`
              : `Saved as ${saved.version}. Pull requests are checked against it once a repository is connected.`,
          );
          queryClient.invalidateQueries({ queryKey: getListProjectPullRequestsQueryKey(project.id) });
          queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(project.id) });
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        },
        onError: (err) => setError(errorMessage(err, "We couldn't save the scope.")),
      },
    );
  };

  return (
    <section className="panel" aria-labelledby="scope-title">
      <SectionHead step={1} title="Scope" done={Boolean(scope)} id="scope-title" />
      {scope && !dirty && !pasting && (
        <p className="help">
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
            className="textarea mono"
            rows={12}
            maxLength={40_000}
            value={sow}
            placeholder="Paste the statement of work: Markdown or text copied from a PDF."
            onChange={(e) => setSow(e.target.value)}
          />
          <p className="help">
            ScopeCI reads what each section includes and excludes. You check that list before anything is saved.{' '}
            {!scope && !draft && (
              <button type="button" className="text-link" onClick={startEmpty}>
                No document? Start with an empty list
              </button>
            )}
            {(scope || draft) && (
              <button type="button" className="text-link" onClick={() => setPasting(false)}>
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
            {dirty &&
              warnings.map((warning) => (
                <p key={warning} className="notice is-warning">
                  {warning}
                </p>
              ))}
            {itemCount(draft) === 0 && (
              <p className="notice">
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
            <p className="app-status" role="status">
              {message && !dirty ? message : ''}
            </p>
            <div className="app-actions">
              {(dirty || !scope) && (
                <button type="button" className="button button-primary" onClick={submit} disabled={save.isPending}>
                  {save.isPending ? 'Saving…' : scope ? 'Save as a new version' : 'Save this scope'}
                </button>
              )}
              {dirty && scope && (
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => {
                    // Back to the saved version entirely: a title read from a new
                    // SOW would otherwise rename the contract on the next save.
                    setDraft(scope.clauses);
                    setTitle(scope.title ?? '');
                    setWarnings([]);
                  }}
                >
                  Discard changes
                </button>
              )}
              <button type="button" className="text-link" onClick={() => setPasting(true)}>
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
  const [confirm, confirmDialog] = useConfirm();
  // Back from installing the App on GitHub: open the list straight away.
  const [choosing, setChoosing] = useState(() => typeof window !== 'undefined' && window.location.hash === '#connect');
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  useEffect(() => {
    forget(`/projects/${project.id}`);
    if (window.location.hash === '#connect') history.replaceState(history.state, '', window.location.pathname + window.location.search);
  }, [project.id]);
  const repos = useListGitHubRepositories({
    query: { queryKey: getListGitHubRepositoriesQueryKey(), enabled: choosing, retry: false, staleTime: 0 },
  });
  const link = useLinkProjectRepository();
  const unlink = useUnlinkProjectRepository();
  // Set when connecting found GitHub access expired; the list may still be on screen.
  const [expired, setExpired] = useState(false);

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
          if (project.scopeVersion) {
            setStatus('Connected. Its open pull requests are being checked now.');
            // Their results arrive over the next few seconds.
            window.setTimeout(() => queryClient.invalidateQueries({ queryKey: getListProjectPullRequestsQueryKey(project.id) }), 4000);
          }
        },
        onError: (err) => {
          const status = (err as { status?: number } | null)?.status;
          // GitHub access ran out since the list loaded: offer to sign in again.
          if (status === 401) {
            setExpired(true);
            return;
          }
          setError(errorMessage(err, "We couldn't connect that repository."));
          // Taken by another project meanwhile: refresh the list so it says which.
          if (status === 409) queryClient.invalidateQueries({ queryKey: getListGitHubRepositoriesQueryKey() });
        },
      },
    );
  };

  const disconnect = async () => {
    const ok = await confirm({
      title: `Disconnect ${project.repository?.fullName}?`,
      description: 'Pull requests there stop being checked. Results so far stay on this page.',
      confirmLabel: 'Disconnect',
    });
    if (!ok) return;
    setError('');
    setStatus('');
    unlink.mutate(
      { projectId: project.id },
      {
        onSuccess: () => {
          refresh();
          // The Disconnect button goes with the repository; focus stays in this section.
          document.getElementById('repo-title')?.focus();
        },
        onError: (err) => setError(errorMessage(err, "We couldn't disconnect it.")),
      },
    );
  };

  const reauth = expired || (repos.error as { status?: number } | null)?.status === 401;
  const install = () => remember(`/projects/${project.id}`);

  return (
    <section className="panel" aria-labelledby="repo-title">
      <SectionHead step={2} title="Repository" done={Boolean(project.repository)} id="repo-title" focusable />

      {project.repository ? (
        <>
          <p className="app-repo">
            <SiGithub size={15} aria-hidden="true" />
            <a href={`https://github.com/${project.repository.fullName}`} target="_blank" rel="noreferrer">
              {project.repository.fullName}
            </a>
          </p>
          <p className="help">
            {project.scopeVersion
              ? `Every pull request opened or updated here is checked against scope ${project.scopeVersion}.`
              : 'Pull requests here are checked once the scope above is saved.'}
          </p>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="app-actions">
            <button type="button" className="button button-quiet" onClick={disconnect} disabled={unlink.isPending}>
              Disconnect
            </button>
          </div>
        </>
      ) : !choosing ? (
        <>
          <p className="help">Connect the GitHub repository this engagement's code lives in.</p>
          <div className="app-actions">
            <button type="button" className="button button-primary" onClick={() => setChoosing(true)} data-testid="button-choose-repo">
              Choose a repository
            </button>
          </div>
        </>
      ) : repos.isPending ? (
        <Loading>Asking GitHub which repositories you can connect…</Loading>
      ) : reauth ? (
        <>
          <p className="notice is-warning" role="alert">
            GitHub access expired.{' '}
            <a className="text-link" href={signInHref(`/app/projects/${project.id}`)}>
              Sign in again
            </a>
          </p>
          <div className="app-actions">
            <button type="button" className="text-link" onClick={() => setChoosing(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : repos.isError ? (
        <>
          <p className="form-error" role="alert">
            {errorMessage(repos.error, "We couldn't reach GitHub.")}
          </p>
          <div className="app-actions">
            <button type="button" className="button button-quiet" onClick={() => repos.refetch()} disabled={repos.isFetching}>
              {repos.isFetching ? 'Trying…' : 'Try again'}
            </button>
            <button type="button" className="text-link" onClick={() => setChoosing(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <form onSubmit={connect}>
          {repos.data.repositories.length === 0 ? (
            <p className="notice">
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
          {(repos.data.truncatedAccounts ?? []).map((account) => (
            <p key={account} className="notice">
              Not every repository in {account} is listed. To connect one that's missing, limit the ScopeCI GitHub App
              to selected repositories on GitHub.
            </p>
          ))}
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
            <button type="button" className="text-link" onClick={() => setChoosing(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <p className="app-status" role="status">
        {status}
      </p>
      {confirmDialog}
    </section>
  );
}

/* Pull requests ----------------------------------------------------- */

function changeOrderSummary(tracked: TrackedChangeOrder | null): string {
  if (!tracked || tracked.status === 'DRAFT') return 'Change order not sent yet';
  if (tracked.status === 'SENT') return `${tracked.reference} sent ${relativeTime(tracked.sentAt!)}, waiting on the client`;
  const price = tracked.amount ? `, ${money(tracked.amount)}` : '';
  return tracked.status === 'APPROVED' ? `${tracked.reference} approved${price}` : `${tracked.reference} declined`;
}

const CHANGE_ORDER_TONE: Record<TrackedChangeOrder['status'], string> = {
  DRAFT: '',
  SENT: 'is-warn',
  APPROVED: 'is-ok',
  DECLINED: 'is-alert',
};

/** "Subject: …" on the first line, then the message, as the draft box shows it. */
function splitMessage(text: string): { subject?: string; body: string } {
  const match = text.match(/^Subject: (.*)\r?\n\r?\n([\s\S]*)$/);
  return match ? { subject: match[1].slice(0, 300), body: match[2].slice(0, 10_000) } : { body: text.slice(0, 10_000) };
}

const shortDate = (value: string | Date) =>
  new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/**
 * What a PM needs to read first: the clause and the excluded work it names,
 * or, when nothing was excluded but someone still has to decide, the reason.
 * In-scope results have nothing to pin.
 */
function WhyLine({ pr, tone }: { pr: PullRequestResult; tone: 'alert' | 'warn' | 'ok' }) {
  if (pr.excluded.length > 0) {
    // One line per clause, in the order the items were found.
    const clauses: Array<{ ref: string; title: string; items: string[] }> = [];
    for (const { item, clauseRef, clauseTitle } of pr.excluded) {
      const clause = clauses.find((c) => c.ref === clauseRef);
      if (clause) clause.items.push(item);
      else clauses.push({ ref: clauseRef, title: clauseTitle, items: [item] });
    }
    return (
      <div className={`why is-${tone === 'ok' ? 'neutral' : tone}`}>
        {clauses.map((clause) => (
          <p key={clause.ref}>
            <span className="why-clause">
              <span className="mono">{clause.ref}</span> {clause.title} excludes
            </span>{' '}
            <strong>{clause.items.join(', ')}</strong>
          </p>
        ))}
      </div>
    );
  }
  if (tone === 'ok') return null;
  return (
    <div className={`why is-${tone}`}>
      <p className="why-reason">{pr.reason}</p>
    </div>
  );
}

/** Drafted, sent, answered: where the change order stands, newest step last. */
function ChangeOrderSteps({ pr }: { pr: PullRequestResult }) {
  const tracked = pr.trackedChangeOrder;
  const status = tracked?.status ?? 'DRAFT';
  const sent = status !== 'DRAFT';
  const steps = [
    { label: 'Drafted', state: 'done', note: shortDate(pr.checkedAt) },
    // The client can answer before the PM marks it sent: then the step is
    // past, but no send date was recorded.
    {
      label: 'Sent',
      state: sent ? 'done' : 'next',
      note: tracked?.sentAt ? shortDate(tracked.sentAt) : sent ? 'Not recorded' : 'Not yet',
    },
    status === 'APPROVED'
      ? { label: 'Approved', state: 'done', note: tracked?.decidedAt ? shortDate(tracked.decidedAt) : '' }
      : status === 'DECLINED'
        ? { label: 'Declined', state: 'declined', note: tracked?.decidedAt ? shortDate(tracked.decidedAt) : '' }
        : { label: 'Client’s answer', state: sent ? 'current' : 'next', note: sent ? 'Waiting' : '' },
  ];
  return (
    <ol className="co-steps" aria-label="Change order progress">
      {/* Keyed by position, so a step that changes state keeps its element
          and its track fills rather than reappearing. */}
      {steps.map((step, index) => (
        <li key={index} className={`is-${step.state}`}>
          <strong>
            {step.state === 'done' && <Icon icon={TickIcon} size={13} strokeWidth={2} />}
            {step.label}
          </strong>
          <span>{step.note}</span>
        </li>
      ))}
    </ol>
  );
}

const itemKey = (item: string) => item.trim().toLowerCase();

function ChangeOrderPanel({
  project,
  pr,
  onDirtyChange,
  onBusyChange,
}: {
  project: Project;
  pr: PullRequestResult;
  /** Told whether the letter has edits that aren't saved, so closing can ask first. */
  onDirtyChange: (dirty: boolean) => void;
  /** Told while an update is on its way, so the panel stays open to show how it went. */
  onBusyChange: (busy: boolean) => void;
}) {
  const queryClient = useQueryClient();
  // The lists refresh from here rather than from each mutate() call, so they
  // still refresh if the panel is gone by the time the server answers.
  const update = useUpdateChangeOrder({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectPullRequestsQueryKey(project.id) });
        queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(project.id) });
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
      },
      onError: (err) => {
        // It changed since this page loaded (a push added work, a teammate
        // sent or decided it): show it as it is now, to read before trying again.
        if ((err as { status?: number } | null)?.status === 409) {
          queryClient.invalidateQueries({ queryKey: getListProjectPullRequestsQueryKey(project.id) });
        }
      },
    },
  });
  useEffect(() => {
    onBusyChange(update.isPending);
  }, [update.isPending]);
  const [confirm, confirmDialog] = useConfirm();
  const tracked = pr.trackedChangeOrder;
  const source = tracked ? { subject: tracked.subject, body: tracked.body } : pr.changeOrder;
  const original = changeOrderText(source);
  const [text, setText] = useState(original);
  const [hours, setHours] = useState(tracked?.hours ? String(tracked.hours) : '');
  const [error, setError] = useState('');
  // Said aloud after each action, since the button pressed may be gone.
  const [status, setStatus] = useState('');
  const edited = text !== original;
  // A newer draft from the server replaces the letter only if the PM hasn't
  // changed it; their edits are never overwritten.
  const shownOriginal = useRef(original);
  useEffect(() => {
    if (text === shownOriginal.current) setText(original);
    shownOriginal.current = original;
  }, [original]);

  const decided = tracked?.status === 'APPROVED' || tracked?.status === 'DECLINED';
  const sent = tracked?.status === 'SENT';

  // The work the client is asked to approve. Until something is saved there
  // is no change order yet: the server says what one would list (the
  // excluded work no decided change order already listed).
  const items = tracked ? tracked.items : pr.newItems;
  // Sent with Mark as sent and Client approved, so the server refuses if the
  // change order lists other work by then. Results from before items were
  // recorded list none here, and then there is nothing to compare.
  const seen = tracked || items.length > 0 ? items : undefined;
  // An edited letter keeps its wording when work is added; it should still
  // name everything the client approves.
  const unnamed = !sent && !decided ? items.filter((item) => !text.toLowerCase().includes(itemKey(item))) : [];

  // Unsaved edits to the letter: closing the panel, or leaving the page, asks first.
  const unsaved = edited && !sent && !decided;
  useUnsavedChanges(unsaved);
  useEffect(() => {
    onDirtyChange(unsaved);
    if (!unsaved) return;
    return () => onDirtyChange(false);
  }, [unsaved]);

  const approveRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // The button just pressed may go away (Mark as sent, Save draft); focus
  // moves to what comes next rather than falling to the page.
  const focusNext = (to: 'approve' | 'letter' | undefined) =>
    requestAnimationFrame(() => {
      if (to === 'approve') approveRef.current?.focus();
      if (to === 'letter') bodyRef.current?.querySelector('textarea')?.focus();
    });
  const save = (
    data: { hours?: number | null; status?: 'SENT' | 'APPROVED' | 'DECLINED'; subject?: string; body?: string; items?: string[] },
    done: string | ((saved: TrackedChangeOrder) => string),
    then?: 'approve' | 'letter',
  ) =>
    update.mutate(
      { projectId: project.id, data: { evaluationId: pr.evaluationId, ...data } },
      {
        onSuccess: (saved) => {
          setError('');
          setStatus(typeof done === 'string' ? done : done(saved));
          focusNext(then);
        },
        onError: (err) => {
          setStatus('');
          setError(errorMessage(err, "We couldn't update the change order."));
        },
      },
    );

  const price = (event: FormEvent) => {
    event.preventDefault();
    const value = hours.trim() === '' ? null : Math.min(10_000, Math.max(0, Math.round(Number(hours))));
    // An edited letter is sent along, so the server keeps it rather than
    // redrawing it with the new price.
    if (edited && !sent) save({ hours: value, ...splitMessage(text) }, 'Hours saved. Your edited letter was kept; update the price in it if it mentions one.');
    else
      save({ hours: value }, (saved) =>
        sent
          ? 'Hours saved.'
          : // A letter saved with edits earlier is the PM's: the server keeps it.
            changeOrderText(saved) === original
            ? 'Hours saved. Your saved letter was kept; update the price in it if it mentions one.'
            : 'Hours saved and the letter updated.',
      );
  };

  const reference = tracked?.reference ?? 'this change order';
  const approve = async () => {
    const ok = await confirm({
      title: `Record that the client approved ${reference}?`,
      description:
        'The work it lists is then covered on this and later pull requests, and their GitHub checks update now. A decision can\'t be changed afterwards.',
      confirmLabel: 'Client approved',
    });
    if (ok) save({ status: 'APPROVED', items: seen }, 'Recorded as approved. The GitHub checks are updating.');
  };
  const decline = async () => {
    const ok = await confirm({
      title: `Record that the client declined ${reference}?`,
      description: 'The work stays flagged wherever it appears. A decision can\'t be changed afterwards.',
      confirmLabel: 'Client declined',
      danger: true,
    });
    if (ok) save({ status: 'DECLINED' }, 'Recorded as declined.');
  };

  return (
    <>
      <header className="drawer-head">
        <div>
          <Dialog.Title className="drawer-title">
            Change order{tracked && <span className="mono"> {tracked.reference}</span>}
          </Dialog.Title>
          <Dialog.Description className="drawer-sub">
            For{' '}
            <a href={pr.url} target="_blank" rel="noreferrer">
              #{pr.number} {pr.title}
              <Icon icon={ExternalIcon} size={12} />
            </a>
          </Dialog.Description>
        </div>
        <Dialog.Close className="icon-button" aria-label="Close the change order" disabled={update.isPending}>
          <Icon icon={CrossIcon} size={18} />
        </Dialog.Close>
      </header>

      <div className="drawer-body" ref={bodyRef}>
        <ChangeOrderSteps pr={pr} />
        <WhyLine pr={pr} tone={verdictOf(pr.verdict).tone} />
        {items.length > 0 && (
          <p className="co-items" data-testid="change-order-items">
            <span className="co-items-label">Covers</span>{' '}
            <strong>{items.join(', ')}</strong>
          </p>
        )}
        {pr.previousChangeOrder && (
          <p className="notice">
            {pr.previousChangeOrder.reference} was {pr.previousChangeOrder.status === 'APPROVED' ? 'approved' : 'declined'} for{' '}
            {pr.previousChangeOrder.items.join(', ')}. This one is for the work added since.
          </p>
        )}
        {!decided && pr.verdict !== 'CHANGE_REQUIRED' && (
          <p className="notice">The latest commit no longer builds the excluded work, so this change order may not be needed.</p>
        )}

        {decided ? (
          <p className="help">
            {tracked!.status === 'APPROVED'
              ? 'The client approved it. This work is covered on this and later pull requests.'
              : 'The client declined it. Take the work out of this pull request; while it is there, it stays flagged.'}
          </p>
        ) : (
          <>
            <form className="co-hours" onSubmit={price}>
              <div className="field">
                <label htmlFor="co-hours">
                  Hours{' '}
                  <span className="field-optional">
                    {project.hourlyRate
                      ? `priced at ${money(project.hourlyRate)} an hour`
                      : 'set an hourly rate in settings to show a price'}
                  </span>
                </label>
                <div className="inline-field">
                  <input
                    id="co-hours"
                    type="number"
                    min={0}
                    max={10000}
                    inputMode="numeric"
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                  />
                  <button type="submit" className="button button-quiet" disabled={update.isPending}>
                    Save hours
                  </button>
                </div>
              </div>
            </form>
            {unnamed.length > 0 && (
              <p className="notice is-warning">
                The letter doesn't name {unnamed.join(', ')}. Approving covers everything this change order lists,
                so name it in the letter before sending.
              </p>
            )}
            <ChangeOrderBox
              id="change-order-text"
              text={text}
              onChange={setText}
              readOnlyNote={
                sent && tracked?.sentAt ? `Sent ${shortDate(tracked.sentAt)}. This is the letter the client received.` : undefined
              }
            />
            {!sent && edited && (
              <div className="app-actions">
                <button type="button" className="button button-quiet" disabled={update.isPending} onClick={() => save(splitMessage(text), 'Draft saved.', 'letter')}>
                  Save draft
                </button>
                <button type="button" className="text-link" onClick={() => setText(original)}>
                  Discard edits
                </button>
              </div>
            )}
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <p className="app-status" role="status">
          {status}
        </p>
      </div>

      {!decided && (
        <footer className="drawer-foot">
          {!sent && (
            <button
              type="button"
              className="button button-primary"
              disabled={update.isPending}
              // The letter goes along only if the PM changed it, or nothing is
              // saved yet: otherwise the server's copy is the one shown, and a
              // push may have redrawn it since this page loaded.
              onClick={() =>
                save(
                  { status: 'SENT', items: seen, ...(edited || !tracked ? splitMessage(text) : {}) },
                  'Marked as sent. The letter is kept as sent.',
                  'approve',
                )
              }
            >
              Mark as sent
            </button>
          )}
          <button type="button" className="button button-quiet" disabled={update.isPending} onClick={approve} ref={approveRef}>
            Client approved
          </button>
          <button type="button" className="button button-quiet button-danger" disabled={update.isPending} onClick={decline}>
            Client declined
          </button>
        </footer>
      )}
      {confirmDialog}
    </>
  );
}

/**
 * The change order opens beside the list rather than inside it, so the list
 * stays readable and the PM keeps their place. Radix Dialog keeps focus in
 * the panel and closes on Escape; focus goes back to the row's button, which
 * the list remembers because the panel's own buttons may be gone by then.
 */
function ChangeOrderDrawer({
  project,
  pr,
  onClose,
  returnFocus,
}: {
  project: Project;
  pr: PullRequestResult | null;
  onClose: () => void;
  returnFocus: () => void;
}) {
  // Keep the last pull request while the panel animates closed.
  const last = useRef(pr);
  if (pr) last.current = pr;
  const shown = pr ?? last.current;

  // Escape, a click beside the panel and its close button all come here:
  // an edited letter that isn't saved is only dropped once the PM says so,
  // and while an update is on its way the panel stays to show its outcome.
  const dirty = useRef(false);
  const busy = useRef(false);
  const [confirm, confirmDialog] = useConfirm();
  const requestClose = async () => {
    if (busy.current) return;
    if (dirty.current) {
      const ok = await confirm({
        title: 'Discard your edits to the letter?',
        description: 'The change order keeps its last saved draft. To keep your edits, cancel and save the draft.',
        confirmLabel: 'Discard edits',
        danger: true,
      });
      if (!ok) return;
    }
    dirty.current = false;
    onClose();
  };

  return (
    <Dialog.Root
      open={pr !== null}
      onOpenChange={(open) => {
        if (!open) void requestClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content
          className="drawer"
          data-testid="change-order-drawer"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus();
          }}
        >
          {/* Keyed by pull request (its URL, since a number can repeat after
              the project moves repository), not result: a new push or an approval
              makes a new result, and the open panel keeps its state. A
              follow-up change order (new work after a decision) starts afresh. */}
          {shown && (
            <ChangeOrderPanel
              key={`${shown.url}:${shown.previousChangeOrder?.id ?? ''}`}
              project={project}
              pr={shown}
              onDirtyChange={(value) => {
                dirty.current = value;
              }}
              onBusyChange={(value) => {
                busy.current = value;
              }}
            />
          )}
          {confirmDialog}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const FILE_STATUS: Record<ChangedFile['status'], string> = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R' };

/**
 * The files the check read for this commit, by name and line count. Closed
 * by default; files cited for excluded work come first, in the tone colour.
 */
function ChangedFiles({ pr }: { pr: PullRequestResult }) {
  if (pr.files.length === 0) return null;
  const cited = pr.files.filter((f) => f.excludedItem).length;
  const hidden = pr.fileCount - pr.files.length;
  return (
    <details className="pr-files" data-testid="pr-files">
      <summary>
        <Icon icon={ChevronDownIcon} size={14} />
        {pr.fileCount} changed file{pr.fileCount === 1 ? '' : 's'}
        {cited > 0 && `, ${cited} cited for excluded work`}
      </summary>
      <ul className="pr-file-list">
        {pr.files.map((file) => (
          <li key={file.path} className={file.excludedItem ? 'is-cited' : ''}>
            <span className={`pr-file-status mono is-${file.status}`} aria-hidden="true">
              {FILE_STATUS[file.status]}
            </span>
            <span className="pr-file-name">
              <span className="pr-file-path mono" title={file.path}>
                <span className="sr-only">{file.status}: </span>
                {file.path}
              </span>
              {file.excludedItem && <span className="pr-file-item">{file.excludedItem}</span>}
            </span>
            <span className="pr-file-lines mono num">
              <span className="is-added">+{file.additions}</span> <span className="is-deleted">−{file.deletions}</span>
            </span>
          </li>
        ))}
        {hidden > 0 && <li className="pr-file-more">and {hidden} more</li>}
      </ul>
    </details>
  );
}

/**
 * Letting a flagged pull request through without a change order: the PM says
 * why, and the reason is kept with their name. Later pushes stay accepted
 * unless they add excluded work this didn't cover.
 */
function AcceptDialog({
  project,
  pr,
  onClose,
  returnFocus,
}: {
  project: Project;
  pr: PullRequestResult | null;
  onClose: (done?: string) => void;
  /** Where focus goes once it closes; it has no trigger of its own to return to. */
  returnFocus: () => void;
}) {
  const queryClient = useQueryClient();
  const accept = useAcceptPullRequest();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  // Each opening starts empty: a reason typed for one pull request and then
  // cancelled, or last time's error, must not turn up on the next. A new
  // result for the same pull request (a refresh after "out of date") keeps
  // what was typed.
  const [openedFor, setOpenedFor] = useState(pr?.url ?? null);
  // The result the PM was shown. If the pull request is checked again while
  // this is open, the change is pointed out before it can be accepted.
  const [confirmed, setConfirmed] = useState<string | null>(pr?.evaluationId ?? null);
  if ((pr?.url ?? null) !== openedFor) {
    setOpenedFor(pr?.url ?? null);
    if (pr) {
      setReason('');
      setError('');
      setConfirmed(pr.evaluationId);
    }
  }
  // Keep the last pull request while the dialog animates closed.
  const last = useRef(pr);
  if (pr) last.current = pr;
  const shown = pr ?? last.current;
  const flaggedWork = shown?.excluded.map((e) => e.item).join(', ');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!shown) return;
    if (!reason.trim()) {
      setError('Say why; the reason is kept with the decision.');
      return;
    }
    if (shown.evaluationId !== confirmed) {
      setConfirmed(shown.evaluationId);
      setError(
        `#${shown.number} was checked again since this opened. It now ${flaggedWork ? `flags ${flaggedWork}` : 'flags no excluded work'}. Check that, then Accept again.`,
      );
      return;
    }
    setError('');
    accept.mutate(
      // The result shown names the pull request: its number alone can repeat
      // once the project has moved to another repository.
      { projectId: project.id, number: shown.number, data: { reason: reason.trim().slice(0, 500), evaluationId: shown.evaluationId } },
      {
        onSuccess: (result) => {
          queryClient.invalidateQueries({ queryKey: getListProjectPullRequestsQueryKey(project.id) });
          queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(project.id) });
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          setReason('');
          onClose(
            result.checkUpdated
              ? `#${shown.number} accepted. Its GitHub check is updated.`
              : `#${shown.number} accepted, but its GitHub check couldn't be updated just now. Re-check open pull requests to update it.`,
          );
        },
        onError: (err) => {
          setError(errorMessage(err, "We couldn't record the acceptance."));
          // A newer result came in since the page loaded: show it in the list.
          if ((err as { status?: number } | null)?.status === 409) {
            queryClient.invalidateQueries({ queryKey: getListProjectPullRequestsQueryKey(project.id) });
          }
        },
      },
    );
  };

  return (
    // It stays open while the acceptance is being recorded, so a failure is
    // seen here rather than lost on a closed dialog.
    <Dialog.Root open={pr !== null} onOpenChange={(open) => !open && !accept.isPending && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog dialog-wide"
          data-testid="accept-dialog"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus();
          }}
        >
          <Dialog.Title className="dialog-title">Accept #{shown?.number} without a change order?</Dialog.Title>
          <Dialog.Description className="dialog-description">
            {flaggedWork
              ? `The work it builds that the scope excludes (${flaggedWork}) goes ahead unbilled. `
              : 'It goes ahead as in scope. '}
            Later pushes stay accepted unless they add other excluded work. You can withdraw this.
          </Dialog.Description>
          <form onSubmit={submit} className="accept-form">
            <div className="field">
              <label htmlFor="accept-reason">Why</label>
              <textarea
                id="accept-reason"
                className="textarea"
                rows={3}
                maxLength={500}
                value={reason}
                placeholder="For example: the client agreed on our call that this is part of checkout."
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <Dialog.Close className="button button-quiet" type="button" disabled={accept.isPending}>
                Cancel
              </Dialog.Close>
              <button type="submit" className="button button-primary" disabled={accept.isPending}>
                {accept.isPending ? 'Accepting…' : 'Accept'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PullRequestRow({
  pr,
  currentScope,
  onOpen,
  onAccept,
  onWithdraw,
}: {
  pr: PullRequestResult;
  currentScope: string | null;
  onOpen: (button: HTMLButtonElement) => void;
  onAccept: (button: HTMLButtonElement) => void;
  onWithdraw: () => void;
}) {
  const verdict = verdictOf(pr.verdict);
  const tracked = pr.trackedChangeOrder;
  // With excluded items the why line already says it; the full reason
  // follows as detail. Otherwise the why line is the reason itself.
  // An accepted result says who accepted it and why just below, so its reason isn't repeated.
  const reasonBelow = (pr.excluded.length > 0 || verdict.tone === 'ok') && !(pr.acceptance && pr.verdict === 'OVERRIDDEN');
  const stale = Boolean(pr.scopeVersion && currentScope && pr.scopeVersion !== currentScope);
  const flagged = pr.verdict === 'CHANGE_REQUIRED' || pr.verdict === 'REVIEW_REQUIRED';

  return (
    <li className={`verdict-card is-${verdict.tone} pr-row`} data-testid="pr-result">
      <div className="pr-row-head">
        <p className="verdict-card-label">{verdict.label}</p>
        <p className="pr-row-meta mono">
          {pr.prState === 'OPEN' ? 'open' : pr.prState === 'MERGED' ? 'merged' : 'closed'} · checked{' '}
          {relativeTime(pr.checkedAt)}
          {pr.scopeVersion && (
            <span className={stale ? 'is-stale' : undefined}>
              {' '}
              · scope {pr.scopeVersion}
              {stale && ` (now ${currentScope})`}
            </span>
          )}
        </p>
      </div>
      <p className="pr-row-title">
        <a href={pr.url} target="_blank" rel="noreferrer">
          #{pr.number} {pr.title}
          <Icon icon={ExternalIcon} size={13} />
        </a>
      </p>
      {pr.branch && <p className="verdict-card-clause mono">{pr.branch}</p>}
      <WhyLine pr={pr} tone={verdict.tone} />
      {reasonBelow && <p className={pr.excluded.length > 0 ? 'pr-row-detail' : 'verdict-card-reason'}>{pr.reason}</p>}
      {pr.estimate && <p className="verdict-card-estimate">Estimated impact: {pr.estimate}</p>}
      <ChangedFiles pr={pr} />
      {pr.acceptance && (
        <p className="pr-row-accepted">
          Accepted by @{pr.acceptance.acceptedBy} on {shortDate(pr.acceptance.acceptedAt)}: {pr.acceptance.reason}
          {flagged && ' A later push added work this doesn\'t cover.'}{' '}
          <button type="button" className="text-link" onClick={onWithdraw} aria-label={`Withdraw the acceptance of #${pr.number}`}>
            Withdraw
          </button>
        </p>
      )}
      {pr.previousChangeOrder && (
        <p className="pr-row-previous">
          {pr.previousChangeOrder.reference} ({pr.previousChangeOrder.status === 'APPROVED' ? 'approved' : 'declined'}) covers{' '}
          {pr.previousChangeOrder.items.join(', ')}. A later push added work it doesn't, so that needs its own change order.
        </p>
      )}
      {/* Flagged despite an acceptance means a later push added work it
          doesn't cover: that can be accepted too. */}
      {flagged && (
        <div className="pr-row-actions">
          <button
            type="button"
            className="text-link"
            onClick={(event) => onAccept(event.currentTarget)}
            aria-label={`Accept #${pr.number} without a change order`}
          >
            {pr.verdict === 'REVIEW_REQUIRED' ? 'Accept as in scope…' : 'Accept without a change order…'}
          </button>
        </div>
      )}
      {(pr.changeOrder || tracked) && (
        <div className="pr-row-co">
          <span className={`chip ${tracked ? CHANGE_ORDER_TONE[tracked.status] : ''}`}>{changeOrderSummary(tracked)}</span>
          <button
            type="button"
            className="button button-quiet button-sm"
            aria-haspopup="dialog"
            aria-label={`Open the change order for #${pr.number}`}
            onClick={(event) => onOpen(event.currentTarget)}
            data-testid="button-open-change-order"
          >
            Open change order
            <Icon icon={ArrowRightIcon} size={14} />
          </button>
        </div>
      )}
    </li>
  );
}

function PullRequestsSection({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const results = useListProjectPullRequests(project.id, {
    query: { queryKey: getListProjectPullRequestsQueryKey(project.id), refetchInterval: 30_000 },
  });
  const recheck = useRecheckProject();
  const withdraw = useWithdrawPullRequestAcceptance();
  const [confirm, confirmDialog] = useConfirm();
  const [recheckStatus, setRecheckStatus] = useState('');
  // What went wrong with the last re-check or withdrawal, said as an error.
  const [actionError, setActionError] = useState('');
  const report = (message: string) => {
    setActionError('');
    setRecheckStatus(message);
  };
  const fail = (fallback: string) => (err: unknown) => {
    setRecheckStatus('');
    setActionError(errorMessage(err, fallback));
  };
  // The pull request being accepted, by url, so the dialog follows its
  // latest result (a retry after "out of date" sends the new one).
  const [acceptingUrl, setAcceptingUrl] = useState<string | null>(null);
  const accepting = acceptingUrl ? (results.data?.pullRequests.find((p) => p.url === acceptingUrl) ?? null) : null;
  const refreshResults = () => {
    queryClient.invalidateQueries({ queryKey: getListProjectPullRequestsQueryKey(project.id) });
    queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(project.id) });
    queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
  };
  const withdrawAcceptance = async (pr: PullRequestResult) => {
    if (withdraw.isPending) return;
    const ok = await confirm({
      title: `Withdraw the acceptance of #${pr.number}?`,
      description: 'It is checked again and judged on its own; GitHub shows the result.',
      confirmLabel: 'Withdraw',
    });
    if (!ok) return;
    withdraw.mutate(
      // The result names the pull request; its number can repeat (see AcceptDialog).
      { projectId: project.id, number: pr.number, params: { evaluationId: pr.evaluationId } },
      {
        onSuccess: (result) => {
          report(
            result.checkUpdated
              ? `Acceptance of #${pr.number} withdrawn; it's judged on its own again.`
              : `Acceptance of #${pr.number} withdrawn, but its GitHub check couldn't be updated just now. Re-check open pull requests to update it.`,
          );
          refreshResults();
          // The Withdraw link goes with the acceptance; focus stays on the list.
          requestAnimationFrame(() => document.getElementById('prs-title')?.focus());
        },
        onError: (err) => {
          fail("We couldn't withdraw it.")(err);
          // Already withdrawn, or the result changed: show it as it is now.
          const status = (err as { status?: number } | null)?.status;
          if (status === 404 || status === 409) refreshResults();
        },
      },
    );
  };
  // The open panel follows the pull request, so a new result for it (a push,
  // an approval) doesn't close it. Its URL names it: after the project moves
  // to another repository, two pull requests here can share a number.
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  const open = results.data?.pullRequests.find((pr) => pr.url === openUrl) ?? null;
  // The Accept button that opened the dialog, and whether it accepted: once
  // accepted, that button goes when the list refreshes.
  const acceptOpener = useRef<HTMLButtonElement | null>(null);
  const accepted = useRef(false);
  const ready = Boolean(project.repository && project.scopeVersion);

  const recheckAll = () =>
    recheck.mutate(
      { projectId: project.id },
      {
        onSuccess: () => {
          report('Checking the open pull requests again. Results update here as they finish.');
          // Each check takes a moment; look again a little later, then once more.
          const refresh = () => queryClient.invalidateQueries({ queryKey: getListProjectPullRequestsQueryKey(project.id) });
          window.setTimeout(refresh, 4000);
          window.setTimeout(refresh, 12000);
        },
        onError: fail("We couldn't start the re-check."),
      },
    );

  return (
    <section className="panel" aria-labelledby="prs-title">
      <div className="panel-head-row">
        <SectionHead title="Checked pull requests" id="prs-title" focusable />
        {ready && (
          <button type="button" className="button button-quiet button-sm" onClick={recheckAll} disabled={recheck.isPending}>
            {recheck.isPending ? 'Starting…' : 'Re-check open pull requests'}
          </button>
        )}
      </div>
      <p className="app-status" role="status">
        {recheckStatus}
      </p>
      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}
      {results.isPending && <Loading>Loading the checked pull requests…</Loading>}
      {results.isError && !results.data && (
        <LoadError
          error={results.error}
          fallback="We couldn't load the results."
          onRetry={() => results.refetch()}
          retrying={results.isFetching}
        />
      )}
      {/* The list refreshes on its own; a refresh that failed keeps it on screen. */}
      {results.isError && results.data && (
        <StaleNotice error={results.error} what="the results" onRetry={() => results.refetch()} retrying={results.isFetching} />
      )}
      {results.data && results.data.pullRequests.length === 0 && (
        <p className="help">
          {ready
            ? `Nothing checked yet. Pull requests already open on ${project.repository!.fullName} are checked when the repository is connected or a scope is saved, and new ones as they're opened or updated. If one is missing, use Re-check.`
            : 'Results appear here once the scope is saved and a repository is connected.'}
        </p>
      )}
      {results.data && results.data.total > results.data.pullRequests.length && (
        <p className="help">
          Showing {results.data.pullRequests.length} of {results.data.total} checked pull requests: the most recently
          active, and every one with a change order still open.
        </p>
      )}
      {results.data && results.data.pullRequests.length > 0 && (
        <ul className="pr-list">
          {results.data.pullRequests.map((pr) => (
            <PullRequestRow
              key={pr.url}
              pr={pr}
              currentScope={project.scopeVersion}
              onOpen={(button) => {
                opener.current = button;
                setOpenUrl(pr.url);
              }}
              onAccept={(button) => {
                acceptOpener.current = button;
                accepted.current = false;
                setAcceptingUrl(pr.url);
              }}
              onWithdraw={() => withdrawAcceptance(pr)}
            />
          ))}
        </ul>
      )}
      <ChangeOrderDrawer
        project={project}
        pr={open}
        onClose={() => setOpenUrl(null)}
        returnFocus={() => opener.current?.focus()}
      />
      <AcceptDialog
        project={project}
        pr={accepting}
        onClose={(done) => {
          accepted.current = Boolean(done);
          setAcceptingUrl(null);
          if (done) report(done);
        }}
        returnFocus={() => {
          // After an accept, the status line above the list says so.
          if (!accepted.current && acceptOpener.current?.isConnected) acceptOpener.current.focus();
          else document.getElementById('prs-title')?.focus();
        }}
      />
      {confirmDialog}
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
  const [confirm, confirmDialog] = useConfirm();
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

  const archiveProject = async () => {
    const confirmed = await confirm({
      title: `Archive ${project.name}?`,
      description: 'Its repository is disconnected, so pull requests stop being checked, and the project leaves your list.',
      confirmLabel: 'Archive project',
      danger: true,
    });
    if (!confirmed) return;
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
    <section className="panel" aria-labelledby="settings-title">
      <SectionHead title="Settings" id="settings-title" />
      <form onSubmit={submit} onChange={() => setStatus('')}>
        <div className="field-row app-settings-row">
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
              Hourly rate, $ <span className="field-optional">optional; without it, change orders show hours only</span>
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
            <span className="help" role="status">
              {status}
            </span>
          )}
          <button type="button" className="text-link app-archive" onClick={archiveProject} disabled={archive.isPending}>
            Archive project
          </button>
        </div>
      </form>
      {confirmDialog}
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
  // Every change here names the workspace this page shows. The session's
  // workspace can be switched in another window; the server then refuses
  // the change rather than making it in the other workspace.
  const scoped = { request: { headers: workspace.data ? { 'X-ScopeCI-Workspace': workspace.data.id } : undefined } };
  const rename = useUpdateWorkspace(scoped);
  const createInvite = useCreateInvite(scoped);
  const revoke = useRevokeInvite(scoped);
  const remove = useRemoveMember(scoped);
  const changeRole = useChangeMemberRole(scoped);
  const [, navigate] = useLocation();
  const [confirm, confirmDialog] = useConfirm();
  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  // Which invite the shown link belongs to, so revoking it hides the link too.
  const [linkId, setLinkId] = useState('');
  // And which workspace: once the page shows another one, the link isn't its.
  const [linkWorkspace, setLinkWorkspace] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (workspace.data) setName(workspace.data.name);
  }, [workspace.data?.name]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() });
  };
  const fail = (fallback: string) => (err: unknown) => {
    setError(errorMessage(err, fallback));
    // The session moved to another workspace: load the one it is in now.
    if ((err as { status?: number } | null)?.status === 409) refresh();
  };

  if (workspace.isPending) return <Loading>Loading the team…</Loading>;
  // A refresh that fails keeps the team already shown, and an invite link
  // that is only shown once.
  if (!workspace.data) {
    return (
      <LoadError
        error={workspace.error}
        fallback="We couldn't load the team."
        onRetry={() => workspace.refetch()}
        retrying={workspace.isFetching}
      />
    );
  }
  const team = workspace.data;
  const owner = team.role === 'OWNER';
  const shownLink = linkWorkspace === team.id ? link : '';

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
        setLinkId(created.id);
        setLinkWorkspace(team.id);
        setError('');
        refresh();
      },
      onError: fail("We couldn't make an invite."),
    });

  return (
    <>
      <Link href="/" className="app-back">
        <Icon icon={ArrowLeftIcon} size={14} /> Projects
      </Link>
      <header className="app-page-head">
        <div>
          <h1 className="display">Team</h1>
          <p className="page-lede">Everyone here sees and works on all of {team.name}'s projects.</p>
        </div>
      </header>
      {workspace.isError && (
        <StaleNotice
          error={workspace.error}
          what="the team"
          onRetry={() => workspace.refetch()}
          retrying={workspace.isFetching}
        />
      )}

      {owner && (
        <section className="panel" aria-labelledby="workspace-title">
          <SectionHead title="Workspace name" id="workspace-title" />
          <form onSubmit={submitName} onChange={() => setStatus('')}>
            <div className="inline-field app-name-row">
              <label className="sr-only" htmlFor="workspace-name">
                Workspace name
              </label>
              <input id="workspace-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
              <button type="submit" className="button button-quiet" disabled={rename.isPending}>
                Save
              </button>
            </div>
            <p className="app-status" role="status">
              {status}
            </p>
          </form>
        </section>
      )}

      <section className="panel" aria-labelledby="members-title">
        <SectionHead title="Members" id="members-title" focusable />
        <ul className="member-list">
          {team.members.map((member) => (
            <li key={member.userId} className="member-row" data-testid="member-row">
              {member.avatarUrl ? (
                <img src={member.avatarUrl} alt="" width="28" height="28" />
              ) : (
                // No GitHub picture: the initial keeps the names in line.
                <span className="member-initial" aria-hidden="true">
                  {(member.name ?? member.login).trim().charAt(0).toUpperCase()}
                </span>
              )}
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
                  className="text-link"
                  aria-disabled={changeRole.isPending}
                  aria-label={member.role === 'OWNER' ? `Make @${member.login} a member` : `Make @${member.login} an owner`}
                  onClick={async () => {
                    if (changeRole.isPending) return;
                    const toOwner = member.role !== 'OWNER';
                    const confirmed = await confirm({
                      title: toOwner ? `Make @${member.login} an owner?` : `Make @${member.login} a member?`,
                      description: toOwner
                        ? 'Owners rename the workspace, invite and remove people, and change roles, as you can.'
                        : 'They keep working on every project but no longer manage the team.',
                      confirmLabel: toOwner ? 'Make owner' : 'Make member',
                    });
                    if (!confirmed) return;
                    changeRole.mutate(
                      { userId: member.userId, data: { role: toOwner ? 'OWNER' : 'MEMBER' } },
                      {
                        onSuccess: () => {
                          setStatus(toOwner ? `@${member.login} is now an owner.` : `@${member.login} is now a member.`);
                          refresh();
                        },
                        onError: fail("We couldn't change their role."),
                      },
                    );
                  }}
                >
                  {member.role === 'OWNER' ? 'Make member' : 'Make owner'}
                </button>
              )}
              {member.you && (
                <button
                  type="button"
                  className="text-link app-archive"
                  disabled={remove.isPending}
                  onClick={async () => {
                    const confirmed = await confirm({
                      title: `Leave ${team.name}?`,
                      description: "You lose access to its projects. An owner can invite you back.",
                      confirmLabel: 'Leave workspace',
                      danger: true,
                    });
                    if (!confirmed) return;
                    remove.mutate(
                      { userId: member.userId },
                      {
                        onSuccess: () => {
                          // Everything on screen belonged to the workspace just left.
                          startFreshWorkspace(queryClient);
                          navigate('/');
                        },
                        onError: fail("We couldn't take you out of the workspace."),
                      },
                    );
                  }}
                >
                  Leave workspace
                </button>
              )}
              {owner && !member.you && (
                <button
                  type="button"
                  className="text-link app-archive"
                  aria-disabled={remove.isPending}
                  aria-label={`Remove @${member.login}`}
                  onClick={async () => {
                    if (remove.isPending) return;
                    const confirmed = await confirm({
                      title: `Remove ${member.name ?? member.login} from ${team.name}?`,
                      description: `@${member.login} loses access to every project in this workspace, and any invite links they made stop working. You can invite them again later.`,
                      confirmLabel: 'Remove',
                      danger: true,
                    });
                    if (!confirmed) return;
                    remove.mutate(
                      { userId: member.userId },
                      {
                        onSuccess: () => {
                          refresh();
                          // Their row goes; focus stays on the list.
                          document.getElementById('members-title')?.focus();
                        },
                        onError: fail("We couldn't remove them."),
                      },
                    );
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
        <section className="panel" aria-labelledby="invite-title">
          <SectionHead title="Invite someone" id="invite-title" focusable />
          <p className="help">
            Make a link and send it to them. It works once, for seven days, and they sign in with their own GitHub
            account.
          </p>
          {shownLink ? (
            <div className="invite-link">
              <label className="sr-only" htmlFor="invite-url">
                Invite link
              </label>
              <div className="inline-field">
                <input id="invite-url" className="mono" readOnly value={shownLink} onFocus={(e) => e.target.select()} />
                <CopyButton text={shownLink} />
              </div>
              <p className="help">This link is only shown now. Make another one if it gets lost.</p>
            </div>
          ) : null}
          <div className="app-actions">
            <button type="button" className="button button-primary" onClick={invite} disabled={createInvite.isPending}>
              {shownLink ? 'Make another link' : 'Make an invite link'}
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
                    className="text-link app-archive"
                    aria-disabled={revoke.isPending}
                    aria-label={`Revoke the invite made ${relativeTime(open.createdAt)}`}
                    onClick={async () => {
                      if (revoke.isPending) return;
                      const confirmed = await confirm({
                        title: 'Revoke this invite?',
                        description: 'Its link stops working straight away. You can make a new one at any time.',
                        confirmLabel: 'Revoke invite',
                        danger: true,
                      });
                      if (!confirmed) return;
                      revoke.mutate(
                        { inviteId: open.id },
                        {
                          onSuccess: () => {
                            if (open.id === linkId) {
                              setLink('');
                              setLinkId('');
                            }
                            refresh();
                            document.getElementById('invite-title')?.focus();
                          },
                          onError: fail("We couldn't revoke it."),
                        },
                      );
                    }}
                  >
                    Revoke
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
      {confirmDialog}
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
          startFreshWorkspace(queryClient);
          navigate('/');
        },
        onError: (err) => setError(errorMessage(err, "We couldn't add you to the workspace.")),
      },
    );

  if (invite.isPending) return <Loading>Checking the invite…</Loading>;
  const inviteStatus = (invite.error as { status?: number } | null)?.status;
  // Only a missing or used invite is final; a busy network or server can be retried.
  if (invite.isError && (inviteStatus === undefined || inviteStatus === 429 || inviteStatus >= 500)) {
    return (
      <section className="app-signin panel">
        <LoadError
          error={invite.error}
          fallback="We couldn't check the invite."
          onRetry={() => invite.refetch()}
          retrying={invite.isFetching}
        />
      </section>
    );
  }
  if (invite.isError || !invite.data) {
    return (
      <section className="app-signin panel">
        <h1 className="display">This invite doesn't work</h1>
        <p className="page-lede">{errorMessage(invite.error, 'The link may be wrong.')}</p>
        <p className="help">
          <Link href="/" className="text-link">
            Go to your projects
          </Link>
        </p>
      </section>
    );
  }

  return (
    <section className="app-signin panel" aria-labelledby="invite-heading">
      <h1 id="invite-heading" className="display">Join {invite.data.workspaceName}</h1>
      <p className="page-lede">
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
