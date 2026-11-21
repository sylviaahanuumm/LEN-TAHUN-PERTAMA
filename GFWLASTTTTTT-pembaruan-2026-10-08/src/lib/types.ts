export type AisShip = {
  mmsi: string;
  name?: string;
  destination?: string;
  navStatus?: string;
  lat: number;
  lon: number;
  speed?: number; // knots
  course?: number;
  heading?: number;
  updatedAt: number;
  trail: Array<{ lat: number; lon: number; t: number }>;
};

// M-160: jenis event yang dikenal ditulis terpisah. "| string" biasa membuat ketiga literal itu melebur menjadi string
// (tidak ada saran otomatis dan pemeriksaan). "(string & {})" tetap menerima jenis lain dari GFW tanpa meleburkannya.
export type KnownGfwEventType = "FISHING" | "ENCOUNTER" | "LOITERING";

export type GfwEvent = {
  id: string;
  type: KnownGfwEventType | (string & {});
  start: string;
  end: string;
  durationHours?: number;
  lat: number;
  lon: number;
  vesselId?: string;
  mmsi?: string;
  flag?: string;
  shipName?: string;
};

export type TrackPoint = {
  lat: number;
  lon: number;
  timestamp?: string;
  speed?: number;
  course?: number;
};

export type TrackResponse = {
  vessel_id: string;
  start_date: string;
  end_date: string;
  source: string;
  count: number;
  // R-120: selalu ada (computeBounds di gfw.server.ts selalu mengisinya); null berarti jejak kosong. Tidak lagi
  // dicampur dengan "tidak ada kolom" (undefined).
  bounds: [[number, number], [number, number]] | null;
  track: TrackPoint[];
};

export type VesselSearchResult = {
  vessel_id: string;
  ship_name?: string;
  mmsi?: string;
  imo?: string;
  flag?: string;
  callsign?: string;
};

export type GfwrQuery = {
  id: string;
  name: string;
  category: string;
  endpoint: string;
  datasets: string[];
  params: Record<string, string>;
  description?: string;
};

// C.4 (laporan audit): bentuk hasil server inference ditulis sebagai tipe, bukan any.
// R-121: label dan keyakinan selalu dikirim berpasangan oleh server inference dan ditampilkan berpasangan di ToolPanel,
// jadi keduanya wajib (dulu label opsional tetapi keyakinan wajib, tidak konsisten).
export type InferenceTaskResult = {
  pred_label: string;
  confidence: number;
};

export type InferenceVessel = {
  mmsi: string;
  last_lat?: number;
  last_lon?: number;
  tasks?: Record<string, InferenceTaskResult>;
};

export type InferenceResult = {
  status?: string;
  detail?: string;
  n_vessels?: number;
  elapsed_s?: number;
  start_date?: string;
  end_date?: string;
  vessels?: InferenceVessel[];
};

export type Mode = "ais" | "gfw";

export type Selection =
  | { kind: "ais"; ship: AisShip }
  | { kind: "gfw"; event: GfwEvent }
  | null;
