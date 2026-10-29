import { Footer, HOME_PATH, Navbar, usePageMeta } from '../site';
import { ArrowLeftIcon, Icon } from '../icons';

const PRIVACY_TITLE = 'Privacy Policy — ScopeCI';
const PRIVACY_DESCRIPTION =
  'What ScopeCI stores when you join the waitlist, sign in with GitHub or connect a repository, why, and how to have it removed.';

/**
 * Describes what the site and app actually store. Check it against the
 * tables in lib/db/src/schema and the routes that write them whenever either
 * changes. Nothing here asserts a company entity, address or jurisdiction,
 * because none is established yet, and no contact address is given because
 * none is published yet.
 */
const PRIVACY_SECTIONS: ReadonlyArray<{ id: string; heading: string; body: readonly string[] }> = [
  {
    id: 'collect',
    heading: 'What we collect',
    body: [
      'What ScopeCI stores depends on how you use it: joining the early-access list, signing in to the app with GitHub, or connecting a repository to a project. The sections below list each in turn.',
      'The demo at /try stores nothing you paste into it. It reads your statement of work and pull request in memory and forgets them once it has answered.',
    ],
  },
  {
    id: 'waitlist',
    heading: 'Early-access requests',
    body: [
      'When you submit the early-access form we store the work email address you enter, the agency or company name if you add one, and the date.',
      'If you arrived through a campaign link, we also store its marketing tags (utm_source, utm_medium, utm_campaign, utm_content and utm_term), and the address of the page that linked you to this site, without its query string. We use these to see which channels bring us relevant agencies.',
    ],
  },
  {
    id: 'account',
    heading: 'Your account',
    body: [
      'Signing in with GitHub creates a ScopeCI account. From GitHub we store your user ID, username, display name, the public email address on your profile if it shows one, the address of your profile picture, and when you last signed in.',
      'We also store the access and refresh tokens GitHub issues when you sign in, encrypted before they reach the database. ScopeCI uses them only to ask GitHub which repositories you can connect.',
      'Each browser you sign in on gets a session. The database keeps a hash of its token (never the token itself), which workspace it has open and when it was last used. Signing out deletes it.',
    ],
  },
  {
    id: 'workspace',
    heading: 'Workspaces and projects',
    body: [
      'What you add to a workspace is stored so the app can show it to you and your team: the workspace name, its members and their roles, and open invite links, kept as a hash of the link.',
      'For each project we store its name, the client name, your hourly rate and currency, and the policy you chose. When you paste a statement of work, ScopeCI reads it in memory and keeps only the scope checklist you confirm: its section titles and the included and excluded items, along with each earlier version you saved.',
      'If a workspace is connected to Linear, we also store the Linear workspace name, its access tokens (encrypted), and the issues ScopeCI reads: their identifier, title, description, status and estimate.',
    ],
  },
  {
    id: 'pull-requests',
    heading: 'Repositories and pull requests',
    body: [
      'When you connect a repository we store its name and the GitHub App installation it belongs to. For each pull request ScopeCI checks, we store its number, title, description, branch names, link and state, the GitHub user ID of its author, the commit that was checked, and the names of the changed files with how many lines each added and removed. ScopeCI never reads or stores the code itself or the diff.',
      'With each check we store the result, its reason and any estimate. For change orders we store the items they cover, the hours, the subject and text of the letter, and whether it was sent, approved or declined. We also keep a log of who did what (who approved a change order, for example), and a short record of each notification GitHub sends us about a pull request, including the GitHub username that triggered it.',
      'Pull requests can be opened by people who never use ScopeCI. About them we keep only what is listed above: their GitHub user ID and username, alongside their pull request.',
      'ScopeCI posts its result on each pull request as a check and a comment, which anyone who can see the repository on GitHub can read.',
    ],
  },
  {
    id: 'analytics',
    heading: 'First-party analytics',
    body: [
      'This site records a small number of first-party events, such as page views, scroll depth, steps in the demo and form interactions, to understand how visitors use it. They are sent to our own server, not to a third-party analytics service.',
      'Each event stores its name, the path of the page on this site, the campaign tags of the link you followed, and the address of the page that linked you here, without its query string. It stores no IP address, cookie or account. Events are deleted after 90 days.',
    ],
  },
  {
    id: 'cookies',
    heading: 'Cookies and browser storage',
    body: [
      'ScopeCI sets only the cookies the app needs to work. scopeci_session keeps you signed in for up to 30 days. scopeci_oauth lasts ten minutes while you sign in with GitHub, so ScopeCI can check that GitHub\'s reply belongs to the sign-in you started. Scripts on the page can\'t read either one.',
      'Your browser also keeps your light or dark theme choice, and during sign-in, which app page to return to. No advertising or tracking cookies are set.',
    ],
  },
  {
    id: 'technical',
    heading: 'Technical information',
    body: [
      'As with any website, requests to ScopeCI pass through our hosting and database providers, whose logs record standard technical details such as IP address, browser type and the pages requested. These logs exist to run, debug and secure the service.',
      'ScopeCI\'s own server logs record each request\'s method, path and result, without query strings or cookies. To limit abuse, the server counts recent requests from each IP address in memory; those counts are never written to the database.',
    ],
  },
  {
    id: 'use',
    heading: 'How we use it',
    body: [
      'Early-access email addresses are used to contact you about ScopeCI early access and occasional product updates.',
      'Account, workspace and repository data is used only to run ScopeCI for you: to sign you in, show a workspace to its members, check pull requests against the scope you confirmed, and draft the change orders you ask for.',
      'We do not sell or rent any of it, we do not use it for advertising, and we do not share it with third parties for their own marketing.',
    ],
  },
  {
    id: 'processors',
    heading: 'Who else processes it',
    body: [
      'The site and app are served by our hosting provider, and the data above is held in a hosted database. Both process it on our behalf so that the service can run.',
      'GitHub handles sign-in. Through the ScopeCI GitHub App it sends us notifications about pull requests in connected repositories and receives the checks and comments ScopeCI posts. Profile pictures in the app load straight from GitHub. GitHub\'s own privacy terms cover what you do there.',
      'If a workspace is connected to Linear, ScopeCI reads issues from Linear.',
      'The site loads its typefaces from Google Fonts, so your browser requests those files from Google when a page loads.',
    ],
  },
  {
    id: 'retention',
    heading: 'How long we keep it',
    body: [
      'Early-access requests: until early access closes or you ask us to remove yours, whichever happens first.',
      'Analytics events: 90 days. Sessions: 30 days at most, and signing out ends one at once.',
      'Account, workspace and repository data: for as long as the account or workspace exists, until you ask us to delete it. Archiving a project stops its checks and hides it but keeps its data, so it can be restored. Disconnecting a repository stops new checks and keeps past results.',
    ],
  },
  {
    id: 'choices',
    heading: 'Your choices',
    body: [
      'You can sign out at any time. A workspace owner can remove members and cancel invites, and members can leave a workspace. Disconnecting a repository, or uninstalling the ScopeCI GitHub App on GitHub, stops ScopeCI from reading its pull requests.',
      'You can ask us to remove your early-access request, or to delete your account or a workspace you own with everything in it, and we will. Depending on where you live, you may also have rights to access or correct the information we hold about you.',
    ],
  },
  {
    id: 'contact',
    heading: 'Contact',
    body: [
      'We do not publish a dedicated privacy address yet. To make a request, reply to any email you have had from us about ScopeCI. If we have never written to you, leave your work email through the early-access form on the home page and we will write to you so you can make it there.',
      'If you are a member of a workspace someone else set up, its owner can also remove you from it straight away.',
    ],
  },
  {
    id: 'changes',
    heading: 'Changes to this policy',
    body: [
      'If this policy changes we will update the date at the top of this page. ScopeCI is in early access, and this policy will grow with the product.',
    ],
  },
];

export default function Privacy() {
  usePageMeta(PRIVACY_TITLE, PRIVACY_DESCRIPTION);

  return (
    <div className="site site-legal">
      <a className="skip-link" href="#main">Skip to content</a>
      <Navbar />
      <main id="main">
        <article className="legal" aria-labelledby="privacy-title">
          <div className="container">
            <header className="legal-head">
              <p className="kicker">
                <span className="kicker-num">§</span>
                <span className="kicker-rule" aria-hidden="true" />
                Legal
              </p>
              <h1 className="legal-title display" id="privacy-title">Privacy Policy</h1>
              <p className="legal-meta mono">Last updated 29 October 2026 · Early access</p>
              <p className="legal-lede">
                ScopeCI checks agency pull requests against the client's statement of work. This site describes the
                product, runs a free demo, takes early-access requests, and runs the ScopeCI app for anyone who signs in
                with GitHub. This policy says what each of those stores, why, and how to have it removed.
              </p>
            </header>

            <div className="legal-layout">
              <nav className="legal-toc" aria-label="On this page">
                <p className="legal-toc-title">On this page</p>
                <ol>
                  {PRIVACY_SECTIONS.map((section, index) => (
                    <li key={section.id}>
                      <a href={`#${section.id}`}>
                        <span className="mono">{String(index + 1).padStart(2, '0')}</span>
                        {section.heading}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>

              <ol className="legal-sections">
                {PRIVACY_SECTIONS.map((section, index) => (
                  <li className="legal-section" key={section.id} id={section.id}>
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
            </div>

            <p className="legal-foot">
              <a className="text-link" href={HOME_PATH} data-testid="link-privacy-back">
                <Icon icon={ArrowLeftIcon} size={16} />
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
