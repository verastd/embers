/**
 * ConfirmDialog (PRD 5.1, 5.8): destructive actions (delete watchlist,
 * delete listing, unsubscribe, delete account). Says what will happen, then
 * an AsyncButton confirms. With `typedConfirmation` the confirm button stays
 * disabled, with its reason, until the user types that exact text.
 *
 * While the action runs the dialog can't be dismissed (no half-done
 * deletes); on failure it stays open with the server's reason and Retry.
 * It closes itself only after the action resolves.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { AsyncButton } from '../core/AsyncButton';
import { Button } from '../core/Button';
import { TextField } from '../kit/TextField';
import { Dialog } from './Dialog';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** What will happen, in one or two sentences ("This deletes 'Flips' and its 25 properties."). */
  description: ReactNode;
  confirmLabel: string;
  /** Present progressive: "Deleting…". */
  pendingLabel: string;
  /** Text the user must type to enable confirm (an email, a name). */
  typedConfirmation?: string;
  danger?: boolean;
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}

export function ConfirmDialog({ open, title, description, confirmLabel, pendingLabel, typedConfirmation, danger = true, onConfirm, onClose }: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!open) {
      setTyped('');
      setRunning(false);
    }
  }, [open]);

  const matches = typedConfirmation === undefined || typed === typedConfirmation;
  const close = (): void => {
    if (!running) onClose();
  };

  return (
    <Dialog
      open={open}
      title={title}
      blocking={running}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close} aria-disabled={running || undefined} title={running ? 'Wait for the action to finish' : undefined}>
            Cancel
          </Button>
          <AsyncButton
            label={confirmLabel}
            pendingLabel={pendingLabel}
            variant={danger ? 'danger' : 'primary'}
            disabledReason={matches ? undefined : `Type ${typedConfirmation ?? ''} to confirm`}
            onAction={async () => {
              setRunning(true);
              try {
                await onConfirm();
              } finally {
                setRunning(false);
              }
              onClose();
            }}
          />
        </>
      }
    >
      <div style={{ display: 'grid', gap: 12, font: 'var(--type-body)' }}>
        <div>{description}</div>
        {typedConfirmation !== undefined && (
          <TextField
            label={`Type ${typedConfirmation} to confirm`}
            value={typed}
            onChange={setTyped}
            width="100%"
            size="standard"
            mono
            disabledReason={running ? 'Working…' : undefined}
          />
        )}
      </div>
    </Dialog>
  );
}
