// =====================================================================
// DASHBOARD - BEDSIDE PATIENT MONITOR
// =====================================================================
// Struktur data di Firebase Realtime Database (harus sama dengan kode ESP32):
//
//   /realtime/bpm              -> angka BPM live (ditimpa tiap 2 detik)
//   /realtime/spo2             -> angka SpO2 live (ditimpa tiap 2 detik)
//   /monitor/hasil             -> hasil tekanan darah TERAKHIR (ditimpa)
//   /history/tekanan/{id}      -> RIWAYAT tiap hasil pengukuran tekanan
//                                  darah (baris baru setiap alat selesai
//                                  mengukur, mode Manual maupun Otomatis)
//   /history/vitals/{id}       -> RIWAYAT setiap kali BPM/SpO2 BERUBAH
// =====================================================================

const HISTORY_LIMIT = 500; // batas jumlah baris riwayat yang diambil per tabel

let latestHasil = null;      // data terakhir dari /monitor/hasil
let latestBpmRealtime = null;
let latestSpo2Realtime = null;

let riwayatTekananCache = []; // cache lokal dari /history/tekanan
let riwayatVitalsCache = [];  // cache lokal dari /history/vitals

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
}
setInterval(updateJam, 1000);
updateJam();

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
// 4. LISTENER REALTIME (ANGKA LIVE): BPM & SpO2
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
    "Update: " + formatWaktu(data.waktu);
});

// =====================================================================
// 6. FORMAT WAKTU
//    data.waktu dikirim ESP32 sebagai timestamp SERVER Firebase (ms).
//    Kalau belum ada (mis. baris lama / disimpan manual dari browser),
//    fallback ke waktu saat ini.
// =====================================================================
function formatWaktu(waktuMs) {
  const tgl = (typeof waktuMs === "number") ? new Date(waktuMs) : new Date();
  return tgl.toLocaleString("id-ID");
}

// =====================================================================
// 7. RIWAYAT TEKANAN DARAH (dari /history/tekanan, dikirim langsung oleh alat)
// =====================================================================
db.ref("history/tekanan").limitToLast(HISTORY_LIMIT).on("child_added", (snap) => {
  const data = snap.val();
  if (!data) return;

  riwayatTekananCache.push({ id: snap.key, ...data });
  renderRiwayatTekanan();
});

function renderRiwayatTekanan() {
  const tbody = document.getElementById("riwayatBody");
  if (riwayatTekananCache.length === 0) {
    tbody.innerHTML = `<tr class="riwayat-empty"><td colspan="8">Belum ada riwayat tersimpan.</td></tr>`;
    return;
  }

  // terbaru di atas; urutkan berdasar waktu server kalau ada
  const urut = [...riwayatTekananCache].sort((a, b) => (b.waktu || 0) - (a.waktu || 0));

  tbody.innerHTML = urut.map(row => `
    <tr>
      <td>${formatWaktu(row.waktu)}</td>
      <td>${row.sistolik ?? "-"}</td>
      <td>${row.diastolik ?? "-"}</td>
      <td>${typeof row.map === "number" ? row.map.toFixed(1) : (row.map ?? "-")}</td>
      <td>${row.bpm ?? "-"}</td>
      <td>${row.spo2 ?? "-"}</td>
      <td>${row.status ?? "-"}</td>
      <td>${row.mode ?? "-"}</td>
    </tr>
  `).join("");
}

// =====================================================================
// 8. RIWAYAT BPM & SpO2 (dari /history/vitals, hanya saat nilai berubah)
// =====================================================================
db.ref("history/vitals").limitToLast(HISTORY_LIMIT).on("child_added", (snap) => {
  const data = snap.val();
  if (!data) return;

  riwayatVitalsCache.push({ id: snap.key, ...data });
  renderRiwayatVitals();
});

function renderRiwayatVitals() {
  const tbody = document.getElementById("riwayatVitalsBody");
  if (riwayatVitalsCache.length === 0) {
    tbody.innerHTML = `<tr class="riwayat-empty"><td colspan="4">Belum ada perubahan BPM/SpO2 tersimpan.</td></tr>`;
    return;
  }

  const urut = [...riwayatVitalsCache].sort((a, b) => (b.waktu || 0) - (a.waktu || 0));

  tbody.innerHTML = urut.map(row => `
    <tr>
      <td>${formatWaktu(row.waktu)}</td>
      <td>${row.bpm ?? "-"}</td>
      <td>${row.spo2 ?? "-"}</td>
      <td>${row.mode ?? "-"}</td>
    </tr>
  `).join("");
}

// =====================================================================
// 9. "SIMPAN NILAI SAAT INI" - simpan manual dari browser
//    (cadangan; alat sudah otomatis mengirim tiap hasil ukur & tiap
//    perubahan BPM/SpO2, jadi tombol ini opsional untuk snapshot manual)
// =====================================================================
document.getElementById("simpanSekarangBtn").addEventListener("click", () => {
  if (!latestHasil) {
    alert("Belum ada data hasil pengukuran dari alat untuk disimpan.");
    return;
  }

  const dataUntukDisimpan = {
    sistolik: latestHasil.sistolik ?? "",
    diastolik: latestHasil.diastolik ?? "",
    map: latestHasil.map ?? "",
    bpm: (latestBpmRealtime ?? latestHasil.bpm) ?? "",
    spo2: (latestSpo2Realtime ?? latestHasil.spo2) ?? "",
    status: latestHasil.status ?? "",
    mode: latestHasil.mode ?? "",
    waktu: firebase.database.ServerValue.TIMESTAMP
  };

  db.ref("history/tekanan").push(dataUntukDisimpan)
    .then(() => {
      alert("Nilai saat ini berhasil disimpan ke riwayat.");
    })
    .catch((err) => {
      alert("Gagal menyimpan: " + err.message);
    });
});

// =====================================================================
// 10. DOWNLOAD CSV
// =====================================================================
function triggerCSVDownload(header, rows, namaDasar) {
  let csvContent = header.join(",") + "\n";
  rows.forEach(r => {
    csvContent += r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",") + "\n";
  });

  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  const namaFile = `${namaDasar}_${new Date().toISOString().slice(0,19).replace(/[:T]/g,"-")}.csv`;

  a.href = url;
  a.download = namaFile;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

document.getElementById("downloadTekananBtn").addEventListener("click", () => {
  if (riwayatTekananCache.length === 0) {
    alert("Belum ada riwayat tekanan darah untuk diunduh.");
    return;
  }

  const urut = [...riwayatTekananCache].sort((a, b) => (b.waktu || 0) - (a.waktu || 0));
  const header = ["Waktu", "Sistolik(mmHg)", "Diastolik(mmHg)", "MAP(mmHg)", "BPM", "SpO2(%)", "Status", "Mode"];
  const rows = urut.map(r => [
    formatWaktu(r.waktu), r.sistolik, r.diastolik, r.map, r.bpm, r.spo2, r.status, r.mode
  ]);

  triggerCSVDownload(header, rows, "riwayat_tekanan_darah");
});

document.getElementById("downloadVitalsBtn").addEventListener("click", () => {
  if (riwayatVitalsCache.length === 0) {
    alert("Belum ada riwayat BPM/SpO2 untuk diunduh.");
    return;
  }

  const urut = [...riwayatVitalsCache].sort((a, b) => (b.waktu || 0) - (a.waktu || 0));
  const header = ["Waktu", "BPM", "SpO2(%)", "Mode"];
  const rows = urut.map(r => [formatWaktu(r.waktu), r.bpm, r.spo2, r.mode]);

  triggerCSVDownload(header, rows, "riwayat_bpm_spo2");
});
