// Halaman Kelola User (kelola-user.html): user, role & permission, dan catatan aktivitas.
// Semua data dari server dimasukkan lewat textContent / createElement (tidak pernah innerHTML), supaya isi seperti
// nama pengguna tidak bisa disisipi skrip (XSS). Izin tetap diperiksa di server untuk setiap permintaan.
import { applyPermissions, fetchMe, logout, PERMISSION_LABELS, postJson, ROLE_LABELS } from "./onx-rbac.js";

const $ = (id) => document.getElementById(id);
const state = { me: null, roles: [], permissions: [] };
const formatTime = (ms) => (ms ? new Date(ms).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "-");
const roleLabel = (name) => ROLE_LABELS[name] || name;

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, "");
    else if (value !== false && value !== undefined && value !== null) node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

function say(id, text, kind = "") {
  const msg = $(id);
  msg.textContent = text;
  msg.className = `msg ${kind}`;
}

async function getJson(url) {
  const response = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } });
  if (response.status === 401) {
    location.replace("/index.html?next=%2Fkelola-user.html");
    throw new Error("sesi berakhir");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Gagal (${response.status})`);
  return body;
}

async function send(url, data, msgId) {
  const result = await postJson(url, data);
  if (result.status === 401) {
    location.replace("/index.html?next=%2Fkelola-user.html");
    return null;
  }
  if (!result.ok) {
    say(msgId, result.body?.error || "Gagal menyimpan.", "error");
    return null;
  }
  return result.body;
}

function showSecret(username, password) {
  $("secret-user").textContent = username;
  $("secret-pw").textContent = password;
  $("secret").hidden = false;
  $("secret").scrollIntoView({ behavior: "smooth", block: "center" });
}

// ------------------------------------------------------------------ User
function roleSelect(current, disabled, onChange) {
  const select = el("select", { "aria-label": "Role", disabled: disabled || undefined, onchange: onChange });
  for (const role of state.roles) select.append(el("option", { value: role.name, selected: role.name === current || undefined, text: roleLabel(role.name) }));
  return select;
}

async function loadUsers() {
  const { users } = await getJson("/api/admin/users");
  const body = $("user-rows");
  body.replaceChildren();
  const myId = state.me.user.id;
  for (const user of users) {
    const self = user.id === myId;
    const status = el("div", { class: "chips" });
    status.append(el("span", { class: `chip ${user.active ? "ok" : "off"}`, text: user.active ? "Aktif" : "Nonaktif" }));
    if (user.locked) status.append(el("span", { class: "chip warn", text: "Terkunci" }));
    if (user.mustChangePassword) status.append(el("span", { class: "chip warn", text: "Wajib ganti sandi" }));

    const select = roleSelect(user.role, self, async (event) => {
      const role = event.target.value;
      if (!confirm(`Ubah role ${user.username} menjadi ${roleLabel(role)}?`)) {
        event.target.value = user.role;
        return;
      }
      if (await send("/api/admin/users", { action: "update", id: user.id, role }, "users-msg")) {
        say("users-msg", `Role ${user.username} diubah menjadi ${roleLabel(role)}.`, "ok");
      }
      loadUsers();
    });

    const actions = el("div", { class: "actions" });
    actions.append(el("button", {
      class: "btn small", type: "button", text: "Reset sandi",
      onclick: async () => {
        if (!confirm(`Reset kata sandi ${user.username}? Kata sandi lama langsung tidak berlaku.`)) return;
        const result = await send("/api/admin/users", { action: "reset-password", id: user.id }, "users-msg");
        if (result) {
          showSecret(user.username, result.tempPassword);
          say("users-msg", `Kata sandi ${user.username} di-reset.`, "ok");
          loadUsers();
        }
      },
    }));
    if (user.locked) {
      actions.append(el("button", {
        class: "btn small", type: "button", text: "Buka kunci",
        onclick: async () => {
          if (await send("/api/admin/users", { action: "unlock", id: user.id }, "users-msg")) say("users-msg", `Akun ${user.username} dibuka.`, "ok");
          loadUsers();
        },
      }));
    }
    if (!self) {
      actions.append(el("button", {
        class: `btn small ${user.active ? "danger" : ""}`, type: "button", text: user.active ? "Nonaktifkan" : "Aktifkan",
        onclick: async () => {
          const verb = user.active ? "Nonaktifkan" : "Aktifkan";
          if (!confirm(`${verb} akun ${user.username}?`)) return;
          if (await send("/api/admin/users", { action: "update", id: user.id, active: !user.active }, "users-msg")) say("users-msg", `Akun ${user.username} di${verb.toLowerCase()}.`, "ok");
          loadUsers();
        },
      }));
    }

    body.append(el("tr", {},
      el("td", {}, el("b", { text: user.username }), self ? el("span", { class: "muted", text: " (Anda)" }) : ""),
      el("td", { text: user.displayName || "-" }),
      el("td", {}, select),
      el("td", {}, status),
      el("td", { text: formatTime(user.lastLoginAt) }),
      el("td", {}, actions),
    ));
  }
}

$("add-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = $("add-username").value.trim().toLowerCase();
  if (!username) return say("add-msg", "Isi nama pengguna.", "error");
  const result = await send("/api/admin/users", { action: "create", username, displayName: $("add-name").value, role: $("add-role").value }, "add-msg");
  if (!result) return;
  event.target.reset();
  say("add-msg", `User ${result.user.username} ditambahkan.`, "ok");
  showSecret(result.user.username, result.tempPassword);
  loadUsers();
});

$("secret-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("secret-pw").textContent);
    $("secret-copy").textContent = "Tersalin";
  } catch {
    $("secret-copy").textContent = "Salin manual";
  }
  setTimeout(() => { $("secret-copy").textContent = "Salin"; }, 2000);
});

// ------------------------------------------------------------------ Role & permission
async function loadRoles() {
  const data = await getJson("/api/admin/roles");
  state.roles = data.roles;
  state.permissions = data.permissions;

  const addRole = $("add-role");
  addRole.replaceChildren(...state.roles.map((role) => el("option", { value: role.name, selected: role.name === "viewer" || undefined, text: roleLabel(role.name) })));

  const head = $("matrix-head");
  head.replaceChildren(el("tr", {}, el("th", { text: "Role" }), ...state.permissions.map((p) => el("th", { text: PERMISSION_LABELS[p.key] || p.key, title: p.key })), el("th", { text: "Aksi" })));

  const rows = $("matrix-rows");
  rows.replaceChildren();
  for (const role of state.roles) {
    const boxes = state.permissions.map((p) => el("input", {
      type: "checkbox", value: p.key, "aria-label": `${role.name}: ${p.key}`,
      checked: role.permissions.includes(p.key) || undefined, disabled: role.locked || undefined,
    }));
    const actions = el("div", { class: "actions" });
    if (!role.locked) {
      actions.append(el("button", {
        class: "btn small primary", type: "button", text: "Simpan",
        onclick: async () => {
          const permissions = boxes.filter((box) => box.checked).map((box) => box.value);
          if (await send("/api/admin/roles", { action: "set-permissions", id: role.id, permissions }, "roles-msg")) {
            say("roles-msg", `Izin role ${role.name} disimpan.`, "ok");
            loadRoles();
          }
        },
      }));
    }
    if (!role.isSystem) {
      actions.append(el("button", {
        class: "btn small danger", type: "button", text: "Hapus", disabled: role.userCount > 0 || undefined,
        title: role.userCount > 0 ? "Masih dipakai user" : "Hapus role",
        onclick: async () => {
          if (!confirm(`Hapus role ${role.name}?`)) return;
          if (await send("/api/admin/roles", { action: "delete", id: role.id }, "roles-msg")) say("roles-msg", `Role ${role.name} dihapus.`, "ok");
          loadRoles();
          loadUsers();
        },
      }));
    }
    rows.append(el("tr", {},
      el("td", {}, el("b", { text: roleLabel(role.name) }), el("div", { class: "muted", text: `${role.description || ""} · ${role.userCount} user` })),
      ...boxes.map((box) => el("td", {}, box)),
      el("td", {}, actions),
    ));
  }

  $("perm-rows").replaceChildren(...state.permissions.map((p) => el("tr", {},
    el("td", {}, el("b", { text: PERMISSION_LABELS[p.key] || p.key }), el("div", { class: "muted", text: p.key })),
    el("td", { text: p.description }),
  )));
}

$("role-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = $("role-name").value.trim().toLowerCase();
  if (!name) return say("role-msg", "Isi nama role.", "error");
  if (await send("/api/admin/roles", { action: "create", name, description: $("role-desc").value, permissions: [] }, "role-msg")) {
    event.target.reset();
    say("role-msg", `Role ${name} ditambahkan. Atur izinnya di tabel di atas.`, "ok");
    await loadRoles();
    loadUsers();
  }
});

// ------------------------------------------------------------------ Audit
async function loadAudit() {
  const params = new URLSearchParams({ limit: "300" });
  if ($("audit-user").value.trim()) params.set("user", $("audit-user").value.trim());
  if ($("audit-action").value) params.set("action", $("audit-action").value);
  try {
    const { entries } = await getJson(`/api/admin/audit?${params}`);
    $("audit-rows").replaceChildren(...entries.map((e) => el("tr", {},
      el("td", { text: formatTime(e.at) }), el("td", { text: e.actor || "-" }), el("td", { text: e.action }),
      el("td", { text: e.target || "-" }), el("td", { text: e.ip || "-" }), el("td", { text: e.detail || "" }),
    )));
    say("audit-msg", entries.length ? `${entries.length} kejadian terbaru.` : "Belum ada kejadian.", "");
  } catch (err) {
    say("audit-msg", err.message, "error");
  }
}

$("audit-form").addEventListener("submit", (event) => {
  event.preventDefault();
  loadAudit();
});

// ------------------------------------------------------------------ Tab & awal
function openTab(name) {
  for (const tab of ["users", "roles", "audit"]) {
    $(`t-${tab}`).setAttribute("aria-selected", String(tab === name));
    $(`tab-${tab}`).hidden = tab !== name;
  }
  if (name === "audit") loadAudit();
}
$("t-users").addEventListener("click", () => openTab("users"));
$("t-roles").addEventListener("click", () => openTab("roles"));
$("t-audit").addEventListener("click", () => openTab("audit"));
$("logout").addEventListener("click", () => {
  $("logout").disabled = true;
  logout();
});

async function start() {
  const me = await fetchMe();
  if (!me) {
    location.replace("/index.html?next=%2Fkelola-user.html");
    return;
  }
  if (me.mode !== "rbac" || !me.permissions.includes("user:manage")) {
    location.replace("/index.html#menu");
    return;
  }
  state.me = me;
  applyPermissions(me);
  try {
    await loadRoles();
    await loadUsers();
  } catch (err) {
    say("users-msg", err.message, "error");
  }
}

start();
