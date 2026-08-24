# Bedside Patient Monitor - Web Dashboard

Dashboard web untuk memantau **Bedside Monitor (Tensi + BPM + SpO2)** berbasis ESP32,
terhubung langsung ke **Firebase Realtime Database** yang sama dengan yang dipakai
di kode Arduino/ESP32.

## Fitur

- 🔐 **Halaman login** memakai Firebase Authentication (Email/Password) — akun yang
  sama dengan yang dipakai ESP32 untuk login ke Firebase.
- ❤️ **BPM & SpO₂ realtime** — angka live update otomatis dari `/realtime/bpm` dan
  `/realtime/spo2` (dikirim ESP32 tiap 2 detik saat jari terdeteksi di sensor MAX30102).
- 🩺 **Hasil tekanan darah terakhir** (SYS / DIA / MAP / status NORMAL-TINGGI-RENDAH /
  mode MANUAL-OTOMATIS) dari `/monitor/hasil`.
- 🕒 **Jam & tanggal realtime** di pojok kanan atas.
- 📋 **Riwayat pengukuran tekanan darah** — setiap kali alat selesai mengukur (baik
  ditekan manual maupun siklus otomatis), hasilnya otomatis masuk sebagai baris baru
  ke tabel riwayat, lengkap dengan tombol **Download CSV**.
- 📋 **Riwayat BPM & SpO₂** — setiap kali angka BPM atau SpO₂ **berubah**, alat
  mengirim baris baru ke riwayat ini juga, lengkap dengan tombol **Download CSV**
  terpisah.
- 🟢 Indikator status koneksi ke Firebase (online/offline).

Tidak perlu Node.js, npm, atau proses build — murni HTML/CSS/JS + Firebase SDK lewat CDN,
jadi bisa langsung di-deploy ke **GitHub Pages**.

## Struktur File

```
bedside-monitor-dashboard/
├── index.html            # Halaman login (halaman pertama dibuka)
├── dashboard.html         # Halaman dashboard utama (setelah login)
├── css/
│   └── style.css          # Semua styling (tema gelap ala monitor RS)
├── js/
│   ├── firebase-config.js    # Konfigurasi koneksi Firebase
│   ├── login.js                # Logika proses login
│   └── dashboard.js            # Logika dashboard: realtime, riwayat, CSV
├── esp32/
│   └── bedside_monitor.ino   # Kode Arduino/ESP32 (versi terbaru, WAJIB di-upload ulang ke alat)
└── README.md
```

## ⚠️ PENTING: Upload ulang kode ke ESP32

Dashboard versi ini butuh perilaku baru dari alat (kirim tiap hasil ukur & tiap
perubahan BPM/SpO2 ke riwayat). **Upload ulang** `esp32/bedside_monitor.ino` ke ESP32
Anda lewat Arduino IDE — kode ini sudah lengkap dengan pengaturan WiFi & Firebase yang
sama seperti sebelumnya, tidak perlu isi ulang kalau WiFi/akun Anda tidak berubah.

Perubahan pada kode ESP32 dibanding versi sebelumnya:

1. **Interval mode Otomatis** diubah dari 2 menit menjadi **30 menit**
   (`AUTO_INTERVAL`).
2. **Setiap hasil pengukuran tekanan darah** (mode Manual maupun Otomatis) sekarang
   disimpan sebagai baris riwayat baru di `/history/tekanan`, selain tetap
   memperbarui `/monitor/hasil` seperti biasa.
3. **BPM & SpO2** tetap dikirim tiap 2 detik ke `/realtime/bpm` & `/realtime/spo2`
   (untuk angka live), tapi riwayatnya di `/history/vitals` hanya bertambah baris
   **saat nilainya benar-benar berubah** — supaya database tidak dibanjiri angka
   yang sama berulang setiap 2 detik.

## Struktur Data di Firebase

```
/realtime/bpm                -> angka BPM live (ditimpa tiap 2 detik)
/realtime/spo2               -> angka SpO2 live (ditimpa tiap 2 detik)

/monitor/hasil/               -> hasil tekanan darah TERAKHIR (ditimpa)
    ├── sistolik
    ├── diastolik
    ├── map
    ├── bpm
    ├── spo2
    ├── status                 "NORMAL" | "TINGGI" | "RENDAH"
    ├── mode                   "MANUAL" | "OTOMATIS"
    ├── timestamp_millis
    └── waktu                  (timestamp server Firebase, ms)

/history/tekanan/{id}/        -> RIWAYAT setiap hasil pengukuran (baris baru
                                  tiap kali alat selesai mengukur)
    ├── sistolik, diastolik, map, bpm, spo2, status, mode, waktu

/history/vitals/{id}/         -> RIWAYAT setiap kali BPM/SpO2 berubah
    ├── bpm, spo2, mode, waktu
```

`{id}` adalah push-ID unik otomatis dari Firebase (urut secara kronologis), dan
`waktu` diisi memakai timestamp **server** Firebase (`.sv: timestamp`) supaya
akurat walau ESP32 sendiri tidak tahu jam sebenarnya.

## Cara Setup

### 1. Buat akun untuk login dashboard

Di **Firebase Console → Authentication → Sign-in method**, pastikan metode
**Email/Password** aktif. Di tab **Users**, pastikan akun yang dipakai ESP32
sudah terdaftar — akun ini juga yang dipakai untuk login ke dashboard. Anda juga
bisa menambah akun lain (misalnya untuk perawat/dokter) di menu yang sama.

### 2. Cocokkan konfigurasi Firebase

Buka `js/firebase-config.js`. Nilai `apiKey` dan `databaseURL` di file ini harus
sama dengan yang ada di kode ESP32 (`esp32/bedside_monitor.ino`). Jika suatu saat
Anda memakai project Firebase yang berbeda, ambil konfigurasi baru dari:

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
untuk membaca dan menulis ke seluruh path, termasuk `/history/tekanan` dan
`/history/vitals`.

### 4. Upload ulang kode ke ESP32

Buka `esp32/bedside_monitor.ino` di Arduino IDE, cek kembali `WIFI_SSID`,
`WIFI_PASSWORD`, dan `USER_PASSWORD` sudah sesuai, lalu upload ke board.

### 5. Jalankan dashboard secara lokal (opsional, untuk uji coba)

Karena Firebase Auth butuh diakses lewat `http://` atau `https://` (bukan `file://`),
jalankan lewat local server sederhana, contoh dengan Python:

```bash
cd bedside-monitor-dashboard
python3 -m http.server 8000
```

Lalu buka `http://localhost:8000` di browser.

### 6. Deploy ke GitHub Pages

1. Buat repository baru di GitHub, upload **isi** folder ini langsung ke root
   repo (bukan folder pembungkus di dalamnya).
2. Buka **Settings → Pages** di repo tersebut.
3. Pada **Source**, pilih branch `main` dan folder `/ (root)`.
4. Setelah beberapa saat, dashboard akan bisa diakses di:
   `https://<username-anda>.github.io/<nama-repo>/`

### 7. Tambahkan domain GitHub Pages ke Firebase Auth

Agar login tidak diblokir Firebase, tambahkan domain GitHub Pages Anda di:
**Firebase Console → Authentication → Settings → Authorized domains** → tambahkan
`<username-anda>.github.io`.

## Cara Kerja Riwayat & Download

- **Mode Manual**: setiap Anda menekan START dan pengukuran selesai, hasilnya
  langsung terkirim sebagai baris baru di tabel "Riwayat Pengukuran Tekanan Darah".
  Selama proses berjalan, tiap kali BPM/SpO2 berubah, baris baru juga muncul di
  tabel "Riwayat BPM & SpO2".
- **Mode Otomatis**: alat mengukur ulang tiap 30 menit, hasilnya otomatis masuk ke
  riwayat tekanan darah. BPM/SpO2 tetap dicatat tiap kali berubah, sama seperti
  mode manual.
- Tombol **"Simpan Nilai Saat Ini"** adalah cadangan manual dari sisi dashboard —
  mengambil nilai yang sedang ditampilkan di layar dan menyimpannya langsung ke
  `/history/tekanan`, berguna kalau Anda ingin snapshot tambahan tanpa menunggu
  alat.
- Tombol **"Download CSV"** di masing-masing tabel mengekspor **seluruh riwayat**
  pada tabel itu ke file `.csv` yang bisa dibuka di Excel/Google Sheets. Karena
  data sekarang tersimpan di Firebase (bukan localStorage), riwayat bisa diakses
  dan diunduh dari perangkat mana pun yang login ke dashboard.

## Catatan Keamanan

- `apiKey` Firebase Web memang didesain untuk dipakai di sisi client/browser dan
  **bukan rahasia** — keamanan sesungguhnya ada di Firebase Authentication (siapa
  yang boleh login) dan Realtime Database Rules (siapa yang boleh baca/tulis).
- Tetap disarankan mengganti password akun Firebase default dengan password yang
  kuat.
