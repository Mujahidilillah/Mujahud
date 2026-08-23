// =====================================================================
// DASHBOARD.JS
// - Menampilkan data dari Firebase RTDB sesuai struktur kode ESP32:
//     /monitor/{sistolik,diastolik,map,bpm,spo2,timestamp}
//     /realtime/{bpm,spo2}
// - Menyimpan snapshot ke /riwayat setiap 30 menit (otomatis) + manual
// - Jam real-time & tombol download CSV
// =====================================================================

const AUTOSAVE_INTERVAL_MS = 30 * 60 * 1000; // 30 menit
const LOCAL_HISTORY_KEY = "pm_riwayat_local";

const IS_DEMO_MODE =
  typeof FORCE_DEMO_MODE !== "undefined" && FORCE_DEMO_MODE
    ? true
    : !firebaseConfig || firebaseConfig.apiKey === "YOUR_API_KEY";

let currentMonitor = { sistolik: 0, diastolik: 0, map: 0, bpm: 0, spo2: 0, timestamp: "-" };
let currentRealtime = { bpm: 0, spo2: 0 };
let fingerDetected = true;
let historyData = [];
let nextAutosaveAt = Date.now() + AUTOSAVE_INTERVAL_MS;

// ---------------------------------------------------------------
// ELEMEN DOM
// ---------------------------------------------------------------
const el = (id) => document.getElementById(id);
const modePill = el("modePill");
const clockTime = el("clockTime");
const clockDate = el("clockDate");
const connDot = el("connDot");
const connLabel = el("connLabel");
const userEmail = el("userEmail");
const logoutBtn = el("logoutBtn");

const valSys = el("valSys");
const valDia = el("valDia");
const valMap = el("valMap");
const statusTag = el("statusTag");
const lastUpdated = el("lastUpdated");
const deviceModeLabel = el("deviceModeLabel");

const valBpm = el("valBpm");
const valSpo2 = el("valSpo2");
const fingerTag = el("fingerTag");
const ecgStrip = el("ecgStrip");

const historyBody = el("historyBody");
const autosaveNote = el("autosaveNote");
const saveNowBtn = el("saveNowBtn");
const downloadBtn = el("downloadBtn");

// =====================================================================
// 1) AUTH GUARD
// =====================================================================
function goToLogin() {
  window.location.href = "index.html";
}

if (IS_DEMO_MODE) {
  const loggedIn = sessionStorage.getItem("pm_logged_in") === "1";
  if (!loggedIn) { goToLogin(); }
  userEmail.textContent = sessionStorage.getItem("pm_user_email") || "demo@pasienmonitor.local";
  connLabel.textContent = "Demo mode";
  connDot.classList.add("online");
} else {
  firebase.initializeApp(firebaseConfig);
  firebase.auth().onAuthStateChanged((user) => {
    if (!user) { goToLogin(); return; }
    userEmail.textContent = user.email || "Pengguna";
  });
}

logoutBtn.addEventListener("click", () => {
  if (IS_DEMO_MODE) {
    sessionStorage.removeItem("pm_logged_in");
    goToLogin();
  } else {
    firebase.auth().signOut().then(goToLogin);
  }
});

// =====================================================================
// 2) JAM REAL-TIME
// =====================================================================
const HARI = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
const BULAN = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

function updateClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  clockTime.textContent = `${hh}:${mm}:${ss}`;
  clockDate.textContent = `${HARI[now.getDay()]}, ${now.getDate()} ${BULAN[now.getMonth()]} ${now.getFullYear()}`;

  // Hitung mundur autosave berikutnya
  const remainMs = Math.max(0, nextAutosaveAt - now.getTime());
  const remMin = String(Math.floor(remainMs / 60000)).padStart(2, "0");
  const remSec = String(Math.floor((remainMs % 60000) / 1000)).padStart(2, "0");
  autosaveNote.textContent = `Simpan otomatis berikutnya dalam ${remMin}:${remSec}`;
}
setInterval(updateClock, 1000);
updateClock();

// =====================================================================
// 3) HITUNG STATUS (meniru logika hitungTekanan() / tampilHasil() di ESP32)
// =====================================================================
function hitungStatus(sistolik, diastolik) {
  if (sistolik >= 140 || diastolik >= 90) return "TINGGI";
  if (sistolik < 90 || diastolik < 60) return "RENDAH";
  return "NORMAL";
}

function renderStatusTag(target, status) {
  target.classList.remove("status-normal", "status-tinggi", "status-rendah");
  if (status === "TINGGI") target.classList.add("status-tinggi");
  else if (status === "RENDAH") target.classList.add("status-rendah");
  else target.classList.add("status-normal");
  target.textContent = status;
}

// =====================================================================
// 4) RENDER DATA KE UI
// =====================================================================
function renderMonitor() {
  valSys.textContent = currentMonitor.sistolik || "--";
  valDia.textContent = currentMonitor.diastolik || "--";
  valMap.textContent = currentMonitor.map || "--";

  const status = hitungStatus(Number(currentMonitor.sistolik) || 0, Number(currentMonitor.diastolik) || 0);
  renderStatusTag(statusTag, status);

  lastUpdated.textContent = formatTimestamp(currentMonitor.timestamp);
}

function renderRealtime() {
  if (!fingerDetected) {
    valBpm.textContent = "--";
    valSpo2.innerHTML = `--<span style="font-size:20px;">%</span>`;
    valBpm.classList.add("no-finger");
    valSpo2.classList.add("no-finger");
    fingerTag.textContent = "TIDAK ADA JARI";
    fingerTag.classList.remove("status-normal");
    fingerTag.classList.add("status-rendah");
    ecgStrip.classList.remove("animate");
    return;
  }

  valBpm.classList.remove("no-finger");
  valSpo2.classList.remove("no-finger");
  fingerTag.textContent = "JARI TERDETEKSI";
  fingerTag.classList.remove("status-rendah");
  fingerTag.classList.add("status-normal");

  valBpm.textContent = currentRealtime.bpm || "--";
  valSpo2.innerHTML = `${currentRealtime.spo2 || "--"}<span style="font-size:20px;">%</span>`;

  if (currentRealtime.bpm > 0) {
    const duration = Math.max(0.3, 60 / currentRealtime.bpm).toFixed(2);
    ecgStrip.querySelector("svg").style.animationDuration = duration + "s";
    ecgStrip.classList.add("animate");
  }
}

function formatTimestamp(ts) {
  if (!ts || ts === "-") return "-";
  // timestamp dari ESP32 dikirim sebagai millis() (String), bukan epoch asli.
  // Kalau nilainya kecil (millis sejak boot), tampilkan apa adanya + label.
  const n = Number(ts);
  if (!isNaN(n) && n > 1000000000000) {
    // terlihat seperti epoch ms sungguhan
    return new Date(n).toLocaleString("id-ID");
  }
  return `${ts} ms (sejak boot alat)`;
}

// =====================================================================
// 5) KONEKSI FIREBASE / DEMO SIMULATION
// =====================================================================
if (!IS_DEMO_MODE) {
  const db = firebase.database();

  db.ref(".info/connected").on("value", (snap) => {
    const online = snap.val() === true;
    connDot.classList.toggle("online", online);
    connDot.classList.toggle("offline", !online);
    connLabel.textContent = online ? "Terhubung" : "Terputus";
  });

  db.ref("/monitor").on("value", (snap) => {
    const v = snap.val();
    if (v) {
      currentMonitor = {
        sistolik: v.sistolik ?? 0,
        diastolik: v.diastolik ?? 0,
        map: v.map ?? 0,
        bpm: v.bpm ?? 0,
        spo2: v.spo2 ?? 0,
        timestamp: v.timestamp ?? "-"
      };
      renderMonitor();
    }
  });

  db.ref("/realtime").on("value", (snap) => {
    const v = snap.val();
    if (v) {
      currentRealtime = { bpm: v.bpm ?? 0, spo2: v.spo2 ?? 0 };
      fingerDetected = (v.bpm > 0 || v.spo2 > 0);
      renderRealtime();
    }
  });

  // Sinkronkan riwayat dari server (supaya konsisten lintas perangkat)
  db.ref("/riwayat").limitToLast(200).on("value", (snap) => {
    const v = snap.val() || {};
    historyData = Object.values(v).sort((a, b) => (a._t || 0) - (b._t || 0));
    renderHistory();
  });
} else {
  connLabel.textContent = "Demo mode";
  // Simulasikan data vital supaya tampilan bisa langsung dicoba
  historyData = loadLocalHistory();
  renderHistory();

  setInterval(() => {
    const bpm = 68 + Math.round(Math.sin(Date.now() / 4000) * 8) + Math.round(Math.random() * 4);
    const spo2 = 96 + Math.round(Math.random() * 3);
    currentRealtime = { bpm, spo2 };
    fingerDetected = true;
    renderRealtime();
  }, 1200);

  const sys = 118 + Math.round(Math.random() * 10);
  const dia = 76 + Math.round(Math.random() * 8);
  currentMonitor = {
    sistolik: sys,
    diastolik: dia,
    map: Math.round((sys + 2 * dia) / 3),
    bpm: 72,
    spo2: 98,
    timestamp: Date.now()
  };
  renderMonitor();
}

// =====================================================================
// 6) RIWAYAT (HISTORY) — render tabel
// =====================================================================
function renderHistory() {
  if (!historyData.length) {
    historyBody.innerHTML = `<tr class="empty-row"><td colspan="7">Belum ada data riwayat tersimpan.</td></tr>`;
    return;
  }
  const rows = historyData
    .slice()
    .reverse()
    .map((row) => {
      const status = hitungStatus(Number(row.sistolik) || 0, Number(row.diastolik) || 0);
      const statusClass = status === "TINGGI" ? "status-tinggi" : status === "RENDAH" ? "status-rendah" : "status-normal";
      return `<tr>
        <td>${row.waktu || "-"}</td>
        <td>${row.sistolik ?? "-"}</td>
        <td>${row.diastolik ?? "-"}</td>
        <td>${row.map ?? "-"}</td>
        <td>${row.bpm ?? "-"}</td>
        <td>${row.spo2 ?? "-"}</td>
        <td><span class="status-tag ${statusClass}">${status}</span></td>
      </tr>`;
    })
    .join("");
  historyBody.innerHTML = rows;
}

function loadLocalHistory() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_HISTORY_KEY) || "[]");
  } catch (e) {
    return [];
  }
}

function saveLocalHistory() {
  try {
    localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(historyData.slice(-500)));
  } catch (e) {}
}

// =====================================================================
// 7) SIMPAN SNAPSHOT (otomatis tiap 30 menit + tombol manual)
// =====================================================================
function simpanSnapshot() {
  const now = new Date();
  const entry = {
    _t: now.getTime(),
    waktu: now.toLocaleString("id-ID"),
    sistolik: currentMonitor.sistolik,
    diastolik: currentMonitor.diastolik,
    map: currentMonitor.map,
    bpm: fingerDetected ? currentRealtime.bpm : (currentMonitor.bpm || 0),
    spo2: fingerDetected ? currentRealtime.spo2 : (currentMonitor.spo2 || 0)
  };

  historyData.push(entry);
  renderHistory();
  saveLocalHistory();

  if (!IS_DEMO_MODE) {
    firebase.database().ref("/riwayat").push(entry).catch((err) => {
      console.error("Gagal menyimpan riwayat ke Firebase:", err);
    });
  }

  nextAutosaveAt = Date.now() + AUTOSAVE_INTERVAL_MS;
}

// Timer auto-save setiap 30 menit (berjalan selama halaman dashboard terbuka)
setInterval(simpanSnapshot, AUTOSAVE_INTERVAL_MS);

saveNowBtn.addEventListener("click", () => {
  simpanSnapshot();
  saveNowBtn.textContent = "✔ Tersimpan";
  setTimeout(() => (saveNowBtn.textContent = "💾 Simpan Sekarang"), 1500);
});

// =====================================================================
// 8) DOWNLOAD CSV
// =====================================================================
function toCSV(rows) {
  const header = ["Waktu", "SYS (mmHg)", "DIA (mmHg)", "MAP (mmHg)", "BPM", "SpO2 (%)", "Status"];
  const lines = [header.join(",")];

  rows.forEach((row) => {
    const status = hitungStatus(Number(row.sistolik) || 0, Number(row.diastolik) || 0);
    const line = [
      `"${row.waktu || "-"}"`,
      row.sistolik ?? "",
      row.diastolik ?? "",
      row.map ?? "",
      row.bpm ?? "",
      row.spo2 ?? "",
      status
    ].join(",");
    lines.push(line);
  });

  return lines.join("\n");
}

downloadBtn.addEventListener("click", () => {
  if (!historyData.length) {
    alert("Belum ada data riwayat untuk diunduh. Klik 'Simpan Sekarang' dulu, atau tunggu auto-save 30 menit.");
    return;
  }
  const csv = toCSV(historyData);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  a.href = url;
  a.download = `riwayat-pasien-monitor-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});
