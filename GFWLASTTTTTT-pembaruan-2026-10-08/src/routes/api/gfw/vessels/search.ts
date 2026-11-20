import { createFileRoute } from "@tanstack/react-router";
import { searchVessels } from "@/lib/gfw.server";
import { errorMessage, problemResponse } from "@/lib/problem";

const MAX_QUERY_LENGTH = 100;

// T-64: limit harus bilangan bulat 1–50; selain itu (abc, -5, kosong) memakai nilai bawaan 20 (sama dengan T-16).
function parseLimit(value: string | null): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? Math.min(50, n) : 20;
}

export const Route = createFileRoute("/api/gfw/vessels/search")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const query = (url.searchParams.get("query") || "").trim(); // R-130: yang diteruskan adalah nilai yang sudah dipangkas
        const limit = parseLimit(url.searchParams.get("limit"));
        if (!query) {
          return Response.json({ entries: [] });
        }
        // M-164: query yang terlalu panjang ditolak sebelum diteruskan ke GFW.
        if (query.length > MAX_QUERY_LENGTH) {
          return problemResponse(400, `query paling panjang ${MAX_QUERY_LENGTH} karakter.`, { entries: [] });
        }
        try {
          const vessels = await searchVessels(query, limit);
          return Response.json({ entries: vessels });
        } catch (e) {
          console.error("[gfw-search] gagal:", e);
          return problemResponse(500, errorMessage(e, "search failed"), { entries: [] });
        }
      },
    },
  },
});
