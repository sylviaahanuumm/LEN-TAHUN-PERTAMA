import { sendProblem } from "../_problem.js";
import { applyRateLimit } from "../_rate-limit.js";
import { changeOwnPassword, requireAuth, revokeSessionId } from "../_rbac.js";
import { createSession, sessionCookie } from "../_session.js";

// Ganti kata sandi sendiri (RBAC). POST { currentPassword, newPassword }
//   200 { ok: true }            berhasil; semua sesi lama akun ini berhenti, browser ini mendapat sesi baru
//   400 { ok: false, error }    kata sandi lama salah / kata sandi baru tidak memenuhi aturan
// Boleh dipakai walau akun masih "wajib ganti kata sandi" (login pertama atau setelah di-reset Admin).

function isSecure(req) {
  if (process.env.VERCEL || process.env.COOKIE_SECURE === "1") return true;
  if (process.env.TRUST_PROXY !== "1") return false;
  return String(req.headers?.["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  if ((req.method || "GET") !== "POST") return sendProblem(res, 405, "Gunakan POST.", { ok: false });
  const allowed = await applyRateLimit(req, res, { name: "change-password", limit: 10, windowSeconds: 10 * 60 });
  if (!allowed) return;
  const auth = await requireAuth(req, res, null, { allowMustChange: true });
  if (!auth) return;
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const { currentPassword, newPassword } = body;
  if (typeof currentPassword !== "string" || typeof newPassword !== "string" || currentPassword.length > 256 || newPassword.length > 256) {
    return sendProblem(res, 400, "Isi kata sandi lama dan kata sandi baru.", { ok: false });
  }
  const result = await changeOwnPassword(auth.user, currentPassword, newPassword, auth.ip);
  if (!result.ok) return sendProblem(res, result.status, result.message, { ok: false });
  // Sesi lama dicabut; browser ini langsung mendapat sesi baru dengan session_version terbaru.
  await revokeSessionId(auth.session.sid, auth.session.exp);
  const { token, payload } = await createSession(result.user.username, Date.now(), { uid: result.user.id, sv: Number(result.user.session_version) });
  res.setHeader("Set-Cookie", sessionCookie(token, payload, { secure: isSecure(req) }));
  return res.json({ ok: true });
}
