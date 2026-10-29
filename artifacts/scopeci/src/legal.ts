/**
 * The facts every legal page states, in one place, so the four pages never
 * disagree. Change a fact here and in the same commit check the page text
 * that relies on it.
 */

/** The date of the legal pages' wording. Change it in the same commit as any change to their wording. */
export const LEGAL_UPDATED = '29 October 2026';

/**
 * Who runs ScopeCI. It is not a registered company, so the pages name the
 * person who runs it. There is no published email address: people reach us
 * through the contact form, whose messages are kept in ScopeCI's database.
 */
export const LEGAL_OPERATOR = 'Yash Suthar';
export const LEGAL_LOCATION = 'Mumbai, Maharashtra, India';

/** How long a contact message is kept, in days. The server's purge job deletes older ones. */
export const CONTACT_RETENTION_DAYS = 365;

/**
 * The companies that handle data for ScopeCI. Keep this in step with what
 * the product really calls: a provider added to the product is added here
 * in the same commit.
 */
export const PROCESSORS = [
  {
    name: 'Render',
    role: 'Hosting',
    detail: 'Runs the website, the app and its server, in Render’s Oregon, United States region.',
  },
  {
    name: 'Supabase',
    role: 'Database',
    detail: 'Hosts the PostgreSQL database that holds what this policy lists.',
  },
  {
    name: 'GitHub',
    role: 'Sign-in and repositories',
    detail:
      'Signs you in, runs the ScopeCI GitHub App on repositories you connect, sends us pull request notifications and shows the checks and comments ScopeCI posts. Profile pictures load from GitHub.',
  },
  {
    name: 'Google Fonts',
    role: 'Typefaces',
    detail: 'Serves the typefaces the site uses, so your browser asks Google for those files when a page loads.',
  },
] as const;

export type LegalTopic = 'general' | 'pilot' | 'privacy' | 'security' | 'grievance' | 'legal';

/** The topics the contact form offers, in the words a visitor picks from. */
export const CONTACT_TOPICS: ReadonlyArray<{ value: LegalTopic; label: string }> = [
  { value: 'general', label: 'A question about ScopeCI' },
  { value: 'pilot', label: 'The pilot or early access' },
  { value: 'privacy', label: 'My data: access, correction or deletion' },
  { value: 'security', label: 'A security problem' },
  { value: 'grievance', label: 'A complaint (Grievance Officer)' },
  { value: 'legal', label: 'These terms or another legal matter' },
];

/** `/contact?topic=privacy` opens the form on that topic, so a legal page can link straight to the right one. */
export const contactHref = (base: string, topic?: LegalTopic) => `${base}/contact${topic ? `?topic=${topic}` : ''}`;
