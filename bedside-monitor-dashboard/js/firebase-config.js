// =====================================================================
// KONFIGURASI FIREBASE
// =====================================================================
// Nilai di bawah ini HARUS SAMA dengan yang dipakai di kode ESP32
// (API_KEY & DATABASE_URL). apiKey Firebase Web memang didesain untuk
// dipakai di sisi client/browser (bukan rahasia), keamanan sebenarnya
// diatur lewat Firebase Authentication + Realtime Database Rules.
//
// Jika Anda membuat project Firebase baru / beda, ganti nilai di bawah
// sesuai punya Anda (Firebase Console -> Project Settings -> General
// -> Your apps -> SDK setup and configuration).
// =====================================================================

const firebaseConfig = {
  apiKey: "AIzaSyBvA0MXGo2uSG3zt0aHGGTAsej1iJ7ZWdM",
  databaseURL: "https://bedside-monitor-iot-default-rtdb.firebaseio.com",
  projectId: "bedside-monitor-iot"
};

// Inisialisasi Firebase (pakai SDK versi "compat" biar tidak perlu build tool / npm)
firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.database();
