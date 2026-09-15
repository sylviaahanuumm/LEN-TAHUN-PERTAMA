# LEN-TAHUN-PERTAMA

# Roadmap Proyek: Sistem Deteksi Anomali Kapal Berbasis AIS/GFW & Citra SAR ("Samudra Aya")

Dokumen ini merangkum hasil analisis mendalam terhadap **4 repository** yang menjadi fondasi riset dan pengembangan sistem pemantauan aktivitas kapal (illegal fishing / anomali AIS) berbasis data **AIS**, **Global Fishing Watch (GFW)**, dan **citra SAR Sentinel-1**. Roadmap ini disusun berdasarkan bukti nyata di dalam kode, README, dokumentasi, dan struktur masing-masing repo — bukan asumsi.

| # | Repository | Peran dalam Ekosistem | Status |
|---|---|---|---|
| 1 | [`Aqilla's Code`](https://github.com/dhyaaqilla15-phy/TAcodingGFWanomaly) | **Inti riset.** pipeline deteksi anomali AIS/GFW (gear, spoofing, go-dark, transshipment) | 🟢 Paling matang & aktif |
| 2 | [`Helena's Code`](https://github.com/helenadityaa/SAR_YOLOv12) | Deteksi objek kapal dari citra SAR (Sentinel-1) memakai YOLOv12 | 🟢 Eksperimen selesai, model final terpilih |
| 3 | [`Fifi's Code`](https://github.com/fififtrh28-source/GFWLASTTTTTT) | **Produk akhir.** web dashboard "Samudra Aya" (React + Vite + Leaflet) yang mengonsumsi GFW API, AIS live stream, dan model inference | 🟢 Tahap integrasi & deployment |
| 4 | [`Lingga's Code`](https://github.com/ngenss12/Len/tree/push-new-only-clean/new) | Dua sub-riset: (a) LSTM klasifikasi gear dari trajectory AIS akademik, (b) Klasifikasi citra SAR (ResNet50/VGG19) + optimasi TensorRT | 🟡 Riset paralel/eksperimental |


---

## 1. Analisis Mendalam Tiap Repository

### 1.1 `Aqilla's Code` — Inti Riset
Repo ini adalah **jantung dari proyek**: sebuah CLI pipeline (`main.py`) yang menjalankan 4 sub-sistem deteksi anomali kapal dari data AIS/GFW, semuanya berbasis **BiLSTM + self-attention**:

1. **Gear Classification** — mengklasifikasikan jenis alat tangkap (`drifting_longlines`, `fixed_gear`, `purse_seines`, `trawlers`) dari trajectory AIS.
2. **Spoofing Detection** — mendeteksi manipulasi posisi AIS (dengan simulasi serangan `gradual_drift`, `location_jump`, dll).
3. **Go-Dark Detection** — mendeteksi kapal yang mematikan transponder AIS ("suspected AIS transmission gap"), merujuk metodologi Welch et al. (2022).
4. **Transshipment Candidate Detection** — mendeteksi kandidat *encounter* (pertemuan 2 kapal) dan *loitering* (kapal diam lama di laut) yang mengindikasikan alih muatan di tengah laut.

**Temuan penting:**
- Protokol eksperimen sangat ketat: split train/val berbasis MMSI (vessel-level, tidak bocor), *external test* dikunci terpisah (`Dataset_Test_Enriched`), kalibrasi Platt, multiseed tuning, dan audit protokol otomatis (`external_protocol_audit.json`).
- Ada aturan eksplisit di `AGENTS.md`: proses training **tidak boleh dijalankan otomatis oleh AI/agent**, harus dijalankan manual oleh pengguna — menandakan proyek ini sudah pada tahap eksperimen serius dengan kontrol kualitas ketat.
- Output akhir setiap pipeline: confusion matrix, `eval_summary.json`, `per_vessel_predictions.csv` — dirancang agar langsung dapat dipakai sebagai bab hasil skripsi.
- Terdapat file `newcodinggfw.h5` (disebut di repo lain) yang merupakan model gabungan (gear + spoofing + go-dark) hasil ekspor dari pipeline ini, yang kemudian dipakai untuk **inference real-time** di aplikasi web.

### 1.2 `Helena's Code` — Deteksi Kapal dari Citra Satelit SAR
Repo ini melengkapi keterbatasan AIS (yang bisa dimatikan/dipalsukan) dengan **deteksi visual berbasis citra radar Sentinel-1 (SAR)**, menggunakan dataset **OpenSARShip** yang telah diperkaya dengan metadata AIS/GFW.

**Temuan penting:**
- Objek dideteksi: 3 kelas (`Fishing`, `Cargo`, `Passenger`) memakai **YOLOv12** (varian n/s/m/l/x).
- Input citra: gabungan polarisasi ganda SAR (VV, VH) yang dipetakan ke channel RGB (`R=VV, G=VH, B=mean(VV,VH)`).
- **Model final terpilih**: YOLOv12n, split 80:10:10, epoch 50, batch 16 → **Validation mAP50 79.12%**, F1 71.56%; performa test eksternal (47 gambar) mAP50 ≈ 75–79%.
- Eksperimen sangat tertata: rekap Excel/CSV lengkap untuk semua kombinasi split (70/15/15 dan 80/10/10) dan semua varian model, dengan folder arsip untuk run non-final.

### 1.3 `Fifi's Code` ("Samudra Aya") — Dashboard & Integrasi Produk
Ini adalah **wajah akhir dari seluruh riset**: aplikasi web full-stack (React + TypeScript + Vite, hosting Vercel) bernama **Samudra Aya** yang menyatukan semua model di atas menjadi satu dashboard peta interaktif.

**Arsitektur (dari `docs/pipeline-web.md` & `docs/pipeline-inference.md`):**
```
Browser (Leaflet Map, tab GFW / AIS / AI)
   │
   ├── Mode GFW  → Vercel serverless (api/gfw/events.js) → GFW API v3 (cache Redis/Upstash)
   ├── Mode AIS  → WebSocket langsung ke AISStream.io (live position)
   └── Mode AI   → FastAPI (Hugging Face Space: ngenss12-inferencegfw.hf.space)
                     → GFW API (ambil track vessel)
                     → Model LSTM BiLSTM+Attention (newcodinggfw.h5)
                     → Prediksi: gear / spoofing / go-dark per kapal
                     → Render marker + alert ⚠ di peta
```
**Temuan penting:**
- Model inference yang dipakai (`newcodinggfw.h5`) adalah **hasil ekspor dari riset di `Fifi's Code`** — arsitektur BiLSTM 2-layer + attention pooling + cosine classifier persis konsisten dengan pendekatan repo #1.
- Fitur turunan trajectory yang dihitung di frontend/backend (25 kolom: kecepatan, akselerasi, turning rate, bearing error, curvature, dll) sangat mirip feature engineering yang dipakai di pipeline gear/spoofing/go-dark repo #1 — menunjukkan alur kerja yang konsisten dari riset ke produksi.
- Terdapat berkas laporan skripsi (`Lampiran_Listing_Program_A-F.md`, `..._Siap_Tempel.docx`) di root repo — mengonfirmasi bahwa repo ini juga menjadi **lampiran source code skripsi**.

### 1.4 `Lingga's Code` — Riset Paralel/Eksperimental
Branch ini berisi **dua eksperimen berbeda** yang tampaknya jadi "sandbox" riset sebelum difinalisasi ke repo lain:

**(a) Root folder — LSTM Klasifikasi Trajectory AIS (akademik)**
- Berdasarkan paper *Ocean Engineering 303 (2024) 117711* dan dataset publik AIS Studio (Baidu): trajectory 4 fitur (lon, lat, speed, course) interval 2 menit.
- Target: 3 kelas jenis alat tangkap (*seine, trawler, gillnet*) — implementasi **baseline LSTM** yang lebih ringan dari model asli paper (MFGTN Transformer multi-modal).

**(b) Folder `new/` — Klasifikasi Citra SAR + Optimasi Inference**
- Menggunakan dataset **OpenSARShip** yang sama dengan repo `Helena's Code`, tetapi pendekatan berbeda: **klasifikasi** (bukan deteksi) memakai backbone **ResNet50 / VGG19 / AlexNet** yang digabung dengan *scale-variant features* tambahan.
- Dilengkapi pipeline **ekspor ONNX** (`export_onnx.py`) dan **TensorRT engine** (`build_trt_engine.py`, `infer_trt.py`) — mengindikasikan fokus pada **optimasi kecepatan inference** untuk deployment produksi (bukan sekadar eksperimen akurasi).

> Repo ini kemungkinan besar adalah tempat eksplorasi ide sebelum pendekatan terbaik "dipanen" ke `Helena's Code` (untuk deteksi) dan `Aqilla's Code` (untuk klasifikasi trajectory AIS).

---

## 2. Peta Keterhubungan Antar-Repository

```
                     ┌────────────────────────────────┐
                     │   Data Sumber: AIS / GFW API   │
                     │   + Citra Sentinel-1 (SAR)     │
                     └───────────────┬────────────────┘
                                     │
        ┌────────────────────────────┼─────────────────────────────┐
        ▼                            ▼                             ▼
┌──────────────────────┐   ┌─────────────────────────┐   ┌──────────────────────────────────────┐
│  Lingga's Code (root)│   │  Aqilla's Code          │   │  Lingga's Code (new/) + Helena's Code│
│  LSTM trajectory     │   │  Gear/Spoofing/GoDark/  │   │  Klasifikasi & Deteksi               │
│  klasifikasi (paper  │   │  Transshipment (BiLSTM  │   │  Objek Kapal dari Citra              │
│  akademik)           │   │  + attention, protokol  │   │  SAR (ResNet/VGG/YOLOv12)            │
│  → eksperimen awal   │   │  eksternal terkunci)    │   │  → deteksi kapal "gelap"             │
└──────────┬───────────┘   └────────────┬────────────┘   └────────────┬─────────────────────────┘
           │                            │  (ekspor: newcodinggfw.h5)  │
           │                            ▼                             │
           │              ┌─────────────────────────────┐             │
           └─────────────▶│   Fifi's Code "Samudra Aya" │◀───────────┘
                          │   Web dashboard (peta,       │
                          │   FastAPI inference server,  │
                          │   integrasi GFW + AIS live)  │
                          └──────────────────────────────┘
```

---

## 3. Roadmap Gabungan

### Fase 0 — Fondasi & Eksplorasi Data *(selesai)*
- [x] Pengumpulan data AIS/GFW (per jenis gear: trawlers, purse_seines, fixed_gear, drifting_longlines, dll).
- [x] Pengumpulan & anotasi dataset citra SAR **OpenSARShip** (patch VV/VH + metadata AIS).
- [x] Eksplorasi dataset akademik publik (AIS Studio/Baidu) sebagai pembanding baseline (`Lingga's Code` root).

### Fase 1 — Riset Model Deteksi Anomali berbasis Trajectory AIS *(`Aqilla's Code`, `Lingga's Code` root)*
- [x] Baseline LSTM sederhana untuk klasifikasi jenis alat tangkap dari trajectory (`Lingga's Code`).
- [x] Model BiLSTM + self-attention + auxiliary Haversine loss untuk **Gear Classification** (4 kelas final).
- [x] Simulator & detektor **Spoofing** (gradual drift, location jump) dengan evaluasi sequence-level.
- [x] Simulator & detektor **Go-Dark** dengan protokol domain terkunci (internal train/val vs external test murni), threshold dari validasi saja.
- [x] Detektor kandidat **Transshipment** (encounter + loitering) dengan pendekatan hybrid rule + ML (LSTM, Random Forest).
- [x] Multiseed tuning, kalibrasi Platt, audit protokol otomatis untuk semua 4 sub-pipeline.
- [ ] *(Selanjutnya)* Evaluasi lintas-domain tambahan / dataset baru di luar 4 sumber gear yang sudah dikunci.

### Fase 2 — Riset Deteksi & Klasifikasi Visual dari Citra SAR *(`Helena's Code`, Lingga's Code/new`)*
- [x] Eksperimen klasifikasi SAR berbasis CNN (ResNet50/VGG19/AlexNet) dengan fitur skala tambahan (`Lingga's Code/new`).
- [x] Eksperimen deteksi objek SAR berbasis YOLOv12 (n/s/m/l/x) dengan berbagai rasio split (`Helena's Code`).
- [x] Pemilihan model final: **YOLOv12n**, mAP50 validasi 79,12%.
- [x] Optimasi inference: ekspor ONNX + TensorRT engine (`Len/new`) untuk kecepatan real-time.
- [ ] *(Selanjutnya)* Integrasi output deteksi SAR ke dashboard `Samudra Aya` (saat ini dashboard baru memakai model AIS-based, belum ada modul visual SAR di web).

### Fase 3 — Integrasi Model ke Layanan Inference *(`Fifi's Code` + Hugging Face Space)*
- [x] Ekspor model gabungan (gear + spoofing + go-dark) dari `Aqilla's Code` menjadi satu file (`newcodinggfw.h5`).
- [x] Pembangunan FastAPI inference server (`InferenceGFW/api_server.py`) di-hosting di Hugging Face Space.
- [x] Pipeline feature engineering real-time (25 fitur turunan) + agregasi prediksi per-vessel (top-K sequence, weighted logits).
- [x] Endpoint job-async (`/inference/gfw`, `/inference/gfw/status/{job_id}`) agar tidak timeout saat proses lama.
- [ ] *(Selanjutnya)* Menambahkan endpoint inference untuk **transshipment** (saat ini baru gear/spoofing/godark yang terintegrasi ke web).

### Fase 4 — Produk Akhir: Dashboard Web "Samudra Aya" *(`Fifi's Code`)*
- [x] Peta interaktif Leaflet dengan 3 mode: **GFW** (fishing/encounter/loitering events), **AIS** (live stream via AISStream.io), **AI** (hasil inference model).
- [x] Backend proxy Vercel serverless + caching Redis/Upstash untuk data GFW API.
- [x] Visualisasi hasil AI: warna marker berdasarkan jenis gear, ring merah untuk kapal terindikasi spoofing/go-dark, panel confidence per kapal.
- [x] Dokumentasi arsitektur lengkap (`docs/pipeline-web.md`, `docs/pipeline-inference.md`).
- [x] Lampiran source code & laporan skripsi disertakan dalam repo.
- [ ] *(Selanjutnya)* Menambahkan visualisasi hasil deteksi SAR (dari Fase 2) sebagai layer tambahan di peta.
- [ ] *(Selanjutnya)* Menambahkan modul transshipment ke tampilan dashboard.

### Fase 5 — Pengembangan Lanjutan (Rencana ke Depan)
- [ ] Peningkatan UI/UX dashboard.

---

## 4. Ringkasan Status per Kapabilitas

| Kapabilitas | Riset | Model Final | Terintegrasi ke Dashboard |
|---|:---:|:---:|:---:|
| Klasifikasi Gear (AIS) | ✅ | ✅ | ✅ |
| Deteksi Spoofing AIS | ✅ | ✅ | ✅ |
| Deteksi Go-Dark | ✅ | ✅ | ✅ |
| Deteksi Transshipment | ✅ | ✅ | ❌ *(belum di web)* |
| Deteksi Kapal via SAR (YOLOv12) | ✅ | ✅ | ❌ *(belum di web)* |
| Klasifikasi Kapal via SAR (ResNet/VGG) | ✅ | 🟡 *(eksperimental)* | ❌ |
| Optimasi Inference SAR (TensorRT) | ✅ | 🟡 | ❌ |

---

## 5. Referensi Repository

- Inti riset AIS/GFW: <https://github.com/dhyaaqilla15-phy/TAcodingGFWanomaly>
- Deteksi SAR YOLOv12: <https://github.com/helenadityaa/SAR_YOLOv12>
- Eksperimen paralel (LSTM & SAR classification): <https://github.com/ngenss12/Len/tree/push-new-only-clean/new>
- Dashboard produk "Samudra Aya": <https://github.com/fififtrh28-source/GFWLASTTTTTT>

---
