"""N-1: salin angka scaler dan kalibrator dari FINAL_4_PIPELINE_MODELS.h5 ke file JSON biasa.

Di dalam file H5 ada 24 berkas joblib: 20 RobustScaler (satu per model) dan 4 kalibrator Platt (LogisticRegression).
joblib membukanya lewat pickle, yang bisa ikut menjalankan kode saat dibuka (peringatan dokumentasi scikit-learn,
"Model persistence: security & maintainability limitations"), masalah sejenis temuan audit K-2. Skrip ini membuka
ke-24 berkas itu SEKALI, menyalin angkanya ke <nama H5>.preprocessing.json, dan mencatat sidik jari SHA-256 tiap
berkas. Setelah itu run-final-h5-yolo-fusion.py (dan server/h5-worker.py) membaca JSON tersebut tanpa joblib.

File H5 tidak diubah, model tidak dilatih. Jalankan ulang skrip ini hanya bila menerima file H5 baru dari pembuat
model; run-final akan menolak JSON yang sidik jarinya tidak cocok dengan H5.

M-088: karena joblib/pickle bisa menjalankan kode, file H5 baru dibuka bila SHA-256 file H5 itu sama dengan nilai yang
diberikan lewat --expected-sha256 (nilai dari pembuat model / catatan tim, BUKAN dihitung dari file yang sama saat itu).
Tanpa --expected-sha256, skrip hanya menampilkan SHA-256 file lalu berhenti tanpa membuka isinya.
M-089: hasil ekspor diperiksa harus tepat 20 RobustScaler + 4 kalibrator Platt; bila tidak, JSON tidak ditulis.

Pakai: python scripts/export-h5-preprocessing.py [--h5 FINAL_4_PIPELINE_MODELS.h5] --expected-sha256 <64 huruf hex>
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import io
import json
from pathlib import Path

import h5py
import joblib
import numpy as np
import sklearn
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import RobustScaler

ROOT = Path(__file__).resolve().parents[1]
JSON_SUFFIX = ".preprocessing.json"
# M-089: isi yang diharapkan di FINAL_4_PIPELINE_MODELS.h5 (lihat docstring di atas).
EXPECTED_COUNTS = {"RobustScaler": 20, "PlattLogisticRegression": 4}


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(16 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def preprocessing_path(h5_path: Path) -> Path:
    return h5_path.with_name(h5_path.stem + JSON_SUFFIX)


def numbers(array: np.ndarray) -> list:
    # R-056: .tolist() mengubah float32 dan float64 menjadi float Python (float64), lalu JSON menyimpannya dengan repr
    # (17 digit) yang terbaca kembali sebagai float64 yang sama persis. Untuk array float32, nilai yang tersimpan adalah
    # float64 dari nilai float32 itu (konversinya tepat), jadi bit float32 aslinya baru didapat kembali setelah pembaca
    # mengonversinya ke dtype yang dicatat di kolom *_dtype, misalnya np.asarray(center, dtype=center_dtype).
    return np.asarray(array).tolist()


def export_scaler(obj: object) -> dict:
    if type(obj) is not RobustScaler:
        raise TypeError(f"diharapkan RobustScaler, ditemukan {type(obj).__name__}")
    if getattr(obj, "unit_variance", False):
        raise ValueError("unit_variance=True belum didukung")
    return {
        "kind": "RobustScaler",
        "with_centering": bool(obj.with_centering),
        "with_scaling": bool(obj.with_scaling),
        "n_features_in": int(obj.n_features_in_),
        "center": numbers(obj.center_) if obj.with_centering else None,
        "center_dtype": str(obj.center_.dtype) if obj.with_centering else None,
        "scale": numbers(obj.scale_) if obj.with_scaling else None,
        "scale_dtype": str(obj.scale_.dtype) if obj.with_scaling else None,
    }


def export_calibrator(obj: object) -> dict:
    if not isinstance(obj, dict) or type(obj.get("estimator")) is not LogisticRegression:
        raise TypeError("diharapkan dict dengan estimator LogisticRegression")
    est = obj["estimator"]
    if len(est.classes_) != 2 or est.coef_.shape != (1, int(est.n_features_in_)):
        raise ValueError("hanya kalibrator Platt dua kelas yang didukung")
    metadata = {k: v for k, v in obj.items() if k != "estimator"}
    json.dumps(metadata)  # pastikan isinya hanya teks/angka/boolean
    return {
        "kind": "PlattLogisticRegression",
        "n_features_in": int(est.n_features_in_),
        "classes": numbers(est.classes_),
        "coef": numbers(est.coef_),
        "coef_dtype": str(est.coef_.dtype),
        "intercept": numbers(est.intercept_),
        "intercept_dtype": str(est.intercept_.dtype),
        "metadata": metadata,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--h5", type=Path, default=ROOT / "FINAL_4_PIPELINE_MODELS.h5")
    parser.add_argument("--expected-sha256", help="SHA-256 file H5 yang diketahui benar (64 huruf hex)")
    args = parser.parse_args()
    h5_path = args.h5.resolve()

    # M-088: sidik jari file H5 diperiksa SEBELUM satu pun berkas joblib dibuka.
    actual = file_sha256(h5_path)
    expected = (args.expected_sha256 or "").strip().lower()
    if not expected:
        raise SystemExit(f"[N-1] SHA-256 {h5_path.name}: {actual}\n"
                         "Isi file belum dibuka. Cocokkan nilai di atas dengan nilai dari pembuat model / catatan tim, "
                         "lalu jalankan lagi dengan --expected-sha256 <nilai itu>.")
    if actual != expected:
        raise SystemExit(f"[N-1] DITOLAK: SHA-256 {h5_path.name} = {actual}, tidak sama dengan --expected-sha256 {expected}. "
                         "File H5 tidak dibuka.")

    entries: dict[str, dict] = {}
    with h5py.File(h5_path, "r") as h5:
        names: list[str] = []
        h5.visit(lambda name: names.append(name) if name.endswith(".joblib") else None)
        for name in sorted(names):
            raw = bytes(h5[name][()])
            obj = joblib.load(io.BytesIO(raw))  # satu-satunya pembukaan joblib, sekali saja
            entry = export_calibrator(obj) if name.endswith("_platt.joblib") else export_scaler(obj)
            entry["sha256"] = hashlib.sha256(raw).hexdigest()
            entries[name] = entry

    # M-089: jumlah dan jenis isi diperiksa sebelum JSON ditulis, supaya file H5 yang terpotong tertangkap di sini.
    kinds: dict[str, int] = {}
    for entry in entries.values():
        kinds[entry["kind"]] = kinds.get(entry["kind"], 0) + 1
    if kinds != EXPECTED_COUNTS:
        raise SystemExit(f"[N-1] DITOLAK: diharapkan {EXPECTED_COUNTS} ({sum(EXPECTED_COUNTS.values())} berkas), "
                         f"ditemukan {kinds} ({len(entries)} berkas). File H5 mungkin terpotong; JSON tidak ditulis.")

    out = preprocessing_path(h5_path)
    payload = {
        "format": "ocean-nexus-h5-preprocessing/1",
        "source_h5": h5_path.name,
        "source_h5_sha256": actual,
        "exported_utc": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "sklearn_version": sklearn.__version__,
        "note": "Disalin dari berkas joblib di dalam file H5 oleh scripts/export-h5-preprocessing.py (temuan N-1). File H5 tidak diubah.",
        "entries": entries,
    }
    out.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    print(f"[N-1] {len(entries)} berkas joblib disalin ke {out.name}: {kinds}")


if __name__ == "__main__":
    main()
