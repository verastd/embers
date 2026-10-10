/**
 * Changelog (F-1906): what changed, grouped by year with a count per year;
 * each entry has its date, the features it shipped and links to the routes
 * it touched. Entries come from `lib/changelog.ts` (the repository history).
 */
import Link from 'next/link';
import type { Metadata } from 'next';
import { Badge, Block, EventTimeline, PageHeader } from '@embers/ui';

import { CHANGELOG, groupByYear } from '@/lib/changelog';
import { formatDay } from '@/lib/format';

export const metadata: Metadata = { title: 'Changelog' };

export default function ChangelogPage() {
  const years = groupByYear(CHANGELOG);
  return (
    <>
      <PageHeader title="Changelog" lede="What changed in Embers, newest first." />
      {years.map((y) => (
        <Block key={y.year} id={`y${y.year}`} title={y.year} note={`${y.entries.length} ${y.entries.length === 1 ? 'change' : 'changes'}`}>
          <EventTimeline
            density="comfortable"
            entries={y.entries.map((e, i) => ({
              id: `${e.date}-${i}`,
              date: e.date,
              dateLabel: formatDay(e.date),
              title: e.title,
              status: 'done',
              content: (
                <div style={{ display: 'grid', gap: 8 }}>
                  <p style={{ margin: 0, font: 'var(--type-body-sm)', color: 'var(--text-secondary)', maxWidth: '72ch' }}>{e.detail}</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    {e.routes.map((r) => (
                      <Link key={r.href} href={r.href} style={{ font: 'var(--type-body-sm)', color: 'var(--text-link)' }}>
                        {r.label}
                      </Link>
                    ))}
                    {e.features.map((f) => (
                      <Badge key={f} size="xs">
                        {f}
                      </Badge>
                    ))}
                  </div>
                </div>
              ),
            }))}
          />
        </Block>
      ))}
    </>
  );
}
