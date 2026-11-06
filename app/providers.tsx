"use client";

/**
 * The two providers every page needs: the shared data cache and the wallet.
 * Roadmap: S4.1 · Spec: ARCHITECTURE.md §2, §5
 *
 * The `QueryClient` is created once per browser tab in a lazy `useState`, not at module scope: Next
 * renders on the server first, and a module-level client would be shared between every request.
 */

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { QUERY_DEFAULTS } from "@/lib/api/queries";
import { WalletProvider } from "@/components/wallet/WalletProvider";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: QUERY_DEFAULTS }));
  return (
    <QueryClientProvider client={client}>
      <WalletProvider>{children}</WalletProvider>
    </QueryClientProvider>
  );
}
