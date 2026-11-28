// Halaman Akun Saya (akun.html): profil dan ganti kata sandi. Semua isi dari server dimasukkan lewat textContent.
import { applyPermissions, fetchMe, logout, PERMISSION_LABELS, postJson, ROLE_LABELS } from "./onx-rbac.js";

const $ = (id) => document.getElementById(id);
const formatTime = (ms) => (ms ? new Date(ms).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "-");

function showMessage(text, kind) {
  const msg = $("pw-msg");
  msg.textContent = text;
  msg.className = `msg ${kind || ""}`;
}

async function load() {
  const me = await fetchMe();
  if (!me) {
    location.replace("/index.html?next=%2Fakun.html");
    return;
  }
  applyPermissions(me);
  if (me.mode !== "rbac" || !me.user) {
    $("legacy").hidden = false;
    return;
  }
  const user = me.user;
  const mustChange = user.mustChangePassword || new URLSearchParams(location.search).get("wajib") === "1";
  $("must-change").hidden = !user.mustChangePassword;
  $("to-menu").hidden = Boolean(user.mustChangePassword);
  // Selama wajib ganti kata sandi, tautan ke halaman lain disembunyikan (server juga menolaknya).
  if (user.mustChangePassword) document.querySelectorAll(".topnav [data-perm]").forEach((link) => { link.hidden = true; });
  $("content").hidden = false;
  $("p-username").textContent = user.username;
  $("p-name").textContent = user.displayName || "-";
  $("p-role").textContent = ROLE_LABELS[user.role] || user.role;
  $("p-last").textContent = formatTime(user.lastLoginAt);
  const chips = $("p-perms");
  chips.replaceChildren();
  for (const key of me.permissions) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = PERMISSION_LABELS[key] || key;
    chips.append(chip);
  }
  if (mustChange) $("pw-current").focus();
}

$("pw-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const currentPassword = $("pw-current").value;
  const newPassword = $("pw-new").value;
  const confirm = $("pw-confirm").value;
  if (!currentPassword || !newPassword) return showMessage("Isi semua kolom.", "error");
  if (newPassword !== confirm) return showMessage("Ulangan kata sandi baru tidak sama.", "error");
  $("pw-submit").disabled = true;
  showMessage("Menyimpan...", "");
  let result;
  try {
    result = await postJson("/api/auth/change-password", { currentPassword, newPassword });
  } catch {
    result = { ok: false, body: { error: "Tidak bisa menghubungi server." } };
  }
  $("pw-submit").disabled = false;
  if (!result.ok) {
    if (result.status === 401) {
      location.replace("/index.html?next=%2Fakun.html");
      return;
    }
    return showMessage(result.body?.error || "Gagal menyimpan kata sandi.", "error");
  }
  event.target.reset();
  showMessage("Kata sandi berhasil diganti. Mengarahkan ke menu...", "ok");
  setTimeout(() => location.replace("/index.html#menu"), 1500);
});

$("logout").addEventListener("click", () => {
  $("logout").disabled = true;
  logout();
});

load();
