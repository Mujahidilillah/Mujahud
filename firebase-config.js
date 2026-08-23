// =====================================================================
// KONFIGURASI FIREBASE — WAJIB DIISI SEBELUM DIPAKAI
// =====================================================================
// Ambil nilai-nilai ini dari Firebase Console:
// Project Settings -> General -> "Your apps" -> SDK setup and configuration
//
// PENTING SOAL KEAMANAN:
// - apiKey di config web Firebase BUKAN rahasia (memang didesain untuk
//   ditempel di kode frontend), tapi tetap JANGAN commit email/password
//   akun admin (yang dipakai ESP32) ke repo publik ini.
// - Batasi akses data dengan Firebase Realtime Database Rules, dan
//   aktifkan Firebase Authentication supaya hanya user yang login
//   lewat halaman ini yang bisa membaca /monitor, /realtime, /riwayat.
// - databaseURL HARUS SAMA dengan yang dipakai di kode ESP32 kamu
//   (DATABASE_URL di file .ino) supaya data yang tampil sinkron.
// =====================================================================

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// Set true kalau firebaseConfig di atas belum diisi (kode akan otomatis
// mendeteksi ini juga), dipakai untuk memaksa DEMO MODE secara manual.
const FORCE_DEMO_MODE = false;
