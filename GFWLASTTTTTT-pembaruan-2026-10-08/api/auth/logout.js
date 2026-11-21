import { sendProblem } from "../_problem.js";
import { clearSessionCookie, readCookie, revokeSession, SESSION_COOKIE, verifySessionToken } from "../_session.js";

// F3-S: keluar (logout). POST → cookie sesi dihapus dari browser dan ID sesinya dicatat sebagai dicabut
// (lihat revokeSession di api/_session.js). Selalu 200 { ok: true }, juga bila sesinya sudah tidak berlaku.

// M-018: aturan Secure sama dengan api/auth/login.js (M-016) dan server/index.mjs (T-50): header x-forwarded-proto
// hanya dipercaya bila TRUST_PROXY=1; di Vercel selalu Secure; COOKIE_SECURE=1 memaksa Secure.
function isSecure(req) {
  if (process.env.VERCEL || process.env.COOKIE_SECURE === "1") return true;
  if (process.env.TRUST_PROXY !== "1") return false;
  return String(req.headers?.["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

// R-015: catatan terstruktur (satu baris JSON) supaya mudah dicari/dihitung di log Vercel bila pencabutan sesi
// tidak tersimpan di Redis, misalnya karena Redis mati berkepanjangan.
function logRevokeProblem(reason, err) {
  console.error(JSON.stringify({
    level: "error",
    event: "logout_revoke_not_shared",
    reason,
    detail: err ? String(err?.message || err) : undefined,
    time: new Date().toISOString(),
  }));
}

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  if ((req.method || "GET") !== "POST") {
    return sendProblem(res, 405, "Gunakan POST.", { ok: false });
  }
  // R-014: verifikasi juga dilindungi, supaya janji "selalu 200 { ok: true }" tetap berlaku bila terjadi galat.
  let payload = null;
  try {
    payload = await verifySessionToken(readCookie(req.headers?.cookie, SESSION_COOKIE));
  } catch (err) {
    console.warn("[logout] cookie sesi tidak bisa diperiksa:", err?.message || err);
  }
  if (payload) {
    try {
      const shared = await revokeSession(payload);
      if (!shared) logRevokeProblem("redis_tidak_diatur_atau_gagal");
    } catch (err) {
      logRevokeProblem("galat", err);
    }
  }
  res.setHeader("Set-Cookie", clearSessionCookie({ secure: isSecure(req) }));
  return res.json({ ok: true });
}
