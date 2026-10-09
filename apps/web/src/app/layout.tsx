import '@embers/ui/styles.css';
import '@embers/ui/fonts';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { Providers } from './providers';

export const metadata: Metadata = {
  title: { default: 'Embers', template: '%s · Embers' },
  description: 'Live Upland analytics: property markets, sparklet staking, community nodes and treasure timers.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
