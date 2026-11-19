# 🎓 CBT Al-Fatih - Aplikasi Ujian Berbasis Web dengan Pengawasan Anti-Kecurangan & Kamera

Aplikasi Computer-Based Test (CBT) berbasis web modern yang dibangun dengan **Node.js**, **Express**, **Socket.io**, dan **SQLite (Better-SQLite3)** dalam mode Write-Ahead Logging (WAL) untuk performa kecepatan dan konkurensi tinggi. Dilengkapi dengan sistem pendeteksi kecurangan aktif secara real-time dan pengawasan webcam berkala dengan kompresi foto otomatis.

---

## ✨ Fitur Utama

### 1. 🛡️ Sistem Deteksi Kecurangan Real-Time (Anti-Cheat Engine)
* **Deteksi Buka Tab Lain**: Mendeteksi secara langsung ketika siswa membuka tab browser lain atau meminimalkan jendela (`document.visibilitychange`).
* **Deteksi Pindah Aplikasi Lain**: Mendeteksi saat jendela ujian kehilangan fokus (`window.onblur`), seperti menekan Alt+Tab, tombol Windows/Start menu, atau membuka aplikasi lain.
* **Pencegahan Salin Soal (Anti Copy-Paste)**:
  - Blokir aksi salin (`copy`), potong (`cut`), seleksi teks (`selectstart`), dan klik kanan (`contextmenu`).
  - Blokir pintasan tombol keyboard dilarang: `Ctrl+C`, `Ctrl+V`, `Ctrl+X`, `Ctrl+A`, `Ctrl+U`, `Ctrl+S`, `Ctrl+P`, `F12`, dan pintasan Developer Tools (`Ctrl+Shift+I/J/C`).
* **Kewajiban Layar Penuh (Fullscreen Enforcement)**: Siswa wajib berada dalam mode layar penuh. Keluar dari fullscreen akan langsung dicatat sebagai pelanggaran.
* **Pencatatan Realtime ke Dashboard Admin**: Setiap pelanggaran dikirim via WebSocket (Socket.io) dan dicatat ke database lengkap dengan stempel waktu, jenis pelanggaran, dan identitas siswa.
* **Penguncian Sesi Otomatis**: Jika siswa melampaui batas toleransi pelanggaran (misal: 5 kali), ujian otomatis terkunci dan hanya dapat dibuka kembali oleh proktor/pengawas dari dashboard admin.

---

### 2. 📷 Pengawasan Kamera Depan (Webcam Proctoring)
* **Overlay Peringatan Izin Kamera**: Apabila siswa belum memberikan izin akses kamera, izin ditolak, atau kamera tertutup/terputus, aplikasi ujian menampilkan overlay pemblokir (*blocking modal*) yang mengaburkan soal dan mengunci interaksi hingga kamera kembali aktif.
* **Pengambilan Gambar Berkala (Setiap 30 Menit)**:
  - Mengambil foto awal (*baseline*) saat siswa menekan Mulai Ujian.
  - Mengambil foto otomatis secara berkala setiap 30 menit (interval dapat dikonfigurasi melalui pengaturan jadwal ujian).
* **Kompresi Foto Otomatis Hemat Penyimpanan**:
  - Foto dikompresi langsung di sisi klien menggunakan HTML5 Canvas menjadi format JPEG berkualitas optimal (dimensi 400x300 px).
  - Ukuran file sangat kecil (~10 KB - 25 KB per foto, menghemat hingga 95% ruang penyimpanan dibanding foto mentah multi-megabyte).
* **Galeri Foto Pengawasan di Dashboard Admin**: Admin dapat melihat riwayat galeri foto masing-masing siswa dan mengambil foto instan (*remote snapshot request*) kapan saja.

---

### 3. 👨‍💼 Dashboard Administrator
* **Manajemen Data Siswa**: Tambah, edit, dan hapus siswa (NIS, nama, kelas, sesi, ruang, password masuk).
* **🖨️ Cetak Kartu Ujian Siswa**:
  - Format resmi kartu peserta ujian sekolah (kop sekolah, foto 3x4, nomor peserta/NIS, nama, kelas, sesi, ruang, dan **password masuk ujian**).
  - Dilengkapi barcode identitas dan kolom tanda tangan panitia.
  - Tata letak siap cetak di kertas A4 (2 kolom x 4 baris = 8 kartu per lembar) dengan garis putus-putus (*dashed line*) untuk pemotongan rapi (`window.print()`).
  - Fitur filter cetak per kelas atau seluruh siswa.
* **Manajemen Bank Soal & Butir Soal**:
  - Pembuatan bank soal berdasarkan mata pelajaran dan tingkat kelas.
  - Kelola butir soal pilihan ganda (pertanyaan, opsi A, B, C, D, E, kunci jawaban, bobot nilai).
* **📥 Import Soal dari Excel (.xlsx)**:
  - Unduh template format Excel resmi dengan 1 klik (`/api/admin/questions/template`).
  - Import massal soal dari file Excel dengan validasi otomatis dan transaksi database cepat.
* **Atur Jadwal Ujian**:
  - Penentuan mata pelajaran, kelas peserta, rentang waktu mulai & selesai.
  - Durasi pengerjaan (menit) dan token ujian.
  - Pengaturan acak soal (*randomize questions*), acak opsi jawaban, tampilan nilai, toleransi pelanggaran, dan interval foto proctoring (30 menit).
* **🔴 Live Proctoring & Monitoring**:
  - Pemantauan peserta ujian yang sedang aktif secara langsung tanpa perlu refresh halaman.
  - Indikator progres soal terjawab, status online, sisa waktu, dan foto kamera terkini.
  - Tombol aksi admin: Buka Kunci Siswa (*Unlock*), Paksa Selesai (*Force Finish*), Ambil Foto Sekarang (*Remote Snapshot*), dan Kirim Pesan Peringatan ke Layar Siswa.
* **📊 Rekapitulasi & Ekspor Nilai ke Excel**:
  - Rekap perolehan nilai, jumlah benar, salah, kosong, dan riwayat pelanggaran.
  - Ekspor seluruh nilai peserta ujian ke file spreadsheet Excel (.xlsx).

---

### 4. ⚡ Basis Data Berkecepatan Tinggi (High-Performance Database)
* Menggunakan **SQLite** dengan driver C++ native **better-sqlite3**:
  - Konfigurasi **Write-Ahead Logging (WAL)**: `PRAGMA journal_mode = WAL;` (memungkinkan operasi baca dan tulis simultan tanpa lock bottleneck).
  - `PRAGMA synchronous = NORMAL;` dan `PRAGMA cache_size = -64000;` (in-memory caching 64MB).
  - Indeks pada kolom-kolom kritis (`nis`, `class_name`, `schedule_id`, `student_id`, `session_id`).
  - Latensi query dalam hitungan mikrodetik, mampu menangani ribuan request jawaban per detik tanpa memerlukan server database terpisah.

---

## 🚀 Panduan Menjalankan Aplikasi

### 1. Prasyarat
* **Node.js** v18+ (direkomendasikan v20 atau v24)
* **npm**

### 2. Instalasi Dependensi
```bash
npm install
```

### 3. Inisialisasi & Seeding Data Awal
Jalankan perintah berikut untuk membuat basis data SQLite dan mengisi data akun demo (Admin, 10 Siswa, Bank Soal, dan Jadwal Ujian Aktif):
```bash
npm run seed
```

### 4. Menjalankan Server
```bash
npm start
```
Aplikasi akan aktif di:
- **HTTP**: `http://localhost:3000` (atau `http://<ip-komputer>:3000`)
- **HTTPS**: `https://localhost:3001` (atau `https://<ip-komputer>:3001`) — **Direkomendasikan untuk Handphone** agar peramban mobile (Chrome Android & Safari iOS) memberikan izin kamera depan secara penuh.

### 5. Akses Login
- **Login Siswa**: Akses langsung ke halaman utama `/` (bersih tanpa tab admin & tanpa teks akun demo).
- **Login Admin / Proktor**: Akses ke `/admin/login` (atau link pengawas di bagian bawah halaman utama).

### 6. Menjalankan Pengujian Otomatis
```bash
npm test
```

---

## 🔑 Akun Demo (Untuk Pengujian)

| Role | Alamat Login | Username / NIS | Password |
| :--- | :--- | :--- | :--- |
| **Administrator** | `/admin/login` | `admin` | `admin123` |
| **Siswa 1** | `/` | `2026001` | `alfa123` |
| **Siswa 2** | `/` | `2026002` | `bintang45` |

*Token Ujian bawaan (opsional jika diminta):* `ALF2026`

---

## 📁 Struktur Direktori Proyek

```
alfatih_cbt/
├── db/
│   ├── database.js          # Inisialisasi SQLite WAL mode & skema tabel
│   ├── seed.js              # Seeder data awal (admin, siswa, bank soal, jadwal)
│   └── cbt_alfatih.db       # File database SQLite lokal
├── routes/
│   ├── auth.js              # Autentikasi Admin & Siswa
│   ├── admin.js             # API CRUD Siswa, Cetak Kartu, Soal, Excel, Hasil
│   └── exam.js              # API Ujian, Jawaban, Pelanggaran, Upload Foto
├── public/
│   ├── css/
│   │   ├── style.css        # Desain antarmuka umum & komponen UI
│   │   ├── exam.css         # Desain layar ujian CBT & overlay kamera
│   │   └── print-card.css   # Format cetak kartu ujian resmi A4
│   ├── js/
│   │   ├── exam.js          # Engine anti-curang, kamera proctoring, timer
│   │   ├── admin.js         # Utilitas dashboard admin & alert
│   │   └── proctoring.js    # Pemantauan realtime WebSocket & galeri foto
│   ├── uploads/
│   │   └── proctoring/      # Direktori penyimpanan foto kamera terkompresi
│   └── views/
│       ├── login.html       # Halaman login terpadu Siswa & Admin
│       ├── admin/
│       │   ├── dashboard.html    # Ringkasan statistik & log cepat
│       │   ├── students.html     # Manajemen data siswa
│       │   ├── print-cards.html  # Halaman siap cetak kartu ujian siswa
│       │   ├── questions.html    # Bank soal & import Excel
│       │   ├── schedules.html    # Atur jadwal ujian & aturan foto 30 menit
│       │   ├── monitoring.html   # Live proctoring & deteksi kecurangan
│       │   └── results.html      # Rekap nilai & export Excel
│       └── student/
│           ├── confirm.html      # Konfirmasi ujian & tes kamera depan
│           ├── exam.html         # Layar ujian CBT siswa
│           └── finish.html       # Bukti selesai ujian & perolehan nilai
├── server.js                # Server utama Express & WebSocket (Socket.io)
├── test_cbt.js              # Script pengujian otomatis 12 skenario
└── package.json             # Konfigurasi dependensi proyek
```

---

## 📜 Lisensi
Aplikasi dikembangkan untuk **CBT Al-Fatih** oleh Fadhilah Nugraha Putra.
