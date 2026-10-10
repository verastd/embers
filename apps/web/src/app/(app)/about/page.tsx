/**
 * About (F-1908): what Embers is, how it works, credits and the disclaimer
 * (not affiliated with Uplandme, Inc.; do your own research). Every claim
 * here is checkable in the code: the data path, the libraries, the fonts.
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { Block, PageHeader, StatusBanner } from '@embers/ui';

import { LIST, PROSE, Prose } from '@/components/content/prose';

export const metadata: Metadata = { title: 'About' };

const CREDITS: ReadonlyArray<{ name: string; href: string; use: string }> = [
  { name: 'Next.js', href: 'https://nextjs.org', use: 'the web app' },
  { name: 'React', href: 'https://react.dev', use: 'the interface' },
  { name: 'TanStack Query', href: 'https://tanstack.com/query', use: 'loading and refreshing data' },
  { name: 'Apache ECharts', href: 'https://echarts.apache.org', use: 'charts' },
  { name: 'Lucide', href: 'https://lucide.dev', use: 'icons' },
  { name: 'Zod', href: 'https://zod.dev', use: 'checking every answer from the data service' },
  { name: 'next-themes', href: 'https://github.com/pacocoursey/next-themes', use: 'light and dark themes' },
  { name: 'Work Sans and Geist Mono', href: 'https://fontsource.org', use: 'type, self-hosted through Fontsource' },
];

export default function AboutPage() {
  return (
    <>
      <PageHeader title="About Embers" lede="Analytics for Upland, the metaverse mapped to the real world: property markets, owners and listings, read from the Upland chain." />

      <Block id="what" title="What Embers is">
        <Prose>
          <p style={PROSE}>
            Embers turns Upland&apos;s public activity into tools you can search and compare. It starts with properties: search every property Embers has seen by city, neighborhood, address, status,
            owner, listing and price, with more tools listed in the <Link href="/changelog">changelog</Link> as they ship.
          </p>
          <p style={PROSE}>Public pages need no account. Signing in (with GitHub) is optional.</p>
        </Prose>
      </Block>

      <Block id="how" title="Where the data comes from">
        <Prose>
          <p style={PROSE}>
            Upland records property mints, sales, listings and transfers on its blockchain. The Upland Ledger indexes that chain, and Embers reads from it through its own server. Some property
            details come from the Upland Developers API where the ledger has them. Your browser never talks to these sources directly.
          </p>
          <p style={PROSE}>The Troubleshoot page shows whether Embers can reach the ledger right now and how far behind the chain its data is.</p>
        </Prose>
      </Block>

      <Block id="principles" title="How Embers works">
        <ul style={LIST}>
          <li>Every button and every loading region shows what it is doing: loading, slow, done or failed, with the reason.</li>
          <li>When data cannot be loaded, Embers says so and offers a retry. It never fills the gap with made-up numbers.</li>
          <li>Public analytics are open to everyone, without an account.</li>
        </ul>
      </Block>

      <Block id="credits" title="Credits">
        <p style={PROSE}>Embers is built on open-source software, including:</p>
        <ul style={LIST}>
          {CREDITS.map((c) => (
            <li key={c.name}>
              <a href={c.href} target="_blank" rel="noreferrer">
                {c.name}
              </a>{' '}
              for {c.use}
            </li>
          ))}
        </ul>
      </Block>

      <Block id="disclaimer" title="Disclaimer">
        <StatusBanner kind="info">
          Embers is not affiliated with, endorsed by or sponsored by Uplandme, Inc. Figures are estimates from public data and may be delayed or incomplete. Nothing here is financial advice: do your own
          research.
        </StatusBanner>
        <p style={PROSE}>
          See also the <Link href="/privacy">privacy policy</Link> and the <Link href="/terms">terms</Link>. Found something wrong? <Link href="/feedback">Send feedback</Link>.
        </p>
      </Block>
    </>
  );
}
