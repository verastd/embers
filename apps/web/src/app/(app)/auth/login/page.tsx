/**
 * /auth/login (PRD 7.3, F-301): sign in with GitHub (TD's decision in place
 * of email + password). Explains every way an attempt can come back, each in
 * one line with what to do, and offers the button again. Already signed in:
 * says so and links onward.
 */
import { safeNext } from '@embers/auth';
import { Button, Card, PageHeader } from '@embers/ui';

import { signInAvailable } from '@/server/auth/config';
import { SIGN_IN_ERRORS } from '@/server/auth/http';
import type { SignInError } from '@/server/auth/http';
import { getPublicSession } from '@/server/auth/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Sign in' };

const WHY: Record<SignInError, string> = {
  unavailable: 'Sign-in isn’t configured on this server yet. Browsing works without an account.',
  expired: 'That sign-in attempt expired after 10 minutes. Start again.',
  state: 'That sign-in attempt didn’t match this browser, so it was refused. Start again from this page.',
  denied: 'GitHub sign-in was cancelled. Nothing was shared. Try again when you’re ready.',
  github: 'GitHub didn’t complete the sign-in. Try again in a moment.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const rawError = typeof sp.error === 'string' ? sp.error : undefined;
  const error = SIGN_IN_ERRORS.find((e) => e === rawError);
  const next = safeNext(typeof sp.next === 'string' ? sp.next : null);
  const user = await getPublicSession();
  const available = signInAvailable();

  return (
    <>
      <PageHeader title="Sign in" lede="Embers uses your GitHub account to sign you in. It reads your public profile only and keeps no GitHub token." />
      <Card style={{ maxWidth: 520, justifyItems: 'start', gap: 14 }}>
        {error && (
          <p role="alert" style={{ margin: 0, font: 'var(--type-body)', color: 'var(--state-error)' }}>
            {WHY[error]}
          </p>
        )}
        {user ? (
          <>
            <p style={{ margin: 0 }}>You’re signed in as {user.login}.</p>
            <Button as="a" href={next} variant="primary" icon="arrow-right">
              Continue
            </Button>
          </>
        ) : available ? (
          <Button as="a" href={`/auth/signin?next=${encodeURIComponent(next)}`} variant="primary" icon="log-in">
            {error && error !== 'unavailable' ? 'Try again with GitHub' : 'Sign in with GitHub'}
          </Button>
        ) : (
          !error && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{WHY.unavailable}</p>
        )}
      </Card>
    </>
  );
}
