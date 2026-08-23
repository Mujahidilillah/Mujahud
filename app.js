import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getDatabase, ref, onValue } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-database.js";

// Konfigurasi ini mengikuti proyek Firebase pada coding ESP32.
// Untuk keamanan produksi, aturan Firebase harus membatasi akses sesuai akun.
const firebaseConfig = {
  apiKey: "AIzaBvA0MXGo2uSG3zt0aHGGTAsej1iJ7ZWdM",
  authDomain: "bedside-monitor-iot.firebaseapp.com",
  databaseURL: "https://bedside-monitor-iot-default-rtdb.firebaseio.com",
  projectId: "bedside-monitor-iot",
  storageBucket: "bedside-monitor-iot.firebasestorage.app",
  ...
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const $ = id => document.getElementById(id);
let history = JSON.parse(localStorage.getItem("bedsideHistory") || "[]");

function clock(){
  $("clock").textContent = new Intl.DateTimeFormat("id-ID",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date());
}
setInterval(clock,1000); clock();

$("loginForm").addEventListener("submit", async e=>{
  e.preventDefault();
  $("loginError").textContent = "";
  try { await signInWithEmailAndPassword(auth,$("email").value,$("password").value); }
  catch(err){ $("loginError").textContent = "Login gagal: " + (err.code?.replace("auth/","") || err.message); }
});
$("logoutBtn").onclick=()=>signOut(auth);
$("clearHistory").onclick=()=>{if(confirm("Hapus riwayat pengukuran yang tersimpan di browser?")){history=[];localStorage.removeItem("bedsideHistory");renderHistory();}};

onAuthStateChanged(auth,user=>{
  $("loginPage").classList.toggle("hidden",!!user);
  $("dashboardPage").classList.toggle("hidden",!user);
  if(user) startFirebase();
});

function startFirebase(){
  $("connectionText").textContent="Firebase aktif";
  onValue(ref(db,"/monitor"), snap=>{
    const d=snap.val()||{};
    setText("sys",num(d.sistolik)); setText("dia",num(d.diastolik)); setText("map",num(d.map));
    setText("bpm",num(d.bpm)); setText("spo2",num(d.spo2));
    $("lastUpdate").textContent = d.timestamp && !isNaN(Number(d.timestamp)) ? "Update diterima" : "Data terbaru";
    updateStatus(d.sistolik,d.diastolik);
    if(d.timestamp && Number(d.timestamp)!==0) addMeasurement(d);
  });
  onValue(ref(db,"/realtime"), snap=>{
    const d=snap.val()||{}; setText("rtBpm",num(d.bpm)); setText("rtSpo2",num(d.spo2));
  });
}

function num(v){ return v===undefined||v===null||v==="" ? "--" : Number(v); }
function setText(id,v){ $(id).textContent=v; }

let lastSavedSignature="";
function addMeasurement(d){
  const sig=[d.timestamp,d.sistolik,d.diastolik,d.map,d.bpm,d.spo2].join("|");
  if(sig===lastSavedSignature) return;
  // timestamp pada firmware saat ini adalah millis(); jadi waktu riwayat memakai waktu browser.
  lastSavedSignature=sig;
  const item={time:new Date().toISOString(),sys:num(d.sistolik),dia:num(d.diastolik),map:num(d.map),bpm:num(d.bpm),spo2:num(d.spo2),status:statusText(d.sistolik,d.diastolik)};
  const old=history[0];
  // Simpan hasil baru saja; tidak membuat data palsu setiap 30 menit.
  if(!old || JSON.stringify(old)!==JSON.stringify(item)){
    history.unshift(item); history=history.slice(0,500);
    localStorage.setItem("bedsideHistory",JSON.stringify(history)); renderHistory();
  }
}

function statusText(sys,dia){
  if(Number(sys)>=140 || Number(dia)>=90) return "TINGGI";
  if(Number(sys)<90 || Number(dia)<60) return "RENDAH";
  return "NORMAL";
}
function updateStatus(sys,dia){
  const el=$("patientStatus"); const s=statusText(sys,dia);
  el.textContent=s; el.className=s==="NORMAL"?"good":s==="TINGGI"?"high":"low";
}
function renderHistory(){
  const body=$("historyBody");
  if(!history.length){body.innerHTML='<tr><td colspan="7" class="empty">Menunggu pengukuran...</td></tr>';return;}
  body.innerHTML=history.map(x=>`<tr><td>${new Date(x.time).toLocaleString("id-ID")}</td><td>${x.sys}</td><td>${x.dia}</td><td>${x.map}</td><td>${x.bpm}</td><td>${x.spo2}</td><td>${x.status}</td></tr>`).join("");
}
renderHistory();

$("downloadBtn").onclick=()=>{
  const rows=[["Waktu","Sistolik (mmHg)","Diastolik (mmHg)","MAP (mmHg)","BPM","SpO2 (%)","Status"]];
  history.slice().reverse().forEach(x=>rows.push([new Date(x.time).toLocaleString("id-ID"),x.sys,x.dia,x.map,x.bpm,x.spo2,x.status]));
  const csv=rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");
  const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="bedside-monitor-"+new Date().toISOString().slice(0,10)+".csv"; a.click(); URL.revokeObjectURL(a.href);
};
