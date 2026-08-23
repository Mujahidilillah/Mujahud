// =====================================================================
// AUTH.JS — Login page logic + deteksi DEMO MODE
// =====================================================================

const IS_DEMO_MODE =
  typeof FORCE_DEMO_MODE !== "undefined" && FORCE_DEMO_MODE
    ? true
    : !firebaseConfig || firebaseConfig.apiKey === "YOUR_API_KEY";

// Simpan status demo mode supaya dashboard.js bisa membacanya
try { sessionStorage.setItem("pm_demo_mode", IS_DEMO_MODE ? "1" : "0"); } catch (e) {}

if (!IS_DEMO_MODE) {
  firebase.initializeApp(firebaseConfig);
}

const demoBadge = document.getElementById("demoBadge");
if (demoBadge && IS_DEMO_MODE) demoBadge.style.display = "block";

const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const loginBtn = document.getElementById("loginBtn");

function showLoginError(msg) {
  loginError.textContent = msg;
  loginError.style.display = "block";
}

if (loginForm) {
  // Kalau sudah login (Firebase mode), langsung lempar ke dashboard
  if (!IS_DEMO_MODE) {
    firebase.auth().onAuthStateChanged((user) => {
      if (user) window.location.href = "dashboard.html";
    });
  }

  loginForm.addEventListener("submit", function (e) {
    e.preventDefault();
    loginError.style.display = "none";

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;

    loginBtn.disabled = true;
    loginBtn.textContent = "Memproses...";

    if (IS_DEMO_MODE) {
      // Demo mode: terima kredensial apa saja, tidak ada koneksi ke server
      try {
        sessionStorage.setItem("pm_user_email", email || "demo@pasienmonitor.local");
        sessionStorage.setItem("pm_logged_in", "1");
      } catch (e) {}
      window.location.href = "dashboard.html";
      return;
    }

    firebase.auth().signInWithEmailAndPassword(email, password)
      .then(() => {
        window.location.href = "dashboard.html";
      })
      .catch((err) => {
        loginBtn.disabled = false;
        loginBtn.textContent = "Masuk";

        let pesan = "Gagal masuk. Periksa kembali email dan kata sandi.";
        if (err.code === "auth/user-not-found") pesan = "Akun tidak ditemukan.";
        else if (err.code === "auth/wrong-password") pesan = "Kata sandi salah.";
        else if (err.code === "auth/invalid-email") pesan = "Format email tidak valid.";
        else if (err.code === "auth/too-many-requests") pesan = "Terlalu banyak percobaan. Coba lagi nanti.";

        showLoginError(pesan);
      });
  });
}
