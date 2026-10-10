/**
 * Privacy (F-1910): cookies, data collected, sharing and your choices, as
 * the code actually behaves: GitHub sign-in with a sealed session cookie,
 * preferences in local storage, no analytics or advertising trackers, ledger
 * reads attributed to the signed-in GitHub identity, feedback filed as a
 * GitHub issue. Keep it in step with `@embers/auth` cookies and
 * `server/ledger-auth.ts` / `server/feedback.ts`.
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { Block, PageHeader } from '@embers/ui';

import { LIST, PROSE, Prose, Updated } from '@/components/content/prose';

export const metadata: Metadata = { title: 'Privacy' };

export default function PrivacyPage() {
  return (
    <>
      <PageHeader title="Privacy" lede="What Embers stores, what it sends where, and how to remove it. Embers collects as little as it can." />
      <Updated day="2026-10-10" />

      <Block id="summary" title="In short">
        <ul style={LIST}>
          <li>You can use every public page without an account and without any cookie.</li>
          <li>If you sign in with GitHub, Embers keeps your GitHub user ID, username, display name and avatar address in an encrypted cookie in your browser. Embers has no user database.</li>
          <li>Embers uses no analytics, advertising or third-party tracking cookies or scripts.</li>
        </ul>
      </Block>

      <Block id="cookies" title="Cookies">
        <Prose>
          <p style={PROSE}>Embers sets two cookies, both only when you choose to sign in. Both are HttpOnly (page scripts cannot read them) and limited to this site.</p>
          <ul style={LIST}>
            <li>
              <strong>Session cookie</strong> (<code>__Host-embers_session</code>): encrypted; holds your GitHub user ID, username, display name and avatar address. It expires 7 days after you sign
              in and is deleted when you sign out.
            </li>
            <li>
              <strong>Sign-in cookie</strong> (<code>__Host-embers_oauth</code>): exists only during a sign-in attempt, for at most 10 minutes, and holds the one-time values that protect the attempt.
              It is deleted when GitHub sends you back.
            </li>
          </ul>
        </Prose>
      </Block>

      <Block id="local" title="Stored in your browser only">
        <p style={PROSE}>
          Embers keeps your favorites, your last 10 searches, which sidebar sections are open, and your theme in your browser&apos;s local storage. They never leave your device. The{' '}
          <Link href="/troubleshoot">Troubleshoot</Link> page clears them.
        </p>
      </Block>

      <Block id="github" title="Signing in with GitHub">
        <p style={PROSE}>
          When you sign in, GitHub tells Embers your user ID, username, display name and avatar address. Embers uses GitHub&apos;s access token once to read that profile and then revokes it; the token
          is never stored. While you are signed in, your browser loads your avatar image from GitHub.
        </p>
      </Block>

      <Block id="sharing" title="What is sent to others">
        <ul style={LIST}>
          <li>
            <strong>Data requests.</strong> Embers reads Upland data from the Upland Ledger through Embers&apos; own server. When you are signed in, each request carries a short-lived signed statement
            of your GitHub user ID and username, so the ledger&apos;s access gateway knows who is reading. Signed out, requests go out under Embers&apos; own service identity, and nothing about you is
            sent.
          </li>
          <li>
            <strong>Feedback.</strong> What you submit on the <Link href="/feedback">Feedback</Link> page (nickname, type, comment and, for a reported problem, the page) is filed as an issue in the
            Embers team&apos;s GitHub repository, where the people with access to that repository can read it.
          </li>
          <li>
            <strong>Hosting.</strong> The servers that host Embers may record standard request details, such as IP address, time and the page requested, to run and protect the service.
          </li>
        </ul>
        <p style={PROSE}>Embers does not sell or rent personal data.</p>
      </Block>

      <Block id="choices" title="Your choices">
        <ul style={LIST}>
          <li>Sign out at any time from the account menu; the session cookie is deleted.</li>
          <li>Use Embers without signing in; no cookie is set.</li>
          <li>Clear local storage on the Troubleshoot page, or clear this site&apos;s data in your browser settings.</li>
          <li>You can also revoke Embers&apos; access in your GitHub settings under Applications.</li>
        </ul>
      </Block>

      <Block id="changes" title="Changes">
        <p style={PROSE}>
          When what Embers collects changes, this page changes with it and the date above is updated. Changes are also listed in the <Link href="/changelog">changelog</Link>. See also the{' '}
          <Link href="/terms">terms</Link>.
        </p>
      </Block>
    </>
  );
}
