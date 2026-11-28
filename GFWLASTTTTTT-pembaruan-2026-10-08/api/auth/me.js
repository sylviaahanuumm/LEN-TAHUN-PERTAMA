import { sendProblem } from "../_problem.js";
import { PERMISSIONS, publicUser, rbacEnabled, requireAuth } from "../_rbac.js";

// Siapa yang sedang login dan izinnya. Dipakai halaman (menu, Akun Saya, Kelola User) untuk menampilkan atau
// menyembunyikan tombol. Ini hanya untuk TAMPILAN: pemeriksaan izin yang sebenarnya tetap di server (api/_rbac.js).
// GET → 200 { mode: "rbac", user: {...}, permissions: [...] }
//       200 { mode: "legacy", permissions: [semua] } bila RBAC tidak aktif (login lama LOGIN_USERNAME/LOGIN_PASSWORD)
export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  if ((req.method || "GET") !== "GET") return sendProblem(res, 405, "Gunakan GET.");
  if (!rbacEnabled()) {
    return res.json({ mode: "legacy", user: null, permissions: PERMISSIONS.map((p) => p.key).filter((k) => k !== "user:manage" && k !== "audit:view") });
  }
  const auth = await requireAuth(req, res, null, { allowMustChange: true });
  if (!auth) return;
  return res.json({ mode: "rbac", user: publicUser(auth.user), permissions: [...auth.permissions].sort() });
}
