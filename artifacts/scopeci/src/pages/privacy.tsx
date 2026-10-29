import { Callout, FactTable, LegalPage, Section, Sub } from '../components/legal-page';
import { Icon, TickIcon } from '../icons';
import { CONTACT_RETENTION_DAYS, contactHref, LEGAL_LOCATION, LEGAL_OPERATOR, PROCESSORS } from '../legal';
import { BASE, CONTACT_PATH, SECURITY_PATH, TERMS_PATH, TRY_PATH } from '../site';

/**
 * Describes what the site and app actually store. Check it against the
 * tables in lib/db/src/schema and the routes that write them whenever either
 * changes, and against PROCESSORS in legal.ts.
 */

const SECTIONS = [
  { id: 'who-we-are', title: 'Who we are' },
  { id: 'at-a-glance', title: 'What each part of ScopeCI keeps' },
  { id: 'collect', title: 'What we collect' },
  { id: 'never', title: 'What we never collect' },
  { id: 'use', title: 'How we use it' },
  { id: 'cookies', title: 'Cookies and browser storage' },
  { id: 'processors', title: 'Who else handles it' },
  { id: 'transfers', title: 'Where it is processed' },
  { id: 'security', title: 'How we protect it' },
  { id: 'retention', title: 'How long we keep it' },
  { id: 'rights', title: 'Your rights' },
  { id: 'pr-authors', title: 'People who never signed up' },
  { id: 'children', title: 'Children' },
  { id: 'incidents', title: 'If something goes wrong' },
  { id: 'changes', title: 'Changes to this policy' },
  { id: 'grievance', title: 'Complaints and the Grievance Officer' },
  { id: 'contact', title: 'Contact' },
] as const;

const SUMMARY = [
  'ScopeCI reads pull request titles, branches, descriptions and file names. It never stores your code or its diffs.',
  'From a statement of work it keeps only the scope checklist you confirm, not the document.',
  'We do not sell your data, show ads, or use any third-party tracker.',
  'The only cookies keep you signed in. There is nothing to accept or decline.',
  'Ask through the contact form and we will show you, correct or delete what we hold about you.',
];

export default function Privacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      metaTitle="Privacy Policy — ScopeCI"
      description="What ScopeCI stores when you use the demo, join early access, sign in with GitHub or connect a repository, why, where, for how long, and how to have it removed."
      lede={
        <p>
          ScopeCI checks agency pull requests against the client’s statement of work. This policy says what the website,
          the demo, the app and the GitHub App store, why, who else handles it, and how to have it removed.
        </p>
      }
      badges={['Early access']}
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
          <strong>Want your data, or want it gone?</strong>
          <a className="text-link" href={contactHref(BASE, 'privacy')}>
            Ask through the contact form
          </a>
        </>
      }
      readNext={[
        { label: 'Security', href: SECURITY_PATH, note: 'What the GitHub App can reach, and how data is protected.' },
        { label: 'Terms of Service', href: TERMS_PATH, note: 'The rules for accounts, the GitHub App and early access.' },
        { label: 'Contact', href: CONTACT_PATH, note: 'Ask for your data, a correction or a deletion.' },
      ]}
    >
      <Section id="who-we-are">
        <p>
          ScopeCI is run by {LEGAL_OPERATOR}, {LEGAL_LOCATION}, who decides how the data described here is used (the
          “data fiduciary” under India’s Digital Personal Data Protection Act, and the “controller” under the GDPR).
          “We” and “us” in this policy mean ScopeCI.
        </p>
        <p>
          There is no separate privacy address. Every request goes through the{' '}
          <a href={contactHref(BASE, 'privacy')}>contact form</a>, and a person reads it.
        </p>
      </Section>

      <Section id="at-a-glance">
        <FactTable
          caption="What each part of ScopeCI keeps"
          head={['When you', 'We keep', 'For']}
          rows={[
            [
              'Try the demo',
              'Nothing you paste. A public pull request you look up is held in server memory so repeat lookups are quick.',
              'Up to 10 minutes',
            ],
            ['Join early access', 'Your work email, your agency’s name if you give it, and the campaign the link came from.', 'Until the pilot ends, or you ask'],
            ['Send a message', 'Your name, email, company if you give it, the topic and the message.', `${CONTACT_RETENTION_DAYS} days`],
            ['Sign in with GitHub', 'Your GitHub profile basics and encrypted GitHub tokens, and a session.', 'While you have an account'],
            [
              'Connect a repository',
              'Each checked pull request’s details, changed file names, the result and any change order.',
              'While the workspace exists',
            ],
            ['Browse the site', 'Anonymous page events, with no cookie, IP address or account attached.', '90 days'],
          ]}
        />
      </Section>

      <Section id="collect">
        <Sub>Early-access requests</Sub>
        <p>
          When you submit the early-access form we store the work email address you enter, the agency or company name if
          you add one, and the date. If you arrived through a campaign link we also store its tags (utm_source,
          utm_medium, utm_campaign, utm_content and utm_term) and the address of the page that linked you here, without
          its query string, to see which channels bring us relevant agencies.
        </p>

        <Sub>Messages you send us</Sub>
        <p>
          When you use the <a href={CONTACT_PATH}>contact form</a> we store your name, email address, company if you add
          one, the topic you chose, your message and the date. We use them to reply to you and to keep a record of what
          was asked. We do not store your IP address with it.
        </p>

        <Sub>Your account</Sub>
        <p>
          Signing in with GitHub creates a ScopeCI account. From GitHub we store your user ID, username, display name, the
          public email address on your profile if it shows one, the address of your profile picture, and when you last
          signed in. We also store the access and refresh tokens GitHub issues, encrypted before they reach the database,
          and use them only to ask GitHub which repositories you can connect.
        </p>
        <p>
          Each browser you sign in on gets a session. The database keeps a hash of its token (never the token itself),
          which workspace it has open and when it was last used. Signing out deletes it.
        </p>

        <Sub>Workspaces and projects</Sub>
        <p>
          We store what you add so the app can show it to you and your team: the workspace name, its members and their
          roles, and open invite links, kept as a hash. For each project we store its name, the client’s name, your
          hourly rate and currency, the policy you chose, and the scope checklist you confirm, with each earlier version
          you saved.
        </p>

        <Sub>Repositories and pull requests</Sub>
        <p>
          When you connect a repository we store its name and the GitHub App installation it belongs to. For each pull
          request ScopeCI checks we store its number, title, description, branch names, link and state, its author’s
          GitHub username, the commit that was checked, and the names of the changed files with how many lines each added
          and removed.
        </p>
        <p>
          With each check we store the result, its reason and any estimate. For change orders we store the work they
          cover, the hours, the letter’s subject and text, and whether it was sent, approved or declined. We keep a log of
          who did what, such as who recorded an approval, and a short record of each notification GitHub sends us.
        </p>

        <Sub>Site analytics</Sub>
        <p>
          The site records a few first-party events, such as page views, how far a page was scrolled, steps in the demo
          and form interactions, and sends them to our own server, not to an analytics company. Each event stores its
          name, the page’s path, the campaign tags of the link you followed and the referring page without its query
          string. No IP address, cookie or account is stored with it.
        </p>

        <Sub>Technical logs</Sub>
        <p>
          Our hosting and database providers log requests as any web service does, including IP addresses, to run,
          debug and secure the service. ScopeCI’s own server logs record each request’s method, path and result, without
          query strings or cookies. To limit abuse, the server counts recent requests from each IP address in memory;
          those counts are never written to the database.
        </p>

        <Sub>Linear</Sub>
        <p>
          A connection to Linear is being built. It is not available yet, and this policy will say what it stores before
          it is.
        </p>
      </Section>

      <Section id="never">
        <ul>
          <li>
            <strong>Your code.</strong> ScopeCI never clones, builds or runs it, and never stores file contents or diffs.
            GitHub includes diff text when it lists a pull request’s files; ScopeCI drops it and keeps only the names and
            line counts.
          </li>
          <li>
            <strong>The statement of work you paste.</strong> It is read in memory, and only the checklist you confirm is
            saved. In the <a href={TRY_PATH}>demo</a>, nothing is saved at all.
          </li>
          <li>
            <strong>Passwords.</strong> GitHub handles sign-in, so we never see your GitHub password.
          </li>
          <li>
            <strong>Payment details.</strong> ScopeCI takes no payments during early access.
          </li>
          <li>
            <strong>Anything for advertising.</strong> No ad networks, tracking pixels or third-party analytics run on the
            site.
          </li>
        </ul>
      </Section>

      <Section id="use">
        <FactTable
          caption="How we use what we collect, and why we are allowed to"
          head={['What', 'What we use it for', 'Why we may']}
          rows={[
            ['Account, workspace and repository data', 'Running ScopeCI for you and your team: signing in, checking pull requests, drafting the change orders you ask for.', 'To provide the service you signed up for'],
            ['Early-access requests', 'Writing to you about the pilot and, now and then, about ScopeCI.', 'You asked us to, by sending the form'],
            ['Contact messages', 'Replying to you, and keeping a record of the request.', 'You asked us to, by sending the message'],
            ['Site analytics', 'Seeing which pages and steps people use, so we can improve them.', 'Our legitimate interest in a site that works, with nothing that identifies you'],
            ['Technical logs and request counts', 'Keeping the service running and secure, and stopping abuse.', 'Our legitimate interest in security, and legal obligations'],
          ]}
        />
        <p>
          We do not sell or rent any of it, do not use it for advertising, and do not share it with anyone for their own
          marketing. No language model is given your contracts, your code or your data.
        </p>
      </Section>

      <Section id="cookies">
        <p>ScopeCI sets only the cookies it needs to work, so there is no cookie banner.</p>
        <FactTable
          caption="Cookies and browser storage"
          head={['Name', 'What it does', 'Lasts']}
          rows={[
            [<code key="s">scopeci_session</code>, 'Keeps you signed in to the app.', '30 days, or until you sign out'],
            [<code key="o">scopeci_oauth</code>, 'Checks that GitHub’s reply belongs to the sign-in you started.', '10 minutes'],
            [<code key="a">scopeci_admin</code>, 'Keeps the person who runs ScopeCI signed in to its admin page. Visitors never get it.', '12 hours'],
            [<code key="t">theme</code>, 'Remembers light or dark mode, in your browser’s local storage.', 'Until you clear it'],
            [<code key="r">return path</code>, 'Remembers which app page to return to after signing in, in session storage.', 'Until the tab closes'],
          ]}
        />
        <p>Scripts on the page cannot read the three cookies, and none of them is used to track you.</p>
      </Section>

      <Section id="processors">
        <p>These companies handle data for us, only to run ScopeCI:</p>
        <FactTable
          caption="Companies that handle data for ScopeCI"
          head={['Company', 'For', 'What they do']}
          rows={PROCESSORS.map((processor) => [processor.name, processor.role, processor.detail])}
        />
        <p>
          Inside ScopeCI, the members of a workspace can see its projects, results and change orders. The check and
          comment ScopeCI posts on a pull request can be read by anyone who can see that repository on GitHub. We may
          also disclose data if the law requires it, and will tell you when we are allowed to.
        </p>
      </Section>

      <Section id="transfers">
        <p>
          ScopeCI’s servers run in the United States, in Render’s Oregon region, and its database is hosted by Supabase.
          So your data is processed outside India, and, if you are in the European Union or the United Kingdom, outside
          your country. We use providers who protect data under their own published security and transfer terms.
        </p>
      </Section>

      <Section id="security">
        <p>
          Connections are encrypted, GitHub tokens are encrypted at rest, sessions and invite links are stored only as
          hashes, and every notification from GitHub is checked against its signature before it is read.{' '}
          <a href={SECURITY_PATH}>Security</a> describes all of it, including what the GitHub App can and cannot reach.
        </p>
      </Section>

      <Section id="retention">
        <FactTable
          caption="How long we keep each kind of data"
          head={['Data', 'How long']}
          rows={[
            ['Early-access request', 'Until the pilot ends, or until you ask us to remove it'],
            ['Contact message', `${CONTACT_RETENTION_DAYS} days, then deleted automatically`],
            ['Site analytics event', '90 days, then deleted automatically'],
            ['Session', '30 days at most; signing out ends it at once'],
            ['Record of a GitHub notification', '30 days, then deleted automatically'],
            ['Public pull request looked up in the demo', 'Up to 10 minutes, in memory only'],
            ['Account, workspace, project and pull request data', 'While the account or workspace exists, until you ask us to delete it'],
          ]}
        />
        <p>
          Archiving a project stops its checks and hides it, but keeps its data so it can be restored. Disconnecting a
          repository stops new checks and keeps past results. To delete your account, or a workspace you own with
          everything in it, ask through the <a href={contactHref(BASE, 'privacy')}>contact form</a>; we delete it within
          30 days and tell you when it is done. Copies in our database provider’s backups are overwritten as those backups
          expire.
        </p>
      </Section>

      <Section id="rights">
        <p>Wherever you are, you can ask us to:</p>
        <ul>
          <li>tell you what we hold about you and give you a copy;</li>
          <li>correct anything that is wrong or out of date;</li>
          <li>delete it;</li>
          <li>stop using it for anything you agreed to, such as early-access emails.</li>
        </ul>
        <p>
          Under India’s Digital Personal Data Protection Act you can also have your complaint heard by our{' '}
          <a href="#grievance">Grievance Officer</a> and name someone to act for you if you die or cannot act yourself. In the European Union
          and the United Kingdom you can also ask us to restrict or stop processing, object to it, or move your data to
          another service, and complain to your data protection authority.
        </p>
        <Callout title="How to ask">
          <p>
            Use the <a href={contactHref(BASE, 'privacy')}>contact form</a> with the topic “My data”. To be sure a request
            about an account comes from its owner, we may ask you to confirm it from the GitHub account you sign in with.
            We reply within 30 days.
          </p>
        </Callout>
      </Section>

      <Section id="pr-authors">
        <p>
          Pull requests in a connected repository can be opened by people who never use ScopeCI. About them we keep only
          what is listed under “Repositories and pull requests”: their GitHub username, alongside their pull request. They
          have the same rights as anyone else here, and can ask through the{' '}
          <a href={contactHref(BASE, 'privacy')}>contact form</a>.
        </p>
      </Section>

      <Section id="children">
        <p>
          ScopeCI is for people at work and is not meant for anyone under 18. We do not knowingly collect data about
          children. If you think we have, tell us and we will delete it.
        </p>
      </Section>

      <Section id="incidents">
        <p>
          If a security incident affects your personal data, we will tell you without undue delay, along with what
          happened and what we are doing about it, and will notify the authorities where the law requires it, including
          the Data Protection Board of India.
        </p>
      </Section>

      <Section id="changes">
        <p>
          When this policy changes we update the date at the top. If a change matters to you, such as a new use of your
          data or a new company handling it, we will tell you in the app before it takes effect. Earlier versions are
          available on request.
        </p>
      </Section>

      <Section id="grievance">
        <p>If you are unhappy with how we handled your data or a request, write to our Grievance Officer first.</p>
        <Callout title="Grievance Officer, ScopeCI">
          <p>
            {LEGAL_OPERATOR}, {LEGAL_LOCATION}. Use the <a href={contactHref(BASE, 'grievance')}>contact form</a> with the
            topic “A complaint”.
          </p>
          <p>We acknowledge a complaint within 3 business days and aim to resolve it within 30 days.</p>
        </Callout>
        <p>
          If we do not resolve it, you can complain to the Data Protection Board of India, or to the data protection
          authority where you live.
        </p>
      </Section>

      <Section id="contact">
        <p>
          Questions about this policy or your data go through the <a href={contactHref(BASE, 'privacy')}>contact form</a>.
          A person reads every message.
        </p>
      </Section>
    </LegalPage>
  );
}
