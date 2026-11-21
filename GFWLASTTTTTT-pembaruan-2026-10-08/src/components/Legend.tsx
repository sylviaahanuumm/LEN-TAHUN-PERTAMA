import type { Mode } from "@/lib/types";
import { Z_LAYER } from "@/lib/layers";

export default function Legend({ mode }: { mode: Mode | null }) {
  if (!mode) return null;
  // R-081: tiap butir punya id tetap (k) untuk key React, bukan teks tampilan yang bisa berubah/diterjemahkan.
  const items = mode === "ais" ? [
    { k: "ais-stop",    c: "var(--ais-stop)",    l: "Berhenti (<1 kn)" },
    { k: "ais-slow",    c: "var(--ais-slow)",    l: "Lambat (1–5 kn)" },
    { k: "ais-normal",  c: "var(--ais-normal)",  l: "Normal (5–12 kn)" },
    { k: "ais-fast",    c: "var(--ais-fast)",    l: "Cepat (>12 kn)" },
    { k: "ais-unknown", c: "var(--ais-unknown)", l: "Tidak diketahui" },
  ] : [
    { k: "gfw-fishing",   c: "var(--gfw-fishing)",   l: "Fishing" },
    { k: "gfw-encounter", c: "var(--gfw-encounter)", l: "Encounter" },
    { k: "gfw-loitering", c: "var(--gfw-loitering)", l: "Loitering" },
    { k: "gfw-other",     c: "var(--gfw-other)",     l: "Lainnya" },
  ];
  return (
    <div className={`fixed bottom-4 left-3 ${Z_LAYER.panel} glass rounded-xl px-3 py-2.5 text-xs space-y-1.5 min-w-[170px]`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
        {mode === "ais" ? "Kecepatan" : "Tipe Event"}
      </div>
      {items.map((it) => (
        <div key={it.k} className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: it.c, boxShadow: `0 0 6px ${it.c}` }} />
          <span className="text-foreground/90">{it.l}</span>
        </div>
      ))}
    </div>
  );
}