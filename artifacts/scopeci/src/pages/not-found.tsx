import { Footer, HOME_PATH, Navbar, TRY_PATH, usePageMeta } from '../site';
import { ArrowRightIcon, Icon } from '../icons';

export default function NotFound() {
  usePageMeta('Page not found — ScopeCI', 'There is no page at this address.');

  return (
    <div className="site site-legal">
      <a className="skip-link" href="#main">Skip to content</a>
      <Navbar />
      <main id="main" className="missing">
        <div className="container missing-inner">
          <div className="missing-copy">
            <p className="kicker">
              <span className="kicker-num">404</span>
              <span className="kicker-rule" aria-hidden="true" />
              Page not found
            </p>
            <h1 className="missing-title display">This page isn’t in the contract.</h1>
            <p className="section-lede">
              The link may be old, or the address mistyped. Everything about ScopeCI starts on the home page.
            </p>
            <div className="missing-actions">
              <a className="button button-primary" href={HOME_PATH}>
                Go to the home page
                <Icon icon={ArrowRightIcon} size={16} />
              </a>
              <a className="button button-secondary" href={TRY_PATH}>
                Try it on your SOW
              </a>
            </div>
          </div>

          {/* A clause list with the requested page struck out as excluded. */}
          <div className="missing-paper" aria-hidden="true">
            <p className="missing-paper-head mono">Statement of work · Appendix</p>
            <p className="missing-paper-title">§404&ensp;Pages</p>
            <p className="missing-paper-label">Included</p>
            <ul>
              <li>Home</li>
              <li>Try it on your SOW</li>
              <li>Contact</li>
              <li>Terms, privacy and security</li>
            </ul>
            <p className="missing-paper-label">Explicit exclusions</p>
            <ul>
              <li className="is-struck">The page you asked for</li>
            </ul>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
