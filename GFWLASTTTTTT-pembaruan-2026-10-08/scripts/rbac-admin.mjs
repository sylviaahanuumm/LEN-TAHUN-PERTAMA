// Alat baris perintah RBAC untuk pengelola server (dijalankan di server, dari folder proyek).
//   node scripts/rbac-admin.mjs daftar                    daftar semua user
//   node scripts/rbac-admin.mjs buat-admin <nama>         buat admin baru, kata sandi sementara ditampilkan sekali
//   node scripts/rbac-admin.mjs reset <nama>              reset kata sandi (sementara) + buka kunci + aktifkan
//   node scripts/rbac-admin.mjs buka-kunci <nama>         buka akun yang terkunci karena salah kata sandi
// Dipakai bila belum ada admin sama sekali, atau semua admin lupa kata sandi / terkunci.
// Database yang dipakai sama dengan server: RBAC_DB di .env.local (default .local-dev/rbac.sqlite).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
for (const fileName of [".env", ".env.local"]) {
  const file = path.join(ROOT, fileName);
  if (!fs.existsSync(file)) continue;
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

const rbac = await import("../api/_rbac.js");
const [command, nameArg] = process.argv.slice(2);
const actor = `cli:${process.env.USER || process.env.USERNAME || "server"}`;

function usage() {
  console.log(`Pemakaian:
  node scripts/rbac-admin.mjs daftar
  node scripts/rbac-admin.mjs buat-admin <nama-pengguna>
  node scripts/rbac-admin.mjs reset <nama-pengguna>
  node scripts/rbac-admin.mjs buka-kunci <nama-pengguna>`);
}

async function needUser() {
  if (!nameArg) {
    usage();
    process.exit(1);
  }
  const user = await rbac.findUserByUsername(nameArg);
  if (!user) {
    console.error(`User "${rbac.normalizeUsername(nameArg)}" tidak ditemukan.`);
    process.exit(1);
  }
  return user;
}

console.log(`Database RBAC: ${rbac.rbacDbFile()}`);
await rbac.getDb();

if (command === "daftar") {
  const users = await rbac.listUsers();
  if (!users.length) console.log("Belum ada user.");
  for (const u of users) {
    const flags = [u.active ? "aktif" : "NONAKTIF", u.locked ? "TERKUNCI" : "", u.mustChangePassword ? "wajib-ganti-sandi" : ""].filter(Boolean).join(", ");
    console.log(`- ${u.username.padEnd(24)} ${u.role.padEnd(10)} ${flags}`);
  }
} else if (command === "buat-admin") {
  const result = await rbac.createUser({ username: nameArg, displayName: "Administrator", roleName: "admin" });
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  rbac.audit({ actor, action: "user_dibuat", target: result.user.username, detail: "admin dibuat lewat CLI" });
  console.log(`Admin "${result.user.username}" dibuat.`);
  console.log(`Kata sandi sementara (catat sekarang, hanya tampil sekali): ${result.tempPassword}`);
  console.log("Login di halaman depan, lalu wajib ganti kata sandi.");
} else if (command === "reset") {
  const user = await needUser();
  const temp = await rbac.resetPassword(user.id);
  await rbac.updateUser(user.id, { active: true });
  rbac.audit({ actor, action: "sandi_direset", target: user.username, detail: "lewat CLI; akun dibuka dan diaktifkan" });
  console.log(`Kata sandi "${user.username}" di-reset. Kata sandi sementara (hanya tampil sekali): ${temp}`);
} else if (command === "buka-kunci") {
  const user = await needUser();
  await rbac.unlockUser(user.id);
  rbac.audit({ actor, action: "akun_dibuka", target: user.username, detail: "lewat CLI" });
  console.log(`Akun "${user.username}" dibuka.`);
} else {
  usage();
  process.exitCode = command ? 1 : 0;
}
await rbac.closeDb();
