/**
 * Terms (F-1910). The PRD's subscription, balance, escrow and refund terms
 * belong to features that do not exist yet (Phases 3 and 5); they are added
 * with them. This covers the service as it is.
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { Block, PageHeader } from '@embers/ui';

import { LIST, PROSE, Updated } from '@/components/content/prose';

export const metadata: Metadata = { title: 'Terms' };

export default function TermsPage() {
  return (
    <>
      <PageHeader title="Terms of use" lede="The rules for using Embers. By using the site you accept them." />
      <Updated day="2026-10-10" />

      <Block id="service" title="The service">
        <p style={PROSE}>
          Embers shows analytics about Upland built from public data. Public pages are free and need no account. Embers does not act in Upland for you: any in-game action happens in Upland itself.
        </p>
      </Block>

      <Block id="affiliation" title="No affiliation">
        <p style={PROSE}>Embers is independent. It is not affiliated with, endorsed by or sponsored by Uplandme, Inc. Upland names and data belong to their owners.</p>
      </Block>

      <Block id="accuracy" title="Data and estimates">
        <p style={PROSE}>
          Figures come from public sources and the Upland chain and may be delayed, incomplete or wrong. Many are estimates. Nothing on Embers is financial advice; do your own research before you buy,
          sell or build. Embers is provided as is, without warranties of any kind, and is not liable for decisions you make using it.
        </p>
      </Block>

      <Block id="accounts" title="Signing in">
        <p style={PROSE}>
          Signing in uses your GitHub account; keep it secure. A session lasts at most 7 days. How Embers handles your data is described in the <Link href="/privacy">privacy policy</Link>.
        </p>
      </Block>

      <Block id="use" title="Fair use">
        <ul style={LIST}>
          <li>Do not try to disrupt Embers, get around its limits, or reach data or accounts that are not yours.</li>
          <li>Do not overload Embers with automated requests.</li>
          <li>Embers may limit or end access for anyone who does.</li>
        </ul>
      </Block>

      <Block id="feedback" title="Feedback">
        <p style={PROSE}>If you send feedback, Embers may use it to improve the service without owing you anything for it.</p>
      </Block>

      <Block id="paid" title="Paid features">
        <p style={PROSE}>Embers does not sell subscriptions, hold balances or run a marketplace today. Terms for those will be published here before any of them launch.</p>
      </Block>

      <Block id="changes" title="Changes">
        <p style={PROSE}>These terms may change as Embers grows. The date above shows the latest version, and changes are listed in the <Link href="/changelog">changelog</Link>.</p>
      </Block>
    </>
  );
}
