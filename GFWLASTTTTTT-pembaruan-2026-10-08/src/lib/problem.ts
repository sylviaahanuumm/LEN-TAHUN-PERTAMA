// C.3 (laporan audit): balasan galat API dalam format RFC 7807 (Problem Details), sama dengan api/_problem.js.
// Kolom "error" tetap disertakan supaya pemanggil yang sudah membaca "error" tetap berjalan, dan kolom tambahan
// (misalnya events: [] atau entries: []) tetap dikirim seperti sebelumnya.

const TITLES: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  404: "Not Found",
  405: "Method Not Allowed",
  413: "Payload Too Large",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

// R-119: urutan penggabungan dibuat jelas. "type" dan "title" BOLEH diganti pemanggil (RFC 7807 mengizinkan URI jenis
// galat sendiri), sedangkan "status", "detail", dan "error" selalu diambil dari argumen, supaya isi balasan tidak bisa
// berbeda dengan kode status HTTP-nya. Kolom tambahan lain (events, entries, dll.) tetap ikut dikirim.
export function problemResponse(status: number, detail: string, extra: Record<string, unknown> = {}): Response {
  const { type, title, ...rest } = extra;
  return Response.json(
    {
      ...rest,
      type: typeof type === "string" && type ? type : "about:blank",
      title: typeof title === "string" && title ? title : (TITLES[status] ?? "Error"),
      status,
      detail,
      error: detail,
    },
    { status, headers: { "content-type": "application/problem+json; charset=utf-8" } },
  );
}

// M-159: galat berupa teks biasa (throw "pesan", umum di beberapa pustaka) tidak lagi dibuang diam-diam; teksnya
// dipakai sebagai pesan. Selain Error dan teks, pesan cadangan (fallback) yang dipakai.
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  return fallback;
}
