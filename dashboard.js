// =====================================================================
// DASHBOARD - BEDSIDE PATIENT MONITOR
// =====================================================================
// Struktur data di Firebase Realtime Database (harus sama dengan kode ESP32):
//
//   /realtime/bpm            -> angka BPM realtime (dikirim tiap 2 detik saat jari terdeteksi)
//   /realtime/spo2           -> angka SpO2 realtime (dikirim tiap 2 detik saat jari terdeteksi)
//   /monitor/hasil/sistolik
//   /monitor/hasil/diastolik
//   /monitor/hasil/map
//   /monitor/hasil/bpm
//   /monitor/hasil/spo2
//   /monitor/hasil/status          -> "NORMAL" | "TINGGI" | "RENDAH"
//   /monitor/hasil/mode            -> "MANUAL" | "OTOMATIS"
//   /monitor/hasil/timestamp_millis
// =====================================================================

const AUTO_SAVE_INTERVAL_MS = 30 * 60 * 1000; // 30 menit
const LOCAL_STORAGE_KEY = "riwayat_pasien_monitor";

let latestHasil = null;     // data terakhir dari /monitor/hasil
let latestBpmRealtime = null;
let latestSpo2Realtime = null;
let nextAutoSaveAt = Date.now() + AUTO_SAVE_INTERVAL_MS;

// =====================================================================
// 1. AUTH GUARD - kalau belum login, lempar ke halaman login
// =====================================================================
auth.onAuthStateChanged((user) => {
  if (!user) {
    window.location.href = "index.html";
  } else {
    document.getElementById("userEmail").textContent = user.email;
  }
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  auth.signOut().then(() => {
    window.location.href = "index.html";
  });
});

// =====================================================================
// 2. JAM REALTIME
// =====================================================================
const namaHari = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
const namaBulan = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];

function updateJam() {
  const now = new Date();

  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  document.getElementById("jamRealtime").textContent = `${hh}:${mm}:${ss}`;
  document.getElementById("tanggalRealtime").textContent =
    `${namaHari[now.getDay()]}, ${now.getDate()} ${namaBulan[now.getMonth()]} ${now.getFullYear()}`;

  updateAutoSaveCountdown(now);
}
setInterval(updateJam, 1000);
updateJam();

function updateAutoSaveCountdown(now) {
  const sisaMs = nextAutoSaveAt - now.getTime();
  const el = document.getElementById("autoSaveInfo");

  if (sisaMs <= 0) {
    el.textContent = "Auto-save tiap 30 menit \u00B7 Menyimpan...";
    return;
  }

  const sisaMenit = Math.floor(sisaMs / 60000);
  const sisaDetik = Math.floor((sisaMs % 60000) / 1000);
  el.textContent = `Auto-save tiap 30 menit \u00B7 Berikutnya dalam ${sisaMenit}m ${sisaDetik}d`;
}

// =====================================================================
// 3. STATUS KONEKSI FIREBASE
// =====================================================================
db.ref(".info/connected").on("value", (snap) => {
  const el = document.getElementById("connStatus");
  if (snap.val() === true) {
    el.textContent = "\u25CF Terhubung ke database";
    el.className = "conn-status conn-online";
  } else {
    el.textContent = "\u25CF Terputus dari database";
    el.className = "conn-status conn-offline";
  }
});

// =====================================================================
// 4. LISTENER REALTIME: BPM & SpO2
// =====================================================================
db.ref("realtime/bpm").on("value", (snap) => {
  const val = snap.val();
  latestBpmRealtime = val;

  const bpmEl = document.getElementById("bpmValue");
  const fingerEl = document.getElementById("fingerStatusBpm");

  if (val && val > 0) {
    bpmEl.textContent = val;
    fingerEl.textContent = "Jari terdeteksi";
    fingerEl.classList.add("finger-ok");
  } else {
    bpmEl.textContent = "--";
    fingerEl.textContent = "Menunggu jari...";
    fingerEl.classList.remove("finger-ok");
  }
});

db.ref("realtime/spo2").on("value", (snap) => {
  const val = snap.val();
  latestSpo2Realtime = val;

  const spo2El = document.getElementById("spo2Value");
  spo2El.textContent = (val && val > 0) ? val : "--";
});

// =====================================================================
// 5. LISTENER: HASIL PENGUKURAN TEKANAN DARAH TERAKHIR
// =====================================================================
db.ref("monitor/hasil").on("value", (snap) => {
  const data = snap.val();
  if (!data) return;

  latestHasil = data;

  document.getElementById("sysValue").textContent = data.sistolik ?? "--";
  document.getElementById("diaValue").textContent = data.diastolik ?? "--";
  document.getElementById("mapValue").textContent =
    (typeof data.map === "number") ? data.map.toFixed(1) : (data.map ?? "--");

  document.getElementById("modeValue").textContent = data.mode ?? "-";
  document.getElementById("statusValue").textContent = data.status ?? "-";

  const statusEl = document.getElementById("statusValue");
  statusEl.classList.remove("status-normal", "status-tinggi", "status-rendah");
  if (data.status === "NORMAL") statusEl.classList.add("status-normal");
  else if (data.status === "TINGGI") statusEl.classList.add("status-tinggi");
  else if (data.status === "RENDAH") statusEl.classList.add("status-rendah");

  document.getElementById("waktuUkurTerakhir").textContent =
    "Update: " + new Date().toLocaleTimeString("id-ID");
});

// =====================================================================
// 6. RIWAYAT (localStorage) + AUTO-SAVE TIAP 30 MENIT
// =====================================================================
function bacaRiwayat() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY)) || [];
  } catch (e) {
    return [];
  }
}

function simpanRiwayat(riwayat) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(riwayat));
}

function tambahEntriRiwayat() {
  if (!latestHasil) {
    alert("Belum ada data hasil pengukuran dari alat untuk disimpan.");
    return;
  }

  const riwayat = bacaRiwayat();

  riwayat.push({
    waktu: new Date().toISOString(),
    sistolik: latestHasil.sistolik ?? "",
    diastolik: latestHasil.diastolik ?? "",
    map: latestHasil.map ?? "",
    bpm: (latestBpmRealtime ?? latestHasil.bpm) ?? "",
    spo2: (latestSpo2Realtime ?? latestHasil.spo2) ?? "",
    status: latestHasil.status ?? "",
    mode: latestHasil.mode ?? ""
  });

  simpanRiwayat(riwayat);
  renderRiwayat();
}

function renderRiwayat() {
  const riwayat = bacaRiwayat();
  const tbody = document.getElementById("riwayatBody");

  if (riwayat.length === 0) {
    tbody.innerHTML = `<tr class="riwayat-empty"><td colspan="8">Belum ada riwayat tersimpan.</td></tr>`;
    return;
  }

  // tampilkan terbaru di atas
  const urutTerbaru = [...riwayat].reverse();

  tbody.innerHTML = urutTerbaru.map(row => {
    const waktu = new Date(row.waktu).toLocaleString("id-ID");
    return `
      <tr>
        <td>${waktu}</td>
        <td>${row.sistolik}</td>
        <td>${row.diastolik}</td>
        <td>${row.map}</td>
        <td>${row.bpm}</td>
        <td>${row.spo2}</td>
        <td>${row.status}</td>
        <td>${row.mode}</td>
      </tr>
    `;
  }).join("");
}

// timer auto-save tiap 30 menit
setInterval(() => {
  tambahEntriRiwayat();
  nextAutoSaveAt = Date.now() + AUTO_SAVE_INTERVAL_MS;
}, AUTO_SAVE_INTERVAL_MS);

document.getElementById("simpanSekarangBtn").addEventListener("click", tambahEntriRiwayat);

renderRiwayat();

// =====================================================================
// 7. DOWNLOAD CSV
// =====================================================================
function downloadCSV() {
  const riwayat = bacaRiwayat();

  if (riwayat.length === 0) {
    alert("Belum ada riwayat untuk diunduh.");
    return;
  }

  const header = ["Waktu", "Sistolik(mmHg)", "Diastolik(mmHg)", "MAP(mmHg)", "BPM", "SpO2(%)", "Status", "Mode"];

  const rows = riwayat.map(r => [
    new Date(r.waktu).toLocaleString("id-ID"),
    r.sistolik, r.diastolik, r.map, r.bpm, r.spo2, r.status, r.mode
  ]);

  let csvContent = header.join(",") + "\n";
  rows.forEach(r => {
    csvContent += r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",") + "\n";
  });

  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  const namaFile = `riwayat_pasien_monitor_${new Date().toISOString().slice(0,19).replace(/[:T]/g,"-")}.csv`;

  a.href = url;
  a.download = namaFile;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

document.getElementById("downloadBtn").addEventListener("click", downloadCSV);
