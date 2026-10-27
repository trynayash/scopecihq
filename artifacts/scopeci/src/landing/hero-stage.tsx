import { useState } from 'react';
import { ContractIcon, CrossIcon, GitBranchIcon, GitPullRequestIcon, Icon, NeutralIcon, TickIcon } from '../icons';
import { ICON_MARK, VendorMark } from '../site';
import { useInView, usePointerTilt, useTimeline } from '../motion';

/**
 * The hero's product scene: the signed statement of work at the back, the
 * pull request in the middle and ScopeCI's check in front, set in a shallow
 * 3D space that leans toward the pointer.
 *
 * It's an illustration, not a screenshot, but the wording follows what the
 * product returns for this case (lib/commercial-engine: a pull request that
 * builds two items a clause excludes). The footnote markers, [a] and [b],
 * tie each excluded item to the files that build it.
 */

/* highlight a -> files a -> highlight b -> files b -> verdict -> change order */
const STEPS = [500, 950, 1450, 1900, 2550, 3200] as const;

const FILES = [
  { path: 'src/auth/roles.ts', status: 'A', lines: '+124', note: 'a', at: 2 },
  { path: 'src/middleware/rbac.ts', status: 'A', lines: '+88', note: 'a', at: 2 },
  { path: 'src/routes/invitations.ts', status: 'A', lines: '+117', note: 'b', at: 4 },
  { path: 'src/routes/session.ts', status: 'M', lines: '+9', note: '', at: 0 },
] as const;

export function HeroStage() {
  const [run, setRun] = useState(0);
  const [viewRef, inView] = useInView<HTMLDivElement>('0px');
  const tiltRef = usePointerTilt<HTMLDivElement>(4);
  const step = useTimeline(STEPS, inView, run);

  const checking = step >= 1 && step < 5;
  const resolved = step >= 5;

  return (
    <div className="stage-wrap" ref={viewRef}>
      <figure className="stage" ref={tiltRef} data-step={step} data-testid="product-preview">
        <div className="stage-scene">
          {/* The contract */}
          <article className="stage-card stage-sow" aria-hidden="true">
            <header className="sow-head mono">
              <span>
                <Icon icon={ContractIcon} size={12} />
                Statement of work
              </span>
              <span>Northstar Health · p. 4</span>
            </header>
            <h3 className="sow-title">4.2&ensp;User authentication</h3>
            <p className="sow-text">
              Email and password sign-in, sessions and sign-out, and password reset for patient accounts.
            </p>
            <p className="sow-label">Explicit exclusions</p>
            <ol className="sow-list">
              <li>
                <mark className={step >= 1 ? 'is-on' : ''}>Organization roles</mark>
                <sup className="note">[a]</sup>
              </li>
              <li>
                <mark className={step >= 3 ? 'is-on' : ''}>Team invitations</mark>
                <sup className="note">[b]</sup>
              </li>
              <li>Single sign-on (SAML)</li>
            </ol>
            <footer className="sow-sign">
              <span className="sow-signature">J. Okafor</span>
              <span className="mono">Signed 12 Mar 2026</span>
            </footer>
          </article>

          {/* The work */}
          <article className="stage-card stage-pr" aria-hidden="true">
            <header className="pr-bar mono">
              <span>
                <VendorMark name="github" size={12} />
                northstar / portal
              </span>
              <span>#1842</span>
            </header>
            <div className="pr-body">
              <p className="pr-state mono">
                <Icon icon={GitPullRequestIcon} size={12} />
                Open
              </p>
              <p className="pr-title">Add organization-level permissions</p>
              <p className="pr-meta mono">
                <Icon icon={GitBranchIcon} size={12} />
                feature/org-permissions
                <span className="pr-dim">→ main · 14 files</span>
              </p>
            </div>
            <ul className="pr-files mono">
              {FILES.map((file) => (
                <li key={file.path} className={file.at && step >= file.at ? 'is-match' : ''}>
                  <span className={`pr-file-status ${file.status === 'A' ? 'is-added' : ''}`}>{file.status}</span>
                  <span className="pr-file-path">{file.path}</span>
                  {file.note ? <sup className="note">[{file.note}]</sup> : <span />}
                  <span className="pr-file-lines">{file.lines}</span>
                </li>
              ))}
            </ul>
            <ul className="pr-checks mono">
              <li>
                <span className="pr-check-icon is-ok"><Icon icon={TickIcon} size={13} strokeWidth={2.2} /></span>
                build
                <span className="pr-check-result">passed</span>
              </li>
              <li className={resolved ? 'is-failed' : checking ? 'is-running' : ''}>
                <span className="pr-check-icon">
                  <Icon icon={resolved ? CrossIcon : NeutralIcon} size={13} strokeWidth={2.2} />
                </span>
                scopeci / commercial
                <span className="pr-check-result">{resolved ? 'action required' : checking ? 'checking…' : 'queued'}</span>
              </li>
            </ul>
          </article>

          {/* The answer */}
          <article className={`stage-card stage-verdict ${resolved ? 'is-shown' : ''}`} aria-hidden="true">
            <header className="verdict-head">
              <span className="verdict-brand mono">
                <img src={ICON_MARK} alt="" width="288" height="270" decoding="async" />
                ScopeCI
              </span>
              <span className="chip is-alert">Change order needed</span>
            </header>
            <p className="verdict-reason">
              <strong>§4.2</strong> of the statement of work excludes organization roles and team invitations. This
              pull request builds both.
            </p>
            <dl className="verdict-facts mono">
              <div>
                <dt>Clause</dt>
                <dd>§4.2 (a), (b)</dd>
              </div>
              <div>
                <dt>Files</dt>
                <dd>3 of 14</dd>
              </div>
              <div>
                <dt>Estimate</dt>
                <dd>14 h · $2,100</dd>
              </div>
            </dl>
            <p className={`verdict-next ${step >= 6 ? 'is-shown' : ''}`}>
              <Icon icon={TickIcon} size={14} strokeWidth={2} />
              Change order drafted for the client
            </p>
          </article>
        </div>

        <figcaption className="sr-only">
          Example: pull request 1842 on northstar/portal, “Add organization-level permissions”, changes 14 files. Section
          4.2 of the client’s statement of work excludes organization roles and team invitations. ScopeCI matches three
          of the changed files to those exclusions, marks its check as needing action, says a change order is needed
          with an estimate of 14 hours or $2,100, and drafts the change order.
        </figcaption>
      </figure>

      <button
        type="button"
        className={`stage-replay mono ${step >= STEPS.length ? 'is-shown' : ''}`}
        onClick={() => setRun((value) => value + 1)}
      >
        Replay
      </button>
    </div>
  );
}
