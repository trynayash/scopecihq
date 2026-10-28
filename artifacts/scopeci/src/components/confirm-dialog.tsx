import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { type ReactNode, useCallback, useRef, useState } from 'react';

export interface ConfirmOptions {
  title: string;
  description: ReactNode;
  /** Names the action, e.g. "Archive project"; never "OK" or "Yes". */
  confirmLabel: string;
  /** Destructive actions get the danger button. */
  danger?: boolean;
}

/**
 * An in-page replacement for window.confirm. `confirm` resolves to true only
 * when the action button is pressed; Cancel, Escape and clicking outside all
 * resolve to false. Render `dialog` once, anywhere in the component.
 */
export function useConfirm() {
  const [open, setOpen] = useState(false);
  // Kept after closing so the text doesn't vanish during the exit animation.
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const settle = useCallback((confirmed: boolean) => {
    resolver.current?.(confirmed);
    resolver.current = null;
    setOpen(false);
  }, []);

  const confirm = useCallback((next: ConfirmOptions) => {
    resolver.current?.(false);
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOptions(next);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const dialog = (
    <AlertDialog.Root open={open} onOpenChange={(next) => !next && settle(false)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-overlay" />
        <AlertDialog.Content
          className="dialog"
          data-testid="confirm-dialog"
          // Without a Trigger, Radix has nowhere to send focus back to.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (opener.current?.isConnected) opener.current.focus();
          }}
        >
          <AlertDialog.Title className="dialog-title">{options?.title}</AlertDialog.Title>
          <AlertDialog.Description className="dialog-description">{options?.description}</AlertDialog.Description>
          <div className="dialog-actions">
            <AlertDialog.Cancel className="button button-quiet">Cancel</AlertDialog.Cancel>
            <AlertDialog.Action
              className={`button ${options?.danger ? 'button-quiet button-danger' : 'button-primary'}`}
              onClick={() => settle(true)}
              data-testid="button-confirm"
            >
              {options?.confirmLabel}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );

  return [confirm, dialog] as const;
}
