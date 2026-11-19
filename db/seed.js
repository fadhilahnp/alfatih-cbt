const db = require('./database');

function seedDatabase() {
  console.log('🌱 Starting database seeding...');

  // 1. Seed Admin
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    db.prepare(`
      INSERT INTO users (username, password, name, role)
      VALUES (?, ?, ?, ?)
    `).run('admin', 'admin123', 'Administrator CBT Al-Fatih', 'admin');
    console.log('✅ Admin user created: admin / admin123');
  }

  // 2. Seed Students
  const studentCount = db.prepare('SELECT COUNT(*) as count FROM students').get().count;
  if (studentCount === 0) {
    const insertStudent = db.prepare(`
      INSERT INTO students (nis, password, name, class_name, gender, session_name, room_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const students = [
      ['2026001', 'alfa123', 'Achmad Fadhilah Pratama', 'XII-MIPA-1', 'L', 'Sesi 1 (07.30 - 09.30)', 'Lab Komputer 1'],
      ['2026002', 'bintang45', 'Aisyah Rahmawati Putri', 'XII-MIPA-1', 'P', 'Sesi 1 (07.30 - 09.30)', 'Lab Komputer 1'],
      ['2026003', 'cahya88', 'Bima Sakti Nugroho', 'XII-MIPA-1', 'L', 'Sesi 1 (07.30 - 09.30)', 'Lab Komputer 1'],
      ['2026004', 'dinda21', 'Dinda Permata Sari', 'XII-MIPA-1', 'P', 'Sesi 1 (07.30 - 09.30)', 'Lab Komputer 1'],
      ['2026005', 'elang99', 'Elang Ramadhan Kusuma', 'XII-MIPA-1', 'L', 'Sesi 1 (07.30 - 09.30)', 'Lab Komputer 1'],
      ['2026006', 'fauzan77', 'Fauzan Hafizh Hakim', 'XII-MIPA-2', 'L', 'Sesi 2 (10.00 - 12.00)', 'Lab Komputer 2'],
      ['2026007', 'ghina10', 'Ghina Salsabila', 'XII-MIPA-2', 'P', 'Sesi 2 (10.00 - 12.00)', 'Lab Komputer 2'],
      ['2026008', 'hadi321', 'Hadi Wijaya', 'XII-MIPA-2', 'L', 'Sesi 2 (10.00 - 12.00)', 'Lab Komputer 2'],
      ['2026009', 'indira55', 'Indira Ayu Wardhani', 'XII-IPS-1', 'P', 'Sesi 2 (10.00 - 12.00)', 'Lab Komputer 2'],
      ['2026010', 'joko789', 'Joko Tri Wahyudi', 'XII-IPS-1', 'L', 'Sesi 2 (10.00 - 12.00)', 'Lab Komputer 2']
    ];

    const insertMany = db.transaction((list) => {
      for (const s of list) {
        insertStudent.run(...s);
      }
    });
    insertMany(students);
    console.log(`✅ Seeded ${students.length} students.`);
  }

  // 3. Seed Question Bank
  let bank = db.prepare('SELECT id FROM question_banks WHERE code = ?').get('CBT-TIK-XII');
  let bankId;
  if (!bank) {
    const res = db.prepare(`
      INSERT INTO question_banks (code, subject, class_level, description, total_questions)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      'CBT-TIK-XII',
      'Informatika & Sains Terapan',
      'XII',
      'Bank Soal Ujian Tengah/Akhir Semester Mata Pelajaran Informatika & Sains Komputer',
      10
    );
    bankId = res.lastInsertRowid;
    console.log('✅ Question bank created with ID:', bankId);

    // Questions list
    const questions = [
      {
        q: 'Protokol jaringan yang digunakan untuk mengamankan komunikasi data di web melalui enkripsi SSL/TLS adalah...',
        a: 'HTTP',
        b: 'HTTPS',
        c: 'FTP',
        d: 'SMTP',
        e: 'DHCP',
        ans: 'B',
        weight: 10
      },
      {
        q: 'Dalam arsitektur sistem basis data relasional, fungsi dari perintah "PRAGMA journal_mode = WAL" pada SQLite adalah...',
        a: 'Menghapus seluruh tabel dan indeks',
        b: 'Mengaktifkan Write-Ahead Logging untuk mempercepat pembacaan dan penulisan secara bersamaan',
        c: 'Mengunci basis data agar tidak bisa diakses aplikasi web',
        d: 'Menghubungkan basis data dengan server cloud secara otomatis',
        e: 'Mengubah format database menjadi JSON',
        ans: 'B',
        weight: 10
      },
      {
        q: 'Komponen utama CPU yang bertanggung jawab melakukan operasi aritmetika dan perbandingan logika adalah...',
        a: 'Control Unit (CU)',
        b: 'Arithmetic Logic Unit (ALU)',
        c: 'Register Memory',
        d: 'Cache Memory',
        e: 'Front Side Bus',
        ans: 'B',
        weight: 10
      },
      {
        q: 'Event JavaScript yang paling tepat digunakan untuk mendeteksi ketika pengguna berpindah ke tab lain pada peramban web adalah...',
        a: 'window.onload',
        b: 'document.onkeydown',
        c: 'document.addEventListener("visibilitychange")',
        d: 'window.onresize',
        e: 'element.onmouseover',
        ans: 'C',
        weight: 10
      },
      {
        q: 'Format kompresi gambar berbasis web modern yang mampu mereduksi ukuran file hingga 30-50% lebih kecil dibanding JPEG biasa dengan kualitas visual setara adalah...',
        a: 'BMP',
        b: 'TIFF',
        c: 'WebP',
        d: 'PSD',
        e: 'RAW',
        ans: 'C',
        weight: 10
      },
      {
        q: 'Jika suatu algoritma pencarian biner (Binary Search) diterapkan pada array terurut berisi 1.024 elemen, jumlah perbandingan maksimal yang dibutuhkan adalah...',
        a: '10 kali',
        b: '512 kali',
        c: '1.024 kali',
        d: '20 kali',
        e: '100 kali',
        ans: 'A',
        weight: 10
      },
      {
        q: 'Manakah dari topologi jaringan berikut yang menggunakan kabel utama (backbone) tunggal di mana setiap node terhubung langsung ke kabel tersebut?',
        a: 'Topologi Star',
        b: 'Topologi Ring',
        c: 'Topologi Bus',
        d: 'Topologi Mesh',
        e: 'Topologi Tree',
        ans: 'C',
        weight: 10
      },
      {
        q: 'Prinsip pengawasan ujian daring (Proctoring) dengan kamera depan bertujuan utama untuk...',
        a: 'Menghemat bandwidth jaringan sekolah',
        b: 'Memastikan integritas, identitas peserta, dan meminimalisir intervensi pihak luar secara berkala',
        c: 'Merekam suara bising di sekitar ruangan',
        d: 'Mempercepat pengiriman jawaban ujian',
        e: 'Menonaktifkan sistem operasi komputer',
        ans: 'B',
        weight: 10
      },
      {
        q: 'Alamat IP Versi 4 (IPv4) berikut yang termasuk dalam rentang IP Private Kelas C adalah...',
        a: '10.0.0.1',
        b: '172.16.0.1',
        c: '192.168.1.100',
        d: '8.8.8.8',
        e: '127.0.0.1',
        ans: 'C',
        weight: 10
      },
      {
        q: 'Perintah SQL yang digunakan untuk menambahkan indeks baru pada kolom "nis" di tabel "students" untuk mempercepat query pencarian adalah...',
        a: 'ADD INDEX ON students(nis);',
        b: 'CREATE INDEX idx_students_nis ON students(nis);',
        c: 'ALTER TABLE students INSERT INDEX (nis);',
        d: 'UPDATE students SET INDEX = nis;',
        e: 'SELECT INDEX(nis) FROM students;',
        ans: 'B',
        weight: 10
      }
    ];

    const insertQ = db.prepare(`
      INSERT INTO questions (bank_id, question_number, question_text, option_a, option_b, option_c, option_d, option_e, correct_answer, weight)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertAllQ = db.transaction((items) => {
      let num = 1;
      for (const item of items) {
        insertQ.run(bankId, num++, item.q, item.a, item.b, item.c, item.d, item.e, item.ans, item.weight);
      }
    });
    insertAllQ(questions);
    console.log(`✅ Seeded ${questions.length} questions.`);
  } else {
    bankId = bank.id;
  }

  // 4. Seed Exam Schedule
  const scheduleCount = db.prepare('SELECT COUNT(*) as count FROM exam_schedules').get().count;
  if (scheduleCount === 0) {
    const now = new Date();
    const startTime = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago
    const endTime = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();   // 24 hours later

    db.prepare(`
      INSERT INTO exam_schedules (
        title, bank_id, target_classes, start_time, end_time,
        duration_minutes, token, randomize_questions, randomize_options,
        show_result, max_violations, snapshot_interval_minutes, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'Ujian Asesmen Akhir Semester - Informatika Terapan',
      bankId,
      'ALL',
      startTime,
      endTime,
      60, // 60 minutes duration
      'ALF2026',
      1,
      1,
      1,
      5,  // Max 5 violations
      30, // 30 minutes snapshot interval as requested
      1   // Active
    );
    console.log('✅ Seeded active exam schedule (Token: ALF2026)');
  }

  console.log('🎉 Seeding completed successfully!');
}

seedDatabase();
