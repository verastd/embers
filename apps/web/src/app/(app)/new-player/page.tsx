'use client';

/**
 * New player guide (F-1904): a four-step wizard.
 *   1. Welcome: what Upland is, in a few lines.
 *   2. Pick a city: every city from the ledger's per-city market, cheapest
 *      median UPX ask first, with the day it describes and a search box.
 *   3. The five cheapest open UPX listings in that city, each with a copy
 *      button for the address and a link to it in Properties search.
 *   4. Where to go next.
 * Both reads go through DataState (loading skeleton, empty, error with
 * Retry); Copy runs AsyncButton states.
 */
import Link from 'next/link';
import { AsyncButton, Block, Button, Card, DataTable, PageHeader, StatusGlyph, TextField } from '@embers/ui';
import type { Column } from '@embers/ui';
import type { CityDay, Listing } from '@embers/ledger';
import { useMemo, useState } from 'react';

import { LIST, PROSE } from '@/components/content/prose';
import { Region } from '@/components/data/Region';
import { formatDay, formatInt, formatMultiple, formatUpx, NONE, utcDayOffset } from '@/lib/format';
import { useLedgerQuery } from '@/lib/hooks';
import { latestPerCity, matchesCity, propertySearchHref } from '@/lib/new-player';
import { queryKey } from '@/lib/query-core';

const STEPS = ['Welcome', 'Pick a city', 'Cheapest properties', 'Where next'] as const;
const CHEAPEST = 5;

function Stepper({ step }: { step: number }) {
  return (
    <ol aria-label="Guide steps" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: '8px 20px' }}>
      {STEPS.map((label, i) => (
        <li
          key={label}
          aria-current={i === step ? 'step' : undefined}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: 'var(--type-body-sm)', fontWeight: i === step ? 600 : 400, color: i === step ? 'var(--text-primary)' : 'var(--text-muted)' }}
        >
          <StatusGlyph status={i < step ? 'done' : 'pending'} size={14} />
          <span>
            {i + 1}. {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Nav({ step, onStep, nextDisabled }: { step: number; onStep: (n: number) => void; nextDisabled?: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {step > 0 && (
        <Button icon="arrow-left" onClick={() => onStep(step - 1)}>
          Back
        </Button>
      )}
      {step < STEPS.length - 1 &&
        (nextDisabled ? (
          <Button variant="primary" iconRight="arrow-right" aria-disabled title={nextDisabled}>
            Next
          </Button>
        ) : (
          <Button variant="primary" iconRight="arrow-right" onClick={() => onStep(step + 1)}>
            Next
          </Button>
        ))}
      {nextDisabled && <span style={{ alignSelf: 'center', font: 'var(--type-caption)', color: 'var(--text-muted)' }}>{nextDisabled}</span>}
    </div>
  );
}

function Welcome() {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <p style={PROSE}>Upland is a metaverse mapped to the real world: its properties are real addresses in real cities, and players buy, sell and collect them.</p>
      <ul style={LIST}>
        <li>Properties are bought and sold in UPX, Upland&apos;s in-game currency, and every property you own earns a small UPX yield.</li>
        <li>Each property has a mint price; players list properties for sale above or below it, so prices differ a lot between cities.</li>
        <li>New players start at the Visitor level and move up to Uplander and beyond as they play.</li>
      </ul>
      <p style={PROSE}>This guide finds where a first property is cheapest right now: pick a city by its median asking price, then see the five cheapest UPX listings there.</p>
    </div>
  );
}

function PickCity({ city, onPick }: { city: string | null; onPick: (c: string) => void }) {
  const [after] = useState(() => utcDayOffset(3));
  const [q, setQ] = useState('');
  const cities = useLedgerQuery<CityDay[]>(queryKey('/market/cities', { after }), (c, signal) => c.market.cities({ after }, { signal }), { heavy: true });
  const rows = useMemo(() => latestPerCity(cities.data ?? []), [cities.data]);
  const shown = rows.filter((r) => matchesCity(r.city, q));
  const columns: Column<CityDay>[] = [
    { key: 'city', label: 'City', render: (r) => r.city },
    { key: 'median_ask_upx', label: 'Median ask', num: true, render: (r) => (r.median_ask_upx === null ? NONE : formatUpx(r.median_ask_upx)) },
    { key: 'sales', label: 'Sales that day', num: true, muted: true, render: (r) => formatInt(r.sales) },
    { key: 'day', label: 'Updated', muted: true, render: (r) => formatDay(r.day) },
    {
      key: 'pick',
      label: 'Choose',
      align: 'right',
      render: (r) => (
        <Button size="dense" variant={r.city === city ? 'primary' : 'secondary'} icon={r.city === city ? 'check' : undefined} onClick={() => onPick(r.city)} aria-pressed={r.city === city}>
          {r.city === city ? 'Chosen' : 'Choose'}
        </Button>
      ),
    },
  ];
  return (
    <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      <p style={PROSE}>Cities sorted by the median UPX asking price of their listings on the latest day the ledger has, cheapest first.</p>
      <TextField label="Find a city" placeholder="City name" icon="search" value={q} onChange={setQ} width={260} />
      <Region
        query={cities}
        skeleton={<DataTable<CityDay> columns={columns} rows={[]} loading skeletonRows={10} />}
        emptyMessage="The ledger has no city market data for the last few days"
      >
        {() =>
          shown.length === 0 ? (
            <p role="status" style={PROSE}>
              No city matches “{q}”.{' '}
              <Button size="dense" variant="ghost" onClick={() => setQ('')}>
                Clear search
              </Button>
            </p>
          ) : (
            <DataTable<CityDay> columns={columns} rows={shown} rowKey={(r) => r.city} maxHeight={420} footer={<span>{formatInt(shown.length)} cities</span>} />
          )
        }
      </Region>
    </div>
  );
}

function copyText(text: string): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return Promise.reject(new Error('Copying is not available in this browser'));
  return navigator.clipboard.writeText(text);
}

function Cheapest({ city }: { city: string }) {
  const params = { city, open: true, book: 'upx' as const, sort: 'ask_upx' as const, order: 'asc' as const, limit: CHEAPEST };
  const listings = useLedgerQuery(queryKey('/listings', params), (c, signal) => c.listings.list(params, { signal }), { isEmpty: (d) => !d.data.some((l) => l.ask_upx > 0) });
  const columns: Column<Listing>[] = [
    { key: 'address', label: 'Address', render: (l) => l.address || `#${l.property_id}` },
    { key: 'neighborhood', label: 'Neighborhood', muted: true, render: (l) => l.neighborhood || NONE },
    { key: 'ask_upx', label: 'Ask', num: true, render: (l) => formatUpx(l.ask_upx) },
    { key: 'mint_price_upx', label: 'Mint price', num: true, muted: true, render: (l) => (l.mint_price_upx > 0 ? formatUpx(l.mint_price_upx) : NONE) },
    { key: 'ask_to_mint', label: 'Markup', num: true, muted: true, render: (l) => (l.ask_to_mint > 0 ? formatMultiple(l.ask_to_mint) : NONE) },
    {
      key: 'actions',
      label: 'Actions',
      align: 'right',
      render: (l) => (
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'start', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <AsyncButton size="dense" variant="secondary" icon="copy" label="Copy address" pendingLabel="Copying…" successLabel="Copied" onAction={() => copyText(`${l.address}, ${l.city}`)} />
          <Button as={Link} size="dense" variant="ghost" iconRight="arrow-right" href={propertySearchHref(l.address, l.city)}>
            Open
          </Button>
        </span>
      ),
    },
  ];
  return (
    <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
      <p style={PROSE}>Up to {CHEAPEST} of the cheapest properties listed for UPX in {city} right now, from the chain&apos;s open listings. Search for the address in Upland to buy one.</p>
      <Region
        query={listings}
        skeleton={<DataTable<Listing> columns={columns} rows={[]} loading skeletonRows={CHEAPEST} />}
        emptyMessage={`No open UPX listings in ${city}. Go back and pick another city.`}
      >
        {(d) => <DataTable<Listing> columns={columns} rows={d.data.filter((l) => l.ask_upx > 0)} rowKey={(l) => l.property_id} />}
      </Region>
    </div>
  );
}

function WhereNext({ city }: { city: string | null }) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <p style={PROSE}>In Upland:</p>
      <ul style={LIST}>
        <li>
          <a href="https://play.upland.me" target="_blank" rel="noreferrer">
            play.upland.me
          </a>{' '}
          to play Upland in the browser
        </li>
        <li>
          <a href="https://www.upland.me" target="_blank" rel="noreferrer">
            upland.me
          </a>
          , Upland&apos;s official site
        </li>
        <li>
          <a href="https://ledger.upland.me" target="_blank" rel="noreferrer">
            ledger.upland.me
          </a>{' '}
          to look up transactions on the Upland chain
        </li>
      </ul>
      <p style={PROSE}>In Embers:</p>
      <ul style={LIST}>
        <li>
          <Link href={city ? `/properties/search?${new URLSearchParams({ search: '1', city, listing: 'listed', currency: 'upx', sort: 'ask_upx', order: 'asc' }).toString()}` : '/properties/search'}>
            Properties search
          </Link>{' '}
          {city ? `for every UPX listing in ${city}, cheapest first` : 'to explore every city'}
        </li>
        <li>
          <Link href="/feedback">Feedback</Link> if something in this guide was unclear
        </li>
      </ul>
    </div>
  );
}

export default function NewPlayerPage() {
  const [step, setStep] = useState(0);
  const [city, setCity] = useState<string | null>(null);
  const body = [<Welcome key="w" />, <PickCity key="p" city={city} onPick={setCity} />, city ? <Cheapest key="c" city={city} /> : null, <WhereNext key="n" city={city} />][step];
  return (
    <>
      <PageHeader title="New player guide" lede="Four steps from zero to your first property: what Upland is, where property is cheapest, and the cheapest listings there." />
      <Stepper step={step} />
      <Block id="step" title={`${step + 1}. ${STEPS[step]}`}>
        <Card>
          {body}
          <Nav step={step} onStep={setStep} nextDisabled={step === 1 && !city ? 'Choose a city first' : undefined} />
        </Card>
      </Block>
    </>
  );
}
