'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

/** Crea un QueryClient con i default dell'app. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

/**
 * Provider di React Query.
 * Il client è creato in uno state per non essere condiviso tra richieste durante
 * il rendering server e per sopravvivere all'hot reload.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(createQueryClient);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
