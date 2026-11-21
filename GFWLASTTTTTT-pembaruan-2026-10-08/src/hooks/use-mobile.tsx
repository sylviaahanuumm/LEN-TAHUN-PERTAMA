import * as React from "react";

const MOBILE_BREAKPOINT = 768;
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

// M-149: satu sumber kebenaran, yaitu hasil media query yang juga didengarkan (mql.matches), bukan innerWidth.
function matchesMobile(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(MOBILE_QUERY).matches
    : false;
}

export function useIsMobile() {
  // M-148: nilai awal dibaca langsung saat render pertama, sehingga perangkat seluler tidak sempat menampilkan
  // tata letak desktop dulu. Di server (tanpa window) nilainya false.
  const [isMobile, setIsMobile] = React.useState<boolean>(matchesMobile);

  React.useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = () => {
      setIsMobile(mql.matches);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(mql.matches);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
