// F3-S (laporan audit B.4 dan Fase 3): Vercel Routing Middleware. Berjalan di server Vercel SEBELUM halaman, data,
// atau API dikirim, dan memeriksa cookie sesi login (api/_session.js).
//   - Halaman tanpa sesi    → diarahkan ke halaman login, lalu kembali ke halaman semula setelah login.
//   - Data/API tanpa sesi   → 401 (format RFC 7807).
//   - Sesi aktif            → lanjut; cookie diperbarui bila perlu (batas diam 30 menit).
// Dokumentasi: https://vercel.com/docs/routing-middleware/js-reference
import { next } from "@vercel/functions";
import { decideAccess, isPageRequest, UNAUTHORIZED_BODY } from "./api/_session.js";

// Balasan 503 (format RFC 7807) bila pemeriksaan sesi sendiri gagal, misalnya Redis sedang gangguan.
const SERVICE_UNAVAILABLE_BODY = JSON.stringify({
  type: "about:blank",
  title: "Service Unavailable",
  status: 503,
  detail: "Pemeriksaan sesi login sedang gagal. Coba lagi sebentar lagi.",
  error: "Pemeriksaan sesi login sedang gagal. Coba lagi sebentar lagi.",
});

// Sengaja tanpa matcher: middleware berjalan di semua alamat, termasuk /assets/. Pengecualian /assets/ diputuskan
// di kode (isPublicPath), yang juga menolak alamat seperti /assets/..%2fdashboard.html; pemeriksaannya ringan
// (tanpa hitungan kriptografi) untuk berkas tampilan.

export default async function middleware(request) {
  const url = new URL(request.url);
  let decision;
  try {
    decision = await decideAccess({
      method: request.method,
      url: request.url,
      cookieHeader: request.headers.get("cookie"),
      secure: url.protocol === "https:",
    });
  } catch (err) {
    // T-25 (kesepakatan #1): bila pemeriksaan sesi error, akses tetap DITOLAK (fail-closed), tidak pernah diloloskan.
    console.error("[middleware] pemeriksaan sesi gagal:", err);
    if (isPageRequest(url.pathname)) {
      const location = `/index.html?next=${encodeURIComponent(url.pathname + url.search)}`;
      return new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });
    }
    return new Response(SERVICE_UNAVAILABLE_BODY, {
      status: 503,
      headers: { "content-type": "application/problem+json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  if (decision.action === "allow") {
    return decision.setCookie ? next({ headers: { "set-cookie": decision.setCookie } }) : next();
  }
  if (decision.action === "redirect") {
    return new Response(null, { status: 302, headers: { location: decision.location, "cache-control": "no-store" } });
  }
  return new Response(UNAUTHORIZED_BODY, {
    status: 401,
    headers: { "content-type": "application/problem+json; charset=utf-8", "cache-control": "no-store" },
  });
}
