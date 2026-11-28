// RBAC (Role-Based Access Control) Ocean Nexus: user, role, dan permission untuk server sendiri (npm run start).
//
// Aktif hanya bila AUTH_MODE=rbac. Tanpa itu (misalnya di Vercel) login tetap memakai LOGIN_USERNAME/LOGIN_PASSWORD
// seperti sebelumnya (api/auth/login.js), karena Vercel tidak bisa menyimpan file database.
//
// Penyimpanan: SQLite bawaan Node.js 22.13+ (node:sqlite), file RBAC_DB (default .local-dev/rbac.sqlite).
// Tabel: users, roles, permissions, role_permissions, audit_log, revoked_sessions.
//
// Keamanan (mengikuti OWASP Authentication, Password Storage, Session Management, dan Authorization Cheat Sheet):
//   - Kata sandi disimpan sebagai hash scrypt (N=2^17, r=8, p=1, salt acak 16 byte), tidak pernah dalam bentuk asli.
//   - Akun terkunci 15 menit setelah 5 kali salah kata sandi berturut-turut. Pesan galat login selalu sama, supaya
//     tidak membocorkan apakah nama pengguna ada (user enumeration).
//   - Kata sandi minimal 12 karakter, berisi huruf dan angka, tidak memuat nama pengguna, bukan kata sandi umum.
//   - Akun baru dan akun yang di-reset wajib mengganti kata sandi saat login pertama.
//   - Izin diperiksa di SERVER untuk setiap halaman, data, dan API (bukan hanya tombol yang disembunyikan).
//     Alamat API yang tidak terdaftar ditolak (deny by default).
//   - Setiap sesi membawa session_version (sv). Ganti kata sandi, reset, ubah role, atau nonaktifkan akun menaikkan
//     sv sehingga semua sesi lama akun itu langsung tidak berlaku. Logout dicatat di database (tetap berlaku walau
//     server dinyalakan ulang).
//   - Permintaan yang mengubah data (POST/PUT/PATCH/DELETE ke /api/) dari situs lain ditolak (cek Origin, anti-CSRF).
//   - Semua kejadian penting dicatat di audit_log: login berhasil/gagal, logout, ganti kata sandi, perubahan user/role,
//     dan akses yang ditolak.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { clientIpKey } from "./_rate-limit.js";
import { readCookie, SESSION_COOKIE, verifySessionToken } from "./_session.js";

const scryptAsync = promisify(crypto.scrypt);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const ROLE_NAME_RE = /^[a-z][a-z0-9_-]{2,31}$/;
// OWASP Password Storage Cheat Sheet: scrypt minimal N=2^17, r=8, p=1.
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, keylen: 32 };
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

export function rbacEnabled() {
  return String(process.env.AUTH_MODE || "").trim().toLowerCase() === "rbac";
}

// ---------------------------------------------------------------------------------------------------------------
// Daftar permission (izin) dan role bawaan
// ---------------------------------------------------------------------------------------------------------------
export const PERMISSIONS = [
  { key: "dashboard:view", description: "Membuka dashboard peta (Wilayah Indonesia) dan data kapal, cuaca, AIS" },
  { key: "anomaly:view", description: "Membuka halaman Anomaly Alert Center" },
  { key: "report:view", description: "Membuka halaman Data Reports dan mengunduh laporan" },
  { key: "alert:send", description: "Mengirim alert Telegram lewat server" },
  { key: "user:manage", description: "Mengelola user dan role (tambah, ubah role, nonaktifkan, reset kata sandi)" },
  { key: "audit:view", description: "Melihat catatan aktivitas (audit log)" },
];
const PERMISSION_KEYS = new Set(PERMISSIONS.map((p) => p.key));

const SYSTEM_ROLES = [
  { name: "admin", description: "Akses penuh, termasuk kelola user, role, dan catatan aktivitas", permissions: [...PERMISSION_KEYS] },
  { name: "operator", description: "Dashboard, Anomaly Alert, Data Reports, dan kirim alert", permissions: ["dashboard:view", "anomaly:view", "report:view", "alert:send"] },
  { name: "viewer", description: "Hanya melihat dashboard dan Anomaly Alert", permissions: ["dashboard:view", "anomaly:view"] },
];

// Izin yang dibutuhkan setiap alamat. null = cukup sudah login. DENY = selalu ditolak.
const DENY = Symbol("deny");
const PAGE_PERMISSIONS = {
  "/dashboard.html": "dashboard:view",
  "/lihat_scene_kapal.html": "dashboard:view",
  "/map-background-preview.html": "dashboard:view",
  "/anomaly-alert.html": "anomaly:view",
  "/data-reports.html": "report:view",
  "/kelola-user.html": "user:manage",
  "/akun.html": null,
};
const API_PERMISSIONS = [
  ["/api/auth/me", null],
  ["/api/auth/change-password", null],
  ["/api/admin/audit", "audit:view"],
  ["/api/admin/users", "user:manage"],
  ["/api/admin/roles", "user:manage"],
  ["/api/telegram/", "alert:send"],
  ["/api/gfw/", "dashboard:view"],
  ["/api/ais/", "dashboard:view"],
  ["/api/wind", "dashboard:view"],
];
// Selama wajib ganti kata sandi, hanya alamat ini yang boleh dibuka.
const ALLOWED_WHILE_MUST_CHANGE = new Set(["/akun.html", "/api/auth/me", "/api/auth/change-password", "/api/auth/logout"]);

// Bentuk baku alamat untuk dicocokkan dengan daftar izin, supaya variasi penulisan alamat yang tetap dilayani server
// tidak bisa dipakai melompati pemeriksaan: %2D (persen-encoding), huruf besar (Windows), "//", "/" di akhir, "\\",
// dan alamat tanpa .html (/data-reports dianggap /data-reports.html). Hasil null = alamat tidak sah (ditolak).
export function canonicalPath(pathname) {
  let p;
  try {
    p = decodeURIComponent(String(pathname || "/"));
  } catch {
    return null;
  }
  if (p.includes("\0")) return null;
  const segments = p.replace(/\\/g, "/").split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) return null;
  let out = `/${segments.join("/")}`.toLowerCase();
  const last = segments[segments.length - 1] || "";
  if (segments.length && segments[0].toLowerCase() !== "api" && !last.includes(".")) out += ".html";
  return out;
}

export function requiredPermission(pathname) {
  const p = canonicalPath(pathname);
  if (p === null) return DENY;
  if (p === "/api" || p.startsWith("/api/")) {
    for (const [prefix, perm] of API_PERMISSIONS) {
      if (prefix.endsWith("/") ? p.startsWith(prefix) : p === prefix || p.startsWith(`${prefix}/`)) return perm;
    }
    return DENY; // API yang tidak terdaftar: ditolak
  }
  if (Object.prototype.hasOwnProperty.call(PAGE_PERMISSIONS, p)) return PAGE_PERMISSIONS[p];
  return "dashboard:view"; // halaman dan berkas data lain di balik login
}

// ---------------------------------------------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------------------------------------------
let db = null;
let dbPromise = null;

export function rbacDbFile() {
  return path.resolve(ROOT, process.env.RBAC_DB || path.join(".local-dev", "rbac.sqlite"));
}

async function openDb() {
  const { DatabaseSync } = await import("node:sqlite");
  const file = rbacDbFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new DatabaseSync(file);
  conn.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  conn.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS permissions (
      key TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission_key TEXT NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
      PRIMARY KEY (role_id, permission_key)
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      role_id INTEGER NOT NULL REFERENCES roles(id),
      is_active INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 1,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER NOT NULL DEFAULT 0,
      session_version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_login_at INTEGER,
      password_changed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY,
      at INTEGER NOT NULL,
      actor TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      target TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS audit_log_at ON audit_log(at);
    CREATE TABLE IF NOT EXISTS revoked_sessions (
      sid TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );
  `);
  try {
    fs.chmodSync(file, 0o600); // hanya pemilik file yang boleh membaca database
  } catch {
    /* Windows / sistem file tanpa izin POSIX: abaikan */
  }
  seed(conn);
  return conn;
}

function seed(conn) {
  const now = Date.now();
  const addPerm = conn.prepare("INSERT INTO permissions (key, description) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET description = excluded.description");
  for (const p of PERMISSIONS) addPerm.run(p.key, p.description);
  for (const role of SYSTEM_ROLES) {
    const existing = conn.prepare("SELECT id FROM roles WHERE name = ?").get(role.name);
    if (existing) continue;
    const { lastInsertRowid } = conn.prepare("INSERT INTO roles (name, description, is_system, created_at) VALUES (?, ?, 1, ?)").run(role.name, role.description, now);
    const link = conn.prepare("INSERT OR IGNORE INTO role_permissions (role_id, permission_key) VALUES (?, ?)");
    for (const key of role.permissions) link.run(Number(lastInsertRowid), key);
  }
  conn.prepare("DELETE FROM revoked_sessions WHERE expires_at < ?").run(Math.floor(now / 1000));
}

export async function getDb() {
  if (db) return db;
  dbPromise ??= openDb().then(async (conn) => {
    db = conn;
    await bootstrapAdmin();
    return conn;
  });
  return dbPromise;
}

// Admin pertama: bila belum ada user sama sekali dan LOGIN_USERNAME/LOGIN_PASSWORD diatur, akun itu dibuat sebagai
// admin dan WAJIB mengganti kata sandinya saat login pertama. Cara lain: node scripts/rbac-admin.mjs buat-admin <nama>.
async function bootstrapAdmin() {
  const count = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (count > 0) return;
  const username = normalizeUsername(process.env.LOGIN_USERNAME);
  const password = String(process.env.LOGIN_PASSWORD || "");
  if (!USERNAME_RE.test(username) || !password) {
    console.warn("[rbac] Belum ada user. Buat admin pertama: node scripts/rbac-admin.mjs buat-admin <nama-pengguna>");
    return;
  }
  const adminRole = db.prepare("SELECT id FROM roles WHERE name = 'admin'").get();
  const now = Date.now();
  db.prepare(`INSERT INTO users (username, display_name, password_hash, role_id, must_change_password, created_at, updated_at)
              VALUES (?, ?, ?, ?, 1, ?, ?)`).run(username, "Administrator", await hashPassword(password), adminRole.id, now, now);
  audit({ actor: "sistem", action: "user_dibuat", target: username, detail: "admin pertama dari LOGIN_USERNAME; wajib ganti kata sandi" });
  console.warn(`[rbac] Admin pertama "${username}" dibuat dari LOGIN_USERNAME/LOGIN_PASSWORD. Wajib ganti kata sandi saat login pertama.`);
}

// ---------------------------------------------------------------------------------------------------------------
// Kata sandi
// ---------------------------------------------------------------------------------------------------------------
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scryptAsync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT_MAXMEM });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (![N, r, p].every(Number.isInteger) || !expected.length) return false;
  const actual = await scryptAsync(String(password ?? ""), salt, expected.length, { N, r, p, maxmem: SCRYPT_MAXMEM });
  return crypto.timingSafeEqual(actual, expected);
}

// Hash tiruan untuk nama pengguna yang tidak ada, supaya lama jawaban login sama (tidak membocorkan user mana yang ada).
let dummyHash = null;
async function dummyVerify(password) {
  dummyHash ??= await hashPassword(crypto.randomBytes(18).toString("base64"));
  await verifyPassword(password, dummyHash);
}

const COMMON_PASSWORDS = new Set([
  "123456789012", "password1234", "password123!", "qwerty123456", "admin1234567", "administrator", "oceannexus2026",
  "oceannexus123", "welcome12345", "passw0rd1234", "1234567890ab", "abcdefghijkl", "abc123456789", "iloveyou1234",
]);

// Mengembalikan pesan galat (bahasa Indonesia) atau "" bila kata sandi memenuhi aturan.
export function passwordProblem(password, username = "") {
  const pw = String(password ?? "");
  if (pw.length < PASSWORD_MIN) return `Kata sandi minimal ${PASSWORD_MIN} karakter.`;
  if (pw.length > PASSWORD_MAX) return `Kata sandi maksimal ${PASSWORD_MAX} karakter.`;
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "Kata sandi harus berisi huruf dan angka.";
  const lower = pw.toLowerCase();
  const user = String(username || "").toLowerCase();
  if (user && lower.includes(user)) return "Kata sandi tidak boleh memuat nama pengguna.";
  if (COMMON_PASSWORDS.has(lower) || /^(.)\1+$/.test(pw)) return "Kata sandi terlalu umum. Pilih yang lain.";
  return "";
}

// Kata sandi sementara acak (16 karakter, tanpa huruf yang mirip seperti O/0 dan l/1), selalu memenuhi aturan.
export function generateTempPassword() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
  const digits = "23456789";
  const all = letters + digits;
  for (;;) {
    let out = "";
    for (let i = 0; i < 16; i++) out += all[crypto.randomInt(all.length)];
    if (/[A-Za-z]/.test(out) && /[0-9]/.test(out)) return out;
  }
}

export function normalizeUsername(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function validUsername(value) {
  return USERNAME_RE.test(normalizeUsername(value));
}

export function validRoleName(value) {
  return ROLE_NAME_RE.test(String(value ?? "").trim().toLowerCase());
}

// ---------------------------------------------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------------------------------------------
export function audit({ actor = "", action, target = "", ip = "", detail = "" }) {
  try {
    db?.prepare("INSERT INTO audit_log (at, actor, action, target, ip, detail) VALUES (?, ?, ?, ?, ?, ?)")
      .run(Date.now(), String(actor).slice(0, 64), String(action).slice(0, 64), String(target).slice(0, 200), String(ip).slice(0, 120), String(detail).slice(0, 500));
  } catch (err) {
    console.error("[rbac] audit gagal ditulis:", err?.message || err);
  }
}

// Akses ditolak dicatat paling banyak sekali per menit untuk pasangan user+alamat yang sama (supaya log tidak banjir).
const deniedSeen = new Map();
function auditDenied(user, pathname, ip, reason) {
  const key = `${user}|${pathname}|${reason}`;
  const now = Date.now();
  if (now - (deniedSeen.get(key) || 0) < 60_000) return;
  if (deniedSeen.size > 5000) deniedSeen.clear();
  deniedSeen.set(key, now);
  audit({ actor: user, action: "akses_ditolak", target: pathname, ip, detail: reason });
}

// ---------------------------------------------------------------------------------------------------------------
// User dan role
// ---------------------------------------------------------------------------------------------------------------
const USER_COLUMNS = `u.id, u.username, u.display_name, u.password_hash, u.role_id, r.name AS role, u.is_active, u.must_change_password,
  u.failed_attempts, u.locked_until, u.session_version, u.created_at, u.updated_at, u.last_login_at, u.password_changed_at`;

export async function findUserByUsername(username) {
  await getDb();
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users u JOIN roles r ON r.id = u.role_id WHERE u.username = ?`).get(normalizeUsername(username)) || null;
}

export async function findUserById(id) {
  await getDb();
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`).get(Number(id)) || null;
}

export async function permissionsOfRole(roleId) {
  await getDb();
  const role = db.prepare("SELECT name FROM roles WHERE id = ?").get(Number(roleId));
  if (!role) return new Set();
  if (role.name === "admin") return new Set(PERMISSION_KEYS); // admin selalu punya semua izin (tidak bisa terkunci keluar)
  const rows = db.prepare("SELECT permission_key FROM role_permissions WHERE role_id = ?").all(Number(roleId));
  return new Set(rows.map((row) => row.permission_key).filter((key) => PERMISSION_KEYS.has(key)));
}

export function publicUser(user, permissions) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    active: Boolean(user.is_active),
    mustChangePassword: Boolean(user.must_change_password),
    locked: Number(user.locked_until) > Date.now(),
    lastLoginAt: user.last_login_at ?? null,
    createdAt: user.created_at,
    ...(permissions ? { permissions: [...permissions].sort() } : {}),
  };
}

// Login: mengembalikan { ok, user, reason }. Pesan untuk pengguna selalu sama; reason hanya untuk audit log.
export async function attemptLogin(username, password, ip) {
  await getDb();
  const name = normalizeUsername(username);
  const user = name ? await findUserByUsername(name) : null;
  const now = Date.now();
  if (!user) {
    await dummyVerify(password);
    audit({ actor: name.slice(0, 64), action: "login_gagal", ip, detail: "nama pengguna tidak dikenal" });
    return { ok: false, reason: "unknown" };
  }
  const passwordOk = await verifyPassword(password, user.password_hash);
  if (!user.is_active) {
    audit({ actor: user.username, action: "login_gagal", ip, detail: "akun nonaktif" });
    return { ok: false, reason: "inactive" };
  }
  if (Number(user.locked_until) > now) {
    audit({ actor: user.username, action: "login_gagal", ip, detail: "akun sedang terkunci" });
    return { ok: false, reason: "locked" };
  }
  if (!passwordOk) {
    const failures = Number(user.failed_attempts) + 1;
    if (failures >= MAX_FAILED_LOGINS) {
      db.prepare("UPDATE users SET failed_attempts = 0, locked_until = ?, updated_at = ? WHERE id = ?").run(now + LOCK_MINUTES * 60_000, now, user.id);
      audit({ actor: user.username, action: "akun_terkunci", ip, detail: `${MAX_FAILED_LOGINS} kali salah kata sandi, terkunci ${LOCK_MINUTES} menit` });
    } else {
      db.prepare("UPDATE users SET failed_attempts = ?, updated_at = ? WHERE id = ?").run(failures, now, user.id);
      audit({ actor: user.username, action: "login_gagal", ip, detail: `kata sandi salah (${failures}/${MAX_FAILED_LOGINS})` });
    }
    return { ok: false, reason: "password" };
  }
  db.prepare("UPDATE users SET failed_attempts = 0, locked_until = 0, last_login_at = ?, updated_at = ? WHERE id = ?").run(now, now, user.id);
  audit({ actor: user.username, action: "login_berhasil", ip });
  return { ok: true, user: await findUserById(user.id) };
}

export async function changeOwnPassword(user, currentPassword, newPassword, ip) {
  await getDb();
  if (!(await verifyPassword(currentPassword, user.password_hash))) {
    audit({ actor: user.username, action: "ganti_sandi_gagal", ip, detail: "kata sandi lama salah" });
    return { ok: false, status: 400, message: "Kata sandi lama salah." };
  }
  const problem = passwordProblem(newPassword, user.username);
  if (problem) return { ok: false, status: 400, message: problem };
  if (await verifyPassword(newPassword, user.password_hash)) {
    return { ok: false, status: 400, message: "Kata sandi baru harus berbeda dari kata sandi lama." };
  }
  const now = Date.now();
  db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0, session_version = session_version + 1,
              password_changed_at = ?, updated_at = ? WHERE id = ?`).run(await hashPassword(newPassword), now, now, user.id);
  audit({ actor: user.username, action: "ganti_sandi", target: user.username, ip });
  return { ok: true, user: await findUserById(user.id) };
}

// ---------------------------------------------------------------------------------------------------------------
// Sesi yang sudah logout (disimpan di database, tetap berlaku walau server dinyalakan ulang)
// ---------------------------------------------------------------------------------------------------------------
export async function revokeSessionId(sid, expiresAtSeconds) {
  await getDb();
  db.prepare("INSERT OR REPLACE INTO revoked_sessions (sid, expires_at) VALUES (?, ?)").run(String(sid), Number(expiresAtSeconds) || 0);
}

async function isSessionRevoked(sid) {
  await getDb();
  return Boolean(db.prepare("SELECT 1 FROM revoked_sessions WHERE sid = ?").get(String(sid)));
}

// ---------------------------------------------------------------------------------------------------------------
// Pemeriksaan akses untuk setiap permintaan (dipakai server/index.mjs dan vite.config.ts)
// ---------------------------------------------------------------------------------------------------------------
function headerValue(headers, name) {
  const value = (headers || {})[name];
  return Array.isArray(value) ? value[0] : String(value || "");
}

// Anti-CSRF: permintaan yang mengubah data harus berasal dari situs ini sendiri (header Origin, atau Referer).
function sameOrigin(headers) {
  const host = headerValue(headers, "host").toLowerCase();
  const source = headerValue(headers, "origin") || headerValue(headers, "referer");
  if (!source) return true; // bukan dari browser (mis. curl dengan cookie sah); browser selalu mengirim Origin untuk POST
  try {
    return new URL(source).host.toLowerCase() === host;
  } catch {
    return false;
  }
}

const isPage = (pathname) => !pathname.startsWith("/api/") && (/\.html?$/i.test(pathname) || !pathname.split("/").pop().includes("."));

/**
 * Keputusan RBAC untuk permintaan yang SUDAH lolos decideAccess (cookie sesi sah).
 * Hasil:
 *   { action: "allow", user, permissions }
 *   { action: "redirect", location, clearCookie? }
 *   { action: "deny", status: 401|403, page: boolean, message, clearCookie? }
 */
export async function authorizeRequest({ session, method = "GET", pathname, headers, ip = "" }) {
  const page = isPage(pathname);
  const toLogin = (reason) => (page
    ? { action: "redirect", location: `/index.html?next=${encodeURIComponent(pathname)}`, clearCookie: true, reason }
    : { action: "deny", status: 401, page: false, message: "Sesi login tidak berlaku lagi. Silakan login lagi.", clearCookie: true, reason });

  if (!session || !Number.isInteger(session.uid)) return toLogin("sesi tanpa user RBAC");
  if (await isSessionRevoked(session.sid)) return toLogin("sesi sudah logout");
  const user = await findUserById(session.uid);
  if (!user || !user.is_active) return toLogin("akun tidak ada / nonaktif");
  if (Number(user.session_version) !== Number(session.sv)) return toLogin("sesi lama (kata sandi/role berubah)");

  const lower = canonicalPath(pathname) ?? "";
  if (user.must_change_password && !ALLOWED_WHILE_MUST_CHANGE.has(lower)) {
    if (page) return { action: "redirect", location: "/akun.html?wajib=1" };
    return { action: "deny", status: 403, page: false, message: "Ganti kata sandi dulu sebelum memakai aplikasi." };
  }

  if (lower.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(String(method).toUpperCase()) && !sameOrigin(headers)) {
    auditDenied(user.username, pathname, ip, "permintaan dari situs lain (CSRF)");
    return { action: "deny", status: 403, page: false, message: "Permintaan ditolak (asal permintaan tidak sah)." };
  }

  const permissions = await permissionsOfRole(user.role_id);
  const need = requiredPermission(pathname);
  if (need === DENY || (need && !permissions.has(need))) {
    auditDenied(user.username, pathname, ip, need === DENY ? "alamat API tidak terdaftar" : `butuh izin ${need}`);
    return { action: "deny", status: 403, page, message: "Akses ditolak: role Anda tidak memiliki izin untuk halaman atau data ini." };
  }
  return { action: "allow", user, permissions };
}

// Dipakai handler di api/ (pertahanan lapis kedua, walau server sudah memeriksa): baca cookie, periksa user dan izin.
// permission null = cukup login. allowMustChange = boleh dipakai walau user masih wajib ganti kata sandi.
// Mengembalikan { user, permissions, session, ip } atau null (balasan 401/403/404 sudah dikirim).
export async function requireAuth(req, res, permission = null, { allowMustChange = false } = {}) {
  const { sendProblem } = await import("./_problem.js");
  if (!rbacEnabled()) {
    sendProblem(res, 404, "Fitur akun (RBAC) belum aktif di server ini.");
    return null;
  }
  const ip = clientIpKey(req);
  const session = await verifySessionToken(readCookie(req.headers?.cookie, SESSION_COOKIE));
  const user = session && Number.isInteger(session.uid) && !(await isSessionRevoked(session.sid)) ? await findUserById(session.uid) : null;
  if (!user || !user.is_active || Number(user.session_version) !== Number(session.sv)) {
    sendProblem(res, 401, "Sesi login tidak berlaku lagi. Silakan login lagi.");
    return null;
  }
  if (user.must_change_password && !allowMustChange) {
    sendProblem(res, 403, "Ganti kata sandi dulu sebelum memakai aplikasi.");
    return null;
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(String(req.method || "GET").toUpperCase()) && !sameOrigin(req.headers)) {
    auditDenied(user.username, "api", ip, "permintaan dari situs lain (CSRF)");
    sendProblem(res, 403, "Permintaan ditolak (asal permintaan tidak sah).");
    return null;
  }
  const permissions = await permissionsOfRole(user.role_id);
  if (permission && !permissions.has(permission)) {
    auditDenied(user.username, permission, ip, `butuh izin ${permission}`);
    sendProblem(res, 403, "Akses ditolak: role Anda tidak memiliki izin ini.");
    return null;
  }
  return { user, permissions, session, ip };
}

// Halaman 403 sederhana (tanpa data dari pengguna di dalamnya).
export const FORBIDDEN_PAGE = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Akses ditolak - Ocean Nexus</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1726;color:#e8f4ff;font-family:system-ui,sans-serif}
main{max-width:460px;padding:32px;border:1px solid rgba(143,220,255,.3);border-radius:16px;background:rgba(3,26,44,.7);text-align:center}
h1{margin:0 0 10px;font-size:26px}p{color:#b9d3e6;line-height:1.5}a{display:inline-block;margin-top:14px;padding:10px 18px;border-radius:10px;background:#79cfff;color:#06314b;font-weight:700;text-decoration:none}</style></head>
<body><main><h1>Akses ditolak</h1><p>Role akun Anda tidak memiliki izin untuk membuka halaman ini. Hubungi Admin bila Anda membutuhkan akses.</p><a href="/index.html#menu">Kembali ke menu</a></main></body></html>`;

// ---------------------------------------------------------------------------------------------------------------
// Pengelolaan (dipakai api/admin/*.js dan scripts/rbac-admin.mjs)
// ---------------------------------------------------------------------------------------------------------------
export async function listUsers() {
  await getDb();
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.username`).all().map((u) => publicUser(u));
}

export async function roleByName(name) {
  await getDb();
  return db.prepare("SELECT id, name, is_system FROM roles WHERE name = ?").get(String(name ?? "").trim().toLowerCase()) || null;
}

export async function countActiveAdmins(exceptUserId = 0) {
  await getDb();
  return db.prepare("SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'admin' AND u.is_active = 1 AND u.id != ?")
    .get(Number(exceptUserId)).n;
}

export async function createUser({ username, displayName = "", roleName }) {
  await getDb();
  const name = normalizeUsername(username);
  if (!validUsername(name)) return { ok: false, message: "Nama pengguna 3-32 karakter: huruf kecil, angka, titik, minus, atau garis bawah." };
  if (await findUserByUsername(name)) return { ok: false, message: "Nama pengguna sudah dipakai." };
  const role = await roleByName(roleName);
  if (!role) return { ok: false, message: "Role tidak dikenal." };
  const tempPassword = generateTempPassword();
  const now = Date.now();
  const { lastInsertRowid } = db.prepare(`INSERT INTO users (username, display_name, password_hash, role_id, must_change_password, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)`).run(name, String(displayName).trim().slice(0, 80), await hashPassword(tempPassword), role.id, now, now);
  return { ok: true, user: publicUser(await findUserById(Number(lastInsertRowid))), tempPassword };
}

export async function resetPassword(userId) {
  await getDb();
  const tempPassword = generateTempPassword();
  const now = Date.now();
  db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = 0,
              session_version = session_version + 1, updated_at = ? WHERE id = ?`).run(await hashPassword(tempPassword), now, Number(userId));
  return tempPassword;
}

export async function unlockUser(userId) {
  await getDb();
  db.prepare("UPDATE users SET failed_attempts = 0, locked_until = 0, updated_at = ? WHERE id = ?").run(Date.now(), Number(userId));
}

export async function updateUser(userId, { roleId, active, displayName }) {
  await getDb();
  const sets = [];
  const values = [];
  let bump = false;
  if (roleId !== undefined) { sets.push("role_id = ?"); values.push(Number(roleId)); bump = true; }
  if (active !== undefined) { sets.push("is_active = ?"); values.push(active ? 1 : 0); bump = true; }
  if (displayName !== undefined) { sets.push("display_name = ?"); values.push(String(displayName).trim().slice(0, 80)); }
  if (!sets.length) return;
  if (bump) sets.push("session_version = session_version + 1");
  sets.push("updated_at = ?");
  values.push(Date.now(), Number(userId));
  db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

export async function listRoles() {
  await getDb();
  const roles = db.prepare(`SELECT r.id, r.name, r.description, r.is_system,
      (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count FROM roles r ORDER BY r.is_system DESC, r.name`).all();
  const out = [];
  for (const r of roles) {
    out.push({ id: r.id, name: r.name, description: r.description, isSystem: Boolean(r.is_system), userCount: r.user_count,
      locked: r.name === "admin", permissions: [...(await permissionsOfRole(r.id))].sort() });
  }
  return out;
}

export async function createRole({ name, description = "", permissions = [] }) {
  await getDb();
  const roleName = String(name ?? "").trim().toLowerCase();
  if (!validRoleName(roleName)) return { ok: false, message: "Nama role 3-32 karakter: diawali huruf kecil, lalu huruf kecil, angka, minus, atau garis bawah." };
  if (await roleByName(roleName)) return { ok: false, message: "Nama role sudah dipakai." };
  const keys = [...new Set(permissions)].filter((key) => PERMISSION_KEYS.has(key));
  const { lastInsertRowid } = db.prepare("INSERT INTO roles (name, description, is_system, created_at) VALUES (?, ?, 0, ?)")
    .run(roleName, String(description).trim().slice(0, 160), Date.now());
  const link = db.prepare("INSERT OR IGNORE INTO role_permissions (role_id, permission_key) VALUES (?, ?)");
  for (const key of keys) link.run(Number(lastInsertRowid), key);
  return { ok: true, id: Number(lastInsertRowid), permissions: keys };
}

export async function setRolePermissions(roleId, permissions) {
  await getDb();
  const role = db.prepare("SELECT id, name FROM roles WHERE id = ?").get(Number(roleId));
  if (!role) return { ok: false, message: "Role tidak ditemukan." };
  if (role.name === "admin") return { ok: false, message: "Izin role admin tidak bisa diubah (selalu semua izin)." };
  const keys = [...new Set(permissions)].filter((key) => PERMISSION_KEYS.has(key));
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM role_permissions WHERE role_id = ?").run(role.id);
    const link = db.prepare("INSERT INTO role_permissions (role_id, permission_key) VALUES (?, ?)");
    for (const key of keys) link.run(role.id, key);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { ok: true, role: role.name, permissions: keys };
}

export async function deleteRole(roleId) {
  await getDb();
  const role = db.prepare("SELECT id, name, is_system, (SELECT COUNT(*) FROM users u WHERE u.role_id = roles.id) AS n FROM roles WHERE id = ?").get(Number(roleId));
  if (!role) return { ok: false, message: "Role tidak ditemukan." };
  if (role.is_system) return { ok: false, message: "Role bawaan (admin, operator, viewer) tidak bisa dihapus." };
  if (role.n > 0) return { ok: false, message: "Role masih dipakai user. Pindahkan user ke role lain dulu." };
  db.prepare("DELETE FROM roles WHERE id = ?").run(role.id);
  return { ok: true, role: role.name };
}

export async function listAudit({ limit = 200, user = "", action = "" } = {}) {
  await getDb();
  const n = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const where = [];
  const values = [];
  if (user) { where.push("actor = ?"); values.push(normalizeUsername(user)); }
  if (action) { where.push("action = ?"); values.push(String(action)); }
  values.push(n);
  return db.prepare(`SELECT id, at, actor, action, target, ip, detail FROM audit_log ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`).all(...values);
}

export async function closeDb() {
  if (db) db.close();
  db = null;
  dbPromise = null;
}
