'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EmbersThemeProvider } from '@embers/ui';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { LEDGER_QUERY_DEFAULTS } from '@/lib/hooks';

/** Theme (next-themes, light | dark | system) and server state (TanStack Query) for every route. */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: LEDGER_QUERY_DEFAULTS }));
  return (
    <EmbersThemeProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </EmbersThemeProvider>
  );
}
