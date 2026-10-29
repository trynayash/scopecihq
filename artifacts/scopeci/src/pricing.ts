/**
 * ScopeCI's plans, in one place, so the pricing page and the questions on
 * the home page never disagree. Nothing here is charged yet: during early
 * access ScopeCI is free, and the Terms promise 30 days' notice before any
 * charge (terms.tsx, "Early access and price"). Change a price here and in
 * the same commit check every sentence that quotes it.
 */

/** Paying for a year buys twelve months for the price of this many. */
export const MONTHS_PAID_PER_YEAR = 10;

/** Months free on a paid plan for agencies that ran the pilot, from the day paid plans start. */
export const PILOT_MONTHS_FREE = 3;

/** Each paid plan: US dollars a month, and how many projects it checks at once. */
export const STUDIO = { monthly: 49, projects: 3 } as const;
export const AGENCY = { monthly: 149, projects: 15 } as const;

export type PlanId = 'pilot' | 'studio' | 'agency' | 'larger';

export interface Plan {
  id: PlanId;
  name: string;
  /** When it can be had: the pilot is open now, the paid plans start after it. */
  when: string;
  /** US dollars a month; null when the price is agreed with us. */
  monthly: number | null;
  /** The number the plan is about, said plainly. */
  limit: string;
  audience: string;
}

export const PLANS: readonly Plan[] = [
  {
    id: 'pilot',
    name: 'Pilot',
    when: 'Open now',
    monthly: 0,
    limit: 'One live project',
    audience: 'Set up with you on a real client project, before paid plans start.',
  },
  {
    id: 'studio',
    name: 'Studio',
    when: 'After the pilot',
    monthly: STUDIO.monthly,
    limit: `Up to ${STUDIO.projects} active projects`,
    audience: 'For a studio with a few fixed-price projects running at once.',
  },
  {
    id: 'agency',
    name: 'Agency',
    when: 'After the pilot',
    monthly: AGENCY.monthly,
    limit: `Up to ${AGENCY.projects} active projects`,
    audience: 'For an agency running many client projects, with PMs on each.',
  },
  {
    id: 'larger',
    name: 'Larger',
    when: 'Any time',
    monthly: null,
    limit: `More than ${AGENCY.projects} active projects`,
    audience: 'Or if you need an invoice, a purchase order or a security review before you sign.',
  },
];

/** "$1,490": whole dollars, as the page prints them. */
export const dollars = (amount: number) => `$${amount.toLocaleString('en-US')}`;

export const yearly = (monthly: number) => monthly * MONTHS_PAID_PER_YEAR;
