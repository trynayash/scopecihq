import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { BASE, HOME_PATH, Logo, ThemeToggle, usePageMeta } from '../site';
import { CrossIcon, DownloadIcon, Icon, LockIcon, ReloadIcon, SignOutIcon, TickIcon } from '../icons';

const ADMIN_API = `${BASE}/api/admin`;

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
    <section className="panel admin-panel" aria-labelledby="github-app-heading">
      <h2 id="github-app-heading">GitHub App</h2>
      {notice && <p className="notice" role="status">{notice}</p>}
      {!status ? (
        !error && <p className="muted-text">Checking…</p>
      ) : status.configured ? (
        <>
          <p className="muted-text">
            {status.slug ? `Connected as ${status.slug}` : 'Connected'}
            {status.owner ? `, owned by ${status.owner}` : ''}
            {status.source === 'environment' ? ', set in environment variables.' : '.'}
          </p>
          <ul className="admin-checks">
            <li data-ok={status.signInReady}>
              <Icon icon={status.signInReady ? TickIcon : CrossIcon} size={14} />
              {status.signInReady ? 'Ready' : 'Not ready'}: Sign in with GitHub
            </li>
            <li data-ok={status.webhooksReady}>
              <Icon icon={status.webhooksReady ? TickIcon : CrossIcon} size={14} />
              {status.webhooksReady ? 'Ready' : 'Not ready'}: pull request checks
            </li>
          </ul>
          <div className="row-actions">
            {status.installUrl && (
              <a className="button button-primary button-sm" href={status.installUrl}>Install on a repository</a>
            )}
            {status.settingsUrl && (
              <a className="button button-quiet" href={status.settingsUrl}>App settings on GitHub</a>
            )}
            {status.source === 'admin' && (
              <button type="button" className="button button-quiet button-danger" onClick={forget}>Forget this App</button>
            )}
          </div>
        </>
      ) : (
        <form className="admin-setup" onSubmit={create}>
          <p className="muted-text">
            ScopeCI needs one GitHub App for sign-in and pull request checks. GitHub shows you its settings to
            confirm, then sends you back here. Webhooks will go to <span className="mono">{status.baseUrl}</span>.
          </p>
          {!status.encryptionReady && (
            <p className="form-error">Set GITHUB_TOKEN_ENCRYPTION_KEY on the server first. The App's keys are stored encrypted with it.</p>
          )}
          <div className="field">
            <label htmlFor="app-name">App name, unique on GitHub</label>
            <input id="app-name" value={name} maxLength={34} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="app-org">
              GitHub organization to own it <span className="field-optional">optional</span>
            </label>
            <input
              id="app-org"
              value={organization}
              maxLength={39}
              placeholder="Leave empty to create it on your own account"
              onChange={(e) => setOrganization(e.target.value)}
            />
          </div>
          <div className="row-actions">
            <button type="submit" className="button button-primary button-sm" disabled={busy || !status.encryptionReady}>
              {busy ? 'Opening GitHub…' : 'Create GitHub App'}
            </button>
          </div>
        </form>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
  );
}

function AdminShell({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="site admin-site">
      <header className="admin-bar">
        <div className="container admin-bar-inner">
          <a className="brand" href={HOME_PATH} aria-label="ScopeCI home">
            <Logo />
          </a>
          <span className="admin-bar-label mono">Admin</span>
          <div className="admin-bar-actions">
            {actions}
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="admin" id="main">
        <div className="container">{children}</div>
      </main>
    </div>
  );
}

export default function AdminWaitlist() {
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
      <AdminShell>
        <p className="admin-empty">Checking your session…</p>
      </AdminShell>
    );
  }

  if (view === 'signed-out') {
    return (
      <AdminShell>
        <div className="panel admin-gate">
          <span className="admin-gate-icon" aria-hidden="true">
            <Icon icon={LockIcon} size={20} />
          </span>
          <h1>Admin sign-in</h1>
          <form onSubmit={signIn}>
            <div className="field">
              <label className="sr-only" htmlFor="admin-key">Admin key</label>
              <input
                id="admin-key"
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Admin key"
                className="mono"
                autoComplete="current-password"
                autoFocus
              />
            </div>
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          {error && <p className="form-error" role="alert">{error}</p>}
          <p className="muted-text">Stays signed in for 12 hours on this browser.</p>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell
      actions={
        <button type="button" className="button button-quiet button-sm" onClick={signOut}>
          <Icon icon={SignOutIcon} size={14} />
          Sign out
        </button>
      }
    >
      <div className="page-head">
        <div>
          <h1 className="page-title">Admin</h1>
          <p className="page-lede">The GitHub App, and early access signups.</p>
        </div>
        <div className="row-actions">
          <button type="button" className="button button-quiet" onClick={refresh} disabled={busy}>
            <Icon icon={ReloadIcon} size={14} />
            Refresh
          </button>
          <a className="button button-quiet" href={`${ADMIN_API}/waitlist/csv`} download>
            <Icon icon={DownloadIcon} size={14} />
            Export CSV
          </a>
        </div>
      </div>

      <GitHubAppPanel onSignedOut={signedOut} />

      {stats && (
        <div className="admin-stats">
          <div className="stat">
            <span className="stat-value num">{stats.total}</span>
            <span className="stat-label">Total signups</span>
          </div>
          <div className="stat">
            <span className="stat-value num">{stats.qualified}</span>
            <span className="stat-label">Gave an agency name</span>
          </div>
          <div className="stat">
            <span className="stat-value num">{stats.recent}</span>
            <span className="stat-label">Last 7 days</span>
          </div>
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      {signups.length === 0 ? (
        <p className="admin-empty">No signups yet.</p>
      ) : (
        <>
          <div className="admin-toolbar">
            <div className="field">
              <label className="sr-only" htmlFor="admin-search">Filter signups</label>
              <input
                id="admin-search"
                type="search"
                placeholder="Filter by email, agency, source or referrer"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <span className="admin-count num">
              {visible.length === signups.length ? `${signups.length} signups` : `${visible.length} of ${signups.length}`}
            </span>
          </div>
          <div className="table-wrap">
            <table className="table">
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
                    <td className="mono">{s.email}</td>
                    <td>{s.agency || '—'}</td>
                    <td className="nowrap num">{formatDate(s.createdAt)}</td>
                    <td>{s.utmSource || '—'}</td>
                    <td>{s.utmCampaign || '—'}</td>
                    <td className="table-ref" title={s.referrer ?? undefined}>{s.referrer || '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="button button-quiet button-sm button-danger"
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
    </AdminShell>
  );
}
