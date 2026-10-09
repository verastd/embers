/**
 * TanStack Query defaults for every ledger read. 15 s staleTime matches the
 * ledger's own cache window; retries are the user's call (DataState's Retry),
 * never silent; the previous page stays visible while the next one loads.
 */
export const QUERY_DEFAULTS = {
  queries: {
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  },
} as const;
