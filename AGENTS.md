# Konteks Proyek CBT Al-Fatih untuk AI

> Titik awal untuk perbaikan atau penambahan fitur tanpa memindai seluruh kode berulang kali.
>
> Terakhir diverifikasi terhadap implementasi: **18 November 2026**.

## Cara menggunakan dokumen ini

1. Baca ringkasan, peta direktori, dan bagian yang sesuai dengan tugas.
2. Buka hanya file implementasi yang akan diubah beserta konsumen/produsen kontraknya. Dokumen ini adalah peta navigasi, bukan pengganti pemeriksaan kode aktual.
3. Jangan membaca `node_modules/`, isi database SQLite, foto pengawasan, atau kunci sertifikat untuk memahami arsitektur.
4. Jika implementasi dan dokumen berbeda, **kode aktual adalah sumber kebenaran**. Setelah perubahan, perbarui bagian terkait di file ini; perbarui `README.md` bila perilaku yang terlihat pengguna juga berubah.
5. Bagian “hal yang perlu dijaga” menjelaskan perilaku saat ini, bukan daftar bug yang harus langsung diperbaiki.

## Ringkasan teknis

- Aplikasi **Computer-Based Test (CBT)** untuk admin/proktor dan siswa: bank soal, jadwal, pengerjaan ujian, penilaian, anti-kecurangan, foto webcam, dan monitoring realtime.
- Arsitektur: **monolit Node.js satu proses**, CommonJS (`require`/`module.exports`), tanpa framework frontend, template engine, bundler, atau tahap build.
- Server: Express 5 di `server.js`; halaman berupa HTML statis dengan JavaScript inline dan/atau JavaScript global di `public/js/`.
- Database: SQLite melalui `better-sqlite3` dengan API sinkron, WAL, foreign keys aktif, dan skema dibuat saat `db/database.js` pertama kali di-require.
- Realtime: Socket.IO dipasang pada server HTTP dan, bila sertifikat tersedia, server HTTPS. Instance dibagikan ke route melalui `req.app.get('io')`.
- Import/export Excel: `xlsx`; upload Excel ditampung di memori dengan `multer.memoryStorage()`. Foto webcam dikirim sebagai base64 JSON, bukan multipart.
- Dependensi runtime lain: `cookie-parser`. Tidak ada library hashing password, ORM, migration runner, dotenv, linter, formatter, atau test framework.
- Runtime saat dokumentasi dibuat: Node.js `v24.13.0`, npm `11.6.2`; README menyebut Node.js 18+.
- HTTP mendengarkan di `0.0.0.0:3000`; HTTPS opsional di `0.0.0.0:3001`. Hanya `PORT` dan `HTTPS_PORT` yang dibaca dari environment.
- HTTPS aktif hanya jika `certs/cert.pem` dan `certs/key.pem` valid. Kamera pada perangkat non-localhost umumnya memerlukan secure context/HTTPS.

## Alur arsitektur

```text
Browser siswa/admin
  ├─ HTML statis + JavaScript inline/global
  ├─ fetch JSON ──> Express ──> routes/auth.js
  │                         ├─> routes/admin.js ──> xlsx/multer
  │                         └─> routes/exam.js  ──> file snapshot
  │                                  └─> calculateSessionScore di routes/admin.js
  ├─ Socket.IO <────────────────── server.js dan route API
  └─ aset statis <──────────────── public/css, public/js, public/uploads

Semua route dan server.js ──> db/database.js ──> db/cbt_alfatih.db
```

Tidak ada lapisan controller/service/model terpisah. SQL, validasi, dan response HTTP berada langsung di route; sebagian besar logika UI juga berada langsung di file HTML.

## Peta direktori dan tanggung jawab

```text
alfatih_cbt/
├── server.js                    # Bootstrap Express, HTTP/HTTPS, static files, halaman, Socket.IO
├── package.json                 # CommonJS, dependensi, scripts start/dev/seed/test
├── package-lock.json            # Kunci versi dependensi npm
├── test_cbt.js                  # Tes integrasi 12 langkah; memakai server dan database nyata
├── README.md                    # Panduan pengguna, fitur, instalasi, akun demo
├── AGENTS.md                    # Dokumen ini: peta konteks untuk perubahan berikutnya
├── db/
│   ├── database.js              # Koneksi SQLite, PRAGMA, CREATE TABLE/INDEX IF NOT EXISTS
│   ├── seed.js                  # Data demo: admin, 10 siswa, 10 soal, 1 jadwal
│   └── cbt_alfatih.db*          # Data runtime SQLite termasuk -wal/-shm; jangan diedit manual
├── routes/
│   ├── auth.js                  # Login/me/logout, sesi token di memori, middleware role
│   ├── admin.js                 # Semua API admin, Excel, monitoring, fungsi penilaian
│   └── exam.js                  # Semua API siswa, urutan soal, timer, jawaban, proctoring
├── public/
│   ├── css/
│   │   ├── style.css            # Layout, navigasi, form, tabel, kartu, komponen umum
│   │   ├── exam.css             # Layar ujian, palette, overlay kamera/kunci/modal
│   │   └── print-card.css       # Tata letak cetak kartu ujian A4
│   ├── js/
│   │   ├── admin.js             # Toast, logout, pemeriksaan auth admin di browser
│   │   ├── exam.js              # Engine ujian siswa, timer, kamera, anti-cheat, socket
│   │   └── proctoring.js        # Dashboard monitoring, galeri, remote action, socket admin
│   ├── uploads/proctoring/      # Foto JPEG runtime; bukan aset sumber
│   └── views/
│       ├── login.html           # Tidak dipetakan server.js; bukan login aktif
│       ├── admin/login.html
│       ├── admin/dashboard.html
│       ├── admin/students.html
│       ├── admin/print-cards.html
│       ├── admin/questions.html
│       ├── admin/schedules.html
│       ├── admin/monitoring.html
│       ├── admin/results.html
│       └── student/{login,confirm,exam,finish}.html
└── certs/                       # Sertifikat dan private key lokal; jangan tampilkan isinya
```

## Peta URL halaman

Route halaman didefinisikan langsung di `server.js`.

| URL | File | Keterangan |
|---|---|---|
| `/`, `/login`, `/student/login` | `public/views/student/login.html` | Login siswa |
| `/student/confirm` | `public/views/student/confirm.html` | Auth siswa, daftar jadwal, cek kamera, mulai/lanjutkan |
| `/student/exam?session_id=...` | `public/views/student/exam.html` | Memakai `public/js/exam.js` dan `exam.css` |
| `/student/finish?session_id=...` | `public/views/student/finish.html` | Bukti selesai dan hasil bila diizinkan |
| `/admin/login` | `public/views/admin/login.html` | Login admin |
| `/admin` | redirect | Menuju `/admin/dashboard` |
| `/admin/dashboard` | `public/views/admin/dashboard.html` | Statistik dan pelanggaran terbaru |
| `/admin/students` | `public/views/admin/students.html` | CRUD dan import siswa |
| `/admin/print-cards` | `public/views/admin/print-cards.html` | Filter dan cetak kartu |
| `/admin/questions` | `public/views/admin/questions.html` | Bank soal, CRUD soal, import Excel |
| `/admin/schedules` | `public/views/admin/schedules.html` | CRUD dan aktivasi jadwal |
| `/admin/monitoring?schedule_id=...` | `public/views/admin/monitoring.html` | Memakai `admin.js` dan `proctoring.js` |
| `/admin/results` | `public/views/admin/results.html` | Rekap dan export nilai |

Static mount: `/css`, `/js`, `/uploads`, dan `/public`. Route halaman sendiri tidak memakai middleware auth server; perlindungan data berada di API dan pemeriksaan auth browser.

## Autentikasi dan konvensi API

Sumber: `routes/auth.js`, dipasang di `/api/auth`.

- Login mengembalikan token acak dan menyetel cookie HTTP-only bernama `cbt_token`. Token juga diterima melalui `Authorization: Bearer <token>`.
- Sesi disimpan dalam `Map` bernama `activeSessions`, berisi `type: 'admin' | 'student'`; tidak disimpan di database atau cookie browser yang dapat dibaca JavaScript.
- Cookie admin berumur 24 jam dan siswa 12 jam, keduanya `sameSite: 'lax'`. Sesi tetap hilang saat proses Node.js berhenti.
- `requireAdmin` mengisi `req.user`; `requireStudent` mengisi `req.student`. Seluruh router admin dan exam telah memakai guard masing-masing melalui `router.use(...)`, jadi jangan menambahkan route dengan role yang salah ke router tersebut.
- Response umumnya JSON `{ success, message?, data? }`, tetapi detail session/monitoring memakai field khusus. Database memakai `snake_case`; payload Socket.IO dan sebagian response exam memakai `camelCase`.
- JSON dan URL-encoded body dibatasi 15 MB untuk foto base64.

Endpoint auth:

| Method dan path | Fungsi |
|---|---|
| `POST /api/auth/admin/login` | Body `username`, `password`; response berisi `token`, `user` |
| `POST /api/auth/student/login` | Body `nis`, `password`; response berisi `token`, `student` |
| `GET /api/auth/me` | Mengembalikan sesi aktif sebagai `user` |
| `POST /api/auth/logout` | Menghapus token/cookie; logout siswa juga menandai semua sesi `IN_PROGRESS` miliknya menjadi `FINISHED` |

## API ujian siswa

Sumber: `routes/exam.js`, prefix `/api/exam`, semuanya wajib sesi siswa.

| Method dan path | Kontrak/fungsi utama |
|---|---|
| `GET /available` | Jadwal aktif, difilter `target_classes`; menyertakan status, nilai, dan `session_id` siswa |
| `POST /start` | Body `schedule_id`, `token`; membuat atau melanjutkan sesi, response `sessionId` |
| `GET /session/:sessionId` | Detail `session`, `student`, dan `questions`; kunci jawaban tidak dikirim |
| `POST /answer` | Body `sessionId`, `questionId`, `selectedAnswer`, `isDoubtful`; upsert jawaban dan autosave |
| `POST /violation` | Body `sessionId`, `violationType`, `description`; mencatat, menambah counter, dapat mengunci |
| `POST /snapshot` | Body `sessionId`, `imageBase64`, `note`; menyimpan JPEG dan metadata |
| `POST /finish` | Body `sessionId`; menandai selesai, menghitung nilai, response hasil sesuai `show_result` |

Detail yang menentukan perilaku:

- `question_order` dan `options_order` dibuat hanya saat sesi baru. Resume memakai urutan tersimpan; jangan mengacak ulang saat membuka ujian kembali.
- Opsi yang dikirim ke browser mempertahankan kunci asli `A`–`E`; yang diacak adalah urutan tampilannya. Jawaban dan kunci tetap dibandingkan berdasarkan kunci asli tersebut.
- Sisa waktu dihitung server dari `started_at + duration_minutes - waktu sekarang`. Pengambilan session akan menyelesaikan dan menilai sesi aktif yang waktunya sudah habis.
- Sesi baru berstatus `IN_PROGRESS`; sesi `FINISHED` tidak dapat dimulai lagi dan `LOCKED` memerlukan tindakan admin.
- Penguncian terjadi ketika `violation_count >= max_violations`. Status sesi yang dikenal skema: `NOT_STARTED`, `IN_PROGRESS`, `FINISHED`, `LOCKED`, walaupun alur saat ini terutama memakai tiga status terakhir.
- Snapshot dikompresi browser menjadi 400×300 JPEG kualitas 0.5, lalu disimpan sebagai `/uploads/proctoring/snap_<schedule>_<student>_<timestamp>.jpg`.

## API admin

Sumber: `routes/admin.js`, prefix `/api/admin`, semuanya wajib sesi admin. UI yang memakainya terutama berada dalam `<script>` inline pada masing-masing view admin.

| Area | Endpoint |
|---|---|
| Dashboard | `GET /dashboard/stats` |
| Siswa | `GET /students?class_name=&search=`, `POST /students`, `PUT /students/:id`, `DELETE /students/:id` |
| Kelas | `GET /classes` |
| Excel siswa | `GET /students/template`, `POST /students/import-excel` dengan multipart field `excel_file` |
| Kartu | `GET /students/cards?class_name=`; response juga berisi `schoolInfo` |
| Bank soal | `GET /banks`, `POST /banks`, `DELETE /banks/:id` |
| Butir soal | `GET|POST /banks/:bankId/questions`, `PUT|DELETE /questions/:id` |
| Excel soal | `GET /questions/template`, `POST /banks/:bankId/import-excel` dengan multipart field `excel_file` |
| Jadwal | `GET|POST /schedules`, `PUT|DELETE /schedules/:id`, `PATCH /schedules/:id/toggle` |
| Monitoring | `GET /monitoring/:scheduleId` |
| Aksi proktor | `POST /monitoring/unlock`, `/monitoring/force-finish`, `/monitoring/request-snapshot`, `/monitoring/send-warning` |
| Galeri | `GET /monitoring/snapshots/:scheduleId/:studentId` |
| Nilai | `GET /results/:scheduleId`, `GET /results/:scheduleId/export-excel` |

Catatan kontrak admin:

- Penulisan `GET|POST` pada tabel adalah ringkasan dua method pada path yang sama, bukan satu method HTTP.
- Tambah/edit jadwal membawa `title`, `bank_id`, `target_classes`, `start_time`, `end_time`, `duration_minutes`, `token`, `randomize_questions`, `randomize_options`, `show_result`, `max_violations`, `snapshot_interval_minutes`, dan `is_active`.
- `target_classes` berupa `'ALL'` atau string kelas yang dipisahkan koma. Token jadwal dinormalisasi menjadi huruf besar.
- Aksi `unlock`, `force-finish`, `request-snapshot`, dan `send-warning` memakai body JSON; field utamanya `sessionId`, `studentId` bila relevan, serta `message` untuk peringatan.
- Query monitoring saat ini hanya mengambil sesi berstatus `IN_PROGRESS`, dengan 50 pelanggaran terbaru. Ini penting bila mengubah tampilan sesi terkunci/selesai.
- Import siswa melewati NIS duplikat/baris tidak lengkap dan membuat password `alfa<NIS>` bila kosong. Import soal membaca sheet pertama, memetakan beberapa alias header, lalu memperbarui `question_banks.total_questions`.
- `calculateSessionScore(sessionId)` berada di file ini dan diekspor sebagai properti router; `routes/exam.js` mengimpornya. Nilai adalah `earnedWeight / totalWeight * 100`, dibulatkan satu desimal, sekaligus memperbarui jumlah benar/salah/kosong dan flag `is_correct`.
- Penilaian membaca soal, kunci, dan bobot terkini dari bank saat perhitungan dilakukan; data tersebut tidak disalin sebagai snapshot nilai ke sesi.

## Model database

Sumber kebenaran skema: `db/database.js`. File database selalu bernama `db/cbt_alfatih.db`; belum ada konfigurasi path melalui environment.

| Tabel | Peran dan field penting |
|---|---|
| `users` | Admin: `username`, `password`, `name`, `role` |
| `students` | Siswa: `nis` unik, `password`, `name`, `class_name`, `gender`, `session_name`, `room_name` |
| `question_banks` | Bank: `code` unik, `subject`, `class_level`, `total_questions` |
| `questions` | Soal milik `bank_id`; nomor, teks/gambar, opsi A–E, `correct_answer`, `weight`; cascade saat bank dihapus |
| `exam_schedules` | Jadwal milik `bank_id`; target kelas, waktu, durasi, token, pengacakan, hasil, batas pelanggaran, interval foto, aktif |
| `student_exam_sessions` | Satu sesi per `UNIQUE(schedule_id, student_id)`; status, nilai/counter, urutan JSON, metadata klien |
| `student_answers` | Satu jawaban per `UNIQUE(session_id, question_id)`; pilihan, ragu, benar/salah, waktu update |
| `exam_violations` | Log pelanggaran per sesi/jadwal/siswa; jenis, deskripsi, timestamp |
| `proctoring_snapshots` | Metadata foto per sesi/jadwal/siswa; path publik, ukuran KB, waktu, catatan |

Relasi utama:

```text
users                         students
                              │ 1
question_banks 1───* questions│
       │ 1                    │ 1
       │                      │ *
       └────* exam_schedules 1───* student_exam_sessions
                                      │ 1
                                      ├─* student_answers *───1 questions
                                      ├─* exam_violations
                                      └─* proctoring_snapshots
```

- `question_order` adalah JSON array ID soal; `options_order` adalah JSON object `{ [question_id]: ['A', ...] }`.
- Indeks telah dibuat untuk pencarian penting. Foreign keys aktif, dan beberapa relasi sesi/jawaban/log memakai `ON DELETE CASCADE`.
- `CREATE TABLE IF NOT EXISTS` **tidak memigrasikan kolom pada database lama**. Penambahan/perubahan kolom memerlukan strategi migrasi eksplisit dan pencadangan database beserta file WAL yang relevan.
- `require('./db/database')` membuka database dan menjalankan inisialisasi sebagai side effect. Hindari require tanpa menyadari efek file tersebut.
- Seeder bersifat tambah data demo, bukan reset. Pemeriksaan siswa/jadwal memakai jumlah global, sehingga jangan menganggap seeder akan melengkapi setiap baris yang hilang.

## Alur bisnis utama

### Siswa mengerjakan ujian

1. Login melalui view siswa ke `/api/auth/student/login`.
2. `student/confirm.html` memeriksa `/api/auth/me`, meminta akses kamera, dan memuat `/api/exam/available`.
3. Tombol mulai memanggil `/api/exam/start`, lalu berpindah ke `/student/exam?session_id=<id>`. Tidak ada `localStorage`/`sessionStorage`; ID sesi berpindah melalui query string dan identitas melalui cookie.
4. `public/js/exam.js` memuat `/api/exam/session/:id`, membangun state global `examSession`, `questions`, `studentAnswers`, timer, anti-cheat, kamera, dan Socket.IO.
5. Setiap pilihan/tanda ragu langsung disimpan dengan `/api/exam/answer`. Pelanggaran dilaporkan dengan rate guard browser sekitar satu detik.
6. Kamera mengambil baseline setelah sekitar dua detik, lalu berkala sesuai `snapshot_interval_minutes`. Kamera gagal/berhenti menampilkan overlay dan melaporkan `CAMERA_BLOCKED`.
7. Selesai manual, waktu habis di browser, atau paksa selesai oleh proktor mengarah ke halaman finish. Server juga dapat menyelesaikan saat session dimuat setelah durasi berakhir.
8. `student/finish.html` membaca kembali session dan hanya menampilkan hasil jika `show_result` aktif.

### Admin dan proktor

1. Login admin, lalu setiap view memanggil endpoint sesuai tabel API.
2. `public/js/admin.js` menyediakan toast/logout dan memeriksa role admin untuk URL `/admin/*`, kecuali login dan print-cards. API tetap menjadi guard utama.
3. Monitoring memilih jadwal, memuat snapshot awal data melalui REST, lalu memperbarui kartu/log melalui Socket.IO.
4. Aksi proktor dikirim sebagai REST; route admin mengubah database bila perlu lalu mengirim event ke browser siswa.
5. Rekap nilai membaca sesi per jadwal; export Excel memakai `xlsx` dan response file langsung.

## Kontrak Socket.IO

Library browser dimuat dari `/socket.io/socket.io.js`. Server utama berada di `server.js`; event juga diproduksi dari `routes/exam.js` dan `routes/admin.js`.

| Event | Arah dan produsen/konsumen |
|---|---|
| `join_schedule` | Browser → server; memasukkan socket ke room `schedule_<id>`; belum ada emit client aktif yang memakainya |
| `student_heartbeat` | `public/js/exam.js` → server setiap 10 detik; memperbarui `last_activity` sesi aktif |
| `student_online_status` | Server → semua client dengan `lastSeen`; belum ada listener di frontend saat ini |
| `student_started` | `POST /start` → monitoring; memuat ulang data jadwal |
| `student_progress` | `POST /answer` → monitoring; membawa `answeredCount` |
| `cheating_alert` | `POST /violation` → monitoring; membawa pelanggaran dan status kunci |
| `new_snapshot` | `POST /snapshot` → monitoring; membawa path dan metadata foto |
| `student_finished` | `POST /finish` → monitoring; memicu pemuatan ulang |
| `session_unlocked` | Admin unlock → browser siswa; membuka overlay dan memulai timer kembali |
| `force_finished` | Admin force-finish → browser siswa; menuju halaman finish |
| `capture_instant_snapshot` | Admin → browser siswa; memicu pengambilan foto instan |
| `proctor_warning` | Admin → browser siswa; alarm dan pesan peringatan |

Saat ini route memakai `io.emit(...)`, sehingga event disiarkan global; penerima memfilter berdasarkan ID di payload. Room `schedule_<id>` belum menjadi mekanisme routing event. Jika mengganti nama event/field payload, ubah produsen dan semua listener bersama-sama.

Jenis pelanggaran yang dipakai UI meliputi `TAB_SWITCH`, `WINDOW_BLUR`, `COPY_PASTE`, `FULLSCREEN_EXIT`, `CAMERA_BLOCKED`, dan `DEVTOOLS_OPEN`; `GENERAL_VIOLATION` menjadi fallback server.

## Konvensi frontend

- HTML memakai fungsi global dan handler `onclick`; bukan ES module. Pertahankan nama fungsi yang dipanggil dari HTML atau perbarui keduanya.
- Sebagian besar JavaScript CRUD admin berada inline di bagian bawah view. `public/js/admin.js` hanya utilitas bersama, bukan seluruh logika admin.
- Elemen UI dirujuk dengan `getElementById`; perubahan ID/markup harus dicek terhadap JavaScript terkait.
- Data sering dirender melalui `innerHTML`. Pertahankan pola hanya bila perlu, dan jangan menganggap input pengguna otomatis aman.
- State ujian disimpan dalam variabel global selama halaman terbuka; jawaban persisten berada di SQLite. Tidak ada penyimpanan lokal browser untuk pemulihan offline.
- CSS umum dibagi dengan banyak halaman. Perubahan class di `style.css` dapat berdampak lintas view; `exam.css` lebih khusus untuk ujian.

## Hal yang perlu dijaga saat mengubah kode

- **Data dan kredensial nyata:** password disimpan/dibandingkan sebagai teks biasa, dan API siswa/kartu dapat mengembalikannya. Jangan menulis isi database, token sesi, private key, atau foto siswa ke dokumentasi/log.
- **Satu proses:** `activeSessions` tidak bertahan setelah restart dan tidak dibagikan antar-proses. Jangan memperkenalkan multi-instance tanpa menyelesaikan penyimpanan sesi.
- **Proteksi Socket.IO:** koneksi socket tidak memakai middleware role dan broadcast bersifat global. Jangan menganggap room/auth socket sudah menjadi batas keamanan.
- **Jadwal:** `/available` memfilter kelas dan `is_active`; `/start` saat ini memeriksa jadwal aktif dan token, tetapi tidak memeriksa ulang target kelas maupun jendela `start_time`/`end_time`. Jika aturan jadwal diubah, tentukan perilaku baru secara eksplisit dan uji start maupun resume.
- **Timer:** sumber sisa waktu adalah `started_at` dan durasi, bukan `end_time`. Browser hanya menghitung mundur dari nilai server; perubahan durasi pada sesi berjalan dapat memengaruhi hasil perhitungan berikutnya.
- **Finish/logout:** finish normal, force-finish, dan timeout server memanggil penilaian; logout siswa hanya mengubah status sesi aktif tanpa memanggil `calculateSessionScore`. Jangan menganggap semua jalur selesai setara.
- **Unlock tidak mereset pelanggaran:** admin hanya mengubah status menjadi `IN_PROGRESS`; counter tetap ada sehingga pelanggaran berikutnya dapat langsung mengunci lagi.
- **Monitoring:** query awal hanya memuat `IN_PROGRESS`; kode tampilan memang mengenal badge `LOCKED`, tetapi sesi terkunci tidak dikembalikan query tersebut.
- **File foto:** metadata dan file JPEG adalah dua sumber data berbeda. Penghapusan record/database tidak otomatis membersihkan file lama. `/uploads` dilayani sebagai static public.
- **Port HTTPS:** selain `HTTPS_PORT` di server, angka `3001` ditulis langsung pada `public/js/exam.js` dan `public/views/student/confirm.html`/`exam.html`. Perubahan port harus menyinkronkan semuanya.
- **Dependensi native:** `better-sqlite3` harus cocok dengan versi/platform Node.js. Setelah upgrade Node.js atau instalasi pada mesin baru, jalankan instalasi dan tes pada environment target.
- **Tidak ada auto-reload:** `npm run dev` sama dengan `npm start`; restart proses setelah mengubah backend.

## Peta perubahan: file minimum yang perlu dibaca

| Jenis tugas | File utama dan dampak yang perlu dicek |
|---|---|
| Login, role, cookie, logout | `routes/auth.js`; pemanggil `/api/auth/*` pada view; `public/js/admin.js`; guard di dua router lain |
| CRUD siswa/kartu/import siswa | `routes/admin.js`; `students.html` atau `print-cards.html`; `print-card.css` untuk cetak; skema `students` bila field berubah |
| Bank/soal/import Excel | `routes/admin.js`; `questions.html`; pengaruh pada `question_banks.total_questions`, sesi dan penilaian |
| Jadwal/aturan ujian | `routes/admin.js`; `schedules.html`; `routes/exam.js`; `student/confirm.html`; `db/database.js` bila skema berubah |
| Soal, pengacakan, jawaban, timer, finish | `routes/exam.js`; `public/js/exam.js`; `student/exam.html`/`finish.html`; `calculateSessionScore` di `routes/admin.js` |
| Penilaian/rekap/export | `calculateSessionScore` dan route results di `routes/admin.js`; semua jalur finish di `routes/exam.js`; `results.html`; `finish.html` |
| Anti-cheat/penguncian | `public/js/exam.js`; `routes/exam.js`; route monitoring di `routes/admin.js`; `public/js/proctoring.js`; `exam.html`/`exam.css` |
| Kamera/snapshot/galeri | `public/js/exam.js`; `routes/exam.js`; `public/js/proctoring.js`; `monitoring.html`; mount `/uploads` di `server.js` |
| Event realtime | Produsen di route/`server.js` dan semua listener di `public/js/exam.js`/`proctoring.js`; pertahankan nama event dan bentuk payload |
| Halaman/URL/static asset baru | `server.js`; view terkait; link navigasi pada view lain; CSS/JS yang dimuat |
| Skema database | `db/database.js`; query seluruh route; `seed.js`; migrasi database lama; `test_cbt.js`; dokumentasi ini |

## Perintah proyek

Jalankan dari root proyek:

```bash
npm install       # Instal dependensi, termasuk modul native better-sqlite3
npm run seed      # Tambahkan data demo bila kondisi seeder terpenuhi
npm start         # node server.js
npm run dev       # Sama dengan npm start; bukan watch mode
npm test          # Tes integrasi; baca peringatan di bawah sebelum menjalankan
```

Akun demo dan token tersedia di `README.md`; jangan menganggapnya aman untuk deployment publik. Tidak ada perintah build karena browser langsung memuat HTML/CSS/JavaScript sumber.

Pemeriksaan sintaks backend dan JavaScript global tanpa menjalankan server:

```bash
for file in server.js routes/*.js public/js/*.js db/*.js test_cbt.js; do
  node --check "$file" || exit 1
done
```

`node --check` tidak memeriksa JavaScript yang berada di dalam tag `<script>` pada HTML.

## Peringatan dan cara menjalankan tes

`test_cbt.js` adalah tes integrasi dengan side effect, **bukan tes unit yang terisolasi**:

- Membuka `db/cbt_alfatih.db` yang sebenarnya.
- Menghapus seluruh `student_exam_sessions` untuk NIS demo `2026001`; relasi cascade dapat menghapus jawaban/log terkait.
- Memulai ujian, menyimpan jawaban/pelanggaran, menulis file snapshot, lalu menyelesaikan sesi.
- Menjalankan server sendiri melalui `require('./server.js')` dan memakai URL tetap `http://127.0.0.1:3000`. Jangan menjalankan server lain pada port tersebut; mengganti `PORT` saja tidak mengubah URL tes.
- Bergantung pada akun demo serta sedikitnya satu jadwal aktif yang tersedia. Jadwal hasil seed memiliki jendela waktu, meskipun pengecekan waktu start saat ini terbatas seperti dijelaskan di atas.
- Mengakhiri seluruh proses dengan `process.exit`, bukan melalui test runner.

Jalankan `npm test` hanya pada database sekali pakai atau salinan proyek yang terisolasi. Jangan menjalankannya pada data ujian nyata. Untuk perubahan kecil yang tidak menyentuh alur tes, minimal lakukan pemeriksaan sintaks dan smoke test manual yang relevan.

Smoke test manual yang berguna:

1. Login admin dan siswa pada sesi browser berbeda.
2. Buat/edit data sesuai area perubahan, lalu muat ulang untuk memastikan persistensi.
3. Mulai dan resume ujian; pastikan urutan soal/opsi serta jawaban tidak berubah.
4. Simpan jawaban, cek progres admin, picu pelanggaran secara terkendali, dan cek lock/unlock bila relevan.
5. Uji baseline/berkala/instan snapshot pada HTTPS dan browser target bila menyentuh kamera.
6. Selesaikan melalui jalur yang diubah, cocokkan skor/counter di siswa, rekap admin, dan export Excel.
7. Periksa console browser dan terminal server untuk error; event realtime tidak tercakup menyeluruh oleh `test_cbt.js`.

## Checklist penyelesaian perubahan

- Baca hanya file terdampak dari peta perubahan, lalu telusuri referensi nama route/event/ID DOM yang diubah.
- Pertahankan kontrak response dan nama field kecuali semua konsumen ikut diperbarui.
- Untuk perubahan skema, sediakan migrasi database lama; mengubah `CREATE TABLE IF NOT EXISTS` saja tidak cukup.
- Jalankan pemeriksaan sintaks dan tes relevan pada data terisolasi.
- Verifikasi UI pada desktop/mobile bila markup, CSS, kamera, fullscreen, atau anti-cheat berubah.
- Jangan memasukkan data runtime, kredensial, private key, atau foto siswa ke dalam patch/dokumentasi.
- Perbarui `AGENTS.md` bila struktur, endpoint, tabel, event, perintah, atau asumsi penting berubah. Tulis ulang tanggal verifikasi hanya setelah mencocokkannya dengan kode.

## Urutan baca cepat

Jika waktu sangat terbatas:

1. **Fitur admin:** bagian API admin + `routes/admin.js` pada area terkait + view yang disebut.
2. **Fitur siswa:** alur siswa + `routes/exam.js` + `public/js/exam.js` atau view terkait.
3. **Bug realtime:** tabel Socket.IO + satu produsen + satu konsumen event; jangan mulai dari CSS.
4. **Bug data/nilai:** model database + query terkait + `calculateSessionScore` + jalur finish.
5. **Masalah menjalankan aplikasi:** perintah proyek + `package.json` + bootstrap `server.js`.

