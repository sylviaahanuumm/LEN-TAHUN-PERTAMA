import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";

// M-168: di produksi, log hanya berisi ID galat, jenis, dan pesannya. Stack trace (berisi path file internal) dan
// isi objek galat lainnya hanya ditulis saat pengembangan.
function logError(errorId: string, error: unknown) {
  if (process.env.NODE_ENV === "production") {
    const name = error instanceof Error ? error.name : typeof error;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[start] galat ${errorId}: ${name}: ${message}`);
  } else {
    console.error(`[start] galat ${errorId}:`, error);
  }
}

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    // R-133: pemeriksaan kosong ditulis eksplisit (!== null), bukan != null.
    if (error !== null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    // M-169: setiap galat diberi ID korelasi. ID yang sama ada di log server dan di header x-error-id balasan,
    // supaya laporan pengguna bisa dicocokkan dengan baris log yang tepat.
    const errorId = crypto.randomUUID();
    logError(errorId, error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8", "x-error-id": errorId },
    });
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware],
}));
