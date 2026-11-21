import { sendProblem } from "../_problem.js";
import crypto from "node:crypto";
import { applyRateLimit, clientIpKey } from "../_rate-limit.js";
import { incrementWithTtl } from "../_redis.js";
import { createSession, sessionCookie, sessionSecret } from "../_session.js";

// Login Ocean Nexus diperiksa di server. Nama pengguna dan kata sandi dibaca dari pengaturan server
// (LOGIN_USERNAME dan LOGIN_PASSWORD di .env.local atau Vercel), tidak lagi tertulis di kode halaman.
// POST { username, password }  →  200 { ok: true } | 401 { ok: false } | 429 (terlalu sering) | 503 (belum diatur)
// F3-S (laporan audit B.4 dan Fase 3): login yang benar mendapat cookie sesi HttpOnly (api/_session.js); halaman,
// data, dan API lain hanya dikirim server bila cookie itu sah (middleware.js di Vercel).

// M-016: header x-forwarded-proto bisa diisi siapa saja, jadi hanya dipercaya bila server memang di belakang proxy
// tepercaya (TRUST_PROXY=1). Di Vercel cookie selalu Secure; di server sendiri bisa dipaksa dengan COOKIE_SECURE=1.
// Aturan ini sama dengan server/index.mjs (T-50).
function isSecure(req) {
  if (process.env.VERCEL || process.env.COOKIE_SECURE === "1") return true;
  if (process.env.TRUST_PROXY !== "1") return false;
  return String(req.headers?.["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

// M-017: jeda bertahap untuk login gagal beruntun dari IP yang sama: 1, 2, 4, lalu paling lama 8 detik, dihitung
// dalam jendela 10 menit (sama dengan batas login). Bersama batas 10 percobaan / 10 menit, tebakan kata sandi jadi lambat.
const FAIL_WINDOW_SECONDS = 10 * 60;
const MAX_FAIL_DELAY_MS = 8000;

async function delayAfterFailure(req) {
  let failures = 1;
  try {
    failures = await incrementWithTtl(`login-fail:${clientIpKey(req)}`, FAIL_WINDOW_SECONDS);
  } catch (err) {
    console.warn("[login] penghitung gagal login tidak tersedia:", err?.message || err);
  }
  const ms = Math.min(1000 * 2 ** Math.max(0, failures - 1), MAX_FAIL_DELAY_MS);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
}

// Perbandingan dengan waktu tetap, supaya lama jawaban tidak membocorkan berapa huruf yang sudah benar.
function sameText(given, expected) {
  const a = crypto.createHash("sha256").update(String(given ?? "")).digest();
  const b = crypto.createHash("sha256").update(String(expected ?? "")).digest();
  return crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  if ((req.method || "GET") !== "POST") {
    return sendProblem(res, 405, "Gunakan POST.", { ok: false });
  }

  const allowed = await applyRateLimit(req, res, { name: "login", limit: 10, windowSeconds: 10 * 60 });
  if (!allowed) return;

  const expectedUser = String(process.env.LOGIN_USERNAME || "").trim();
  const expectedPassword = String(process.env.LOGIN_PASSWORD || "");
  if (!expectedUser || !expectedPassword || !sessionSecret()) {
    console.warn("[login] LOGIN_USERNAME / LOGIN_PASSWORD / SESSION_SECRET (minimal 32 karakter) belum diatur di server.");
    return sendProblem(res, 503, "Login belum diatur di server.", { ok: false });
  }

  const { username, password } = readBody(req);
  const userOk = sameText(String(username ?? "").trim(), expectedUser);
  const passwordOk = sameText(password, expectedPassword);
  if (!(userOk && passwordOk)) {
    await delayAfterFailure(req);
    return sendProblem(res, 401, "Nama pengguna atau kata sandi salah.", { ok: false });
  }
  try {
    const { token, payload } = await createSession(expectedUser);
    res.setHeader("Set-Cookie", sessionCookie(token, payload, { secure: isSecure(req) }));
    return res.json({ ok: true });
  } catch (err) {
    console.error("[login] sesi gagal dibuat:", err);
    return sendProblem(res, 500, "Gagal membuat sesi. Coba lagi.", { ok: false });
  }
}
