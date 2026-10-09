'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EmbersThemeProvider } from '@embers/ui';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { QUERY_DEFAULTS } from '@/lib/query';

/** Theme (next-themes, light | dark | system) and server state (TanStack Query) for every route. */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: QUERY_DEFAULTS }));
  return (
    <EmbersThemeProvider>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </EmbersThemeProvider>
  );
}
