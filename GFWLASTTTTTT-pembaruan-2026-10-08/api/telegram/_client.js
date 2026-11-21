import fs from "node:fs";
import path from "node:path";

const ENV_FILES = [".env", ".env.local"];
// M-036: batas panjang satu pesan Telegram (sendMessage) adalah 4096 karakter.
const TELEGRAM_MAX_LENGTH = 4096;
// M-037: bila Telegram membalas 429 dengan retry_after paling lama sekian detik, dicoba ulang SEKALI setelah jeda itu.
const MAX_RETRY_AFTER_SECONDS = 5;

// M-035: berkas .env/.env.local cukup dibaca sekali per proses, bukan setiap kali pesan dikirim.
let localEnvLoaded = false;

function loadLocalEnv() {
  if (localEnvLoaded) return;
  localEnvLoaded = true;
  for (const fileName of ENV_FILES) {
    const filePath = path.join(process.cwd(), fileName);
    if (!fs.existsSync(filePath)) continue;
    const text = fs.readFileSync(filePath, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && !(key in process.env)) process.env[key] = value;
    }
  }
}

function firstEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

export function telegramConfig() {
  loadLocalEnv();
  const token = firstEnv([
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_TOKEN",
    "BOT_TOKEN",
    "TG_BOT_TOKEN",
  ]);
  // T-2 (laporan audit, B.8): tujuan chat hanya dibaca dari variabel server. Nama di B.8 PDF adalah
  // TELEGRAM_DEFAULT_CHAT_ID; nama di tabel B.17 PDF (TELEGRAM_CHAT_ID) tetap dibaca sebagai cadangan.
  const chatId = firstEnv([
    "TELEGRAM_DEFAULT_CHAT_ID",
    "TELEGRAM_CHAT_ID",
    "TELEGRAM_CHATID",
    "TG_CHAT_ID",
    "CHAT_ID",
  ]);
  return {
    token,
    chatId,
    missing: [
      token ? "" : "TELEGRAM_BOT_TOKEN",
      chatId ? "" : "TELEGRAM_DEFAULT_CHAT_ID",
    ].filter(Boolean),
  };
}

// Satu kali kirim ke Telegram. R-022: isi respons dibaca sebagai teks dulu; bila bukan JSON (mis. halaman galat HTML
// dari proxy), potongan isinya ikut di pesan galat supaya mudah dilacak.
async function postMessage(config, text) {
  const response = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
    signal: AbortSignal.timeout(10000), // batas waktu 10 detik
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: config.chatId,
      text,
      disable_web_page_preview: true,
    }),
  });
  const raw = await response.text().catch(() => "");
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = null;
  }
  return { response, payload, raw };
}

export async function sendTelegramMessage(text) {
  const config = telegramConfig();
  if (config.missing.length) {
    const readable = config.missing.join(", ");
    throw new Error(`Telegram env belum lengkap: ${readable}`);
  }
  const message = String(text ?? "");
  if (message.length > TELEGRAM_MAX_LENGTH) {
    throw new Error(`Pesan Telegram terlalu panjang: ${message.length} karakter (batas ${TELEGRAM_MAX_LENGTH}).`);
  }

  let { response, payload, raw } = await postMessage(config, message);
  // M-037: 429 = terlalu sering mengirim. Telegram memberi retry_after (detik); jeda pendek dicoba ulang sekali.
  if (response.status === 429) {
    const retryAfter = Number(payload?.parameters?.retry_after);
    if (Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= MAX_RETRY_AFTER_SECONDS) {
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
      ({ response, payload, raw } = await postMessage(config, message));
    }
    if (response.status === 429) {
      const wait = Number(payload?.parameters?.retry_after);
      const error = new Error(`Telegram membatasi pengiriman (HTTP 429)${Number.isFinite(wait) ? `, coba lagi setelah ${wait} detik` : ""}.`);
      error.retryAfter = Number.isFinite(wait) ? wait : null;
      throw error;
    }
  }

  if (payload === null) {
    throw new Error(`Telegram sendMessage failed: HTTP ${response.status}, isi respons bukan JSON: ${raw.slice(0, 120)}`);
  }
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.description || `Telegram sendMessage failed: HTTP ${response.status}`);
  }
  return payload.result;
}
