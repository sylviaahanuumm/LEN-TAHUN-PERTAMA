import { createFileRoute } from "@tanstack/react-router";
import { getTrack } from "@/lib/gfw.server";
import { errorMessage, problemResponse } from "@/lib/problem";
import { checkDateRange } from "@/lib/date-range";

// R-128: ID kapal GFW berupa huruf/angka dengan tanda hubung (contoh 9b3e9019d-d67f-005a-9593-b66b997559e5).
// Nilai di luar bentuk itu (pemisah path, teks sangat panjang) ditolak di sini, tidak diteruskan ke GFW.
const VESSEL_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const Route = createFileRoute("/api/gfw/track")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const vesselId = url.searchParams.get("vessel_id") || "";
        const startDate = url.searchParams.get("start_date") || "";
        const endDate = url.searchParams.get("end_date") || "";
        if (!vesselId || !startDate || !endDate) {
          return problemResponse(400, "vessel_id, start_date, end_date required");
        }
        if (!VESSEL_ID.test(vesselId)) {
          return problemResponse(400, "vessel_id hanya boleh huruf, angka, _ dan -, paling panjang 64 karakter.");
        }
        // M-163: tanggal diperiksa (YYYY-MM-DD yang ada, awal <= akhir) sebelum diteruskan ke GFW.
        const range = checkDateRange(startDate, endDate);
        if (!range.ok) return problemResponse(400, range.detail);
        try {
          const data = await getTrack(vesselId, range.start, range.end);
          return Response.json(data);
        } catch (e) {
          // R-129: yang dicatat hanya pesan galatnya, bukan objek galat lengkap (stack berisi path internal).
          console.error("[gfw-track] gagal:", e instanceof Error ? e.message : String(e));
          return problemResponse(500, errorMessage(e, "track failed"));
        }
      },
    },
  },
});
