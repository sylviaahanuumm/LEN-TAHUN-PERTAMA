import { sendProblem } from "../_problem.js";
import { applyRateLimit } from "../_rate-limit.js";
import { audit, createRole, deleteRole, listRoles, PERMISSIONS, requireAuth, setRolePermissions } from "../_rbac.js";

// Role dan permission (khusus izin user:manage, yaitu Admin).
//   GET                                                      → { roles: [...], permissions: [...] }
//   POST { action: "set-permissions", id, permissions: [] }  → { ok }   (role admin tidak bisa diubah)
//   POST { action: "create", name, description, permissions } → { ok, id }
//   POST { action: "delete", id }                            → { ok }   (hanya role buatan sendiri yang tidak dipakai)

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  const method = req.method || "GET";
  if (method !== "GET" && method !== "POST") return sendProblem(res, 405, "Gunakan GET atau POST.");
  const auth = await requireAuth(req, res, "user:manage");
  if (!auth) return;
  if (method === "GET") return res.json({ roles: await listRoles(), permissions: PERMISSIONS });

  const allowed = await applyRateLimit(req, res, { name: "admin-roles", limit: 60, windowSeconds: 60 });
  if (!allowed) return;
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const permissions = Array.isArray(body.permissions) ? body.permissions.map(String) : [];
  const actor = auth.user.username;

  if (body.action === "set-permissions") {
    const result = await setRolePermissions(body.id, permissions);
    if (!result.ok) return sendProblem(res, 400, result.message, { ok: false });
    audit({ actor, action: "role_diubah", target: result.role, ip: auth.ip, detail: `izin: ${result.permissions.join(", ") || "(kosong)"}` });
    return res.json({ ok: true });
  }
  if (body.action === "create") {
    const result = await createRole({ name: body.name, description: body.description, permissions });
    if (!result.ok) return sendProblem(res, 400, result.message, { ok: false });
    audit({ actor, action: "role_dibuat", target: String(body.name).trim().toLowerCase(), ip: auth.ip, detail: `izin: ${result.permissions.join(", ") || "(kosong)"}` });
    return res.json({ ok: true, id: result.id });
  }
  if (body.action === "delete") {
    const result = await deleteRole(body.id);
    if (!result.ok) return sendProblem(res, 400, result.message, { ok: false });
    audit({ actor, action: "role_dihapus", target: result.role, ip: auth.ip });
    return res.json({ ok: true });
  }
  return sendProblem(res, 400, "Aksi tidak dikenal.", { ok: false });
}
