import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../core/Button';
import { LockedFeature } from '../core/LockedFeature';
import { Toast, ToastStack } from '../core/Toast';
import type { ToastStackItem } from '../core/Toast';
import { ConfirmDialog } from '../feedback/ConfirmDialog';
import { State, States, wait } from './_helpers';

const meta: Meta = { title: 'Primitives/Toast, ConfirmDialog, LockedFeature' };
export default meta;

export const Toasts: StoryObj = {
  name: 'Toast (PRD 5.8)',
  render: () => {
    const [items, setItems] = useState<ToastStackItem[]>([]);
    const push = (variant: ToastStackItem['variant'], title: string): void => setItems((xs) => [...xs, { id: String(Date.now()), variant, title }]);
    return (
      <States>
        <State name="success / info / error (static)">
          <div style={{ display: 'grid', gap: 8, maxWidth: 380 }}>
            <Toast variant="success" title="Copied" duration={0} />
            <Toast variant="info" title="Saved filter applied" duration={0} />
            <Toast variant="error" title="Upland returned 502" description="Your balance was not changed." actionLabel="Retry" onAction={() => undefined} onClose={() => undefined} />
          </div>
        </State>
        <State name="live stack: success/info auto-dismiss after 4 s, errors persist">
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={() => push('success', 'Copied')}>Success</Button>
            <Button onClick={() => push('info', 'Filters saved')}>Info</Button>
            <Button onClick={() => push('error', 'Upland returned 502')}>Error</Button>
          </div>
          <ToastStack toasts={items} onClose={(id) => setItems((xs) => xs.filter((x) => x.id !== id))} />
        </State>
      </States>
    );
  },
};

export const Confirm: StoryObj = {
  name: 'ConfirmDialog (PRD 5.8)',
  render: () => {
    const [open, setOpen] = useState<'plain' | 'typed' | 'fails' | null>(null);
    return (
      <States>
        <State name="open one">
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="danger" onClick={() => setOpen('plain')}>Delete watchlist</Button>
            <Button variant="danger" onClick={() => setOpen('typed')}>Delete account (typed)</Button>
            <Button variant="danger" onClick={() => setOpen('fails')}>Delete listing (fails)</Button>
          </div>
        </State>
        <ConfirmDialog open={open === 'plain'} title="Delete watchlist" description="This deletes “Flips” and its 25 properties." confirmLabel="Delete" pendingLabel="Deleting…" onConfirm={() => wait(1200)} onClose={() => setOpen(null)} />
        <ConfirmDialog
          open={open === 'typed'}
          title="Delete account"
          description="Your account is deleted after a 7-day grace period. You can cancel until then."
          confirmLabel="Delete account"
          pendingLabel="Deleting…"
          typedConfirmation="td@example.com"
          onConfirm={() => wait(1200)}
          onClose={() => setOpen(null)}
        />
        <ConfirmDialog open={open === 'fails'} title="Delete listing" description="The bundle returns to your wallet." confirmLabel="Delete" pendingLabel="Deleting…" onConfirm={() => wait(1200, 'Upland returned 502. The listing is still live.')} onClose={() => setOpen(null)} />
      </States>
    );
  },
};

export const Locked: StoryObj = {
  name: 'LockedFeature (PRD 5.6)',
  render: () => (
    <States>
      <State name="signed in, below tier">
        <LockedFeature feature="Collection optimizer" tier="Premium" value="Find the collection mix that maximizes your yield." onUpgrade={() => undefined} onCompare={() => undefined} />
      </State>
      <State name="anonymous">
        <LockedFeature feature="Watchlists" tier="Basic" anonymous value="Track price drops on the properties you care about." onLogin={() => undefined} onSignup={() => undefined} />
      </State>
      <State name="compact">
        <LockedFeature feature="FSA only" tier="Basic" compact onUpgrade={() => undefined} />
      </State>
    </States>
  ),
};
