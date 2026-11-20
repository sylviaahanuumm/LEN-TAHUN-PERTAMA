// Captures the original Error out-of-band so server.ts can recover the stack
// when h3 has already swallowed the throw into a generic 500 Response.
//
// M-2 (laporan audit): dulu hanya ada satu tempat penyimpanan (lastCapturedError), sehingga galat dari permintaan
// berikutnya menimpa galat permintaan sebelumnya. Sesuai rekomendasi PDF, galat kini disimpan di Map berbatas ukuran
// (LRU) dengan kunci ID permintaan. ID permintaan yang sedang berjalan dibawa lewat AsyncLocalStorage.
import { AsyncLocalStorage } from "node:async_hooks";

type CapturedError = { error: unknown; at: number };

const TTL_MS = 5_000;
const MAX_ENTRIES = 100;
// T-62: galat tanpa ID permintaan diberi kunci unik (awalan + nomor urut), supaya galat kedua tidak menimpa galat pertama.
const UNSCOPED_PREFIX = "tanpa-request-id:";
let unscopedSeq = 0;

const requestContext = new AsyncLocalStorage<string>();
const capturedErrors = new Map<string, CapturedError>();

function record(error: unknown) {
  // K-19: listener global ("error", "unhandledrejection") bisa berjalan di luar scope runWithRequestId,
  // sehingga getStore() kosong. Galat seperti itu tetap disimpan (dengan kunci unik) dan diambil lewat
  // consumeCapturedError(requestId, since), lihat di bawah.
  const key = requestContext.getStore() ?? `${UNSCOPED_PREFIX}${++unscopedSeq}`;
  // Hapus lalu isi lagi supaya kunci ini menjadi yang paling baru (urutan Map = urutan pemakaian).
  capturedErrors.delete(key);
  capturedErrors.set(key, { error, at: Date.now() });
  while (capturedErrors.size > MAX_ENTRIES) {
    const oldest = capturedErrors.keys().next().value;
    if (oldest === undefined) break;
    capturedErrors.delete(oldest);
  }
}

if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) => record((event as ErrorEvent).error ?? event));
  globalThis.addEventListener("unhandledrejection", (event) =>
    record((event as PromiseRejectionEvent).reason),
  );
}

// Menjalankan fn dengan ID permintaan tertentu, supaya galat yang tertangkap selama fn berjalan tercatat di ID itu.
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return requestContext.run(requestId, fn);
}

// Mengambil galat asli untuk permintaan requestId.
// 1) Galat yang tercatat dengan ID permintaan ini (tercatat di dalam scope runWithRequestId).
// 2) K-19: jika tidak ada, galat tanpa ID permintaan yang paling baru, yang tercatat sejak permintaan ini dimulai
//    (since) dan belum lewat TTL. Galat itu diambil sekali saja (dihapus), supaya tidak dipakai permintaan lain.
export function consumeCapturedError(requestId: string, since?: number): unknown {
  const now = Date.now();
  const entry = capturedErrors.get(requestId);
  if (entry) {
    capturedErrors.delete(requestId);
    return now - entry.at > TTL_MS ? undefined : entry.error;
  }
  if (since === undefined) return undefined;
  const unscoped = [...capturedErrors].filter(([key]) => key.startsWith(UNSCOPED_PREFIX));
  for (let i = unscoped.length - 1; i >= 0; i--) {
    const [key, item] = unscoped[i];
    if (item.at >= since && now - item.at <= TTL_MS) {
      capturedErrors.delete(key);
      return item.error;
    }
  }
  return undefined;
}
