// R-082: lapisan z-index untuk elemen yang melayang di atas peta, dikumpulkan di satu tempat supaya urutannya
// jelas dan tidak bentrok. Nilainya ditulis sebagai kelas Tailwind utuh agar tetap terbaca oleh pemindai Tailwind
// (@source "../src" di styles.css). Urutan: panel (1000) < panel alat (1100) < overlay pemuatan (2000).
export const Z_LAYER = {
  panel: "z-[1000]",
  toolPanel: "z-[1100]",
  overlay: "z-[2000]",
} as const;
