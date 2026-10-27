import { useState } from 'react';
import { AlertIcon, CrossIcon, GitMergeIcon, Icon, type IconSvgElement, LockIcon, NeutralIcon, TickIcon } from '../icons';
import { VendorMark } from '../site';

/**
 * The three policies a project can run (artifacts/api-server: OBSERVE,
 * REVIEW, ENFORCE), and what each does to the same pull request's merge box.
 */

type Mode = 'OBSERVE' | 'REVIEW' | 'ENFORCE';

const MODES: ReadonlyArray<{ value: Mode; label: string; summary: string }> = [
  {
    value: 'OBSERVE',
    label: 'Report only',
    summary: 'A neutral check and one comment. Merging is never affected. Every project starts here.',
  },
  {
    value: 'REVIEW',
    label: 'Ask for a decision',
    summary: 'Out-of-scope or unclear work marks the check as needing action, so someone decides before it ships.',
  },
  {
    value: 'ENFORCE',
    label: 'Fail the check',
    summary: 'Excluded work fails the check. With branch protection, the merge waits for an approved change.',
  },
];

type Tone = 'neutral' | 'warn' | 'alert';

const CHECK: Record<Mode, { tone: Tone; result: string }> = {
  OBSERVE: { tone: 'neutral', result: 'Neutral — out-of-scope work found' },
  REVIEW: { tone: 'warn', result: 'Action required — needs a decision' },
  ENFORCE: { tone: 'alert', result: 'Failed — excluded by §4.2' },
};

/* One bare glyph per state; its colour and the result text carry the tone. */
const TONE_ICON: Record<Tone, IconSvgElement> = { neutral: NeutralIcon, warn: AlertIcon, alert: CrossIcon };

export function PolicyDemo() {
  const [mode, setMode] = useState<Mode>('REVIEW');
  const check = CHECK[mode];

  return (
    <div className="policy">
      <fieldset className="policy-modes">
        <legend className="sr-only">What the GitHub check does</legend>
        {MODES.map((option, index) => (
          <label key={option.value} className={`policy-mode ${mode === option.value ? 'is-active' : ''}`}>
            <input
              type="radio"
              name="policy-demo"
              value={option.value}
              checked={mode === option.value}
              onChange={() => setMode(option.value)}
              className="sr-only"
            />
            <span className="policy-mode-num mono">{String(index + 1).padStart(2, '0')}</span>
            <span className="policy-mode-text">
              <strong>{option.label}</strong>
              <span>{option.summary}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="merge" data-mode={mode} aria-live="polite">
        <div className="merge-head">
          <span className="merge-repo mono">
            <VendorMark name="github" size={13} />
            northstar / portal · #1842
          </span>
          <span className="merge-title">Add organization-level permissions</span>
        </div>

        <ul className="merge-checks">
          <li>
            <span className="merge-icon is-ok"><Icon icon={TickIcon} size={16} strokeWidth={2} /></span>
            <span className="mono">build</span>
            <span className="merge-result">Successful</span>
          </li>
          <li>
            <span className="merge-icon is-ok"><Icon icon={TickIcon} size={16} strokeWidth={2} /></span>
            <span className="mono">test:unit</span>
            <span className="merge-result">Successful</span>
          </li>
          <li className={`is-${check.tone}`}>
            <span className={`merge-icon is-${check.tone}`}>
              <Icon icon={TONE_ICON[check.tone]} size={16} strokeWidth={2} />
            </span>
            <span className="mono">scopeci / commercial</span>
            <span className="merge-result">{check.result}</span>
          </li>
        </ul>

        <div className="merge-foot" key={mode}>
          {mode === 'OBSERVE' && (
            <>
              <p className="merge-status is-ok">
                <Icon icon={TickIcon} size={16} />
                All checks have passed
              </p>
              <p className="merge-note">The ScopeCI comment still names §4.2 for whoever reviews it.</p>
              <span className="merge-button is-ok">
                <Icon icon={GitMergeIcon} size={14} />
                Merge pull request
              </span>
            </>
          )}
          {mode === 'REVIEW' && (
            <>
              <p className="merge-status is-warn">
                <Icon icon={AlertIcon} size={16} />
                Some checks need attention
              </p>
              <p className="merge-note">
                The check links to the project in ScopeCI, where a PM sends the drafted change order and records the
                client’s answer.
              </p>
              <span className="merge-button is-quiet">
                <Icon icon={GitMergeIcon} size={14} />
                Merge pull request
              </span>
            </>
          )}
          {mode === 'ENFORCE' && (
            <>
              <p className="merge-status is-alert">
                <Icon icon={LockIcon} size={16} />
                Merging is blocked
              </p>
              <p className="merge-note">Branch protection requires scopeci / commercial. It passes once the change is approved.</p>
              <span className="merge-button is-disabled">
                <Icon icon={GitMergeIcon} size={14} />
                Merge pull request
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
