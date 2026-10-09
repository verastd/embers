/**
 * InlineField (PRD 5.1 / 5.7): a text input with validation, async
 * validation and saving states. States: default, invalid (specific message
 * below), validating (inline spinner in the field), valid (check), saving
 * (spinner, "Saving…"), saved (check, "Saved", 1.5 s), save error (message +
 * the field stays editable; Enter or blur retries).
 *
 * Sync `validate` runs on every change; `validateAsync` runs after a 400 ms
 * pause and is aborted when the value changes again. `onSave` commits on
 * blur or Enter (never per keystroke), only when the value is valid and
 * changed since the last save.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { Icon } from '../core/Icon';
import { Spinner } from '../core/Spinner';
import { TextField } from './TextField';
import type { TextFieldProps } from './TextField';

export type InlineFieldStatus = 'idle' | 'validating' | 'valid' | 'invalid' | 'saving' | 'saved' | 'save-error';

export interface InlineFieldProps extends Pick<TextFieldProps, 'label' | 'placeholder' | 'icon' | 'disabledReason' | 'maxLength' | 'width' | 'size' | 'mono'> {
  value: string;
  onChange: (value: string) => void;
  /** Returns a specific message when invalid, else null. */
  validate?: (value: string) => string | null;
  /** Server-side check (e.g. "username exists"). Returns a message or null. */
  validateAsync?: (value: string, signal: AbortSignal) => Promise<string | null>;
  /** Commit; rejects with an Error whose message is shown. */
  onSave?: (value: string) => Promise<unknown>;
  /** Shown after a successful async validation, e.g. "Account found". */
  validMessage?: string;
  debounceMs?: number;
  /** Controlled override (server-driven forms, stories): shows this state and `message`. */
  status?: InlineFieldStatus;
  message?: string;
  style?: CSSProperties;
}

export function InlineField({
  value,
  onChange,
  validate,
  validateAsync,
  onSave,
  validMessage,
  debounceMs = 400,
  status: controlledStatus,
  message: controlledMessage,
  style,
  ...field
}: InlineFieldProps) {
  const statusId = useId();
  const [innerStatus, setStatus] = useState<InlineFieldStatus>('idle');
  const [innerMessage, setMessage] = useState<string | null>(null);
  const status = controlledStatus ?? innerStatus;
  const message = controlledStatus ? (controlledMessage ?? null) : innerMessage;
  const savedValue = useRef(value);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Validation: sync first, then async after a pause. Re-runs per value.
  useEffect(() => {
    const syncError = validate?.(value) ?? null;
    if (syncError) {
      setStatus('invalid');
      setMessage(syncError);
      return undefined;
    }
    if (!validateAsync || value === '') {
      setStatus('idle');
      setMessage(null);
      return undefined;
    }
    const ctrl = new AbortController();
    setStatus('validating');
    setMessage(null);
    const t = setTimeout(() => {
      validateAsync(value, ctrl.signal).then(
        (err) => {
          if (ctrl.signal.aborted) return;
          setStatus(err ? 'invalid' : 'valid');
          setMessage(err ?? validMessage ?? null);
        },
        (e: unknown) => {
          if (ctrl.signal.aborted) return;
          setStatus('invalid');
          setMessage(`Couldn't check: ${e instanceof Error ? e.message : 'unknown error'}. Edit the value to try again.`);
        },
      );
    }, debounceMs);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [value, validate, validateAsync, validMessage, debounceMs]);

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  const commit = (): void => {
    if (!onSave || field.disabledReason) return;
    if (status === 'invalid' || status === 'validating' || status === 'saving') return;
    if (value === savedValue.current) return;
    setStatus('saving');
    setMessage(null);
    onSave(value).then(
      () => {
        savedValue.current = value;
        setStatus('saved');
        setMessage('Saved');
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => {
          setStatus('idle');
          setMessage(null);
        }, 1500);
      },
      (e: unknown) => {
        setStatus('save-error');
        setMessage(`Not saved: ${e instanceof Error ? e.message : 'unknown error'}. Press Enter to retry.`);
      },
    );
  };

  const busy = status === 'validating' || status === 'saving';
  const ok = status === 'valid' || status === 'saved';
  const trailing = busy ? (
    <Spinner size={14} label="" />
  ) : ok ? (
    <Icon name="check" size={14} style={{ color: 'var(--state-success)' }} />
  ) : null;
  const errorText = status === 'invalid' || status === 'save-error' ? message : null;
  const statusText = status === 'validating' ? 'Checking…' : status === 'saving' ? 'Saving…' : ok ? message : null;

  return (
    <span style={{ display: 'inline-grid', gap: 2, ...style }} aria-busy={busy ? 'true' : undefined}>
      <TextField
        {...field}
        value={value}
        onChange={onChange}
        error={errorText}
        trailing={trailing}
        describedBy={statusId}
        onBlur={commit}
        onEnter={commit}
      />
      <span id={statusId} aria-live="polite" style={{ font: 'var(--type-caption)', color: ok ? 'var(--state-success)' : 'var(--text-muted)', minHeight: statusText ? undefined : 0 }}>
        {statusText}
      </span>
    </span>
  );
}
