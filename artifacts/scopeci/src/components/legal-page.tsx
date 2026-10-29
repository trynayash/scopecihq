import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRightIcon, Icon } from '../icons';
import { LEGAL_UPDATED } from '../legal';
import { Footer, Navbar, usePageMeta } from '../site';

/**
 * The legal pages share one document format, so they read as a set: a
 * numbered list of sections with their own anchors, a contents list that
 * follows the reader, plain paragraphs and lists, a callout for the one
 * thing a reader must not miss, a table for lists of facts, and a "Read
 * next" row so no page is a dead end.
 */

export interface LegalSectionSpec {
  id: string;
  title: string;
}

export interface ReadNextLink {
  label: string;
  href: string;
  note: string;
}

const SectionsContext = createContext<ReadonlyArray<LegalSectionSpec>>([]);

const reduceMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Scrolls to a section; its `scroll-margin-top` keeps the heading clear of the header. */
function scrollToSection(id: string, instant = false) {
  // 'instant', not 'auto': the page's CSS asks for smooth scrolling, and 'auto' follows it.
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: instant || reduceMotion() ? 'instant' : 'smooth', block: 'start' });
}

/**
 * Which section the reader is in, and how far through the document they
 * are. A section counts as current once its top passes the upper third of
 * the window, so a heading just below the header is never missed.
 */
function useReadingPosition(ids: string[]) {
  const [active, setActive] = useState(ids[0] ?? '');
  const [progress, setProgress] = useState(0);
  const scrolled = useRef(false);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = Math.min(window.innerHeight * 0.3, 280);
      let current = ids[0] ?? '';
      for (const id of ids) {
        const element = document.getElementById(id);
        if (element && element.getBoundingClientRect().top <= line) current = id;
      }
      // At the very bottom the last short sections can never reach the line.
      const bottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (bottom && ids.length) current = ids[ids.length - 1];
      setActive(current);

      const first = document.getElementById(ids[0] ?? '');
      const last = document.getElementById(ids[ids.length - 1] ?? '');
      if (first && last) {
        const start = first.getBoundingClientRect().top + window.scrollY - line;
        const end = last.getBoundingClientRect().bottom + window.scrollY - window.innerHeight;
        const span = Math.max(1, end - start);
        setProgress(Math.min(1, Math.max(0, (window.scrollY - start) / span)));
      }
    };
    const onScroll = () => {
      scrolled.current = true;
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [ids]);

  return { active, setActive, progress, scrolled };
}

export function LegalPage({
  title,
  metaTitle,
  description,
  lede,
  badges = [],
  summary,
  sections,
  aside,
  readNext,
  children,
}: {
  title: string;
  /** The browser tab title. */
  metaTitle: string;
  /** The search and link-preview description. */
  description: string;
  lede: ReactNode;
  badges?: string[];
  /** "The short version": a few lines a reader can stop after. */
  summary?: ReactNode;
  sections: ReadonlyArray<LegalSectionSpec>;
  /** Under the contents list: where to ask about this page. */
  aside?: ReactNode;
  readNext: ReadNextLink[];
  children: ReactNode;
}) {
  usePageMeta(metaTitle, description);
  const ids = useMemo(() => sections.map((section) => section.id), [sections]);
  const { active, setActive, progress, scrolled } = useReadingPosition(ids);
  const tocRef = useRef<HTMLOListElement>(null);
  const activeIndex = Math.max(0, ids.indexOf(active));
  const percent = Math.round(progress * 100);

  // A link such as /terms#liability may arrive before the sections render,
  // and typefaces and images can still move them once they load. Jump there
  // at once, then again as the page settles, until the reader takes over.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.replace(/^#/, ''));
    if (!id || !ids.includes(id)) return;
    setActive(id);
    let done = false;
    const go = () => {
      if (!done) scrollToSection(id, true);
    };
    const stop = () => {
      done = true;
    };
    const timers = [60, 400, 1200].map((ms) => window.setTimeout(go, ms));
    document.fonts?.ready.then(go, () => undefined);
    const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
    events.forEach((name) => window.addEventListener(name, stop, { once: true, passive: true }));
    return () => {
      stop();
      timers.forEach((timer) => window.clearTimeout(timer));
      events.forEach((name) => window.removeEventListener(name, stop));
    };
    // Only the link that brought the reader here matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The address follows the reader, so a refresh or a shared link lands in
  // the same place. Near the top there is nothing to point at.
  useEffect(() => {
    if (!scrolled.current || !active) return;
    const target = window.scrollY < 160 ? window.location.pathname + window.location.search : `#${active}`;
    const current = window.location.hash;
    if (target.startsWith('#') ? current !== target : current !== '') {
      window.history.replaceState(window.history.state, '', target);
    }
  }, [active, scrolled]);

  // Keep the current entry visible inside a long contents list without moving the page.
  useEffect(() => {
    const list = tocRef.current;
    const item = list?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!list || !item) return;
    const top = item.offsetTop - list.offsetTop;
    if (top < list.scrollTop) list.scrollTop = Math.max(0, top - 8);
    else if (top + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top + item.offsetHeight - list.clientHeight + 8;
    }
  }, [active]);

  const jump = (id: string) => {
    setActive(id);
    scrollToSection(id);
    window.history.replaceState(window.history.state, '', `#${id}`);
  };

  return (
    <div className="site site-legal">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Navbar />
      <main id="main">
        <article className="legal" aria-labelledby="legal-title">
          <div className="container">
            <header className="legal-head">
              <p className="kicker">
                <span className="kicker-num">§</span>
                <span className="kicker-rule" aria-hidden="true" />
                Legal
              </p>
              <h1 className="legal-title display" id="legal-title">
                {title}
              </h1>
              <p className="legal-meta mono">
                <span>Updated {LEGAL_UPDATED}</span>
                {badges.map((badge) => (
                  <span key={badge}>{badge}</span>
                ))}
              </p>
              <div className="legal-lede">{lede}</div>
              {summary && (
                <section className="legal-summary" aria-labelledby="legal-summary-title">
                  <h2 className="legal-summary-title" id="legal-summary-title">
                    The short version
                  </h2>
                  {summary}
                </section>
              )}
            </header>

            {/* On a phone the contents list is a picker that stays under the header. */}
            <div className="legal-picker">
              <label className="sr-only" htmlFor="legal-jump">
                Jump to section
              </label>
              <select id="legal-jump" value={active} onChange={(event) => jump(event.target.value)}>
                {sections.map((section, index) => (
                  <option key={section.id} value={section.id}>
                    {String(index + 1).padStart(2, '0')} {section.title}
                  </option>
                ))}
              </select>
              <span className="legal-progress" aria-hidden="true">
                <span style={{ transform: `scaleX(${progress})` }} />
              </span>
            </div>

            <div className="legal-layout">
              <nav className="legal-toc" aria-label="On this page">
                <p className="legal-toc-title">
                  <span>On this page</span>
                  <span className="mono">
                    {activeIndex + 1} of {sections.length}
                  </span>
                </p>
                <span
                  className="legal-progress"
                  role="progressbar"
                  aria-label="Reading progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                >
                  <span style={{ transform: `scaleX(${progress})` }} />
                </span>
                <ol ref={tocRef}>
                  {sections.map((section, index) => (
                    <li key={section.id}>
                      <a
                        href={`#${section.id}`}
                        aria-current={active === section.id ? 'location' : undefined}
                        onClick={(event) => {
                          event.preventDefault();
                          jump(section.id);
                        }}
                      >
                        <span className="mono">{String(index + 1).padStart(2, '0')}</span>
                        {section.title}
                      </a>
                    </li>
                  ))}
                </ol>
                {aside && <div className="legal-aside">{aside}</div>}
              </nav>

              <SectionsContext.Provider value={sections}>
                <div className="legal-sections">{children}</div>
              </SectionsContext.Provider>
            </div>

            <nav className="legal-next" aria-labelledby="legal-next-title">
              <h2 className="legal-next-title" id="legal-next-title">
                Read next
              </h2>
              <ul>
                {readNext.map((link) => (
                  <li key={link.href}>
                    <a href={link.href}>
                      <span className="legal-next-label">
                        {link.label}
                        <Icon icon={ArrowRightIcon} size={16} />
                      </span>
                      <span className="legal-next-note">{link.note}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </article>
      </main>
      <Footer />
    </div>
  );
}

/**
 * One numbered section. Its number and title come from the page's section
 * list, so the contents and the headings can't drift apart. The number is
 * the section's own link, for sharing a single clause.
 */
export function Section({ id, children }: { id: string; children: ReactNode }) {
  const sections = useContext(SectionsContext);
  const index = sections.findIndex((section) => section.id === id);
  if (index < 0) throw new Error(`Section "${id}" is not in the page's section list`);
  const number = String(index + 1).padStart(2, '0');
  return (
    <section className="legal-section" id={id} aria-labelledby={`${id}-title`}>
      <a className="legal-num mono" href={`#${id}`} aria-label={`Link to section ${index + 1}`}>
        {number}
      </a>
      <div className="legal-body">
        <h2 id={`${id}-title`}>{sections[index].title}</h2>
        {children}
      </div>
    </section>
  );
}

export function Sub({ children }: { children: ReactNode }) {
  return <h3 className="legal-sub">{children}</h3>;
}

/** The one thing in a section a reader must not miss. */
export function Callout({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <aside className="legal-callout">
      {title && <p className="legal-callout-title">{title}</p>}
      {children}
    </aside>
  );
}

/**
 * A list of facts. A real table on wide screens; on a phone each row
 * becomes a small block with its labels, so nothing scrolls sideways.
 */
export function FactTable({ caption, head, rows }: { caption: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <table className="legal-table">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          {head.map((label) => (
            <th key={label} scope="col">
              {label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cells, row) => (
          <tr key={row}>
            {cells.map((cell, column) =>
              column === 0 ? (
                <th key={column} scope="row">
                  {cell}
                </th>
              ) : (
                <td key={column} data-label={head[column]}>
                  {cell}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
