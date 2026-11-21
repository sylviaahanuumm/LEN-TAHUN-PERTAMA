// Balasan galat API dalam format RFC 7807 (Problem Details): type, title, status, detail.
// Kolom "error" tetap disertakan supaya halaman yang sudah membaca "error" tetap berjalan, dan kolom tambahan
// (misalnya events: [] atau ok: false) tetap dikirim seperti sebelumnya.

const TITLES = {
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

export function sendProblem(res, status, detail, extra = {}) {
  const title = TITLES[status] || "Error";
  // M-010: detail kosong/undefined diganti judul status, supaya kolom "detail" dan "error" selalu ada di respons
  // (JSON.stringify membuang key bernilai undefined, sehingga klien lama yang membaca "error" mendapat kosong).
  const text = typeof detail === "string" && detail.trim() ? detail : title;
  res.setHeader("Content-Type", "application/problem+json; charset=utf-8");
  return res.status(status).json({
    ...extra,
    // R-008: "about:blank" dipertahankan (sah menurut RFC 7807 §4.2); klien membedakan galat lewat "status".
    type: "about:blank",
    title,
    status,
    detail: text,
    error: text,
  });
}
