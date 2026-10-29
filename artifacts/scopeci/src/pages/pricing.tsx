import { useEffect, useState } from 'react';
import { ArrowRightIcon, Icon, PlusIcon } from '../icons';
import { contactHref } from '../legal';
import { useIndicator } from '../motion';
import { dollars, MONTHS_PAID_PER_YEAR, PILOT_MONTHS_FREE, PLANS, yearly, type Plan } from '../pricing';
import { anchor, BASE, Footer, Navbar, TERMS_PATH, track, TRY_PATH, usePageMeta } from '../site';

type Billing = 'monthly' | 'yearly';

/** What a plan costs, in the billing the visitor picked. */
function PlanPrice({ plan, billing }: { plan: Plan; billing: Billing }) {
  if (plan.monthly === null) {
    return (
      <p className="plan-price">
        <span className="plan-amount is-words">Talk to us</span>
        <span className="plan-per">A price for your agency’s size</span>
      </p>
    );
  }
  if (plan.monthly === 0) {
    return (
      <p className="plan-price">
        <span className="plan-amount">$0</span>
        <span className="plan-per">During early access</span>
      </p>
    );
  }
  const yearlyBilling = billing === 'yearly';
  return (
    <p className="plan-price" data-testid={`price-${plan.id}`}>
      <span className="plan-amount" key={billing}>
        {dollars(yearlyBilling ? yearly(plan.monthly) : plan.monthly)}
      </span>
      <span className="plan-per">
        {yearlyBilling ? `A year, instead of ${dollars(plan.monthly * 12)}` : 'A month'}
      </span>
    </p>
  );
}

function PlanAction({ plan }: { plan: Plan }) {
  if (plan.id === 'pilot') {
    return (
      <a
        className="button button-primary plan-action"
        href={anchor('waitlist')}
        onClick={() => track('pricing_pilot_click')}
        data-testid="button-pricing-pilot"
      >
        Join the pilot
        <Icon icon={ArrowRightIcon} size={16} />
      </a>
    );
  }
  if (plan.id === 'larger') {
    return (
      <a className="button button-secondary plan-action" href={contactHref(BASE, 'pilot')}>
        Write to us
      </a>
    );
  }
  return <p className="plan-later">Pilot agencies get the first {PILOT_MONTHS_FREE} months free.</p>;
}

const INCLUDED: ReadonlyArray<{ term: string; detail: string }> = [
  {
    term: 'Everyone on the team',
    detail: 'Invite every PM, developer and owner who needs to see a check. A plan counts projects, never people.',
  },
  {
    term: 'All three check policies',
    detail: 'Report only, ask for a decision, or fail the check so branch protection holds the merge. Chosen per project.',
  },
  {
    term: 'Change orders',
    detail: 'Drafted from the flagged work, priced at the project’s hourly rate, and tracked to the client’s answer.',
  },
  {
    term: 'The check on GitHub',
    detail: 'A check and one comment on every pull request, updated on each push.',
  },
  {
    term: 'Scope versions',
    detail: 'Each saved scope is a new version, and every result keeps the version it was checked against.',
  },
  {
    term: 'Rules, not a model',
    detail: 'No language model reads your contract or your code, on any plan.',
  },
];

const QUESTIONS: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: 'Is anything charged during the pilot?',
    a: 'No. We take no payment details during early access. Before any plan costs money we will tell you at least 30 days ahead, and you only pay if you choose a plan.',
  },
  {
    q: 'What do pilot agencies get after launch?',
    a: `Their first ${PILOT_MONTHS_FREE} months on Studio or Agency free, counted from the day paid plans start.`,
  },
  {
    q: 'What counts as an active project?',
    a: 'A project with a repository connected, so ScopeCI is checking its pull requests. Writing a scope before the repository is connected doesn’t count, and archiving a project when the work ships stops it counting. An archived project can be restored with its scope, results and change orders.',
  },
  {
    q: 'What happens if we go over the limit?',
    a: 'Checks keep running. We write to the workspace’s owners, and you can move up a plan or archive a project that has shipped.',
  },
  {
    q: 'Can we pay yearly?',
    a: `Yes. A year paid up front costs ${MONTHS_PAID_PER_YEAR} months’ price, so two months are free.`,
  },
  {
    q: 'Which currency, and what about tax?',
    a: 'Prices are in US dollars. They don’t include tax; where tax applies to your purchase, the invoice shows it.',
  },
  {
    q: 'Can we cancel?',
    a: 'Yes, at any time. A monthly plan runs to the end of the month you paid for, and a yearly plan to the end of its year.',
  },
];

export default function Pricing() {
  usePageMeta(
    'Pricing — ScopeCI',
    'ScopeCI is free during early access. After the pilot, one price per agency workspace: Studio for up to 3 active projects, Agency for up to 15, with every PM and developer included.',
  );
  const [billing, setBilling] = useState<Billing>('monthly');
  const switchRef = useIndicator<HTMLDivElement>('[aria-pressed="true"]', billing);

  useEffect(() => {
    track('pricing_opened');
  }, []);

  const choose = (next: Billing) => {
    if (next === billing) return;
    setBilling(next);
    if (next === 'yearly') track('pricing_yearly_shown');
  };

  return (
    <div className="site site-pricing">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Navbar />
      <main id="main">
        <section className="pricing" aria-labelledby="pricing-title">
          <div className="container">
            <header className="pricing-head">
              <p className="kicker">
                <span className="kicker-num">$</span>
                <span className="kicker-rule" aria-hidden="true" />
                Pricing
              </p>
              <h1 className="pricing-title display" id="pricing-title">
                One price for the agency, not for each seat.
              </h1>
              <p className="pricing-lede">
                You pay for the projects ScopeCI checks. Every PM and developer in the workspace is included, so the
                person who has to tell the client about a change order can always see the check.
              </p>
            </header>

            <p className="pricing-note" role="note">
              <strong>Free during early access.</strong> The prices below start after the pilot. Nothing is charged
              today, we take no payment details, and we’ll tell you at least 30 days before any charge.{' '}
              <a className="text-link" href={`${TERMS_PATH}#early-access`}>
                What the terms say
              </a>
            </p>

            <div className="pricing-bar">
              <div className="segmented" role="group" aria-label="Billing" ref={switchRef}>
                <button
                  type="button"
                  aria-pressed={billing === 'monthly'}
                  className={billing === 'monthly' ? 'is-active' : ''}
                  onClick={() => choose('monthly')}
                  data-testid="button-billing-monthly"
                >
                  Monthly
                </button>
                <button
                  type="button"
                  aria-pressed={billing === 'yearly'}
                  className={billing === 'yearly' ? 'is-active' : ''}
                  onClick={() => choose('yearly')}
                  data-testid="button-billing-yearly"
                >
                  Yearly, 2 months free
                </button>
              </div>
              <p className="pricing-currency">US dollars, before any tax that applies.</p>
            </div>

            <ol className="plans" aria-label="Plans">
              {PLANS.map((plan) => (
                <li key={plan.id} className={`plan ${plan.id === 'pilot' ? 'is-open' : ''}`} data-testid={`plan-${plan.id}`}>
                  <div className="plan-head">
                    <h2 className="plan-name">{plan.name}</h2>
                    <span className="plan-when">{plan.when}</span>
                  </div>
                  <PlanPrice plan={plan} billing={billing} />
                  <p className="plan-limit">{plan.limit}</p>
                  <p className="plan-audience">{plan.audience}</p>
                  <div className="plan-foot">
                    <PlanAction plan={plan} />
                  </div>
                </li>
              ))}
            </ol>

            <section className="pricing-included" aria-labelledby="included-title">
              <div className="pricing-section-head">
                <h2 className="pricing-subtitle display" id="included-title">
                  Every plan has all of ScopeCI.
                </h2>
                <p>Plans differ only in how many projects are checked at once. Nothing is held back for a higher tier.</p>
              </div>
              <dl className="spec">
                {INCLUDED.map((row) => (
                  <div key={row.term} className="spec-row">
                    <dt>{row.term}</dt>
                    <dd>{row.detail}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="pricing-questions" aria-labelledby="pricing-questions-title">
              <div className="pricing-section-head">
                <h2 className="pricing-subtitle display" id="pricing-questions-title">
                  Questions about paying.
                </h2>
                <p>
                  Anything else,{' '}
                  <a className="text-link" href={contactHref(BASE, 'pilot')}>
                    write to us
                  </a>
                  . A person answers.
                </p>
              </div>
              <div className="faq">
                {QUESTIONS.map((item) => (
                  <details className="faq-item" key={item.q}>
                    <summary>
                      {item.q}
                      <span className="faq-icon">
                        <Icon icon={PlusIcon} size={18} />
                      </span>
                    </summary>
                    <p>{item.a}</p>
                  </details>
                ))}
              </div>
            </section>

            <section className="pricing-close" aria-labelledby="pricing-close-title">
              <h2 className="pricing-subtitle display" id="pricing-close-title">
                Start with the pilot.
              </h2>
              <p>
                Run ScopeCI free on one live client project, set up with you. Or see the check work on your own SOW first,
                without an account.
              </p>
              <div className="pricing-close-actions">
                <a className="button button-primary button-lg" href={anchor('waitlist')} onClick={() => track('pricing_pilot_click')}>
                  Join the pilot
                  <Icon icon={ArrowRightIcon} size={16} />
                </a>
                <a className="button button-secondary button-lg" href={TRY_PATH}>
                  Try it on your SOW
                </a>
              </div>
            </section>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
