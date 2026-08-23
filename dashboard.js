// =====================================================
// DASHBOARD — dashboard.html
// =====================================================

const auth = firebase.auth();
const db = firebase.database();

const AUTO_SAVE_INTERVAL_MS = 30 * 60 * 1000; // 30 menit
const STALE_AFTER_MS = 10 * 1000;             // dianggap "offline" jika >10 detik tidak ada update

let latestReading = null;   // { sistolik, diastolik, map, bpm, spo2 }
let lastUpdateAt = 0;
let autoSaveTimer = null;

// ---------- 1. Jaga akses: harus login ----------
auth.onAuthStateChanged((user) => {
  if (!user) {
    window.location.replace("index.html");
    return;
  }
  initDashboard();
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  auth.signOut().then(() => window.location.replace("index.html"));
});

// ---------- 2. Jam real-time ----------
function tickClock() {
  const now = new Date();

  const time = now.toLocaleTimeString("id-ID", { hour12: false });
  const date = now.toLocaleDateString("id-ID", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  });

  document.getElementById("clockTime").textContent = time;
  document.getElementById("clockDate").textContent = date;

  // Tandai offline jika lama tidak ada data baru dari alat
  updateConnectionFreshness();
}
setInterval(tickClock, 1000);
tickClock();

// ---------- 3. Status koneksi Firebase ----------
const connDot = document.getElementById("connDot");
const connLabel = document.getElementById("connLabel");

db.ref(".info/connected").on("value", (snap) => {
  const connected = snap.val() === true;
  if (!connected) {
    connDot.className = "conn-dot offline";
    connLabel.textContent = "Firebase terputus";
  } else {
    updateConnectionFreshness();
  }
});

function updateConnectionFreshness() {
  if (!db.ref(".info/connected")) return;
  const staleMs = Date.now() - lastUpdateAt;

  if (lastUpdateAt === 0) {
    connDot.className = "conn-dot";
    connLabel.textContent = "Menunggu data alat…";
  } else if (staleMs > STALE_AFTER_MS) {
    connDot.className = "conn-dot offline";
    connLabel.textContent = "Alat tidak merespons";
  } else {
    connDot.className = "conn-dot online";
    connLabel.textContent = "Alat tersambung";
  }
}

// ---------- 4. Data vital real-time dari /monitor ----------
function renderVitals(data) {
  const sistolik = Number(data.sistolik ?? 0);
  const diastolik = Number(data.diastolik ?? 0);
  const map = Number(data.map ?? 0);
  const bpm = Number(data.bpm ?? 0);
  const spo2 = Number(data.spo2 ?? 0);

  document.getElementById("valSistolik").textContent = sistolik || "--";
  document.getElementById("valDiastolik").textContent = diastolik || "--";
  document.getElementById("valMap").textContent = map || "--";
  document.getElementById("valBpm").textContent = bpm || "--";
  document.getElementById("valSpo2").textContent = spo2 || "--";

  const badge = document.getElementById("statusBadge");

  if (!sistolik && !diastolik) {
    badge.textContent = "MENUNGGU DATA";
    badge.className = "status-badge";
  } else if (sistolik >= 140 || diastolik >= 90) {
    badge.textContent = "TINGGI";
    badge.className = "status-badge tinggi";
  } else if (sistolik < 90 || diastolik < 60) {
    badge.textContent = "RENDAH";
    badge.className = "status-badge rendah";
  } else {
    badge.textContent = "NORMAL";
    badge.className = "status-badge normal";
  }

  latestReading = { sistolik, diastolik, map, bpm, spo2 };
  lastUpdateAt = Date.now();
  updateConnectionFreshness();
}

function initDashboard() {
  db.ref("monitor").on("value", (snap) => {
    const data = snap.val();
    if (data) renderVitals(data);
  });

  listenHistory();
  scheduleAutoSave();
}

// ---------- 5. Riwayat pengukuran (/history) ----------
const historyBody = document.getElementById("historyBody");
const autoSaveInfo = document.getElementById("autoSaveInfo");

function formatWaktu(ts) {
  return new Date(ts).toLocaleString("id-ID", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  });
}

function listenHistory() {
  db.ref("history").limitToLast(100).on("value", (snap) => {
    const rows = [];
    snap.forEach((child) => {
      rows.push(child.val());
    });
    rows.sort((a, b) => b.ts - a.ts); // terbaru dulu
    renderHistoryTable(rows);

    if (rows.length > 0) {
      autoSaveInfo.textContent =
        `Tersimpan otomatis setiap 30 menit · terakhir disimpan ${formatWaktu(rows[0].ts)}`;
    }
  });
}

function renderHistoryTable(rows) {
  if (rows.length === 0) {
    historyBody.innerHTML = `<tr class="empty-row"><td colspan="6">Belum ada riwayat tersimpan.</td></tr>`;
    return;
  }

  historyBody.innerHTML = rows.map((r) => `
    <tr>
      <td>${formatWaktu(r.ts)}</td>
      <td>${r.sistolik ?? "-"}</td>
      <td>${r.diastolik ?? "-"}</td>
      <td>${r.map ?? "-"}</td>
      <td>${r.bpm ?? "-"}</td>
      <td>${r.spo2 ?? "-"}</td>
    </tr>
  `).join("");
}

// ---------- 6. Simpan snapshot ke /history ----------
function saveSnapshot() {
  if (!latestReading) return; // belum ada data dari alat

  const record = {
    ts: Date.now(),
    ...latestReading
  };

  db.ref("history").push(record);
}

function scheduleAutoSave() {
  if (autoSaveTimer) clearInterval(autoSaveTimer);
  autoSaveTimer = setInterval(saveSnapshot, AUTO_SAVE_INTERVAL_MS);
}

document.getElementById("logNowBtn").addEventListener("click", () => {
  if (!latestReading) {
    alert("Belum ada data dari alat untuk dicatat.");
    return;
  }
  saveSnapshot();
});

// ---------- 7. Unduh seluruh riwayat sebagai CSV ----------
document.getElementById("downloadBtn").addEventListener("click", async () => {
  const btn = document.getElementById("downloadBtn");
  const originalText = btn.textContent;
  btn.textContent = "Menyiapkan…";
  btn.disabled = true;

  try {
    const snap = await db.ref("history").once("value");
    const rows = [];
    snap.forEach((child) => rows.push(child.val()));
    rows.sort((a, b) => a.ts - b.ts);

    if (rows.length === 0) {
      alert("Belum ada data riwayat untuk diunduh.");
      return;
    }

    const header = ["Waktu", "SYS (mmHg)", "DIA (mmHg)", "MAP (mmHg)", "BPM", "SpO2 (%)"];
    const lines = [header.join(",")];

    rows.forEach((r) => {
      lines.push([
        formatWaktu(r.ts),
        r.sistolik ?? "",
        r.diastolik ?? "",
        r.map ?? "",
        r.bpm ?? "",
        r.spo2 ?? ""
      ].join(","));
    });

    const csvContent = "\uFEFF" + lines.join("\r\n"); // BOM agar Excel baca UTF-8 dengan benar
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const a = document.createElement("a");
    a.href = url;
    a.download = `riwayat-bedside-monitor-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

  } catch (err) {
    alert("Gagal mengunduh data: " + err.message);
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
});
