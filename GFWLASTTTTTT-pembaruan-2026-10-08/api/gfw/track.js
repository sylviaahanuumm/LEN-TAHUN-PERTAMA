import { sendProblem } from "../_problem.js";
import { gfwToken } from "../_gfw-token.js";
import { cacheGet, cacheSet } from "../_redis.js";
import { applyRateLimit } from "../_rate-limit.js";

const GFW_BASE = "https://gateway.api.globalfishingwatch.org/v3";
const GFW_TRACK_DATASET = "public-global-vessel-track:latest";
// Lintasan dianggap segar 6 jam (sama seperti sebelumnya). Simpanan disimpan 7 hari, supaya data lama masih bisa
// disajikan sebagai cadangan bila GFW sedang bermasalah.
const FRESH_TTL_MS = 6 * 60 * 60 * 1000;
const STALE_TTL_SECONDS = 7 * 24 * 60 * 60;
const GFW_EVENT_DATASETS = [
  "public-global-fishing-events:latest",
  "public-global-encounters-events:latest",
  "public-global-loitering-events:latest",
];

// M-031: event cadangan diambil per halaman 200, paling banyak 5 halaman (1000 event), sama dengan
// fetchEventPages di src/lib/gfw.server.ts (T-63). Bila masih ada sisa, payload diberi truncated: true.
const EVENTS_PAGE_SIZE = 200;
const EVENTS_MAX_PAGES = 5;
// C-2: bentuk ID kapal GFW (huruf heksadesimal dan tanda hubung), sama dengan api/gfw/gear.js. Nilai lain ditolak
// 400 sebelum diteruskan ke GFW atau dipakai sebagai kunci cache.
const VESSEL_ID_RE = /^[0-9a-f-]{20,64}$/i;

function toIsoDate(date) {
  return date.includes("T") ? date : `${date}T00:00:00Z`;
}

// T-15 (duplikat M-019): tanggal harus YYYY-MM-DD dan benar-benar ada di kalender (misalnya 2026-02-30 ditolak).
function isDay(value) {
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const ms = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === text;
}

function computeBounds(track) {
  if (!track.length) return null;
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const p of track) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  return [[minLat, minLon], [maxLat, maxLon]];
}

function cacheKey(vesselId, startDate, endDate) {
  // v3: event cadangan kini berhalaman (M-031) dan payload punya kolom truncated
  return `gfw:track:v3:${encodeURIComponent(vesselId)}:${startDate}:${endDate}`;
}

// R-019: waktu dari GFW berupa angka bisa dalam detik atau milidetik. Satuan ditebak (> 10 miliar = milidetik),
// lalu hasilnya dicek harus berada di sekitar rentang yang diminta; bila tidak, dicatat peringatan supaya
// perubahan satuan dari GFW tidak lolos diam-diam.
function makeTimeConverter(startDate, endDate) {
  const min = Date.parse(`${startDate}T00:00:00Z`) - 864e5;
  const max = Date.parse(`${endDate}T00:00:00Z`) + 2 * 864e5;
  let warned = false;
  return (value) => {
    if (value === undefined || value === null || value === "") return undefined;
    const ms = typeof value === "number" ? (value > 10_000_000_000 ? value : value * 1000) : Date.parse(value);
    if (!Number.isFinite(ms)) return undefined;
    if ((ms < min || ms > max) && !warned) {
      warned = true;
      console.warn(`[gfw track] waktu ${value} (${new Date(ms).toISOString()}) di luar rentang ${startDate}..${endDate}; periksa satuan waktu GFW`);
    }
    return new Date(ms).toISOString();
  };
}

async function fetchEventPages(headers, vesselId, startDate, endDate) {
  const all = [];
  let offset = 0;
  for (let page = 0; page < EVENTS_MAX_PAGES; page++) {
    const evUrl = new URL(`${GFW_BASE}/events`);
    evUrl.searchParams.set("limit", String(EVENTS_PAGE_SIZE));
    evUrl.searchParams.set("offset", String(offset));
    evUrl.searchParams.set("sort", "+start");
    const evRes = await fetch(evUrl.toString(), {
      signal: AbortSignal.timeout(15000), // batas waktu 15 detik
      method: "POST",
      headers,
      body: JSON.stringify({
        datasets: GFW_EVENT_DATASETS,
        startDate: toIsoDate(startDate),
        endDate: toIsoDate(endDate),
        vessels: [vesselId],
      }),
    });
    if (!evRes.ok) break;
    const j = await evRes.json();
    const entries = j?.entries ?? [];
    all.push(...entries);
    const nextOffset = j?.nextOffset;
    if (entries.length < EVENTS_PAGE_SIZE || nextOffset === null || nextOffset === undefined) return { entries: all, truncated: false };
    offset = Number(nextOffset) || offset + EVENTS_PAGE_SIZE;
  }
  return { entries: all, truncated: all.length >= EVENTS_PAGE_SIZE * EVENTS_MAX_PAGES };
}

export default async function handler(req, res) {
  const vesselId = req.query.vessel_id || "";
  const startDate = req.query.start_date || "";
  const endDate = req.query.end_date || "";

  if (!vesselId || !startDate || !endDate) {
    return sendProblem(res, 400, "vessel_id, start_date, end_date required");
  }
  if (!VESSEL_ID_RE.test(String(vesselId))) {
    return sendProblem(res, 400, "vessel_id harus berupa ID kapal GFW (huruf 0-9, a-f, dan tanda hubung; 20-64 karakter).");
  }
  if (!isDay(startDate) || !isDay(endDate) || startDate > endDate) {
    return sendProblem(res, 400, "start_date dan end_date harus berformat YYYY-MM-DD, dan start_date tidak boleh setelah end_date.");
  }

  const allowed = await applyRateLimit(req, res, {
    name: "gfw-track",
    limit: 60,
    windowSeconds: 10 * 60,
  });
  if (!allowed) return;

  const key = cacheKey(vesselId, startDate, endDate);
  const cached = await cacheGet(key);
  const fresh = cached?.payload && Date.now() - Number(cached.fetchedAt || 0) < FRESH_TTL_MS;
  if (fresh) {
    res.setHeader("x-cache", "HIT");
    res.setHeader("cache-control", "public, max-age=300, stale-while-revalidate=3600");
    res.setHeader("x-data-fetched-at", new Date(cached.fetchedAt).toISOString());
    return res.json(cached.payload);
  }

  const token = gfwToken();
  if (!token) return sendProblem(res, 500, "GFW_API_TOKEN not configured");

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  let track = [];
  let source = "tracks";
  let truncated = false;
  const toTime = makeTimeConverter(startDate, endDate);

  try {
    const url = new URL(`${GFW_BASE}/vessels/${encodeURIComponent(vesselId)}/tracks`);
    url.searchParams.set("datasets[0]", GFW_TRACK_DATASET);
    url.searchParams.set("start-date", startDate);
    url.searchParams.set("end-date", endDate);

    const gfwRes = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(15000) }); // batas waktu 15 detik

    if (gfwRes.ok) {
      const json = await gfwRes.json();
      const coords = json?.geometry?.coordinates ?? json?.features ?? json?.entries ?? [];
      const coordProps = json?.properties?.coordinateProperties ?? {};
      const times = coordProps?.times ?? coordProps?.time ?? [];
      const speeds = coordProps?.speed ?? coordProps?.speeds ?? [];
      const courses = coordProps?.course ?? coordProps?.courses ?? [];

      if (Array.isArray(coords) && coords.length && Array.isArray(coords[0])) {
        track = coords.map((c, i) => ({
          lon: c[0],
          lat: c[1],
          timestamp: toTime(times[i]),
          speed: speeds[i],
          course: courses[i],
        })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
      } else {
        const entries = Array.isArray(json) ? json : (json?.entries ?? []);
        track = entries.map((e) => ({
          lat: Number(e?.lat ?? e?.latitude ?? e?.geometry?.coordinates?.[1]),
          lon: Number(e?.lon ?? e?.longitude ?? e?.geometry?.coordinates?.[0]),
          timestamp: e?.timestamp ?? e?.properties?.timestamp,
          speed: e?.speed ?? e?.properties?.speed,
          course: e?.course ?? e?.properties?.course,
        })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
      }
    } else if (gfwRes.status === 404) {
      source = "events";
      const pages = await fetchEventPages(headers, vesselId, startDate, endDate);
      truncated = pages.truncated;
      track = pages.entries.map((e) => ({
        lat: Number(e?.position?.lat),
        lon: Number(e?.position?.lon),
        timestamp: e?.start,
        speed: undefined,
        course: undefined,
      })).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    } else {
      throw new Error(`GFW track failed: ${gfwRes.status}`);
    }

    const payload = {
      vessel_id: vesselId,
      start_date: startDate,
      end_date: endDate,
      source,
      count: track.length,
      truncated,
      bounds: computeBounds(track),
      track,
    };
    await cacheSet(key, { payload, fetchedAt: Date.now() }, STALE_TTL_SECONDS);
    res.setHeader("x-cache", "MISS");
    res.setHeader("cache-control", "public, max-age=300, stale-while-revalidate=3600");
    return res.json(payload); // R-020: return, sama seperti jalur respons lain
  } catch (e) {
    if (cached?.payload) {
      res.setHeader("x-cache", "STALE");
      res.setHeader("cache-control", "public, max-age=60, stale-while-revalidate=3600");
      return res.json({
        ...cached.payload,
        warning: "Serving stale GFW track because live fetch failed",
      });
    }
    return sendProblem(res, 500, e?.message || "track failed");
  }
}
