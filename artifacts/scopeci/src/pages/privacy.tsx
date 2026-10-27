import { Footer, HOME_PATH, Navbar, usePageMeta } from '../site';
import { ArrowLeftIcon, Icon } from '../icons';

const PRIVACY_TITLE = 'Privacy Policy — ScopeCI';
const PRIVACY_DESCRIPTION =
  'What ScopeCI collects through its early-access waitlist, why, and how to have it removed.';

/**
 * Describes only what the site actually does today: one waitlist form, no
 * accounts, no analytics. Nothing here asserts a company entity, address or
 * jurisdiction, because none is established yet.
 */
const PRIVACY_SECTIONS: ReadonlyArray<{ id: string; heading: string; body: readonly string[] }> = [
  {
    id: 'collect',
    heading: 'What we collect',
    body: [
      'When you submit the early-access form we store the work email address you enter, the agency or company name if you choose to add one, and the date the request was made.',
      'If you arrive through a campaign link, the URL may contain standard marketing parameters such as utm_source and utm_campaign. We store these alongside your signup so we can understand which channels bring us the most relevant users.',
      'That is the only information you give us. There is no account to create and no product to sign into yet, and no client, contract, issue-tracker or repository data is collected through this site.',
    ],
  },
  {
    id: 'analytics',
    heading: 'First-party analytics',
    body: [
      'This site records a small number of first-party analytics events — page views, scroll depth, and form interactions — to understand how visitors use the site. These events are sent to our own server, not to a third-party analytics service.',
      'No cookies are set for analytics. No personal information is included in the events.',
    ],
  },
  {
    id: 'technical',
    heading: 'Technical information',
    body: [
      'As with any website, requests to ScopeCI are handled by our hosting and database providers, whose logs record standard technical details such as IP address, browser type and the pages requested. These logs exist to run, debug and secure the service.',
      'This site sets no advertising or tracking cookies.',
    ],
  },
  {
    id: 'use',
    heading: 'How we use it',
    body: [
      'Your email address is used to contact you about ScopeCI early access and occasional product updates — nothing else. We do not sell or rent early-access details, and we do not share them with third parties for their own marketing.',
    ],
  },
  {
    id: 'processors',
    heading: 'Who else processes it',
    body: [
      'Waitlist entries are held in a hosted database, and the site is served by our hosting provider. Both process this information on our behalf so that the service can run.',
      'The site loads its typefaces from Google Fonts, so your browser requests those files from Google when a page loads.',
    ],
  },
  {
    id: 'retention',
    heading: 'How long we keep it',
    body: [
      'We keep early-access requests until early access closes or you ask us to remove yours, whichever happens first.',
    ],
  },
  {
    id: 'choices',
    heading: 'Your choices',
    body: [
      'You can ask us to remove your details from the early-access list at any time and we will delete the record. Depending on where you live, you may also have rights to access or correct the information we hold about you.',
    ],
  },
  {
    id: 'contact',
    heading: 'Contact',
    body: [
      'We do not publish a dedicated privacy address yet. Until we do, reply to any email you receive from us about ScopeCI early access and we will handle access or removal requests from there.',
    ],
  },
  {
    id: 'changes',
    heading: 'Changes to this policy',
    body: [
      'If this policy changes we will update the date at the top of this page. ScopeCI is still being built, so we expect to expand this policy as the product itself launches.',
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
              <p className="legal-meta mono">Last updated 10 September 2026 · Early access</p>
              <p className="legal-lede">
                ScopeCI is not generally available yet. Today this site does two things: it describes the product, and
                it collects early-access requests. This policy covers what that form collects, and what is processed
                to keep the site running.
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
