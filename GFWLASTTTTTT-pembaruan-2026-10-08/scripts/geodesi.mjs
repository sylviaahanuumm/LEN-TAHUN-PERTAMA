// C.1 (laporan audit, Bagian C): perhitungan posisi kapal memakai pustaka geospasial terstandar Turf.js
// (permukaan bola bumi, jari-jari 6.371.008,8 m), bukan bidang datar. Dipakai skrip Kalman, pengisian posisi AIS,
// dan pembuat lintasan. Turf.js tidak mengembalikan bujur ke rentang −180°..180°, jadi hasilnya dirapikan dengan
// langkah normalisasi bujur K-3 (laporan audit, B.3).
import { point } from "@turf/helpers";
import { distance } from "@turf/distance";
import { bearing } from "@turf/bearing";
import { destination } from "@turf/destination";

const toRad = (deg) => (deg * Math.PI) / 180;
const toDeg = (rad) => (rad * 180) / Math.PI;


function assertCoords(lat, lon, label) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new RangeError(`Koordinat tidak valid (${label}): lat=${lat}, lon=${lon}`);
  }
}

// K-3: langkah normalisasi bujur dari fungsi interpolateLongitude di PDF (tanpa pembulatan).
export function wrapLon(lon) {
  if (lon >= -180 && lon <= 180) return lon;
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 && lon > 0 ? 180 : wrapped;
}

// K-3: selisih bujur toLon − fromLon dijaga di antara −180° dan 180°.
export function lonDelta(fromLon, toLon) {
  return wrapLon(toLon - fromLon);
}

// Proyeksi azimut berjarak sama (azimuthal equidistant) di sekitar titik acuan: jarak dan arah dari titik acuan
// dihitung di permukaan bola dengan Turf.js, lalu diubah ke sumbu x (timur) dan y (utara) dalam meter.
// Filter Kalman bekerja di sumbu meter ini.
export function projectToMeters(lat, lon, refLat, refLon) {
  assertCoords(lat, lon, "titik");
  assertCoords(refLat, refLon, "acuan");
  const from = point([refLon, refLat]);
  const to = point([lon, lat]);
  const d = distance(from, to, { units: "meters" });
  if (d < 1e-6) return { x: 0, y: 0 };
  const b = toRad(bearing(from, to));
  return { x: d * Math.sin(b), y: d * Math.cos(b) };
}

// Kebalikan projectToMeters: dari sumbu meter kembali ke lintang/bujur memakai Turf.js destination.
export function unprojectFromMeters(x, y, refLat, refLon) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError(`Meter tidak valid: x=${x}, y=${y}`);
  assertCoords(refLat, refLon, "acuan");
  const d = Math.hypot(x, y);
  if (d === 0) return { lat: refLat, lon: wrapLon(refLon) };
  const [lon, lat] = destination(point([refLon, refLat]), d, toDeg(Math.atan2(x, y)), { units: "meters" }).geometry.coordinates;
  return { lat, lon: wrapLon(lon) };
}

// Titik pada jalur terpendek di permukaan bumi (great circle) antara dua posisi, pada bagian factor (0..1) dari jaraknya.
// Bujur hasilnya dinormalisasi dan dibulatkan 6 angka di belakang koma seperti fungsi interpolateLongitude di PDF (K-3).
export function interpolatePositionExact(lat1, lon1, lat2, lon2, factor) {
  assertCoords(lat1, lon1, "awal");
  assertCoords(lat2, lon2, "akhir");
  if (!Number.isFinite(factor)) throw new RangeError(`factor tidak valid: ${factor}`);
  const from = point([lon1, lat1]);
  const to = point([lon2, lat2]);
  const d = distance(from, to, { units: "meters" });
  if (d < 1e-6) return { lat: lat1, lon: wrapLon(lon1) };
  const [lon, lat] = destination(from, d * factor, bearing(from, to), { units: "meters" }).geometry.coordinates;
  return { lat, lon: wrapLon(lon) };
}

export function interpolatePosition(lat1, lon1, lat2, lon2, factor) {
  const p = interpolatePositionExact(lat1, lon1, lat2, lon2, factor);
  return { lat: p.lat, lon: Number(p.lon.toFixed(6)) };
}