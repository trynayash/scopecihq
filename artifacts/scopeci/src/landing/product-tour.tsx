import { type CSSProperties, type KeyboardEvent, type SyntheticEvent, useRef, useState } from 'react';
import { BASE } from '../site';
import { useInView } from '../motion';
import { ContractIcon, DocumentIcon, FolderIcon, GitPullRequestIcon, Icon, type IconSvgElement, LockIcon } from '../icons';

/**
 * Real screenshots of the app, captured from a sample workspace into
 * public/product: one light and one dark per view, at desktop size
 * (2400x1520) and as the app looks on a phone (1170x1920) for small screens.
 * They are CSS backgrounds rather than <img>s, with the context menu,
 * dragging and long-press saving turned off, so they are not one click away
 * from a download. Only the selected view's screenshot is in the page, and
 * only once the tour is near the viewport; the other views are fetched when
 * someone selects them.
 */

type ViewId = 'results' | 'scope' | 'projects' | 'try';

const VIEWS: ReadonlyArray<{ id: ViewId; label: string; caption: string; url: string; icon: IconSvgElement }> = [
  {
    id: 'results',
    label: 'Checked pull requests',
    caption: 'Every pull request on the repository, with the clause that decided it and the change order it produced.',
    url: 'scopeci.onrender.com/app/projects/7c1e9a52-3d4b-4f86-a0e2-91b5d6c8f034',
    icon: GitPullRequestIcon,
  },
  {
    id: 'scope',
    label: 'Scope checklist',
    caption: 'What the statement of work includes and excludes, confirmed by a person and saved as a version.',
    url: 'scopeci.onrender.com/app/projects/7c1e9a52-3d4b-4f86-a0e2-91b5d6c8f034',
    icon: ContractIcon,
  },
  {
    id: 'projects',
    label: 'Projects',
    caption: 'One project per client engagement, with its scope, repository and open change orders.',
    url: 'scopeci.onrender.com/app',
    icon: FolderIcon,
  },
  {
    id: 'try',
    label: 'Try it on a SOW',
    caption: 'The same check on this site, on your own document, without an account.',
    url: 'scopeci.onrender.com/try',
    icon: DocumentIcon,
  },
];

const tabId = (id: ViewId) => `tour-tab-${id}`;
const panelId = (id: ViewId) => `tour-panel-${id}`;
const shotUrl = (id: ViewId, theme: 'light' | 'dark', phone = false) =>
  `url("${BASE}/product/${id}${phone ? '-phone' : ''}-${theme}.webp")`;

/** Keeps the browser's save and drag gestures off the screenshots. */
const block = (event: SyntheticEvent) => event.preventDefault();

export function ProductTour() {
  const [active, setActive] = useState(0);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const [viewRef, near] = useInView<HTMLDivElement>('0px 0px 600px 0px');

  // Arrow keys move between tabs and select as they go (the WAI-ARIA tabs
  // pattern with automatic activation); Tab then leaves for the panel.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = VIEWS.length - 1;
    const targets: Partial<Record<string, number>> = {
      ArrowRight: active === last ? 0 : active + 1,
      ArrowLeft: active === 0 ? last : active - 1,
      Home: 0,
      End: last,
    };
    const next = targets[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
    tabs.current[next]?.focus();
  };

  return (
    <div className="tour" ref={viewRef}>
      <div className="tour-rail">
        <div className="tour-tabs" role="tablist" aria-label="Screens in ScopeCI" onKeyDown={onKeyDown}>
          {VIEWS.map((view, index) => {
            const selected = index === active;
            return (
              <button
                key={view.id}
                ref={(node) => {
                  tabs.current[index] = node;
                }}
                type="button"
                role="tab"
                id={tabId(view.id)}
                aria-selected={selected}
                aria-controls={panelId(view.id)}
                tabIndex={selected ? 0 : -1}
                className="tour-tab"
                onClick={() => setActive(index)}
              >
                <Icon icon={view.icon} size={14} />
                {view.label}
              </button>
            );
          })}
        </div>
      </div>

      {VIEWS.map((view, index) => {
        const selected = index === active;
        return (
          <div
            key={view.id}
            role="tabpanel"
            id={panelId(view.id)}
            aria-labelledby={tabId(view.id)}
            className="tour-panel"
            hidden={!selected}
            tabIndex={0}
          >
            {/* The frame is only built for the selected view, so hidden
                screenshots are never requested. */}
            {selected && (
              <>
                <p className="tour-caption">{view.caption}</p>
                <div className="shot-frame" onContextMenu={block} onDragStart={block}>
                  {/* Window dressing; the screenshot's label names the screen. */}
                  <div className="shot-bar mono" aria-hidden="true">
                    <Icon icon={LockIcon} size={12} />
                    <span>{view.url}</span>
                  </div>
                  <div
                    className="shot"
                    role="img"
                    aria-label={`Screenshot of ScopeCI: ${view.label}, sample data`}
                    style={
                      near
                        ? ({
                            '--shot-light': shotUrl(view.id, 'light'),
                            '--shot-dark': shotUrl(view.id, 'dark'),
                            '--shot-light-phone': shotUrl(view.id, 'light', true),
                            '--shot-dark-phone': shotUrl(view.id, 'dark', true),
                          } as CSSProperties)
                        : undefined
                    }
                  />
                </div>
              </>
            )}
          </div>
        );
      })}

      <p className="tour-note">Sample workspace. Names and figures are illustrative.</p>
    </div>
  );
}
