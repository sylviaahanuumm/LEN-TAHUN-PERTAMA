// Bantuan tampilan RBAC untuk halaman Ocean Nexus.
// PENTING: berkas ini hanya mengatur TAMPILAN (menyembunyikan tombol yang tidak boleh dipakai role Anda). Pengaman
// yang sebenarnya ada di server (api/_rbac.js): halaman, data, dan API tetap ditolak bila role tidak punya izinnya.
//
// Atribut yang dikenali:
//   data-perm="dashboard:view"   elemen disembunyikan bila user tidak punya izin itu
//   data-rbac-only               elemen hanya tampil bila mode RBAC aktif dan user sudah login
//   data-rbac-name               diisi nama pengguna;  data-rbac-role  diisi nama role
//   data-rbac-logout             tombol keluar (logout)

export const PERMISSION_LABELS = {
  "dashboard:view": "Dashboard peta",
  "anomaly:view": "Anomaly Alert",
  "report:view": "Data Reports",
  "alert:send": "Kirim alert Telegram",
  "user:manage": "Kelola user & role",
  "audit:view": "Catatan aktivitas",
};

export const ROLE_LABELS = { admin: "Admin", operator: "Operator", viewer: "Viewer" };

export async function fetchMe() {
  try {
    const response = await fetch("/api/auth/me", { credentials: "same-origin", headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function postJson(url, data) {
  const response = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(data),
  });
  let body = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  return { ok: response.ok, status: response.status, body };
}

export async function logout() {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  } catch {
    /* tetap pindah ke halaman login */
  }
  try {
    sessionStorage.removeItem("onx-login");
  } catch {
    /* penyimpanan diblokir: abaikan */
  }
  location.replace("/index.html?keluar=1");
}

export function applyPermissions(me, root = document) {
  const permissions = new Set(me?.permissions || []);
  const rbac = me?.mode === "rbac" && me.user;
  root.querySelectorAll("[data-perm]").forEach((el) => {
    const needed = el.dataset.perm.split(/\s+/).filter(Boolean);
    el.hidden = Boolean(me) && !needed.every((p) => permissions.has(p));
  });
  root.querySelectorAll("[data-rbac-only]").forEach((el) => {
    el.hidden = !rbac;
  });
  if (rbac) {
    root.querySelectorAll("[data-rbac-name]").forEach((el) => {
      el.textContent = me.user.displayName || me.user.username;
    });
    root.querySelectorAll("[data-rbac-role]").forEach((el) => {
      el.textContent = ROLE_LABELS[me.user.role] || me.user.role;
    });
  }
}

function bindLogout(root = document) {
  root.querySelectorAll("[data-rbac-logout]").forEach((button) => {
    if (button.dataset.bound) return;
    button.dataset.bound = "1";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      button.disabled = true;
      logout();
    });
  });
}

// Untuk halaman depan (index.html): diperbarui saat halaman dibuka dan setelah login berhasil (event "onx:login").
async function refresh() {
  const me = await fetchMe();
  if (me?.mode === "rbac" && me.user?.mustChangePassword) {
    location.replace("/akun.html?wajib=1");
    return;
  }
  applyPermissions(me);
}

if (document.documentElement.dataset.rbacAuto !== "off") {
  bindLogout();
  refresh();
  window.addEventListener("onx:login", refresh);
}
