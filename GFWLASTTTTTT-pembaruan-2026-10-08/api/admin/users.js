import { sendProblem } from "../_problem.js";
import { applyRateLimit } from "../_rate-limit.js";
import {
  audit, countActiveAdmins, createUser, findUserById, listUsers, requireAuth, resetPassword, roleByName, unlockUser, updateUser,
} from "../_rbac.js";

// Kelola user (khusus izin user:manage, yaitu Admin).
//   GET                                           → { users: [...] }
//   POST { action: "create", username, displayName, role }   → { ok, user, tempPassword }
//   POST { action: "update", id, role?, active?, displayName? } → { ok }
//   POST { action: "reset-password", id }        → { ok, tempPassword }
//   POST { action: "unlock", id }                → { ok }
// Kata sandi sementara hanya ditampilkan SEKALI ke Admin; user wajib menggantinya saat login pertama.
// Pengaman: Admin tidak bisa menonaktifkan atau menurunkan role akunnya sendiri, dan admin aktif terakhir tidak
// bisa dinonaktifkan/diturunkan (supaya tidak ada yang terkunci di luar sistem).

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  const method = req.method || "GET";
  if (method !== "GET" && method !== "POST") return sendProblem(res, 405, "Gunakan GET atau POST.");
  const auth = await requireAuth(req, res, "user:manage");
  if (!auth) return;
  if (method === "GET") return res.json({ users: await listUsers() });

  const allowed = await applyRateLimit(req, res, { name: "admin-users", limit: 60, windowSeconds: 60 });
  if (!allowed) return;
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const actor = auth.user.username;
  const ip = auth.ip;

  if (body.action === "create") {
    const result = await createUser({ username: body.username, displayName: body.displayName, roleName: body.role });
    if (!result.ok) return sendProblem(res, 400, result.message, { ok: false });
    audit({ actor, action: "user_dibuat", target: result.user.username, ip, detail: `role ${result.user.role}` });
    return res.json({ ok: true, user: result.user, tempPassword: result.tempPassword });
  }

  const target = Number.isInteger(Number(body.id)) ? await findUserById(Number(body.id)) : null;
  if (!target) return sendProblem(res, 404, "User tidak ditemukan.", { ok: false });

  if (body.action === "update") {
    const change = {};
    const notes = [];
    if (body.displayName !== undefined) {
      change.displayName = String(body.displayName);
      notes.push("nama tampilan");
    }
    if (body.role !== undefined && body.role !== target.role) {
      const role = await roleByName(body.role);
      if (!role) return sendProblem(res, 400, "Role tidak dikenal.", { ok: false });
      if (target.id === auth.user.id) return sendProblem(res, 400, "Anda tidak bisa mengubah role akun Anda sendiri.", { ok: false });
      if (target.role === "admin" && (await countActiveAdmins(target.id)) === 0) {
        return sendProblem(res, 400, "Ini admin aktif terakhir. Jadikan user lain admin dulu.", { ok: false });
      }
      change.roleId = role.id;
      notes.push(`role ${target.role} → ${role.name}`);
    }
    if (body.active !== undefined && Boolean(body.active) !== Boolean(target.is_active)) {
      if (target.id === auth.user.id) return sendProblem(res, 400, "Anda tidak bisa menonaktifkan akun Anda sendiri.", { ok: false });
      if (!body.active && target.role === "admin" && (await countActiveAdmins(target.id)) === 0) {
        return sendProblem(res, 400, "Ini admin aktif terakhir. Jadikan user lain admin dulu.", { ok: false });
      }
      change.active = Boolean(body.active);
      notes.push(body.active ? "diaktifkan" : "dinonaktifkan");
    }
    if (!notes.length) return res.json({ ok: true });
    await updateUser(target.id, change);
    audit({ actor, action: "user_diubah", target: target.username, ip, detail: notes.join(", ") });
    return res.json({ ok: true });
  }

  if (body.action === "reset-password") {
    const tempPassword = await resetPassword(target.id);
    audit({ actor, action: "sandi_direset", target: target.username, ip, detail: "wajib ganti saat login berikutnya" });
    return res.json({ ok: true, tempPassword });
  }

  if (body.action === "unlock") {
    await unlockUser(target.id);
    audit({ actor, action: "akun_dibuka", target: target.username, ip });
    return res.json({ ok: true });
  }

  return sendProblem(res, 400, "Aksi tidak dikenal.", { ok: false });
}
