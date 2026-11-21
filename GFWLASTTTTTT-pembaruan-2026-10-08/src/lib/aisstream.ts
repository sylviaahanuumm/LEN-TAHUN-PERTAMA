import type { AisShip } from "./types";

// M-150: alamat layanan tidak lagi ditanam di tengah kode. Nilai bawaan di sini, dan bisa diganti lewat opsi
// konstruktor (misalnya untuk server tiruan saat pengujian atau proxy sendiri).
export const AISSTREAM_URL = "wss://stream.aisstream.io/v0/stream";
// M-152: jeda sambung ulang bertahap: 4 → 8 → 16 → 32 → 60 detik (maksimum), kembali ke 4 detik setelah data masuk.
const RECONNECT_MIN_MS = 4000;
const RECONNECT_MAX_MS = 60_000;

const BBOXES: number[][][] = [
  [[-8.0, 105.0], [-4.0, 116.0]],
  [[1.0, 99.0], [6.0, 104.0]],
  [[-8.0, 112.0], [-6.5, 113.5]],
];

// C.4 (laporan audit): bentuk pesan AISStream ditulis sebagai tipe, bukan any.
type AisPositionReport = {
  Sog?: number;
  Cog?: number;
  TrueHeading?: number;
  NavigationalStatus?: number;
};

type AisShipStaticData = {
  Name?: string;
  Destination?: string;
};

type AisStreamMessage = {
  MessageType?: string;
  MetaData?: {
    MMSI?: number | string;
    MMSI_String?: string;
    latitude?: number;
    Latitude?: number;
    longitude?: number;
    Longitude?: number;
    ShipName?: string;
  };
  Message?: {
    PositionReport?: AisPositionReport;
    ShipStaticData?: AisShipStaticData;
  };
};

export type AisCallbacks = {
  onShip: (ship: AisShip) => void;
  onMessage: () => void;
  onStatus: (online: boolean) => void;
};

export type AisClientOptions = {
  url?: string;
};

// M-153: salinan data kapal untuk pemanggil, supaya perubahan di luar tidak ikut mengubah data milik klien ini
// (dan sebaliknya: pembaruan berikutnya tidak diam-diam mengubah objek yang sudah dipegang pemanggil).
function copyShip(ship: AisShip): AisShip {
  return { ...ship, trail: ship.trail.map((p) => ({ ...p })) };
}

export class AisStreamClient {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private cbs: AisCallbacks;
  private ships = new Map<string, AisShip>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private url: string;
  private reconnectDelay = RECONNECT_MIN_MS;

  constructor(apiKey: string, cbs: AisCallbacks, options: AisClientOptions = {}) {
    this.apiKey = apiKey;
    this.cbs = cbs;
    this.url = options.url || AISSTREAM_URL;
  }

  start() {
    this.stopped = false;
    this.reconnectDelay = RECONNECT_MIN_MS;
    this.connect();
    this.cleanupTimer = setInterval(() => this.cleanup(), 30_000);
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.closeSocket();
    this.ships.clear();
    this.cbs.onStatus(false);
  }

  getShips() {
    return Array.from(this.ships.values(), copyShip);
  }

  // T-61: socket lama dilepas handler-nya lalu ditutup, supaya tidak ada dua socket aktif sekaligus
  // dan penutupan socket lama tidak memicu penyambungan ulang tambahan.
  private closeSocket() {
    const old = this.ws;
    this.ws = null;
    if (!old) return;
    old.onopen = null;
    old.onmessage = null;
    old.onclose = null;
    old.onerror = null;
    try {
      old.close();
    } catch (err) {
      console.warn("[aisstream] galat diabaikan saat menutup socket lama:", err);
    }
  }

  private connect() {
    if (this.stopped) return;
    this.closeSocket();
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      console.warn("[aisstream] koneksi gagal dibuka, dicoba lagi:", err);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    // T-61: setiap handler memakai socket miliknya sendiri (ws) dan berhenti jika socket itu sudah bukan socket aktif.
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.cbs.onStatus(true);
      ws.send(JSON.stringify({
        APIKey: this.apiKey,
        BoundingBoxes: BBOXES,
        FilterMessageTypes: ["PositionReport", "ShipStaticData"],
      }));
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.reconnectDelay = RECONNECT_MIN_MS; // M-152: koneksi terbukti mengirim data, jeda kembali ke awal
      this.cbs.onMessage();
      // C.3 (laporan audit): pesan yang gagal dibaca dicatat, tidak lagi ditelan diam-diam.
      try {
        const msg: AisStreamMessage = JSON.parse(ev.data);
        this.handle(msg);
      } catch (err) {
        console.warn("[aisstream] pesan AIS tidak bisa dibaca:", err);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.cbs.onStatus(false);
      this.scheduleReconnect();
    };
    // M-151: galat langsung diperlakukan sebagai koneksi putus: socket dilepas (handler-nya dicopot, jadi event "close"
    // yang biasanya menyusul tidak memicu apa pun lagi), status offline dikirim sekali, dan sambung ulang dijadwalkan
    // di sini. Dulu sambung ulang bergantung pada event "close"; bila event itu tidak datang, klien berhenti selamanya.
    ws.onerror = (ev) => {
      if (this.ws !== ws) return;
      console.warn("[aisstream] galat koneksi AISStream:", ev);
      this.closeSocket();
      this.cbs.onStatus(false);
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.stopped) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private handle(msg: AisStreamMessage) {
    const meta = msg?.MetaData;
    if (!meta) return;
    const mmsi = String(meta.MMSI ?? meta.MMSI_String ?? "");
    if (!mmsi) return;
    const lat = Number(meta.latitude ?? meta.Latitude);
    const lon = Number(meta.longitude ?? meta.Longitude);
    const now = Date.now();
    const existing = this.ships.get(mmsi) ?? {
      mmsi,
      lat: 0,
      lon: 0,
      updatedAt: now,
      trail: [],
    } as AisShip;

    const type = msg.MessageType;
    if (type === "PositionReport" && Number.isFinite(lat) && Number.isFinite(lon)) {
      const pr: AisPositionReport = msg.Message?.PositionReport ?? {};
      existing.lat = lat;
      existing.lon = lon;
      existing.speed = pr.Sog;
      existing.course = pr.Cog;
      existing.heading = pr.TrueHeading === 511 ? undefined : pr.TrueHeading;
      existing.navStatus = navStatusLabel(pr.NavigationalStatus);
      existing.updatedAt = now;
      existing.trail.push({ lat, lon, t: now });
      if (existing.trail.length > 120) existing.trail.shift();
    } else if (type === "ShipStaticData") {
      const sd: AisShipStaticData = msg.Message?.ShipStaticData ?? {};
      existing.name = (sd.Name || meta.ShipName || "").trim() || existing.name;
      existing.destination = (sd.Destination || "").trim() || existing.destination;
      existing.updatedAt = now;
      if (Number.isFinite(lat) && Number.isFinite(lon) && !existing.lat) {
        existing.lat = lat; existing.lon = lon;
      }
    }
    if (!existing.name && meta.ShipName) existing.name = String(meta.ShipName).trim();

    this.ships.set(mmsi, existing);
    this.cbs.onShip(copyShip(existing));
  }

  private cleanup() {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [k, v] of this.ships) {
      if (v.updatedAt < cutoff) this.ships.delete(k);
    }
  }
}

function navStatusLabel(code?: number): string | undefined {
  // C-6: pemeriksaan kosong ditulis eksplisit (=== null / === undefined), bukan perbandingan longgar.
  if (code === null || code === undefined) return undefined;
  const map: Record<number, string> = {
    0: "Under way using engine",
    1: "At anchor",
    2: "Not under command",
    3: "Restricted manoeuverability",
    4: "Constrained by draught",
    5: "Moored",
    6: "Aground",
    7: "Engaged in fishing",
    8: "Under way sailing",
    15: "Undefined",
  };
  return map[code] ?? `Status ${code}`;
}

export function speedColor(speed?: number): string {
  if (speed === null || speed === undefined || !Number.isFinite(speed)) return "var(--ais-unknown)";
  if (speed < 1) return "var(--ais-stop)";
  if (speed < 5) return "var(--ais-slow)";
  if (speed < 12) return "var(--ais-normal)";
  return "var(--ais-fast)";
}

export function speedLabel(speed?: number): string {
  if (speed === null || speed === undefined || !Number.isFinite(speed)) return "Tidak diketahui";
  if (speed < 1) return "Berhenti";
  if (speed < 5) return "Lambat";
  if (speed < 12) return "Normal";
  return "Cepat";
}

export function eventColor(type?: string): string {
  switch ((type || "").toUpperCase()) {
    case "FISHING": return "var(--gfw-fishing)";
    case "ENCOUNTER": return "var(--gfw-encounter)";
    case "LOITERING": return "var(--gfw-loitering)";
    default: return "var(--gfw-other)";
  }
}
