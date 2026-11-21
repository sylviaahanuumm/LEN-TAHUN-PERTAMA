import { sendProblem } from "../_problem.js";
import { applyRateLimit } from "../_rate-limit.js";
import { sendTelegramMessage, telegramConfig } from "./_client.js";

function clean(value, fallback = "-") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

// M-038: kontrak skor dibuat tetap, tidak lagi ditebak dari besarnya angka. "score" berupa angka PECAHAN 0–1
// (mis. 0.87 → 87%); bila ingin mengirim teks bebas (mis. "87%"), pakai "scoreText". Angka di luar 0–1 ditolak
// oleh validateAlertBody (R-026), jadi 1.5 tidak lagi diam-diam menjadi "2%".
function formatScore(body = {}) {
  const scoreText = clean(body.scoreText ?? body.score_text, "");
  if (scoreText) return scoreText;
  const raw = body.score;
  if (raw === null || raw === undefined || raw === "") return "-";
  return `${Math.round(Number(raw) * 100)}%`;
}

const TEXT_FIELDS = ["alertType", "alert_type", "type", "mmsi", "MMSI", "vesselName", "name", "Name", "scoreText", "score_text",
  "time", "timestamp", "scene_time_utc", "model_indication_text", "model_indication", "ai_gear_label", "gear_label", "yolo_class",
  "godark_label", "ai_godark_label", "spoofing_label", "ai_spoofing_label", "transshipment_label", "ai_transshipment_label"];

function isEmpty(value) {
  return value === null || value === undefined || value === "";
}

// R-026: isi permintaan diperiksa sebelum dijadikan teks pesan. Kolom teks harus teks/angka (bukan objek), skor 0–1,
// lintang -90..90, bujur -180..180, dan waktu harus bisa dibaca. Mengembalikan pesan galat, atau null bila valid.
function validateAlertBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Isi permintaan harus objek JSON.";
  for (const key of TEXT_FIELDS) {
    const value = body[key];
    if (!isEmpty(value) && typeof value !== "string" && typeof value !== "number") return `Kolom ${key} harus berupa teks atau angka.`;
  }
  if (!isEmpty(body.score)) {
    const n = Number(body.score);
    if (typeof body.score === "object" || !Number.isFinite(n) || n < 0 || n > 1) return "Kolom score harus angka 0–1 (gunakan scoreText untuk teks bebas seperti \"87%\").";
  }
  const coords = [["lat", body.lat ?? body.latitude ?? body.Center_latitude, 90], ["lon", body.lon ?? body.longitude ?? body.Center_longitude, 180]];
  for (const [name, value, max] of coords) {
    if (isEmpty(value)) continue;
    const n = Number(value);
    if (typeof value === "object" || !Number.isFinite(n) || Math.abs(n) > max) return `Kolom ${name} harus angka -${max} sampai ${max}.`;
  }
  const time = body.time ?? body.timestamp ?? body.scene_time_utc;
  if (!isEmpty(time) && Number.isNaN(new Date(String(time).replace(" ", "T")).getTime())) return "Kolom time tidak bisa dibaca sebagai tanggal.";
  return null;
}

function formatAlertTime(value) {
  const raw = clean(value, new Date().toISOString());
  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (isoMatch) {
    const [, year, month, day, hour, minute, second = "00"] = isoMatch;
    return `${Number(day)}/${Number(month)}/${year}, ${hour.padStart(2, "0")}:${minute}:${second.padStart(2, "0")}`;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getDate()}/${date.getMonth() + 1}/${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function hasModelValue(value) {
  const text = String(value ?? "").trim();
  if (!text) return false;
  return text.toLowerCase() !== "not_available";
}

// M-039: memeriksa kolom yang SAMA dengan buildModelIndication, termasuk kolom cadangan tanpa awalan "ai_".
function hasValidAiEvidence(body = {}) {
  return [
    body.ai_gear_label ?? body.gear_label,
    body.ai_godark_probability ?? body.godark_probability,
    body.ai_spoofing_probability ?? body.spoofing_probability,
    body.ai_transshipment_probability ?? body.transshipment_probability,
    body.yolo_class,
  ].some(hasModelValue);
}

function prettyGearLabel(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.replace(/_/g, " ").replace(/\s+/g, " ");
}

function numberOrNaN(value) {
  if (value === null || value === undefined || value === "") return NaN;
  const number = Number(value);
  return Number.isFinite(number) ? number : NaN;
}

function isModelLabel(value, expected) {
  return String(value ?? "").trim().toLowerCase() === expected;
}

function joinReadable(items) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} dan ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, dan ${items[items.length - 1]}`;
}

// R-023, R-025: satu konstanta untuk teks "belum dapat diverifikasi" (dulu fungsi dengan parameter tak terpakai
// ditambah salinan cadangan yang tidak pernah terpakai).
const UNAVAILABLE_INDICATION = "Model AI belum dapat memverifikasi kandidat ini karena data trajectory AIS belum mencukupi.";

function buildModelIndication(body = {}) {
  const explicit = String(body.model_indication_text ?? body.model_indication ?? "").trim();
  if (hasModelValue(explicit)) return explicit;

  const h5Items = [];
  const gearLabel = prettyGearLabel(body.ai_gear_label ?? body.gear_label);
  const yoloClass = String(body.yolo_class ?? "").trim();

  // R-024: "??" (bukan "||"), supaya probabilitas 0 tetap dianggap ada dan tidak beralih ke kolom cadangan.
  if (hasModelValue(body.ai_godark_probability ?? body.godark_probability) && isModelLabel(body.godark_label ?? body.ai_godark_label, "go_dark")) {
    h5Items.push({
      clause: "trajectory AIS menyerupai aktivitas go dark",
      sentence: "Pola trajectory AIS menyerupai aktivitas go dark.",
    });
  }
  if (hasModelValue(body.ai_spoofing_probability ?? body.spoofing_probability) && isModelLabel(body.spoofing_label ?? body.ai_spoofing_label, "spoofing")) {
    h5Items.push({
      clause: "trajectory AIS menyerupai aktivitas spoofing",
      sentence: "Pola trajectory AIS menyerupai aktivitas spoofing.",
    });
  }
  if (hasModelValue(body.ai_transshipment_probability ?? body.transshipment_probability) && isModelLabel(body.transshipment_label ?? body.ai_transshipment_label, "potential_transshipment")) {
    h5Items.push({
      clause: "pergerakan pasangan kapal menyerupai aktivitas transshipment",
      sentence: "Pola pergerakan pasangan kapal menyerupai aktivitas transshipment.",
    });
  }
  if (hasModelValue(gearLabel)) {
    h5Items.push({
      clause: `trajectory AIS menyerupai karakteristik alat tangkap ${gearLabel}`,
      sentence: `Pola trajectory AIS menyerupai karakteristik alat tangkap ${gearLabel}.`,
    });
  }

  const sentences = [];
  if (h5Items.length === 1) {
    sentences.push(h5Items[0].sentence);
  } else if (h5Items.length > 1) {
    sentences.push(`Model H5 mengindikasikan ${joinReadable(h5Items.map((item) => item.clause))}.`);
  }
  if (hasModelValue(yoloClass)) {
    sentences.push(`Deteksi SAR mengindikasikan kapal kelas ${yoloClass}.`);
  }
  if (!sentences.length && hasValidAiEvidence(body)) {
    sentences.push("Hasil model AI tersedia, tetapi belum menunjukkan indikasi aktivitas anomali pada kandidat ini.");
  }

  if (!sentences.length) return UNAVAILABLE_INDICATION;
  return sentences.join(" ");
}

function formatAlert(body = {}) {
  const alertType = clean(body.alertType || body.alert_type || body.type, "ALERT");
  const mmsi = clean(body.mmsi || body.MMSI);
  const vesselName = clean(body.vesselName || body.name || body.Name, "Unknown vessel");
  const score = formatScore(body);
  const lat = clean(body.lat ?? body.latitude ?? body.Center_latitude);
  const lon = clean(body.lon ?? body.longitude ?? body.Center_longitude);
  const time = formatAlertTime(body.time ?? body.timestamp ?? body.scene_time_utc);
  const modelIndication = buildModelIndication(body);
  const modelLines = hasValidAiEvidence(body)
    ? [``, `INDIKASI MODEL`, modelIndication]
    : [``, modelIndication];

  return [
    `ALERT ${alertType}`,
    `MMSI: ${mmsi}`,
    `Nama kapal: ${vesselName}`,
    `Score: ${score}`,
    `Koordinat: ${lat}, ${lon}`,
    `Waktu: ${time}`,
    ...modelLines,
  ].join("\n");
}

export default async function handler(req, res) {
  // T-17: metode diperiksa dulu, supaya request selain POST tidak menghabiskan kuota rate limit.
  if ((req.method || "GET") !== "POST") {
    return sendProblem(res, 405, "Method not allowed. Use POST.");
  }

  const allowed = await applyRateLimit(req, res, {
    name: "telegram-alert",
    limit: 30,
    windowSeconds: 10 * 60,
  });
  if (!allowed) return;

  const body = req.body || {};
  const invalid = validateAlertBody(body);
  if (invalid) return sendProblem(res, 400, invalid, { ok: false });

  const config = telegramConfig();
  if (config.missing.length) {
    return sendProblem(res, 500, "Telegram env belum lengkap", {
      ok: false,
      missing: config.missing,
      expected: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_DEFAULT_CHAT_ID"],
    });
  }

  try {
    const result = await sendTelegramMessage(formatAlert(body));
    return res.json({
      ok: true,
      message: "Alert Telegram berhasil dikirim.",
      telegram_message_id: result?.message_id,
    });
  } catch (err) {
    // Detail galat hanya dicatat di log server, supaya isi galat (alamat, keterangan Telegram) tidak sampai ke browser.
    console.error("[telegram-alert] Internal error:", err); // Log lengkap hanya di server
    return sendProblem(res, 502, "Gagal menghubungi layanan Telegram. Silakan periksa koneksi atau konfigurasi server.", { ok: false });
  }
}
