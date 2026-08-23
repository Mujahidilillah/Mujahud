// =====================================================
// LOGIN — index.html
// =====================================================

const auth = firebase.auth();

// Jika sudah login sebelumnya, langsung lempar ke dashboard
auth.onAuthStateChanged((user) => {
  if (user) {
    window.location.replace("dashboard.html");
  }
});

const loginForm = document.getElementById("loginForm");
const loginBtn = document.getElementById("loginBtn");
const loginBtnText = document.getElementById("loginBtnText");
const loginError = document.getElementById("loginError");

function showError(message) {
  loginError.textContent = message;
  loginError.hidden = false;
}

function clearError() {
  loginError.hidden = true;
  loginError.textContent = "";
}

function mapAuthError(error) {
  switch (error.code) {
    case "auth/invalid-email":
      return "Format email tidak valid.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Email atau kata sandi salah.";
    case "auth/too-many-requests":
      return "Terlalu banyak percobaan. Coba lagi beberapa saat lagi.";
    case "auth/network-request-failed":
      return "Tidak ada koneksi internet.";
    default:
      return "Gagal masuk: " + error.message;
  }
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  loginBtn.disabled = true;
  loginBtnText.textContent = "Memeriksa…";

  try {
    await auth.signInWithEmailAndPassword(email, password);
    window.location.replace("dashboard.html");
  } catch (error) {
    showError(mapAuthError(error));
    loginBtn.disabled = false;
    loginBtnText.textContent = "Masuk";
  }
});
