import { type FormEvent, useState } from 'react';
import type { DemoScopeClause } from '@workspace/api-client-react';
import { CopyIcon, CrossIcon, Icon, PlusIcon, TickIcon } from './icons';

/**
 * Pieces the public demo and the signed-in app share: the scope checklist
 * editor, the words for each verdict, the change order box, and how API
 * errors are put into words.
 */

export const VERDICT: Record<string, { label: string; tone: 'alert' | 'warn' | 'ok' }> = {
  CHANGE_REQUIRED: { label: 'Change order needed', tone: 'alert' },
  REVIEW_REQUIRED: { label: 'Needs a decision', tone: 'warn' },
  IN_SCOPE: { label: 'In scope', tone: 'ok' },
  APPROVED_CHANGE: { label: 'Covered by an approved change', tone: 'ok' },
  BLOCKED: { label: 'Excluded work', tone: 'alert' },
  OVERRIDDEN: { label: 'Overridden', tone: 'ok' },
};

export const verdictOf = (state: string) => VERDICT[state] ?? { label: state, tone: 'warn' as const };

export function errorMessage(error: unknown, fallback: string): string {
  const data = (error as { data?: { error?: string; message?: string } } | null)?.data;
  const status = (error as { status?: number } | null)?.status;
  if (status === 429) return data?.message ?? 'Too many tries at once. Wait a minute.';
  if (status === undefined) return "We couldn't reach ScopeCI. Check your connection and try again.";
  return data?.error ?? fallback;
}

/* ------------------------------------------------------------------ */
/* Scope checklist                                                     */
/* ------------------------------------------------------------------ */

export function ItemList({
  id,
  label,
  tone,
  items,
  onChange,
}: {
  id: string;
  label: string;
  tone: 'included' | 'excluded';
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const add = (event: FormEvent) => {
    event.preventDefault();
    const item = draft.trim().toLowerCase();
    if (item && !items.includes(item)) onChange([...items, item]);
    setDraft('');
  };

  return (
    <div className={`scope-list is-${tone}`}>
      <p className="scope-list-label mono">{label}</p>
      {items.length === 0 ? (
        <p className="scope-list-empty">Nothing yet.</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item}>
              {tone === 'included' ? <Icon icon={TickIcon} size={13} /> : <Icon icon={CrossIcon} size={13} />}
              <span>{item}</span>
              <button
                type="button"
                className="scope-remove"
                onClick={() => onChange(items.filter((i) => i !== item))}
                aria-label={`Remove "${item}" from ${label.toLowerCase()}`}
              >
                <Icon icon={CrossIcon} size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="scope-add" onSubmit={add}>
        <label className="sr-only" htmlFor={id}>
          Add to {label.toLowerCase()}
        </label>
        <input
          id={id}
          value={draft}
          maxLength={300}
          placeholder={tone === 'included' ? 'Add included work' : 'Add excluded work'}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="scope-add-button" aria-label={`Add to ${label.toLowerCase()}`}>
          <Icon icon={PlusIcon} size={14} />
        </button>
      </form>
    </div>
  );
}

export const itemCount = (clauses: DemoScopeClause[]) =>
  clauses.reduce((n, c) => n + c.included.length + c.excluded.length, 0);

/**
 * Every clause with its included and excluded lists. Sections the SOW reader
 * found nothing in stay folded away until asked for, since most documents
 * have several.
 */
export function ScopeEditor({
  clauses,
  onChange,
  idPrefix = 'clause',
}: {
  clauses: DemoScopeClause[];
  onChange: (clauses: DemoScopeClause[]) => void;
  idPrefix?: string;
}) {
  const [showEmpty, setShowEmpty] = useState(false);
  const total = itemCount(clauses);
  const indexed = clauses.map((clause, index) => ({ clause, index }));
  const visible =
    total === 0
      ? indexed.slice(0, 1)
      : indexed.filter(({ clause }) => showEmpty || clause.included.length + clause.excluded.length > 0);
  const hidden = clauses.length - visible.length;

  const update = (index: number, patch: Partial<DemoScopeClause>) =>
    onChange(clauses.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  return (
    <>
      <div className="scope-clauses">
        {visible.map(({ clause, index }) => (
          <article className="scope-clause" key={`${clause.clauseRef}-${index}`}>
            <h3 className="scope-clause-title">
              <span className="mono">{clause.clauseRef}</span> {clause.title}
            </h3>
            <div className="scope-columns">
              <ItemList
                id={`${idPrefix}-${index}-included`}
                label="Included"
                tone="included"
                items={clause.included}
                onChange={(included) => update(index, { included })}
              />
              <ItemList
                id={`${idPrefix}-${index}-excluded`}
                label="Excluded"
                tone="excluded"
                items={clause.excluded}
                onChange={(excluded) => update(index, { excluded })}
              />
            </div>
          </article>
        ))}
      </div>
      {total > 0 && hidden > 0 && (
        <button type="button" className="text-link" onClick={() => setShowEmpty(true)}>
          Show {hidden} more section{hidden === 1 ? '' : 's'} with nothing listed
        </button>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Change order                                                        */
/* ------------------------------------------------------------------ */

export function ChangeOrderBox({
  id,
  text,
  onChange,
  onCopied,
  showHeading = true,
}: {
  id: string;
  text: string;
  onChange: (text: string) => void;
  onCopied?: () => void;
  /** Off when the box already sits under a "Change order draft" label. */
  showHeading?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onCopied?.();
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="change-order">
      <div className="change-order-head">
        {showHeading ? <h3>Change order draft</h3> : <span />}
        <button type="button" className="button button-quiet" onClick={copy}>
          <Icon icon={CopyIcon} size={14} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p className="help">Edit it, then send it to your client instead of doing the work for free.</p>
      <label className="sr-only" htmlFor={id}>
        Change order draft
      </label>
      <textarea
        id={id}
        className="textarea"
        rows={14}
        value={text}
        onChange={(e) => {
          onChange(e.target.value);
          setCopied(false);
        }}
      />
    </div>
  );
}

export const changeOrderText = (draft: { subject: string; body: string } | null | undefined) =>
  draft ? `Subject: ${draft.subject}\n\n${draft.body}` : '';
