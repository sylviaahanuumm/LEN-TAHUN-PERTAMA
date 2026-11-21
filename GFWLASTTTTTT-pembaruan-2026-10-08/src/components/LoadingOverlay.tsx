import { Z_LAYER } from "@/lib/layers";

export default function LoadingOverlay({ show, label }: { show: boolean; label: string }) {
  if (!show) return null;
  return (
    <div className={`fixed inset-0 ${Z_LAYER.overlay} flex items-center justify-center pointer-events-none`}>
      {/* M-132: role="status" + aria-live supaya label pemuatan diumumkan screen reader; putaran hanya hiasan. */}
      <div role="status" aria-live="polite" className="glass rounded-2xl px-6 py-5 flex items-center gap-3 pointer-events-auto">
        <div aria-hidden="true" className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        <div className="text-sm text-foreground">{label}</div>
      </div>
    </div>
  );
}