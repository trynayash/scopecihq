import { useEffect, useState } from 'react';
import { CopyIcon, Icon, TickIcon } from '../icons';

/** How long "Copied" stays before the button offers to copy again. */
const CONFIRM_MS = 2000;

/**
 * Copies `text` and confirms it in place: the icon turns into a tick and
 * the label into "Copied", in a button that keeps its width, then both turn
 * back. A screen reader hears the confirmation through a live region.
 */
export function CopyButton({ text, onCopied }: { text: string; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), CONFIRM_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  // New text has not been copied yet.
  useEffect(() => setCopied(false), [text]);

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
    <button type="button" className={`button button-quiet copy-button ${copied ? 'is-copied' : ''}`} onClick={copy}>
      <span className="copy-glyph" aria-hidden="true">
        <Icon icon={CopyIcon} size={14} />
        <Icon icon={TickIcon} size={14} />
      </span>
      {/* Both labels hold the space, so the button doesn't change width. */}
      <span className="copy-label">
        <span aria-hidden={copied}>Copy</span>
        <span aria-hidden={!copied}>Copied</span>
      </span>
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied to the clipboard' : ''}
      </span>
    </button>
  );
}
