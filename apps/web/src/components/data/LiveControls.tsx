'use client';

/**
 * The live-page header control (PRD 5.4): the LiveIndicator (connecting,
 * live with last update and countdown, reconnecting with attempt, paused
 * with Resume, offline / error with Retry, "N new" pill) plus a Pause
 * button while polling runs, so the user can stop the feed moving.
 */
import { Button, LiveIndicator } from '@embers/ui';

import type { LivePoller } from '@/lib/useLive';

export function LiveControls({ live, newCount, onJumpToNew }: { live: LivePoller; newCount?: number; onJumpToNew?: () => void }) {
  const status = live.indicator.status;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <LiveIndicator {...live.indicator} newCount={newCount} onJumpToNew={onJumpToNew} />
      {status !== 'paused' && status !== 'error' && status !== 'offline' && (
        <Button size="dense" variant="ghost" icon="pause" onClick={live.pause} aria-label="Pause live updates" style={{ height: 24, padding: '0 8px' }}>
          Pause
        </Button>
      )}
    </span>
  );
}
