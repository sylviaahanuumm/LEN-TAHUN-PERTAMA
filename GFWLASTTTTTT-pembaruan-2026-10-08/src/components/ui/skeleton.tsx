import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  // R-110: diumumkan sebagai status "sedang memuat" ke screen reader; label/role tetap bisa diganti lewat props.
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Memuat"
      className={cn("animate-pulse rounded-md bg-primary/10", className)}
      {...props}
    />
  );
}

export { Skeleton };
