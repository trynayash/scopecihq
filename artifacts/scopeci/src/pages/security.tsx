import { Callout, FactTable, LegalPage, Section } from '../components/legal-page';
import { Icon, TickIcon } from '../icons';
import { contactHref } from '../legal';
import { BASE, CONTACT_PATH, PRIVACY_PATH, TERMS_PATH } from '../site';

/**
 * States how ScopeCI is built to protect data. Every claim here is checked
 * against the code it describes: the App's permissions in
 * api-server/src/github/app-settings.ts, cookies in lib/session.ts, token
 * encryption in linear/crypto.ts, row-level security in
 * lib/db/src/ensure-schema.ts. Change this page with them.
 */

const SECTIONS = [
  { id: 'github-access', title: 'What the GitHub App can reach' },
  { id: 'reads', title: 'What it reads, and what it never does' },
  { id: 'sign-in', title: 'Signing in and sessions' },
  { id: 'webhooks', title: 'Notifications from GitHub' },
  { id: 'storage', title: 'Data in transit and at rest' },
  { id: 'workspaces', title: 'Who can see a workspace' },
  { id: 'limits', title: 'Limits against abuse' },
  { id: 'disconnect', title: 'Disconnecting and deleting' },
  { id: 'not-yet', title: 'What we don’t have yet' },
  { id: 'reporting', title: 'Reporting a problem' },
] as const;

const SUMMARY = [
  'The GitHub App reads pull request titles, branches, descriptions and file names. It never clones, builds or runs your code.',
  'It asks for no admin, secrets, workflow or member access, and you choose the repositories.',
  'No language model sees your contract or your code. The check is written rules.',
  'GitHub tokens are encrypted, sessions and invite links are stored only as hashes, and every GitHub notification is signature-checked.',
];

export default function Security() {
  return (
    <LegalPage
      title="Security"
      metaTitle="Security — ScopeCI"
      description="What the ScopeCI GitHub App can reach on your repositories, what it reads and never does, and how sign-in, tokens, notifications and your data are protected."
      lede={
        <p>
          A tool that reads your client agreements and your repositories should be plain about what it touches. This page
          is the list: what ScopeCI can reach, what it does with it, and how to report a problem.
        </p>
      }
      summary={
        <ul>
          {SUMMARY.map((line) => (
            <li key={line}>
              <Icon icon={TickIcon} size={16} />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      }
      sections={SECTIONS}
      aside={
        <>
          <strong>Found a security problem?</strong>
          <a className="text-link" href={contactHref(BASE, 'security')}>
            Report it through the contact form
          </a>
        </>
      }
      readNext={[
        { label: 'Privacy Policy', href: PRIVACY_PATH, note: 'Everything ScopeCI stores, and for how long.' },
        { label: 'Terms of Service', href: TERMS_PATH, note: 'Connecting repositories, and what the check promises.' },
        { label: 'Contact', href: CONTACT_PATH, note: 'Report a problem, or ask a question before the pilot.' },
      ]}
    >
      <Section id="github-access">
        <p>
          ScopeCI works through a GitHub App, installed on GitHub by someone with admin rights on the repository or its
          organization. When you install it, GitHub lets you pick the repositories it can see; choose “Only select
          repositories” and it sees nothing else. It asks for exactly these permissions, and subscribes only to pull
          request events:
        </p>
        <FactTable
          caption="The ScopeCI GitHub App's permissions"
          head={['Permission', 'Access', 'Why']}
          rows={[
            ['Pull requests', 'Read and write', 'Read a pull request’s title, branch, description and list of changed files. Write one comment, updated on each push.'],
            ['Checks', 'Read and write', 'Post the ScopeCI check on the pull request and update it.'],
            ['Contents', 'Read', 'GitHub requires it to list the changed files of a pull request in a private repository. ScopeCI never downloads a file.'],
            ['Metadata', 'Read', 'Required by GitHub for every App: the repository’s name and visibility.'],
          ]}
        />
        <p>
          It has no access to administration, secrets, workflows, deployments, members or issues, and cannot push code,
          merge, or change branch protection.
        </p>
      </Section>

      <Section id="reads">
        <p>
          On each push to a pull request, ScopeCI reads its title, branch, description, and the names of its changed files
          with how many lines each added and removed. That is all the check uses.
        </p>
        <ul>
          <li>
            <strong>It never checks out, builds or runs your code,</strong> and never reads a file’s contents.
          </li>
          <li>
            <strong>It never keeps a diff.</strong> GitHub includes diff text when it lists a pull request’s files;
            ScopeCI drops it as soon as it arrives.
          </li>
          <li>
            <strong>No language model is involved.</strong> The check is written rules over the scope you confirmed, so
            your contract and your code are never sent to an AI provider.
          </li>
          <li>
            From a statement of work, only the checklist you confirm is saved, never the document you pasted.
          </li>
        </ul>
      </Section>

      <Section id="sign-in">
        <ul>
          <li>You sign in with GitHub, so ScopeCI never sees your GitHub password.</li>
          <li>
            The tokens GitHub issues at sign-in are encrypted with AES-256-GCM before they are stored, and are used only
            to list the repositories you can connect.
          </li>
          <li>
            A session is a random token in a cookie that scripts cannot read, sent only over HTTPS. The database keeps a
            SHA-256 hash of it, never the token itself, so a copy of the database cannot be used to sign in.
          </li>
          <li>Sessions last at most 30 days. Signing out deletes yours at once.</li>
          <li>
            The sign-in is tied to the browser that started it with a short-lived cookie, so a reply from GitHub cannot be
            replayed in someone else’s browser.
          </li>
        </ul>
      </Section>

      <Section id="webhooks">
        <p>
          GitHub tells ScopeCI about pull requests by sending notifications. Each one is checked against GitHub’s
          HMAC-SHA256 signature, compared in constant time, before anything in it is read; an unsigned or forged
          notification is rejected. Each notification’s ID is remembered for 30 days, so a resent one is never processed
          twice.
        </p>
      </Section>

      <Section id="storage">
        <ul>
          <li>Every connection to ScopeCI, and from ScopeCI to its database, is encrypted with TLS.</li>
          <li>
            The database is hosted by Supabase. Row-level security is switched on for every table with no rules that
            open it, so Supabase’s public database API cannot read ScopeCI’s data; only ScopeCI’s server can.
          </li>
          <li>
            Secrets such as the GitHub App’s private key and the encryption key live in the hosting environment, not in
            the code, and are never sent to a browser.
          </li>
        </ul>
      </Section>

      <Section id="workspaces">
        <ul>
          <li>
            Every request is checked against your membership of the workspace it touches, read fresh from the database
            each time. Removing someone takes effect on their very next request.
          </li>
          <li>
            Only owners can invite people, change roles and remove members. Members can create projects and connect a
            repository only if the GitHub App is already installed on it.
          </li>
          <li>
            Invite links are stored only as hashes, work once, and expire after seven days. An owner can cancel one at any
            time.
          </li>
        </ul>
      </Section>

      <Section id="limits">
        <p>
          The demo, the sign-in, the early-access and contact forms, and the admin page each limit how many requests one
          network can make in a short time. Wrong admin keys are counted per network and blocked after ten in fifteen
          minutes. The demo also caps how large a statement of work and a pull request can be, so no single request can
          slow the service down for everyone else.
        </p>
      </Section>

      <Section id="disconnect">
        <ul>
          <li>Disconnect a repository on its project’s page, and its checks stop at once.</li>
          <li>
            Uninstall the ScopeCI App from your GitHub settings, under Applications, and GitHub revokes its access to
            every repository.
          </li>
          <li>
            To delete your account or a workspace, ask through the{' '}
            <a href={contactHref(BASE, 'privacy')}>contact form</a>. The <a href={`${PRIVACY_PATH}#retention`}>Privacy
            Policy</a> says how long each kind of data is kept.
          </li>
        </ul>
      </Section>

      <Section id="not-yet">
        <p>
          ScopeCI is in early access and run by one person. It does not have a SOC 2 or ISO 27001 report, single sign-on
          or an audit log export yet. If your client requires any of these, tell us before the pilot and we will say
          plainly what we can and cannot do.
        </p>
      </Section>

      <Section id="reporting">
        <p>
          If you find a vulnerability, report it through the <a href={contactHref(BASE, 'security')}>contact form</a>{' '}
          with the topic “A security problem”. Say what you found, how to reproduce it, and what it could expose.
        </p>
        <Callout title="Testing in good faith">
          <p>
            Use your own account and workspace, do not access, change or delete anyone else’s data, do not slow the
            service down, and give us reasonable time to fix a problem before you talk about it publicly. If you do, we
            will not take legal action against you for your research, and we will thank you.
          </p>
        </Callout>
      </Section>
    </LegalPage>
  );
}
