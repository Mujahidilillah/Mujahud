// =====================================================================
// LOGIN
// =====================================================================

// Jika user sudah login sebelumnya, langsung lempar ke dashboard
auth.onAuthStateChanged((user) => {
  if (user) {
    window.location.href = "dashboard.html";
  }
});

const loginForm = document.getElementById("loginForm");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");

loginForm.addEventListener("submit", (e) => {
  e.preventDefault();

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  loginError.textContent = "";
  loginBtn.disabled = true;
  loginBtn.textContent = "MEMPROSES...";

  auth.signInWithEmailAndPassword(email, password)
    .then(() => {
      window.location.href = "dashboard.html";
    })
    .catch((error) => {
      loginBtn.disabled = false;
      loginBtn.textContent = "MASUK";

      let pesan = "Login gagal. Periksa kembali email/password Anda.";

      switch (error.code) {
        case "auth/invalid-email":
          pesan = "Format email tidak valid.";
          break;
        case "auth/user-not-found":
          pesan = "Akun tidak ditemukan. Buat akun ini dulu di Firebase Console -> Authentication.";
          break;
        case "auth/wrong-password":
        case "auth/invalid-credential":
          pesan = "Email atau password salah.";
          break;
        case "auth/too-many-requests":
          pesan = "Terlalu banyak percobaan gagal. Coba lagi beberapa saat.";
          break;
      }

      loginError.textContent = pesan;
    });
});
