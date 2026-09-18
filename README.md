# AI-Powered Maritime Situational Intelligence

### Integrated AIS & SAR-Based Maritime Monitoring and Anomaly Detection

<p align="center">

**PT LEN × Institut Teknologi Sepuluh Nopember (ITS)**

</p>

---

## Overview

Proyek ini merupakan pengembangan **AI-Powered Maritime Situational Intelligence (MSI)** untuk meningkatkan kemampuan pemantauan aktivitas kapal dan identifikasi indikasi **IUU Fishing dan Ocean Crime** melalui integrasi data **Automatic Identification System (AIS)** dan **Synthetic Aperture Radar (SAR)**.

Pengembangan tahun kedua melanjutkan hasil penelitian tahun pertama dengan mengintegrasikan beberapa pipeline yang telah dikembangkan secara terpisah menjadi satu sistem MSI yang lebih terintegrasi, akurat, dan informatif.

---

## TIM RISET TAHUN PERTAMA

Hasil penelitian tahun pertama dikembangkan melalui beberapa repository utama:

| Contributor | Repository                                                                   | Main Contribution         |
| ----------- | ---------------------------------------------------------------------------- | ------------------------- |
| **Lingga**  | [Len](https://github.com/ngenss12/Len)                                       | Samudra Aya / Application |
| **Helena**  | [SAR_YOLOv12](https://github.com/helenadityaa/SAR_YOLOv12)                   | SAR Vessel Detection      |
| **Aqilla**  | [TAcodingGFWanomaly](https://github.com/dhyaaqilla15-phy/TAcodingGFWanomaly) | AIS/GFW Anomaly Detection |
| **Fifi**    | [GFWLASTTTTTT](https://github.com/fififtrh28-source/GFWLASTTTTTT)            | Ocean Nexus Dashboard     |

### Komponen yang telah dikembangkan

**AIS / GFW Analysis**

* Vessel trajectory processing
* Fishing gear classification
* AIS spoofing detection
* AIS gap / go-dark detection
* Encounter & loitering detection
* Transshipment candidate detection

**SAR Analysis**

* SAR preprocessing
* VV/VH dual-polarization data
* Vessel object detection menggunakan YOLOv12
* Klasifikasi **Fishing, Cargo, dan Passenger**

**AIS–SAR Integration**

* AIS trajectory reconstruction
* Kalman-based position estimation
* Spatial matching antara AIS dan SAR
* Pembentukan kandidat aktivitas/anomali kapal
* Visualisasi hasil melalui maritime dashboard

---

### Roadmap

```text
TAHUN PERTAMA
│
├── AIS / GFW Anomaly Detection
│   ├── Gear Classification
│   ├── AIS Gap / Go-Dark
│   ├── Spoofing
│   ├── Loitering
│   └── Encounter / Transshipment
│
├── SAR Vessel Detection
│   └── YOLOv12 + VV/VH SAR
│
└── AIS–SAR Prototype & Dashboard
        │
        ▼
TAHUN KEDUA
│
├── 1. Dataset Preparation
│   ├── AIS dataset
│   ├── SAR dataset
│   └── Spatial-temporal alignment
│
├── 2. AIS–SAR Data Fusion
│   ├── Vessel identity matching
│   ├── Position & time matching
│   ├── Trajectory reconstruction
│   └── Multi-sensor feature fusion
│
├── 3. Integrated Anomaly Detection
│   ├── AIS Gap / Dark Activity
│   ├── Loitering
│   ├── MMSI Spoofing
│   ├── Encounter Events
│   └── Restricted Zone Entry
│
├── 4. AI-Based Decision Layer
│   ├── Anomaly scoring
│   ├── Multi-sensor verification
│   └── Alert generation
│
└── 5. Maritime Situational Intelligence
    ├── Integrated maritime map
    ├── Vessel tracking
    ├── Anomaly visualization
    └── Alert & reporting system
```

---

## TIM RISET TAHUN KEDUA

| Name       | Contribution                  |
| ---------- | ----------------------------- |
| **Aulia**  | System Integration & Research |
| **Sylvia** | System Integration & Research |
| **Syabil** | System Integration & Research |
|  **Gio**   | System Integration & Research |

## Future Development

Pengembangan selanjutnya berfokus pada **fusi data AIS dan SAR** untuk menghasilkan informasi aktivitas kapal yang lebih lengkap dan akurat dibandingkan penggunaan satu sumber data saja.

Data AIS digunakan untuk memperoleh informasi identitas dan pergerakan kapal, sedangkan citra SAR digunakan sebagai **independent observation** untuk memverifikasi keberadaan dan posisi kapal, termasuk kapal yang tidak terdeteksi atau tidak sesuai dengan informasi AIS.

Fusi kedua sumber data diarahkan untuk mendeteksi **lima kategori anomali utama**:

1. **AIS Gap / Dark Activity** — indikasi kapal terdeteksi pada SAR ketika transmisi AIS tidak tersedia.
2. **Loitering** — pola pergerakan kapal yang menunjukkan aktivitas menetap atau berputar pada area tertentu.
3. **MMSI Spoofing** — ketidaksesuaian antara identitas AIS dan observasi kapal pada SAR.
4. **Encounter Events** — indikasi pertemuan/interaksi antar kapal yang berpotensi menunjukkan aktivitas seperti transshipment.
5. **Restricted Zone Entry** — indikasi kapal memasuki wilayah yang dibatasi atau dilarang berdasarkan informasi geospasial.

### Target Akhir

> **AIS + SAR → Data Fusion → Multi-Anomaly Detection → Alert Generation → Maritime Situational Intelligence**

Sistem akhir diharapkan mampu menyediakan **single integrated maritime picture** yang menggabungkan informasi identitas, trajectory, observasi citra, serta indikasi anomali kapal untuk mendukung peningkatan **Maritime Situational Awareness** dan deteksi **IUU Fishing serta Ocean Crime**.

<p align="center">

**PT LEN × ITS**

**AI-Powered Maritime Situational Intelligence**

*AIS • SAR • Artificial Intelligence • Data Fusion*

</p>
