import { sendProblem } from "../_problem.js";
// Untuk versi online di Vercel (tanpa server relay): memberi API key AISStream ke browser supaya
// dashboard bisa tersambung langsung ke AISStream. Pada mode ini key memang terlihat publik.
// Di server sendiri (npm run dev / npm run start) relay AIS yang dipakai, jadi endpoint ini menolak.
export default function handler(req, res) {
  // R-013: endpoint ini hanya untuk membaca, jadi metode selain GET ditolak 405.
  if ((req.method || "GET") !== "GET") {
    res.setHeader("Allow", "GET");
    return sendProblem(res, 405, "Gunakan GET.");
  }
  const key = String(process.env.AISSTREAM_API_KEY || "").trim().replace(/^["']|["']$/g, "");
  if (!process.env.VERCEL || !key) return sendProblem(res, 404, "AIS direct mode not available");
  res.setHeader("cache-control", "no-store");
  res.json({ key });
}
