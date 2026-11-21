import * as React from "react";
import * as SeparatorPrimitive from "@radix-ui/react-separator";

import { cn } from "@/lib/utils";

const Separator = React.forwardRef<
  React.ComponentRef<typeof SeparatorPrimitive.Root>, // R-106: ComponentRef, bukan ElementRef yang usang
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
  // R-107 (FALSE POSITIVE, sengaja dipertahankan): Radix Separator TIDAK punya nilai bawaan decorative=true.
  // Di kode Radix, decorative yang tidak diisi bernilai undefined sehingga elemen mendapat role="separator".
  // Bawaan true di sini adalah pilihan shadcn (garis hanya hiasan, role="none"); membuangnya mengubah perilaku.
>(({ className, orientation = "horizontal", decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn(
      "shrink-0 bg-border",
      orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",
      className,
    )}
    {...props}
  />
));
Separator.displayName = SeparatorPrimitive.Root.displayName;

export { Separator };
