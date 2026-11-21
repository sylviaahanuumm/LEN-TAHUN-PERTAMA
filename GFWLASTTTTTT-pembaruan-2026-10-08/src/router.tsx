import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

// M-161: data query dianggap masih segar selama 30 detik, jadi data yang sudah dimuat saat preload (misalnya saat
// kursor di atas tautan) dipakai lagi waktu pengguna benar-benar membuka halamannya, tidak diambil ulang.
// defaultPreloadStaleTime: 0 di bawah SENGAJA dibiarkan: itu pengaturan yang dianjurkan TanStack Router bila memakai
// TanStack Query, supaya router selalu menyerahkan keputusan "masih segar atau tidak" ke Query (lewat staleTime ini),
// bukan menyimpan cache sendiri yang terpisah.
const QUERY_STALE_TIME_MS = 30_000;

export function createQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { staleTime: QUERY_STALE_TIME_MS } } });
}

// R-122: di browser, QueryClient dibuat sekali lalu dipakai ulang, supaya cache query tidak hilang bila getRouter()
// dipanggil lagi (HMR, pemasangan ulang). Di server tetap dibuat baru untuk SETIAP permintaan, supaya data satu
// pengguna tidak pernah terbawa ke pengguna lain.
let browserQueryClient: QueryClient | undefined;

function getQueryClient(): QueryClient {
  if (typeof window === "undefined") return createQueryClient();
  browserQueryClient ??= createQueryClient();
  return browserQueryClient;
}

export const getRouter = () => {
  const queryClient = getQueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
