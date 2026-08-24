// =====================================================================
// ============  MONITOR PASIEN (TENSI + BPM + SPO2) + FIREBASE  =======
// =====================================================================
// CATATAN PENTING SEBELUM UPLOAD:
// 1. Install library "Firebase Arduino Client Library for ESP8266 and ESP32"
//    (karya Mobizt) lewat Arduino IDE -> Tools -> Manage Libraries -> cari
//    "Firebase ESP Client".
// 2. Isi WIFI_SSID dan WIFI_PASSWORD di bawah ini dengan WiFi Anda.
// 3. Isi USER_PASSWORD dengan password akun Firebase Authentication untuk
//    email mujigandrung@gmail.com (harus akun Email/Password yang SUDAH
//    dibuat di Firebase Console -> Authentication -> Sign-in method ->
//    Email/Password -> Add user). apiKey saja TIDAK cukup untuk login.
// 4. Pastikan Realtime Database Rules di Firebase Console mengizinkan
//    tulis dari user yang login, contoh minimal:
//      {
//        "rules": { ".read": "auth != null", ".write": "auth != null" }
//      }
//
// =====================================================================
// PERUBAHAN PADA VERSI INI (mengikuti permintaan dashboard):
// - Setiap hasil pengukuran tekanan darah (baik mode MANUAL maupun
//   OTOMATIS) sekarang disimpan sebagai satu baris riwayat baru di
//   "/history/tekanan" (selain tetap update "/monitor/hasil" seperti
//   sebelumnya untuk kartu "hasil terakhir" di dashboard).
// - BPM & SpO2 tetap dikirim tiap 2 detik ke "/realtime/bpm" dan
//   "/realtime/spo2" (untuk angka live di dashboard), TAPI riwayatnya
//   di "/history/vitals" HANYA ditambah kalau nilainya BERUBAH dari
//   pengiriman sebelumnya (supaya tidak membanjiri database dengan
//   angka yang sama berulang-ulang).
// - Interval pengukuran otomatis (mode OTOMATIS) diubah dari 2 menit
//   menjadi 30 menit (AUTO_INTERVAL).
// =====================================================================

#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"

#include <Wire.h>
#include <Adafruit_FT6206.h>
#include <SPI.h>
#include <TFT_eSPI.h>

#include "MAX30105.h"
#include "spo2_algorithm.h"

// =====================================================================
// ======================  ISI BAGIAN INI  ==============================
// =====================================================================
#define WIFI_SSID     "WiFi Gratis"
#define WIFI_PASSWORD "11111111"

#define API_KEY       "AIzaSyBvA0MXGo2uSG3zt0aHGGTAsej1iJ7ZWdM"
#define DATABASE_URL  "https://bedside-monitor-iot-default-rtdb.firebaseio.com"

#define USER_EMAIL    "muji12@gmail.com"
#define USER_PASSWORD "123654"
// =====================================================================

FirebaseData   fbdo;
FirebaseAuth   auth;
FirebaseConfig config;

void connectFirebase()
{
    config.api_key = API_KEY;
    config.database_url = DATABASE_URL;

    auth.user.email = USER_EMAIL;
    auth.user.password = USER_PASSWORD;

    config.token_status_callback = tokenStatusCallback;

    Firebase.begin(&config, &auth);
    Firebase.reconnectWiFi(true);
}


bool firebaseSiap = false;
unsigned long lastFirebaseRealtimeSend = 0;
const unsigned long FIREBASE_REALTIME_INTERVAL = 2000; // kirim BPM/SpO2 tiap 2 detik

// ---- Menyimpan nilai BPM/SpO2 TERAKHIR YANG SUDAH DIKIRIM ke riwayat,
//      supaya riwayat hanya bertambah saat nilainya benar-benar berubah ----
int32_t lastSentBpmHistory  = -1;
int32_t lastSentSpo2History = -1;

//================ MAX30102 =================
MAX30105 particleSensor;

const byte bufferLength = 100;

uint32_t irBuffer[bufferLength];
uint32_t redBuffer[bufferLength];

int32_t spo2;
int8_t validSPO2;

// ---- Variabel BPM yang ditampilkan ke layar ----
// (sekarang diisi oleh algoritma deteksi puncak real-time, BUKAN oleh maxim_...)
int32_t heartRate = 0;
int8_t validHeartRate = 0;

// ---- Variabel keluaran algoritma maxim_..., hanya dipakai untuk SpO2 ----
int32_t maximHeartRate;
int8_t maximValidHeartRate;

long irValue = 0;
long redValue = 0;
unsigned long lastMAXRead = 0;

#define SPO2_BUFFER 100
int spo2Index = 0;

unsigned long lastMAX = 0;


// =====================================================================
// ===================== PARAMETER DETEKSI BPM ==========================
// =====================================================================

#define IR_FINGER_THRESHOLD   50000UL
#define BEAT_REFRACTORY_MS    300
#define BEAT_MIN_INTERVAL_MS  300
#define BEAT_MAX_INTERVAL_MS  2000
#define BPM_AVG_COUNT         4

float irDCFiltered = 0;
float irACFiltered = 0;
bool  irWasNegative = false;

unsigned long lastIrBeatMillis = 0;

float bpmIntervalBuf[BPM_AVG_COUNT];
int bpmBufIndex = 0;
int bpmBufFilled = 0;

bool fingerDetected = false;


TFT_eSPI tft = TFT_eSPI();
Adafruit_FT6206 touch = Adafruit_FT6206();
TwoWire WireMAX   = TwoWire(1);   // MAX30102

#define DOUT 32
#define SCK  33
#define POMPA 25
#define VALVE 26
#define TOMBOL 13
bool mulai = false;
bool homeShown = false;
bool redrawHome = true;
bool redrawInflate = true;
bool redrawMeasure = true;
bool redrawResult = true;
bool diHalamanHasil = false;
enum ModeAlat {
  PILIH_MODE,
  MODE_MANUAL,
  MODE_OTOMATIS
};

ModeAlat modeAlat = PILIH_MODE;

bool redrawMode = true;
bool modeOtomatis = false;   // false = Manual, true = Otomatis
bool halamanPilihMode = true;
unsigned long lastAutoStart = 0;

// ---- INTERVAL PENGUKURAN OTOMATIS: DIUBAH JADI 30 MENIT ----
const unsigned long AUTO_INTERVAL = 1800000UL;   // 30 menit (30 * 60 * 1000 ms)

#define TARGET_PRESSURE   160
#define MAX_PRESSURE      200
#define FILTER_SIZE       7
#define MAX_DATA          300


float tekanan, baseline, lastTekanan;
float osc = 0;
float amplitudePeak = 0, mapValue = 0;
float sistolik = 0, diastolik = 0;

float pressureData[MAX_DATA];
float oscData[MAX_DATA];
int dataCount = 0;

float osilasiRata = 0;

unsigned long lastBeatTime = 0;
unsigned long beatIntervals[20];
int beatIndex = 0;


unsigned long lastBeatMillis = 0;

float lastPressureControl = 0;
unsigned long lastTimeControl = 0;
void clearLeftPanel();
void tampilPilihMode();
void tampilHome();
void tampilInflate(float p);
void tampilMeasure(float p);
void tampilHasil();
void drawLayout();
void updateMonitor();
void cekTouchMode();
void cekBackOtomatisHeader();
void connectWiFi();
void connectFirebase();
void kirimDataHasil();
void kirimDataRealtime();

float peakVals[10] = {0};
float peakPress[10] = {0};

// =====================================================================
// ========================  FIREBASE  ==================================
// =====================================================================

void connectWiFi()
{
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.print("Menghubungkan ke WiFi");

    unsigned long startAttempt = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 15000)
    {
        delay(300);
        Serial.print(".");
    }

    if (WiFi.status() == WL_CONNECTED)
    {
        Serial.println();
        Serial.print("WiFi Tersambung, IP: ");
        Serial.println(WiFi.localIP());
    }
    else
    {
        Serial.println();
        Serial.println("WiFi GAGAL tersambung (alat tetap jalan tanpa Firebase)");
    }
}


// =====================================================================
// Kirim hasil akhir pengukuran (SYS/DIA/MAP/BPM/SpO2/status) ke Firebase
// - "/monitor/hasil"   -> DITIMPA tiap kali (nilai TERAKHIR saja, untuk
//                         kartu "Hasil Pengukuran Terakhir" di dashboard)
// - "/history/tekanan" -> DITAMBAH sebagai baris baru tiap kali (riwayat
//                         lengkap semua pengukuran, untuk tabel riwayat
//                         + tombol Download CSV di dashboard)
// Dipanggil untuk MODE MANUAL maupun MODE OTOMATIS, jadi kedua mode
// otomatis tersimpan riwayatnya.
// =====================================================================
void kirimDataHasil()
{
    if (!firebaseSiap || !Firebase.ready())
        return;

    FirebaseJson json;
    json.set("sistolik", sistolik);
    json.set("diastolik", diastolik);
    json.set("map", mapValue);
    json.set("bpm", validHeartRate ? heartRate : 0);
    json.set("spo2", validSPO2 ? spo2 : 0);

    String status = "NORMAL";
    if (sistolik >= 140 || diastolik >= 90)
        status = "TINGGI";
    else if (sistolik < 90 || diastolik < 60)
        status = "RENDAH";
    json.set("status", status);

    json.set("mode", modeOtomatis ? "OTOMATIS" : "MANUAL");
    json.set("timestamp_millis", (double)millis());

    // Tambahkan timestamp SERVER Firebase (bukan timestamp ESP32) supaya
    // waktunya akurat & konsisten walau ESP32 tidak tahu jam sebenarnya.
    json.set("waktu/.sv", "timestamp");

    // ---- 1) Update nilai TERAKHIR (ditimpa) ----
    if (Firebase.RTDB.setJSON(&fbdo, "/monitor/hasil", &json))
    {
        Serial.println("Data hasil terkirim ke Firebase (/monitor/hasil)");
    }
    else
    {
        Serial.print("Gagal kirim hasil ke Firebase: ");
        Serial.println(fbdo.errorReason());
    }

    // ---- 2) Simpan sebagai baris RIWAYAT baru (tidak ditimpa) ----
    if (Firebase.RTDB.pushJSON(&fbdo, "/history/tekanan", &json))
    {
        Serial.println("Hasil pengukuran disimpan ke riwayat (/history/tekanan)");
    }
    else
    {
        Serial.print("Gagal simpan riwayat tekanan: ");
        Serial.println(fbdo.errorReason());
    }
}


// =====================================================================
// Kirim BPM/SpO2 real-time secara berkala selama jari terdeteksi
// - "/realtime/bpm" & "/realtime/spo2" -> DITIMPA tiap 2 detik (untuk
//   angka LIVE yang selalu update di dashboard)
// - "/history/vitals" -> DITAMBAH sebagai baris baru HANYA KETIKA nilai
//   BPM atau SpO2 BERUBAH dari yang terakhir dikirim (supaya riwayat
//   tidak dibanjiri angka yang sama berulang-ulang tiap 2 detik)
// =====================================================================
void kirimDataRealtime()
{
    if (!firebaseSiap)
        return;

    if (WiFi.status() != WL_CONNECTED)
        return;

    if (!Firebase.ready())
        return;

    // Kirim data setiap 2 detik
    if (millis() - lastFirebaseRealtimeSend < FIREBASE_REALTIME_INTERVAL)
        return;

    lastFirebaseRealtimeSend = millis();

    // Jangan kirim BPM/SpO2 jika jari tidak terdeteksi
    if (!fingerDetected)
    {
        return;
    }

    int bpmSekarang  = validHeartRate ? heartRate : 0;
    int spo2Sekarang = validSPO2 ? spo2 : 0;

    // =========================
    // 1) UPDATE NILAI LIVE (selalu, ditimpa)
    // =========================
    Firebase.RTDB.setInt(&fbdo, "/realtime/bpm", bpmSekarang);
    Firebase.RTDB.setInt(&fbdo, "/realtime/spo2", spo2Sekarang);

    // =========================
    // 2) SIMPAN KE RIWAYAT HANYA KALAU ADA PERUBAHAN NILAI
    // =========================
    bool adaPerubahan = (bpmSekarang != lastSentBpmHistory) ||
                         (spo2Sekarang != lastSentSpo2History);

    bool adaNilaiValid = (bpmSekarang > 0) || (spo2Sekarang > 0);

    if (adaPerubahan && adaNilaiValid)
    {
        FirebaseJson json;
        json.set("bpm", bpmSekarang);
        json.set("spo2", spo2Sekarang);
        json.set("mode", modeOtomatis ? "OTOMATIS" : "MANUAL");
        json.set("waktu/.sv", "timestamp");

        if (Firebase.RTDB.pushJSON(&fbdo, "/history/vitals", &json))
        {
            Serial.print("Perubahan BPM/SpO2 disimpan ke riwayat -> BPM=");
            Serial.print(bpmSekarang);
            Serial.print(" SpO2=");
            Serial.println(spo2Sekarang);
        }
        else
        {
            Serial.print("Gagal simpan riwayat vitals: ");
            Serial.println(fbdo.errorReason());
        }

        lastSentBpmHistory  = bpmSekarang;
        lastSentSpo2History = spo2Sekarang;
    }
}

// =====================================================================
// ================  DETEKSI BPM REAL-TIME DARI SINYAL IR  =============
// =====================================================================
// Dijalankan setiap sampel IR baru datang (bukan menunggu 100 sampel).
// Prinsip: pisahkan komponen DC (baseline cahaya) dari komponen AC
// (denyutan darah), lalu deteksi setiap kali sinyal AC melewati nol
// dari arah turun (falling edge) sebagai satu denyut jantung.

void resetBpmDetector()
{
    irACFiltered      = 0;
    irWasNegative      = false;
    lastIrBeatMillis   = 0;
    bpmBufIndex        = 0;
    bpmBufFilled       = 0;

    heartRate      = 0;
    validHeartRate = 0;

    // Reset juga penanda "nilai terakhir dikirim ke riwayat" supaya saat
    // jari nempel lagi, perubahan nilai tetap terdeteksi dengan benar.
    lastSentBpmHistory  = -1;
    lastSentSpo2History = -1;
}

void updateBPMRealtime(long ir)
{
    // ---- Deteksi ada/tidaknya jari berdasarkan level IR mentah ----
    bool fingerNow = (ir > IR_FINGER_THRESHOLD);

    if (!fingerNow)
    {
        if (fingerDetected)
        {
            // jari baru saja dilepas -> reset semua state deteksi
            resetBpmDetector();
        }
        fingerDetected = false;
        irDCFiltered = ir;   // supaya saat jari nempel lagi, DC tidak "kaget"
        return;
    }

    if (!fingerDetected)
    {
        // jari baru saja nempel -> mulai dari kondisi bersih
        irDCFiltered = ir;
        resetBpmDetector();
    }
    fingerDetected = true;

    // ---- Low-pass filter untuk dapatkan baseline (DC) ----
    irDCFiltered = irDCFiltered * 0.95f + (float)ir * 0.05f;

    // ---- Komponen denyut (AC) = selisih sinyal terhadap baseline ----
    float acRaw = (float)ir - irDCFiltered;

    // ---- Smoothing tambahan supaya tidak mendeteksi noise kecil ----
    irACFiltered = irACFiltered * 0.7f + acRaw * 0.3f;

    // ---- Deteksi zero-crossing arah turun (falling edge) sebagai 1 denyut ----
    bool nowNegative = (irACFiltered < 0);

    if (nowNegative && !irWasNegative)
    {
        unsigned long t = millis();

        if (t - lastIrBeatMillis > BEAT_REFRACTORY_MS)
        {
            if (lastIrBeatMillis > 0)
            {
                unsigned long interval = t - lastIrBeatMillis;

                if (interval > BEAT_MIN_INTERVAL_MS && interval < BEAT_MAX_INTERVAL_MS)
                {
                    float bpmInstant = 60000.0f / (float)interval;

                    bpmIntervalBuf[bpmBufIndex] = bpmInstant;
                    bpmBufIndex = (bpmBufIndex + 1) % BPM_AVG_COUNT;

                    if (bpmBufFilled < BPM_AVG_COUNT) bpmBufFilled++;

                    float sum = 0;
                    for (int i = 0; i < bpmBufFilled; i++) sum += bpmIntervalBuf[i];

                    float avgBpm = sum / bpmBufFilled;

                    heartRate      = (int32_t)round(avgBpm);
                    // baru dianggap valid setelah minimal 2 interval terkumpul,
                    // supaya tidak menampilkan angka dari 1 denyut acak
                    validHeartRate = (bpmBufFilled >= 2) ? 1 : 0;
                }
            }

            lastIrBeatMillis = t;
        }
    }

    irWasNegative = nowNegative;
}
// =====================================================================


long readTM7711() {
  long count = 0;
  while (digitalRead(DOUT) == HIGH);
  for (int i = 0; i < 24; i++) {
    digitalWrite(SCK, HIGH);
    delayMicroseconds(2);
    count <<= 1;
    digitalWrite(SCK, LOW);
    delayMicroseconds(2);
    if (digitalRead(DOUT)) count++;
  }
  digitalWrite(SCK, HIGH);
  delayMicroseconds(2);
  digitalWrite(SCK, LOW);
  if (count & 0x800000) count |= 0xFF000000;
  return count;
}

float getPressureMedian() {
  float s[FILTER_SIZE];
for (int i = 0; i < FILTER_SIZE; i++) {
    long raw = readTM7711();

    float mmHg;

if(raw <= 3230480)
{
    mmHg = (raw - 1630480) * 0.00003125;
}
else if(raw <= 4891480)
{
    mmHg = 50 + (raw - 3230480) * 0.00006020;
}
else
{
    mmHg = 150 + (raw - 4891480) * 0.00001840;
}

if (mmHg < 0)
    mmHg = 0;

s[i] = mmHg;

yield(); 
}
  for (int i = 0; i < FILTER_SIZE - 1; i++) {
    for (int j = i + 1; j < FILTER_SIZE; j++) {
      if (s[j] < s[i]) {
        float t = s[i];
        s[i] = s[j];
        s[j] = t;
      }
    }
  }
  return s[FILTER_SIZE / 2];
}
void cekTouch()
{
    // START hanya untuk mode MANUAL
    if(modeOtomatis)
        return;

    // START tidak boleh aktif di halaman hasil
    if(diHalamanHasil)
        return;

    if(touch.touched())
    {
        TS_Point p = touch.getPoint();

        int x = map(p.y, 0, 320, 0, 480);
        int y = map(p.x, 0, 480, 0, 320);

        Serial.print("X=");
        Serial.print(x);
        Serial.print(" Y=");
        Serial.println(y);

        if(
            x > 103 &&
            x < 258 &&
            y > 26 &&
            y < 35
        )
        {
            mulai = true;

            homeShown = false;
            redrawHome = true;
            redrawInflate = true;
            redrawMeasure = true;
            redrawResult = true;

            Serial.println("START TOUCH AKTIF");
        }
    }
}
void cekTouchBack()
{
    // BACK hanya aktif di halaman hasil
    if(!diHalamanHasil)
        return;

    if(touch.touched())
    {
        TS_Point p = touch.getPoint();

        int x = map(p.y, 0, 320, 0, 480);
        int y = map(p.x, 0, 480, 0, 320);

        Serial.print("BACK X=");
        Serial.print(x);
        Serial.print(" Y=");
        Serial.println(y);

        if(
            x > 82 &&
            x < 270 &&
            y > 16 &&
            y < 23
        )
        {
            Serial.println("BACK TOUCH");

            // Keluar dari halaman hasil
            diHalamanHasil = false;

            // Hentikan proses saat ini
            mulai = false;

            // Jangan reset lastAutoStart!
            // Agar AUTO tetap menghitung 30 menit.

            homeShown = false;

            redrawHome = true;
            redrawInflate = true;
            redrawMeasure = true;
            redrawResult = true;

            while(touch.touched())
            {
                delay(10);
            }
        }
    }
}
void valveTutup() {
  digitalWrite(VALVE, LOW);
}

void valveBukaPenuh() {
  digitalWrite(VALVE, HIGH);
}

void valveBukaAdaptif(float tekanan) {
  static unsigned long last = 0;
  
  if (millis() - last >= 90) {
    float deltaP = lastPressureControl - tekanan;
    float deltaT = (millis() - lastTimeControl) / 1000.0;
    float rate = deltaP / deltaT;
    
    if (rate < 1.5) {
    digitalWrite(VALVE, HIGH);
    delayMicroseconds(2000);
    digitalWrite(VALVE, LOW);
    }
    else if (rate > 2.0) {
      digitalWrite(VALVE, HIGH);
      delayMicroseconds(200);
      digitalWrite(VALVE, LOW);
    }
    else {
      digitalWrite(VALVE, HIGH);
      delayMicroseconds(1000);
      digitalWrite(VALVE, LOW);
    }
    
    lastPressureControl = tekanan;
    lastTimeControl = millis();
    last = millis();
  }
}
void cekTombol()
{
    static bool last = HIGH;

    bool now = digitalRead(TOMBOL);

    if(now == LOW && last == HIGH)
    {
        // Toggle AUTO <-> MANUAL
        modeOtomatis = !modeOtomatis;

        homeShown = false;
        redrawHome = true;
        redrawInflate = true;
        redrawMeasure = true;
        redrawResult = true;

        tft.fillRect(0, 0, 480, 40, TFT_BLUE);

        tft.setTextDatum(MC_DATUM);
        tft.setTextColor(TFT_WHITE, TFT_BLUE);

        if(modeOtomatis)
        {
            // ==================================
            // MASUK MODE OTOMATIS
            // ==================================

            tft.drawString(
                "❤ PASIEN MONITOR OTOMATIS",
                240,
                20,
                4
            );

            Serial.println("MODE OTOMATIS");

            // LANGSUNG MULAI PENGUKURAN
            mulai = true;

            // Jangan menunggu 30 menit untuk pengukuran pertama
            lastAutoStart = millis();

            Serial.println("AUTO: LANGSUNG POMPA");
        }
        else
        {
            // ==================================
            // MASUK MODE MANUAL
            // ==================================

            tft.drawString(
                "❤ PASIEN MONITOR MANUAL",
                240,
                20,
                4
            );

            Serial.println("MODE MANUAL");

            // Jika sedang berada di halaman hasil,
            // keluar dari proses otomatis
            if(diHalamanHasil)
            {
                diHalamanHasil = false;
                mulai = false;

                homeShown = false;
                redrawHome = true;
                redrawInflate = true;
                redrawMeasure = true;
                redrawResult = true;
            }
        }
    }

    last = now;
}
void tampilHome()
{
    if(redrawHome)
    {
        clearLeftPanel();

        tft.setTextDatum(MC_DATUM);

        // STATUS
        tft.setTextColor(TFT_GREEN,TFT_BLACK);
        tft.drawString("STATUS",120,65,2);
        tft.drawRoundRect(35,90,170,55,8,TFT_GREEN);

        // TEKANAN DARAH
        tft.setTextColor(TFT_WHITE,TFT_BLACK);
        tft.drawString("SYS      DIA      MAP",120,170,2);
        tft.drawString("120       80       93",120,200,3);
        tft.drawString("mmHg    mmHg    mmHg",120,225,1);

        // BUTTON
        tft.fillRoundRect(55,250,130,45,8,TFT_GREEN);
        diHalamanHasil = false;
        redrawHome = false;
    }

    // =====================
    // hanya update bagian yang berubah
    // =====================

    tft.fillRect(45,95,150,40,TFT_BLACK);
    tft.setTextColor(TFT_GREEN,TFT_BLACK);
    tft.drawString("STANDBY",120,118,4);
if(!modeOtomatis)
    {
        tft.fillRoundRect(55,250,130,45,8,TFT_GREEN);

        tft.setTextColor(TFT_BLACK,TFT_GREEN);
        tft.drawString("▶ START",120,272,2);
    }
    else
    {
        tft.fillRect(40,245,170,55,TFT_BLACK);

        tft.setTextColor(TFT_GREEN,TFT_BLACK);
        tft.drawString("AUTO START",120,272,2);
    }
}



void tampilInflate(float p)
{
if(redrawInflate)
{
    clearLeftPanel();

    tft.setTextDatum(MC_DATUM);

    tft.setTextColor(TFT_YELLOW);
    tft.drawString("MENGISI MANSET",120,55,2);

    tft.setTextColor(TFT_GREEN,TFT_BLACK);
    tft.drawString("mmHg",120,180,4);

    tft.drawRect(20,260,200,20,TFT_WHITE);

    redrawInflate=false;
}

    // hanya hapus angka
    tft.fillRect(35,80,170,70,TFT_BLACK);

    tft.setTextColor(TFT_WHITE,TFT_BLACK);
    tft.drawString(String((int)p),120,120,7);

    // hanya hapus isi progress
    tft.fillRect(21,261,198,18,TFT_BLACK);

    int bar = map((int)p,0,TARGET_PRESSURE,0,198);

    tft.fillRect(21,261,bar,18,TFT_GREEN);
}
void tampilMeasure(float p)
{
    if(redrawMeasure)
    {
        clearLeftPanel();

        tft.setTextDatum(MC_DATUM);

        tft.setTextColor(TFT_CYAN);
        tft.drawString("MENGUKUR",120,55,2);

        tft.setTextColor(TFT_GREEN,TFT_BLACK);
        tft.drawString("mmHg",120,180,4);

        tft.setTextColor(TFT_WHITE,TFT_BLACK);
        tft.drawString("Mohon Tenang...",120,225,2);

        redrawMeasure = false;
    }

    tft.fillRect(35,80,170,70,TFT_BLACK);

    tft.setTextColor(TFT_WHITE,TFT_BLACK);
    tft.drawString(String((int)p),120,120,7);
}
void tampilHasil()
{
    if(redrawResult)
    {
        clearLeftPanel();

        // =====================================
        // HEADER HASIL
        // =====================================
        tft.fillRect(0, 0, 480, 40, TFT_BLUE);

        tft.setTextDatum(MC_DATUM);

        // =====================================
        // BACK HEADER - KHUSUS OTOMATIS
        // =====================================
        if(modeAlat == MODE_OTOMATIS)
        {
            tft.fillRoundRect(8, 6, 55, 28, 5, TFT_RED);

            tft.setTextColor(TFT_WHITE, TFT_RED);
            tft.drawString("<", 35, 20, 2);

            // Judul digeser agar tidak bertabrakan
            tft.setTextColor(TFT_WHITE, TFT_BLUE);
            tft.drawString(
                "PASIEN MONITOR OTOMATIS",
                275,
                20,
                4
            );
        }
        else
        {
            // Header manual tetap seperti sebelumnya
            tft.setTextColor(TFT_WHITE, TFT_BLUE);
            tft.drawString(
                "PASIEN MONITOR MANUAL",
                270,
                20,
                4
            );
        }

        // Garis header
        tft.drawFastHLine(0, 40, 480, TFT_WHITE);

        // =====================================
        // HASIL PENGUKURAN
        // =====================================
        tft.setTextDatum(TC_DATUM);
        tft.setTextColor(TFT_WHITE);

        tft.drawString("HASIL UKUR",120,55,4);

        tft.drawString("SYS",20,100,2);
        tft.drawString(String((int)sistolik),120,100,4);

        tft.drawString("DIA",20,150,2);
        tft.drawString(String((int)diastolik),120,150,4);

        tft.drawString("BPM",20,200,2);
        tft.drawString(
            String(validHeartRate ? heartRate : 0),
            120,
            200,
            4
        );

        String status="NORMAL";

        if(sistolik>=140 || diastolik>=90)
            status="TINGGI";
        else if(sistolik<90 || diastolik<60)
            status="RENDAH";

        tft.setTextDatum(MC_DATUM);

        tft.setTextColor(TFT_GREEN,TFT_BLACK);
        tft.drawString(status,120,240,4);

        // =====================================
        // BACK BAWAH - TETAP ADA
        // =====================================
        tft.fillRoundRect(40,275,160,35,8,TFT_RED);

        tft.setTextDatum(MC_DATUM);
        tft.setTextColor(TFT_WHITE,TFT_RED);
        tft.drawString("BACK",120,292,2);

        // Tandai bahwa sekarang berada di halaman hasil
        diHalamanHasil = true;

        redrawResult = false;
    }
}

void hitungTekanan() {

  sistolik  = mapValue + 25;
  diastolik = mapValue - 20;

}

void updateMonitor()
{
    static int lastHR = -1;
    static int lastSpO2 = -1;
    static bool lastFingerState = true; // paksa redraw pertama kali

    // ---- Tampilkan status "tidak ada jari" ----
    if (!fingerDetected)
    {
        if (lastFingerState)
        {
            tft.fillRect(320,80,120,60,TFT_BLACK);
            tft.setTextColor(TFT_DARKGREY,TFT_BLACK);
            tft.setTextDatum(MC_DATUM);
            tft.drawString("--",380,110,7);

            tft.fillRect(320,200,120,60,TFT_BLACK);
            tft.drawString("--",380,230,6);

            lastHR = -1;
            lastSpO2 = -1;
            lastFingerState = false;
        }
        return;
    }

    lastFingerState = true;

    if (heartRate != lastHR)
    {
        tft.fillRect(320,80,120,60,TFT_BLACK);
        tft.setTextColor(TFT_RED,TFT_BLACK);
        tft.drawNumber(validHeartRate ? heartRate : 0,360,110,7);

        lastHR = heartRate;
    }

    if (spo2 != lastSpO2)
    {
        tft.fillRect(320,200,120,60,TFT_BLACK);
        tft.setTextColor(TFT_CYAN,TFT_BLACK);
        tft.drawNumber(validSPO2 ? spo2 : 0,360,230,6);
        tft.drawString("%",420,230,4);

        lastSpO2 = spo2;
    }
}
void bacaMAX30102()
{
    // baca sensor setiap 20ms
    if(millis() - lastMAXRead < 20)
        return;

    lastMAXRead = millis();


    particleSensor.check();


    while(particleSensor.available())
    {

        irValue = particleSensor.getIR();
        redValue = particleSensor.getRed();

        // ---- BPM real-time: dihitung setiap sampel, bukan menunggu buffer penuh ----
        updateBPMRealtime(irValue);

        // simpan ke buffer SpO2 (buffer ini HANYA dipakai untuk hitung SpO2)
        irBuffer[spo2Index] = irValue;
        redBuffer[spo2Index] = redValue;


        spo2Index++;


        particleSensor.nextSample();


        // jika sudah 100 data baru hitung SpO2
        if(spo2Index >= bufferLength)
        {

            spo2Index = 0;

            // NOTE: keluaran heartRate/validHeartRate dari fungsi ini SENGAJA
            // ditampung ke variabel terpisah (maximHeartRate/maximValidHeartRate)
            // dan tidak dipakai untuk ditampilkan, karena BPM yang ditampilkan
            // sudah dihitung secara real-time & lebih stabil oleh updateBPMRealtime().
            // Fungsi ini tetap dipanggil karena juga menghasilkan nilai SpO2.
            maxim_heart_rate_and_oxygen_saturation(
                irBuffer,
                bufferLength,
                redBuffer,
                &spo2,
                &validSPO2,
                &maximHeartRate,
                &maximValidHeartRate
            );


            Serial.print("BPM (realtime) : ");
            Serial.println(heartRate);

            Serial.print("BPM (maxim, referensi) : ");
            Serial.println(maximHeartRate);


            Serial.print("SpO2 : ");

            if(validSPO2)
            {
                Serial.print(spo2);
                Serial.println("%");
            }
            else
            {
                Serial.println("Tidak Valid");
            }

        }

        particleSensor.check();
    }
}
void updateMAX30102()
{
    bacaMAX30102();

    updateMonitor();

    kirimDataRealtime();
}

void tampilPilihMode()
{
    if (!redrawMode)
        return;

    // Pastikan seluruh tampilan sebelumnya hilang
    tft.fillScreen(TFT_BLACK);

    tft.setTextDatum(MC_DATUM);

    // =========================
    // HEADER
    // =========================
    tft.fillRect(0, 0, 480, 45, TFT_BLUE);

    tft.setTextColor(TFT_WHITE, TFT_BLUE);
    tft.drawString("❤ PASIEN MONITOR", 240, 22, 4);

    // =========================
    // JUDUL
    // =========================
    tft.setTextColor(TFT_WHITE, TFT_BLACK);
    tft.drawString("PILIH MODE PENGUKURAN", 240, 90, 3);

    // =========================
    // TOMBOL MANUAL
    // =========================
    tft.fillRoundRect(
        45, 125,
        175, 90,
        12,
        TFT_GREEN
    );

    tft.setTextColor(TFT_BLACK, TFT_GREEN);
    tft.drawString("MANUAL", 132, 170, 4);

    // =========================
    // TOMBOL OTOMATIS
    // =========================
    tft.fillRoundRect(
        260, 125,
        175, 90,
        12,
        TFT_CYAN
    );

    tft.setTextColor(TFT_BLACK, TFT_CYAN);
    tft.drawString("OTOMATIS", 347, 170, 4);

    // =========================
    // INFORMASI
    // =========================
    tft.setTextColor(TFT_LIGHTGREY, TFT_BLACK);

    tft.drawString(
        "Silakan pilih mode pengukuran",
        240,
        275,
        2
    );

    redrawMode = false;
}

void cekTouchMode()
{
    if (modeAlat != PILIH_MODE)
        return;

    if (!touch.touched())
        return;

    TS_Point p = touch.getPoint();

    int x = map(p.y, 0, 320, 0, 480);
    int y = map(p.x, 0, 480, 0, 320);

    Serial.print("MODE TOUCH X=");
    Serial.print(x);
    Serial.print(" Y=");
    Serial.println(y);

    // =========================
    // TOMBOL MANUAL
    // =========================

    if (x >= 140 && x <= 300 &&
        y >= 72 && y <= 115)
    {
        Serial.println("================================");
        Serial.println("MODE MANUAL DIPILIH");
        Serial.println("================================");

        modeAlat = MODE_MANUAL;
        modeOtomatis = false;

        mulai = false;
        diHalamanHasil = false;
        homeShown = false;

        redrawHome = true;
        redrawInflate = true;
        redrawMeasure = true;
        redrawResult = true;

        tft.fillScreen(TFT_BLACK);

        drawLayout();
        tampilHome();

        // Tunggu jari dilepas
        while (touch.touched())
        {
            delay(10);
        }

        return;
    }


    // =========================
    // TOMBOL OTOMATIS
    // =========================

    if (x >= 430 && x <= 622 &&
        y >= 80 && y <= 110)
    {
        Serial.println("================================");
        Serial.println("MODE OTOMATIS DIPILIH");
        Serial.println("================================");

        modeAlat = MODE_OTOMATIS;
        modeOtomatis = true;

        mulai = true;
        diHalamanHasil = false;
        homeShown = false;

        // AUTO langsung melakukan pengukuran pertama
        lastAutoStart = millis();

        redrawHome = true;
        redrawInflate = true;
        redrawMeasure = true;
        redrawResult = true;

        tft.fillScreen(TFT_BLACK);

        drawLayout();
        tampilHome();

        // Tunggu jari dilepas
        while (touch.touched())
        {
            delay(10);
        }

        return;
    }
}

void cekBackManualHeader()
{
    // Hanya aktif di MODE MANUAL
    if (modeAlat != MODE_MANUAL)
        return;

    // Jika halaman hasil, tombol ini tidak digunakan
    if (diHalamanHasil)
        return;

    if (!touch.touched())
        return;

    TS_Point p = touch.getPoint();

    int x = map(p.y, 0, 320, 0, 480);
    int y = map(p.x, 0, 480, 0, 320);

    Serial.print("BACK HEADER TOUCH -> X=");
    Serial.print(x);
    Serial.print(" Y=");
    Serial.println(y);

    // Area tombol BACK di header
    if (x >= 15 && x <= 90 &&
        y >= 160 && y <= 195)
    {
        Serial.println("==============================");
        Serial.println("BACK MANUAL DITEKAN");
        Serial.println("KEMBALI KE PILIH MODE");
        Serial.println("==============================");

        // =====================================
        // HENTIKAN SEMUA PROSES PENGUKURAN
        // =====================================
        mulai = false;

        // Matikan pompa
        digitalWrite(POMPA, LOW);

        // Buka valve
        valveBukaPenuh();

        // =====================================
        // RESET STATUS HALAMAN
        // =====================================
        diHalamanHasil = false;
        homeShown = false;

        // =====================================
        // KEMBALI KE HALAMAN PILIH MODE
        // =====================================
        modeAlat = PILIH_MODE;
        modeOtomatis = false;

        // =====================================
        // PAKSA HALAMAN PILIH MODE DIGAMBAR ULANG
        // =====================================
        redrawMode = true;

        redrawHome = true;
        redrawInflate = true;
        redrawMeasure = true;
        redrawResult = true;

        // =====================================
        // BERSIHKAN SELURUH TFT
        // =====================================
        tft.fillScreen(TFT_BLACK);

        // Tunggu jari dilepas
        while (touch.touched())
        {
            delay(10);
        }

        Serial.println("SUDAH KEMBALI KE PILIH MODE");

        // Jangan gambar halaman manual lagi
        return;
    }
}

void cekBackOtomatisHeader()
{
    // Hanya aktif pada MODE OTOMATIS
    if (modeAlat != MODE_OTOMATIS)
        return;

    if (!touch.touched())
        return;

    TS_Point p = touch.getPoint();

    int x = map(p.y, 0, 320, 0, 480);
    int y = map(p.x, 0, 480, 0, 320);

    Serial.print("BACK OTOMATIS HEADER -> X=");
    Serial.print(x);
    Serial.print(" Y=");
    Serial.println(y);

    // =========================================
    // AREA TOUCH TOMBOL BACK HEADER
    // =========================================
    if (x >= 15 && x <= 90 &&
        y >= 160 && y <= 195)
    {
        Serial.println("==============================");
        Serial.println("BACK OTOMATIS DITEKAN");
        Serial.println("KEMBALI KE PILIH MODE");
        Serial.println("==============================");

        // =========================================
        // HENTIKAN PENGUKURAN OTOMATIS
        // =========================================
        mulai = false;

        // Matikan pompa
        digitalWrite(POMPA, LOW);

        // Buka valve
        valveBukaPenuh();

        // =========================================
        // RESET STATUS
        // =========================================
        diHalamanHasil = false;
        homeShown = false;

        // =========================================
        // KEMBALI KE PILIH MODE
        // =========================================
        modeAlat = PILIH_MODE;
        modeOtomatis = false;

        // =========================================
        // RESET REDRAW
        // =========================================
        redrawMode = true;
        redrawHome = true;
        redrawInflate = true;
        redrawMeasure = true;
        redrawResult = true;

        // =========================================
        // BERSIHKAN TFT
        // =========================================
        tft.fillScreen(TFT_BLACK);

        // Tunggu jari dilepas
        while (touch.touched())
        {
            delay(10);
        }

        Serial.println("SUDAH KEMBALI KE PILIH MODE");

        return;
    }
}

void setup() {

  Serial.begin(115200);

  Serial.println("BOOT ESP32");

  unsigned long bootStart = millis();
  while (millis() - bootStart < 2000) {
      yield();    // ESP32 tetap menjalankan task background
  }

  Serial.println("SETUP MULAI");

  pinMode(TOMBOL, INPUT_PULLUP);
  pinMode(DOUT, INPUT);
  pinMode(SCK, OUTPUT);
  pinMode(POMPA, OUTPUT);
  pinMode(VALVE, OUTPUT);

  valveBukaPenuh();

  tft.init();
  tft.setRotation(1);      // Landscape 480x320
  tft.invertDisplay(true);
  Wire.begin(21,22);      // TFT Touch
  WireMAX.begin(16,17);   // MAX30102
//================ MAX30102 =================
if (!particleSensor.begin(WireMAX, I2C_SPEED_FAST))
{
    Serial.println("MAX30102 tidak ditemukan!");
}
else
{
    Serial.println("MAX30102 OK");

    byte ledBrightness = 60;
    byte sampleAverage = 4;
    byte ledMode = 2;
    int sampleRate = 100;
    int pulseWidth = 411;
    int adcRange = 4096;

    particleSensor.setup(
        ledBrightness,
        sampleAverage,
        ledMode,
        sampleRate,
        pulseWidth,
        adcRange
    );

    particleSensor.setPulseAmplitudeRed(0x3F);
    particleSensor.setPulseAmplitudeIR(0x3F);
    particleSensor.setPulseAmplitudeGreen(0);
}



    if(!touch.begin(40))
    {
    Serial.println("TOUCH ERROR");
    }
    else
    {
    Serial.println("TOUCH READY");
    }
  tft.fillScreen(TFT_BLACK);

// =====================================================================
// ==================  KONEKSI WIFI + FIREBASE  ==========================
// =====================================================================
connectWiFi();
connectFirebase();

// Tampilkan halaman pemilihan mode
modeAlat = PILIH_MODE;
redrawMode = true;
updateMonitor();
tampilPilihMode();
}



void loop()
{
    static unsigned long lastDebug = 0;

    if (millis() - lastDebug >= 1000)
    {
        lastDebug = millis();

        Serial.print("MULAI = ");
        Serial.println(mulai);

        Serial.print("MODE = ");
        Serial.println(modeAlat);
    }

    // =========================================
    // HALAMAN PILIH MODE
    // =========================================
    if (modeAlat == PILIH_MODE)
    {
        cekTouchMode();
        tampilPilihMode();

        return;
    }

    // =========================================
    // PROSES MODE MANUAL / OTOMATIS
    // =========================================

cekTombol();
updateMAX30102();

cekBackManualHeader();
cekBackOtomatisHeader();

// Jika tombol BACK otomatis ditekan
// dan sudah kembali ke PILIH MODE
if (modeAlat == PILIH_MODE)
{
    return;
}

    if (modeAlat != PILIH_MODE)
    {
        cekTouch();
    }

if(modeOtomatis &&
   !mulai &&
   millis() - lastAutoStart >= AUTO_INTERVAL)
{
    Serial.println("================================");
    Serial.println("AUTO INTERVAL 30 MENIT SELESAI");
    Serial.println("AUTO START PENGUKURAN");
    Serial.println("================================");

    mulai = true;

    // Timer berikutnya dimulai dari saat AUTO START
    lastAutoStart = millis();

    homeShown = false;
    redrawHome = true;
    redrawInflate = true;
    redrawMeasure = true;
    redrawResult = true;
}

if (!mulai) {

    digitalWrite(POMPA, LOW);

    valveBukaPenuh();

    if (!homeShown)
    {
        redrawHome = true;
        tampilHome();
        homeShown = true;
    }

    return;
}

Serial.println("MASUK MODE UKUR");

Serial.println("POMPA ON");

// Nyalakan pompa lebih cepat
digitalWrite(POMPA, HIGH);

Serial.println("POMPA BERHASIL DINYALAKAN");
  valveTutup();

// Ambil baseline sekali saja
baseline = getPressureMedian();  
  unsigned long startTime = millis();
  
static unsigned long lastInflate = 0;

while (mulai) {
  
    yield();
    cekTombol();
    updateMAX30102();// <-- tambahkan ini
    if (!mulai)
    {
        break;
    }

if (millis() - lastInflate >= 100) {

    lastInflate = millis();

    tekanan = getPressureMedian() - baseline;

    tampilInflate(tekanan);
}

    if (tekanan >= TARGET_PRESSURE) break;
    if (tekanan >= MAX_PRESSURE) break;
    if (millis() - startTime > 30000) break;
}
  
digitalWrite(POMPA, LOW);

// Ganti tampilan Inflate -> Measure
redrawMeasure = true;

unsigned long waitValve = millis();

  while (millis() - waitValve < 500) {
    yield();
    cekTombol();
    updateMAX30102();
    if (!mulai)
    {
        break;
    }
  }
    
  dataCount = 0;
  amplitudePeak = 0;
  osilasiRata = 0;
  beatIndex = 0;
  osc = 0;

  for (int i = 0; i < 5; i++) {
  peakVals[i] = 0;
  peakPress[i] = 0;
}

mapValue = 0;
amplitudePeak = 0;
  
  lastTekanan = getPressureMedian() - baseline;
  lastPressureControl = lastTekanan;
  lastTimeControl = millis();
  
  while (mulai) {
    yield();
    cekTombol();
    updateMAX30102();// <-- tambahkan ini
    if (!mulai)
    {
        break;
    }

    static unsigned long lastRead = 0;

if (millis() - lastRead >= 15) {

    lastRead = millis();

    tekanan = getPressureMedian() - baseline;

    valveBukaAdaptif(tekanan);
    
    float rawOsc = abs(tekanan - lastTekanan);
    static float osc1 = 0;
    osc1 = 0.6 * osc1 + 0.4 * rawOsc;
    osc = 0.8 * osc + 0.2 * osc1;
    
    lastTekanan = tekanan;
    
    if (dataCount < MAX_DATA) {
      pressureData[dataCount] = tekanan;
      oscData[dataCount] = osc;
      dataCount++;
    }
    
    if (tekanan > 60 && tekanan < 130) {
      for (int i = 0; i < 5; i++) {
        if (osc > peakVals[i]) {
          for (int j = 4; j > i; j--) {
            peakVals[j] = peakVals[j - 1];
            peakPress[j] = peakPress[j - 1];
          }
          peakVals[i] = osc;
          peakPress[i] = tekanan;
          break;
        }
      }
    }
    
    if (dataCount < 30) osilasiRata += osc / 30.0;
    
    float threshold = osilasiRata * 1.5f;
    
    if (osc > threshold && millis() - lastBeatMillis > 300) {
      unsigned long now = millis();
      
      if (lastBeatTime > 0) {
        unsigned long interval = now - lastBeatTime;
        if (interval > 300 && interval < 1500) {
          if (beatIndex < 20) {
            beatIntervals[beatIndex++] = interval;
          }
        }
      }
      
      lastBeatTime = now;
      lastBeatMillis = now;
    }
    
static unsigned long lastMeasure = 0;

if (millis() - lastMeasure >= 200) {

    lastMeasure = millis();

    tampilMeasure(tekanan);
}

if (tekanan < 80) break;
  }
  }  
  float sumP = 0, sumO = 0;
  int valid = 0;
  
  for (int i = 0; i < 5; i++) {
    if (peakVals[i] > osilasiRata * 1.2) {
      sumP += peakPress[i];
      sumO += peakVals[i];
      valid++;
    }
  }

  Serial.println("=== PEAK DATA ===");

for (int i = 0; i < 5; i++) {

  Serial.print("Peak[");
  Serial.print(i);
  Serial.print("] = ");

  Serial.print(peakVals[i]);

  Serial.print("  Pressure = ");

  Serial.println(peakPress[i]);
}

Serial.print("Osilasi Rata = ");
Serial.println(osilasiRata);
  
if (valid > 0) {
  mapValue = sumP / valid;
  amplitudePeak = sumO / valid;
}

Serial.print("VALID = ");
Serial.println(valid);

Serial.print("MAP = ");
Serial.println(mapValue);

hitungTekanan();

// Ganti tampilan Measure -> Hasil
redrawResult = true;

Serial.print("SYS = ");
Serial.println(sistolik);

Serial.print("DIA = ");
Serial.println(diastolik);
valveBukaPenuh();
tampilHasil();

// Kirim hasil akhir pengukuran ke Firebase
// (ditimpa di /monitor/hasil + disimpan sebagai riwayat baru di /history/tekanan)
kirimDataHasil();

// ===============================
// TUNGGU DI HALAMAN HASIL
// ===============================
if(modeOtomatis)
{
    // ==========================================
    // MODE OTOMATIS
    // ==========================================

    // Timer 30 menit DIMULAI SETELAH HASIL SELESAI
    lastAutoStart = millis();

    Serial.println("================================");
    Serial.println("HASIL DITAMPILKAN");
    Serial.println("AUTO: TIMER 30 MENIT DIMULAI");
    Serial.println("================================");

    while(mulai)
    {
    yield();

    cekTombol();
    updateMAX30102();

    // BACK HEADER OTOMATIS
    cekBackOtomatisHeader();

    // Jika kembali ke PILIH_MODE, keluar dari loop
    if (modeAlat == PILIH_MODE)
    {
        break;
    }

    // BACK BAWAH TETAP ADA
    cekTouchBack();

        // ======================================
        // Jika tombol diubah ke MANUAL
        // ======================================

        if(!modeOtomatis)
        {
            Serial.println("AUTO -> MANUAL");

            mulai = false;
            diHalamanHasil = false;

            homeShown = false;

            redrawHome = true;
            redrawInflate = true;
            redrawMeasure = true;
            redrawResult = true;

            break;
        }

        // ======================================
        // Jika BACK ditekan
        // ======================================

        if(!mulai)
        {
            Serial.println("BACK DITEKAN");
            Serial.println("Kembali ke STANDBY");

            break;
        }

        // ======================================
        // 30 MENIT SELESAI
        // ======================================

        if(millis() - lastAutoStart >= AUTO_INTERVAL)
        {
            Serial.println("================================");
            Serial.println("AUTO 30 MENIT SELESAI");
            Serial.println("AUTO START PENGUKURAN BERIKUTNYA");
            Serial.println("================================");

            diHalamanHasil = false;

            redrawHome = true;
            redrawInflate = true;
            redrawMeasure = true;
            redrawResult = true;

            // Tetap true supaya langsung
            // masuk ke proses pompa
            mulai = true;

            break;
        }
    }
}
else
{
    // ==========================================
    // MODE MANUAL
    // ==========================================

    while(mulai)
    {
        yield();

        cekTombol();
        updateMAX30102();
        cekTouchBack();

        if(!mulai)
            break;
    }
}
// ===============================
// RESET HANYA UNTUK MANUAL
// ===============================

if(!modeOtomatis)
{
    mulai = false;

    homeShown = false;

    redrawHome = true;
    redrawInflate = true;
    redrawMeasure = true;
    redrawResult = true;
}
}
void clearLeftPanel()
{
    tft.fillRect(6,46,228,268,TFT_BLACK);
}
void drawLayout()
{
    tft.fillScreen(TFT_BLACK);

    // =========================
    // HEADER
    // =========================
    tft.fillRect(0,0,480,40,TFT_BLUE);

    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(TFT_WHITE,TFT_BLUE);

    // =========================
    // TOMBOL BACK MANUAL
    // =========================
    if(modeAlat == MODE_MANUAL)
{
    // BACK MANUAL
    tft.fillRoundRect(8,6,55,28,5,TFT_RED);

    tft.setTextColor(TFT_WHITE,TFT_RED);
    tft.drawString("<",35,20,2);

    tft.setTextColor(TFT_WHITE,TFT_BLUE);
    tft.drawString(
        "PASIEN MONITOR MANUAL",
        270,
        20,
        4
    );
}
else if(modeAlat == MODE_OTOMATIS)
{
    // BACK OTOMATIS
    tft.fillRoundRect(8,6,55,28,5,TFT_RED);

    tft.setTextColor(TFT_WHITE,TFT_RED);
    tft.drawString("<",35,20,2);

    tft.setTextColor(TFT_WHITE,TFT_BLUE);
    tft.drawString(
        "PASIEN MONITOR OTOMATIS",
        275,
        20,
        4
    );
}

    // garis header
    tft.drawFastHLine(0,40,480,TFT_WHITE);

    // =========================
    // PANEL KIRI
    // =========================
    tft.drawRect(5,45,230,270,TFT_WHITE);

    // =========================
    // PANEL KANAN
    // =========================
    tft.drawRect(245,45,230,270,TFT_WHITE);

    // garis pemisah kanan BPM - SPO2
    tft.drawFastHLine(250,150,220,TFT_DARKGREY);

    // label BPM
    tft.setTextColor(TFT_RED,TFT_BLACK);
    tft.drawString("❤ BPM",360,70,2);

    // label SpO2
    tft.setTextColor(TFT_CYAN,TFT_BLACK);
    tft.drawString("SpO₂",360,175,2);
}
