import { useEffect } from 'react';

const HOME = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/`;

export default function NotFound() {
  useEffect(() => {
    document.title = 'Page not found — ScopeCI';
  }, []);

  return (
    <div className="site site-legal">
      <main id="main" className="legal">
        <div className="container legal-inner">
          <p className="eyebrow">404</p>
          <h1 className="legal-title">There's no page here.</h1>
          <p className="legal-lede">
            The link may be old, or the address mistyped. Everything about ScopeCI is on
            the home page.
          </p>
          <p className="legal-foot mono">
            <a href={HOME}>Go to the home page</a>
          </p>
        </div>
      </main>
    </div>
  );
}
