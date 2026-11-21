import "./lib/error-capture";

import { consumeCapturedError, runWithRequestId } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

// R-131: env dan ctx diberi bentuk minimal (bukan unknown), sama dengan yang diteruskan ke handler TanStack Start.
export type ServerEnv = Record<string, unknown>;
export type ServerContext = {
  waitUntil?: (promise: Promise<unknown>) => void;
  passThroughOnException?: () => void;
};

type ServerEntry = {
  fetch: (request: Request, env: ServerEnv, ctx: ServerContext) => Promise<Response> | Response;
};

// R-132: isi respons 5xx yang diperiksa paling banyak 4 KB. Isi "galat SSR yang ditelan h3" hanya ±50 byte,
// jadi respons yang lebih besar pasti bukan itu dan tidak perlu dimuat seluruhnya ke memori.
const MAX_INSPECT_BYTES = 4096;
// M-167: x-request-id dari klien hanya dipakai sebagai label log, dan hanya bila bentuknya wajar.
const CLIENT_REQUEST_ID = /^[A-Za-z0-9._:-]{1,64}$/;

// T-6 (laporan audit, B.12): bila impor modul gagal (misalnya gangguan jaringan sesaat saat cold start), Promise
// dikosongkan lagi supaya permintaan berikutnya mencoba ulang, tidak gagal selamanya.
// M-166: Promise disimpan SEBELUM menunggu, jadi permintaan yang datang bersamaan saat cold start memakai satu impor
// yang sama. Saat gagal, yang dikosongkan hanya Promise yang gagal itu (bukan Promise lebih baru dari percobaan ulang).
export function memoizeWithRetry<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    if (!pending) {
      const current: Promise<T> = load().catch((err) => {
        if (pending === current) pending = undefined;
        throw err;
      });
      pending = current;
    }
    return pending;
  };
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// R-132: membaca isi salinan respons paling banyak `limit` byte; null bila lebih besar (pembacaan dihentikan).
async function readSmallBody(response: Response, limit: number): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  const reader = response.clone().body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      // Tidak ditunggu: pada salinan (tee), cancel baru selesai setelah salinan lainnya juga dibatalkan.
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response, requestId: string, startedAt: number, label: string): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await readSmallBody(response, MAX_INSPECT_BYTES);
  if (body === null || !isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  console.error(`[ssr] request ${label}:`, consumeCapturedError(requestId, startedAt) ?? new Error(`h3 swallowed SSR error: ${body}`));
  return brandedErrorResponse();
}

export function createFetchHandler(loadServerEntry: () => Promise<ServerEntry>) {
  const getServerEntry = memoizeWithRetry(loadServerEntry);
  return async function fetch(request: Request, env: ServerEnv, ctx: ServerContext): Promise<Response> {
    // M-2 (laporan audit): setiap permintaan punya ID sendiri, supaya galat yang tertangkap tidak tertukar
    // dengan galat permintaan lain yang berjalan bersamaan.
    // M-167: ID itu selalu dibuat server (UUID). Dulu x-request-id dari klien dipakai apa adanya sebagai kunci, sehingga
    // klien bisa memakai ID permintaan orang lain atau menyisipkan teks apa pun ke log. Sekarang nilai klien hanya
    // ikut dicatat di log sebagai label, dan hanya bila bentuknya wajar (huruf, angka, . _ : -, maksimal 64).
    const requestId = crypto.randomUUID();
    const clientId = request.headers.get("x-request-id") ?? "";
    const label = CLIENT_REQUEST_ID.test(clientId) ? `${requestId} (x-request-id ${clientId})` : requestId;
    const startedAt = Date.now(); // K-19: dipakai untuk mencocokkan galat tanpa ID permintaan dengan permintaan ini
    return runWithRequestId(requestId, async () => {
      try {
        const handler = await getServerEntry();
        const response = await handler.fetch(request, env, ctx);
        return await normalizeCatastrophicSsrResponse(response, requestId, startedAt, label);
      } catch (error) {
        console.error(`[ssr] request ${label}:`, error);
        return brandedErrorResponse();
      }
    });
  };
}

export default {
  fetch: createFetchHandler(() =>
    import("@tanstack/react-start/server-entry").then(
      (m) => (m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry),
    ),
  ),
};
