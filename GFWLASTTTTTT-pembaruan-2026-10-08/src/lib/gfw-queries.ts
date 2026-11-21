import type { GfwrQuery } from "./types";

// Katalog ini adalah DOKUMENTASI kueri GFW yang ditampilkan di panel alat (ToolPanel), bukan parameter yang dikirim.
// M-155: nilai contoh/isian ditulis dalam kurung sudut <...>, supaya tidak tertukar dengan nilai sungguhan
// (dulu "MMSI / IMO / Name" terlihat seperti kata kunci pencarian asli). isPlaceholderValue() mengenalinya.
// M-156: bagian {nama} di endpoint adalah templat. Pakai buildEndpoint() untuk mengisinya; fungsi itu menolak
// bagian yang belum diisi dan meng-encode nilainya, jadi "{vessel_id}" tidak pernah terkirim apa adanya.
const PLACEHOLDER = /^<.+>$/;

export function isPlaceholderValue(value: string): boolean {
  return PLACEHOLDER.test(value.trim());
}

export function buildEndpoint(endpoint: string, values: Record<string, string>): string {
  return endpoint.replace(/\{([a-z_]+)\}/gi, (_, name: string) => {
    const value = values[name];
    if (typeof value !== "string" || !value.trim() || isPlaceholderValue(value)) {
      throw new Error(`Bagian {${name}} pada endpoint ${endpoint} belum diisi`);
    }
    return encodeURIComponent(value.trim());
  });
}

export const GFWR_QUERIES: GfwrQuery[] = [
  {
    id: "fishing-events",
    name: "Fishing Events",
    category: "Events",
    endpoint: "/v3/events",
    datasets: ["public-global-fishing-events:latest"],
    params: { types: "FISHING", region: "Indonesia EEZ" },
    description: "Aktivitas penangkapan ikan terdeteksi via AIS.",
  },
  {
    id: "encounter-events",
    name: "Encounter Events",
    category: "Events",
    endpoint: "/v3/events",
    datasets: ["public-global-encounters-events:latest"],
    params: { types: "ENCOUNTER" },
    description: "Dua kapal berdekatan dalam waktu lama (kemungkinan transhipment).",
  },
  {
    id: "loitering-events",
    name: "Loitering Events",
    category: "Events",
    endpoint: "/v3/events",
    datasets: ["public-global-loitering-events:latest"],
    params: { types: "LOITERING" },
    description: "Kapal cargo/reefer berhenti panjang di laut lepas.",
  },
  {
    id: "vessel-search",
    name: "Vessel Search",
    category: "Vessels",
    endpoint: "/v3/vessels/search",
    datasets: ["public-global-vessel-identity:latest"],
    params: { query: "<MMSI / IMO / Name>" },
    description: "Cari kapal berdasarkan identitas.",
  },
  {
    id: "vessel-tracks",
    name: "Vessel Tracks",
    category: "Tracks",
    endpoint: "/v3/vessels/{vessel_id}/tracks",
    datasets: ["public-global-fishing-tracks:latest"],
    params: { start_date: "<YYYY-MM-DD>", end_date: "<YYYY-MM-DD>" },
    description: "Trajektori posisi kapal pada rentang tanggal.",
  },
  {
    id: "port-visits",
    name: "Port Visits",
    category: "Events",
    endpoint: "/v3/events",
    datasets: ["public-global-port-visits-events:latest"],
    params: { types: "PORT_VISIT" },
    description: "Kunjungan kapal ke pelabuhan.",
  },
];
