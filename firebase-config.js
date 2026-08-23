// =====================================================
// Konfigurasi Firebase — proyek yang SAMA dengan alat ESP32.
// Nilai ini aman ditaruh di kode client-side; yang benar-benar
// menjaga keamanan data adalah RULES Realtime Database (lihat README).
// =====================================================
const firebaseConfig = {
  apiKey: "AIzaSyBvA0MXGo2uSG3zt0aHGGTAsej1iJ7ZWdM",
  authDomain: "bedside-monitor-iot.firebaseapp.com",
  databaseURL: "https://bedside-monitor-iot-default-rtdb.firebaseio.com",
  projectId: "bedside-monitor-iot",
  storageBucket: "bedside-monitor-iot.firebasestorage.app",
  messagingSenderId: "834448931336",
  appId: "1:834448931336:web:e7194eb69e5ccb643cafbd",
  measurementId: "G-E5864YSC5P"
};

firebase.initializeApp(firebaseConfig);
