import type { TrackPoint, TrackResponse, VesselSearchResult } from "./types";

const GFW_BASE = "https://gateway.api.globalfishingwatch.org/v3";
// Fase 2 laporan audit: setiap panggilan ke API luar diberi batas waktu (10–15 detik).
const GFW_TIMEOUT_MS = 15_000;

const GFW_EVENT_DATASETS = [
  "public-global-fishing-events:latest",
  "public-global-encounters-events:latest",
  "public-global-loitering-events:latest",
];

const GFW_TRACK_DATASET = "public-global-vessel-track:latest";
const GFW_IDENTITY_DATASET = "public-global-vessel-identity:latest";

// M-157: dulu dipakai kotak lintang/bujur kasar (95–141 BT, 11 LS–6 LU) yang ikut mencakup perairan Malaysia,
// Singapura, Filipina, Timor Leste, dan Papua Nugini. Sekarang memakai ZEE Indonesia dari GFW (id 8492 di dataset
// public-eez-areas), sama dengan api/gfw/events.js yang sudah teruji dengan data GFW asli.
// PENTING: GFW hanya menerapkan batas wilayah ini bila satu permintaan berisi SATU dataset, jadi tiap dataset diminta
// sendiri-sendiri, lalu hasilnya disaring lagi dengan regions.eez sebagai pengaman.
const INDONESIA_EEZ = { dataset: "public-eez-areas", id: 8492 };
const INDONESIA_EEZ_ID = String(INDONESIA_EEZ.id);

// R-118: batas untuk membedakan waktu dalam detik dan milidetik. 10.000.000.000 detik = tahun 2286, sedangkan
// 10.000.000.000 milidetik = 26 April 1970. Angka di atas batas ini pasti milidetik, di bawahnya pasti detik
// (untuk data AIS mana pun, yang semuanya sesudah 1970 dan sebelum 2286).
const EPOCH_MS_THRESHOLD = 10_000_000_000;

// M-158: batas limit pencarian dipakai sama untuk parameter API dan untuk jumlah hasil yang dikembalikan.
const SEARCH_LIMIT_MIN = 1;
const SEARCH_LIMIT_MAX = 50;
const SEARCH_LIMIT_DEFAULT = 20;

// C.4 (laporan audit): bentuk respons GFW API v3 ditulis sebagai tipe, bukan any. Semua kolom opsional karena
// GFW tidak selalu mengirim semuanya; perubahan nama kolom di GFW kini terlihat saat pemeriksaan TypeScript.
type GfwIdentityInfo = {
  id?: string;
  shipname?: string;
  shipName?: string;
  ssvid?: string;
  imo?: string;
  flag?: string;
  callsign?: string;
};

type GfwVesselEntry = GfwIdentityInfo & {
  vesselId?: string;
  mmsi?: string;
  name?: string;
  selfReportedInfo?: GfwIdentityInfo[];
  registryInfo?: GfwIdentityInfo[];
};

type GfwSearchResponse = {
  entries?: GfwVesselEntry[];
  data?: GfwVesselEntry[];
};

type GfwTrackTime = number | string;

type GfwTrackPointEntry = {
  lat?: number;
  latitude?: number;
  lon?: number;
  longitude?: number;
  timestamp?: string;
  speed?: number;
  course?: number;
  geometry?: { coordinates?: number[] };
  properties?: { timestamp?: string; speed?: number; course?: number };
};

type GfwTrackResponse = {
  geometry?: { coordinates?: number[][] };
  features?: unknown[];
  entries?: unknown[];
  properties?: {
    coordinateProperties?: {
      times?: GfwTrackTime[];
      time?: GfwTrackTime[];
      speed?: number[];
      speeds?: number[];
      course?: number[];
      courses?: number[];
    };
  };
};

export type GfwRawEvent = {
  id?: string;
  type?: string;
  start?: string;
  end?: string;
  position?: { lat?: number; lon?: number };
  vessel?: { id?: string; ssvid?: string; flag?: string; name?: string };
  regions?: { eez?: Array<string | number> };
};

type GfwEventsResponse = {
  entries?: GfwRawEvent[];
  nextOffset?: number | null;
};

function authHeaders() {
  // B.17 (laporan audit): nama token di PDF GFW_API_TOKEN; GFW_TOKEN (nama lama) tetap dibaca sebagai cadangan.
  const token = process.env.GFW_API_TOKEN || process.env.GFW_TOKEN;
  if (!token) throw new Error("GFW_API_TOKEN is not configured");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function toIsoDate(date: string): string {
  // "2012-01-01" → "2012-01-01T00:00:00Z"
  return date.includes("T") ? date : `${date}T00:00:00Z`;
}

function isCoordinateList(value: unknown): value is number[][] {
  return Array.isArray(value) && value.length > 0 && Array.isArray(value[0]);
}

function trackTimeToIso(time: GfwTrackTime | undefined): string | undefined {
  if (!time) return undefined;
  if (typeof time === "number") return new Date(time * (time > EPOCH_MS_THRESHOLD ? 1 : 1000)).toISOString();
  return new Date(time).toISOString();
}

function clampSearchLimit(limit: number): number {
  const n = Math.trunc(limit);
  if (!Number.isFinite(n)) return SEARCH_LIMIT_DEFAULT;
  return Math.min(SEARCH_LIMIT_MAX, Math.max(SEARCH_LIMIT_MIN, n));
}

export async function searchVessels(query: string, limit = SEARCH_LIMIT_DEFAULT): Promise<VesselSearchResult[]> {
  // M-158: dulu parameter API dibatasi 1–50 tetapi hasil dipotong dengan limit mentah, sehingga limit 0 atau negatif
  // membuang semua/sebagian hasil dan limit > 50 tidak membatasi apa pun. Sekarang satu nilai dipakai untuk keduanya.
  const safeLimit = clampSearchLimit(limit);
  const url = new URL(`${GFW_BASE}/vessels/search`);
  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(safeLimit));
  url.searchParams.set("datasets[0]", GFW_IDENTITY_DATASET);
  url.searchParams.set("includes[0]", "MATCH_CRITERIA");
  url.searchParams.set("includes[1]", "OWNERSHIP");
  const res = await fetch(url.toString(), { headers: authHeaders(), signal: AbortSignal.timeout(GFW_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GFW search failed: ${res.status}`);
  const json: GfwSearchResponse = await res.json();
  const entries: GfwVesselEntry[] = json?.entries ?? json?.data ?? [];
  return entries.slice(0, safeLimit).map((e): VesselSearchResult => {
    const sd: GfwIdentityInfo = e?.selfReportedInfo?.[0] ?? e?.registryInfo?.[0] ?? e ?? {};
    return {
      vessel_id: e?.selfReportedInfo?.[0]?.id || e?.id || e?.vesselId || "",
      ship_name: sd?.shipname || sd?.shipName || e?.shipname || e?.name,
      mmsi: sd?.ssvid || e?.ssvid || e?.mmsi,
      imo: sd?.imo || e?.imo,
      flag: sd?.flag || e?.flag,
      callsign: sd?.callsign || e?.callsign,
    };
  }).filter(v => v.vessel_id);
}

function computeBounds(track: TrackPoint[]): TrackResponse["bounds"] {
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

const EVENTS_PAGE_SIZE = 200;
const EVENTS_MAX_PAGES = 5; // T-63: paling banyak 5 halaman = 1.000 event per permintaan

// T-63: ambil event per halaman (offset) sampai halaman tidak penuh atau GFW tidak memberi nextOffset, dengan batas
// EVENTS_MAX_PAGES halaman. Bila batas tercapai, peringatan dicatat supaya data yang terpotong tidak hilang diam-diam.
async function fetchEventPages(body: Record<string, unknown>, sort: string, label: string): Promise<GfwRawEvent[]> {
  const all: GfwRawEvent[] = [];
  for (let page = 0; page < EVENTS_MAX_PAGES; page++) {
    const url = new URL(`${GFW_BASE}/events`);
    url.searchParams.set("limit", String(EVENTS_PAGE_SIZE));
    url.searchParams.set("offset", String(page * EVENTS_PAGE_SIZE));
    url.searchParams.set("sort", sort);
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GFW_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch((err: unknown) => {
        console.warn(`[${label}] isi balasan galat GFW tidak bisa dibaca:`, err);
        return "";
      });
      throw new Error(`GFW events failed: ${res.status} ${text.slice(0, 200)}`);
    }
    const json: GfwEventsResponse = await res.json();
    const entries = json?.entries ?? [];
    all.push(...entries);
    const noNextPage = json?.nextOffset === undefined || json?.nextOffset === null;
    if (entries.length < EVENTS_PAGE_SIZE || noNextPage) return all;
  }
  console.warn(`[${label}] hasil dipotong di ${EVENTS_MAX_PAGES * EVENTS_PAGE_SIZE} event (masih ada halaman berikutnya di GFW).`);
  return all;
}

export async function getTrack(vesselId: string, startDate: string, endDate: string): Promise<TrackResponse> {
  const url = new URL(`${GFW_BASE}/vessels/${encodeURIComponent(vesselId)}/tracks`);
  url.searchParams.set("datasets[0]", GFW_TRACK_DATASET);
  url.searchParams.set("start-date", startDate);
  url.searchParams.set("end-date", endDate);

  let track: TrackPoint[] = [];
  let source = "tracks";
  const res = await fetch(url.toString(), { headers: authHeaders(), signal: AbortSignal.timeout(GFW_TIMEOUT_MS) });

  if (res.ok) {
    const json: GfwTrackResponse | GfwTrackPointEntry[] = await res.json();
    const body: GfwTrackResponse = Array.isArray(json) ? {} : json;
    // GFW track response is GeoJSON LineString with coordinateProperties
    const coords: unknown = body.geometry?.coordinates ?? body.features ?? body.entries ?? [];
    const coordProps = body.properties?.coordinateProperties ?? {};
    const times: GfwTrackTime[] = coordProps.times ?? coordProps.time ?? [];
    const speeds: number[] = coordProps.speed ?? coordProps.speeds ?? [];
    const courses: number[] = coordProps.course ?? coordProps.courses ?? [];

    if (isCoordinateList(coords)) {
      track = coords.map((c, i): TrackPoint => ({
        lon: c[0],
        lat: c[1],
        timestamp: trackTimeToIso(times[i]),
        speed: speeds[i],
        course: courses[i],
      })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    } else {
      // fallback: array of point objects
      const entries = (Array.isArray(json) ? json : (body.entries ?? [])) as GfwTrackPointEntry[];
      track = entries.map((e): TrackPoint => ({
        lat: Number(e?.lat ?? e?.latitude ?? e?.geometry?.coordinates?.[1]),
        lon: Number(e?.lon ?? e?.longitude ?? e?.geometry?.coordinates?.[0]),
        timestamp: e?.timestamp ?? e?.properties?.timestamp,
        speed: e?.speed ?? e?.properties?.speed,
        course: e?.course ?? e?.properties?.course,
      })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    }
  } else if (res.status === 404) {
    // Fallback: use event positions as track points
    source = "events";
    // T-63: semua halaman event diambil (bukan hanya 200 pertama). Kalau GFW gagal, lintasan tetap kosong seperti dulu.
    let entries: GfwRawEvent[] = [];
    try {
      entries = await fetchEventPages({
        datasets: GFW_EVENT_DATASETS,
        startDate: toIsoDate(startDate),
        endDate: toIsoDate(endDate),
        vessels: [vesselId],
      }, "+start", "gfw-track");
    } catch (err) {
      console.warn("[gfw-track] event cadangan gagal diambil:", err);
    }
    track = entries.map((e): TrackPoint => ({
      lat: Number(e?.position?.lat),
      lon: Number(e?.position?.lon),
      timestamp: e?.start,
      speed: undefined,
      course: undefined,
    })).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  } else {
    throw new Error(`GFW track failed: ${res.status}`);
  }

  return {
    vessel_id: vesselId,
    start_date: startDate,
    end_date: endDate,
    source,
    count: track.length,
    bounds: computeBounds(track),
    track,
  };
}

// Event fishing/encounter/loitering di ZEE Indonesia.
// M-157: satu permintaan per dataset (lihat INDONESIA_EEZ di atas). Dataset yang gagal dicatat; bila semuanya gagal,
// galat pertama diteruskan. T-63: tiap dataset diambil semua halamannya (maks. EVENTS_MAX_PAGES halaman).
export async function getIndonesianEvents(startDate: string, endDate: string): Promise<GfwRawEvent[]> {
  const results = await Promise.allSettled(GFW_EVENT_DATASETS.map((dataset) => fetchEventPages({
    datasets: [dataset],
    startDate: toIsoDate(startDate),
    endDate: toIsoDate(endDate),
    region: INDONESIA_EEZ,
  }, "-start", `gfw-events ${dataset}`)));
  const failed = GFW_EVENT_DATASETS.filter((_, i) => results[i].status === "rejected");
  if (failed.length === GFW_EVENT_DATASETS.length) throw (results[0] as PromiseRejectedResult).reason;
  if (failed.length) console.warn(`[gfw-events] dataset gagal, hasil sebagian: ${failed.join(", ")}`);
  return results
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .filter((e) => (e?.regions?.eez ?? []).map(String).includes(INDONESIA_EEZ_ID))
    .sort((a, b) => String(b.start ?? "").localeCompare(String(a.start ?? "")));
}
