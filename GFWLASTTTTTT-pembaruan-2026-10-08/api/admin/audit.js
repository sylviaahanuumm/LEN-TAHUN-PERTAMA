import { sendProblem } from "../_problem.js";
import { listAudit, requireAuth } from "../_rbac.js";

// Catatan aktivitas (khusus izin audit:view). GET ?limit=200&user=nama&action=login_gagal → { entries: [...] }
export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  if ((req.method || "GET") !== "GET") return sendProblem(res, 405, "Gunakan GET.");
  const auth = await requireAuth(req, res, "audit:view");
  if (!auth) return;
  const q = req.query || {};
  return res.json({ entries: await listAudit({ limit: q.limit, user: q.user, action: q.action }) });
}
