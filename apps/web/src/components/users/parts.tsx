'use client';

/**
 * Small pieces the user and leaderboard pages share: a profile link, the
 * rank cell (top 3 styled, PRD F-1606) and the likely-bot badge.
 */
import { Badge } from '@embers/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { userHref } from '@/lib/users';

const LINK_STYLE = { color: 'var(--text-link)', textDecoration: 'none', fontWeight: 500 } as const;

/** A link to `/users/<name or account>`. */
export function UserLink({ to, children }: { to: string; children?: ReactNode }) {
  return (
    <Link href={userHref(to)} style={LINK_STYLE}>
      {children ?? to}
    </Link>
  );
}

/** #1 to #3 carry a trophy badge; the rest a plain number. */
export function RankCell({ rank }: { rank: number }) {
  if (rank <= 3) {
    return (
      <Badge tone={rank === 1 ? 'accent' : 'new'} icon="trophy" aria-label={`Rank ${rank}`}>
        {rank}
      </Badge>
    );
  }
  return <span className="em-num">{rank}</span>;
}

/** The ledger's advisory bot inference, worded as one. */
export function BotBadge() {
  return (
    <Badge tone="warning" size="xs">
      Likely bot
    </Badge>
  );
}

/**
 * A caption over a radio group (Segment, Chips). FilterField wraps its
 * control in a <label>, which would rename the group's first radio; a radio
 * group carries its own aria-label, so its caption is visual only.
 */
export function GroupField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <span aria-hidden="true" style={{ font: 'var(--type-caption)', color: 'var(--text-muted)' }}>
        {label}
      </span>
      {children}
    </div>
  );
}
