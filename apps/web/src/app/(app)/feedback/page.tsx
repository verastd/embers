'use client';

/**
 * Feedback (F-1907): nickname, type (Bug, Improvement, Praise) and a comment
 * of at least 10 characters, sent to POST /api/v1/feedback, which files it
 * in the feedback inbox and answers with a reference. Fields validate as
 * you go once touched, and all at once on Send; the Send button runs
 * pending, success and error (with the server's reason and request id). A
 * server without an inbox answers `feedback_not_configured`, shown as an
 * error: the page never says "sent" when nothing was sent.
 *
 * `?type=Bug&page=/x` (the "Report" link from an error state) prefills it.
 */
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AsyncButton, Block, Button, Card, FactList, PageHeader, Segment, Skeleton, StatusBanner, TextField } from '@embers/ui';
import { Suspense, useId, useState } from 'react';

import { COMMENT_MAX, COMMENT_MIN, FEEDBACK_TYPES, NICKNAME_MAX, isFeedbackType, safePagePath, validateFeedback } from '@/lib/feedback';
import type { FeedbackErrors, FeedbackType } from '@/lib/feedback';
import { FeedbackSendError, sendFeedback } from '@/lib/feedback-client';

export default function FeedbackPage() {
  return (
    <Suspense fallback={<Skeleton height={320} />}>
      <FeedbackForm />
    </Suspense>
  );
}

interface Sent {
  reference: string;
  requestId: string | null;
  type: FeedbackType;
}

function FeedbackForm() {
  const params = useSearchParams();
  const initialType = params?.get('type');
  const page = safePagePath(params?.get('page') ?? undefined);
  const [nickname, setNickname] = useState('');
  const [type, setType] = useState<FeedbackType | ''>(isFeedbackType(initialType) ? initialType : '');
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState<Record<'nickname' | 'type' | 'comment', boolean>>({ nickname: false, type: false, comment: false });
  const [serverErrors, setServerErrors] = useState<FeedbackErrors>({});
  const [sent, setSent] = useState<Sent | null>(null);
  const commentId = useId();

  const errors = validateFeedback({ nickname, type, comment });
  const shown = (k: 'nickname' | 'type' | 'comment'): string | undefined => (touched[k] ? (errors[k] ?? serverErrors[k]) : undefined);
  const length = comment.trim().length;
  const commentError = shown('comment');

  const submit = async ({ signal }: { signal: AbortSignal }): Promise<void> => {
    setTouched({ nickname: true, type: true, comment: true });
    setServerErrors({});
    if (Object.keys(errors).length > 0 || !isFeedbackType(type)) throw new Error('Fix the highlighted fields first');
    try {
      const res = await sendFeedback({ nickname: nickname.trim(), type, comment: comment.trim(), ...(page ? { page } : {}) }, signal);
      setSent({ reference: res.reference, requestId: res.requestId, type });
      setNickname('');
      setComment('');
      setType('');
      setTouched({ nickname: false, type: false, comment: false });
    } catch (e) {
      if (e instanceof FeedbackSendError) {
        if (e.fields) setServerErrors(e.fields);
        throw new Error(e.requestId ? `${e.message} (request ${e.requestId})` : e.message);
      }
      throw e;
    }
  };

  return (
    <>
      <PageHeader title="Feedback" lede="Report a bug, suggest an improvement or say what works." />

      {sent && (
        <Card>
          <div role="status" style={{ display: 'grid', gap: 8 }}>
            <strong style={{ font: 'var(--type-title)', color: 'var(--text-primary)' }}>Thanks, your feedback was filed</strong>
            <FactList
              items={[
                { term: 'Reference', value: sent.reference, mono: true },
                { term: 'Type', value: sent.type },
                ...(sent.requestId ? [{ term: 'Request ID', value: sent.requestId, mono: true }] : []),
              ]}
            />
            <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>Quote the reference if you follow up about it.</span>
          </div>
          <div>
            <Button size="dense" icon="plus" onClick={() => setSent(null)}>
              Send more feedback
            </Button>
          </div>
        </Card>
      )}

      {!sent && (
        <Block id="form" title="Your feedback" note="Fields marked * are required.">
          {page && <StatusBanner kind="info">Reporting a problem on {page}. That page is sent with your feedback.</StatusBanner>}
          <form
            noValidate
            onSubmit={(e) => e.preventDefault()}
            style={{ display: 'grid', gap: 16, maxWidth: 640, minWidth: 0 }}
          >
            <TextField
              label="Nickname (optional)"
              placeholder="How we can address you"
              value={nickname}
              onChange={setNickname}
              onBlur={() => setTouched((t) => ({ ...t, nickname: true }))}
              maxLength={NICKNAME_MAX + 10}
              error={shown('nickname')}
              icon="user"
              width="100%"
              size="standard"
            />
            <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
              <span style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
                Type *
              </span>
              <Segment<FeedbackType>
                label="Type"
                value={type || undefined}
                onChange={(v) => {
                  setType(v);
                  setTouched((t) => ({ ...t, type: true }));
                }}
                options={FEEDBACK_TYPES.map((t) => ({ value: t, label: t }))}
              />
              {shown('type') && (
                <span role="alert" style={{ font: 'var(--type-caption)', color: 'var(--state-error)' }}>
                  {shown('type')}
                </span>
              )}
            </div>
            <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
              <label htmlFor={commentId} style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
                Comment *
              </label>
              <textarea
                id={commentId}
                value={comment}
                rows={6}
                maxLength={COMMENT_MAX + 100}
                placeholder="What happened, what you expected, or what you would like to see"
                aria-invalid={commentError ? true : undefined}
                aria-describedby={`${commentId}-count${commentError ? ` ${commentId}-error` : ''}`}
                onChange={(e) => setComment(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, comment: true }))}
                style={{
                  boxSizing: 'border-box',
                  width: '100%',
                  minWidth: 0,
                  resize: 'vertical',
                  padding: '8px var(--control-padding-x)',
                  font: 'var(--type-body-sm)',
                  color: 'var(--text-primary)',
                  background: 'var(--surface-card)',
                  border: `1px solid ${commentError ? 'var(--state-error)' : 'var(--border-strong)'}`,
                  borderRadius: 'var(--radius-md)',
                }}
              />
              <span id={`${commentId}-count`} style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
                {length < COMMENT_MIN ? `${COMMENT_MIN - length} more characters needed` : `${length} / ${COMMENT_MAX} characters`}
              </span>
              {commentError && (
                <span id={`${commentId}-error`} role="alert" style={{ font: 'var(--type-caption)', color: 'var(--state-error)' }}>
                  {commentError}
                </span>
              )}
            </div>
            <div>
              <AsyncButton label="Send feedback" pendingLabel="Sending…" successLabel="Sent" icon="message-circle" onAction={submit} />
            </div>
          </form>
        </Block>
      )}

      <Block id="where" title="Where it goes">
        <p style={{ margin: 0, font: 'var(--type-body-sm)', color: 'var(--text-secondary)', maxWidth: '72ch' }}>
          Your feedback is filed in the Embers team's feedback inbox with the nickname you give, the type, your comment and, for a reported problem, the page it happened on. Do not include passwords,
          keys or other private details. See the <Link href="/privacy">privacy policy</Link>.
        </p>
      </Block>
    </>
  );
}
