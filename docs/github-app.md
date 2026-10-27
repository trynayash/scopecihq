# Connecting ScopeCI to GitHub

ScopeCI uses one GitHub App for two things:

- **Sign in with GitHub.** The App's OAuth credentials identify the person and let ScopeCI ask GitHub which of the App's installations and repositories they can see. That is how a repository is linked to a project without trusting anything the browser sends.
- **Checking pull requests.** When a pull request on a connected repository is opened or updated, ScopeCI reads its title, branch, description and changed files, checks them against the project's confirmed scope, and posts a check run (`scopeci / commercial`) and one comment, which it updates on every push.

The real client lives in `artifacts/api-server/src/github/app-client.ts`. Without `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` the server falls back to an in-memory client, which is what the test suites use; production refuses to accept webhooks in that state.

## 1. Register the App

On GitHub: **Settings → Developer settings → GitHub Apps → New GitHub App** (or the same under an organization's settings, if the organization should own it). Use your deployed address in place of `https://scopeci.example.com`.

| Setting | Value |
| :-- | :-- |
| Homepage URL | `https://scopeci.example.com` |
| Callback URL | `https://scopeci.example.com/api/auth/github/callback` |
| Expire user authorization tokens | On |
| Request user authorization (OAuth) during installation | **Off**. Sign-in starts from ScopeCI, which checks its own `state`; a code sent straight from the install screen would be refused. |
| Setup URL | `https://scopeci.example.com/app`, with "Redirect on update" on. After installing, people land back in the app and return to the project they came from. |
| Webhook URL | `https://scopeci.example.com/api/webhooks/github` |
| Webhook secret | A long random string (`openssl rand -hex 32`). Same value as `GITHUB_WEBHOOK_SECRET`. |
| Where can this GitHub App be installed? | Any account, so client agencies can install it on their own organizations. |

**Repository permissions**

| Permission | Access | Why |
| :-- | :-- | :-- |
| Pull requests | Read and write | Read pull requests; write the one ScopeCI comment. |
| Checks | Read and write | Create the `scopeci / commercial` check run on each commit. |
| Contents | Read-only | List a pull request's changed files. |
| Metadata | Read-only | Required by GitHub for every App. |

No administration, secrets, workflow or account permissions.

**Subscribe to events:** Pull request. GitHub always sends `installation` and `installation_repositories` events to Apps; ScopeCI uses them to stop checking when the App is suspended or uninstalled, and to disconnect a project when its repository is removed from the App.

After creating the App:

1. Note the **App ID**, the **Client ID**, and the App's **slug** (the last part of `https://github.com/apps/<slug>`).
2. Generate a **client secret**.
3. Generate a **private key** and download the `.pem` file.

## 2. Configure the server

| Variable | Value |
| :-- | :-- |
| `APP_BASE_URL` | `https://scopeci.example.com`. Used for the OAuth callback and the links on check runs and comments. |
| `GITHUB_APP_ID` | The App ID |
| `GITHUB_APP_SLUG` | The slug; builds the "Install the GitHub App" link and identifies the App's own comments |
| `GITHUB_CLIENT_ID` | The Client ID |
| `GITHUB_CLIENT_SECRET` | The client secret |
| `GITHUB_APP_PRIVATE_KEY` | The `.pem` contents. Real newlines, `\n` escapes, or the whole file base64-encoded all work. |
| `GITHUB_WEBHOOK_SECRET` | The webhook secret |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | A long random string (`openssl rand -hex 32`). Encrypts the GitHub user tokens ScopeCI stores. Sign-in stays off in production until it is set. |
| `ENABLE_INTEGRATION_ROUTES` | `true`, so production accepts GitHub webhooks |

`GITHUB_API_URL` and `GITHUB_WEB_URL` default to `https://api.github.com` and `https://github.com`; set them for GitHub Enterprise Server.

Then create the new tables (users, sessions, organization members, projects, and the new columns) in the production database:

```sh
DATABASE_URL=... pnpm --filter @workspace/db run push
```

The changes only add tables and nullable columns, so existing data is untouched.

## 3. Check it works

1. Open `/app`, sign in with GitHub, and create a project.
2. Paste the statement of work, check what ScopeCI read, and save it.
3. Under **Repository**, choose **Choose a repository**. If the list is empty, use **Install the GitHub App** and pick the repository; you come back to the project afterwards.
4. Open a pull request on that repository. Within a few seconds it shows a `scopeci / commercial` check and a ScopeCI comment, and the project page lists the result. If the scope isn't saved yet, the check says so instead.

The webhook delivery log on the App's settings page shows each delivery and ScopeCI's response (`202` when accepted). The server logs each pull request it processes, and the `webhook_deliveries` table records why a delivery was ignored (an unclaimed installation, a repository not connected to a project, no confirmed scope).

## How results are decided and reported

- **Scope.** A project's pull requests are checked only against that project's active scope version. Saving the checklist again makes a new version; earlier results keep the version they were checked against. A repository whose installation no ScopeCI workspace has claimed is ignored.
- **No linked issue needed.** Without a Linear issue, the pull request is judged on its own title, branch, description and files. Hours, and so prices, only appear when an estimate exists; ScopeCI never invents one.
- **Policy** (project settings):
  - *Report only* (default): the check is neutral and never affects merging.
  - *Ask for a decision*: the check needs action when work is out of scope or unclear.
  - *Fail the check*: the check fails on excluded work. With branch protection requiring it, merging waits for approval.
- **One check run per commit.** A new push gets a new check run on its head commit; a redelivered webhook for the same commit updates the existing run.
- **One comment per pull request.** ScopeCI edits only its own bot comment, never a person's comment that happens to quote it.
