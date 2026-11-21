import { createFileRoute } from "@tanstack/react-router";
import htmlContent from "../../index.html?raw";

export const Route = createFileRoute("/")({
  server: {
    handlers: {
      GET: async () => {
        return new Response(htmlContent, {
          headers: {
            "content-type": "text/html; charset=utf-8",
            // M-165: browser tidak boleh menebak tipe isi (MIME sniffing).
            "x-content-type-options": "nosniff",
            "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
          },
        });
      },
    },
  },
});
