// Pemeriksaan tanggal di batas rute API (M-162, M-163). Tanggal yang cacat ditolak 400 di sini, sebelum diteruskan
// ke GFW atau dipakai sebagai kunci cache.

// R-126: awal data AIS publik Global Fishing Watch (1 Januari 2012); dipakai sebagai tanggal awal bawaan.
export const GFW_DATA_START = "2012-01-01";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// true hanya untuk tanggal kalender yang benar-benar ada, berbentuk YYYY-MM-DD (2026-02-30 dan 2026-99-99 ditolak).
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export type DateRange = { ok: true; start: string; end: string } | { ok: false; detail: string };

// Memeriksa pasangan tanggal: keduanya YYYY-MM-DD yang sah dan tanggal awal tidak sesudah tanggal akhir.
export function checkDateRange(start: string, end: string): DateRange {
  if (!isIsoDate(start)) return { ok: false, detail: "start_date harus berbentuk YYYY-MM-DD dan tanggalnya ada." };
  if (!isIsoDate(end)) return { ok: false, detail: "end_date harus berbentuk YYYY-MM-DD dan tanggalnya ada." };
  if (start > end) return { ok: false, detail: "start_date tidak boleh sesudah end_date." };
  return { ok: true, start, end };
}
