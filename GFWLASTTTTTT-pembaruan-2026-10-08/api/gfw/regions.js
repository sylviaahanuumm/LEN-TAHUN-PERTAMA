import { sendProblem } from "../_problem.js";
import { gfwBase, gfwToken } from "../_gfw-token.js";
import { cacheGet, cacheSet } from "../_redis.js";
import { applyRateLimit } from "../_rate-limit.js";

// Nama ZEE untuk kode wilayah di event GFW (regions.eez berisi id angka, mis. 8492 = Indonesia).
// GET  →  { eez: { [id]: { iso3, territory, label } } }

const CACHE_KEY = "gfw:regions:eez:v1";
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
const CDN_CACHE = "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800";
const TIMEOUT_MS = 15000;

// M-025: bila cache kosong, permintaan yang datang bersamaan menunggu satu pengambilan GFW yang sama.
let inflight = null;

async function loadRegions(token) {
  // M-024: alamat GFW dari gfwBase() (bisa diganti lewat GFW_BASE_URL), tidak lagi ditulis mati di file ini.
  const gfwRes = await fetch(`${gfwBase()}/datasets/public-eez-areas/context-layers`, {
    signal: AbortSignal.timeout(TIMEOUT_MS), // batas waktu 15 detik
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!gfwRes.ok) throw new Error(`GFW eez list ${gfwRes.status}`);
  const list = await gfwRes.json();

  const eez = {};
  for (const e of Array.isArray(list) ? list : []) {
    if (e?.id === null || e?.id === undefined) continue; // M-026: pemeriksaan ketat, bukan "== null"
    eez[String(e.id)] = { iso3: e.iso3 || null, territory: e.territory1 || null, label: e.label || null };
  }

  const payload = { eez };
  await cacheSet(CACHE_KEY, { payload, fetchedAt: Date.now() }, CACHE_TTL_SECONDS);
  return payload;
}

// R-017: batas waktu (TimeoutError/AbortError) dibedakan dari galat lain, karena pesan bawaannya bisa kosong.
function describeError(e) {
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return `GFW tidak menjawab dalam ${TIMEOUT_MS / 1000} detik`;
  return e?.message || "regions failed";
}

export default async function handler(req, res) {
  const allowed = await applyRateLimit(req, res, {
    name: "gfw-regions",
    limit: 30,
    windowSeconds: 10 * 60,
  });
  if (!allowed) return;

  const cached = await cacheGet(CACHE_KEY);
  if (cached?.payload) {
    res.setHeader("x-cache", "HIT");
    res.setHeader("cache-control", CDN_CACHE);
    return res.json(cached.payload);
  }

  const token = gfwToken();
  if (!token) return sendProblem(res, 500, "GFW_API_TOKEN not configured", { eez: {} });

  try {
    if (!inflight) inflight = loadRegions(token).finally(() => { inflight = null; });
    const payload = await inflight;
    res.setHeader("x-cache", "MISS");
    res.setHeader("cache-control", CDN_CACHE);
    res.json(payload);
  } catch (e) {
    const message = describeError(e);
    console.error("[gfw regions]", message);
    sendProblem(res, 500, message, { eez: {} });
  }
}
