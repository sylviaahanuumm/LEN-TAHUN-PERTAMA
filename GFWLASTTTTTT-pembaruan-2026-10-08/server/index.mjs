// Server Ocean Nexus: website, handler di folder api/, dan relay AIS dalam satu proses.
// Jalankan dari folder proyek: npm run start   (butuh Node.js 22+)
// Pengaturan lewat .env.local / environment: PORT (default 3000), HOST (default 127.0.0.1),
// GFW_API_TOKEN, AISSTREAM_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_DEFAULT_CHAT_ID (nama lama GFW_TOKEN dan
// TELEGRAM_CHAT_ID masih dibaca).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as aisRelay from "./ais-relay.mjs";
import { decideAccess, UNAUTHORIZED_BODY } from "../api/_session.js";
import { clientIpKey } from "../api/_rate-limit.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = path.join(ROOT, "public");
const ASSETS_DIR = path.join(ROOT, "assets");
const API_DIR = path.join(ROOT, "api");
const MAX_BODY_BYTES = 1024 * 1024;
// M-125: metode yang boleh membawa isi (body); isinya dibaca dan diteruskan ke handler, bukan diam-diam jadi {}.
const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// M-127: batas permintaan /api/* per IP (jendela 1 menit) dan batas handler API yang berjalan bersamaan.
// Ini lapisan kasar di depan semua endpoint; tiap handler di api/ tetap punya batasnya sendiri (applyRateLimit).
// Bisa diubah lewat API_RATE_LIMIT_PER_MIN (default 300) dan API_MAX_CONCURRENT (default 64), dibaca saat dipakai
// supaya nilai dari .env.local (dimuat loadDotEnv setelah modul ini terbaca) ikut berlaku.
const API_WINDOW_MS = 60_000;
const apiHits = new Map(); // ip -> { windowStart, count }
let apiRunning = 0;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".pdf": "application/pdf",
};

function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

// M-127: true bila IP ini masih di bawah batas pada jendela 1 menit sekarang. Entri lama disapu supaya Map tidak membesar.
function allowApiRequest(req) {
  const now = Date.now();
  if (apiHits.size > 10_000) {
    for (const [ip, hit] of apiHits) if (now - hit.windowStart >= API_WINDOW_MS) apiHits.delete(ip);
  }
  const ip = clientIpKey(req);
  let hit = apiHits.get(ip);
  if (!hit || now - hit.windowStart >= API_WINDOW_MS) {
    hit = { windowStart: now, count: 0 };
    apiHits.set(ip, hit);
  }
  hit.count++;
  if (hit.count <= positiveInt(process.env.API_RATE_LIMIT_PER_MIN, 300)) return { ok: true };
  return { ok: false, retryAfter: Math.max(1, Math.ceil((hit.windowStart + API_WINDOW_MS - now) / 1000)) };
}

// Sama dengan loadDotEnv di vite.config.ts: nilai yang sudah ada di environment tidak ditimpa.
function loadDotEnv() {
  for (const fileName of [".env", ".env.local"]) {
    const file = path.join(ROOT, fileName);
    if (!fs.existsSync(file)) continue;
    for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
      if (key && !(key in process.env)) process.env[key] = value;
    }
  }
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function isInside(baseDir, target) {
  const rel = path.relative(baseDir, target);
  return Boolean(rel) && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function sendText(res, statusCode, text) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(text);
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

// Hanya isi public/ (disajikan di root, seperti Vite), halaman *.html di root proyek,
// dan folder assets/ yang boleh diakses. File lain (.env.local, server/, scripts/, dll.) tidak.
function resolveStaticFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const segments = decoded.replace(/\\/g, "/").split("/").filter(Boolean);
  if (!segments.length) segments.push("index.html");
  if (segments.some((segment) => segment.startsWith("."))) return null;

  const fromPublic = path.join(PUBLIC_DIR, ...segments);
  if (isInside(PUBLIC_DIR, fromPublic) && isFile(fromPublic)) return fromPublic;

  if (segments.length === 1 && segments[0].endsWith(".html")) {
    const page = path.join(ROOT, segments[0]);
    if (isFile(page)) return page;
  }

  if (segments[0] === "assets") {
    const asset = path.join(ROOT, ...segments);
    if (isInside(ASSETS_DIR, asset) && isFile(asset)) return asset;
  }
  return null;
}

function serveFile(req, res, file) {
  const stat = fs.statSync(file);
  const ext = path.extname(file).toLowerCase();
  res.statusCode = 200;
  res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
  res.setHeader("Content-Length", stat.size);
  res.setHeader("Cache-Control", ext === ".html" ? "no-cache" : "public, max-age=3600");
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file)
    .on("error", (err) => {
      // R-079: bila file hilang/terganti di antara statSync dan createReadStream, klien mendapat 404/500 yang jelas,
      // bukan koneksi yang diputus mentah. Koneksi hanya diputus bila sebagian isi file sudah terkirim.
      console.warn("[server] gagal membaca file:", err?.code || err?.message || err);
      if (res.headersSent) return res.destroy();
      res.removeHeader("Content-Length");
      res.setHeader("Cache-Control", "no-store");
      sendText(res, err?.code === "ENOENT" ? 404 : 500, err?.code === "ENOENT" ? "Halaman atau file tidak ditemukan" : "Terjadi kesalahan di server");
    })
    .pipe(res);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      // Lewat batas: sisa kiriman dibuang (tidak disimpan) supaya balasan 413 tetap bisa dikirim;
      // kiriman yang sangat besar langsung diputus.
      if (size > MAX_BODY_BYTES * 16) {
        reject(new Error("Request body terlalu besar"));
        req.destroy();
        return;
      }
      if (size > MAX_BODY_BYTES) return;
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (size > MAX_BODY_BYTES) return reject(new Error("Request body terlalu besar"));
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    req.on("error", reject);
  });
}

// Adapter gaya Vercel untuk handler di api/, sama seperti vercelApiPlugin di vite.config.ts.
async function handleApi(req, res, url) {
  const segments = url.pathname.split("/").filter(Boolean).slice(1);
  // File berawalan "_" (misalnya _redis.js) adalah helper internal, bukan endpoint.
  if (!segments.length || segments.some((segment) => segment.startsWith("_") || segment.startsWith("."))) {
    return sendJson(res, 404, { error: `API route not found: ${url.pathname}` });
  }
  const base = path.join(API_DIR, ...segments);
  const handlerPath = [`${base}.js`, path.join(base, "index.js")].find((file) => isInside(API_DIR, file) && isFile(file));
  if (!handlerPath) return sendJson(res, 404, { error: `API route not found: ${url.pathname}` });

  let bodyText = "";
  if (BODY_METHODS.has(req.method)) {
    try {
      bodyText = await readBody(req);
    } catch (err) {
      return sendJson(res, 413, { error: err.message });
    }
  }

  const mockReq = {
    method: req.method,
    url: req.url,
    query: Object.fromEntries(url.searchParams),
    headers: req.headers,
    socket: req.socket,
    body: bodyText
      ? (() => {
          try {
            return JSON.parse(bodyText);
          } catch {
            return bodyText;
          }
        })()
      : {},
  };

  const mockRes = {
    _status: 200,
    status(code) {
      this._status = code;
      return this;
    },
    setHeader(name, value) {
      res.setHeader(name, value);
      return this;
    },
    json(data) {
      res.statusCode = this._status;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(data));
    },
    end(body = "") {
      res.statusCode = this._status;
      res.end(body);
    },
  };

  try {
    const mod = await import(pathToFileURL(handlerPath).href);
    await (mod.default ?? mod)(mockReq, mockRes);
  } catch (err) {
    // M-126: detail galat (pesan, path file, stack) hanya dicatat di log server; klien menerima pesan umum.
    console.error(`[api] ${url.pathname}:`, err);
    if (!res.headersSent) sendJson(res, 500, { error: "Terjadi kesalahan di server" });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const isApi = url.pathname === "/api" || url.pathname.startsWith("/api/");
  let countedApi = false;
  try {
    // M-127: batas per IP dan batas jumlah handler bersamaan untuk /api/*, diperiksa paling awal (sebelum cek sesi).
    if (isApi) {
      const allowed = allowApiRequest(req);
      if (!allowed.ok) {
        res.setHeader("Retry-After", String(allowed.retryAfter));
        res.setHeader("Cache-Control", "no-store");
        return sendJson(res, 429, { error: "Terlalu banyak permintaan. Coba lagi sebentar." });
      }
      // Aliran AIS (/api/ais/stream) tetap terbuka lama, jadi tidak dihitung sebagai handler yang sedang berjalan.
      if (url.pathname !== "/api/ais/stream") {
        if (apiRunning >= positiveInt(process.env.API_MAX_CONCURRENT, 64)) {
          res.setHeader("Retry-After", "1");
          res.setHeader("Cache-Control", "no-store");
          return sendJson(res, 503, { error: "Server sedang sibuk. Coba lagi sebentar." });
        }
        apiRunning++;
        countedApi = true;
      }
    }
    // F3-S (laporan audit B.4 dan Fase 3): halaman, data, API, dan relay AIS hanya dikirim bila cookie sesi login sah,
    // dengan aturan yang sama seperti middleware.js di Vercel (api/_session.js).
    // T-50: cookie diberi atribut Secure bila koneksi asli HTTPS. Header x-forwarded-proto hanya dipercaya bila
    // TRUST_PROXY=1 (sama seperti api/_rate-limit.js); COOKIE_SECURE=1 memaksa Secure.
    const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    const secure = process.env.COOKIE_SECURE === "1" || (process.env.TRUST_PROXY === "1" && forwardedProto === "https");
    const decision = await decideAccess({ method: req.method, url: req.url || "/", cookieHeader: req.headers.cookie, secure });
    if (decision.action === "redirect") {
      res.writeHead(302, { Location: decision.location, "Cache-Control": "no-store" });
      return res.end();
    }
    if (decision.action === "deny") {
      res.writeHead(401, { "Content-Type": "application/problem+json; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(UNAUTHORIZED_BODY);
    }
    if (decision.setCookie) res.setHeader("Set-Cookie", decision.setCookie);

    if (url.pathname.startsWith("/api/ais/")) {
      if (await aisRelay.handle(req, res)) return;
      return sendJson(res, 404, { error: `API route not found: ${url.pathname}` });
    }
    if (isApi) {
      return await handleApi(req, res, url);
    }
    if (req.method !== "GET" && req.method !== "HEAD") return sendText(res, 405, "Method not allowed");
    const file = resolveStaticFile(url.pathname);
    if (!file) return sendText(res, 404, "Halaman atau file tidak ditemukan");
    serveFile(req, res, file);
  } catch (err) {
    console.error("[server]", err);
    if (!res.headersSent) sendText(res, 500, "Terjadi kesalahan di server");
  } finally {
    if (countedApi) apiRunning--;
  }
});

loadDotEnv();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";

aisRelay.start();
server.listen(PORT, HOST, () => {
  console.log(`[server] Ocean Nexus berjalan di http://${HOST}:${PORT}`);
});

function shutdown() {
  aisRelay.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
