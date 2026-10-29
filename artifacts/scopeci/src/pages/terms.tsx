import { Callout, LegalPage, Section, Sub } from '../components/legal-page';
import { Icon, TickIcon } from '../icons';
import { BASE, CONTACT_PATH, PRICING_PATH, PRIVACY_PATH, SECURITY_PATH, TRY_PATH } from '../site';
import { contactHref, LEGAL_LOCATION, LEGAL_OPERATOR } from '../legal';

const SECTIONS = [
  { id: 'agreement', title: 'Agreement' },
  { id: 'eligibility', title: 'Who can use ScopeCI' },
  { id: 'early-access', title: 'Early access and price' },
  { id: 'accounts', title: 'Your account and workspace' },
  { id: 'github', title: 'Connecting GitHub' },
  { id: 'scope', title: 'Statements of work and client information' },
  { id: 'the-check', title: 'What the check is, and what it is not' },
  { id: 'your-content', title: 'Your content' },
  { id: 'acceptable-use', title: 'Acceptable use' },
  { id: 'our-property', title: 'Our property' },
  { id: 'other-names', title: 'Other companies’ names' },
  { id: 'changes-to-service', title: 'Changes to the service' },
  { id: 'availability', title: 'Availability and support' },
  { id: 'disclaimers', title: 'What we do not promise' },
  { id: 'liability', title: 'Limits on our liability' },
  { id: 'indemnity', title: 'Your responsibility to us' },
  { id: 'ending', title: 'Suspension and ending' },
  { id: 'governing-law', title: 'Governing law and disputes' },
  { id: 'changes-to-terms', title: 'Changes to these terms' },
  { id: 'general', title: 'General terms' },
  { id: 'contact', title: 'Contact' },
] as const;

const SUMMARY = [
  'ScopeCI is free during early access. Before anything costs money we will tell you at least 30 days ahead, and nothing is charged unless you agree.',
  'You own your scope checklists, results and change orders. We use them only to run ScopeCI for you.',
  'The check is a set of rules that helps a person decide. Read a result, and any change order it drafts, before you act on it.',
  'Connect only repositories you are allowed to connect, and enter only scope you are allowed to share with a tool.',
  'These terms are governed by Indian law, with the courts in Mumbai.',
];

export default function Terms() {
  return (
    <LegalPage
      title="Terms of Service"
      metaTitle="Terms of Service — ScopeCI"
      description="The terms for using ScopeCI: accounts and workspaces, the GitHub App, your statements of work, what the check does and doesn't promise, and early access."
      lede={
        <p>
          These terms cover the ScopeCI website, the demo, the app and the ScopeCI GitHub App. They are written to be
          read. Where a sentence matters more than the rest, it says so.
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
          <strong>A question about these terms?</strong>
          <a className="text-link" href={contactHref(BASE, 'legal')}>
            Ask us through the contact form
          </a>
        </>
      }
      readNext={[
        { label: 'Privacy Policy', href: PRIVACY_PATH, note: 'What ScopeCI stores, why, and how to have it removed.' },
        { label: 'Security', href: SECURITY_PATH, note: 'What the GitHub App can reach, and how your data is protected.' },
        { label: 'Contact', href: CONTACT_PATH, note: 'Questions about the pilot, your data or these terms.' },
      ]}
    >
      <Section id="agreement">
        <p>
          These terms are a contract between you and {LEGAL_OPERATOR}, who runs ScopeCI from {LEGAL_LOCATION}{' '}
          (“ScopeCI”, “we” or “us”). They apply when you use the website, the demo at <a href={TRY_PATH}>/try</a>,
          the app, or the ScopeCI GitHub App (together, “the service”).
        </p>
        <p>
          By using the service you accept these terms. Our <a href={PRIVACY_PATH}>Privacy Policy</a> explains what we
          store and why. If you use ScopeCI for an agency or another company, you confirm that you can accept these
          terms for it, and “you” then means that company too. If you do not agree, please do not use the service.
        </p>
      </Section>

      <Section id="eligibility">
        <p>
          ScopeCI is a tool for agencies and the people who work with them. To use it you must be at least 18, able to
          enter a binding contract, and using it for your work. You must not have been removed from the service for
          breaking these terms.
        </p>
      </Section>

      <Section id="early-access">
        <p>
          ScopeCI is in early access. Anyone can use the demo. The app is meant for the pilot agencies we set it up with,
          and we may limit who can use it and when.
        </p>
        <ul>
          <li>
            <strong>There is no charge during early access.</strong> We do not take payment details, and nothing you do
            today can create a bill.
          </li>
          <li>
            If we introduce paid plans, we will tell you at least 30 days before any charge, through the app or by
            writing to you. You will only pay if you choose a paid plan, on terms you will see before you agree to them.
          </li>
          <li>
            The <a href={PRICING_PATH}>Pricing</a> page shows the plans we intend to offer after the pilot. They are
            not in force until we announce them as above, and they may change before then.
          </li>
          <li>
            Early access means features change, some are unfinished, and we may remove one or end the pilot. If we end
            it, we will give you at least 30 days’ notice to take what you need first, unless the law or a security
            problem forces us to act sooner.
          </li>
        </ul>
      </Section>

      <Section id="accounts">
        <ul>
          <li>
            You sign in with your GitHub account. Keeping that account secure, including its password and two-factor
            authentication, is up to you, and you are responsible for what happens when someone signs in to ScopeCI with
            it.
          </li>
          <li>An account is for one person. Teammates sign in with their own GitHub accounts.</li>
          <li>
            Work happens in workspaces. A workspace’s owners decide who is in it: they can invite people, change their
            role and remove them. If you own a workspace, you are responsible for the people you let in.
          </li>
          <li>
            An invite link works once: whoever opens it first, signed in, joins the workspace. It expires after seven
            days, and an owner can cancel it before then. Send it only to the person it is for.
          </li>
          <li>
            If you think someone has used your account or workspace without permission, tell us straight away through the{' '}
            <a href={contactHref(BASE, 'security')}>contact form</a>.
          </li>
        </ul>
      </Section>

      <Section id="github">
        <p>
          To check pull requests, someone with admin rights on a repository installs the ScopeCI GitHub App on it, and a
          workspace member connects the repository to a project. The App asks GitHub for read and write access to pull
          requests and checks, and read access to repository contents and metadata.{' '}
          <a href={SECURITY_PATH}>Security</a> explains what each one is used for.
        </p>
        <ul>
          <li>
            On every pull request in a connected repository, ScopeCI posts a check and one comment, which anyone who can
            see the repository on GitHub can read.
          </li>
          <li>
            <strong>Only install the App where you are allowed to.</strong> Agencies often work in repositories their
            client owns. If a repository is not yours, you need its owner’s permission before you connect it.
          </li>
          <li>
            You can disconnect a repository in ScopeCI, or uninstall the App on GitHub, at any time. Checks stop straight
            away.
          </li>
          <li>Your use of GitHub is governed by GitHub’s own terms, and we do not control GitHub.</li>
        </ul>
      </Section>

      <Section id="scope">
        <p>
          ScopeCI works from the scope you confirm for each project: the sections of a statement of work and what each
          one includes and excludes. When you paste a statement of work, ScopeCI reads it in memory and keeps only the
          checklist you confirm.
        </p>
        <Callout title="You decide what goes in">
          <p>
            A statement of work is usually confidential between you and your client. Before you paste one into ScopeCI,
            or type out its scope, make sure your agreement with the client lets you use a tool like this. Do not enter
            anything you are not allowed to share, such as passwords, keys or another person’s private details.
          </p>
        </Callout>
      </Section>

      <Section id="the-check">
        <p>
          The check is a set of written rules. It compares the scope you confirmed with a pull request’s title, branch,
          description and the names of its changed files, and says whether the work looks in scope, out of scope, or
          needs a person to decide. No language model reads your contract or your code.
        </p>
        <ul>
          <li>
            <strong>It can be wrong in both directions.</strong> It can miss work that is out of scope, and it can flag
            work that is not. It is only as precise as the scope it was given.
          </li>
          <li>
            A result is a prompt for a person to look. It is not a legal reading of your contract, and it is not legal
            advice.
          </li>
          <li>
            A change order ScopeCI drafts is a draft. You decide whether to send it, what it says, and what to charge.
            ScopeCI never contacts your client.
          </li>
          <li>
            Each project starts in report-only mode, where the check never affects merging. If you choose a stricter
            policy, or use GitHub’s branch protection with the check, the effect on your merges is your setting.
          </li>
        </ul>
      </Section>

      <Section id="your-content">
        <ul>
          <li>
            <strong>You own it.</strong> Scope checklists, projects, results, change orders and anything else you add to
            ScopeCI belong to you, or to whoever you got them from.
          </li>
          <li>
            <strong>You let us use it to run the service.</strong> We may store, copy, process and display your content
            only to provide ScopeCI to you and your workspace, keep it secure, and fix problems.
          </li>
          <li>
            <strong>We do not sell it,</strong> use it for advertising, or give it to anyone to train a model. See the{' '}
            <a href={PRIVACY_PATH}>Privacy Policy</a>.
          </li>
          <li>
            <strong>You are responsible for it.</strong> You promise you have the right to use it, and that it does not
            break the law or anyone’s rights.
          </li>
          <li>If you send us feedback, we may use it to improve ScopeCI without owing you anything for it.</li>
        </ul>
      </Section>

      <Section id="acceptable-use">
        <p>You agree not to:</p>
        <ul>
          <li>Break the law, or use ScopeCI to harm, deceive or harass anyone.</li>
          <li>
            Get into accounts, workspaces, repositories or data that are not yours, or test our security without
            permission. Reports made in good faith are welcome; <a href={SECURITY_PATH}>Security</a> says how.
          </li>
          <li>Overload the service, or get around its limits, including the demo’s.</li>
          <li>Collect data from the service by automated means, or use it to build or train a competing product.</li>
          <li>Upload malware, or content you have no right to share.</li>
          <li>Connect a repository, or use a GitHub account, you are not allowed to use.</li>
        </ul>
      </Section>

      <Section id="our-property">
        <p>
          ScopeCI’s software, design, text, rules and name belong to us. While you follow these terms, you have a
          personal, limited, non-exclusive right to use the service. You may not copy it, resell it, or take it apart
          to see how it works, except where the law allows you to.
        </p>
      </Section>

      <Section id="other-names">
        <p>
          GitHub, Linear, Stripe and other names on this site belong to their owners. We use them to say what ScopeCI
          works with; it does not mean they endorse ScopeCI. The agencies, clients, people and figures in the screenshots
          and examples on this site are made up.
        </p>
      </Section>

      <Section id="changes-to-service">
        <p>
          We keep changing ScopeCI, and that includes adding, changing and sometimes removing features. When a change
          affects how you use it, we will tell you in the app before it happens where we can.
        </p>
      </Section>

      <Section id="availability">
        <p>
          We try to keep ScopeCI running and to warn you about planned downtime. We do not promise it will always be
          available. It depends on providers we do not control, such as GitHub and our hosting, and during early access
          the server can pause when idle, so the first request after a quiet spell may be slow.
        </p>
        <p>
          Support is through the <a href={CONTACT_PATH}>contact form</a>. A person reads every message.
        </p>
      </Section>

      <Section id="disclaimers">
        <p>
          The service is provided as it is and as available. As far as the law allows, we do not promise that it is
          accurate, complete, uninterrupted or right for a particular purpose. We especially do not promise that it will
          catch every piece of out-of-scope work, or that work it flags is out of scope. Some laws do not allow some of
          these exclusions; where that is so, they apply only as far as the law permits.
        </p>
      </Section>

      <Section id="liability">
        <p>As far as the law allows:</p>
        <ul>
          <li>
            We are not liable for indirect or consequential losses, or for lost profit, revenue, fees, data or goodwill,
            including work you did not bill and disagreements with your clients, even if we were told they were possible.
          </li>
          <li>
            Our total liability for all claims connected with the service is limited to the amount you paid us in the
            twelve months before the event that gave rise to the claim. If you paid nothing, it is limited to ten
            thousand Indian rupees.
          </li>
        </ul>
        <p>
          Nothing in these terms limits liability that the law does not allow to be limited, such as liability for
          fraud.
        </p>
      </Section>

      <Section id="indemnity">
        <p>
          You will cover our reasonable losses and legal costs from a claim by someone else, including your client, that
          comes from your content, the repositories you connect, your use of a result or a change order, or your breach
          of these terms or the law. We will tell you about the claim promptly and let you help deal with it.
        </p>
      </Section>

      <Section id="ending">
        <Sub>You</Sub>
        <p>
          You can stop using ScopeCI at any time. Uninstall the GitHub App, sign out, and if you want your account or a
          workspace you own deleted, ask through the <a href={contactHref(BASE, 'privacy')}>contact form</a>. The{' '}
          <a href={`${PRIVACY_PATH}#retention`}>Privacy Policy</a> says what happens to your data.
        </p>
        <Sub>Us</Sub>
        <p>
          We may suspend or end your access if you break these terms, if your use puts the service or other people at
          risk, or if the law requires it. Where we can, we will tell you why first and give you a chance to fix it.
        </p>
        <p>
          Sections that by their nature should continue after an account ends, such as ownership, liability and
          governing law, continue.
        </p>
      </Section>

      <Section id="governing-law">
        <p>
          These terms are governed by the laws of India. If we disagree about something, please write to us first through
          the <a href={contactHref(BASE, 'legal')}>contact form</a>, so we can try to settle it within 30 days. If we
          cannot, the courts in Mumbai, Maharashtra have exclusive jurisdiction. This does not take away any rights you
          have under consumer protection law that applies to you.
        </p>
      </Section>

      <Section id="changes-to-terms">
        <p>
          We may update these terms. We will change the date at the top, and for a change that matters we will tell you
          in the app before it applies. If you keep using ScopeCI after a change takes effect, you accept it. If you do
          not, you can stop using it, and the terms you agreed to apply until then.
        </p>
      </Section>

      <Section id="general">
        <ul>
          <li>These terms and the Privacy Policy are the whole agreement between us about the service.</li>
          <li>If part of these terms is found to be unenforceable, the rest still applies.</li>
          <li>If we do not enforce a right straight away, we have not given it up.</li>
          <li>
            You may not transfer these terms without our written consent. We may transfer ours as part of a sale or
            reorganisation of ScopeCI, and will tell you if we do.
          </li>
          <li>Neither of us is responsible for a failure caused by something outside our reasonable control.</li>
          <li>
            We send notices through the app, or to an email address you gave us. Notices to us go through the contact
            form.
          </li>
          <li>These terms are written in English. Any translation is for convenience only.</li>
        </ul>
      </Section>

      <Section id="contact">
        <p>
          ScopeCI is run by {LEGAL_OPERATOR}, {LEGAL_LOCATION}. Questions about these terms go through the{' '}
          <a href={contactHref(BASE, 'legal')}>contact form</a>; a person reads every message.
        </p>
      </Section>
    </LegalPage>
  );
}
