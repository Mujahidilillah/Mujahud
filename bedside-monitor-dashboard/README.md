# Bedside Patient Monitor - Web Dashboard

Dashboard web untuk memantau **Bedside Monitor (Tensi + BPM + SpO2)** berbasis ESP32,
terhubung langsung ke **Firebase Realtime Database** yang sama dengan yang dipakai
di kode Arduino/ESP32 Anda.

## Fitur

- 🔐 **Halaman login** memakai Firebase Authentication (Email/Password) — akun yang
  sama dengan yang dipakai ESP32 untuk login ke Firebase.
- ❤️ **BPM & SpO₂ realtime** — update otomatis tiap ada data baru dari `/realtime/bpm`
  dan `/realtime/spo2` (dikirim ESP32 tiap 2 detik saat jari terdeteksi di sensor MAX30102).
- 🩺 **Hasil tekanan darah terakhir** (SYS / DIA / MAP / status NORMAL-TINGGI-RENDAH /
  mode MANUAL-OTOMATIS) dari `/monitor/hasil`.
- 🕒 **Jam & tanggal realtime** di pojok kanan atas.
- 💾 **Auto-save riwayat setiap 30 menit** ke penyimpanan browser (localStorage), plus
  tombol **"Simpan Sekarang"** untuk simpan manual kapan saja.
- ⬇️ **Download CSV** — unduh seluruh riwayat pengukuran kapan pun dibutuhkan (misalnya
  untuk rekam medis / laporan).
- 🟢 Indikator status koneksi ke Firebase (online/offline).

Tidak perlu Node.js, npm, atau proses build — murni HTML/CSS/JS + Firebase SDK lewat CDN,
jadi bisa langsung di-deploy ke **GitHub Pages**.

## Struktur File

```
bedside-monitor-dashboard/
├── index.html          # Halaman login (halaman pertama dibuka)
├── dashboard.html       # Halaman dashboard utama (setelah login)
├── css/
│   └── style.css        # Semua styling (tema gelap ala monitor RS)
├── js/
│   ├── firebase-config.js  # Konfigurasi koneksi Firebase
│   ├── login.js             # Logika proses login
│   └── dashboard.js         # Logika dashboard: listener realtime, jam, riwayat, CSV
└── README.md
```

## Struktur Data di Firebase (harus sama dengan kode ESP32)

```
/realtime/bpm            -> angka BPM realtime
/realtime/spo2           -> angka SpO2 realtime
/monitor/hasil/
    ├── sistolik
    ├── diastolik
    ├── map
    ├── bpm
    ├── spo2
    ├── status            "NORMAL" | "TINGGI" | "RENDAH"
    ├── mode              "MANUAL" | "OTOMATIS"
    └── timestamp_millis
```

Path ini persis mengikuti fungsi `kirimDataRealtime()` dan `kirimDataHasil()` di kode
ESP32 Anda — tidak perlu ubah apa pun di kode alat.

## Cara Setup

### 1. Buat akun untuk login dashboard

Di **Firebase Console → Authentication → Sign-in method**, pastikan metode
**Email/Password** aktif. Di tab **Users**, pastikan akun yang dipakai ESP32
(`mujigandrung@gmail.com` di contoh kode Anda) sudah terdaftar — akun ini juga
yang dipakai untuk login ke dashboard. Anda juga bisa menambah akun lain (misalnya
untuk perawat/dokter) di menu yang sama.

### 2. Cocokkan konfigurasi Firebase

Buka `js/firebase-config.js`. Nilai `apiKey` dan `databaseURL` di file ini **sudah
diisi sama** dengan yang ada di kode ESP32 Anda. Jika suatu saat Anda memakai
project Firebase yang berbeda, ambil konfigurasi baru dari:

**Firebase Console → Project Settings → General → Your apps → SDK setup and configuration**

### 3. Atur Realtime Database Rules

Di **Firebase Console → Realtime Database → Rules**, minimal:

```json
{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null"
  }
}
```

Ini mengizinkan siapa pun yang **sudah login** (baik ESP32 maupun dashboard web)
untuk membaca dan menulis data.

### 4. Jalankan secara lokal (opsional, untuk uji coba)

Karena Firebase Auth butuh diakses lewat `http://` atau `https://` (bukan `file://`),
jalankan lewat local server sederhana, contoh dengan Python:

```bash
cd bedside-monitor-dashboard
python3 -m http.server 8000
```

Lalu buka `http://localhost:8000` di browser.

### 5. Deploy ke GitHub Pages

1. Buat repository baru di GitHub, upload seluruh isi folder ini (bisa lewat
   `git push` atau drag-and-drop di GitHub web).
2. Buka **Settings → Pages** di repo tersebut.
3. Pada **Source**, pilih branch `main` dan folder `/ (root)`.
4. Setelah beberapa saat, dashboard akan bisa diakses di:
   `https://<username-anda>.github.io/<nama-repo>/`

### 6. Tambahkan domain GitHub Pages ke Firebase Auth

Agar login tidak diblokir Firebase, tambahkan domain GitHub Pages Anda di:
**Firebase Console → Authentication → Settings → Authorized domains** → tambahkan
`<username-anda>.github.io`.

## Cara Kerja Auto-Save & Download

- Setiap **30 menit**, dashboard otomatis mengambil nilai terakhir dari
  `/monitor/hasil` (+ BPM/SpO2 realtime terbaru) dan menyimpannya sebagai satu
  baris riwayat di `localStorage` browser.
- Tombol **"Simpan Sekarang"** melakukan hal yang sama secara manual, kapan saja.
- Tombol **"Download CSV"** mengekspor **seluruh riwayat yang tersimpan** ke file
  `.csv` yang bisa dibuka di Excel/Google Sheets.
- Riwayat tersimpan di browser (per perangkat/browser yang dipakai untuk membuka
  dashboard). Jika ingin riwayat tersimpan terpusat di server/cloud (bisa diakses
  dari perangkat mana pun), langkah selanjutnya adalah mengubah `dashboard.js`
  agar menulis riwayat ke path Firebase seperti `/history/{timestamp}` — beri tahu
  saya jika Anda ingin versi ini dibuatkan juga.

## Catatan Keamanan

- `apiKey` Firebase Web memang didesain untuk dipakai di sisi client/browser dan
  **bukan rahasia** — keamanan sesungguhnya ada di Firebase Authentication (siapa
  yang boleh login) dan Realtime Database Rules (siapa yang boleh baca/tulis).
- Tetap disarankan mengganti password akun Firebase default
  (`12345678` pada contoh kode ESP32 Anda) dengan password yang kuat.
