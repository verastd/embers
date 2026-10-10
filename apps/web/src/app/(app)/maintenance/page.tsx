/**
 * Maintenance (F-1911). Routes named by the maintenance flag render this page
 * (see `middleware.ts`, `lib/maintenance.ts`); `?from=` is the route the
 * visitor asked for. Opened directly, or with the flag off, it says plainly
 * that nothing is under maintenance and which routes are when something is.
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { Block, Button, PageHeader, StatusBanner } from '@embers/ui';

import { LIST, PROSE } from '@/components/content/prose';
import { isMaintenanceActive, isUnderMaintenance, readMaintenance } from '@/lib/maintenance';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Maintenance', robots: { index: false } };

export default async function MaintenancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const flag = readMaintenance(process.env);
  const raw = (await searchParams).from;
  const from = typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') ? raw.slice(0, 200) : null;
  const blocked = from !== null && isUnderMaintenance(from, flag);
  const active = isMaintenanceActive(flag);

  if (blocked) {
    return (
      <>
        <PageHeader eyebrow="Maintenance" title="This page is under maintenance" lede="It will be back as soon as the work is done. Other pages still work." />
        <StatusBanner kind="maintenance">
          <span className="em-num">{from}</span> is temporarily unavailable.{flag.message ? ` ${flag.message}` : ''}
        </StatusBanner>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button as="a" href={from} variant="primary" icon="refresh-cw">
            Try again
          </Button>
          <Button as="a" href="/troubleshoot" icon="life-buoy">
            Troubleshoot
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Maintenance" lede="When part of Embers is down for maintenance, its pages show a notice here instead." />
      {active ? (
        <Block id="now" title="Under maintenance now">
          <StatusBanner kind="maintenance">{flag.message ?? 'Some pages are temporarily unavailable.'}</StatusBanner>
          <ul style={LIST}>
            {flag.all ? <li>Every page</li> : flag.prefixes.map((p) => <li key={p}><span className="em-num">{p}</span> and the pages under it</li>)}
          </ul>
        </Block>
      ) : (
        <Block id="now" title="Status">
          <StatusBanner kind="info">Nothing is under maintenance. Every page is available.</StatusBanner>
          <p style={PROSE}>
            If a page is not working for you, the <Link href="/troubleshoot">Troubleshoot</Link> page checks your connection to Embers.
          </p>
        </Block>
      )}
    </>
  );
}
